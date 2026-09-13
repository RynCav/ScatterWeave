import torch
import torch.nn as nn
import numpy as np
import sqlite3
import faiss
import os
from ai_tools import get_embedding
from params import *

# -------------------------
# CONFIG & HARDWARE CORES
# -------------------------
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

embedding_dim = 1024
input_dim = 3 * embedding_dim
hidden_dim = 1024
output_dim = embedding_dim + 1

# Trajectory Physics Parameters
ALPHA = 0.8
DENSITY_BONUS = 0.10  # Increased to reward exploring dense clusters

print("[INIT] Loading global FAISS index and companion metadata tracking keys...")
GLOBAL_INDEX = faiss.read_index(INDEX) if os.path.exists(INDEX) else None
GLOBAL_METADATA = np.load("../faiss_metadata.npy", allow_pickle=True) if os.path.exists("../faiss_metadata.npy") else None

# --- PERFORMANCE CACHE ---
def get_chunk_to_paper_map():
    conn = sqlite3.connect(DB)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT chunk_id, paper_id FROM chunks")
        mapping = {f"chunk_{row[0]}": row[1] for row in cursor.fetchall()}
    except Exception:
        mapping = {}
    conn.close()
    return mapping

CHUNK_TO_PAPER_MAP = get_chunk_to_paper_map()

def get_2d_coords_map():
    conn = sqlite3.connect(DB)
    cursor = conn.cursor()
    mapping = {}
    try:
        # Load the physical UI coordinates explicitly mapped to string keys 
        cursor.execute("SELECT chunk_id, x, y FROM chunks")
        mapping = {f"chunk_{row[0]}": (row[1], row[2]) for row in cursor.fetchall()}
    except sqlite3.OperationalError:
        try:
            cursor.execute("SELECT chunk_id, x, y FROM embeddings")
            mapping = {f"chunk_{row[0]}": (row[1], row[2]) for row in cursor.fetchall()}
        except sqlite3.OperationalError:
            print("[WARN] Could not find X, Y columns in DB. UI will fallback to snapped anchors.")
    conn.close()
    return mapping

GLOBAL_COORDS_MAP = get_2d_coords_map()

# -------------------------
# GEOMETRY ENGINE
# -------------------------
def tensor_norm(x):
    return x / (torch.linalg.norm(x, dim=-1, keepdim=True) + 1e-8)

def tensor_slerp(v0, v1, t):
    dot = torch.clamp(torch.dot(v0, v1), -1.0, 1.0)
    if dot > 0.9995:
        return tensor_norm(v0 + t * (v1 - v0))
    theta_0 = torch.acos(dot)
    theta_t = theta_0 * t
    v2 = tensor_norm(v1 - dot * v0)
    return torch.cos(theta_t) * v0 + torch.sin(theta_t) * v2

# -------------------------
# MODEL ARCHITECTURE
# -------------------------
class GRUWorldModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.gru = nn.GRU(input_size=input_dim, hidden_size=hidden_dim, batch_first=True)
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 1024),
            nn.LayerNorm(1024),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(1024, output_dim)
        )

    def forward(self, x, h=None):
        x = x.unsqueeze(1)
        out, h = self.gru(x, h)
        out = out[:, -1]
        return self.head(out), h

