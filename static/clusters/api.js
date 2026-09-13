// api.js
import { state } from '../core/state.js';
import { draw } from '../canvas/render.js';
import {updateBottomPanelTrajectory} from '../components/ui.js';
import { resetZoom } from '../canvas/events.js';
import { applyGlobalFilters } from '../core/data.js';
import { rebuildClusterCentroids } from '../canvas/render.js';
import {undoStack} from '../core/history.js'
import { buildKeywordNetwork, extractKeywords, extractTextPayload } from './labels.js';
import {updateLegend} from "../components/global_legend.js";
// Global Window Bindings
if (typeof window !== "undefined") {
    window.classifyQuery = classifyQuery;
    window.applyGlobalFilters = applyGlobalFilters;
    window.search = search;
    window.triggerMetadataMapping = triggerMetadataMapping;
    window.mapTopicsToMetadataLocations = mapTopicsToMetadataLocations;
    window.calculateMetadataTags = calculateMetadataTags;
    window.resetPlot = resetPlot;
    window.resetPlot = resetPlot;
    window.triggerTagSubCluster = triggerTagSubCluster;
    window.mapToMetaIslands = mapToMetaIslands;
    window.clearLassoSelection = clearLassoSelection;
    window.triggerSubCluster = triggerSubCluster;
    window.aiQuery = aiQuery;
    window.autoLabelAllClusters = autoLabelAllClusters;
    window.generateGraphRAGTopologyWithAI = generateGraphRAGTopologyWithAI;
    window.autoLabelAllClusters = autoLabelAllClusters;
    window.generateGraphRAGTopologyWithAI = generateGraphRAGTopologyWithAI;
    window.mapToDatasetIslands = mapToDatasetIslands;
    window.displayAIResponse = displayAIResponse;
    window.autoLabelAllClusters = autoLabelAllClusters;
    window.generateGraphRAGTopologyWithAI = generateGraphRAGTopologyWithAI
}
import {buildTagDropdownUI} from '../components/tag_legend.js';


/**
 * Decodes a binary payload buffer into an array of structured data objects.
 * @param {ArrayBuffer} buffer - The binary buffer containing JSON header metadata and typed arrays for coordinates, clusters, and types.
 * @returns {Array<Object>} Array of parsed document/node records.
 */
export function decodeBinaryPayload(buffer) {
    if (buffer.byteLength < 4) return [];

    const dataView = new DataView(buffer);
    const metaLength = dataView.getUint32(0, true);

    if (metaLength === 0) return [];

    const textDecoder = new TextDecoder('utf-8');
    const metaJsonString = textDecoder.decode(new Uint8Array(buffer, 4, metaLength));
    const dictionaries = JSON.parse(metaJsonString);
    const paperIds = dictionaries.p || [];
    const chunkIds = dictionaries.c || [];
    const typeNames = dictionaries.t || [];
    const paperMeta = dictionaries.m || {};

    const numRecords = paperIds.length;
    if (numRecords === 0) return [];

    const xOffset = 4 + metaLength;
    const yOffset = xOffset + (numRecords * 4);
    const cOffset = yOffset + (numRecords * 4);
    const typeOffset = cOffset + (numRecords * 4);

    const xArray = new Float32Array(buffer, xOffset, numRecords);
    const yArray = new Float32Array(buffer, yOffset, numRecords);
    const cArray = new Int32Array(buffer, cOffset, numRecords);
    const typeArray = new Uint8Array(buffer, typeOffset, numRecords);

    const cleanTypeString = (str) => {
        if (!str || typeof str !== 'string') return '';
        let cleaned = str.trim();
        cleaned = cleaned.replace(/^metadata_?/i, '');
        return cleaned.replace(/_/g, ' ').trim();
    };

    const dataList = new Array(numRecords);
    for (let i = 0; i < numRecords; i++) {
        const rawNodeType = typeNames[typeArray[i]] || 'chunk';
        const nodeType = cleanTypeString(rawNodeType) || 'chunk';
        const pId = paperIds[i];

        const meta = paperMeta[pId] || {};

        // Parse array of strings safely
        const rawDatasets = meta.d || [];
        const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];

        dataList[i] = {
            id: chunkIds[i],
            chunk_id: chunkIds[i],
            paper_id: pId,
            type: nodeType,
            chunk_type: nodeType,
            x: xArray[i],
            y: yArray[i],
            cluster: cArray[i],
            cluster_name: "All Documents",
            title: meta.t || `Paper ${pId}`,
            authors: meta.a || "Unknown",
            year: meta.y || "N/A",
            dataset: datasets // <-- This now attaches the dataset arrays
        };

    }

    return dataList;
}


/**
 * Fetches binary cluster data from the backend API for specified datasets, cleans metadata/tag values, and updates global state.
 * @param {Array<string>} [requestedDatasets=["Madrigal"]] - List of dataset names to query.
 * @returns {Promise<void>}
 */
export function fetchClusterData(requestedDatasets = ["Madrigal"]) {
    const loader = document.getElementById('loader');
    const kValue = parseInt(document.getElementById("kClusters")?.value) || 0;
    const method = document.getElementById("clusterMethod")?.value || "none";
    const showLabels = state.globalClusterLabelMode !== 'none';

    if (loader) loader.style.display = "flex";

    if (state.hiddenClusters) {
        state.hiddenClusters.clear();
    } else {
        state.hiddenClusters = new Set();
    }

    const url = `/api/filtered-data?k=${kValue}&method=${method}&labels=${showLabels}&labelMode=${state.globalClusterLabelMode}`;

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasets: requestedDatasets })
    })
        .then(r => r.arrayBuffer()) // MUST request as arrayBuffer for binary
        .then(buffer => {

            let data = [];
            try {
                data = decodeBinaryPayload(buffer);
            } catch (e) {
                console.error("Binary decode failed:", e);
            }

            state.allData = Array.isArray(data) ? data : (data.data || []);

            const ignoredWords = new Set([
                'metadata', 'metadatas', 'paper', 'papers',
                'chunk', 'chunks', 'null', 'undefined', '', '0', 'false'
            ]);

            // Helper to clean general type/tag strings
            const cleanTypeString = (str) => {
                if (!str || typeof str !== 'string') return '';
                let cleaned = str.trim();
                cleaned = cleaned.replace(/^metadata_?/i, '');
                return cleaned.replace(/_/g, ' ').trim();
            };

            // Helper to extract full compound type from chunk_id (e.g. metadata_mathematical_abstract_3120561 -> mathematical abstract)
            const extractTypeFromChunkId = (chunkId) => {
                if (!chunkId || typeof chunkId !== 'string') return '';
                // Remove leading 'metadata_' or 'metadata'
                let cleaned = chunkId.replace(/^metadata_?/i, '');
                // Remove trailing numeric ID suffix (e.g., '_3120561')
                cleaned = cleaned.replace(/_\d+$/, '');
                // Convert all remaining underscores to spaces and trim
                return cleaned.replace(/_/g, ' ').trim();
            };

            state.allData.forEach(d => {
                // Extract full tag/type fallback from chunk_id
                if (d.chunk_id && typeof d.chunk_id === 'string') {
                    const extractedType = extractTypeFromChunkId(d.chunk_id);
                    if (extractedType) {
                        if (!d.tag) d.tag = extractedType;
                        if (!d.type) d.type = extractedType;
                    }
                }

                // Ensure existing type and tag properties are cleaned properly
                if (d.type && typeof d.type === 'string') {
                    d.type = cleanTypeString(d.type);
                }
                if (d.tag && typeof d.tag === 'string') {
                    d.tag = cleanTypeString(d.tag);
                }

                let validTags = [];

                // Read straight from flat bit-unpacked object properties safely
                if (d.isr === 1) validTags.push('ISR');
                if (d.tec === 1) validTags.push('TEC');
                if (d.fpi === 1) validTags.push('FPI');
                if (d.sri === 1) validTags.push('SRI');
                if (d.ci === 1)  validTags.push('CI');
                if (d.avr === 1) validTags.push('AVR');

                const rawVal = d.instrument;
                if (rawVal) {
                    if (Array.isArray(rawVal)) {
                        validTags.push(...rawVal);
                    } else if (typeof rawVal === 'string' && (rawVal.includes(',') || rawVal.includes(';'))) {
                        validTags.push(...rawVal.split(/[,;]/));
                    } else if (typeof rawVal === 'string' || typeof rawVal === 'number') {
                        validTags.push(String(rawVal));
                    }
                }

                const cleaned = Array.from(new Set(validTags))
                    .map(t => cleanTypeString(String(t)).toUpperCase())
                    .filter(t => !ignoredWords.has(t.toLowerCase()) && t !== '0' && t !== 'FALSE' && t.length > 0);

                d.instrument = cleaned.length > 0 ? (cleaned.length === 1 ? cleaned[0] : cleaned) : 'N/A';
            });

            if (!state.legendPresets) state.legendPresets = {};
            if (!state.legendPresets['Default View']) {
                state.legendPresets['Default View'] = {
                    viewMode: 'default',
                    hiddenClusters: Array.from(state.hiddenClusters || []),
                    hiddenPaths: Array.from(state.hiddenPaths || []),
                };
            }

            state.legendPresets['Sync Meta Regions'] = {
                viewMode: 'metaregions',
                metaKey: 'section',
                hiddenClusters: [],
                hiddenPaths: [],
                isSystemPreset: true
            };

            state.legendPresets['Sync Dataset Regions'] = {
                viewMode: 'datasetregions',
                hiddenClusters: [],
                hiddenPaths: [],
                isSystemPreset: true
            };

            if (!state.activePreset) state.activePreset = 'Default View';

            if (typeof buildTagDropdownUI === 'function') buildTagDropdownUI();

            if (typeof buildMetadataSelectorUI === 'function') buildMetadataSelectorUI();

            state.clusterCentroids = {};
            if (typeof rebuildClusterCentroids === 'function') rebuildClusterCentroids();

            updateLegend();
            applyGlobalFilters();

            if (typeof resetZoom === 'function') resetZoom();
        })
        .catch(err => console.error("Failed to fetch cluster data:", err))
        .finally(() => {
            if (loader) loader.style.display = "none";
        });
}


