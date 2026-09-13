import { state } from './state.js';
import { draw } from '../canvas/render.js';
import {updatePanel} from "../components/meta_panel.js";
import {drawHierarchy} from "../canvas/hierarchy.js";

if (typeof window !== "undefined") {
    window.toggleMetadataFilter = toggleMetadataFilter;
    window.toggleSubClusterFilter = toggleSubClusterFilter;
}


/**
 * Determines whether a given subcluster key matches any entry in the hidden subclusters set,
 * utilizing normalized key matching and suffix/prefix comparisons.
 *
 * @param {string|number} key - The subcluster identifier to evaluate.
 * @param {Set<string>|null} [normalizedHiddenSet=null] - Optional pre-normalized set of hidden keys to optimize checks.
 * @returns {boolean} True if key matches a hidden subcluster, false otherwise.
 */
export function isSubClusterMatch(key, normalizedHiddenSet = null) {
    if (!key || !state.hiddenSubClusters || state.hiddenSubClusters.size === 0) return false;
    if (state.hiddenSubClusters.has(key)) return true;

    const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '_').replace(/cluster_/g, '').replace(/cluster-/g, '');
    const nKey = norm(key);

    if (normalizedHiddenSet) {
        if (normalizedHiddenSet.has(nKey)) return true;
        for (const nHidden of normalizedHiddenSet) {
            if (nKey.endsWith('_' + nHidden) || nHidden.endsWith('_' + nKey)) {
                return true;
            }
        }
    } else {
        for (const hidden of state.hiddenSubClusters) {
            const nHidden = norm(hidden);
            if (nKey === nHidden || nKey.endsWith('_' + nHidden) || nHidden.endsWith('_' + nKey)) {
                return true;
            }
        }
    }
    return false;
}


/**
 * Checks whether a single data node belongs directly to a hidden subcluster based on its tag sub-path,
 * sub-cluster, or meta-cluster attributes.
 *
 * @param {Object} node - The data node object to check.
 * @param {Set<string>|null} [normalizedHiddenSet=null] - Optional pre-normalized set of hidden keys for optimization.
 * @returns {boolean} True if the node resides within a hidden subcluster, false otherwise.
 */
export function isNodeInHiddenSubCluster(node, normalizedHiddenSet = null) {
    if (!state.hiddenSubClusters || state.hiddenSubClusters.size === 0) return false;

    if (node.tag_sub_path !== undefined && node.tag_sub_path !== null) {
        const rawSub = String(node.tag_sub_path);
        const cleanSub = rawSub.replace(/^Cluster\s+/i, '');
        const tag = node.tag || 'chunk';

        const possibleKeys = [
            rawSub,
            cleanSub,
            `Cluster ${cleanSub}`,
            `${tag}_Cluster ${cleanSub}`,
            `${tag}_${cleanSub}`
        ];

        for (const key of possibleKeys) {
            if (isSubClusterMatch(key, normalizedHiddenSet)) return true;
        }
    }

    const otherKeys = [node.sub_cluster, node.sub_path, node.cluster_name, node.meta_cluster, node.meta_cluster_name];
    for (const k of otherKeys) {
        if (k && isSubClusterMatch(String(k), normalizedHiddenSet)) return true;
    }

    return false;
}


/**
 * Scans metadata paper topology mappings and all global data nodes to aggregate paper IDs
 * associated with active hidden metadata subclusters.
 *
 * @returns {Set<string>} A set of paper ID strings marked as hidden by active metadata subcluster filters.
 */
