import { state } from '../core/state.js';
import { getClusterColor, getSubClusterColor, getTagRegionColor, getTagSubClusterColor} from '../clusters/color.js';
import { buildKeywordNetwork } from '../clusters/labels.js';

import {updateLegend} from "../components/global_legend.js";
let rootNode = null;
let draggedNode = null;
let selectedNode = null;
let dropTargetNode = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastDataRef = null;
let DSCALE = 1;

// Network variables
let nodeToNodeLinks = [];
let currentLeafNodes = [];

const NODE_WIDTH = 180;
const NODE_HEIGHT = 55;


/**
 * Calculates the dynamic dimensions for a given node[cite: 1].
 * @requires node - A valid hierarchy node object or null[cite: 1].
 * @ensures Returns a larger width and height ({ w: 180 * DSCALE, h: 55 * DSCALE }) if the node is the root, otherwise returns standard dimensions[cite: 1].
 * @param {Object} node - The node object being evaluated[cite: 1].
 * @returns {{w: number, h: number}} The width and height object for the node[cite: 1].
 */
function getNodeSize(node) {
    if (node && node.id === 'root') {
        return { w: NODE_WIDTH * DSCALE, h: NODE_HEIGHT * DSCALE };
    }
    return { w: NODE_WIDTH, h: NODE_HEIGHT };
}


/**
 * Maps a world X coordinate to a screen X coordinate using the global transform state[cite: 1].
 * @ensures Returns the scaled and translated X coordinate based on state.transform[cite: 1].
 * @param {number} x - The world X coordinate[cite: 1].
 * @returns {number} The transformed screen X coordinate[cite: 1].
 */
function hMapX(x) {
    const k = state.transform ? state.transform.k : 1;
    const tx = state.transform ? state.transform.x : 0;
    return (x * k) + tx;
}


/**
 * Maps a world Y coordinate to a screen Y coordinate using the global transform state[cite: 1].
 * @ensures Returns the scaled and translated Y coordinate based on state.transform[cite: 1].
 * @param {number} y - The world Y coordinate[cite: 1].
 * @returns {number} The transformed screen Y coordinate[cite: 1].
 */
function hMapY(y) {
    const k = state.transform ? state.transform.k : 1;
    const ty = state.transform ? state.transform.y : 0;
    return (y * k) + ty;
}


/**
 * Inverts a screen X coordinate back to a world X coordinate[cite: 1].
 * @ensures Reverses the scale and translation applied by the current state.transform[cite: 1].
 * @param {number} screenX - The screen X coordinate[cite: 1].
 * @returns {number} The inverted world X coordinate[cite: 1].
 */
function hInvertX(screenX) {
    const k = state.transform ? state.transform.k : 1;
    const tx = state.transform ? state.transform.x : 0;
    return (screenX - tx) / k;
}


/**
 * Inverts a screen Y coordinate back to a world Y coordinate[cite: 1].
 * @ensures Reverses the scale and translation applied by the current state.transform[cite: 1].
 * @param {number} screenY - The screen Y coordinate[cite: 1].
 * @returns {number} The inverted world Y coordinate[cite: 1].
 */
function hInvertY(screenY) {
    const k = state.transform ? state.transform.k : 1;
    const ty = state.transform ? state.transform.y : 0;
    return (screenY - ty) / k;
}


/**
 * Converts a hexadecimal color string to an RGBA format string[cite: 1].
 * @requires hex - A valid 3, 4, 6, or 7-character hex color string[cite: 1].
 * @requires alpha - A numerical alpha transparency value[cite: 1].
 * @ensures Returns a correctly formatted `rgba(r, g, b, a)` string, defaulting NaN values to 0[cite: 1].
 * @param {string} hex - The hex color code[cite: 1].
 * @param {number} alpha - The alpha transparency level[cite: 1].
 * @returns {string} The resulting RGBA string[cite: 1].
 */
function hexToRgba(hex, alpha) {
    let r = 0, g = 0, b = 0;
    hex = hex.replace('#', '');
    if (hex.length === 6 || hex.length === 7) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex.substring(0, 1).repeat(2), 16);
        g = parseInt(hex.substring(1, 2).repeat(2), 16);
        b = parseInt(hex.substring(2, 3).repeat(2), 16);
    }
    if(isNaN(r)) r = 0; if(isNaN(g)) g = 0; if(isNaN(b)) b = 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


/**
 * Assigns radial layout coordinates to all nodes in the tree[cite: 1].
 * @requires root - The root node of the tree hierarchy[cite: 1].
 * @ensures Recursively counts leaf nodes and assigns x and y radial coordinates to each node based on its depth and leaf count[cite: 1].
 * @param {Object} root - The root node[cite: 1].
 */
function layoutTree(root) {
    const RADIUS_STEP = 280;
    const CENTER_X = 400;
    const CENTER_Y = 400;

    function countLeaves(node) {
        if (!node.children || node.children.length === 0 || node.collapsed) {
            node.leafCount = 1;
        } else {
            node.leafCount = node.children.reduce((sum, child) => sum + countLeaves(child), 0);
        }
        return node.leafCount;
    }

    function assignRadialCoords(node, depth, startAngle, endAngle) {
        const size = getNodeSize(node);

        if (depth === 0) {
            node.x = CENTER_X - (size.w / 2);
            node.y = CENTER_Y - (size.h / 2);
        } else {
            const angle = (startAngle + endAngle) / 2;
            const radius = depth * RADIUS_STEP;
            node.x = CENTER_X + radius * Math.cos(angle) - (size.w / 2);
            node.y = CENTER_Y + radius * Math.sin(angle) - (size.h / 2);
        }

        if (node.children && node.children.length > 0 && !node.collapsed) {
            let currentAngle = startAngle;
            const totalLeaves = node.leafCount;
            const angleSpan = endAngle - startAngle;

            node.children.forEach(child => {
                const childSpan = (child.leafCount / totalLeaves) * angleSpan;
                assignRadialCoords(child, depth + 1, currentAngle, currentAngle + childSpan);
                currentAngle += childSpan;
            });
        }
    }

    countLeaves(root);
    assignRadialCoords(root, 0, 0, Math.PI * 2);
}