/**
 * Requests cluster labels or summaries from the backend based on current dataset mappings and applies them to state.
 * @param {string} mode - Label mode (e.g., 'keywords', 'summary').
 * @param {string|null} [optionalTag=null] - Optional metadata tag filter.
 * @param {string|null} [optionalBias=null] - Optional text bias to direct label generation.
 * @returns {Promise<void>}
 */
export async function fetchLabels(mode, optionalTag = null, optionalBias = null) {
    const legendContainer = document.getElementById("floatingLegend");
    if (legendContainer) legendContainer.style.opacity = "0.5";

    const clusterMappings = {};

    if (typeof window.saveState === 'function' && !window.isRestoring) {
        window.saveState();
    } else if (typeof window.saveHistoryState === 'function' && !window.isRestoring) {
        window.saveHistoryState();
    }

    if (state.allData) {
        state.allData.forEach(d => {
            if (d.cluster === undefined || d.cluster === null) return;

            const rootKey = String(d.cluster);
            if (!clusterMappings[rootKey]) clusterMappings[rootKey] = [];
            clusterMappings[rootKey].push(d.chunk_id || d.id);

            const nodePath = (d.sub_path !== undefined && d.sub_path !== null) ? String(d.sub_path) :
                             ((d.sub_cluster !== undefined && d.sub_cluster !== null) ? String(d.sub_cluster) : "");

            if (nodePath && nodePath.trim() !== "") {
                const rawSplit = nodePath.split('-');
                const parts = [];
                for (let i = 0; i < rawSplit.length; i++) {
                    if (rawSplit[i] === "") {
                        parts.push("-" + rawSplit[i + 1]);
                        i++;
                    } else {
                        parts.push(rawSplit[i]);
                    }
                }

                let agg = "";
                for (let p of parts) {
                    agg += (agg === "" ? p : `-${p}`);
                    const pathKey = `${d.cluster}-${agg}`;
                    if (!clusterMappings[pathKey]) clusterMappings[pathKey] = [];
                    clusterMappings[pathKey].push(d.chunk_id || d.id);
                }
            }
        });
    }

    try {
        const biasText = optionalBias !== null ? optionalBias : (document.getElementById('globalBiasInput')?.value || "");

        // Build the payload, injecting optional metadata tag or bias text
        const payload = { mode: mode, clusters: clusterMappings };
        if (optionalTag) {
            payload.tag = optionalTag;
        }
        if (biasText) {
            payload.bias_text = biasText;
        }

        const response = await fetch('/api/labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const labels = await response.json();

        if (!state.clusterLabels) state.clusterLabels = { keywords: {}, summaries: {} };
        state.clusterLabels[mode] = { ...state.clusterLabels[mode], ...labels };

        updateLegend();
        draw();

    } catch (err) {
        console.error("Failed to fetch labels:", err);
    } finally {
        if (legendContainer) legendContainer.style.opacity = "1.0";
    }
}


/**
 * Safely converts string, array, or null/undefined values into a normalized lowercase string.
 * @param {any} val - The input value to sanitize.
 * @returns {string} Lowercase string representation of the input.
 */
function toSafeString(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(' ').toLowerCase();
    return String(val).toLowerCase();
}

/**
 * Strips non-alphanumeric characters (except whitespace) to standardize name strings for matching.
 * @param {any} str - The raw name string.
 * @returns {string} Sanitized, trimmed lowercase string.
 */
function normalizeName(str) {
    return toSafeString(str).replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Checks if a search term matches any author name in the dataset (supports substrings and reversed name structures).
 * @param {string} term - The search query term.
 * @param {Array<Object>} dataset - The collection of data nodes to inspect.
 * @returns {boolean} True if an author match is found.
 */
function isAuthorMatch(term, dataset) {
    if (!dataset || dataset.length === 0) return false;
    const cleanTerm = normalizeName(term);
    const termWords = cleanTerm.split(/\s+/).filter(Boolean);

    return dataset.some(d => {
        if (!d.authors) return false;
        const authorStr = normalizeName(d.authors);

        // Direct substring match (e.g. "smith" in "john smith")
        if (authorStr.includes(cleanTerm)) return true;

        // Reversed name check (e.g. "John Smith" vs "Smith, John")
        if (termWords.length >= 2) {
            const reversedTerm = `${termWords[termWords.length - 1]} ${termWords[0]}`;
            if (authorStr.includes(reversedTerm)) return true;
        }

        return false;
    });
}

/**
 * Checks if a search query string exists as a substring within any document title.
 * @param {string} term - The search query term.
 * @param {Array<Object>} dataset - The collection of data nodes to inspect.
 * @returns {boolean} True if a title match is found.
 */
function isTitleMatch(term, dataset) {
    if (!dataset || dataset.length === 0) return false;
    const cleanTerm = term.toLowerCase().trim();
    return dataset.some(d => {
        const title = toSafeString(d.title);
        return title.includes(cleanTerm);
    });
}

/**
 * Categorizes a search term into query types: 'AUTHOR', 'TITLE', 'INSTRUMENT', 'AI_QUERY', or 'KEYWORD'.
 * @param {string} rawTerm - Raw input search string.
 * @returns {{ type: string, term: string, words: Array<string> }} Classification payload object.
 */
export function classifyQuery(rawTerm) {
    const term = rawTerm.trim();
    const appState = typeof state !== 'undefined' ? state : window.state;
    const dataset = (appState && appState.allData) ? appState.allData : [];
    const words = term.split(/\s+/).filter(Boolean);

    if (isAuthorMatch(term, dataset)) return { type: 'AUTHOR', term, words };
    if (isTitleMatch(term, dataset)) return { type: 'TITLE', term, words };
    if (isInstrumentMatch(term, dataset)) return { type: 'INSTRUMENT', term, words };
    if (words.length > 1) return { type: 'AI_QUERY', term, words };

    return { type: 'KEYWORD', term, words };
}


/**
 * Executes a FAISS vector search via backend API, updates search trajectories, and refreshes plot filters and paths.
 * @returns {Promise<void>}
 */
export async function search() {
    // 1. RESET FAISS MEMORY SILENTLY BEFORE SEARCH
    state.flatSearchIds = null;

    const queryValue = document.getElementById("query")?.value || "";
    const goalValue = document.getElementById("goal")?.value || "";

    // 🛡️ STRICT GOAL CHECK
    const hasGoal = goalValue.trim() !== "";

    const stepValue = parseInt(document.getElementById("steps")?.value) || 3;
    const paperValue = parseInt(document.getElementById("papers")?.value) || 5;

    // FIX 1: Send all un-filtered IDs so FAISS searches the full vector space,
    // rather than being choked by a pre-filtered empty array.
    const validIds = (state.allData || []).map(d => String(d.chunk_id || d.id));

    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    try {
        const res = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: queryValue,
                goal: goalValue,
                steps: stepValue,
                k: paperValue,
                valid_ids: validIds
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Server Error (${res.status}): ${errText.slice(0, 150)}...`);
        }

        const payload = await res.json();

        // Goal & Anchor Point Resolution
        if (hasGoal && payload.goal_anchor) {
            const queryBase = String(payload.query_anchor).includes('_') ? String(payload.query_anchor).split('_').pop() : String(payload.query_anchor);
            const goalBase = String(payload.goal_anchor).includes('_') ? String(payload.goal_anchor).split('_').pop() : String(payload.goal_anchor);

            state.currentQueryPoint = state.allData.find(d => {
                const cid = String(d.chunk_id || d.id || "");
                const cBase = cid.includes('_') ? cid.split('_').pop() : cid;
                return cBase === queryBase;
            });
            state.currentGoalPoint = state.allData.find(d => {
                const cid = String(d.chunk_id || d.id || "");
                const cBase = cid.includes('_') ? cid.split('_').pop() : cid;
                return cBase === goalBase;
            });
        } else {
            state.currentQueryPoint = null;
            state.currentGoalPoint = null;
        }

        const nestedIds = payload.step_documents || [];
        const anchors = payload.path_anchors || [];
        const rawCoords = payload.path_coords || null;

        // Unwrap Payload IDs
        let resultList = [];
        if (Array.isArray(payload)) {
            resultList = payload;
        } else if (typeof payload === 'object' && payload !== null) {
            resultList = payload.results || payload.data || payload.documents || payload.top_k ||
                         payload.step_documents || payload.papers || payload.matches || payload.neighbors ||
                         payload.ids || payload.items || [];

            if (resultList.length === 0) {
                const firstArrayVal = Object.values(payload).find(val => Array.isArray(val) && val.length > 0);
                if (firstArrayVal) resultList = firstArrayVal;
            }
        }

        const rawIds = (Array.isArray(resultList) && !payload.goal_anchor ? resultList : nestedIds).flat().map(item => {
            if (typeof item === 'object' && item !== null) {
                const explicitId = item.chunk_id ?? item.id ?? item.doc_id ?? item.paper_id ?? item.target_id ?? item.node_id ?? item._id;
                if (explicitId !== undefined && explicitId !== null) return explicitId;

                const idKey = Object.keys(item).find(key => key.toLowerCase().includes('id'));
                return idKey ? item[idKey] : Object.values(item)[0];
            }
            return item;
        });

        const idSet = new Set();
        rawIds.filter(Boolean).forEach(rawId => {
            const strId = String(rawId);
            const baseId = strId.includes('_') ? strId.split('_').pop() : strId;

            idSet.add(strId);
            idSet.add(baseId);
            idSet.add(`chunk_${baseId}`);
            idSet.add(`metadata_${baseId}`);
        });

        if (idSet.size === 0) {
            if (hasGoal) updateBottomPanelTrajectory([]);
            state.currentPath = [];
            state.currentQueryPoint = null;
            state.currentGoalPoint = null;
            state.lastSearchTrajectory = null;
            state.flatSearchIds = null;
            if (typeof applyGlobalFilters === 'function') applyGlobalFilters(false);
            return;
        }

        // Assign FAISS memory
        if (!payload.goal_anchor) {
            state.flatSearchIds = idSet;
        } else {
            state.flatSearchIds = null;
        }

        // then render the UI update.
        if (typeof applyGlobalFilters === 'function') {
            applyGlobalFilters(false);
        }

        const titleResponse = await fetch('/api/titles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(idSet) })
        });
        const titleMap = await titleResponse.json();

        state.currentPath = [];

        if (hasGoal && payload.goal_anchor) {
            if (rawCoords && rawCoords.length > 0) {
                for (let i = 0; i < rawCoords.length; i++) {
                    state.currentPath.push({ step: i + 1, x: rawCoords[i][0], y: rawCoords[i][1] });
                }
            } else {
                for (let i = 0; i < anchors.length; i++) {
                    const anchorId = anchors[i];
                    const anchorBase = String(anchorId).includes('_') ? String(anchorId).split('_').pop() : String(anchorId);
                    const matchingDoc = state.allData.find(d => {
                        const cid = String(d.chunk_id || d.id || "");
                        const cBase = cid.includes('_') ? cid.split('_').pop() : cid;
                        return cBase === anchorBase;
                    });
                    if (matchingDoc) state.currentPath.push({ step: i + 1, x: matchingDoc.x, y: matchingDoc.y });
                }
            }
        }

        if (hasGoal && payload.goal_anchor) {
            const trajectorySequence = [];
            for (let index = 0; index < nestedIds.length; index++) {
                const stepArray = nestedIds[index];
                if (!stepArray || stepArray.length === 0) continue;

                const matchNode = (targetId) => {
                    const targetStr = String(targetId);
                    const targetBase = targetStr.includes('_') ? targetStr.split('_').pop() : targetStr;
                    return state.allData.find(d => {
                        const cid = String(d.chunk_id || d.id || "");
                        const cBase = cid.includes('_') ? cid.split('_').pop() : cid;
                        return cBase === targetBase;
                    });
                };

                const stepNodes = stepArray.map(id => matchNode(id)).filter(Boolean);
                const primaryId = anchors[index] || stepArray[0];
                const primaryNode = matchNode(primaryId) || {};
                const stepTitle = titleMap[primaryId] || primaryNode.title || `Step ${index + 1} Documents`;

                trajectorySequence.push({
                    stepIndex: index,
                    title: stepTitle,
                    papers: stepNodes,
                    primaryNode: primaryNode
                });
            }

            state.lastSearchTrajectory = trajectorySequence;
            if (typeof updateBottomPanelTrajectory === 'function') {
                updateBottomPanelTrajectory(trajectorySequence, "trajectory");
            }
        } else {
            state.lastSearchTrajectory = null;
        }

        // Draw canvas
        if (typeof draw === 'function') draw();

    } catch (error) {
        console.error('Search pipeline execution failed:', error);
    } finally {
        if (loader) loader.style.display = "none";
    }
}


/**
 * Clears current search trajectory paths, query/goal anchors, and resets active search filters.
 * @returns {void}
 */
export function clearSearchTrajectory() {
    state.currentPath = [];
    state.currentQueryPoint = null;
    state.currentGoalPoint = null;
    state.lastSearchTrajectory = null;

    state.flatSearchIds = null;

    updateBottomPanelTrajectory([]);
    applyGlobalFilters();
}


/**
 * Re-maps visualization spatial positions based on metadata topics fetched from backend.
 * @param {string} field - The target metadata field to base locations on.
 * @returns {void}
 */
export function mapTopicsToMetadataLocations(field) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    fetch(`/api/metadata-map?field=${encodeURIComponent(field)}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert("Mapping failed: " + data.error);
                return;
            }

            const newPositions = new Map(data.map(d => [String(d.chunk_id), d]));

            state.metadataAnchors = data.filter(d => d.type === field);
            state.metadataGroups = {};

            state.allData.forEach(node => {
                const id = String(node.chunk_id || node.id);
                const newPos = newPositions.get(id);

                if (node.type === field) {
                    node.x = -999999;
              } else if (newPos) {
                    if (newPos.type === 'chunk') {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = (Math.random() * 2.0) + 0.5;
                        node.x = newPos.x + (Math.cos(angle) * radius);
                        node.y = newPos.y + (Math.sin(angle) * radius);


                        node.meta_cluster_name = newPos.cluster_name;


                        const anchorKey = `${newPos.x}_${newPos.y}`;
                        if (!state.metadataGroups[anchorKey]) state.metadataGroups[anchorKey] = [];
                        state.metadataGroups[anchorKey].push({ x: node.x, y: node.y });

                    } else {
                        node.x = newPos.x;
                        node.y = newPos.y;
                    }
                }
            });

            state.allData = [...state.allData];


            if (typeof window.saveHistoryState === 'function') window.saveHistoryState();
            if (typeof resetZoom === 'function') resetZoom();
            if (typeof updateLegend === 'function') updateLegend();
            if (typeof rebuildClusterCentroids === 'function') rebuildClusterCentroids();

            import('../core/data.js').then(module => {
                if (module.applyGlobalFilters) module.applyGlobalFilters();
                import('../canvas/render.js').then(r => { if (r.draw) r.draw(); });
            });
        })
        .catch(err => { /* ... */ })
        .finally(() => { /* ... */ });
}


