import { state } from "../core/state.js";
import {getClusterColor, getTagSubClusterColor, getTagRegionColor, getMetaClusterColor,
getSubClusterColor} from "../clusters/color.js";

/**
 * Computes and displays the top 5 closest visible papers to specified plot coordinates in the info panel.
 *
 * @param {number} dataX - Target X-coordinate in data space.
 * @param {number} dataY - Target Y-coordinate in data space.
 * @returns {void}
 */
export function updatePanelWithNearest(dataX, dataY) {
    const panel = document.getElementById("info");
    if (!panel) return;

    const startYear = parseInt(document.getElementById("yearStart")?.value || 1960);
    const endYear = parseInt(document.getElementById("yearEnd")?.value || 2026);
    const textFilter = document.getElementById("search")?.value?.toLowerCase() || "";

    const visibleData = state.allData.filter(d => {
        if (d.year < startYear || d.year > endYear) return false;
        if (state.hiddenClusters.has(d.cluster)) return false;
        if (textFilter && d.title && !d.title.toLowerCase().includes(textFilter)) return false;
        return true;
    });

    if (visibleData.length === 0) {
        panel.innerHTML = `<p style="padding:12px; color:#6b7280; font-family:system-ui,sans-serif;">No matching papers found near this coordinate.</p>`;
        return;
    }

    const nearestItems = visibleData
        .map(d => {
            const dx = d.x - dataX;
            const dy = d.y - dataY;
            return { item: d, distSq: (dx * dx) + (dy * dy) };
        })
        .sort((a, b) => a.distSq - b.distSq)
        .slice(0, 5);

    const itemsHTML = nearestItems.map(({ item }) => {
        const color = getClusterColor(item.cluster);
        const clusterLabel = item.cluster === -1 ? "Noise" : (item.cluster_name || `Cluster ${item.cluster}`);
        return `
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                <div style="font-weight: 700; color: #111827; line-height: 1.35; margin-bottom: 4px;">${item.title || "Untitled"}</div>
                <div style="color: #4b5563; font-size: 11px; margin-bottom: 5px;">${item.authors || "Unknown"} (${item.year})</div>
                <span style="background: ${color}1a; color: ${color}; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid ${color}33;">${clusterLabel}</span>
            </div>
        `;
    }).join("");

    panel.innerHTML = `
        <div style="font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 10px;">
            <div>
                <h3 style="margin: 0 0 4px 0; font-size: 15px; color: #111827; font-weight: 700;">Nearest Papers to Pin</h3>
                <div style="font-size: 11px; color: #6b7280;">Coordinates — X: ${dataX.toFixed(2)}, Y: ${dataY.toFixed(2)}</div>
            </div>
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 2px 0;">
            <div style="max-height: 60vh; overflow-y: auto; padding-right: 2px;">
                ${itemsHTML}
            </div>
        </div>
    `;
}


/**
 * Generates styled HTML badge elements representing root region and subcluster paths for a given data node.
 *
 * @param {Object} targetNode - Node data containing cluster and subcluster properties.
 * @returns {Array<string>} Array of HTML string badges.
 */
const buildBadgesForNode = (targetNode) => {
    const badges = [];
    const rId = targetNode.cluster !== undefined && targetNode.cluster !== null ? parseInt(targetNode.cluster, 10) : -1;

    let isSingle = true;
    if (state.allData && state.allData.length > 0) {
        const uniqueClusters = [...new Set(state.allData.map(d => parseInt(d.cluster, 10)))].filter(c => c !== -1);
        isSingle = uniqueClusters.length <= 1;
    } else if (state.regionCountCache !== undefined) {
        isSingle = state.regionCountCache <= 1;
    }

    let bName = `Region ${rId + 1}`;
    if (isSingle && rId !== -1) {
        bName = "All Documents";
    }

    let cName = targetNode.cluster_name;
    if (cName === "All Documents" || cName === "Cluster 0") {
        cName = null;
    }

    const rName = rId === -1 ? "Noise" : (cName || bName);
    let rColor = typeof getClusterColor === "function" ? getClusterColor(rId) : "#4b5563";

    badges.push(`<span style="background: ${rColor}1a; color: ${rColor}; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid ${rColor}40; text-transform: uppercase; white-space: nowrap;">${rName}</span>`);

    let pStr = "";
    if (targetNode.sub_path !== undefined && targetNode.sub_path !== null && String(targetNode.sub_path) !== "") {
        pStr = String(targetNode.sub_path);
    } else if (targetNode.sub_cluster !== undefined && targetNode.sub_cluster !== null && String(targetNode.sub_cluster) !== "") {
        pStr = String(targetNode.sub_cluster);
    }

    if (pStr !== "") {
        const rawSplit = pStr.split('-');
        const parts = [];
        for (let i = 0; i < rawSplit.length; i++) {
            if (rawSplit[i] === "") {
                if (i + 1 < rawSplit.length) { parts.push("-" + rawSplit[i + 1]); i++; }
            } else parts.push(rawSplit[i]);
        }

        for (let i = 0; i < parts.length; i++) {
            const val = parseInt(parts[i], 10);
            const subPathAccumulated = parts.slice(0, i + 1).join('-');
            const fullPathKey = `${rId}-${subPathAccumulated}`;

            let subName = val === -1 ? "Noise" : `Subcluster ${val}`;
            if (val !== -1 && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[fullPathKey]) {
                subName = state.clusterLabels[state.globalClusterLabelMode][fullPathKey];
            }

            let subColor = typeof getSubClusterColor === "function" ? getSubClusterColor(rId, subPathAccumulated) : "#9ca3af";

            badges.push(`<span style="background: ${subColor}1a; color: ${subColor}; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid ${subColor}40; text-transform: uppercase; white-space: nowrap;">${subName}</span>`);
        }
    }
    return badges;
};


/**
 * Determines whether a data node should be visible based on active cluster, path, and meta-cluster filters.
 *
 * @param {Object} d - The data node object to evaluate.
 * @param {number|string} [d.cluster] - Root cluster ID.
 * @param {string} [d.sub_path] - Subcluster hierarchy path string.
 * @param {string} [d.sub_cluster] - Alternative subcluster identifier.
 * @param {string} [d.meta_cluster_name] - Associated meta-cluster label.
 * @returns {boolean} True if node passes all active filters, false if hidden.
 */