/**
 * Generates a network of keyword links between leaf nodes[cite: 1].
 * @requires The application state must be in 'hNetwork' mode and rootNode must exist[cite: 1].
 * @ensures Populates nodeToNodeLinks with edges and shared keywords calculated from shared cluster depths among leaf nodes[cite: 1].
 */
export function updateKeywordNetwork() {
    if (state.viewMode !== 'hNetwork' && state.allData !== 'hNetwork') {
        nodeToNodeLinks = [];
        return;
    }

    if (!rootNode) return;

    currentLeafNodes = [];
    function getLeaves(node) {
        if (!node.children || node.children.length === 0 || node.collapsed) {
            currentLeafNodes.push(node);
        } else {
            node.children.forEach(getLeaves);
        }
    }
    getLeaves(rootNode);

    if (currentLeafNodes.length <= 1) {
        nodeToNodeLinks = [];
        return;
    }

    const keywordData = buildKeywordNetwork(currentLeafNodes);
    const keywordToDocs = {};
    const keywordLabels = {};

    keywordData.nodes.forEach(n => {
        if (n.type === 'keyword') {
            keywordLabels[n.id] = n.label;
        }
    });

    keywordData.links.forEach(l => {
        if (!keywordToDocs[l.target]) keywordToDocs[l.target] = [];
        keywordToDocs[l.target].push(l.source);
    });

    const edgeMap = new Map();
    const totalLeaves = currentLeafNodes.length;
    const maxAllowedNodes = Math.max(4, Math.ceil(totalLeaves * 0.50));

    Object.keys(keywordToDocs).forEach(kwId => {
        const docs = keywordToDocs[kwId];
        if (docs.length > maxAllowedNodes) return;

        const kwLabel = keywordLabels[kwId];

        for (let i = 0; i < docs.length; i++) {
            for (let j = i + 1; j < docs.length; j++) {
                const d1 = docs[i];
                const d2 = docs[j];
                const edgeId = d1 < d2 ? `${d1}::${d2}` : `${d2}::${d1}`;

                if (!edgeMap.has(edgeId)) {
                    const parts1 = String(d1).split('-');
                    const parts2 = String(d2).split('-');
                    let sharedDepth = 0;

                    for (let k = 0; k < Math.min(parts1.length, parts2.length); k++) {
                        if (parts1[k] === parts2[k] && parts1[k] !== 'root') {
                            sharedDepth++;
                        } else {
                            break;
                        }
                    }

                    edgeMap.set(edgeId, {
                        id: edgeId,
                        source: d1 < d2 ? d1 : d2,
                        target: d1 < d2 ? d2 : d1,
                        keywords: new Set(),
                        rawWeight: 0,
                        multiplier: 1 + (sharedDepth * 0.5)
                    });
                }

                if (kwLabel) {
                    const edge = edgeMap.get(edgeId);
                    edge.keywords.add(kwLabel);
                    edge.rawWeight += 1;
                }
            }
        }
    });

    const nodeConnections = {};
    Array.from(edgeMap.values()).forEach(edge => {
        edge.finalScore = edge.rawWeight * edge.multiplier;
        if (!nodeConnections[edge.source]) nodeConnections[edge.source] = [];
        if (!nodeConnections[edge.target]) nodeConnections[edge.target] = [];
        nodeConnections[edge.source].push(edge);
        nodeConnections[edge.target].push(edge);
    });

    const finalEdges = new Set();
    Object.keys(nodeConnections).forEach(nodeId => {
        const sortedEdges = nodeConnections[nodeId].sort((a, b) => b.finalScore - a.finalScore);
        sortedEdges.slice(0, 3).forEach(edge => finalEdges.add(edge));
    });

    nodeToNodeLinks = Array.from(finalEdges).map(edge => ({
        source: edge.source,
        target: edge.target,
        keywords: Array.from(edge.keywords)
    }));
}


/**
 * Retrieves the base color for a primary cluster ID[cite: 1].
 * @ensures Returns "#9ca3af" for noise (-1), otherwise attempts to fetch the color via getClusterColor[cite: 1].
 * @param {number|string} cId - The cluster ID[cite: 1].
 * @returns {string} The resolved hex color string[cite: 1].
 */
function resolveClusterColor(cId) {
    if (cId === -1 || cId === "-1") return "#9ca3af";
    try {
        if (typeof getClusterColor === "function") return getClusterColor(cId);
        if (typeof window.getClusterColor === "function") return window.getClusterColor(cId);
    } catch(e) {}
    return "#3b82f6";
}


/**
 * Retrieves the color for a specific sub-cluster[cite: 1].
 * @ensures Returns "#9ca3af" for noise (-1), attempts to use getSubClusterColor, and falls back to the parentColor if undefined[cite: 1].
 * @param {number|string} cId - The parent cluster ID[cite: 1].
 * @param {string} nextPath - The path identifier for the sub-cluster[cite: 1].
 * @param {string} parentColor - The fallback color of the parent node[cite: 1].
 * @param {number|string} token - The specific sub-cluster token[cite: 1].
 * @returns {string} The resolved hex color string[cite: 1].
 */
