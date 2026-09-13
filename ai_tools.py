import numpy as np
from typing import List, Union
from openai import OpenAI
from sklearn.cluster import HDBSCAN
from umap import UMAP
from params import lm_URL
# Assuming EMBED_MODEL and CHAT_MODEL are defined in params
from params import *

client = OpenAI(
    base_url= lm_URL,
    api_key="lm-studio"
)


def get_embedding(text: str) -> np.ndarray:
    """
    Retrieves the text embedding for a given string using the configured model.

    Args:
        text (str): The input text to embed. Truncates at 4000 characters.

    Returns:
        np.ndarray: A 1D numpy array representing the text embedding.
    """
    response = client.embeddings.create(model=EMBED_MODEL, input=text[:4000])
    return np.array(response.data[0].embedding)


def summarize_paper_topics(papers: List[str]) -> str:
    """
    Identifies the single overarching research topic from a list of paper titles.

    Args:
        papers (List[str]): A list of research paper titles.

    Returns:
        str: A short phrase (5-10 words) summarizing the common research topic.
    """
    prompt = "Find the common research topic among these papers:\n\n"
    for title in papers:
        prompt += f"- {title}\n"

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert research assistant. "
                    "Given a list of paper titles, identify the single overarching "
                    "research topic in a short phrase (5-10 words)."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ]
    )
    return response.choices[0].message.content


def compare(topic: str, old_topic: str) -> int:
    """
    Compares two research topics to determine if they are essentially the same.

    Args:
        topic (str): The first topic to compare.
        old_topic (str): The second topic to compare against.

    Returns:
        int: 1 if the topics are the same, 0 if they are different.

    Raises:
        ValueError: If the LLM returns anything other than '0' or '1'.
    """
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "Return ONLY '0' or '1'. "
                    "1 means the research topics are essentially the same. "
                    "0 means they are different."
                )
            },
            {
                "role": "user",
                "content": f"Topic 1: {topic}\nTopic 2: {old_topic}"
            }
        ]
    )

    result = response.choices[0].message.content.strip()

    if result not in {"0", "1"}:
        raise ValueError(f"Unexpected model output: {result}")

    return int(result)


def summarize_chunk(text: str) -> str:
    """
    Summarizes an individual text chunk using the LLM.

    Args:
        text (str): The raw text chunk to summarize.

    Returns:
        str: A simple heading-style summary of the chunk.
    """
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Return the steps as a simple heading. Do not use sub-numbering, "
                    "do not use colons for list items, and do not nest numbers inside numbers."
                )
            },
            {
                "role": "user",
                "content": text
            }
        ],
        temperature=0.3  # Lower temperature for more factual/consistent summarization
    )
    return response.choices[0].message.content


def generate_summary_from_chunks(chunks: List[str]) -> str:
    """
    Aggregates multiple text chunks, summarizes them individually, and synthesizes
    a final, one-sentence academic summary.

    Args:
        chunks (List[str]): A list of text chunks extracted from a paper.

    Returns:
        str: A single-sentence summary of the entire paper, or an error/fallback string.
    """
    partial_summaries = []

    for i, chunk in enumerate(chunks):
        try:
            partial_summary = summarize_chunk(chunk)
            if partial_summary and partial_summary.strip():
                partial_summaries.append(partial_summary.strip())
        except Exception as e:
            print(f"Chunk summary failed at index {i}:", e)

    if not partial_summaries:
        return "No summary generated."

    combined = "\n\n".join(partial_summaries)

    try:
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert academic synthesiser. "
                        "Create a concise academic paper summary that is exactly one sentence long. "
                        "CRITICAL: Output ONLY the plain text sentence. Do not include any introductory phrases, "
                        "do not use markdown formatting (like asterisks or bolding), do not use numbers, "
                        "and do not use bullet points."
                    )
                },
                {
                    "role": "user",
                    "content": combined[:6000]  # Ensuring we don't exceed context limits
                }
            ]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print("Final synthesis API call failed:", e)
        return "Error generating final summary synthesis."