/**
 * Triggers topic mapping using the metadata field currently selected in the UI dropdown.
 * @returns {void}
 */
export function triggerMetadataMapping() {
    const select = document.getElementById('metadataFieldDropdown');
    const field = select ? select.value : 'method';
    mapTopicsToMetadataLocations(field);
}


/** Sends selected node IDs to backend to perform hierarchical sub-clustering on a specific cluster path.
 * @param {number|string} cId - Parent cluster identifier.
 * @param {string} [currentSubPath=""] - Existing sub-cluster path prefix.
 * @returns {Promise<void>}
 */
export async function triggerSubCluster(cId, currentSubPath = "") {
    const pathKey = currentSubPath === "" ? `${cId}` : `${cId}-${currentSubPath}`;
    const kValue = parseInt(document.getElementById(`subK-${pathKey}`).value) || 3;
    const method = document.getElementById(`subMethod-${pathKey}`).value;

    const targetNodes = state.filteredData.filter(d => d.cluster === cId && (d.sub_path || "") === currentSubPath);
    const targetIds = targetNodes.map(d => d.chunk_id || d.id);

    if (targetIds.length === 0) return;

    try {
        const biasText = document.getElementById('globalBiasInput')?.value || "";

    const response = await fetch('/api/subcluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ids: targetIds,
            k: kValue,
            method: method,
            bias_text: biasText
        })
    });

        const buffer = await response.arrayBuffer();
        const dataView = new DataView(buffer);
        const headerLen = dataView.getUint32(0, true);

        const headerDict = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buffer, 4, headerLen)));
        const labelsArray = new Int32Array(buffer, 4 + headerLen);

        const subClusterAssignments = {};
        headerDict.c.forEach((id, index) => subClusterAssignments[id] = labelsArray[index]);

        state.allData.forEach(node => {
            if (node.cluster !== cId || (node.sub_path || "") !== currentSubPath) return;
            const assignedVal = subClusterAssignments[node.chunk_id || node.id];
            node.sub_path = assignedVal !== undefined
                ? (currentSubPath === "" ? `${assignedVal}` : `${currentSubPath}-${assignedVal}`)
                : (currentSubPath === "" ? "-1" : `${currentSubPath}--1`);
        });

        if (state.globalClusterLabelMode !== 'none') fetchLabels(state.globalClusterLabelMode);

       if (!state.activeSplits) state.activeSplits = new Set();
        state.activeSplits.add(pathKey);

        // 1. Clear the scatter cache to force edges to remap to the new sub-clusters
        if (state.graphData) {
            state.graphData._scatterOverlayCache = null;
        }

        // 2. Use the pipeline from hierarchy.js to push the data changes globally
        import('../core/data.js').then(data => {
            // This recalculates state.filteredData and usually regenerates LODs
            if (typeof data.applyGlobalFilters === 'function') {
                data.applyGlobalFilters();
            }


            // 4. Redraw canvas
            import('../canvas/render.js').then(r => {
                if (typeof r.draw === 'function' && state.viewMode !== 'hierarchy') {
                    r.draw();
                }
            });
        });

    } catch (err) {
        console.error("Clustering failed:", err);
    } finally {
        if (typeof window.saveState === 'function' && !window.isRestoring) window.saveState();
        else if (typeof window.saveHistoryState === 'function' && !window.isRestoring) window.saveHistoryState();
        updateLegend();
    }
}