function resolveSubClusterColor(cId, nextPath, parentColor, token) {
    if (token === -1 || token === "-1") return "#9ca3af";
    let nextColor = null;

    try {
        if (typeof getSubClusterColor === "function") {
            nextColor = getSubClusterColor(cId, nextPath);
            if (!nextColor || nextColor.includes("undefined")) {
                nextColor = getSubClusterColor(parentColor, parseInt(token));
            }
        } else if (typeof window.getSubClusterColor === "function") {
            nextColor = window.getSubClusterColor(cId, nextPath);
            if (!nextColor || nextColor.includes("undefined")) {
                nextColor = window.getSubClusterColor(parentColor, parseInt(token));
            }
        }
    } catch(e) {}

    if (!nextColor || nextColor === "#9ca3af" || nextColor.includes("undefined")) {
        nextColor = parentColor;
    }
    return nextColor;
}


/**
 * Initializes the entire hierarchy tree from the current dataset[cite: 1].
 * @requires state.filteredData or state.allData to contain document entries[cite: 1].
 * @ensures Constructs rootNode and all children based on either metadata tags or standard clusters, then triggers layout and networking[cite: 1].
 */
export function initHierarchy() {
    rootNode = null;
    const currentData = state.filteredData && state.filteredData.length > 0 ? state.filteredData : state.allData;

    const createNode = (id, label, color = "#4b5563", count = 0, text = "") => ({
        id, label, title: label, color, count, text, x: 0, y: 0, collapsed: false, severed: false, children: []
    });

    if (!currentData || currentData.length === 0) {
        rootNode = createNode('root', 'All Documents', '#111827', 0);
        layoutTree(rootNode);
        updateKeywordNetwork();
        return;
    }

    // ==========================================
    // METADATA TAG HIERARCHY LOGIC
    // ==========================================
    if (state.colorByMetadata) {
        const tagSubPathsMap = new Map();
        const counts = { root: currentData.length };
        const textByPath = { root: "" };

        currentData.forEach(d => {
            const tag = d.tag || "unknown";
            if (!tagSubPathsMap.has(tag)) tagSubPathsMap.set(tag, []);

            counts[tag] = (counts[tag] || 0) + 1;
            const bodyText = String(d.text || d.content || d.abstract || "");

            if (bodyText) {
                textByPath['root'] += " " + bodyText;
                textByPath[tag] = (textByPath[tag] || "") + " " + bodyText;
            }

            const nodePath = d.tag_sub_path !== undefined && d.tag_sub_path !== null
                ? String(d.tag_sub_path).replace(/^Cluster\s+/i, '').trim()
                : "";

            if (nodePath) {
                tagSubPathsMap.get(tag).push(nodePath);

                // Tags use periods for sub-paths (e.g., "0.1")
                const parts = nodePath.split('.');
                let currentPath = "";
                for (let i = 0; i < parts.length; i++) {
                    currentPath = currentPath === "" ? parts[i] : currentPath + "." + parts[i];
                    const key = `${tag}_${currentPath}`;
                    counts[key] = (counts[key] || 0) + 1;
                    if (bodyText) textByPath[key] = (textByPath[key] || "") + " " + bodyText;
                }
            }
        });

        rootNode = createNode('root', 'All Documents', '#111827', counts['root'], textByPath['root']);

        const uniqueTags = [...new Set(currentData.map(d => d.tag).filter(Boolean))];
        const tagOrder = state.tagOrder || uniqueTags;

        function buildTagSubTree(tag, currentPath, parentColor, tagIdx) {
            const safeSubPath = String(currentPath);
            const prefix = safeSubPath === "" ? "" : `${safeSubPath}.`;
            const childTokens = new Set();

            const paths = tagSubPathsMap.get(tag) || [];
            paths.forEach(nodePath => {
                if (nodePath.startsWith(prefix)) {
                    const remainder = nodePath.slice(prefix.length);
                    if (remainder.length > 0) {
                        const match = remainder.match(/^-?\d+/);
                        if (match) childTokens.add(match[0]);
                    }
                }
            });

            const children = [];
            if (childTokens.size > 0) {
                const sortedTokens = [...childTokens].sort((a, b) => parseInt(a) - parseInt(b));
                sortedTokens.forEach(token => {
                    const nextPath = prefix + token;
                    const fullPathKey = `${tag}_${nextPath}`;

                    let nextName = `Subcluster ${token}`;
                    if (state.clusterNames && state.clusterNames[fullPathKey]) {
                        nextName = state.clusterNames[fullPathKey];
                    }

                    let nextColor = parentColor;
                    try {
                        const hyphenPath = nextPath.replace(/\./g, '-');
                        if (typeof window.getTagSubClusterColor === 'function') {
                            nextColor = window.getTagSubClusterColor(tag, tagIdx, hyphenPath) || parentColor;
                        } else if (typeof getTagSubClusterColor === 'function') {
                            nextColor = getTagSubClusterColor(tag, tagIdx, hyphenPath) || parentColor;
                        }
                    } catch(e) {}

                    const count = counts[fullPathKey] || 0;
                    const aggregatedText = textByPath[fullPathKey] || "";

                    const childNode = createNode(fullPathKey, nextName, nextColor, count, aggregatedText);
                    childNode.children = buildTagSubTree(tag, nextPath, nextColor, tagIdx);
                    children.push(childNode);
                });
            }
            return children;
        }

        uniqueTags.forEach(tag => {
            const tagIdx = tagOrder.indexOf(tag);
            const safeIdx = tagIdx > -1 ? tagIdx : 0;

            let color = "#4b5563";
            try {
                if (typeof window.getTagRegionColor === 'function') {
                    color = window.getTagRegionColor(tag, safeIdx) || "#4b5563";
                } else if (typeof getTagRegionColor === 'function') {
                    color = getTagRegionColor(tag, safeIdx) || "#4b5563";
                }
            } catch(e) {}

            const count = counts[tag] || 0;
            const aggregatedText = textByPath[tag] || "";
            const displayName = tag.replace(/^metadata_/i, '');

            const tagNode = createNode(tag, displayName, color, count, aggregatedText);
            tagNode.children = buildTagSubTree(tag, "", color, safeIdx);
            rootNode.children.push(tagNode);
        });

    }

    // CLUSTER HIERARCHY LOGIC
    else {
        const clusterSubPathsMap = new Map();
        const counts = { root: currentData.length };
        const textByPath = { root: "" };

        currentData.forEach(d => {
            const cid = parseInt(d.cluster, 10);
            if (!clusterSubPathsMap.has(cid)) clusterSubPathsMap.set(cid, []);

            counts[cid] = (counts[cid] || 0) + 1;
            const bodyText = String(d.text || d.content || d.abstract || "");

            if (bodyText) {
                textByPath['root'] += " " + bodyText;
                textByPath[cid] = (textByPath[cid] || "") + " " + bodyText;
            }

            const nodePath = d.sub_path !== undefined && d.sub_path !== null ? String(d.sub_path) :
                             (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");

            if (nodePath) {
                clusterSubPathsMap.get(cid).push(nodePath);

                const parts = nodePath.split('-');
                let currentPath = "";
                for(let i = 0; i < parts.length; i++) {
                    currentPath = currentPath === "" ? parts[i] : currentPath + "-" + parts[i];
                    const key = `${cid}-${currentPath}`;
                    counts[key] = (counts[key] || 0) + 1;
                    if (bodyText) textByPath[key] = (textByPath[key] || "") + " " + bodyText;
                }
            }
        });

        rootNode = createNode('root', 'All Documents', '#111827', counts['root'], textByPath['root']);

        const uniqueClusters = [...new Set(currentData.map(d => parseInt(d.cluster, 10)))].sort((a, b) => a - b);
        const realClusters = uniqueClusters.filter(c => c !== -1);
        const isSingleRegion = realClusters.length <= 1;

        function buildSubTree(cId, currentPath, parentColor) {
            const safeSubPath = String(currentPath);
            const prefix = safeSubPath === "" ? "" : `${safeSubPath}-`;
            const childTokens = new Set();

            const paths = clusterSubPathsMap.get(cId) || [];
            paths.forEach(nodePath => {
                if (nodePath.startsWith(prefix)) {
                    const remainder = nodePath.slice(prefix.length);
                    if (remainder.length > 0) {
                        const match = remainder.match(/^-?\d+/);
                        if (match) childTokens.add(match[0]);
                    }
                }
            });

            const children = [];
            if (childTokens.size > 0) {
                const sortedTokens = [...childTokens].sort((a, b) => parseInt(a) - parseInt(b));
                sortedTokens.forEach(token => {
                    const nextPath = prefix + token;
                    const fullPathKey = `${cId}-${nextPath}`;
                    let nextName = (token === "-1" || token === -1) ? "Noise" : `Subcluster ${token}`;

                    if (token !== "-1" && token !== -1 && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[fullPathKey]) {
                        nextName = state.clusterLabels[state.globalClusterLabelMode][fullPathKey];
                    }

                    const nextColor = resolveSubClusterColor(cId, nextPath, parentColor, token);
                    const count = counts[fullPathKey] || 0;
                    const aggregatedText = textByPath[fullPathKey] || "";

                    const childNode = createNode(fullPathKey, nextName, nextColor, count, aggregatedText);
                    childNode.children = buildSubTree(cId, nextPath, nextColor);
                    children.push(childNode);
                });
            }
            return children;
        }

        uniqueClusters.forEach(cId => {
            let color = resolveClusterColor(cId);
            const count = counts[cId] || 0;
            const aggregatedText = textByPath[cId] || "";

            if (isSingleRegion && cId !== -1) {
                const subChildren = buildSubTree(cId, "", color);
                rootNode.children.push(...subChildren);
                rootNode.color = color;
                return;
            }

            let baseName = `Region ${parseInt(cId, 10) + 1}`;
            const dataNode = currentData.find(d => parseInt(d.cluster, 10) === parseInt(cId, 10));
            let cName = dataNode?.cluster_name;

            if (cName === "All Documents" || cName === "Cluster 0") cName = null;
            let name = cId === -1 ? "Noise" : (cName || baseName);

            const clusterNode = createNode(String(cId), name, color, count, aggregatedText);
            clusterNode.children = buildSubTree(cId, "", color);
            rootNode.children.push(clusterNode);
        });
    }

    layoutTree(rootNode);
    updateKeywordNetwork();
}


/**
 * Determines which hierarchy node intersects with the given mouse coordinates[cite: 1].
 * @requires mouseX and mouseY are valid screen coordinates[cite: 1].
 * @ensures Recursively checks node bounding boxes (converting mouse coords to world coords) and returns the matching node, skipping the ignoreId[cite: 1].
 * @param {number} mouseX - The screen X coordinate[cite: 1].
 * @param {number} mouseY - The screen Y coordinate[cite: 1].
 * @param {string|null} ignoreId - A node ID to exclude from the hit test[cite: 1].
 * @returns {Object|null} The intersecting node, or null if none[cite: 1].
 */
export function hitTestHierarchy(mouseX, mouseY, ignoreId = null) {
    if (!rootNode) return null;

    function checkNode(node) {
        if (node.children && node.children.length > 0 && !node.collapsed) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                const found = checkNode(node.children[i]);
                if (found) return found;
            }
        }

        if (ignoreId && node.id === ignoreId) return null;

        const worldX = hInvertX(mouseX);
        const worldY = hInvertY(mouseY);
        const size = getNodeSize(node);

        if (worldX >= node.x && worldX <= node.x + size.w &&
            worldY >= node.y && worldY <= node.y + size.h) {
            return node;
        }

        return null;
    }

    return checkNode(rootNode);
}


