from flask import Flask, render_template, send_file, abort
import sqlite3
import numpy as np
import hdbscan
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from search import search
from ai_tools import client, answer_from_screen_context
import time
from params import *
import io
from functools import lru_cache
from search.graph_search import get_graph_from_seed_ids
import re
from collections import Counter
import json
import sys
import umap


from sklearn.feature_extraction.text import TfidfVectorizer
app = Flask(__name__)


PCA_EMBEDS = None
BASE_META = None
DATASET_PAPER_MAP = {}


def load_baked_data():
    global PCA_EMBEDS, BASE_META, DATASET_PAPER_MAP
    try:
        print("[*] Loading pre-baked data into memory...")
        start_time = time.time()

        PCA_EMBEDS = np.load("umap_coords.npy")
        with open("base_meta.json", "r") as f:
            BASE_META = json.load(f)

        print(f"[*] Successfully loaded {len(BASE_META)} points. Building dataset tags...")

        # --- PRETAG DATASETS FROM DB ---
        with sqlite3.connect(DB) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT paper_id, dataset FROM papers WHERE dataset IS NOT NULL")
            for paper_id, dataset_raw in cursor.fetchall():
                if not dataset_raw:
                    continue

                p_id = str(paper_id)

                # Helper function to process and filter tags
                def add_tag(raw_tag):
                    tag = str(raw_tag).strip().lower()

                    # 🚩 FLAG: Ignore "madrigal cedar" completely
                    if "Madrigal Cedar" in tag:
                        return

                    if tag not in DATASET_PAPER_MAP:
                        DATASET_PAPER_MAP[tag] = set()
                    DATASET_PAPER_MAP[tag].add(p_id)


                try:
                    datasets = json.loads(dataset_raw) if isinstance(dataset_raw, str) else dataset_raw
                    if isinstance(datasets, list):
                        for d in datasets:
                            add_tag(d)
                    else:
                        add_tag(dataset_raw)
                except (json.JSONDecodeError, TypeError):
                    add_tag(dataset_raw)

        print(f"[*] Pre-tagged {len(DATASET_PAPER_MAP)} unique datasets in {time.time() - start_time:.2f} seconds!")

    except FileNotFoundError:
        print("\n[!] CRITICAL ERROR: Pre-baked data not found.")
        print("[!] Please run 'python bake_data.py' before starting the server.\n")
        sys.exit(1)
load_baked_data()

def get_graph_lines():
    data = request.json
    seed_ids = data.get("seed_ids", [])
    max_hops = data.get("max_hops", 1)

    graph_data = get_graph_from_seed_ids(seed_ids, max_hops=max_hops)
    return jsonify(graph_data)