/**
 * Resets plot variables, clears custom mappings, resets node coordinates, and restores default visual state.
 * @returns {void}
 */
export function resetPlot() {
    const searchInput = document.getElementById("search");
    if (searchInput) searchInput.value = "";
    state.flatSearchIds = null;
    state.lastSearchTrajectory = null;
    state.droppedPins = [];

    if (state.hiddenClusters) state.hiddenClusters.clear();
    if (state.hiddenMetaClusters) state.hiddenMetaClusters.clear();
    if (state.hiddenPaths) state.hiddenPaths.clear();
    if (state.hiddenSubClusters) state.hiddenSubClusters.clear();
    if (state.activeSplits) state.activeSplits.clear();

    // PURGE GLOBAL METADATA & CHORD MAPPINGS
    state.metadataCategoryTags = {};
    state.metadataAnchors = [];
    state.metadataGroups = {};

    if (state.allData) {
        state.allData.forEach(d => {
            if (d.orig_x !== undefined) d.x = d.orig_x;
            if (d.orig_y !== undefined) d.y = d.orig_y;
            d.cluster = 0;
            delete d.sub_path;
            delete d.meta_cluster;
            delete d.meta_cluster_name;  // ✅ Delete metacluster string label
            delete d.metaCluster;         // ✅ Delete camelCase variant
            delete d.cluster_name;
            delete d.tag_sub_path;        // ✅ Delete active chord sub-path
        });
    }

    state.clusterLabels = {};
    if (state.subClusterLabels) state.subClusterLabels = {};
    if (state.clusterCentroids) state.clusterCentroids = {};


    // RE-INITIALIZE CHORD TOPOLOGY
    if (typeof window.initTopology === 'function') {
        window.initTopology();
    } else if (typeof window.updateChordTopology === 'function') {
        window.updateChordTopology();
    }

    // Clear chord DOM container if rendered
    const chordContainer = document.getElementById('chord-diagram') || document.getElementById('topology-container');
    if (chordContainer && state.viewMode === 'chord') {
        chordContainer.innerHTML = '';
    }

    // Execute strictly in order using existing handlers
    if (typeof resetZoom === 'function') resetZoom();
    if (typeof applyGlobalFilters === 'function') applyGlobalFilters();
    if (typeof rebuildClusterCentroids === 'function') rebuildClusterCentroids();
    if (typeof updateLegend === 'function') updateLegend();
    if (typeof draw === 'function') draw();
}


/**
 * Triggers backend dynamic K-Means metadata clustering for currently active/filtered data nodes.
 * @returns {Promise<void>}
 */