/**
 * Handles mouse click events on the hierarchy canvas[cite: 1].
 * @requires event - A valid MouseEvent[cite: 1].
 * @ensures Toggles sever state, collapse state, or node selection depending on which part of the bounding box was clicked, then triggers a redraw[cite: 1].
 * @param {MouseEvent} event - The DOM click event[cite: 1].
 * @returns {boolean} True if a node was interacted with or state was updated[cite: 1].
 */
export function handleHierarchyClick(event) {
    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const clickedNode = hitTestHierarchy(mouseX, mouseY);

    if (clickedNode) {
        const worldX = hInvertX(mouseX);
        const worldY = hInvertY(mouseY);
        const size = getNodeSize(clickedNode);

        // Define Hit Areas for buttons
        const topYThreshold = clickedNode.y + 30;

        // Check if clicking in the top right corner area
        if (worldY <= topYThreshold) {
            // 1. Sever Button (Left of collapse)
            if (worldX >= clickedNode.x + size.w - 50 && worldX <= clickedNode.x + size.w - 25) {
                clickedNode.severed = !clickedNode.severed;
                drawHierarchy();
                return true;
            }

            // collapse Button (Far right)
            if (clickedNode.children && clickedNode.children.length > 0) {
                if (worldX > clickedNode.x + size.w - 25 && worldX <= clickedNode.x + size.w) {
                    clickedNode.collapsed = !clickedNode.collapsed;
                    layoutTree(rootNode);
                    updateKeywordNetwork();
                    drawHierarchy();
                    return true;
                }
            }
        }

        // Toggle selection off if clicking the already selected node
        if (selectedNode && selectedNode.id === clickedNode.id) {
            selectedNode = null;
        } else {
            selectedNode = clickedNode;
        }

        state.hoveredNode = clickedNode;
        drawHierarchy();
        return true;
    }

    let needsRedraw = false;
    if (selectedNode) { selectedNode = null; needsRedraw = true; }
    if (state.hoveredNode) { state.hoveredNode = null; needsRedraw = true; }

    if (needsRedraw) drawHierarchy();
    return true;
}