@app.route('/api/download-pdf/<int:paper_id>', methods=['GET'])
def download_pdf(paper_id):
    conn = sqlite3.connect(DB)
    cursor = conn.cursor()

    cursor.execute("SELECT pdf_blob, title FROM papers WHERE paper_id = ?", (paper_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or not row[0]:
        return abort(404, description="PDF file not found in database.")

    pdf_data = row[0]
    title = row[1] or f"paper_{paper_id}"
    safe_filename = "".join([c if c.isalnum() else "_" for c in title]).lower() + ".pdf"

    return send_file(
        io.BytesIO(pdf_data),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=safe_filename
    )


def get_labels(texts, cluster_labels):
    cluster_names = {}
    unique_labels = np.unique(cluster_labels)

    academic_junk = {
        "using", "based", "results", "paper", "model", "models", "approach", "method", "methods",
        "data", "dataset", "datasets", "learning", "research", "study", "studies", "new", "proposed",
        "show", "use", "used", "et", "al", "etc", "analysis", "performance", "system", "systems",
        "evaluation", "framework", "process", "development", "application", "applications",
        "novel", "efficient", "effective", "experimental", "compared", "state", "art", "work",
        "problem", "problems", "solution", "solutions", "task", "tasks", "technique", "techniques",
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "first", "second", "third", "fourth", "fifth", "single", "double", "multiple",
        "zero", "hundred", "thousand", "million", "total", "average", "mean", "median",
        "year", "years", "month", "months", "time", "date", "dates", "period", "history",
        "current", "future", "past", "recent", "recently", "age", "ages", "daily", "weekly",
        "annual", "century", "decades", "decade", "day", "days", "hour", "hours", "time-series",
        "figure", "table", "page", "pages", "vol", "volume", "issue", "section", "abstract",
        "introduction", "conclusion", "references", "chapter", "appendix", "text", "graph", "chart", "effort",
        "doi", "url", "http", "https", "www", "com", "org", "net", "pdf", "html",
        "proceedings", "conference", "journal", "published", "publisher", "copyright", "university",
        "press", "editor", "editors", "editorial", "isbn", "issn", "author", "authors", "wiley"
    }

    stop_words = list(academic_junk | set(TfidfVectorizer(stop_words="english").get_stop_words()))

    for cid in unique_labels:
        if cid == -1:
            continue

        docs = [texts[j] for j in range(len(texts)) if cluster_labels[j] == cid]
        if len(docs) < 3:
            cluster_names[cid] = f"Cluster {cid + 1}"
            continue

        vectorizer = TfidfVectorizer(
            stop_words=stop_words,
            max_features=10,
            min_df=1,
            token_pattern=r'(?u)\b[a-zA-Z]{4,}\b'
        )
        try:
            X = vectorizer.fit_transform(docs)
            scores = np.asarray(X.mean(axis=0)).ravel()
            words = np.array(vectorizer.get_feature_names_out())
            top_indices = np.argsort(scores)[::-1][:3]
            cluster_names[cid] = " | ".join(words[top_indices])
        except Exception:
            cluster_names[cid] = f"Cluster {cid + 1}"

    return cluster_names


@app.route("/")
def index():
    return render_template("index.html")


# ... [keep your other imports and initialization] ...
@app.route('/api/paper-metadata/<paper_id>', methods=['GET'])
def get_paper_metadata(paper_id):
    paper_id_str = str(paper_id)

    for item in BASE_META:
        p_id = str(item.get("paper_id", ""))
        if p_id == paper_id_str:
            meta = item.get("metadata", item)

            p_title = meta.get("title", meta.get("TITLE", item.get("title", item.get("TITLE", f"Paper {p_id}"))))
            p_authors = meta.get("authors", meta.get("AUTHOR", meta.get("author", item.get("authors", item.get("AUTHOR",
                                                                                                               "Unknown")))))
            p_year = meta.get("year", meta.get("YEAR", item.get("year", item.get("YEAR", "N/A"))))

            if isinstance(p_authors, list):
                p_authors = ", ".join(str(a) for a in p_authors) if p_authors else "Unknown"
            else:
                p_authors = str(p_authors) if p_authors else "Unknown"

            return jsonify({
                "title": str(p_title).strip(),
                "authors": str(p_authors).strip(),
                "year": str(p_year).strip()
            })

    return jsonify({"error": "Paper not found"}), 404





PAPER_TO_DATASETS_CACHE = {}
for ds_name, p_ids in DATASET_PAPER_MAP.items():
    for pid in p_ids:
        pid_str = str(pid)
        if pid_str not in PAPER_TO_DATASETS_CACHE:
            PAPER_TO_DATASETS_CACHE[pid_str] = []
        if ds_name not in PAPER_TO_DATASETS_CACHE[pid_str]:
            PAPER_TO_DATASETS_CACHE[pid_str].append(ds_name)


@app.route('/api/filtered-data', methods=['POST'])
def get_filtered_data():
    import struct
    import json
    import numpy as np
    from flask import request

    k_value = request.args.get('k', default=15, type=int)
    method = request.args.get('method', 'none')
    want_labels = request.args.get('labels', 'false') == 'true'

    req_data = request.get_json() or {}
    requested_datasets = req_data.get('datasets', [])

    if not requested_datasets:
        empty_meta = b'{"i":[], "p":[], "c":[], "t":[], "m":{}}'
        empty_meta += b' ' * ((4 - (len(empty_meta) % 4)) % 4)
        payload = struct.pack('<I', len(empty_meta)) + empty_meta
        return app.response_class(payload, mimetype='application/octet-stream')

    valid_paper_ids = set()
    requested_lower = [d.lower() for d in requested_datasets]

    for req_tag in requested_lower:
        if req_tag in DATASET_PAPER_MAP:
            valid_paper_ids.update(str(pid) for pid in DATASET_PAPER_MAP[req_tag])

    x_coords, y_coords = [], []
    paper_ids, chunk_ids = [], []

    inst_indices, type_indices = [], []
    type_dict = {}
    type_names = []

    paper_meta_dict = {}

    for i, item in enumerate(BASE_META):
        paper_id = str(item.get("paper_id", ""))

        if paper_id in valid_paper_ids:
            meta = item.get("metadata", item)

            if paper_id not in paper_meta_dict:
                p_title = meta.get("title",
                                   meta.get("TITLE", item.get("title", item.get("TITLE", f"Paper {paper_id}"))))
                p_authors = meta.get("authors", meta.get("AUTHOR", meta.get("author", item.get("authors",
                                                                                               item.get("AUTHOR",
                                                                                                        "Unknown")))))
                p_year = meta.get("year", meta.get("YEAR", item.get("year", item.get("YEAR", "N/A"))))

                if isinstance(p_authors, list):
                    p_authors = ", ".join(str(a) for a in p_authors) if p_authors else "Unknown"
                else:
                    p_authors = str(p_authors) if p_authors else "Unknown"

                # Grab the precomputed datasets instantly (O(1) lookup)
                p_datasets = PAPER_TO_DATASETS_CACHE.get(paper_id, ["Unknown"])

                paper_meta_dict[paper_id] = {
                    "t": str(p_title).strip() if p_title else f"Paper {paper_id}",
                    "a": str(p_authors).strip(),
                    "y": str(p_year).strip() if p_year else "N/A",
                    "d": p_datasets
                }

            c_id = str(item.get("id", item.get("chunk_id", meta.get("id", meta.get("chunk_id", f"node_{i}")))))
            n_type = str(item.get("type", item.get("chunk_type", meta.get("type", meta.get("chunk_type", "chunk")))))

            try:
                x_coords.append(float(PCA_EMBEDS[i][0]))
                y_coords.append(float(PCA_EMBEDS[i][1]))
            except IndexError:
                x_coords.append(-999999.0)
                y_coords.append(-999999.0)

            paper_ids.append(paper_id)
            chunk_ids.append(c_id)

            if n_type not in type_dict:
                type_dict[n_type] = len(type_names)
                type_names.append(n_type)
            type_indices.append(type_dict[n_type])

    # ... (Rest of the clustering and packaging logic remains exactly the same) ...

    clusters_array = np.zeros(len(x_coords), dtype=np.int32)

    if method != 'none' and len(x_coords) > 0:
        coords = np.column_stack((x_coords, y_coords))
        valid_mask = coords[:, 0] != -999999.0
        if valid_mask.any():
            valid_coords = coords[valid_mask]
            if method.lower() == 'kmeans':
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=min(k_value, len(valid_coords)), random_state=42, n_init='auto')
                clusters_array[valid_mask] = kmeans.fit_predict(valid_coords).astype(np.int32)
            elif method.lower() == 'agglomerative':
                from sklearn.cluster import AgglomerativeClustering
                agglo = AgglomerativeClustering(n_clusters=min(k_value, len(valid_coords)))
                clusters_array[valid_mask] = agglo.fit_predict(valid_coords).astype(np.int32)
            elif method.lower() == 'hdbscan':
                import hdbscan
                clusterer = hdbscan.HDBSCAN(min_cluster_size=max(2, k_value))
                clusters_array[valid_mask] = clusterer.fit_predict(valid_coords).astype(np.int32)

    dict_payload = {
        "p": paper_ids,
        "c": chunk_ids,
        "t": type_names,
        "m": paper_meta_dict
    }

    meta_json = json.dumps(dict_payload, separators=(',', ':')).encode('utf-8')
    padding_needed = (4 - (len(meta_json) % 4)) % 4
    meta_json += b' ' * padding_needed
    meta_len = len(meta_json)

    bin_x = np.array(x_coords, dtype=np.float32).tobytes()
    bin_y = np.array(y_coords, dtype=np.float32).tobytes()
    bin_c = clusters_array.tobytes()
    bin_type = np.array(type_indices, dtype=np.uint8).tobytes()

    payload = struct.pack('<I', meta_len) + meta_json + bin_x + bin_y + bin_c + bin_type

    return app.response_class(payload, mimetype='application/octet-stream')


@lru_cache(maxsize=2000)
def fetch_paper_metadata(paper_id, title):
    db_paths = [DB]
    clean_paper_id = str(paper_id) if paper_id else None

    for db_path in db_paths:
        try:
            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                query_base = """
                             SELECT *
                             FROM papers p
                                      LEFT JOIN metadata_embeddings m USING (paper_id) \
                             """

                if clean_paper_id:
                    cursor.execute(f"{query_base} WHERE p.paper_id = ? LIMIT 1", (clean_paper_id,))
                else:
                    cursor.execute(f"{query_base} WHERE TRIM(p.title) = TRIM(?) COLLATE NOCASE LIMIT 1", (title,))

                row = cursor.fetchone()

            if row:
                data = {}
                for k, v in dict(row).items():
                    if v is not None:
                        if isinstance(v, bytes) or k in ('pdf_blob', 'embedding'):
                            continue
                        data[k] = v
                return data

        except Exception as e:
            print(f"[!] Metadata Database Error on {db_path}: {e}")
            continue

    return {}


@app.route("/api/metadata")
def get_metadata():
    paper_id = request.args.get('paper_id', '').strip()
    title = request.args.get('title', '').strip()

    if not paper_id and not title:
        return jsonify({})

    data = fetch_paper_metadata(paper_id, title)
    return jsonify(data)


@app.route('/api/search', methods=['POST'])
def handle_search_request():
    payload = request.get_json()
    user_query = payload.get('query', '')
    user_goal = payload.get('goal', '')
    user_steps = int(payload.get('steps', 1))
    user_papers = int(payload.get('k', 5))
    raw_valid_ids = payload.get('valid_ids', None)

    valid_ids = None
    if raw_valid_ids is not None:
        valid_ids = [str(v).split('_')[-1] for v in raw_valid_ids if v]

    if user_goal.strip():
        ids_per_step = search.get_search(user_query, user_goal, user_steps, user_papers, valid_ids=valid_ids)
        return jsonify(ids_per_step)

    flat_ids = []
    TARGET_K = 500

    if hasattr(search, 'get_top_k'):
        try:
            flat_ids = search.get_top_k(user_query, k=TARGET_K, valid_ids=valid_ids)
        except Exception as e:
            print(f"[!] FAISS get_top_k failed: {e}")

    if not flat_ids:
        try:
            with sqlite3.connect(DB) as conn:
                cursor = conn.cursor()
                query_term = f"%{user_query}%"

                def filter_db_results(raw_ids, limit):
                    if valid_ids is None:
                        return raw_ids[:limit]
                    valid_set_str = set(str(v) for v in valid_ids)
                    return [str(fid) for fid in raw_ids if str(fid) in valid_set_str][:limit]

                cursor.execute("SELECT chunk_id FROM chunks WHERE text LIKE ? LIMIT ?", (query_term, TARGET_K * 2))
                raw_matches = [str(row[0]) for row in cursor.fetchall()]
                flat_ids = filter_db_results(raw_matches, TARGET_K)

                if not flat_ids:
                    cursor.execute("""
                                   SELECT c.chunk_id
                                   FROM chunks c
                                            JOIN papers p ON c.paper_id = p.paper_id
                                   WHERE p.title LIKE ? LIMIT ?
                                   """, (query_term, TARGET_K * 2))
                    raw_matches = [str(row[0]) for row in cursor.fetchall()]
                    flat_ids = filter_db_results(raw_matches, TARGET_K)

                if not flat_ids:
                    cursor.execute("SELECT chunk_id FROM chunks LIMIT ?", (TARGET_K * 2,))
                    raw_matches = [str(row[0]) for row in cursor.fetchall()]
                    flat_ids = filter_db_results(raw_matches, TARGET_K)
        except Exception as e:
            print(f"[!] Comprehensive database fallback pipeline failed: {str(e)}")
            flat_ids = []

    return jsonify({
        "query_anchor": flat_ids[0] if flat_ids else None,
        "goal_anchor": None,
        "path_anchors": [],
        "path_coords": [],
        "step_documents": [flat_ids]
    })


@app.route('/api/titles', methods=['POST'])
def get_titles():
    chunk_ids = request.json.get('ids', [])
    if not chunk_ids:
        return jsonify({})

    cleaned_ids = [str(cid).split('_')[-1] for cid in chunk_ids]
    id_mapping = {str(cid).split('_')[-1]: str(cid) for cid in chunk_ids}
    title_map = {}

    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        for i in range(0, len(cleaned_ids), 900):
            batch = cleaned_ids[i:i + 900]
            placeholders = ','.join(['?'] * len(batch))
            cursor.execute(f"""
                SELECT c.chunk_id, p.title 
                FROM chunks c
                JOIN papers p ON c.paper_id = p.paper_id
                WHERE c.chunk_id IN ({placeholders})
            """, batch)
            for row in cursor.fetchall():
                db_id = str(row[0])
                orig_id = id_mapping.get(db_id, db_id)
                title_map[orig_id] = row[1]

    return jsonify(title_map)


@app.route('/api/summarize', methods=['POST'])
def summarize_step_api():
    chunk_ids = request.json.get('ids', [])
    tag = request.json.get('tag', None)  # Extract optional tag
    bias_text = request.json.get('bias_text', None) or request.json.get('bias', None) # Extract optional bias

    if not chunk_ids:
        return jsonify({"topic": "No data found"})

    safe_ids = [str(cid).split('_')[-1] for cid in chunk_ids]
    rows = []

    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        for i in range(0, len(safe_ids), 900):
            batch = safe_ids[i:i + 900]
            placeholders = ','.join(['?'] * len(batch))
            cursor.execute(f"""
                SELECT p.title, c.text 
                FROM chunks c
                JOIN papers p ON c.paper_id = p.paper_id
                WHERE c.chunk_id IN ({placeholders})
            """, batch)
            rows.extend(cursor.fetchall())

    if not rows:
        return jsonify({"topic": "No data found"})

    prompt_content = "\n\n".join([f"Title: {row[0]}\nAbstract: {row[1][:1000]}" for row in rows])

    # Base strict prompt
    system_prompt = "You are a strict string generator. Generate a single plain text short descriptive label that is 3 to 5 words long without markdown or punctuation."

    # Contextualize prompt: tag context takes precedence so metadata summarization is preserved
    if tag:
        print(tag)
        system_prompt += f" Focus the label specifically on how the text relates to the metadata topic: '{tag}'."
    elif bias_text:
        system_prompt += f" Focus the label specifically on how the text relates to the bias: '{bias_text}'."

    try:
        summary_text = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt_content}
            ]
        ).choices[0].message.content

        clean_topic = summary_text.strip().replace('"', '').replace('*', '')
        if ":" in clean_topic:
            clean_topic = clean_topic.split(":")[-1].strip()

        return jsonify({"topic": clean_topic})
    except Exception as e:
        print(f"[!] Summarize API Error: {e}")
        return jsonify({"topic": "Summary Error"})