export function getHiddenMetadataPaperIds() {
    const hiddenPaperIds = new Set();
    if (!state.hiddenSubClusters || state.hiddenSubClusters.size === 0) {
        return hiddenPaperIds;
    }
    // Standardized normalization rules to guarantee match accuracy across UI configurations
    const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '_').replace(/cluster_/g, '').replace(/cluster-/g, '');

    // Pre-calculate normalized representations of all hidden subclusters
    const normalizedHidden = new Set();
    state.hiddenSubClusters.forEach(hidden => {
        normalizedHidden.add(norm(hidden));
    });

    const isMatch = (key) => isSubClusterMatch(key, normalizedHidden);

    // Check ground-truth chord and paper topology mappings
    const paperMapping = state.metadataCategoryTags?.["_paper_mapping"];
    if (paperMapping) {
        Object.entries(paperMapping).forEach(([pId, tagKeys]) => {
            if (Array.isArray(tagKeys)) {
                for (const key of tagKeys) {
                    if (isMatch(key)) {
                        hiddenPaperIds.add(String(pId));
                        break;
                    }
                }
            }
        });
    }

    // Direct check on allData nodes to safely intercept standalone structural modifications
    if (state.allData) {
        state.allData.forEach(node => {
            const pId = String(node.paper_id || node.PAPER_ID || node.id);
            if (!pId || pId === "undefined" || hiddenPaperIds.has(pId)) return;

            if (isNodeInHiddenSubCluster(node, normalizedHidden)) {
                hiddenPaperIds.add(pId);
            }
        });
    }

    return hiddenPaperIds;
}


/**
 * Toggles the hidden visibility state of a target subcluster key and updates global dataset filters.
 *
 * @param {string|number} subClusterKey - Unique key identifier for the target subcluster.
 * @returns {void}
 */
export function toggleSubClusterFilter(subClusterKey) {
    if (!state.hiddenSubClusters) state.hiddenSubClusters = new Set();
    if (state.hiddenSubClusters.has(subClusterKey)) {
        state.hiddenSubClusters.delete(subClusterKey);
    } else {
        state.hiddenSubClusters.add(subClusterKey);
    }
    applyGlobalFilters();
}


/**
 * Toggles a metadata filter key (tag, section, or meta-cluster), cascading visibility state changes
 * down to child tags and reapplying global data filters.
 *
 * @param {string} key - The metadata identifier key to toggle.
 * @param {string} [setType='tags'] - The target filter collection type ('tags' | 'sections' | 'clusters').
 * @returns {void}
 */
export function toggleMetadataFilter(key, setType = 'tags') {
    if (!state.hiddenMetaClusters) state.hiddenMetaClusters = new Set();
    if (!state.hiddenMetadataTags) state.hiddenMetadataTags = new Set();
    if (!state.hiddenMetadataSections) state.hiddenMetadataSections = new Set();

    let targetSet = state.hiddenMetadataTags;
    if (setType === 'sections') targetSet = state.hiddenMetadataSections;
    if (setType === 'clusters') targetSet = state.hiddenMetaClusters;

    // Determine if we are hiding or showing the parent key
    const isHiding = !targetSet.has(key);

    if (isHiding) {
        targetSet.add(key);
    } else {
        targetSet.delete(key);
    }

    // Look up the specific tags that belong to this key to toggle them in sync.
    const childTags = state.metadataCategoryTags ? state.metadataCategoryTags[key] : [];

    if (Array.isArray(childTags)) {
        childTags.forEach(tagKey => {
            if (isHiding) {
                state.hiddenMetadataTags.add(tagKey);
            } else {
                state.hiddenMetadataTags.delete(tagKey);
            }
        });
    }

    // automatically filtering out the respective chunks and papers.
    applyGlobalFilters();
}


/**
 * Evaluates the full dataset against active UI filters (search keywords, year sliders, selection lassos,
 * metadata tags, subclusters, datasets, and spatial paths) to produce the filtered dataset, updating
 * canvas renders, list views, and history states.
 *
 * @param {boolean} [skipDraw=false] - If true, skips triggering canvas redraw.
 * @param {boolean} [skipHistory=false] - If true, skips pushing to the browser/app history stack.
 * @returns {void}
 */