/**
 * Initializes the drag state for a hierarchy node[cite: 1].
 * @requires node - The node to drag[cite: 1].
 * @ensures Sets draggedNode and calculates drag offsets, unless the node represents noise (-1)[cite: 1].
 * @param {Object} node - The target node[cite: 1].
 * @param {number} mouseX - The starting screen X coordinate[cite: 1].
 * @param {number} mouseY - The starting screen Y coordinate[cite: 1].
 */
export function startHierarchyDrag(node, mouseX, mouseY) {
    if (String(node.id) === "-1" || String(node.id).endsWith("--1")) return;

    draggedNode = node;
    dragOffsetX = hInvertX(mouseX) - node.x;
    dragOffsetY = hInvertY(mouseY) - node.y;
    dropTargetNode = null;
}


/**
 * Updates node coordinates during a drag operation and evaluates valid drop targets[cite: 1].
 * @requires A drag operation must be active (draggedNode is not null)[cite: 1].
 * @ensures Updates draggedNode.x/y and sets dropTargetNode if the cursor hovers over a valid sibling merge target[cite: 1].
 * @param {number} mouseX - The current screen X coordinate[cite: 1].
 * @param {number} mouseY - The current screen Y coordinate[cite: 1].
 */
export function moveHierarchyDrag(mouseX, mouseY) {
    if (!draggedNode) return;
    draggedNode.x = hInvertX(mouseX) - dragOffsetX;
    draggedNode.y = hInvertY(mouseY) - dragOffsetY;

    const target = hitTestHierarchy(mouseX, mouseY, draggedNode.id);

    if (target && target.id !== 'root' && target.id !== draggedNode.id) {
        const isNoise = String(target.id) === "-1" || String(target.id).endsWith("--1");

        if (!isNoise) {
            const nodeParts = String(draggedNode.id).split('-');
            const targetParts = String(target.id).split('-');
            const nodeParent = nodeParts.slice(0, -1).join('-');
            const targetParent = targetParts.slice(0, -1).join('-');

            if (nodeParent === targetParent && nodeParts.length === targetParts.length) {
                dropTargetNode = target;
            } else {
                dropTargetNode = null;
            }
        } else {
            dropTargetNode = null;
        }
    } else {
        dropTargetNode = null;
    }
}


/**
 * Finalizes a drag operation and handles node merging[cite: 1].
 * @ensures Clears drag state variables and invokes merge trigger functions if the dragged node was dropped onto a valid target node[cite: 1].
 * @param {number} mouseX - The ending screen X coordinate[cite: 1].
 * @param {number} mouseY - The ending screen Y coordinate[cite: 1].
 * @returns {Object|null} The node that was dragged[cite: 1].
 */
export function stopHierarchyDrag(mouseX, mouseY) {
    const node = draggedNode;
    draggedNode = null;
    dropTargetNode = null;

    if (node && mouseX !== undefined && mouseY !== undefined) {
        const targetNode = hitTestHierarchy(mouseX, mouseY, node.id);

        if (targetNode && targetNode.id !== node.id && targetNode.id !== 'root' && node.id !== 'root') {
            const isNoise = String(node.id) === "-1" || String(node.id).endsWith("--1") ||
                            String(targetNode.id) === "-1" || String(targetNode.id).endsWith("--1");

            if (!isNoise) {
                const nodeParts = String(node.id).split('-');
                const targetParts = String(targetNode.id).split('-');
                const nodeParent = nodeParts.slice(0, -1).join('-');
                const targetParent = targetParts.slice(0, -1).join('-');

                if (nodeParent === targetParent && nodeParts.length === targetParts.length) {
                    const isRoot = nodeParts.length === 1;
                    const sourceId = isRoot ? node.id : nodeParts[nodeParts.length - 1];
                    const targetId = isRoot ? targetNode.id : targetParts[targetParts.length - 1];
                    const parentKey = isRoot ? 'root' : nodeParent;

                    if (typeof window.triggerMerge === 'function') {
                        window.triggerMerge(node.id, targetNode.id);
                    } else if (typeof window.mergeClusters === 'function') {
                        window.mergeClusters(sourceId, targetId, isRoot, parentKey);
                    }
                }
            }
        }
    }
    return node;
}