export async function calculateMetadataTags() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    try {
        // Grab the IDs of the currently active/filtered data on the map
        const validIds = [...new Set(state.filteredData.map(d => d.paper_id || d.PAPER_ID || d.id))];

        if (validIds.length === 0) {
            alert("No valid data points found to cluster.");
            if (loader) loader.style.display = "none";
            return;
        }

        console.log("Sending IDs to backend for true metadata clustering...");

        // Call the backend to run the actual K-Means clustering dynamically
        const response = await fetch('/api/cluster-all-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: validIds })
        });

        if (!response.ok) {
            throw new Error(`Server returned status: ${response.status}`);
        }

        const data = await response.json();

        // Save the generated groups into the global state expected by the UI panel
        state.metadataCategoryTags = data.tags || data;

        console.log("Metadata sections successfully clustered from backend!", state.metadataCategoryTags);
        alert("Metadata tags assigned by category!");

        // Auto-refresh the side panel so the tags immediately appear next to the headers
        const panel = document.getElementById("info");
        if (panel && !panel.innerHTML.includes("placeholder-text") && state.hoveredNode) {
            import('../components/ui.js').then(ui => ui.updatePanel(state.hoveredNode));
        }

    } catch (err) {
        console.error("Failed to calculate metadata tags:", err);
        alert("Failed to calculate metadata tags. Check browser console.");
    } finally {
        if (loader) loader.style.display = "none";
    }
}


/**
 * Sub-clusters nodes within a specific metadata tag context and updates chord diagram topologies and LLM context.
 * @param {string} tag - Target metadata tag label.
 * @param {string} safeTagId - Sanitized tag identifier for element DOM lookups.
 * @param {string|null} [targetSubPath=null] - Specific target sub-path to split.
 * @param {Array<string>|string|null} [targetTags=null] - List or single target tag filter override.
 * @param {string} [metaKey='tag'] - Object property key holding metadata.
 * @returns {Promise<void>}
 */