export function applyGlobalFilters(skipDraw = false, skipHistory = false) {
    if (!state.allData || state.allData.length === 0) return;
    const searchKeyword = document.getElementById('search')?.value.toLowerCase().trim() || "";
    let startYear = parseInt(document.getElementById('yearStart')?.value) || 1960;
    let endYear = parseInt(document.getElementById('yearEnd')?.value) || 2026;

    if (startYear > 0 && startYear < 100) startYear += 2000;
    if (endYear > 0 && endYear < 100) endYear += 2000;

    const searchBases = new Set();
    if (state.flatSearchIds && state.flatSearchIds.size > 0) {
        state.flatSearchIds.forEach(id => {
            const base = String(id).includes('_') ? String(id).split('_').pop() : String(id);
            if (base) searchBases.add(base);
        });
    }

    // Precompute Lasso/Box Selection IDs safely before the loop
    const lassoIds = new Set();
    if (state.lassoFilterActive && state.selectedNodes && state.selectedNodes.length > 0) {
        state.selectedNodes.forEach(node => {
            lassoIds.add(String(node.chunk_id || node.id));
        });
    }

    if (!state.hiddenMetaClusters) state.hiddenMetaClusters = new Set();
    if (!state.hiddenMetadataTags) state.hiddenMetadataTags = new Set();
    if (!state.hiddenMetadataSections) state.hiddenMetadataSections = new Set();
    if (!state.hiddenClusters) state.hiddenClusters = new Set();
    if (!state.hiddenSubClusters) state.hiddenSubClusters = new Set();
    if (!state.hiddenInstruments) state.hiddenInstruments = new Set();
    if (!state.hiddenDatasets) state.hiddenDatasets = new Set();

    const hiddenPaperIds = getHiddenMetadataPaperIds();

    // Precompute normalized representations for tight inner loop checking
    const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '_').replace(/cluster_/g, '').replace(/cluster-/g, '');
    const normalizedHiddenSubClusters = new Set();
    state.hiddenSubClusters.forEach(hidden => {
        normalizedHiddenSubClusters.add(norm(hidden));
    });

    state.filteredData = state.allData.filter(d => {
        // Apply the Lasso/Box Selection filter inside the loop
        if (state.lassoFilterActive && lassoIds.size > 0) {
            const currentId = String(d.chunk_id || d.id);
            if (!lassoIds.has(currentId)) return false;
        }

        // Tag Filter
        if (state.tagsInitialized && d.tag && !state.visibleTags.has(d.tag)) return false;

        const metaValues = [
            d.meta_cluster_name,
            d.meta_cluster,
            d.metaCluster,
            d.tag,
            d.category,
            d.section,
            d.cluster_name
        ].filter(Boolean);

        const isMetaHidden = metaValues.some(val =>
            state.hiddenMetaClusters.has(val) ||
            state.hiddenMetadataTags.has(val) ||
            state.hiddenMetadataSections.has(val)
        );
        if (isMetaHidden) return false;

       // Metadata Subcluster Filter Intercept

        const isPaperOrChunk = d.tag === 'paper' || d.tag === 'chunk' || d.type === 'paper' || d.type === 'chunk';
        if (isPaperOrChunk) {
            // FIX: Only hide chunks if cascade is actually active
            if (state.hideAssociatedChunks !== false) {
                // Papers and chunks filter by associated paper IDs
                const pId = String(d.paper_id || d.PAPER_ID || d.id);
                if (pId && pId !== "undefined" && hiddenPaperIds.has(pId)) return false;
            }
         else {
            // Tag / Metadata embedding nodes filter directly by their specific subcluster key[cite: 1]
            if (isNodeInHiddenSubCluster(d, normalizedHiddenSubClusters)) return false;
        }}

        // Dataset Filter (Handles Strings, Arrays, & JSON robustly)
        if (state.hiddenDatasets && state.hiddenDatasets.size > 0) {
            const rawDs = d.dataset || d.db_source || d.source || d.dataset_id;

            if (rawDs !== undefined && rawDs !== null && String(rawDs).trim() !== "") {
                let datasets = [];

                if (Array.isArray(rawDs)) {
                    datasets = rawDs;
                } else if (typeof rawDs === 'string') {
                    try {
                        // Attempt to parse stringified JSON arrays (e.g. '["Dataset 1", "Dataset 2"]')
                        const parsed = JSON.parse(rawDs);
                        datasets = Array.isArray(parsed) ? parsed : [rawDs];
                    } catch(e) {
                        // Fallback: Check if it's comma separated
                        if (rawDs.includes(',')) {
                            datasets = rawDs.split(',');
                        } else {
                            datasets = [rawDs];
                        }
                    }
                } else {
                    datasets = [rawDs];
                }

                // Clean array: trim whitespace and remove empty entries
                datasets = datasets.map(s => String(s).trim()).filter(s => s !== "");

                if (datasets.length > 0) {
                    // Condition: Show the node if AT LEAST ONE dataset is visible (not hidden)
                    const isVisible = datasets.some(ds => !state.hiddenDatasets.has(ds));
                    if (!isVisible) return false;
                }
            }
        }

        if (state.hiddenInstruments && state.hiddenInstruments.size > 0) {
            const nodeInst = d.instrument || "N/A";
            const paperInstruments = String(nodeInst).split(',').map(s => s.trim());
            const allHidden = paperInstruments.every(inst => state.hiddenInstruments.has(inst || "N/A"));
            if (allHidden) return false;
        }

        // Spatial Root Cluster Filter
        const rootClusterId = d.cluster !== undefined && d.cluster !== null ? String(d.cluster) : "";
        if (rootClusterId !== "") {
            if (state.hiddenClusters.has(rootClusterId) || state.hiddenClusters.has(parseInt(rootClusterId, 10))) return false;
        }

        // Spatial Sub-Path Filter
        const nodePath = (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") ? String(d.sub_path) :
                         (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");

        if (nodePath !== "" && state.hiddenPaths && state.hiddenPaths.size > 0) {
            const exactFullPath = `${rootClusterId}-${nodePath}`;
            if (state.hiddenPaths.has(exactFullPath)) return false;

            const parts = nodePath.match(/-?\d+/g) || [];
            let agg = "";
            let isHidden = false;

            for (let p of parts) {
                agg += (agg === "" ? p : `-${p}`);
                const fullPathKey = `${rootClusterId}-${agg}`;
                if (state.hiddenPaths.has(fullPathKey)) {
                    isHidden = true;
                    break;
                }
            }
            if (isHidden) return false;
        }

        // Year Filter
        const y = parseInt(d.year);
        if (!isNaN(y) && (y < startYear || y > endYear)) return false;

        // Smart Category, Author, Instrument & FAISS Search Filter
        const activeBadges = state.activeSearchBadges ? Array.from(state.activeSearchBadges) : [];
        const hasBadges = activeBadges.length > 0;
        const hasFaiss = state.flatSearchIds && state.flatSearchIds.size > 0;

        if (hasBadges || hasFaiss) {
            let matchesKeyword = false;

            if (hasBadges) {
                // Check if node matches ALL active badges across titles, authors, text, or instrument flags
                matchesKeyword = activeBadges.every(badge => {
                    const term = badge.toLowerCase().trim();
                    if (!term) return true;

                    const title = (d.title || "").toLowerCase();
                    const authors = (d.authors || "").toLowerCase();
                    const text = (d.text || "").toLowerCase();
                    const tag = (d.tag || d.type || "").toLowerCase();

                    // A) Check standard text metadata (Title, Author, Abstract, Chunks)
                    const textMatch = title.includes(term) ||
                                      authors.includes(term) ||
                                      text.includes(term) ||
                                      tag.includes(term);

                    // Smart Instrument Flag Matching (ISR, TEC, FPI)
                    let instrumentMatch = false;
                    const isrFlag = Number(d.isr || 0) === 1;
                    const tecFlag = Number(d.tec || 0) === 1;
                    const fpiFlag = Number(d.fpi || 0) === 1;

                    if (term === "isr" && isrFlag) instrumentMatch = true;
                    if (term === "tec" && tecFlag) instrumentMatch = true;
                    if (term === "fpi" && fpiFlag) instrumentMatch = true;

                    // Match general terms like "radar", "interferometer", or "instrument" to flagged papers
                    const genericInstrumentTerms = ["instrument", "instrumentation", "radar", "interferometer", "gps"];
                    if (genericInstrumentTerms.some(t => term.includes(t)) && (isrFlag || tecFlag || fpiFlag)) {
                        instrumentMatch = true;
                    }

                    return textMatch || instrumentMatch;
                });
            }

            let matchesFaiss = false;
            if (hasFaiss) {
                const currentId = String(d.chunk_id || d.id || "");
                const currentBaseId = currentId.includes('_') ? currentId.split('_').pop() : currentId;
                matchesFaiss = state.flatSearchIds.has(currentId) || state.flatSearchIds.has(currentBaseId);
            }

            // Keep the node if it matches keyword/author/instrument criteria OR is returned by FAISS
            if (!matchesKeyword && !matchesFaiss) {
                return false;
            }
        }

        return true;
    });

    if (!skipDraw && typeof draw === 'function') {
        draw();
    }

    // Safely check if the metaPanel is open and currently displaying the directory list
    const metaPanelEl = document.getElementById('metaPanel');
    const isPanelOpen = metaPanelEl && !metaPanelEl.classList.contains('panel-collapsed');
    const isShowingList = window.location.hash === '#list-view' || metaPanelEl?.querySelector('.paper-card-item');

    // If active, instantly re-render the top 100 cards with the newly filtered dataset
    if (isPanelOpen && isShowingList && typeof updatePanel === 'function') {
        updatePanel(null, 'list');
    }
    if (!skipHistory && window.saveHistoryState) {
        window.saveHistoryState();
    }
    if(state.viewMode === 'hierarchy') drawHierarchy();
}


/**
 * Determines whether an individual data node is hidden by any active metadata tag, cluster,
 * or spatial path filter settings.
 *
 * @param {Object} d - Data node object to evaluate.
 * @param {Set<string>|null} [precomputedHiddenPaperIds=null] - Optional precomputed set of hidden paper IDs to prevent redundant recalculation.
 * @returns {boolean} True if the node is currently hidden, false if visible.
 */
export function isNodeHiddenByCluster(d, precomputedHiddenPaperIds = null) {
    const metaValues = [
        d.meta_cluster_name,
        d.meta_cluster,
        d.metaCluster,
        d.tag,
        d.category,
        d.section,
        d.cluster_name
    ].filter(Boolean);

    const isMetaHidden = metaValues.some(val =>
        (state.hiddenMetaClusters && state.hiddenMetaClusters.has(val)) ||
        (state.hiddenMetadataTags && state.hiddenMetadataTags.has(val)) ||
        (state.hiddenMetadataSections && state.hiddenMetadataSections.has(val))
    );
    if (isMetaHidden) return true;

    const isPaperOrChunk = d.tag === 'paper' || d.tag === 'chunk' || d.type === 'paper' || d.type === 'chunk';
    if (isPaperOrChunk) {
        // Check toggle state
        if (state.hideAssociatedChunks !== false) {
            const pId = String(d.paper_id || d.PAPER_ID || d.id);
            if (pId && pId !== "undefined") {
                const hiddenPaperIds = precomputedHiddenPaperIds || getHiddenMetadataPaperIds();
                if (hiddenPaperIds.has(pId)) return true;
            }
        }
    } else {
        if (isNodeInHiddenSubCluster(d)) return true;
    }

    const rootClusterId = parseInt(d.cluster, 10);
    if (state.hiddenClusters && (state.hiddenClusters.has(rootClusterId) || state.hiddenClusters.has(String(rootClusterId)))) {
        return true;
    }

    const nodePath = d.sub_path !== undefined ? String(d.sub_path) : (d.sub_cluster !== undefined ? String(d.sub_cluster) : "");

    if (state.hiddenPaths && state.hiddenPaths.size > 0) {
        const clusterStr = String(d.cluster);
        let pathStr = "";
        if (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") pathStr = String(d.sub_path);
        else if (d.sub_cluster !== undefined && d.sub_cluster !== null && String(d.sub_cluster) !== "") {
            pathStr = String(d.sub_cluster);
        }

        if (pathStr !== "") {
            const fullPath = `${clusterStr}-${pathStr}`;
            if (state.hiddenPaths.has(fullPath)) return true;

            let parentPath = clusterStr;
            const tokens = pathStr.split('-');
            for (let i = 0; i < tokens.length; i++) {
                parentPath += '-' + tokens[i];
                if (state.hiddenPaths.has(parentPath)) return true;
            }
        }
    }
    return false;
}


/**
 * Compiles and triggers a browser download for a CSV file containing aggregated paper metadata,
 * cluster paths, keywords, summaries, and full chunk texts for visible or provided data nodes.
 *
 * @param {Array<Object>} [nodes] - Explicit array of node objects to export; defaults to state filtered dataset if omitted.
 * @param {string} [filename="papers_export.csv"] - Target file name for the downloaded CSV.
 * @returns {void}
 */
export function exportNodesToCSV(nodes, filename = "papers_export.csv") {
    let sourceNodes = (state.filteredData && state.filteredData.length > 0)
        ? state.filteredData
        : (nodes || state.allData || []);

    const hiddenPaperIds = getHiddenMetadataPaperIds();

    const visibleNodes = sourceNodes.filter(d => {
        const metaValues = [
            d.meta_cluster_name,
            d.meta_cluster,
            d.metaCluster,
            d.tag,
            d.category,
            d.section,
            d.cluster_name
        ].filter(Boolean);

        const isMetaHidden = metaValues.some(val =>
            (state.hiddenMetaClusters && state.hiddenMetaClusters.has(val)) ||
            (state.hiddenMetadataTags && state.hiddenMetadataTags.has(val)) ||
            (state.hiddenMetadataSections && state.hiddenMetadataSections.has(val))
        );
        if (isMetaHidden) return false;

        const isPaperOrChunk = d.tag === 'paper' || d.tag === 'chunk' || d.type === 'paper' || d.type === 'chunk';
        if (isPaperOrChunk) {
            const pId = String(d.paper_id || d.PAPER_ID || d.id);
            if (pId && pId !== "undefined" && hiddenPaperIds.has(pId)) return false;
        } else {
            if (isNodeInHiddenSubCluster(d)) return false;
        }

        const rootClusterId = parseInt(d.cluster, 10);
        if (state.hiddenClusters && (state.hiddenClusters.has(rootClusterId) || state.hiddenClusters.has(String(rootClusterId)))) {
            return false;
        }

        const nodePath = d.sub_path !== undefined ? String(d.sub_path) : (d.sub_cluster !== undefined ? String(d.sub_cluster) : "");
        if (nodePath && state.hiddenPaths && state.hiddenPaths.size > 0) {
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
                const fullPathKey = `${rootClusterId}-${agg}`;
                if (state.hiddenPaths.has(fullPathKey)) return false;
            }
        }
        return true;
    });

    if (visibleNodes.length === 0) {
        alert("No visible canvas elements to export with your current cluster selections.");
        return;
    }

    const papersMap = new Map();

    visibleNodes.forEach(node => {
        const titleKey = (node.title || 'Untitled').trim();

        if (!papersMap.has(titleKey)) {
            papersMap.set(titleKey, {
                title: titleKey,
                year: node.year || '',
                authors: node.authors || '',
                chunks: [],
                paths: new Set()
            });
        }

        const paperEntry = papersMap.get(titleKey);

        paperEntry.chunks.push({
            id: node.chunk_id || node.id || '',
            text: node.text || ''
        });

        if (node.cluster !== undefined && node.cluster !== null) {
            const rootId = String(node.cluster);
            paperEntry.paths.add(rootId);

            const nodePath = (node.sub_path !== undefined && node.sub_path !== null && String(node.sub_path) !== "") ? String(node.sub_path) :
                             (node.sub_cluster !== undefined && node.sub_cluster !== null ? String(node.sub_cluster) : "");

            if (nodePath !== "") {
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
                    paperEntry.paths.add(`${rootId}-${agg}`);
                }
            }
        }
    });

    function getLabelsForPaths(pathsSet) {
        let keywords = new Set();
        let summaries = new Set();

        pathsSet.forEach(path => {
            if (state.clusterLabels?.keywords && state.clusterLabels.keywords[path]) {
                const k = state.clusterLabels.keywords[path];
                if (Array.isArray(k)) k.forEach(word => keywords.add(word));
                else keywords.add(k);
            }
            if (state.clusterLabels?.summaries && state.clusterLabels.summaries[path]) {
                summaries.add(state.clusterLabels.summaries[path]);
            }
        });

        return {
            keywords: Array.from(keywords).join('; '),
            summaries: Array.from(summaries).join(' | ')
        };
    }

    const headers = ['Title', 'Year', 'Authors', 'Cluster_Paths', 'Keywords', 'Summaries', 'Chunk_IDs', 'Full_Text'];
    const csvRows = [headers.join(',')];

    papersMap.forEach(paper => {
        const title = `"${paper.title.replace(/"/g, '""')}"`;
        const year = paper.year;
        const authors = `"${(paper.authors || '').replace(/"/g, '""')}"`;

        const pathsStr = `"${Array.from(paper.paths).join(', ').replace(/"/g, '""')}"`;
        const labels = getLabelsForPaths(paper.paths);
        const keywords = `"${labels.keywords.replace(/"/g, '""')}"`;
        const summaries = `"${labels.summaries.replace(/"/g, '""')}"`;

        const chunkIds = `"${paper.chunks.map(c => c.id).join('; ').replace(/"/g, '""')}"`;
        const allText = `"${paper.chunks.map(c => `[Chunk ${c.id}]: ${c.text}`).join('\n\n---\n\n').replace(/"/g, '""')}"`;

        csvRows.push([title, year, authors, pathsStr, keywords, summaries, chunkIds, allText].join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


/**
 * Aggregates visible pinned map locations and search trajectory sequence steps, formatting
 * and initiating a download of the combined bottom-panel tray data as a CSV file.
 *
 * @returns {void}
 */
export function exportTrayCombinedData() {
    const nodesToExport = new Map();
    const hiddenPaperIds = getHiddenMetadataPaperIds(); // Precomputed to prevent browser hanging loops

    if (state.droppedPins && state.droppedPins.length > 0) {
        state.droppedPins.forEach(paper => {
            if (isNodeHiddenByCluster(paper, hiddenPaperIds)) return;
            const id = String(paper.chunk_id || paper.id);
            nodesToExport.set(id, { ...paper, tray_source: "Pinned" });
        });
    }

    if (state.lastSearchTrajectory && state.lastSearchTrajectory.length > 0) {
        state.lastSearchTrajectory.forEach(step => {
            if (step.papers) {
                step.papers.forEach(paper => {
                    if (isNodeHiddenByCluster(paper, hiddenPaperIds)) return;
                    const id = String(paper.chunk_id || paper.id);
                    if (nodesToExport.has(id)) {
                        nodesToExport.get(id).tray_source += ` & Trajectory Step ${step.stepIndex + 1}`;
                    } else nodesToExport.set(id, { ...paper, tray_source: `Trajectory Step ${step.stepIndex + 1}` });
                });
            }
        });
    }

    const finalNodes = Array.from(nodesToExport.values());

    if (finalNodes.length === 0) {
        alert("No visible pins or search results to export based on your current cluster filters!");
        return;
    }

    const headers = ['Title', 'Year', 'Cluster', 'Chunk_ID', 'Tray_Source'];
    const csvRows = [headers.join(',')];

    finalNodes.forEach(paper => {
        const title = `"${(paper.title || 'Untitled').replace(/"/g, '""')}"`;
        const year = paper.year || '';
        const cluster = paper.cluster !== undefined ? paper.cluster : '';
        const id = paper.chunk_id || paper.id || '';
        const source = paper.tray_source || '';

        csvRows.push([title, year, cluster, id, source].join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "combined_tray_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