@app.route('/api/keywords', methods=['POST'])
def get_keywords_api():
    chunk_ids = request.json.get('ids', [])
    if not chunk_ids:
        return jsonify({"keywords": "No data"})

    safe_ids = [str(cid).split('_')[-1] for cid in chunk_ids]
    texts = []

    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        for i in range(0, len(safe_ids), 900):
            batch = safe_ids[i:i + 900]
            placeholders = ','.join(['?'] * len(batch))
            cursor.execute(f"SELECT text FROM chunks WHERE chunk_id IN ({placeholders})", batch)
            texts.extend([row[0] for row in cursor.fetchall()])

    if not texts:
        return jsonify({"keywords": "No data"})

    labels = get_labels(texts, [0] * len(texts))
    return jsonify({"keywords": labels.get(0, "Research Topic")})


@app.route('/api/topic-cluster', methods=['POST'])
def topic_cluster():
    global BASE_META
    global PCA_EMBEDS

    try:
        data = request.json
        topics = data.get('topics', [])

        if len(topics) != 3:
            return jsonify({"error": "Please provide exactly 3 topics"}), 400

        if BASE_META is None or PCA_EMBEDS is None:
            return jsonify({"error": "Global data not loaded yet."}), 500

        # 1. Fetch your global IDs from the frontend state cache
        all_ids = [str(item['chunk_id']) for item in BASE_META]
        high_dim_embeddings = PCA_EMBEDS

        if len(high_dim_embeddings) != len(all_ids):
            return jsonify({"error": f"Mismatch! Found {len(high_dim_embeddings)} embeddings."}), 500

        # 2. Create the target array `y` filled with -1 (Unsupervised / Unknown)
        target_labels = np.full(len(high_dim_embeddings), -1)

        # Create a fast dictionary to map pure numerical base IDs to their row indexes
        base_id_to_index = {}
        for i, cid in enumerate(all_ids):
            base_id = str(cid).split('_')[-1]
            if base_id not in base_id_to_index:
                base_id_to_index[base_id] = []
            base_id_to_index[base_id].append(i)

        # 3. Find Anchor Papers for each of the 3 topics directly via FAISS
        for topic_idx, topic_string in enumerate(topics):
            query_np = search.get_embedding(topic_string)
            _, I = search.GLOBAL_INDEX.search(query_np.reshape(1, -1).astype(np.float32), 5)

            for idx in I[0]:
                if idx != -1 and idx < len(search.GLOBAL_METADATA):
                    raw_id = str(search.GLOBAL_METADATA[idx]).split('_')[-1]

                    if raw_id in base_id_to_index:
                        for row_index in base_id_to_index[raw_id]:
                            target_labels[row_index] = topic_idx

        anchors_found = np.count_nonzero(target_labels != -1)
        print(f"[*] Starting Semi-Supervised UMAP with {anchors_found} anchored nodes...")

        # 4. Run SEMI-SUPERVISED UMAP
        reducer = umap.UMAP(n_neighbors=15, min_dist=0.1, random_state=42)
        reduced_embeddings = reducer.fit_transform(high_dim_embeddings, y=target_labels)

        # STRETCH THE TINY UMAP SPACE TO FIT YOUR MASSIVE PIXI CANVAS
        reduced_embeddings = reduced_embeddings * 25.0

        # 5. Run RECURSIVE HDBSCAN for Subclustering & Noise Reduction
        def recursive_hdbscan(embeddings, min_ratio=0.02, max_depth=2, current_depth=0, start_id=0):
            """
            Recursively applies HDBSCAN to break down massive clusters and reduce noise.
            Automatically scales min_cluster_size based on the subset size.
            """
            n_points = len(embeddings)

            # Base case: too small to cluster meaningfully
            if n_points < 5 or current_depth >= max_depth:
                return np.full(n_points, -1 if current_depth == 0 else start_id)

            # Dynamic scaling: smaller subsets get dynamically smaller minimums
            dynamic_min_cluster = max(3, min(int(n_points * min_ratio), 50))
            dynamic_min_samples = max(2, int(dynamic_min_cluster * 0.5))

            clusterer = hdbscan.HDBSCAN(min_cluster_size=dynamic_min_cluster, min_samples=dynamic_min_samples)
            local_labels = clusterer.fit_predict(embeddings)

            final_labels = np.copy(local_labels)
            unique_clusters = [lbl for lbl in np.unique(local_labels) if lbl != -1]
            current_max_id = start_id

            for cid in unique_clusters:
                mask = (local_labels == cid)
                cluster_size = np.sum(mask)

                # SUBCLUSTERING: If a cluster dominates > 30% of the dataset, recurse inside it
                if cluster_size > (n_points * 0.3) and cluster_size >= 15 and current_depth < max_depth:
                    sub_labels = recursive_hdbscan(
                        embeddings[mask],
                        min_ratio=min_ratio,
                        max_depth=max_depth,
                        current_depth=current_depth + 1,
                        start_id=current_max_id
                    )
                    final_labels[mask] = sub_labels
                    current_max_id = max(current_max_id, np.max(sub_labels) + 1)
                else:
                    final_labels[mask] = current_max_id
                    current_max_id += 1

            # NOISE REDUCTION (-1 Rescue Pass)
            if current_depth == 0:
                noise_mask = (final_labels == -1)
                if np.sum(noise_mask) > 10:
                    # Re-run on noise with extremely forgiving micro-cluster settings
                    rescue_clusterer = hdbscan.HDBSCAN(min_cluster_size=3, min_samples=1)
                    rescue_labels = rescue_clusterer.fit_predict(embeddings[noise_mask])

                    rescue_final = np.full(np.sum(noise_mask), -1)
                    for rid in np.unique(rescue_labels):
                        if rid != -1:
                            rescue_final[rescue_labels == rid] = current_max_id
                            current_max_id += 1
                    final_labels[noise_mask] = rescue_final

            return final_labels

        # Execute the recursive clustering wrapper
        cluster_labels = recursive_hdbscan(reduced_embeddings)

        # Ensure the frontend legend can properly parse the new hierarchical IDs
        def get_cluster_name(cid):
            if cid == -1:
                return "Uncategorized / Noise"
            return f"Topic Group {cid + 1}"

        # 6. Format the output for the frontend
        response_data = []
        for i, chunk_id in enumerate(all_ids):
            response_data.append({
                "chunk_id": chunk_id,
                "x": float(reduced_embeddings[i][0]),
                "y": float(reduced_embeddings[i][1]),
                "cluster": int(cluster_labels[i]),
                "cluster_name": get_cluster_name(int(cluster_labels[i]))
            })

        return jsonify(response_data)

    except Exception as e:
        import traceback
        print(f"Error in topic clustering: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/metadata-map', methods=['POST', 'GET'])
def metadata_map():
    global BASE_META
    global PCA_EMBEDS

    try:
        if BASE_META is None or PCA_EMBEDS is None:
            return jsonify({"error": "Global data arrays not loaded yet."}), 500

        field = request.args.get('field', 'method').lower().strip()
        k = int(request.args.get('k', 10))

        print(f"[*] Grouping ALL data into {k} clusters defined STRICTLY by '{field}' metadata")

        # Isolate ONLY the requested metadata
        meta_indices = []
        other_indices = []

        for i, meta in enumerate(BASE_META):
            raw_id = str(meta.get('chunk_id') or meta.get('id', '')).lower()
            m_type = str(meta.get('type', '')).lower()

            if m_type == field or (field in raw_id and 'chunk' not in raw_id):
                meta_indices.append(i)
            else:
                other_indices.append(i)

        if not meta_indices:
            return jsonify({"error": f"No anchor nodes found for metadata field '{field}'"}), 400

        k = min(k, len(meta_indices))

        # Run MiniBatchKMeans (Speed Optimization for 3 Million Embeddings)
        from sklearn.cluster import MiniBatchKMeans
        import numpy as np

        # DYNAMIC BATCHING: Scales batch size up for massive arrays to fly through the data
        batch_sz = min(10240, max(2048, len(meta_indices) // 10))
        kmeans = MiniBatchKMeans(
            n_clusters=k,
            random_state=42,
            batch_size=batch_sz,
            n_init=1,
            max_iter=10,  # Reduced to 10 max iterations for speed
            compute_labels=True
        )
        kmeans.fit(PCA_EMBEDS[meta_indices])

        # Pull ALL other data to their closest Metadata Centroid
        other_assignments = kmeans.predict(PCA_EMBEDS[other_indices])
        meta_assignments = kmeans.labels_

        # Get 2D coordinates instantly
        reduced_embeddings = PCA_EMBEDS[:, :2] * 3.0

        # Calculate the 2D canvas center for the K Metadata anchors
        k_coords_2d = []
        for i in range(k):
            points_in_k = reduced_embeddings[np.array(meta_indices)[meta_assignments == i]]
            if len(points_in_k) > 0:
                k_coords_2d.append(points_in_k.mean(axis=0))
            else:
                k_coords_2d.append(np.array([0.0, 0.0]))

        # Generate names (RAM Optimization: Sampled TF-IDF)
        meta_keywords = {}
        from sklearn.feature_extraction.text import TfidfVectorizer
        import random

        vectorizer = TfidfVectorizer(stop_words='english', max_features=10)

        for i in range(k):
            meta_texts = []
            for idx_in_meta_array, global_idx in enumerate(meta_indices):
                if meta_assignments[idx_in_meta_array] == i:
                    meta = BASE_META[global_idx]
                    text = str(meta.get('abstract') or meta.get('title') or meta.get('text') or str(meta.get('id', '')))
                    meta_texts.append(text)

            if not meta_texts or len(" ".join(meta_texts).strip()) == 0:
                meta_keywords[i] = f"{field.title()} Concept {i + 1}"
                continue

            try:
                # Cap the texts to 500 samples for faster TF-IDF text parsing
                sampled_texts = random.sample(meta_texts, min(500, len(meta_texts)))
                tfidf_matrix = vectorizer.fit_transform(sampled_texts)
                scores = tfidf_matrix.sum(axis=0).A1
                top_words = [vectorizer.get_feature_names_out()[j].upper() for j in scores.argsort()[-3:][::-1]]
                meta_keywords[i] = " • ".join(top_words)
            except Exception:
                meta_keywords[i] = f"{field.title()} Concept {i + 1}"

        # Build Response
        response_data = []

        # Output the K anchors for the UI labels
        for i in range(k):
            response_data.append({
                "chunk_id": f"synthetic_anchor_{field}_{i}",
                "type": field,
                "x": float(k_coords_2d[i][0]),
                "y": float(k_coords_2d[i][1]),
                "cluster_name": meta_keywords.get(i, f"Cluster {i}")
            })

        # Send the 'other' data back
        for idx, global_idx in enumerate(other_indices):
            raw_id = str(BASE_META[global_idx].get('chunk_id') or BASE_META[global_idx].get('id', ''))
            assigned_k_idx = other_assignments[idx]
            response_data.append({
                "chunk_id": raw_id,
                "type": 'chunk',
                "x": float(reduced_embeddings[global_idx][0]),
                "y": float(reduced_embeddings[global_idx][1]),
                "cluster_name": meta_keywords.get(assigned_k_idx, "Unknown")
            })

        # Send the defining metadata itself as chunks
        for idx, global_idx in enumerate(meta_indices):
            raw_id = str(BASE_META[global_idx].get('chunk_id') or BASE_META[global_idx].get('id', ''))
            assigned_k_idx = meta_assignments[idx]
            response_data.append({
                "chunk_id": raw_id,
                "type": 'chunk',
                "x": float(reduced_embeddings[global_idx][0]),
                "y": float(reduced_embeddings[global_idx][1]),
                "cluster_name": meta_keywords.get(assigned_k_idx, "Unknown")
            })

        return jsonify(response_data)

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


# Global variable for instant ID lookups
GLOBAL_ID_MAP = {}


@app.route('/api/subcluster', methods=['POST'])
def generate_subclusters():
    import struct
    import json
    import numpy as np

    global BASE_META, PCA_EMBEDS, GLOBAL_ID_MAP


    data = request.json or {}
    target_ids = data.get('ids', [])
    k = int(data.get('k', 3))
    method = data.get('method', 'kmeans')
    bias_text = data.get('bias_text', '').strip()

    if not target_ids or BASE_META is None:
        empty = struct.pack('<I', 2) + b'{}'
        return app.response_class(empty, mimetype='application/octet-stream')

    if not GLOBAL_ID_MAP:
        for i, meta in enumerate(BASE_META):
            raw_id = str(meta.get('chunk_id', meta.get('id', ''))).lower()
            GLOBAL_ID_MAP[raw_id] = i

    target_indices = []
    id_mapping = []

    for tid in {str(t).lower() for t in target_ids}:
        if tid in GLOBAL_ID_MAP:
            target_indices.append(GLOBAL_ID_MAP[tid])
            id_mapping.append(tid)

    target_embeddings = PCA_EMBEDS[target_indices]

    # TEXT BIAS ANCHOR RESOLUTION
    bias_anchors = []
    if bias_text:
        try:
            query_np = search.get_embedding(bias_text)
            # Fetch 15 to ensure we find intersections within this specific sub-cluster
            _, I = search.GLOBAL_INDEX.search(query_np.reshape(1, -1).astype(np.float32), 15)

            for idx in I[0]:
                if idx != -1 and idx < len(search.GLOBAL_METADATA):
                    raw_id = str(search.GLOBAL_METADATA[idx]).split('_')[-1].lower()
                    if raw_id in id_mapping:
                        local_row_idx = id_mapping.index(raw_id)
                        bias_anchors.append(local_row_idx)
        except Exception as e:
            print(f"Failed to fetch bias anchors: {e}")

    # CLUSTERING EXECUTION
    try:
        if method == 'hdbscan':
            import hdbscan
            mcs = max(2, min(50, len(target_embeddings) // k))

            if bias_anchors:
                import umap
                # Biasing HDBSCAN via Semi-Supervised UMAP
                target_labels = np.full(len(target_embeddings), -1)
                for anchor_idx in bias_anchors[:5]:
                    target_labels[anchor_idx] = 0

                reducer = umap.UMAP(n_neighbors=15, min_dist=0.1, random_state=42)
                cluster_space = reducer.fit_transform(target_embeddings, y=target_labels)
            else:
                cluster_space = target_embeddings

            clusterer = hdbscan.HDBSCAN(min_cluster_size=mcs, core_dist_n_jobs=-1)
            labels = clusterer.fit_predict(cluster_space)

        else:
            from sklearn.cluster import MiniBatchKMeans
            n_clusters = min(k, len(target_embeddings))

            if bias_anchors and n_clusters > 1:
                # Biasing K-Means via Centroid Initialization Hijacking
                init_centroids = np.zeros((n_clusters, target_embeddings.shape[1]))

                # Lock the first centroid to the closest FAISS match
                init_centroids[0] = target_embeddings[bias_anchors[0]]

                # Randomly sample the remaining K-1 centroids
                remaining_indices = np.random.choice(len(target_embeddings), n_clusters - 1, replace=False)
                init_centroids[1:] = target_embeddings[remaining_indices]

                kmeans = MiniBatchKMeans(n_clusters=n_clusters, init=init_centroids, batch_size=2048, n_init=1)
            else:
                kmeans = MiniBatchKMeans(n_clusters=n_clusters, batch_size=2048, n_init=1)

            labels = kmeans.fit_predict(target_embeddings)

    except Exception as e:
        print(f"Sub-clustering error: {e}")
        labels = np.zeros(len(target_embeddings), dtype=np.int32)

    # Encode Header Dictionary
    meta_json = json.dumps({"c": id_mapping}, separators=(',', ':')).encode('utf-8')
    padding_needed = (4 - (len(meta_json) % 4)) % 4
    meta_json += b' ' * padding_needed

    # Pack memory-aligned arrays
    bin_labels = np.array(labels, dtype=np.int32).tobytes()

    # Assemble Payload
    payload = struct.pack('<I', len(meta_json)) + meta_json + bin_labels
    return app.response_class(payload, mimetype='application/octet-stream')
ACADEMIC_JUNK = {
    "using", "based", "results", "paper", "model", "models", "approach", "method", "methods",
    "data", "dataset", "datasets", "learning", "research", "study", "studies", "new", "proposed",
    "show", "use", "used", "et", "al", "etc", "analysis", "performance", "system", "systems",
    "evaluation", "framework", "process", "development", "application", "applications",
    "novel", "efficient", "effective", "experimental", "compared", "state", "art", "work",
    "problem", "problems", "solution", "solutions", "task", "tasks", "technique", "techniques",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "first", "second", "third", "fourth", "fifth", "single", "double", "multiple",
    "zero", "hundred", "thousand", "million", "total", "average", "mean", "median",
    "year", "years", "month", "months", "time", "date", "dates", "period", "history",
    "current", "future", "past", "recent", "recently", "age", "ages", "daily", "weekly",
    "annual", "century", "decades", "decade", "day", "days", "hour", "hours", "time-series",
    "figure", "table", "page", "pages", "vol", "volume", "issue", "section", "abstract",
    "introduction", "conclusion", "references", "chapter", "appendix", "text", "graph", "chart",
    "doi", "url", "http", "https", "www", "com", "org", "net", "pdf", "html", "chunk", "chunks", "document", "documents", "cluster", "clusters",
    "isr", "tec", "fpi", "sri", "node", "metadata"
}

GLOBAL_STOP_WORDS = list(ACADEMIC_JUNK | set(ENGLISH_STOP_WORDS))


def extract_keywords_hierarchical(docs, default_name=""):
    if not docs:
        return default_name

    try:
        vec = TfidfVectorizer(
            stop_words=GLOBAL_STOP_WORDS,
            max_features=10,
            min_df=1,
            token_pattern=r'(?u)\b[a-zA-Z]{4,}\b'
        )
        X = vec.fit_transform(docs)
        scores = np.asarray(X.mean(axis=0)).ravel()
        words = np.array(vec.get_feature_names_out())
        if len(words) > 0:
            return " | ".join(words[np.argsort(scores)[::-1][:3]]).title()
    except Exception as e:
        print(f"TF-IDF Keyword extraction failed, falling back to counter: {e}")

    try:
        all_text = " ".join(docs).lower()
        words = re.findall(r'\b[a-z]{3,}\b', all_text)
        valid_words = [w for w in words if w not in GLOBAL_STOP_WORDS]

        if not valid_words:
            valid_words = words

        top_words = [w for w, c in Counter(valid_words).most_common(3)]
        if top_words:
            return " | ".join(top_words).title()
    except Exception as e:
        print(f"Counter extraction failed: {e}")

    return default_name


# In app.py


import concurrent.futures


# Make sure BASE_META and client are defined globally or imported

@app.route('/api/labels', methods=['POST'])
def generate_labels():
    data = request.json or {}
    mode = data.get('mode', 'keywords')
    clusters = data.get('clusters', {})
    tag_context = data.get('tag', None)
    bias_text = data.get('bias_text', None) or data.get('bias', None)

    result_labels = {}

    # Pre-compute meta lookup dictionary efficiently
    meta_lookup = {
        str(m.get('chunk_id') or m.get('id')).lower().strip(): m
        for m in (BASE_META or []) if (m.get('chunk_id') or m.get('id')) is not None
    }

    # Helper function to get documents for a cluster
    def get_cluster_docs(chunk_ids):
        return [meta_lookup[str(cid).lower().strip()] for cid in chunk_ids if str(cid).lower().strip() in meta_lookup]

    if mode == 'keywords':
        for path_key, chunk_ids in clusters.items():
            path_key_str = str(path_key).strip()
            docs = [d.get('text', '') for d in get_cluster_docs(chunk_ids)]
            fallback_label = f"Cluster {path_key_str}"
            result_labels[path_key_str] = extract_keywords_hierarchical(docs, default_name=fallback_label)

    elif mode in ('summary', 'summaries'):

        # Define the LLM worker function to allow parallel execution
        def generate_cluster_label(path_key, chunk_ids):
            path_key_str = str(path_key).strip()
            cluster_docs = get_cluster_docs(chunk_ids)

            if not cluster_docs:
                return path_key_str, f"Cluster {path_key_str}"

            sample_text = "\n\n".join(
                f"Title: {d.get('title', 'Unknown')}\nText: {d.get('text', '')[:800]}"
                for d in cluster_docs[:10]
            )

            system_prompt = (
                "You are a strict string generator. Generate a single plain text short descriptive label "
                "that is a MAXIMUM of 3 words long without markdown or punctuation. "
                "Do NOT use generic filler words like 'Research', 'Studies', 'Methods', 'Data', or 'Analysis'. "
            )

            if tag_context:
                system_prompt += (
                    f"Focus strictly on extracting the core '{tag_context}' used in this text. "
                    f"Do NOT repeat the word '{tag_context}'. "
                )
                # Domain-specific fix for the Methodology issue
                if tag_context.lower() == 'methodology':
                    system_prompt += (
                        "Focus strictly on instruments, equipment, algorithms, and analytical techniques. "
                        "IGNORE physical phenomena, atmospheric regions, weather events, or study targets. "
                        "GOOD EXAMPLES: 'GPS TEC', 'Incoherent Scatter Radar', 'K-Means Clustering', 'Digisonde'. "
                        "BAD EXAMPLES: 'Upper Temperatures', 'Convection Patterns', 'Auroras', 'Ionosphere'. "
                        "CRITICAL ESCAPE HATCH: If the provided texts describe many different tools and lack a single, unifying methodology, you MUST output the exact phrase 'Mixed Methods'. Do NOT output a phenomenon as a fallback."
                    )
            elif bias_text:
                system_prompt += f"Focus strictly on summarizing this content in terms of the bias/perspective: '{bias_text}'."
            else:
                system_prompt += "Focus on the most unique distinguishing entities in this cluster."

            try:
                response = client.chat.completions.create(
                    model=CHAT_MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": sample_text}
                    ]
                )

                label = response.choices[0].message.content.strip().replace('"', '').replace('*', '')
                if ":" in label:
                    label = label.split(":")[-1].strip()

                return path_key_str, label

            except Exception as e:
                print(f"[!] LM-Studio API Error on Cluster {path_key_str}: {str(e)}")
                return path_key_str, f"Cluster {path_key_str}"

        # Execute LLM calls in parallel using a ThreadPool
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(generate_cluster_label, k, v) for k, v in clusters.items()]
            for future in concurrent.futures.as_completed(futures):
                path_key_str, label = future.result()
                result_labels[path_key_str] = label

    return jsonify(result_labels)
@app.route('/api/ai-query', methods=['POST'])
def ask_screen_api():
    data = request.json or {}
    user_query = data.get('query', '').strip()
    chunk_ids = data.get('ids') or data.get('valid_ids') or []

    if not user_query:
        return jsonify({"error": "No query provided"}), 400

    if not chunk_ids:
        return jsonify({"answer": "No items are currently selected or visible on screen to analyze."})

    try:
        TARGET_K = 5
        top_matches = search.get_top_k(
            query_str=user_query,
            k=TARGET_K,
            valid_ids=chunk_ids
        )

        if not top_matches:
            return jsonify({"answer": "I couldn't find any documents on your screen that closely match that query."})

        top_ids = [str(match['id']).split('_')[-1] for match in top_matches]
        context_texts = []

        with sqlite3.connect(DB) as conn:
            cursor = conn.cursor()
            placeholders = ','.join(['?'] * len(top_ids))

            cursor.execute(f"SELECT text FROM chunks WHERE chunk_id IN ({placeholders})", top_ids)

            for (text,) in cursor.fetchall():
                if text:
                    context_texts.append(text)

        if not context_texts and 'BASE_META' in globals() and BASE_META:
            meta_lookup = {str(m.get('chunk_id') or m.get('id')).split('_')[-1]: m for m in BASE_META}
            for sid in top_ids:
                if sid in meta_lookup:
                    text = meta_lookup[sid].get('text', '')
                    if text:
                        context_texts.append(text)

        if not context_texts:
            return jsonify({"answer": "Could not retrieve text for the matched on-screen items."})

        answer = answer_from_screen_context(user_query, context_texts)
        return jsonify({"answer": answer})

    except Exception as e:
        print(f"[!] Ask Screen API Error: {str(e)}")
        return jsonify({"error": "An error occurred while analyzing the screen content."}), 500


import difflib
from flask import request, jsonify


def deduplicate_keywords(keyword_string, similarity_threshold=0.75):
    """
    Takes a string of keywords (e.g., "Ionosphere, Radar, Ionospheric")
    and removes redundant morphological variations.
    """
    # Assuming extract_keywords_hierarchical returns a comma-separated string
    words = [w.strip() for w in keyword_string.split(',') if w.strip()]

    # Sort by length so we evaluate the shorter root words first (e.g. keep "Ionosphere", drop "Ionospheric")
    words.sort(key=len)

    deduped_words = []
    for word in words:
        is_duplicate = False
        for existing in deduped_words:
            # Check if the words share a base and are highly similar
            ratio = difflib.SequenceMatcher(None, word.lower(), existing.lower()).ratio()

            # If they are very similar (e.g., > 75% match) OR one is a direct sub-word of another
            if ratio >= similarity_threshold or existing.lower() in word.lower():
                is_duplicate = True
                break

        if not is_duplicate:
            deduped_words.append(word)

    return ", ".join(deduped_words)


@app.route('/api/network-keywords', methods=['POST'])
def get_network_keywords():
    data = request.json
    node_groupings = data.get('groups', {})

    if not node_groupings:
        return jsonify({})

    #  GATHER ALL UNIQUE CHUNK IDs UPFRONT
    all_chunk_ids = set()
    for chunk_ids in node_groupings.values():
        for cid in chunk_ids:
            if cid:
                all_chunk_ids.add(str(cid).split('_')[-1])

    all_chunk_ids = list(all_chunk_ids)
    chunk_text_map = {}

    # BULK FETCH FROM DATABASE
    with sqlite3.connect(DB) as conn:
        cursor = conn.cursor()
        for i in range(0, len(all_chunk_ids), 900):
            batch = all_chunk_ids[i:i + 900]
            placeholders = ','.join(['?'] * len(batch))

            # Note: We select the ID as well so we can map it to the dictionary
            cursor.execute(f"SELECT chunk_id, text FROM chunks WHERE chunk_id IN ({placeholders})", batch)
            for row_id, text in cursor.fetchall():
                chunk_text_map[str(row_id)] = text

    # 3. ASSEMBLE TEXTS AND EXTRACT KEYWORDS IN MEMORY
    result_keywords = {}

    for group_id, chunk_ids in node_groupings.items():
        safe_ids = [str(cid).split('_')[-1] for cid in chunk_ids if cid]

        # Grab texts from our in-memory map instead of querying the DB again
        texts = [chunk_text_map[cid] for cid in safe_ids if cid in chunk_text_map]

        if texts:
            # Extract
            raw_keywords = extract_keywords_hierarchical(texts, default_name=f"Hub {group_id}")

            # Deduplicate the variations
            clean_keywords = deduplicate_keywords(raw_keywords)

            result_keywords[group_id] = clean_keywords
        else:
            result_keywords[group_id] = f"Node {group_id}"

    return jsonify(result_keywords)

@app.route('/api/graph-search', methods=['POST'])
def graph_search_api():
    """
    Receives seed nodes from the UI, queries the SQLite databases,
    and returns the GraphRAG topology.
    """
    data = request.json
    seed_ids = data.get('seed_node_ids', [])
    max_hops = data.get('max_hops', 2)

    if not seed_ids:
        return jsonify({"error": "No seed IDs provided"}), 400

    try:
        # Call the SQLite traversal function you provided
        graph_data = get_graph_from_seed_ids(seed_node_ids=seed_ids, max_hops=max_hops)
        return jsonify(graph_data), 200

    except Exception as e:
        print(f"Graph Search Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)