export async function triggerTagSubCluster(tag, safeTagId, targetSubPath = null, targetTags = null, metaKey = 'tag') {
    const kVal = document.getElementById(`tagSubK-${safeTagId}`)?.value || 3;
    const methodVal = document.getElementById(`tagSubMethod-${safeTagId}`)?.value || 'kmeans';

    // Normalize targetSubPath so we match accurately whether it's passed as '0' or 'Cluster 0'
    const cleanTarget = targetSubPath ? String(targetSubPath).replace(/^Cluster\s+/i, '') : null;

    // Build a lookup set matching your backend getmetatagsubcluster logic
    const matchSet = new Set(targetTags ? (Array.isArray(targetTags) ? targetTags : [targetTags]) : [tag]);

    // Universal matcher: checks single values or lists of tags
    const nodeMatchesTag = (node) => {
        const val = node[metaKey] !== undefined ? node[metaKey] : (node.tag || 'chunk');
        if (Array.isArray(val) || val instanceof Set) {
            return Array.from(val).some(t => matchSet.has(String(t)));
        }
        return val !== null && val !== undefined && matchSet.has(String(val));
    };

    // Gather ONLY the chunk_ids/ids belonging to this specific sub-path and metadata tag
    const matchingIds = state.allData
        .filter(node => {
            if (!nodeMatchesTag(node)) return false;
            if (cleanTarget) {
                const nodeSub = node.tag_sub_path ? String(node.tag_sub_path).replace(/^Cluster\s+/i, '') : null;
                if (nodeSub !== cleanTarget) return false;
            }
            return true;
        })
        .map(node => node.chunk_id || node.id);

    if (matchingIds.length === 0) {
        console.warn(`No nodes found matching tag: ${tag} and sub-path: ${targetSubPath}`);
        return;
    }

    // Send the matched IDs and metadata filter context to the backend
    const response = await fetch('/api/subcluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ids: matchingIds,
            k: parseInt(kVal),
            method: methodVal,
            target_tags: Array.from(matchSet),
            meta_key: metaKey
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Server error (${response.status}):`, errorText);
        return;
    }

    const buffer = await response.arrayBuffer();
    const dataView = new DataView(buffer);
    const headerLen = dataView.getUint32(0, true);

    const headerDict = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buffer, 4, headerLen)));
    const labelsArray = new Int32Array(buffer, 4 + headerLen);

    const subClusterAssignments = {};
    headerDict.c.forEach((id, index) => subClusterAssignments[id] = labelsArray[index]);


    // SYNC ASSIGNMENTS WITHOUT FLATTENING

    const paperToSubPath = {};

    // Assign directly to the specific nodes/chunks returned by the backend
    state.allData.forEach(node => {
        const rawId = node.chunk_id || node.id;
        const strId = String(rawId);

        // Safely check both string and raw representations
        const assignedVal = subClusterAssignments[strId] !== undefined
            ? subClusterAssignments[strId]
            : subClusterAssignments[rawId];

        if (assignedVal !== undefined) {
            const cleanSub = cleanTarget ? `${cleanTarget}.${assignedVal}` : `${assignedVal}`;
            node.tag_sub_path = cleanSub;

            // Store a fallback mapping for the parent paper
            if (node.paper_id) {
                paperToSubPath[node.paper_id] = cleanSub;
            }
        }
    });

    // Pass B: Sister text chunks that weren't directly clustered inherit their paper's subpath
    state.allData.forEach(node => {
        if (node.tag === 'chunk' && (node.tag_sub_path === undefined || node.tag_sub_path === null)) {
            if (node.paper_id && paperToSubPath[node.paper_id] !== undefined) {
                node.tag_sub_path = paperToSubPath[node.paper_id];
            }
        }
    });

    // GROUND-TRUTH REBUILD FOR CHORD DIAGRAM
    if (!state.metadataCategoryTags) state.metadataCategoryTags = {};
    if (!state.metadataCategoryTags["_paper_mapping"]) state.metadataCategoryTags["_paper_mapping"] = {};

    // Step A: Collect all unique active sub-cluster paths currently existing in this category
    const activeSubPaths = new Set();
    state.allData.forEach(node => {
        if (nodeMatchesTag(node) && node.tag_sub_path !== undefined && node.tag_sub_path !== null) {
            const cleanSub = String(node.tag_sub_path).replace(/^Cluster\s+/i, '');
            activeSubPaths.add(cleanSub);
        }
    });

    // Rebuild category definitions.
    // We register BOTH short ("Cluster 0") and full ("Tag_Cluster 0") keys to prevent lookup bugs.
    const palette = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe"];
    const existingTags = state.metadataCategoryTags[tag] || {};
    const newSubClusterTags = {};

    let colorIdx = 0;
    Array.from(activeSubPaths).sort().forEach(subPath => {
        const shortLabel = `Cluster ${subPath}`;
        const fullLabel = `${tag}_${shortLabel}`;

        const existingColor = existingTags[shortLabel]?.color || existingTags[fullLabel]?.color;
        const assignedColor = existingColor || palette[colorIdx % palette.length] || "#3cb44b";

        const tagObj = { tag: shortLabel, full_tag: fullLabel, color: assignedColor };

        // Populate both keys so any UI script finds what it's looking for
        newSubClusterTags[shortLabel] = tagObj;
        newSubClusterTags[fullLabel] = tagObj;

        colorIdx++;
    });

    state.metadataCategoryTags[tag] = newSubClusterTags;

    // Clean out stale chord mappings for this category across all papers
    const paperMapping = state.metadataCategoryTags["_paper_mapping"];
    Object.keys(paperMapping).forEach(pId => {
        paperMapping[pId] = paperMapping[pId].filter(t => t !== tag && !String(t).startsWith(`${tag}_`));
    });

    // link BOTH metadata and text chunks to the active sub-clusters
    state.allData.forEach(node => {
        const isTargetMeta = nodeMatchesTag(node);
        const isRelatedChunk = (node.tag === 'chunk' && paperToSubPath[node.paper_id] !== undefined);

        if (!isTargetMeta && !isRelatedChunk) return;

        const pId = String(node.paper_id || node.PAPER_ID || node.id);
        if (!pId || pId === "undefined") return;

        if (!paperMapping[pId]) paperMapping[pId] = [];

        const currentSubPath = isTargetMeta ? node.tag_sub_path : paperToSubPath[node.paper_id];
        const cleanSub = currentSubPath ? String(currentSubPath).replace(/^Cluster\s+/i, '') : null;
        const fullTagKey = cleanSub ? `${tag}_Cluster ${cleanSub}` : tag;

        if (!paperMapping[pId].includes(fullTagKey)) {
            paperMapping[pId].push(fullTagKey);
        }
    });


    buildTagDropdownUI();


    // Pass the tag down to the backend to frame the LLM summary prompt context
    import('./api.js').then(api => {
        if (typeof api.fetchLabels === 'function') {
            api.fetchLabels('summary', tag);
            console.log(tag);
        }
    });


    // UNIVERSAL VISUALIZATION REFRESH
    if (state.viewMode === 'chord') {
        if (typeof window.initTopology === 'function') {
            window.initTopology();
        } else if (typeof window.updateChordTopology === 'function') {
            window.updateChordTopology();
        }

        // Save state after tag subclustering finishes updating the view
        if (typeof window.saveState === 'function' && !window.isRestoring) {
            window.saveState();
        } else if (typeof window.saveHistoryState === 'function' && !window.isRestoring) {
            window.saveHistoryState();
        }

        const chordContainer = document.getElementById('chord-diagram') || document.getElementById('topology-container');
        if (chordContainer) {
            chordContainer.innerHTML = '';
        }

        if (typeof window.draw === 'function') {
            requestAnimationFrame(() => window.draw());
        }
    } else {
        // Fallback refresh for scatter, network, or 3D views when not in chord mode
        if (typeof window.updateVisualization === 'function') {
            requestAnimationFrame(() => window.updateVisualization());
        } else if (typeof window.draw === 'function') {
            requestAnimationFrame(() => window.draw());
        }
    }
}



/**
 * Extracts semantic entities, relationships, and communities using LLM API or local keyword fallback for GraphRAG topology.
 * @param {Array<Object>} [clusterNodes=[]] - Node objects contained within target cluster.
 * @param {string} [apiKey=""] - Optional API key for LLM provider.
 * @returns {Promise<{ nodes: Array<Object>, edges: Array<Object>, community: string }>} Constructed graph structure.
 */
export async function generateGraphRAGTopologyWithAI(clusterNodes = [], apiKey = "") {
    if (!clusterNodes.length) return { nodes: [], edges: [], communities: {} };

    // Prepare a condensed sample of texts to stay within token limits
    const sampleTexts = clusterNodes
        .slice(0, 8)
        .map((d, i) => `[Doc ${d.chunk_id || d.id || i}]: ${extractTextPayload(d).slice(0, 200)}`)
        .join("\n\n");

    const prompt = `You are a GraphRAG semantic extraction engine. Analyze the following document samples and extract the core conceptual entities and their relationships.
    
    Return ONLY a valid JSON object with this exact schema:
    {
      "community_label": "2-4 word overarching theme",
      "entities": [
        { "id": "EntityName", "type": "Concept|Person|Technology|Metric", "importance": 1-10 }
      ],
      "relationships": [
        { "source": "Entity1", "target": "Entity2", "relation": "how they connect", "weight": 1-5 }
      ]
    }

    Document Samples:
    ${sampleTexts}`;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo-0125",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: "You are a precise data graph extraction API. Output strict JSON only." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2
            })
        });

        if (!response.ok) throw new Error(`GraphRAG API Error: ${response.statusText}`);
        const data = await response.json();
        const parsedGraph = JSON.parse(data.choices[0]?.message?.content || "{}");

        // Convert LLM output into standardized visualization nodes and edges
        const nodes = (parsedGraph.entities || []).map(e => ({
            id: String(e.id).trim(),
            label: String(e.id).trim(),
            type: e.type || 'entity',
            weight: e.importance || 5,
            community: parsedGraph.community_label || "General Topology"
        }));

        const edges = (parsedGraph.relationships || []).map(r => ({
            source: String(r.source).trim(),
            target: String(r.target).trim(),
            label: r.relation || "",
            weight: r.weight || 1
        }));

        // Add a central anchor node for the community theme
        if (parsedGraph.community_label) {
            nodes.unshift({
                id: parsedGraph.community_label,
                label: parsedGraph.community_label,
                type: 'community-root',
                weight: 15,
                isAnchor: true
            });

            // Connect primary entities to the root community anchor
            nodes.slice(1, 6).forEach(n => {
                edges.push({ source: parsedGraph.community_label, target: n.id, weight: 2, isHierarchy: true });
            });
        }

        return { nodes, edges, community: parsedGraph.community_label };

    } catch (error) {
        console.warn("[api.js] GraphRAG AI extraction failed, falling back to local topological co-occurrence:", error);

        // Fallback: Convert local keyword NLP into a topological entity graph
        const combinedText = clusterNodes.map(extractTextPayload).join(" ");
        const topKeywords = extractKeywords(combinedText, 12);

        const nodes = topKeywords.map((k, idx) => ({
            id: k.word.toUpperCase(),
            label: k.word.toUpperCase(),
            type: idx === 0 ? 'community-root' : 'entity',
            weight: Math.min(Math.max(k.count, 3), 12)
        }));

        const edges = [];
        for (let i = 1; i < nodes.length; i++) {
            edges.push({ source: nodes[0].id, target: nodes[i].id, weight: 1 });
            if (i < nodes.length - 1 && Math.random() > 0.4) {
                edges.push({ source: nodes[i].id, target: nodes[i+1].id, weight: 1 });
            }
        }

        return { nodes, edges, community: nodes[0]?.label || "Topology Cluster" };
    }
}


/**
 * Organizes current dataset nodes visually into grouped spatial "islands" according to a designated metadata key.
 * @param {string} [metaKey='tag'] - Metadata key used for spatial grouping.
 * @returns {void}
 */
export function mapToMetaIslands(metaKey = 'tag') {
    if (!state.allData || state.allData.length === 0) return;

    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    try {
        // Snapshot original positions AND original cluster assignments
        state.allData.forEach(d => {
            if (d.orig_x === undefined) d.orig_x = d.x;
            if (d.orig_y === undefined) d.orig_y = d.y;
            if (d.orig_cluster === undefined) d.orig_cluster = d.cluster;
            if (d.orig_cluster_name === undefined) d.orig_cluster_name = d.cluster_name;

            d.x = d.orig_x;
            d.y = d.orig_y;
        });

        // Group nodes by metadata & isolate Noise / Chunks / Papers
        const groups = new Map();
        const noiseNodes = [];

        state.allData.forEach(node => {
            const rawVal = node[metaKey] ?? node.tag ?? node.section ?? node.type;

            // If completely missing metadata, treat as Noise
            if (!rawVal || String(rawVal).trim() === '') {
                noiseNodes.push(node);
                return;
            }

            let groupName = Array.isArray(rawVal) ? String(rawVal[0]) : String(rawVal);

            // Strip "METADATA_", "METADAT_", or "META_" prefixes from the start
            groupName = groupName.replace(/^(metadata_|metadat_|meta_)/i, '').trim();


            const lowerName = groupName.toLowerCase();
            if (
                lowerName === 'noise' ||
                lowerName === 'uncategorized' ||
                lowerName.startsWith('chunks_') ||
                lowerName.startsWith('paper_')
            ) {
                noiseNodes.push(node);
                return;
            }

            if (!groups.has(groupName)) {
                groups.set(groupName, []);
            }
            groups.get(groupName).push(node);
        });

        const uniqueMetaKeys = Array.from(groups.keys()).sort();
        const newAnchors = [];
        const newCentroids = {};
        state.metadataGroups = {};

        // 3. Calculate spatial regions ONLY for valid metadata groups
        uniqueMetaKeys.forEach((groupName, idx) => {
            const nodes = groups.get(groupName);
          const standardizedName = groupName.charAt(0).toUpperCase() + groupName.slice(1);

            // Calculate local center of mass in the original layout
            let sumX = 0, sumY = 0;
            nodes.forEach(n => {
                sumX += n.x;
                sumY += n.y;
            });
            const regionCenterX = sumX / nodes.length;
            const regionCenterY = sumY / nodes.length;

            // Store anchor for UI legend and canvas text labels
            newAnchors.push({
                chunk_id: `meta_region_${idx}`,
                cluster_name: standardizedName,
                type: metaKey,
                x: regionCenterX,
                y: regionCenterY
            });

            newCentroids[idx] = { x: regionCenterX, y: regionCenterY, name: standardizedName };

            const anchorKey = `${regionCenterX}_${regionCenterY}`;
            state.metadataGroups[anchorKey] = [];

            nodes.forEach(node => {
                node.meta_cluster_name = standardizedName;
                node.cluster_name = standardizedName;
                node.cluster = idx;
                state.metadataGroups[anchorKey].push({ x: node.x, y: node.y });
            });
        });

        // 4. Assign all isolated noise/chunks/papers to the global Noise cluster (-1)
        noiseNodes.forEach(node => {
            node.meta_cluster_name = 'NOISE';
            node.cluster_name = 'NOISE';
            node.cluster = -1;
        });
    // Sync state and trigger redraws
        if (!['chord', 'network', 'hierarchy'].includes(state.viewMode)) {
            state.viewMode = 'metaregions';
        }

        state.metadataAnchors = newAnchors;
        state.clusterCentroids = newCentroids;

        if (typeof window.saveHistoryState === 'function') window.saveHistoryState();

        import('../canvas/events.js').then(e => { if (typeof e.resetZoom === 'function') e.resetZoom(); });
        import('../core/data.js').then(d => { if (typeof d.applyGlobalFilters === 'function') d.applyGlobalFilters(); });
        import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });

    } catch (err) {
        console.error("Failed to generate Meta-regions layout:", err);
    } finally {
        if (loader) loader.style.display = "none";
    }
}
// Expose globally for UI button onclick handlers


export { buildKeywordNetwork };

/**
 * Calls an AI endpoint (e.g., OpenAI) to generate a short semantic label for a cluster of texts.
 * @param {Array<string>} clusterTexts - Array of text snippets in the cluster
 * @param {string} apiKey - Your API key (optional if using a backend proxy)
 * @returns {Promise<string>} - The AI-generated cluster label
 */
export async function generateClusterLabelWithAI(clusterTexts = [], apiKey = "") {
    if (!clusterTexts.length) return "Unlabeled Cluster";

    // Combine top samples to save tokens
    const sampleText = clusterTexts
        .slice(0, 5)
        .map(t => `- ${extractTextPayload(t).slice(0, 150)}`)
        .join("\n");

    const prompt = `Analyze these related text snippets and generate a single, highly descriptive 2 to 4-word categorical label that summarizes their shared theme:\n\n${sampleText}\n\nLabel:`;

    try {
        // Change URL to your backend proxy or OpenAI endpoint
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are a data taxonomy expert. Output only the short label without quotes or punctuation." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 15,
                temperature: 0.3
            })
        });

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const data = await response.json();
        return data.choices[0]?.message?.content?.trim() || "Generated Cluster";

    } catch (error) {
        console.warn("[api.js] AI Labeling failed, falling back to top keyword:", error);

        // Fallback: If the API fails, use the top keyword from local NLP
        const combinedText = clusterTexts.map(extractTextPayload).join(" ");
        const topKeywords = extractKeywords(combinedText, 1);
        return topKeywords[0] ? topKeywords[0].word.toUpperCase() : "Cluster";
    }
}



/**
 * Automatically processes and labels clusters of data using either local keywords or AI.
 * @param {string} mode - 'keywords' for local network, 'ai' for LLM labeling
 * @param {Array<any>} targets - Data targets to process
 */
export async function autoLabelAllClusters(mode = 'keywords', targets = []) {
    console.log(`[api.js] autoLabelAllClusters running in '${mode}' mode for ${targets.length} targets.`);

    let networkData;

    if (mode === 'ai') {
        // Group targets into a default cluster if not already grouped, and label via LLM
        const aiLabel = await generateClusterLabelWithAI(targets);
        console.log(`[api.js] AI generated label: "${aiLabel}"`);

        // Build base network and inject the AI label as a root theme node
        networkData = buildKeywordNetwork(targets);
        networkData.nodes.unshift({
            id: 'ai-root-label',
            label: aiLabel,
            type: 'ai-cluster',
            weight: 10
        });
    } else {
        // Standard fast local keyword extraction
        networkData = buildKeywordNetwork(targets);
    }

    // Automatically update the global application state if available
    if (typeof state !== 'undefined' && state) {
        state.graphData = networkData;
        state.viewMode = 'network';
    }

    // Trigger canvas re-rendering
    if (typeof draw === 'function') {
        requestAnimationFrame(() => draw());
    }

    return networkData;
}


/**
 * Clears active lasso selection boundaries, selected node lists, and reapplies filters to the canvas.
 * @returns {void}
 */
export function clearLassoSelection() {

    state.selectedNodes = [];          // Clear out the array of selected nodes
    state.selectionBox = null;         // Clear the visual boundary coordinates/polygon
    state.selectionModeActive = false; // Turn off the active selection mode toggle[cite: 3]


    applyGlobalFilters();
        draw();

}


/**
 * Submits active/selected screen data embeddings and text query to backend AI query analysis endpoint.
 * @param {string} queryText - Natural language query string.
 * @returns {Promise<Object|undefined>} API response object containing AI analysis results.
 */
export async function aiQuery(queryText) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    try {
        // Priority order: Use active lasso selections first, then everything currently displayed/filtered on screen, then fallback to allData
        const sourceData = (state.selectedNodes && state.selectedNodes.length > 0)
            ? state.selectedNodes
            : (state.filteredData && state.filteredData.length > 0)
                ? state.filteredData
                : (state.allData || []);

        // Helper to safely extract an ID regardless of how the database/metadata formatted it
        const getNodeId = (d) => {
            if (!d) return null;
            const meta = d.metadata || d.meta || d.attributes || {};
            return d.chunk_id || d.paper_id || d.PAPER_ID || d.id || d.ID || d.doc_id || meta.id || meta.ID || null;
        };

        // Deduplicate and safely extract all valid IDs from the screen data
        const validIds = [...new Set(sourceData.map(getNodeId).filter(Boolean))];
        console.log(validIds);
        // Pre-flight check before hitting the API
        if (validIds.length === 0) {
            alert("No items are currently selected or visible on screen to analyze.");
            return;
        }

        // Extract current embeddings linked to their respective IDs
        const currentEmbeddings = sourceData.map(d => {
            const id = getNodeId(d);
            return {
                id: id,
                embedding: d.embedding || d.vector || []
            };
        }).filter(item => item.id);

        const res = await fetch("/api/ai-query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: queryText,
                valid_ids: validIds,
                embeddings: currentEmbeddings
            })
        });

        if (!res.ok) {
            throw new Error(`Server returned status: ${res.status}`);
        }

        const payload = await res.json();
        console.log("AI Query execution successful:", payload);

        displayAIResponse(payload);
        return payload;

    } catch (error) {
        console.error('AI Query execution failed:', error);
    } finally {
        if (loader) loader.style.display = "none";
    }
}


/**
 * Formats and renders the AI response payload into the DOM container.
 * @param {string|Object} payload - Response object or string content returned by AI query.
 * @returns {void}
 */
export function displayAIResponse(payload) {
    const box = document.getElementById('aiResponseBox');
    const content = document.getElementById('aiResponseContent');

    if (!box || !content) {
        console.warn("AI Response Box elements not found in DOM.");
        return;
    }

    // Safely extract text from common API payload formats
    let displayHtml = "";
    if (typeof payload === 'string') {
        displayHtml = payload;
    } else if (payload && typeof payload.answer === 'string') {
        displayHtml = payload.answer;
    } else if (payload && typeof payload.response === 'string') {
        displayHtml = payload.response;
    } else if (payload && typeof payload.result === 'string') {
        displayHtml = payload.result;
    } else {
        // Fallback: Pretty-print the raw JSON payload
        displayHtml = `<pre style="margin: 0; font-family: monospace; color: #a5d6ff;">${JSON.stringify(payload, null, 2)}</pre>`;
    }

    // Inject content and make the box visible
    content.innerHTML = displayHtml;
    box.style.display = "block";
}


/**
 * Computes the shortest path of nodes between startNode and endNode using Breadth-First Search (BFS).
 * @param {Object|string} startNode - Starting graph node or ID.
 * @param {Object|string} endNode - Ending graph node or ID.
 * @param {Object} graphData - Graph object containing `edges`/`links` and `nodes`.
 * @returns {Array<Object>} Ordered list of node objects representing the path.
 */
export function findShortestNetworkPath(startNode, endNode, graphData) {
    if (!startNode || !endNode || !graphData) return [];

    const getNodeKey = (n) => {
        if (!n) return null;
        const raw = n.rawRef || n;
        const meta = raw.metadata || raw.meta || {};
        return String(raw.chunk_id || raw.id || raw.node_id || raw.paper_id || meta.id || raw);
    };

    const startKey = getNodeKey(startNode);
    const endKey = getNodeKey(endNode);

    if (!startKey || !endKey) return [];
    if (startKey === endKey) return [startNode];

    const rawEdges = graphData.edges || graphData.links || [];
    if (!rawEdges.length) return [];

    // Build Adjacency List
    const adj = new Map();
    rawEdges.forEach(edge => {
        const u = getNodeKey(edge.source);
        const v = getNodeKey(edge.target);
        if (u && v && u !== v) {
            if (!adj.has(u)) adj.set(u, []);
            if (!adj.has(v)) adj.set(v, []);
            adj.get(u).push(v);
            adj.get(v).push(u);
        }
    });

    if (!adj.has(startKey) || !adj.has(endKey)) return [];

    // Execute Breadth-First Search (BFS)
    const queue = [[startKey]];
    const visited = new Set([startKey]);
    let foundKeys = null;

    while (queue.length > 0) {
        const currentPath = queue.shift();
        const currentKey = currentPath[currentPath.length - 1];

        if (currentKey === endKey) {
            foundKeys = currentPath;
            break;
        }

        const neighbors = adj.get(currentKey) || [];
        for (const nbrKey of neighbors) {
            if (!visited.has(nbrKey)) {
                visited.add(nbrKey);
                queue.push([...currentPath, nbrKey]);
            }
        }
    }

    if (!foundKeys) return [];

    // Map matched keys back to node objects with spatial coordinates (x, y)
    const nodeLookup = new Map();
    const sources = [...(state.allData || []), ...(graphData.nodes || [])];

    sources.forEach(n => {
        const k = getNodeKey(n);
        if (k && !nodeLookup.has(k)) nodeLookup.set(k, n);
    });

    return foundKeys.map(k => nodeLookup.get(k)).filter(Boolean);
}


/**
 * Groups and layouts nodes visually into spatial "islands" partitioned by dataset source origin.
 * @returns {void}
 */
export function mapToDatasetIslands() {
    if (!state.allData || state.allData.length === 0) return;

    const loader = document.getElementById('loader');
    if (loader) loader.style.display = "flex";

    try {
        // Snapshot original coordinates & cluster assignments safely
        state.allData.forEach(d => {
            if (d.orig_x === undefined) d.orig_x = d.x;
            if (d.orig_y === undefined) d.orig_y = d.y;
            if (d.orig_cluster === undefined) d.orig_cluster = d.cluster;
            if (d.orig_cluster_name === undefined) d.orig_cluster_name = d.cluster_name;

            d.x = d.orig_x;
            d.y = d.orig_y;
        });

        // Convert hiddenDatasets entries to string for type-safe lookups
        const hiddenSetStrings = new Set(
            Array.from(state.hiddenDatasets || []).map(id => String(id))
        );

        //  Group nodes by enabled datasets
        const groups = new Map();
        const noiseNodes = [];

        state.allData.forEach(node => {
            // Check flat properties first (binary format), then nested metadata
            const meta = node.metadata || node.meta || node.attributes || node.properties || {};

            // Prioritize top-level flat properties assigned during decodeBinaryPayload
            const rawVal = node.dataset ?? node.db_source ?? node.dataset_id ?? node.db ??
                           meta.dataset ?? meta.db_source ?? meta.dataset_id ?? meta.db;

            // If dataset is missing OR explicitly marked hidden in state.hiddenDatasets
            if (rawVal === undefined || rawVal === null || rawVal === '' || hiddenSetStrings.has(String(rawVal))) {
                noiseNodes.push(node);
                return;
            }

            // Standardize dataset group name format
            const groupName = `Dataset ${rawVal}`.trim();

            if (!groups.has(groupName)) {
                groups.set(groupName, []);
            }
            groups.get(groupName).push(node);
        });

        const uniqueDatasetKeys = Array.from(groups.keys()).sort();
        const newAnchors = [];
        const newCentroids = {};

        // Reset global metadata groups for this view
        state.metadataGroups = {};

        // Calculate spatial regions ONLY for active datasets
        uniqueDatasetKeys.forEach((groupName, idx) => {
            const nodes = groups.get(groupName);

            let sumX = 0, sumY = 0;
            nodes.forEach(n => {
                sumX += n.x;
                sumY += n.y;
            });
            const regionCenterX = sumX / nodes.length;
            const regionCenterY = sumY / nodes.length;

            newAnchors.push({
                chunk_id: `dataset_region_${idx}`,
                cluster_name: groupName,
                type: 'dataset',
                x: regionCenterX,
                y: regionCenterY
            });

            newCentroids[idx] = { x: regionCenterX, y: regionCenterY, name: groupName };

            const anchorKey = `${regionCenterX}_${regionCenterY}`;
            state.metadataGroups[anchorKey] = [];

            nodes.forEach(node => {
                node.meta_cluster_name = groupName;
                node.cluster_name = groupName;
                node.cluster = idx;
                state.metadataGroups[anchorKey].push({ x: node.x, y: node.y });
            });
        });

        // Send hidden dataset points or orphans to global Noise cluster (-1)
        noiseNodes.forEach(node => {
            node.meta_cluster_name = 'NOISE';
            node.cluster_name = 'NOISE';
            node.cluster = -1;
        });

        // Sync state, rebuild centroids, and trigger redraws safely
        if (!['chord', 'network', 'hierarchy'].includes(state.viewMode)) {
            state.viewMode = 'datasetregions';
        }

        state.metadataAnchors = newAnchors;
        state.clusterCentroids = newCentroids;

        // Force downstream visual updates
        if (typeof rebuildClusterCentroids === 'function') rebuildClusterCentroids();
        if (typeof window.saveHistoryState === 'function') window.saveHistoryState();

        // Dynamically import visualization components if module system is active
        import('../canvas/events.js').then(e => { if (typeof e.resetZoom === 'function') e.resetZoom(); }).catch(() => {});
        import('../core/data.js').then(d => { if (typeof d.applyGlobalFilters === 'function') d.applyGlobalFilters(); }).catch(() => {});

        import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); }).catch(() => {});

    } catch (err) {
        console.error("Failed to generate Dataset-regions layout:", err);
    } finally {
        if (loader) loader.style.display = "none";
    }
}