# -------------------------
# TOURNAMENT SEARCH PIPELINE
# -------------------------
# TOURNAMENT SEARCH PIPELINE
# -------------------------
# -------------------------
# TOURNAMENT SEARCH PIPELINE
# -------------------------
def get_search(query_str, goal_str, STEPS, k, valid_ids=None):
    if GLOBAL_INDEX is None or GLOBAL_METADATA is None:
        print("[!] Index files missing.")
        return {}

    # 🛡️ SAFEGUARD 1: If goal is empty/none, return native get_top_k array directly!
    if not goal_str or not str(goal_str).strip():
        return get_top_k(query_str, k=k, valid_ids=valid_ids)

    # 1. Convert valid_ids to a fast Python string set
    valid_set = set(str(v) for v in valid_ids) if valid_ids is not None else None

    model = GRUWorldModel().to(device)
    if os.path.exists("../model.pth"):
        try:
            model.load_state_dict(torch.load("../model.pth", map_location=device, weights_only=True))
        except Exception as e:
            try:
                model.load_state_dict(torch.load("../model.pth", map_location=device))
            except Exception as e2:
                print(f"[WARN] Could not load model.pth: {e2}. Using uninitialized model.")
    model.eval()

    # 🛡️ SAFEGUARD 2: Flatten embeddings to 1D to prevent PyTorch dimension mismatch
    try:
        query_np = np.array(get_embedding(query_str), dtype=np.float32).flatten()
        goal_np = np.array(get_embedding(goal_str), dtype=np.float32).flatten()
    except Exception as e:
        print(f"[!] Embedding generation error: {e}")
        return {}

    _, q_res = GLOBAL_INDEX.search(query_np.reshape(1, -1).astype(np.float32), 1)
    _, g_res = GLOBAL_INDEX.search(goal_np.reshape(1, -1).astype(np.float32), 1)

    query_anchor = str(GLOBAL_METADATA[q_res[0][0]]) if q_res[0][0] != -1 else None
    goal_anchor = str(GLOBAL_METADATA[g_res[0][0]]) if g_res[0][0] != -1 else None

    query = tensor_norm(torch.from_numpy(query_np).float().to(device))
    goal = tensor_norm(torch.from_numpy(goal_np).float().to(device))
    context = torch.zeros(embedding_dim, device=device)

    velocity = torch.zeros_like(query)
    MOMENTUM_FACTOR = 0.65

    trajectory = [query_np.copy()]
    h = None
    explorer_stamina = 1.0

    step_documents = []
    path_anchors = []
    raw_path_coords = []
    global_seen_papers = set()

    x0 = torch.cat([query, context, goal], dim=0).unsqueeze(0)
    with torch.no_grad():
        _, h = model(x0, None)
    h = h.detach()

    def project_embedding_to_2d(emb_vector):
        if not GLOBAL_COORDS_MAP:
            return None
        _, I_proj = GLOBAL_INDEX.search(emb_vector.reshape(1, -1).astype(np.float32), 5)
        x_est, y_est, weight_sum = 0.0, 0.0, 0.0
        for rank, idx in enumerate(I_proj[0]):
            if idx != -1 and idx < len(GLOBAL_METADATA):
                unique_id = str(GLOBAL_METADATA[idx])

                lookup_key = unique_id
                if not unique_id.startswith("chunk_") and not unique_id.startswith("metadata_"):
                    lookup_key = f"chunk_{unique_id}"

                if lookup_key in GLOBAL_COORDS_MAP:
                    w = 1.0 / (float(rank) + 1.0) ** 2
                    x_est += GLOBAL_COORDS_MAP[lookup_key][0] * w
                    y_est += GLOBAL_COORDS_MAP[lookup_key][1] * w
                    weight_sum += w

        return [float(x_est / weight_sum), float(y_est / weight_sum)] if weight_sum > 0 else None

    start_2d = project_embedding_to_2d(query_np)
    if start_2d:
        raw_path_coords.append(start_2d)

    for step in range(STEPS):
        progress_decay = 1.0 - (step / max(1, STEPS))
        goal_direction = tensor_norm(goal - query)
        distance_to_goal = torch.linalg.norm(goal - query).item()

        current_query_np = query.cpu().numpy()
        cos_sim = float(np.dot(current_query_np, goal_np))
        if distance_to_goal < 0.05 or cos_sim > 0.995:
            break

        x_in = torch.cat([query, context, goal], dim=0).unsqueeze(0)
        with torch.no_grad():
            pred, h_candidate = model(x_in, h)

        pred = pred.squeeze(0)
        delta = tensor_norm(pred[:-1])
        gate = min(max(torch.sigmoid(pred[-1]).item(), 0.0), 0.5)

        ortho = delta - (torch.dot(delta, goal_direction) * goal_direction)
        wave = float(np.sin(step * 0.5))
        exploration_vector = tensor_norm(delta + (1.2 + 0.8 * wave) * tensor_norm(ortho))

        line_explorer = tensor_slerp(query, exploration_vector, 0.05 + (0.05 * gate))
        guided_delta = tensor_slerp(delta, goal_direction, 0.5)
        line_scout = tensor_slerp(query, guided_delta, 0.04 + (0.04 * gate))
        line_tractor = tensor_slerp(query, goal_direction, 0.03 + (0.02 * gate))

        dist_explorer = torch.linalg.norm(line_explorer - goal).item()
        dist_scout = torch.linalg.norm(line_scout - goal).item()
        dist_tractor = torch.linalg.norm(line_tractor - goal).item()

        score_explorer = dist_explorer - (1.0 * progress_decay * distance_to_goal * explorer_stamina)
        score_scout = dist_scout
        score_tractor = dist_tractor * (2.0 * progress_decay * (1.0 / (distance_to_goal + 1e-5)))

        scores = [score_explorer, score_scout, score_tractor]
        candidates = [line_explorer, line_scout, line_tractor]
        winner_idx = int(np.argmin(scores))

        desired_next_pos = candidates[winner_idx]
        if winner_idx != 2:
            h = h_candidate.detach()

        if winner_idx == 0:
            explorer_stamina = max(0.0, explorer_stamina - 0.40)
        else:
            explorer_stamina = min(1.0, explorer_stamina + 0.30)

        desired_direction = tensor_norm(desired_next_pos - query)
        velocity = tensor_norm((MOMENTUM_FACTOR * velocity) + ((1.0 - MOMENTUM_FACTOR) * desired_direction))

        actual_step_size = float(torch.linalg.norm(desired_next_pos - query).item())
        query = tensor_norm(query + actual_step_size * velocity)

        q_np = query.cpu().numpy().reshape(1, -1).astype(np.float32)
        _, raw_neighbors = GLOBAL_INDEX.search(q_np, 1)
        closest_idx = int(raw_neighbors[0][0])

        if closest_idx != -1 and closest_idx < GLOBAL_INDEX.ntotal:
            try:
                # 🛡️ SAFEGUARD 3: Prevent FAISS RuntimeError on unsupported index reconstructs
                raw_vec = GLOBAL_INDEX.reconstruct(closest_idx)
                raw_vec = raw_vec / (np.linalg.norm(raw_vec) + 1e-8)
                closest_real_emb = torch.from_numpy(raw_vec).to(device)
                query = tensor_slerp(query, closest_real_emb, 0.15 * min(1.0, distance_to_goal))
            except Exception:
                pass

        context = tensor_slerp(context, query, 1.0 - ALPHA)
        current_state_np = query.cpu().numpy().flatten().astype(np.float32)

        pool_size = max(k * 150, 2000)
        _, I = GLOBAL_INDEX.search(current_state_np.reshape(1, -1), min(pool_size, GLOBAL_INDEX.ntotal))

        step_chunks = []
        best_anchor = None

        for idx in I[0]:
            if idx != -1 and idx < len(GLOBAL_METADATA):
                unique_id = str(GLOBAL_METADATA[idx])

                if valid_set is not None:
                    raw_integer = unique_id.split('_')[-1] if '_' in unique_id else unique_id
                    if unique_id not in valid_set and raw_integer not in valid_set:
                        continue

                if best_anchor is None:
                    best_anchor = unique_id

                if unique_id not in global_seen_papers:
                    step_chunks.append(unique_id)
                    global_seen_papers.add(unique_id)

                if len(step_chunks) == k:
                    break

        if best_anchor is not None:
            path_anchors.append(best_anchor)
            step_documents.append(step_chunks)

        coord_2d = project_embedding_to_2d(current_state_np)
        if coord_2d:
            raw_path_coords.append(coord_2d)

        trajectory.append(current_state_np.copy())

    final_distance = torch.linalg.norm(goal - query).item()
    if final_distance > 0.05:
        micro_steps = int(final_distance / 0.04)
        for i in range(1, micro_steps + 1):
            t = i / float(micro_steps)
            micro_query = tensor_slerp(query, goal, t)
            micro_2d = project_embedding_to_2d(micro_query.cpu().numpy().astype(np.float32))
            if micro_2d:
                raw_path_coords.append(micro_2d)

    goal_2d = project_embedding_to_2d(goal_np)
    if goal_2d:
        raw_path_coords.append(goal_2d)

    def smooth_path(coords, passes=3):
        if len(coords) < 3: return coords
        smoothed = coords.copy()
        for _ in range(passes):
            temp = [smoothed[0]]
            for i in range(1, len(smoothed) - 1):
                avg_x = (smoothed[i - 1][0] + smoothed[i][0] + smoothed[i + 1][0]) / 3.0
                avg_y = (smoothed[i - 1][1] + smoothed[i][1] + smoothed[i + 1][1]) / 3.0
                temp.append([avg_x, avg_y])
            temp.append(smoothed[-1])
            smoothed = temp
        return smoothed

    final_smooth_coords = smooth_path(raw_path_coords)

    return {
        "query_anchor": query_anchor,
        "goal_anchor": goal_anchor,
        "path_anchors": path_anchors,
        "path_coords": final_smooth_coords,
        "step_documents": step_documents
    }