/**
 * Manually sets the active selection to a specific node[cite: 1].
 * @ensures The internal selectedNode reference is updated[cite: 1].
 * @param {Object} node - The node to select[cite: 1].
 */
export function setSelectedHierarchyNode(node) {
    selectedNode = node;
}


/**
 * Calculates the optimal connection points between a parent and child node[cite: 1].
 * @requires p and c are valid node objects with initialized coordinates[cite: 1].
 * @ensures Returns start and end X/Y coordinates attached to the edges of the parent and child bounding boxes[cite: 1].
 * @param {Object} p - The parent node[cite: 1].
 * @param {Object} c - The child node[cite: 1].
 * @returns {{startX: number, startY: number, endX: number, endY: number}} The connection line coordinates[cite: 1].
 */
function getBestConnectionPoints(p, c) {
    const pSize = getNodeSize(p);
    const cSize = getNodeSize(c);

    const pCX = p.x + pSize.w / 2;
    const pCY = p.y + pSize.h / 2;
    const cCX = c.x + cSize.w / 2;
    const cCY = c.y + cSize.h / 2;

    let startX = pCX, startY = pCY;
    let endX = cCX, endY = cCY;

    const dx = cCX - pCX;
    const dy = cCY - pCY;

    if (Math.abs(dx) > Math.abs(dy)) {
        startX = dx > 0 ? p.x + pSize.w : p.x;
        endX = dx > 0 ? c.x : c.x + cSize.w;
    } else {
        startY = dy > 0 ? p.y + pSize.h : p.y;
        endY = dy > 0 ? c.y : c.y + cSize.h;
    }

    return { startX, startY, endX, endY };
}


/**
 * Renders the visual network of keyword connections between leaf nodes[cite: 1].
 * @requires nodeToNodeLinks is populated and view mode is 'hNetwork'[cite: 1].
 * @ensures Draws gradient lines and keyword labels onto the canvas context, respecting severed nodes and current selections[cite: 1].
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context[cite: 1].
 * @param {number} scale - The current transform scale[cite: 1].
 */
function drawKeywordNetworkOverlay(ctx, scale) {
    if (state.viewMode !== 'hNetwork' && state.allData !== 'hNetwork') return;
    if (!nodeToNodeLinks || nodeToNodeLinks.length === 0) return;

    ctx.save();
    const hasSelection = !!selectedNode;

    nodeToNodeLinks.forEach(link => {
        const sourceNode = currentLeafNodes.find(ln => ln.id === link.source);
        const targetNode = currentLeafNodes.find(ln => ln.id === link.target);

        if (sourceNode && targetNode) {
            // Guard: Do not draw network connections if either end is Severed
            if (sourceNode.severed || targetNode.severed) return;

            const isSelected = hasSelection && (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id);

            const sSize = getNodeSize(sourceNode);
            const tSize = getNodeSize(targetNode);

            const sx = hMapX(sourceNode.x + (sSize.w / 2));
            const sy = hMapY(sourceNode.y + (sSize.h / 2));
            const tx = hMapX(targetNode.x + (tSize.w / 2));
            const ty = hMapY(targetNode.y + (tSize.h / 2));

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);

            const grad = ctx.createLinearGradient(sx, sy, tx, ty);
            const color1 = sourceNode.color || '#9ca3af';
            const color2 = targetNode.color || '#9ca3af';

            if (hasSelection) {
                if (isSelected) {
                    grad.addColorStop(0, hexToRgba(color1, 0.95));
                    grad.addColorStop(1, hexToRgba(color2, 0.95));
                    ctx.lineWidth = 2.5 * scale;
                } else {
                    grad.addColorStop(0, hexToRgba(color1, 0.08));
                    grad.addColorStop(1, hexToRgba(color2, 0.08));
                    ctx.lineWidth = 1 * scale;
                }
            } else {
                grad.addColorStop(0, hexToRgba(color1, 0.6));
                grad.addColorStop(1, hexToRgba(color2, 0.6));
                ctx.lineWidth = 1.5 * scale;
            }

            ctx.strokeStyle = grad;
            ctx.setLineDash([]);
            ctx.stroke();

            if (scale > 1.05 && (!hasSelection || isSelected) && link.keywords && link.keywords.length > 0) {
                const mx = (sx + tx) / 2;
                const my = (sy + ty) / 2;

                const textLabel = link.keywords.slice(0, 2).join(', ') + (link.keywords.length > 2 ? '...' : '');

                const fontSize = 10 * scale;
                ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                const textW = ctx.measureText(textLabel).width;
                const padX = 6 * scale;
                const padY = 4 * scale;

                ctx.fillStyle = isSelected ? "rgba(239, 246, 255, 0.95)" : "rgba(255, 255, 255, 0.85)";
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(mx - textW/2 - padX, my - fontSize/2 - padY, textW + padX*2, fontSize + padY*2, 4*scale);
                } else {
                    ctx.rect(mx - textW/2 - padX, my - fontSize/2 - padY, textW + padX*2, fontSize + padY*2);
                }
                ctx.fill();

                ctx.strokeStyle = isSelected ? "rgba(59, 130, 246, 0.4)" : "rgba(148, 163, 184, 0.3)";
                ctx.lineWidth = 1 * scale;
                ctx.stroke();

                ctx.fillStyle = isSelected ? "#1d4ed8" : "#475569";
                ctx.fillText(textLabel, mx, my);
            }
        }
    });
    ctx.restore();
}