def select_representative_chunks(chunks: List[str], embeddings: Union[List[np.ndarray], np.ndarray], top_k: int = 5) -> \
List[str]:
    """
    Selects the text chunks that are semantically closest to the overall centroid
    of the document's embeddings.

    Args:
        chunks (List[str]): The original text chunks.
        embeddings (Union[List[np.ndarray], np.ndarray]): The embeddings corresponding to the chunks.
        top_k (int, optional): The number of top representative chunks to return. Defaults to 5.

    Returns:
        List[str]: The top_k text chunks closest to the centroid.
    """
    centroid = np.mean(embeddings, axis=0)
    similarities = []

    for emb in embeddings:
        sim = np.dot(emb, centroid) / (np.linalg.norm(emb) * np.linalg.norm(centroid))
        similarities.append(sim)

    ranked_indices = np.argsort(similarities)[::-1]

    selected = []
    for idx in ranked_indices[:top_k]:
        selected.append(chunks[idx])

    return selected


def get_chunk_embeddings(chunks: List[str]) -> np.ndarray:
    """
    Retrieves embeddings for a list of text chunks.

    Args:
        chunks (List[str]): The text chunks to embed.

    Returns:
        np.ndarray: A 2D numpy array where each row is the embedding of a chunk.
    """
    chunk_embeddings = []
    for chunk in chunks:
        emb = get_embedding(chunk)
        if emb is not None:
            chunk_embeddings.append(emb)

    return np.array(chunk_embeddings)


def get_paper_embedding(chunks_embeddings: Union[List[np.ndarray], np.ndarray]) -> np.ndarray:
    """
    Calculates the overall paper embedding by averaging its chunk embeddings.

    Args:
        chunks_embeddings (Union[List[np.ndarray], np.ndarray]): The embeddings of the paper's chunks.

    Returns:
        np.ndarray: A 1D numpy array representing the mean embedding of the paper.
    """
    return np.mean(chunks_embeddings, axis=0)


def get_representative_chunk_embeddings(chunks: List[str], chunk_embeddings: Union[List[np.ndarray], np.ndarray]) -> \
List[str]:
    """
    Convenience wrapper to retrieve the most representative text chunks.

    Note: Despite the name, this returns the actual text chunks, not the embeddings.

    Args:
        chunks (List[str]): The original text chunks.
        chunk_embeddings (Union[List[np.ndarray], np.ndarray]): The embeddings of the chunks.

    Returns:
        List[str]: Up to 5 of the most representative text chunks.
    """
    return select_representative_chunks(chunks, chunk_embeddings, top_k=min(5, len(chunks)))


def reduce_dims(embeddings: Union[List[np.ndarray], np.ndarray]) -> np.ndarray:
    """
    Reduces the dimensionality of embeddings to 2D using UMAP for visualization or clustering.

    Args:
        embeddings (Union[List[np.ndarray], np.ndarray]): The high-dimensional embeddings.

    Returns:
        np.ndarray: A 2D numpy array of the reduced embeddings.
    """
    reducer = UMAP(
        n_components=2,
        metric="cosine",
        n_neighbors=min(15, len(embeddings) - 1)
    )
    return reducer.fit_transform(embeddings)


def cluster_papers(embeddings: Union[List[np.ndarray], np.ndarray]) -> np.ndarray:
    """
    Clusters paper embeddings using the HDBSCAN algorithm.

    Args:
        embeddings (Union[List[np.ndarray], np.ndarray]): The embeddings to cluster (usually 2D or native).

    Returns:
        np.ndarray: An array of cluster labels assigned to each paper (-1 indicates noise).
    """
    clusterer = HDBSCAN(
        min_cluster_size=2,
        min_samples=1,
        cluster_selection_epsilon=0.0  # Default but good practice to expose if needed
    )
    labels = clusterer.fit_predict(embeddings)
    return labels


def answer_from_screen_context(query: str, context_chunks: List[str]) -> str:
    """
    Takes a user question and a list of retrieved on-screen text chunks,
    querying the LLM to answer using ONLY the provided context.

    Args:
        query (str): The user's question.
        context_chunks (List[str]): The reference documents/chunks currently on screen.

    Returns:
        str: The generated answer based on the provided text.
    """
    combined_context = "\n\n---\n\n".join(context_chunks)

    system_prompt = (
        "You are an expert research assistant. Answer the user's question "
        "using ONLY the provided reference text from the currently visible on-screen documents. "
        "If the answer cannot be found in the text, state that clearly."
    )

    user_prompt = f"Reference Documents:\n{combined_context}\n\nUser Question: {query}"

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2  # Low temperature keeps answers factual to the provided text
    )

    return response.choices[0].message.content.strip()