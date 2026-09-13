import sqlite3
from typing import List, Dict, Any, Optional, Tuple, Union

# Adjust the import names below to match your variables in params (e.g., DB_1, DB_2 or a list DBS)
from params import DB


def get_graph_from_seed_ids(
    seed_node_ids: List[Union[str, int]],
    max_hops: int = 2,
    border_rel_type: Optional[str] = None,
    db_paths: Tuple[str, ...] = (DB, "C:/Users/ryanc/OneDrive/Desktop/research_viewer/amirs.db")
) -> Dict[str, Any]:
    """
    Performs a local neighborhood graph search using index-backed SQLite tables
    (graph_nodes, graph_edges) across multiple databases, starting directly from known node IDs.

    Tracks structural borders (internal vs. border connections) and hop orders.

    Args:
        seed_node_ids (List[Union[str, int]]): A list of starting node IDs to seed the graph search.
        max_hops (int, optional): The maximum number of traversal hops from the seed nodes. Defaults to 2.
        border_rel_type (Optional[str], optional): A specific relationship type to filter edges by. Defaults to None.
        db_paths (Tuple[str, ...], optional): File paths to the SQLite databases to query.
            Defaults to (DB, "C:/Users/ryanc/OneDrive/Desktop/research_viewer/amirs.db").

    Returns:
        Dict[str, Any]: A dictionary containing:
            - "nodes" (List[Dict[str, Any]]): Metadata for all visited nodes.
            - "edges" (List[Dict[str, Any]]): Details of all edges traversed.
            - "context" (str): A generated text summary of the traversal results.
    """
    if not seed_node_ids:
        return {"nodes": [], "edges": [], "context": "No seed node IDs provided."}

    # Clean deduplication while preserving order
    unique_seed_ids = list(dict.fromkeys(seed_node_ids))

    # Open connections to all target databases
    conns = []
    for path in db_paths:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conns.append(conn)

    # ----------------------------------------------------
    # 1. FETCH SEED NODES BY ID ACROSS ALL DBs
    # ----------------------------------------------------
    placeholders = ",".join(["?"] * len(unique_seed_ids))
    seed_rows = []

    for conn in conns:
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT DISTINCT node_id, entity_type, name, description
            FROM graph_nodes
            WHERE node_id IN ({placeholders})
        """, unique_seed_ids)
        seed_rows.extend(cursor.fetchall())

    if not seed_rows:
        for conn in conns:
            conn.close()
        return {
            "nodes": [],
            "edges": [],
            "context": "Provided seed node IDs did not match any records in graph_nodes."
        }

    # Map to track all loaded nodes and their metadata (deduplicated by node_id)
    visited_nodes = {row["node_id"]: dict(row) for row in seed_rows}
    seed_set = set(visited_nodes.keys())

    # Track unique edges: key = (source, target, rel_type), value = edge_dict
    edges_map = {}
    current_frontier = list(seed_set)

    # Optional SQL filter if you only want a specific relationship type (e.g., 'BORDERS')
    rel_filter_sql = " AND relationship_type = ?" if border_rel_type else ""
    rel_params = [border_rel_type] if border_rel_type else []

    # ----------------------------------------------------
    # 2. LOCAL NEIGHBORHOOD TRAVERSAL (Hop Expansion)
    # ----------------------------------------------------
    for hop in range(1, max_hops + 1):
        if not current_frontier:
            break

        placeholders = ",".join(["?"] * len(current_frontier))
        query_params = current_frontier * 2 + rel_params

        # Fetch edges connected to the current frontier across all DBs
        hop_edges = []
        for conn in conns:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT source, target, relationship_type, weight
                FROM graph_edges
                WHERE (source IN ({placeholders}) OR target IN ({placeholders}))
                {rel_filter_sql}
            """, query_params)
            hop_edges.extend(cursor.fetchall())

        next_frontier = set()

        for edge in hop_edges:
            src = edge["source"]
            tgt = edge["target"]
            rel = edge["relationship_type"]
            weight = edge["weight"]

            edge_key = (src, tgt, rel)

            # Classify the connection border type for the frontend
            is_src_in = src in visited_nodes
            is_tgt_in = tgt in visited_nodes

            if is_src_in and is_tgt_in:
                connection_type = "internal"  # Connection between already-known nodes
            else:
                connection_type = "border"  # Edge crossing from known node to the frontier

            # Add edge if we haven't seen it yet
            if edge_key not in edges_map:
                edges_map[edge_key] = {
                    "source": src,
                    "target": tgt,
                    "rel_type": rel,
                    "weight": weight,
                    "hop_order": hop,
                    "border_type": connection_type
                }

            # Queue undiscovered nodes for the next frontier
            if not is_src_in:
                next_frontier.add(src)
            if not is_tgt_in:
                next_frontier.add(tgt)

        if not next_frontier:
            break

        # Fetch metadata for newly discovered border nodes across all DBs
        new_placeholders = ",".join(["?"] * len(next_frontier))
        new_nodes = []
        for conn in conns:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT node_id, entity_type, name, description
                FROM graph_nodes
                WHERE node_id IN ({new_placeholders})
            """, list(next_frontier))
            new_nodes.extend(cursor.fetchall())

        current_frontier = []

        for row in new_nodes:
            nid = row["node_id"]
            # Deduplicate in case the exact same node exists in both databases
            if nid not in visited_nodes:
                visited_nodes[nid] = dict(row)
                current_frontier.append(nid)

    # Clean up database connections
    for conn in conns:
        conn.close()

    # ----------------------------------------------------
    # 3. FORMAT RESULTS FOR THE FLASK API / UI
    # ----------------------------------------------------
    formatted_nodes = list(visited_nodes.values())

    # Guarantee both endpoints exist in our node list before sending to UI
    formatted_edges = [
        e for e in edges_map.values()
        if e["source"] in visited_nodes and e["target"] in visited_nodes
    ]

    # Build clear summary context for the LLM / UI
    internal_count = sum(1 for e in formatted_edges if e["border_type"] == "internal")
    border_count = sum(1 for e in formatted_edges if e["border_type"] == "border")

    context_lines = [
        f"Graph Traversal Summary (Max Hops: {max_hops}):",
        f"- Total Nodes Loaded: {len(formatted_nodes)} (Seeds: {len(seed_set)}, Discovered: {len(formatted_nodes) - len(seed_set)})",
        f"- Total Connections: {len(formatted_edges)} ({internal_count} internal seed-to-seed, {border_count} border expansions)",
        "\nKey Entities Highlight:"
    ]

    for node in formatted_nodes[:15]:
        tag = "SEED" if node["node_id"] in seed_set else "DISCOVERED"
        context_lines.append(
            f"- [{tag} | {node['entity_type'].upper()}] {node['name']}: {node['description']}"
        )

    return {
        "nodes": formatted_nodes,
        "edges": formatted_edges,
        "context": "\n".join(context_lines)
    }