# ---------------------------------------------------------
# DIRECT FALLBACK SEARCH (WIDENED & SELF-MATCH SAFE)
# ---------------------------------------------------------
def get_top_k(query_str, k=30, valid_ids=None, ignore_id=None):
    if GLOBAL_INDEX is None or GLOBAL_METADATA is None:
        print("[!] Index files missing.")
        return []

    # 1. Clean ignore_id to prevent "self-matching" the dot you just clicked
    ignore_clean = str(ignore_id).split('_')[-1] if ignore_id is not None else None
    ignore_full = str(ignore_id) if ignore_id is not None else None

    # 2. Convert valid_ids for O(1) lookup
    valid_set = None
    valid_integers = None
    if valid_ids is not None:
        valid_set = set(str(v) for v in valid_ids)
        valid_integers = set(str(v).split('_')[-1] for v in valid_ids)

        # 🛡️ SMART SAFEGUARD: If valid_ids only contains the dot you clicked,
        # we bypass the filter entirely! Otherwise, you'd be trapped with 0 results.
        if len(valid_set) == 1 and (ignore_full in valid_set or ignore_clean in valid_integers):
            print("[WARN] valid_ids only contained ignore_id. Bypassing filter to widen search.")
            valid_set = None
            valid_integers = None

    # 3. Generate embedding and shape for FAISS
    query_embedding = get_embedding(query_str).reshape(1, -1).astype(np.float32)

    # 4. MASSIVE OVER-FETCH: Pull up to 50x 'k' (or at least 2000 nodes) from FAISS.
    # This guarantees we find nearby neighbors even in very dense, specific clusters.
    pool_size = min(max(k * 50, 2000), GLOBAL_INDEX.ntotal)
    distances, indices = GLOBAL_INDEX.search(query_embedding, pool_size)

    results = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx == -1:
            continue

        unique_id = str(GLOBAL_METADATA[idx])
        raw_integer = unique_id.split('_')[-1] if '_' in unique_id else unique_id

        # 5. SKIP SELF: Ignore the exact node you clicked on so you get new neighbors
        if ignore_clean is not None and (unique_id == ignore_full or raw_integer == ignore_clean):
            continue

        # 6. Apply dual-format set filtering
        if valid_set is not None:
            if unique_id not in valid_set and raw_integer not in valid_integers:
                continue

        results.append({
            "id": unique_id,
            "score": float(dist)
        })

        # 7. Stop as soon as we collect the requested amount of unique neighbors
        if len(results) >= k:
            break

    return results