/**
 * Orchestrates the rendering of the entire hierarchy view[cite: 1].
 * @requires state.ctx and state.canvas must be initialized[cite: 1].
 * @ensures Clears the canvas, triggers initialization if data changed, sorts nodes by active state, and renders lines, overlays, and individual nodes[cite: 1].
 */
export function drawHierarchy() {
    if (!state.ctx || !state.canvas) return;

    const currentData = state.filteredData && state.filteredData.length > 0 ? state.filteredData : state.allData;
    if (!rootNode || lastDataRef !== currentData) {
        initHierarchy();
        lastDataRef = currentData;
    }

    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    const scale = state.transform ? state.transform.k : 1;

    drawLines(rootNode);
    drawKeywordNetworkOverlay(state.ctx, scale);

    const allNodes = [];
    function collectNodes(n) {
        allNodes.push(n);
        if (n.children && !n.collapsed) {
            n.children.forEach(collectNodes);
        }
    }

    if (rootNode) {
        collectNodes(rootNode);
    }

    allNodes.sort((a, b) => {
        const isAActive = (selectedNode && selectedNode.id === a.id) ||
                          (draggedNode && draggedNode.id === a.id) ||
                          (dropTargetNode && dropTargetNode.id === a.id);
        const isBActive = (selectedNode && selectedNode.id === b.id) ||
                          (draggedNode && draggedNode.id === b.id) ||
                          (dropTargetNode && dropTargetNode.id === b.id);
        return (isAActive ? 1 : 0) - (isBActive ? 1 : 0);
    });

    allNodes.forEach(node => drawSingleNode(node));
}


/**
 * Recursively draws gradient connection lines between parent and child nodes[cite: 1].
 * @requires node - A valid hierarchy node[cite: 1].
 * @ensures Strokes a line from parent to child using calculated connection points, provided neither node is marked as severed[cite: 1].
 * @param {Object} node - The parent node[cite: 1].
 */
function drawLines(node) {
    if (!node.children || node.children.length === 0 || node.collapsed) return;

    const ctx = state.ctx;
    ctx.save();
    ctx.lineWidth = 2;

    for (const child of node.children) {
        // Draw line ONLY if neither parent nor child is severed
        if (!node.severed && !child.severed) {
            const pts = getBestConnectionPoints(node, child);

            const startX = hMapX(pts.startX);
            const startY = hMapY(pts.startY);
            const endX = hMapX(pts.endX);
            const endY = hMapY(pts.endY);

            const grad = ctx.createLinearGradient(startX, startY, endX, endY);
            grad.addColorStop(0, node.color || '#9ca3af');
            grad.addColorStop(1, child.color || '#9ca3af');

            ctx.strokeStyle = grad;

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        }

        // Must still recurse so we don't accidentally hide grandchildren of severed nodes
        drawLines(child);
    }
    ctx.restore();
}


/**
 * Renders the visual representation of a single node[cite: 1].
 * @requires node - A valid hierarchy node[cite: 1].
 * @ensures Draws the node's bounding box, shadows, text labels, color indicators, and interactive buttons based on state (severed, collapsed, active)[cite: 1].
 * @param {Object} node - The node to draw[cite: 1].
 */
function drawSingleNode(node) {
    const ctx = state.ctx;
    const size = getNodeSize(node);
    const screenX = hMapX(node.x);
    const screenY = hMapY(node.y);

    const scale = state.transform ? state.transform.k : 1;
    const renderWidth = size.w * scale;
    const renderHeight = size.h * scale;

    const isSelected = selectedNode && selectedNode.id === node.id;
    const isDragged = draggedNode && draggedNode.id === node.id;
    const isHovered = state.hoveredNode && state.hoveredNode.id === node.id;
    const isDropTarget = dropTargetNode && dropTargetNode.id === node.id;

    const isActive = isSelected || isDragged || isHovered || isDropTarget;
    const baseColor = node.color || '#4b5563';

    ctx.save();
    ctx.shadowOffsetY = 2;

    if (isDropTarget) {
        ctx.shadowColor = hexToRgba('#2563eb', 0.8);
        ctx.shadowBlur = 15;
        ctx.fillStyle = hexToRgba('#2563eb', 0.2);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
    } else {
        ctx.shadowColor = isActive ? hexToRgba(baseColor, 0.4) : 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = isActive ? 12 : 6;

        // Dim the background slightly if severed
        ctx.fillStyle = isSelected ? hexToRgba(baseColor, 0.08) : (node.severed ? '#f9fafb' : '#ffffff');

        // Use a dashed gray border to indicate "disconnected/severed"
        if (node.severed) {
            ctx.strokeStyle = '#9ca3af'; // Neutral gray
            ctx.setLineDash([6 * scale, 4 * scale]); // Dashed line
        } else {
            ctx.strokeStyle = baseColor;
            ctx.setLineDash([]); // Solid line
        }

        ctx.lineWidth = isActive ? 3 : 1.5;
        if (isDragged) {
             ctx.fillStyle = hexToRgba('#ffffff', 0.85);
        }
    }

    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(screenX, screenY, renderWidth, renderHeight, 6 * scale);
    } else {
        ctx.rect(screenX, screenY, renderWidth, renderHeight);
    }
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.stroke();

    // Immediately reset line dash so it doesn't affect other drawings!
    ctx.setLineDash([]);

    const dotRadius = 4 * scale;
    // If severed, make the color dot gray as well to reinforce the inactive state
    ctx.fillStyle = node.severed ? '#9ca3af' : baseColor;
    ctx.beginPath();
    ctx.arc(screenX + 14 * scale, screenY + (renderHeight / 2), dotRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Dim the text if severed
    ctx.fillStyle = node.severed ? '#6b7280' : '#111827';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let fontSize = node.id === 'root' ? 14 : 12;
    ctx.font = `bold ${fontSize * scale}px system-ui, sans-serif`;

    const paddingRight = 45; // Make room for both buttons
    const maxTextWidth = (size.w - 26 - paddingRight) * scale;

    let textToDraw = node.label;

    while (ctx.measureText(textToDraw).width > maxTextWidth && fontSize > 8) {
        fontSize -= 0.5;
        ctx.font = `bold ${fontSize * scale}px system-ui, sans-serif`;
    }

    if (ctx.measureText(textToDraw).width > maxTextWidth) {
        while (textToDraw.length > 0 && ctx.measureText(textToDraw + '...').width > maxTextWidth) {
            textToDraw = textToDraw.slice(0, -1);
        }
        textToDraw += '...';
    }

    ctx.fillText(
        textToDraw,
        screenX + 26 * scale,
        screenY + (renderHeight / 2) - (8 * scale)
    );

    ctx.fillStyle = '#9ca3af';
    ctx.font = `${(node.id === 'root' ? 11 : 10) * scale}px system-ui, sans-serif`;
    ctx.fillText(
        `${(node.count || 0).toLocaleString()} embeddings`,
        screenX + 26 * scale,
        screenY + (renderHeight / 2) + (8 * scale)
    );

    // --- BUTTONS ---
    ctx.textAlign = 'center';



    // Collapse Toggle Button
    if (node.children && node.children.length > 0) {
           // Sever Toggle Button
    // Darker gray when severed (Link icon) so it stands out, light gray for scissors
    ctx.fillStyle = node.severed ? '#4b5563' : '#9ca3af';
    ctx.font = `${12 * scale}px system-ui, sans-serif`;
    ctx.fillText(
        node.severed ? 'Link' : 'Cut',
        screenX + renderWidth - (34 * scale),
        screenY + (14 * scale)
    );
        ctx.fillStyle = '#6b7280';
        ctx.font = `bold ${10 * scale}px system-ui, sans-serif`;
        const icon = node.collapsed ? '▶' : '▼';
        ctx.fillText(
            icon,
            screenX + renderWidth - (12 * scale),
            screenY + (13 * scale)
        );
    }

    ctx.restore();
}