function isNodeVisible(d) {
    if (!d) return false;
    const rootId = d.cluster !== undefined && d.cluster !== null ? parseInt(d.cluster, 10) : -1;
    let pathStr = (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") ? String(d.sub_path) :
                  (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");
    const pathKey = pathStr === "" ? String(rootId) : `${rootId}-${pathStr}`;

    if (state.hiddenClusters && state.hiddenClusters.has(rootId)) return false;
    if (state.hiddenPaths && state.hiddenPaths.has(pathKey)) return false;

    const mcValue = d.meta_cluster_name ?? d.meta_cluster ?? d.metaCluster;
    if (mcValue && state.hiddenMetaClusters && state.hiddenMetaClusters.has(mcValue)) return false;

    return true;
}


/**
 * Updates and renders the main sidebar metadata panel for directory list views, bookmarked views,
 * level-of-detail (LOD) aggregate nodes, or detailed single-paper inspection.
 *
 * @param {Object|null} [node=null] - Selected data node to present in detail or aggregate view.
 * @param {string|null} [forceView=null] - Explicit view mode toggle ('list', 'bookmarks', 'detail').
 * @returns {Promise<void>} Resolves once rendering and any required metadata fetches complete.
 */
export async function updatePanel(node = null, forceView = null) {
    // Expose globally to prevent "Uncaught ReferenceError: updatePanel is not defined" from inline onclicks
    window.updatePanel = updatePanel;

    const sideWrapper = document.getElementById("metaPanel");
    if (sideWrapper && sideWrapper.classList.contains("panel-collapsed")) {
        sideWrapper.classList.remove("panel-collapsed");
        setTimeout(() => {
            if (typeof draw === "function") draw();
        }, 260);
    }

    const panel = document.getElementById("info");
    if (!panel) return;

    panel.style.padding = "0";
    panel.style.margin = "0";
    panel.style.height = "100%";
    panel.style.overflow = "hidden";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";

    // --- BOOKMARK STATE MANAGEMENT ---
    if (!state.bookmarks) state.bookmarks = new Set();
    state.currentViewMode = forceView || (node ? 'detail' : 'list');
    state.selectedNode = node;


    const getUniqueId = (n) => String(n.id || n.chunk_id || n.paper_id || n.PAPER_ID || n.title || n.TITLE || "");

    if (typeof window.toggleBookmark !== "function") {
        window.toggleBookmark = (id, event) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (state.bookmarks.has(id)) {
                state.bookmarks.delete(id);
            } else {
                state.bookmarks.add(id);
            }

            // Save scroll position before the DOM rewrites
            const panelContainer = document.getElementById("info");
            const scrollEl = panelContainer ? panelContainer.querySelector('.scroll-container') : null;
            const currentScroll = scrollEl ? scrollEl.scrollTop : 0;

            // Trigger seamless re-render and immediately restore scroll
            window.updatePanel(state.selectedNode || null, state.currentViewMode).then(() => {
                const newPanel = document.getElementById("info");
                const newScrollEl = newPanel ? newPanel.querySelector('.scroll-container') : null;
                if (newScrollEl) {
                    newScrollEl.scrollTop = currentScroll;
                }
            });
        };
    }

    // Helper to attach the collapse/toggle button event listener across all views
    const attachCollapseListener = () => {
        const closeBtn = document.getElementById("metaPanelCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                if (typeof window.toggleMetaPanel === "function") {
                    window.toggleMetaPanel(false);
                } else if (typeof toggleMetaPanel === "function") {
                    toggleMetaPanel(false);
                } else if (sideWrapper) {
                    sideWrapper.classList.add("panel-collapsed");
                    if (typeof draw === "function") draw();
                }
            });
        }
    };

    // UI Helper for the segmented control tab headers
    const buildTabHeaderHTML = (isBookmarkView) => `
        <div style="display: flex; background: #f3f4f6; padding: 3px; border-radius: 8px; align-items: center;">
            <button onclick="window.updatePanel(null, 'list')" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; background: ${!isBookmarkView ? '#ffffff' : 'transparent'}; color: ${!isBookmarkView ? '#111827' : '#6b7280'}; box-shadow: ${!isBookmarkView ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'}; transition: all 0.15s ease;">All</button>
            <button onclick="window.updatePanel(null, 'bookmarks')" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; background: ${isBookmarkView ? '#ffffff' : 'transparent'}; color: ${isBookmarkView ? '#111827' : '#6b7280'}; box-shadow: ${isBookmarkView ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'}; display: flex; align-items: center; gap: 4px; transition: all 0.15s ease;">
                <svg width="12" height="12" fill="${isBookmarkView ? '#eab308' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-5.5L5 21V5z"/>
                </svg>
                Saved
            </button>
        </div>
    `;

    //  INTERCEPT LOD (AGGREGATE) NODES HERE
    if (node && node.isAggregate) {
        // Track the display limit specifically for this aggregate node (defaults to 10)
        node._lodLimit = node._lodLimit || 10;

        let availableChildren = node.children || [];


        // try to find them by cluster ID to rebuild the array.
        if (availableChildren.length < node.count && state.allData) {
            const clusterId = node.cluster !== undefined ? node.cluster : node.id;

            if (clusterId !== undefined) {
                const recoveredChildren = state.allData.filter(d => d.cluster === clusterId || d.id === clusterId);
                // Merge without duplicating
                const existingIds = new Set(availableChildren.map(c => c.id || c.title));
                const newChildren = recoveredChildren.filter(c => !existingIds.has(c.id || c.title));

                availableChildren = [...availableChildren, ...newChildren];
                node.children = availableChildren;
            }
        }

        const totalAvailable = availableChildren.length;
        const displayedChildren = availableChildren.slice(0, node._lodLimit);

        // Calculate remaining based on the ACTUAL data we have found
        const remainingCount = totalAvailable - node._lodLimit;

        let overflowHTML = '';
        if (remainingCount > 0) {
            const nextLoadAmount = Math.min(10, remainingCount);
            overflowHTML = `
                <div style="margin-top: 16px; text-align: center; border-top: 1px dashed #e5e7eb; padding-top: 12px; padding-bottom: 16px;">
                    <button id="lodLoadMoreBtn" style="
                        background: #f3f4f6; border: 1px solid #d1d5db; color: #374151; 
                        font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 6px; 
                        cursor: pointer; transition: background 0.15s, border-color 0.15s; width: 100%; box-sizing: border-box;
                    " onmouseover="this.style.background='#e5e7eb'; this.style.borderColor='#9ca3af';" onmouseout="this.style.background='#f3f4f6'; this.style.borderColor='#d1d5db';">
                        Load More (${remainingCount} remaining)
                    </button>
                </div>
            `;
        } else if (node.count > totalAvailable) {
            // If we STILL couldn't find them in state.allData, it means the browser literally doesn't have the data.
            const missingCount = node.count - totalAvailable;
            overflowHTML = `
                <div style="margin-top: 16px; text-align: center; border-top: 1px dashed #e5e7eb; padding-top: 12px; padding-bottom: 16px;">
                    <p style="font-size: 12px; color: #6b7280; margin-bottom: 8px;"><em>...and ${missingCount} more documents (not loaded in browser memory)</em></p>
                </div>
            `;
        }

        // ASYNC METADATA FETCHING FOR CARDS
        if (!state.paperMap) state.paperMap = {};
        if (!state.failedMetadataRequests) state.failedMetadataRequests = new Set();

        const missingItems = displayedChildren.filter(item => {
            const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
            const paperMeta = state.paperMap[paperKey] || state.metadataCache?.[paperKey];
            const rawTitle = item.title || item.TITLE || paperMeta?.title || paperMeta?.t;
            const hasResolvedTitle = Boolean(rawTitle && String(rawTitle).trim() !== "" && !String(rawTitle).startsWith("Paper "));

            return paperKey && !hasResolvedTitle && !state.failedMetadataRequests.has(paperKey);
        });

        if (missingItems.length > 0) {
            await Promise.allSettled(missingItems.map(async item => {
                const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
                try {
                    const res = await fetch(`/api/paper-metadata/${encodeURIComponent(paperKey)}`);
                    if (res.ok) {
                        const metaData = await res.json();
                        state.paperMap[paperKey] = metaData;
                        // Synchronize back onto the item object
                        item.title = metaData.title || metaData.t || item.title;
                        item.authors = metaData.authors || metaData.AUTHOR || metaData.a || item.authors;
                        item.year = metaData.year || metaData.YEAR || metaData.y || item.year;
                    } else {
                        state.failedMetadataRequests.add(paperKey);
                    }
                } catch (err) {
                    state.failedMetadataRequests.add(paperKey);
                }
            }));
        }

        const cleanYear = (rawYear) => {
            if (rawYear === undefined || rawYear === null || rawYear === "") return "N/A";
            const match = String(rawYear).match(/\b(19[6-9]\d|20[0-2]\d)\b/);
            if (match) {
                const parsed = parseInt(match[0], 10);
                if (parsed >= 1960 && parsed <= 2026) return String(parsed);
            }
            return "N/A";
        };

        const cardsHTML = displayedChildren.map((item, idx) => {
            let badges = [];

            if (state.colorByMetadata && item.tag) {
                const tag = item.tag;
                const tagIdx = (state.tagOrder || []).indexOf(tag);
                const safeIdx = tagIdx > -1 ? tagIdx : 0;

                // Root Tag Badge
                const displayName = String(tag).replace(/^metadata_/i, '').replace(/"/g, '&quot;');
                const rootColor = typeof window.getTagRegionColor === 'function' ? window.getTagRegionColor(tag, safeIdx) :
                                  (typeof getTagRegionColor === 'function' ? getTagRegionColor(tag, safeIdx) : "#4b5563");

                badges.push(`<span style="background: ${rootColor}1a; color: ${rootColor}; border: 1px solid ${rootColor}40; font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: 700; text-transform: uppercase; white-space: nowrap;">${displayName}</span>`);

                // Subcluster Badges
                const subPathStr = item.tag_sub_path ? String(item.tag_sub_path).replace(/^Cluster\s+/i, '').trim() : "";
                if (subPathStr) {
                    const parts = subPathStr.split('.');
                    for (let i = 0; i < parts.length; i++) {
                        const subPathAccumulated = parts.slice(0, i + 1).join('.');
                        const hyphenPath = subPathAccumulated.replace(/\./g, '-');
                        const fullKey = `${tag}_${subPathAccumulated}`;

                        let subName = `Subcluster ${parts[i]}`;
                        if (state.clusterNames && state.clusterNames[fullKey]) {
                            subName = state.clusterNames[fullKey];
                        }
                        const safeSubName = String(subName).replace(/"/g, '&quot;');

                        const subColor = typeof window.getTagSubClusterColor === 'function' ? window.getTagSubClusterColor(tag, safeIdx, hyphenPath) :
                                         (typeof getTagSubClusterColor === 'function' ? getTagSubClusterColor(tag, safeIdx, hyphenPath) : "#9ca3af");

                        badges.push(`<span style="background: ${subColor}1a; color: ${subColor}; border: 1px solid ${subColor}40; font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: 700; text-transform: uppercase; white-space: nowrap;">${safeSubName}</span>`);
                    }
                }
            } else {
                badges = buildBadgesForNode(item).filter(badge => !badge.toUpperCase().includes("ALL DOCUMENTS"));
            }

            const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
            const paperMeta = (state.paperMap && state.paperMap[paperKey]) ||
                              (state.metadataCache && state.metadataCache[paperKey]) ||
                              (item.metadata || item.meta || {});

            const rawTitle = item.title || item.TITLE || item.paper_title || item.t ||
                             paperMeta.title || paperMeta.TITLE || paperMeta.paper_title || paperMeta.t;
            const title = (rawTitle && String(rawTitle).trim() !== "" && !String(rawTitle).startsWith("Paper "))
                ? String(rawTitle).trim()
                : "Untitled Paper";

            const rawAuthors = item.authors || item.AUTHOR || item.authors_str || item.author || item.a ||
                               paperMeta.authors || paperMeta.AUTHOR || paperMeta.authors_str || paperMeta.author || paperMeta.a;
            const authors = (rawAuthors && String(rawAuthors).trim()) ? String(rawAuthors).trim() : "Unknown Authors";

            const rawYear = item.year || item.YEAR || item.y || paperMeta.year || paperMeta.YEAR || paperMeta.y;
            const year = cleanYear(rawYear);

            const journal = item.journal || item.JOURNAL || item.publication || item.venue ||
                            paperMeta.journal || paperMeta.JOURNAL || paperMeta.publication || paperMeta.venue || "";
            const journalText = journal ? ` • ${journal}` : "";

            const snippet = item.chunk || item.text || item.excerpt || "No excerpt available.";

            // Bookmark Context
            const uniqueId = getUniqueId(item);
            const isBookmarked = state.bookmarks.has(uniqueId);
            const bookmarkColor = isBookmarked ? '#eab308' : '#9ca3af';
            const bookmarkFill = isBookmarked ? 'currentColor' : 'none';

            const itemId = item.id || item.ID || "";
            const isRedundantSnippet = snippet.trim().toLowerCase() === title.trim().toLowerCase();
            const isPaper = String(itemId).toLowerCase().includes("paper") || isRedundantSnippet;

            const snippetBoxHTML = isPaper ? "" : `
                <div style="background: #f9fafb; padding: 8px; border-radius: 6px; border: 1px dashed #d1d5db;">
                    <p style="margin: 0; font-size: 12px; color: #4b5563; line-height: 1.5; font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">
                        ${snippet}
                    </p>
                </div>
            `;
            return `
                <div class="paper-card-item lod-card-item" data-index="${idx}" style="
                    background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;
                    margin-bottom: 10px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                    text-align: left;
                " onmouseover="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 4px 6px -1px rgba(59, 130, 246, 0.1)';" 
                  onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='0 1px 2px rgba(0,0,0,0.02)';">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <div style="font-size: 14px; font-weight: 700; color: #111827; line-height: 1.3; margin-bottom: 6px;">
                            ${title}
                        </div>
                        <button onclick="window.toggleBookmark('${uniqueId.replace(/'/g, "\\'")}', event)" 
                                title="${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}"
                                style="background: none; border: none; padding: 2px; margin-top: -2px; cursor: pointer; color: ${bookmarkColor}; transition: transform 0.1s, color 0.1s; flex-shrink: 0;"
                                onmouseover="this.style.color='#eab308'; this.style.transform='scale(1.1)';" 
                                onmouseout="this.style.color='${bookmarkColor}'; this.style.transform='scale(1)';">
                            <svg width="20" height="20" fill="${bookmarkFill}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-5.5L5 21V5z"/>
                            </svg>
                        </button>
                    </div>
                    ${badges.length > 0 ? `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                        ${badges.join('')}
                    </div>` : ''}
                    <div style="font-size: 12px; color: #4b5563; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <span style="font-style: italic;">${authors}</span>
                        <span style="color: #6b7280; font-weight: 600; font-style: normal; margin-left: 4px;">• ${year}${journalText}</span>
                    </div>
                    ${snippetBoxHTML}
                </div>
            `;
        }).join("");

        // Fall back directly to "Grouped Documents" if no aggregate AI keywords or summary exist
        const rawLodTitle = node._cachedHoverLabel || node._cachedSummary || node.keywords || node.summary;
        const lodTitle = (rawLodTitle && String(rawLodTitle).trim() !== "" && String(rawLodTitle) !== "Unlabeled Cluster")
            ? String(rawLodTitle).trim()
            : "Grouped Documents";

        panel.innerHTML = `
            <div style="font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; text-align: left; box-sizing: border-box;">
                <!-- Sticky Header -->
                <div style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; flex-shrink: 0; width: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div>
                        <h2 style="margin: 0; font-size: 16px; color: #111827; font-weight: 700;">${lodTitle}</h2>
                        <span style="font-size: 12px; color: #6b7280;">Total documents in cluster: <b>${node.count}</b></span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button id="metaPanelCloseBtn" aria-label="Toggle Panel" title="Collapse Panel" style="background: transparent; border: none; padding: 0; margin: 0; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; flex-shrink: 0;" onmouseover="this.style.color='#111827';" onmouseout="this.style.color='#6b7280';">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <!-- Scrollable Cards Container -->
                <div class="lod-panel scroll-container" style="overflow-y: auto; flex: 1; padding: 20px; box-sizing: border-box; width: 100%;">
                    ${cardsHTML}
                    ${overflowHTML}
                </div>
            </div>
        `;

        // Bind clicks to LOD cards
        panel.querySelectorAll(".lod-card-item").forEach(cardEl => {
            cardEl.addEventListener("click", (e) => {
                if (e.target.closest('button')) return;

                const idx = parseInt(cardEl.getAttribute("data-index"), 10);
                const selectedItem = displayedChildren[idx];

                if (selectedItem) {
                    // 1. Create a clean shallow copy of the selected item
                    const paperItem = { ...selectedItem };

                    // 2. Explicitly remove circular pointer references & force non-aggregate status
                    delete paperItem._lod_next;
                    delete paperItem.children;
                    delete paperItem.parent;
                    paperItem.isAggregate = false;

                    // 3. Update the detail view
                    window.updatePanel(paperItem, 'detail');
                }
            });
        });
        attachCollapseListener();

        const loadMoreBtn = document.getElementById("lodLoadMoreBtn");
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener("click", () => {
                const scrollContainer = panel.querySelector(".scroll-container");
                const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

                node._lodLimit += 10;
                window.updatePanel(node).then(() => {
                    const newScrollContainer = document.getElementById("info").querySelector(".scroll-container");
                    if (newScrollContainer) {
                        newScrollContainer.scrollTop = savedScrollTop;
                    }
                });
            });
        }

        return;
    }
    // VIEW 1: SCROLLABLE CARD LIST VIEW
    const isInvalidNode = !node || Object.keys(node).length === 0 || (!node.id && !node.chunk_id && !node.paper_id && !node.title);

    if (isInvalidNode || forceView === 'list' || forceView === 'bookmarks') {
        const isBookmarkView = forceView === 'bookmarks';
        window.history.replaceState(null, null, isBookmarkView ? `#bookmarks` : `#list-view`);

        // Apply Bookmark Filtering
        let rawDataset = Array.isArray(state.filteredData) ? state.filteredData : (state.allData || []);
        if (isBookmarkView) {
            rawDataset = rawDataset.filter(item => state.bookmarks.has(getUniqueId(item)));
        }

        const visibleItems = rawDataset.filter(isNodeVisible);

        if (visibleItems.length === 0) {
            const emptyStateMsg = isBookmarkView
                ? "No bookmarked papers yet. Click the bookmark icon on any paper to save it here."
                : "No papers visible on the plot. Adjust your filters or search queries to see results.";

            panel.innerHTML = `
                <div style="display: flex; flex-direction: column; height: 100%; width: 100%; font-family: system-ui, -apple-system, sans-serif; text-align: left; box-sizing: border-box;">
                    <!-- Sticky Header -->
                    <div style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; flex-shrink: 0; width: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div>
                            <h2 style="margin: 0; font-size: 16px; color: #111827; font-weight: 700;">Plot Directory</h2>
                            <span style="font-size: 12px; color: #6b7280;">Showing <b>0</b> active documents</span>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${buildTabHeaderHTML(isBookmarkView)}
                            <button id="metaPanelCloseBtn" aria-label="Toggle Panel" title="Collapse Panel" style="background: transparent; border: none; padding: 0; margin: 0; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; flex-shrink: 0;" onmouseover="this.style.color='#111827';" onmouseout="this.style.color='#6b7280';">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <!-- Empty State Body -->
                    <div class="placeholder-text" style="padding: 60px 20px; text-align: center; color: #6b7280; flex: 1;">
                        <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin: 0 auto 10px auto; opacity: 0.3;">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <p style="margin: 0; font-weight: 600;">${emptyStateMsg}</p>
                    </div>
                </div>
            `;
            attachCollapseListener();
            return;
        }

       const currentLimit = state.cardLimit || 50;
        const displayedItems = visibleItems.slice(0, currentLimit);
        const hasMore = visibleItems.length > currentLimit;
        const remainingCount = visibleItems.length - currentLimit;

        // --- ASYNC METADATA FETCHING FOR CARDS ---
        if (!state.paperMap) state.paperMap = {};
        if (!state.failedMetadataRequests) state.failedMetadataRequests = new Set();

        const missingItems = displayedItems.filter(item => {
            const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
            const paperMeta = state.paperMap[paperKey] || state.metadataCache?.[paperKey];
            const rawTitle = item.title || item.TITLE || paperMeta?.title || paperMeta?.t;
            const hasResolvedTitle = Boolean(rawTitle && String(rawTitle).trim() !== "" && !String(rawTitle).startsWith("Paper "));

            return paperKey && !hasResolvedTitle && !state.failedMetadataRequests.has(paperKey);
        });

        if (missingItems.length > 0) {
            await Promise.allSettled(missingItems.map(async item => {
                const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
                try {
                    const res = await fetch(`/api/paper-metadata/${encodeURIComponent(paperKey)}`);
                    if (res.ok) {
                        const metaData = await res.json();
                        state.paperMap[paperKey] = metaData;
                        // Synchronize back onto the item object
                        item.title = metaData.title || metaData.t || item.title;
                        item.authors = metaData.authors || metaData.AUTHOR || metaData.a || item.authors;
                        item.year = metaData.year || metaData.YEAR || metaData.y || item.year;
                    } else {
                        state.failedMetadataRequests.add(paperKey);
                    }
                } catch (err) {
                    state.failedMetadataRequests.add(paperKey);
                }
            }));
        }

        const cleanYear = (rawYear) => {
            if (rawYear === undefined || rawYear === null || rawYear === "") return "N/A";
            const match = String(rawYear).match(/\b(19[6-9]\d|20[0-2]\d)\b/);
            if (match) {
                const parsed = parseInt(match[0], 10);
                if (parsed >= 1960 && parsed <= 2026) return String(parsed);
            }
            return "N/A";
        };

        const headerCountText = hasMore
            ? `Showing <b>${displayedItems.length}</b> of <b>${visibleItems.length}</b> documents`
            : `Showing <b>${visibleItems.length}</b> documents`;

        const cardsHTML = displayedItems.map((item, idx) => {
    let badges = [];

    if (state.colorByMetadata && item.tag) {
        const tag = item.tag;
        const tagIdx = (state.tagOrder || []).indexOf(tag);
        const safeIdx = tagIdx > -1 ? tagIdx : 0;

        // Root Tag Badge
        const displayName = String(tag).replace(/^metadata_/i, '').replace(/"/g, '&quot;');
        const rootColor = typeof window.getTagRegionColor === 'function' ? window.getTagRegionColor(tag, safeIdx) :
                          (typeof getTagRegionColor === 'function' ? getTagRegionColor(tag, safeIdx) : "#4b5563");

        badges.push(`<span style="background: ${rootColor}1a; color: ${rootColor}; border: 1px solid ${rootColor}40; font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: 700; text-transform: uppercase; white-space: nowrap;">${displayName}</span>`);

        // Subcluster Badges
        const subPathStr = item.tag_sub_path ? String(item.tag_sub_path).replace(/^Cluster\s+/i, '').trim() : "";
        if (subPathStr) {
            const parts = subPathStr.split('.');
            for (let i = 0; i < parts.length; i++) {
                const subPathAccumulated = parts.slice(0, i + 1).join('.');
                const hyphenPath = subPathAccumulated.replace(/\./g, '-');
                const fullKey = `${tag}_${subPathAccumulated}`;

                let subName = `Subcluster ${parts[i]}`;
                if (state.clusterNames && state.clusterNames[fullKey]) {
                    subName = state.clusterNames[fullKey];
                }
                const safeSubName = String(subName).replace(/"/g, '&quot;');

                const subColor = typeof window.getTagSubClusterColor === 'function' ? window.getTagSubClusterColor(tag, safeIdx, hyphenPath) :
                                 (typeof getTagSubClusterColor === 'function' ? getTagSubClusterColor(tag, safeIdx, hyphenPath) : "#9ca3af");

                badges.push(`<span style="background: ${subColor}1a; color: ${subColor}; border: 1px solid ${subColor}40; font-size: 10px; padding: 2px 8px; border-radius: 12px; font-weight: 700; text-transform: uppercase; white-space: nowrap;">${safeSubName}</span>`);
            }
        }
    } else {
        badges = buildBadgesForNode(item).filter(badge => !badge.toUpperCase().includes("ALL DOCUMENTS"));
    }

    const paperKey = item.paper_id || item.PAPER_ID || item.id || item.chunk_id;
    const paperMeta = (state.paperMap && state.paperMap[paperKey]) ||
                      (state.metadataCache && state.metadataCache[paperKey]) ||
                      (item.metadata || item.meta || {});

    const rawTitle = item.title || item.TITLE || item.paper_title || item.t ||
                     paperMeta.title || paperMeta.TITLE || paperMeta.paper_title || paperMeta.t;
    const title = (rawTitle && String(rawTitle).trim() !== "" && !String(rawTitle).startsWith("Paper "))
        ? String(rawTitle).trim()
        : "Untitled Paper";

    const rawAuthors = item.authors || item.AUTHOR || item.authors_str || item.author || item.a ||
                       paperMeta.authors || paperMeta.AUTHOR || paperMeta.authors_str || paperMeta.author || paperMeta.a;
    const authors = (rawAuthors && String(rawAuthors).trim()) ? String(rawAuthors).trim() : "Unknown Authors";

    const rawYear = item.year || item.YEAR || item.y || paperMeta.year || paperMeta.YEAR || paperMeta.y;
    const year = cleanYear(rawYear);

    const journal = item.journal || item.JOURNAL || item.publication || item.venue ||
                    paperMeta.journal || paperMeta.JOURNAL || paperMeta.publication || paperMeta.venue || "";
    const journalText = journal ? ` • ${journal}` : "";

    const snippet = item.chunk || item.text || item.excerpt || "No excerpt available.";

    // Bookmark Context
    const uniqueId = getUniqueId(item);
    const isBookmarked = state.bookmarks.has(uniqueId);
    const bookmarkColor = isBookmarked ? '#eab308' : '#9ca3af';
    const bookmarkFill = isBookmarked ? 'currentColor' : 'none';

    const itemId = item.id || item.ID || "";
    const isRedundantSnippet = snippet.trim().toLowerCase() === title.trim().toLowerCase();
    const isPaper = String(itemId).toLowerCase().includes("paper") || isRedundantSnippet;

    const snippetBoxHTML = isPaper ? "" : `
        <div style="background: #f9fafb; padding: 8px; border-radius: 6px; border: 1px dashed #d1d5db;">
            <p style="margin: 0; font-size: 12px; color: #4b5563; line-height: 1.5; font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">
                ${snippet}
            </p>
        </div>
    `;
    return `
        <div class="paper-card-item" data-index="${idx}" style="
            background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;
            margin-bottom: 10px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            text-align: left;
        " onmouseover="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 4px 6px -1px rgba(59, 130, 246, 0.1)';" 
          onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='0 1px 2px rgba(0,0,0,0.02)';">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div style="font-size: 14px; font-weight: 700; color: #111827; line-height: 1.3; margin-bottom: 6px;">
                    ${title}
                </div>
                <button onclick="window.toggleBookmark('${uniqueId.replace(/'/g, "\\'")}', event)" 
                        title="${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}"
                        style="background: none; border: none; padding: 2px; margin-top: -2px; cursor: pointer; color: ${bookmarkColor}; transition: transform 0.1s, color 0.1s; flex-shrink: 0;"
                        onmouseover="this.style.color='#eab308'; this.style.transform='scale(1.1)';" 
                        onmouseout="this.style.color='${bookmarkColor}'; this.style.transform='scale(1)';">
                    <svg width="20" height="20" fill="${bookmarkFill}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-5.5L5 21V5z"/>
                    </svg>
                </button>
            </div>
            ${badges.length > 0 ? `
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                ${badges.join('')}
            </div>` : ''}
            <div style="font-size: 12px; color: #4b5563; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                <span style="font-style: italic;">${authors}</span>
                <span style="color: #6b7280; font-weight: 600; font-style: normal; margin-left: 4px;">• ${year}${journalText}</span>
            </div>
            ${snippetBoxHTML}
        </div>
    `;
}).join("");

        const footerNoticeHTML = hasMore ? `
            <div style="text-align: center; padding: 8px 0 16px 0;">
                <button id="btnSeeMore" style="
                    background: #f3f4f6; border: 1px solid #d1d5db; color: #374151; 
                    font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 6px; 
                    cursor: pointer; transition: background 0.15s, border-color 0.15s; width: 100%; box-sizing: border-box;
                " onmouseover="this.style.background='#e5e7eb'; this.style.borderColor='#9ca3af';" onmouseout="this.style.background='#f3f4f6'; this.style.borderColor='#d1d5db';">
                    See More (${remainingCount} remaining)
                </button>
            </div>
        ` : `
            <div style="text-align: center; padding: 12px 8px; font-size: 12px; color: #6b7280; background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 6px; margin-bottom: 10px;">
                Showing all ${visibleItems.length} active documents
            </div>
        `;

        panel.innerHTML = `
            <div style="font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; text-align: left; box-sizing: border-box;">
                <!-- Sticky Header -->
                <div style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; flex-shrink: 0; width: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <div>
                        <h2 style="margin: 0; font-size: 16px; color: #111827; font-weight: 700;">Plot Directory</h2>
                        <span style="font-size: 12px; color: #6b7280;">${headerCountText}</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${buildTabHeaderHTML(isBookmarkView)}
                        <button id="metaPanelCloseBtn" aria-label="Toggle Panel" title="Collapse Panel" style="background: transparent; border: none; padding: 0; margin: 0; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; flex-shrink: 0;" onmouseover="this.style.color='#111827';" onmouseout="this.style.color='#6b7280';">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <!-- Scrollable Cards Container (Added class scroll-container for position memory) -->
                <div class="card-scroll-container scroll-container" style="overflow-y: auto; flex: 1; padding: 20px; box-sizing: border-box; width: 100%;">
                    ${cardsHTML}
                    ${footerNoticeHTML}
                </div>
            </div>
        `;

        panel.querySelectorAll(".paper-card-item").forEach(cardEl => {
            cardEl.addEventListener("click", () => {
                const idx = parseInt(cardEl.getAttribute("data-index"), 10);
                const selectedItem = displayedItems[idx];
                if (selectedItem) {
                    window.updatePanel(selectedItem, 'detail');
                }
            });
        });

        const seeMoreBtn = panel.querySelector("#btnSeeMore");
        if (seeMoreBtn) {
            seeMoreBtn.addEventListener("click", () => {
                const scrollContainer = panel.querySelector(".scroll-container");
                const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

                state.cardLimit = currentLimit + 50;
                window.updatePanel(null, isBookmarkView ? 'bookmarks' : 'list').then(() => {
                    const newScrollContainer = document.getElementById("info").querySelector(".scroll-container");
                    if (newScrollContainer) {
                        newScrollContainer.scrollTop = savedScrollTop;
                    }
                });
            });
        }

        attachCollapseListener();
        return;
    }

    // --- VIEW 2: IN-DEPTH MODE VIEW (SINGLE NODE DETAILS) ---
    window.history.replaceState(null, null, `#node-${node.chunk_id || node.id}`);

    // Detail view Bookmark Context
    const nodeUniqueId = getUniqueId(node);
    const nodeIsBookmarked = state.bookmarks.has(nodeUniqueId);
    const nodeBookmarkColor = nodeIsBookmarked ? '#eab308' : '#9ca3af';
    const nodeBookmarkFill = nodeIsBookmarked ? 'currentColor' : 'none';

    // Only render the loading screen and fetch deep metadata if we haven't already fetched it!
    if (!node._hasDeepMeta) {
        panel.innerHTML = `
            <div style="display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; text-align: left; box-sizing: border-box;">
                <!-- Sticky Header -->
                <div style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; flex-shrink: 0; width: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                    <button id="btnBackToList" style="background: #f3f4f6; border: 1px solid #d1d5db; color: #374151; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; gap: 4px;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">← Back to List</button>
                    
                    <!-- Action Buttons: Bookmark & Close -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="window.toggleBookmark('${nodeUniqueId.replace(/'/g, "\\'")}', event)" 
                                title="${nodeIsBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}"
                                style="background: none; border: none; padding: 4px; cursor: pointer; color: ${nodeBookmarkColor}; transition: transform 0.1s, color 0.1s;"
                                onmouseover="this.style.color='#eab308'; this.style.transform='scale(1.1)';" 
                                onmouseout="this.style.color='${nodeBookmarkColor}'; this.style.transform='scale(1)';">
                            <svg width="20" height="20" fill="${nodeBookmarkFill}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-5.5L5 21V5z"/>
                            </svg>
                        </button>
                        <button id="metaPanelCloseBtn" aria-label="Toggle Panel" title="Collapse Panel" style="background: transparent; border: none; padding: 0; margin: 0; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; flex-shrink: 0;" onmouseover="this.style.color='#111827';" onmouseout="this.style.color='#6b7280';">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <!-- Loading Spinner -->
                <div style="display: flex; justify-content: center; align-items: center; flex: 1; color: #6b7280; flex-direction: column; gap: 10px; padding: 40px;">
                    <div style="width: 24px; height: 24px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    Fetching deep paper metadata...
                </div>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `;

        attachCollapseListener();
        const tempBackBtn = document.getElementById("btnBackToList");
        if (tempBackBtn) tempBackBtn.addEventListener("click", () => window.updatePanel(null, 'list'));

        try {
            const metaRes = await fetch(
                `/api/metadata?paper_id=${encodeURIComponent(node.paper_id || node.PAPER_ID || '')}&title=${encodeURIComponent(node.title || node.TITLE || '')}`
            );
            const deepMeta = await metaRes.json();
            Object.assign(node, deepMeta);
            node._hasDeepMeta = true;
        } catch (err) {
            console.error("Failed to fetch deep metadata:", err);
        }
    }

    const paperId = node.paper_id || node.PAPER_ID || node.title || node.TITLE;
    let paperChunks = [];

    if (state.allData && state.allData.length > 0) {
        paperChunks = state.allData.filter(d =>
            (d.paper_id && d.paper_id === paperId) ||
            (d.PAPER_ID && d.PAPER_ID === paperId) ||
            (d.title && d.title === paperId) ||
            (d.TITLE && d.TITLE === paperId)
        );
    } else {
        paperChunks = [node];
    }

    const clusterCounts = {};
    let maxCount = 0;
    let overallCluster = node.cluster;
    let overallClusterNameStr = node.cluster_name || "";

    paperChunks.forEach(chunk => {
        const c = chunk.cluster;
        if (c !== undefined && c !== -1) {
            clusterCounts[c] = (clusterCounts[c] || 0) + 1;
            if (clusterCounts[c] > maxCount) {
                maxCount = clusterCounts[c];
                overallCluster = c;
                if (chunk.cluster_name) {
                    overallClusterNameStr = chunk.cluster_name;
                }
            }
        }
    });

    const chunkText = node.chunk || node.text || node.excerpt || "No specific chunk text available.";
    const rawDoi = node.doi || node.DOI;
    const doiLink = rawDoi ? `https://doi.org/${rawDoi}` : "#";
    const rawAuthors = node.authors || node.AUTHOR || "Unknown Authors";
let authorsHTML = rawAuthors;

if (rawAuthors !== "Unknown Authors") {
    // Handle both arrays and comma-separated strings
    const authorArray = Array.isArray(rawAuthors) ? rawAuthors : rawAuthors.split(',');

    authorsHTML = authorArray.map(author => {
        const cleanName = author.trim();
        if (!cleanName) return '';
        const safeName = cleanName.replace(/"/g, '&quot;');
        // Maintains your current look but adds a hover effect and pointer cursor
        return `<span class="clickable-author" data-author="${safeName}" style="cursor: pointer; transition: color 0.15s ease;" onmouseover="this.style.color='#2563eb'" onmouseout="this.style.color='inherit'" title="Search for ${safeName}">${cleanName}</span>`;
    }).filter(Boolean).join(', ');
}
    const yearText = node.year || node.YEAR || "Unknown Year";
   const rawJournal = node.journal || node.JOURNAL || node.publication || node.venue || "";
let journalHTML = "";

if (rawJournal) {
    const cleanJournal = rawJournal.trim();
    const safeJournal = cleanJournal.replace(/"/g, '&quot;');
    journalHTML = ` • <span class="clickable-journal" data-journal="${safeJournal}" style="cursor: pointer; transition: color 0.15s ease;" onmouseover="this.style.color='#2563eb'" onmouseout="this.style.color='inherit'" title="Search for ${safeJournal}">${cleanJournal}</span>`;
}
    const displayTitle = node.title || node.TITLE || "Untitled Paper";

    // Determine if the node is a paper-level item rather than an individual chunk
    const nodeIdStr = String(node.id || node.chunk_id || node.paper_id || "").toLowerCase();
    const isRedundantChunk = chunkText.trim().toLowerCase() === displayTitle.trim().toLowerCase();
    const isPaperNode = nodeIdStr.includes("paper") || isRedundantChunk;

    let activeKeywords = node.keywords || node.KEYWORDS || [];
    if (typeof activeKeywords === 'string') {
        activeKeywords = activeKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }

    // FIXED KEYWORDS HTML: Added clickable classes, safe quotes, and pointer styles
    let keywordsHTML = "";
    if (activeKeywords.length > 0) {
        keywordsHTML = activeKeywords.map(kw => {
            const safeKw = kw.replace(/"/g, '&quot;');
            return `<span class="clickable-keyword" data-keyword="${safeKw}" style="background: #e5e7eb; color: #374151; font-size: 11px; padding: 3px 8px; border-radius: 12px; white-space: nowrap; cursor: pointer; transition: background 0.2s ease;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='#e5e7eb'">${kw}</span>`;
        }).join("");
    }

    const buildSection = (title, content, tagHTML = "") => {
        const cleanTitle = title.replace(/["']/g, '').replace(/_/g, ' ');
        return `
        <div style="background: #ffffff; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); text-align: left;">
            <h3 style="display: flex; align-items: center; margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #1f2937; text-transform: uppercase; letter-spacing: 0.5px; flex-wrap: wrap; gap: 4px;">
                <span>${cleanTitle}</span> ${tagHTML}
            </h3>
            <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #4b5563;">${content}</p>
        </div>
        `;
    };

    const ignoredKeys = new Set([
        'x', 'y', 'orig_x', 'orig_y', 'cluster', 'sub_cluster', 'meta_cluster',
        'meta_cluster_name', 'cluster_name', 'chunk_id', 'id', 'paper_id',
        'title', 'authors', 'author', 'year', 'journal', 'journal_name', 'publication', 'venue', 'publisher',
        'doi', 'pdfurl', 'url', 'chunk', 'text', 'excerpt',
        'keywords', 'references_json', 'sub_path', 'metadata_tags',
        'references', 'refrences', 'ag', 'tags', "TAG", 'tag', "gradientColor", "tag sub path", "Tag sub path", "Tag Sub Path", "subcluster label", "subclustername", "cluser label", "cluster name", "tec", "TEC", "isr", "ISR",
        "FPI", "fpi", "model", "Model", "file size bytes", "field name", "embedding ID", "embedding id", "dimesions", "authors json", "orig cluster name", "Dimensions", "dimensions",
        "Embedding ID", "file path", "File path", "file size bytes", "File Size Bytes", "File size bytes", "FILE SIZE BYTES", "file size bytes", "Field name", "FIELD NAME", "Field Name",
        "embedding_id", "field_name", "orig_cluster_name", "active", "selected", "file_path", "file_size_bytes", "authors_json", "db_source", "_hasDeepMeta", "date_added", "hasDeepMeta_", "hasDeepMeta", "_hasDeepMeta", " hasDeepMeta",
        "lod_next", "LOD_Next", "LOD_next", "LOD next", "lod next", "_lod_next", "umap_y", "umap_x", "type", "_type", "chunk_type", "__hasDeepMeta", "visible"
    ]);

    const mcValue = node.meta_cluster_name ?? node.meta_cluster ?? node.metaCluster;
    let metaClusterHTML = "";

    if (mcValue && String(mcValue).trim() !== "") {
        const getMetaColor = () => {
            if (typeof getMetaClusterColor === "function") return getMetaClusterColor(mcValue);
            if (typeof window.getMetaClusterColor === "function") return window.getMetaClusterColor(mcValue);
            return 0x7f7f7f;
        };
        const metaColorHex = "#" + getMetaColor().toString(16).padStart(6, '0');
        metaClusterHTML = `
            <span style="background: ${metaColorHex}1a; color: ${metaColorHex}; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid ${metaColorHex}40; text-transform: uppercase; margin-left: 8px; white-space: nowrap;">
                ${mcValue}
            </span>
        `;
    }

    let dynamicSectionsHTML = "";

    Object.keys(node).forEach(key => {
        let cleanKey = key.toLowerCase().replace(/["']/g, '').trim();
        if (cleanKey.startsWith('metadata_')) {
            cleanKey = cleanKey.replace('metadata_', '');
        }

        if (!ignoredKeys.has(cleanKey) && !ignoredKeys.has(key.toLowerCase().trim())) {
            const rawValue = node[key];

            if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
                let displayValue = rawValue;

                if (typeof rawValue === 'object') {
                    displayValue = JSON.stringify(rawValue, null, 2);
                } else if (typeof rawValue === 'string') {
                    const lowerVal = rawValue.toLowerCase().trim();
                    if (lowerVal === "null" || lowerVal === "not explicitly stated" || lowerVal === "[]" || lowerVal === "{}") {
                        displayValue = null;
                    }
                }

                if (displayValue) {
                    let sectionTagHTML = "";
                    let lookupVal = typeof rawValue === 'string' ? rawValue.trim() : displayValue;

                    if (state.metadataCategoryTags && state.metadataCategoryTags[cleanKey]) {
                        const tagData = state.metadataCategoryTags[cleanKey][lookupVal] || state.metadataCategoryTags[cleanKey];
                        if (tagData && tagData.tag) {
                            sectionTagHTML += `
                                <span style="background: ${tagData.color || '#3b82f6'}1a; color: ${tagData.color || '#3b82f6'}; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid ${tagData.color || '#3b82f6'}40; text-transform: uppercase; white-space: nowrap; margin-left: 8px;">
                                    ${tagData.tag}
                                </span>
                            `;
                        } else if (typeof tagData === 'string') {
                            sectionTagHTML += `
                                <span style="background: #eff6ff; color: #2563eb; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid #bfdbfe; text-transform: uppercase; white-space: nowrap; margin-left: 8px;">
                                    ${tagData}
                                </span>
                            `;
                        }
                    }

                    const matchingChunk = paperChunks.find(c => {
                        const tagVal = String(c.tag || c.TAG || c.section || c.SECTION || c.chunk_type || c.type || '').toLowerCase().trim();
                        return tagVal === cleanKey || tagVal === key.toLowerCase().trim();
                    });

                    const sectionMcValue =
                        node[`${cleanKey}_meta_cluster_name`] || node[`${cleanKey}_meta_cluster`] || node[`${cleanKey}_cluster_name`] ||
                        (matchingChunk ? (matchingChunk.meta_cluster_name || matchingChunk.meta_cluster || matchingChunk.metaCluster || matchingChunk.cluster_name) : null) ||
                        (typeof node.meta_cluster === 'object' && node.meta_cluster ? node.meta_cluster[cleanKey] : null);

                    if (sectionMcValue && String(sectionMcValue).trim() !== "" && String(sectionMcValue).toLowerCase() !== "null") {
                        const getMetaColor = (val) => {
                            if (typeof getMetaClusterColor === "function") return getMetaClusterColor(val);
                            if (typeof window.getMetaClusterColor === "function") return window.getMetaClusterColor(val);
                            return 0x2563eb;
                        };
                        let hex = getMetaColor(sectionMcValue);
                        const metaColorHex = typeof hex === 'number' ? "#" + hex.toString(16).padStart(6, '0') : (hex || "#2563eb");
                        if (!sectionTagHTML.includes(String(sectionMcValue))) {
                            sectionTagHTML += `
                                <span style="background: ${metaColorHex}1a; color: ${metaColorHex}; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid ${metaColorHex}40; text-transform: uppercase; white-space: nowrap; margin-left: 8px;">
                                    ${sectionMcValue}
                                </span>
                            `;
                        }
                    }

                    const isCategoryField = ['category', 'categories', 'topic', 'topics', 'domain', 'discipline', 'subject', 'field', 'cluster', 'meta_cluster', 'sub_cluster', 'tag', 'tags', 'section'].includes(cleanKey);
                    if (isCategoryField || (typeof lookupVal === 'string' && lookupVal === mcValue)) {
                        if (metaClusterHTML && !sectionTagHTML.includes(mcValue)) {
                            sectionTagHTML += metaClusterHTML;
                        }
                    }

                    const nodeTag = (matchingChunk ? matchingChunk.tag : null) || node.tag || 'chunk';
                    const cleanSubPath = typeof getCleanPath === 'function' ? getCleanPath((matchingChunk ? matchingChunk.tag_sub_path : null) || node.tag_sub_path) : String(((matchingChunk ? matchingChunk.tag_sub_path : null) || node.tag_sub_path || '')).trim();
                    if (cleanSubPath && state.clusterNames) {
                        const clusterKey = `${nodeTag}_${cleanSubPath}`;
                        const customSubName = state.clusterNames[clusterKey];

                        if (customSubName && (isCategoryField || cleanKey === 'subcategory' || lookupVal === customSubName) && !sectionTagHTML.includes(customSubName)) {
                            sectionTagHTML += `
                                <span style="background: #eff6ff; color: #2563eb; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; border: 1px solid #bfdbfe; text-transform: uppercase; margin-left: 8px; white-space: nowrap;">
                                    ${customSubName}
                                </span>
                            `;
                        }
                    }

                    dynamicSectionsHTML += buildSection(key, displayValue, sectionTagHTML);
                }
            }
        }
    });

    const badgesHTML = buildBadgesForNode(node).filter(badge => !badge.toUpperCase().includes("ALL DOCUMENTS"));
    const chunkBadgesHTML = buildBadgesForNode(node).filter(badge => !badge.toUpperCase().includes("ALL DOCUMENTS"));

    // Render chunk segment card ONLY if clicking a chunk
    const activatedChunkHTML = isPaperNode ? "" : `
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); text-align: left;">
            <h3 style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #111827;">Activated Chunk Segment</h3>
            <div style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
                ${chunkBadgesHTML.join('\n                ')}
            </div>
            <p style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.5; color: #4b5563; font-style: italic; background: #ffffff; padding: 8px; border-radius: 4px; border: 1px dashed #d1d5db;">
                "${chunkText}"
            </p>
            <div style="font-size: 11px; color: #6b7280;">
                Chunk ID: ${node.chunk_id || node.CHUNK_ID || node.id || "N/A"}
            </div>
        </div>
    `;

    panel.innerHTML = `
        <div style="font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; text-align: left; box-sizing: border-box;">
            <!-- Sticky Header -->
            <div style="background: #ffffff; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; flex-shrink: 0; width: 100%; box-sizing: border-box; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <button id="btnBackToList" style="background: #f3f4f6; border: 1px solid #d1d5db; color: #374151; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; gap: 4px;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">← Back to List</button>
                <button id="metaPanelCloseBtn" aria-label="Toggle Panel" title="Collapse Panel" style="background: transparent; border: none; padding: 0; margin: 0; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s; flex-shrink: 0;" onmouseover="this.style.color='#111827';" onmouseout="this.style.color='#6b7280';">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </button>
            </div>

            <!-- Scrollable Details Container (Added class scroll-container for position memory) -->
            <div class="details-scroll-container scroll-container" style="overflow-y: auto; flex: 1; padding: 20px; box-sizing: border-box; width: 100%; display: flex; flex-direction: column; gap: 16px;">
                <div>
                    <h2 style="display: flex; align-items: center; margin: 0 0 8px 0; font-size: 18px; color: #111827; line-height: 1.3;">
                        ${displayTitle}
                    </h2>
                    ${badgesHTML.length > 0 ? `
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                        ${badgesHTML.join('\n                        ')}
                    </div>` : ''}
<div style="color: #4b5563; font-size: 13px; font-style: italic;">
    ${authorsHTML} <span style="font-style: normal; font-weight: 600; color: #6b7280; margin-left: 4px;">• ${yearText}${journalHTML}</span>
</div>
                </div>

                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 0;">
                ${keywordsHTML ? `
                <div style="text-align: left;">
                    <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #374151;">Top Keywords</h3>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${keywordsHTML}
                    </div>
                </div>
                ` : ''}

                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-start; width: 100%;">
                    ${rawDoi ? `
                        <a href="${doiLink}" target="_blank" style="width: 100px; max-width: 120px; text-align: center; background: #f3f4f6; color: #374151; font-size: 12px; font-weight: 600; padding: 8px 0; border-radius: 6px; text-decoration: none; border: 1px solid #e5e7eb; transition: background 0.2s; white-space: nowrap; box-sizing: border-box;">DOI</a>
                    ` : ''}
                   
                    <button id="btnFindSimilar" style="width: 100px; max-width: 120px; text-align: center; background: #2563eb; color: white; border: none; padding: 8px 0; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.05); white-space: nowrap; box-sizing: border-box;">Similar</button>
                    
                    <!-- Updated Bookmark Button to mirror standard SVG functionality in card view -->
                    <button onclick="window.toggleBookmark('${nodeUniqueId.replace(/'/g, "\\'")}', event)" 
                            style="width: 100px; max-width: 120px; display: flex; align-items: center; justify-content: center; gap: 6px; background: #ffffff; color: ${nodeIsBookmarked ? '#eab308' : '#374151'}; border: 1px solid ${nodeIsBookmarked ? '#eab308' : '#e5e7eb'}; padding: 8px 0; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: all 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.05); white-space: nowrap; box-sizing: border-box;"
                            onmouseover="this.style.borderColor='#d1d5db'; this.style.color='#eab308';" 
                            onmouseout="this.style.borderColor='${nodeIsBookmarked ? '#eab308' : '#e5e7eb'}'; this.style.color='${nodeIsBookmarked ? '#eab308' : '#374151'}';">
                        <svg width="14" height="14" fill="${nodeBookmarkFill}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-5.5L5 21V5z"/>
                        </svg>
                        ${nodeIsBookmarked ? 'Saved' : 'Save'}
                    </button>
                </div>

                ${activatedChunkHTML}
              
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 4px 0;">

                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${dynamicSectionsHTML}
                </div>
            </div>
        </div>
    `;

    const backBtn = document.getElementById("btnBackToList");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            window.updatePanel(null, 'list');
        });
    }

    attachCollapseListener();

    // FIXED TAG & SEARCH LOGIC: Accepts an optional 'forcedType'
    const executeTagSearch = (text, forcedType = null) => {
        if (!text) return;

        // Register the forced type globally so classifyQuery can see it
        if (forcedType) {
            window.forcedBadgeTypes = window.forcedBadgeTypes || new Map();
            window.forcedBadgeTypes.set(text, forcedType);
        }

        const unifiedInput = document.getElementById('unifiedSearch');
        if (unifiedInput) {
            unifiedInput.value = text;
        }

        if (typeof window.addSearchBadgeFromInput === 'function') {
            window.addSearchBadgeFromInput();
        }
    };

    const btnFindSimilar = document.getElementById('btnFindSimilar');
    if (btnFindSimilar) {
        btnFindSimilar.addEventListener('click', () => {
            const searchText = displayTitle || "";
            // Force the "Find Similar" click to strictly be an AI_QUERY
            executeTagSearch(searchText, 'AI_QUERY');
        });
    }

    // FIXED KEYWORD CLICK LOGIC: Attach event listeners
    const keywordElements = panel.querySelectorAll('.clickable-keyword');
    keywordElements.forEach(el => {
        el.addEventListener('click', () => {
            const kw = el.getAttribute('data-keyword');
            // Force keyword clicks to strictly be a KEYWORD
            executeTagSearch(kw, 'KEYWORD');
        });
    });
    const authorElements = panel.querySelectorAll('.clickable-author');
    authorElements.forEach(el => {
        el.addEventListener('click', () => {
            const authorName = el.getAttribute('data-author');
            // Force author clicks to strictly register as an AUTHOR badge
            executeTagSearch(authorName, 'AUTHOR');
        });
    });
    // FIXED JOURNAL CLICK LOGIC: Attach event listeners to the interactive journal text
    const journalElements = panel.querySelectorAll('.clickable-journal');
    journalElements.forEach(el => {
        el.addEventListener('click', () => {
            const journalName = el.getAttribute('data-journal');
            // Force journal clicks to strictly register as a JOURNAL badge
            executeTagSearch(journalName, 'JOURNAL');
        });
    });
}