/**
 * Updates global data visibility based on a selected hierarchy node[cite: 1].
 * @requires node - The node used as a filter target[cite: 1].
 * @ensures Modifies the 'visible' property on state.allData entries matching the node's tag or cluster path, and updates state.filteredData[cite: 1].
 * @param {Object} node - The selected node[cite: 1].
 */
export function applyHierarchyVisibility(node) {
    if (!node) return;

    // Reset visibility if the root node is double-clicked
    if (node.id === 'root') {
        state.allData.forEach(d => d.visible = true);
        state.filteredData = [...state.allData];
        return;
    }

    if (state.colorByMetadata) {
        // --- METADATA FILTERING ---
        // node.id format: "tag_name" OR "tag_name_0.1"
        const parts = String(node.id).split('_');
        const targetTag = parts[0];
        const targetPath = parts.length > 1 ? parts.slice(1).join('_') : null;

        state.allData.forEach(d => {
            const dTag = d.tag || "unknown";

            if (dTag !== targetTag) {
                d.visible = false;
            } else if (targetPath) {
                const dPath = d.tag_sub_path !== undefined && d.tag_sub_path !== null
                    ? String(d.tag_sub_path).replace(/^Cluster\s+/i, '').trim()
                    : "";
                // Match exact path or sub-paths (e.g., target "0" matches "0.1")
                d.visible = dPath === targetPath || dPath.startsWith(targetPath + '.');
            } else {
                d.visible = true;
            }
        });
    } else {
        const parts = String(node.id).split('-');
        const targetCluster = parts[0];
        const targetPath = parts.length > 1 ? parts.slice(1).join('-') : null;

        state.allData.forEach(d => {
            const dCluster = String(d.cluster);

            if (dCluster !== targetCluster) {
                d.visible = false;
            } else if (targetPath) {
                const dPath = d.sub_path !== undefined && d.sub_path !== null
                    ? String(d.sub_path)
                    : (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");
                // Match exact path or sub-paths
                d.visible = dPath === targetPath || dPath.startsWith(targetPath + '-');
            } else {
                d.visible = true;
            }
        });
    }

    state.filteredData = state.allData.filter(d => d.visible);

}


/**
 * Handles double-click events on the hierarchy canvas[cite: 1].
 * @requires event - A valid MouseEvent[cite: 1].
 * @ensures Applies data visibility filtering based on the clicked node, transitions the application to 'scatter' mode, updates the legend, and triggers a re-render[cite: 1].
 * @param {MouseEvent} event - The DOM double-click event[cite: 1].
 * @returns {boolean} True if a node was double-clicked[cite: 1].
 */
export function handleHierarchyDoubleClick(event) {
    // Synchronize active class state across view toggle buttons
    const chordBtn = document.getElementById('btnToggleTopology');
    const scatterBtn = document.getElementById('btnToggleScatter');
    const hierarchyBtn = document.getElementById('btnToggleHierarchy');
    const allButtons = [chordBtn, scatterBtn, hierarchyBtn].filter(Boolean);

    allButtons.forEach(btn => btn.classList.remove('active'));
    if (scatterBtn) scatterBtn.classList.add('active');

    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const clickedNode = hitTestHierarchy(mouseX, mouseY);

    if (clickedNode) {
        // Filter data based on the node clicked (metadata or cluster)
        applyHierarchyVisibility(clickedNode);

        // Switch back to scatter view
        state.viewMode = 'scatter';

        // Trigger main render instead of drawHierarchy so the scatter plot updates immediately
        import('./render.js').then(r => {
            if (typeof r.draw === 'function') r.draw();
        });
        updateLegend();
        return true;
    }

    return false;
}
