import {state} from "../core/state.js";
import {getTagRegionColor, getTagSubClusterColor} from "../clusters/color.js";
import {updatePanel} from "./meta_panel.js";
import {makeDraggableAndDockable,} from './dock.js';

//Global Window Bindings
if (typeof window !== "undefined") {
    window.restoreAllMetaAndSubClusters = restoreAllMetaAndSubClusters;
    window.disableAllMetaAndSubClusters = disableAllMetaAndSubClusters;
}


/**
 * MASTER GUARD ARRAY
 * These tags will NEVER be subclustered anywhere in the application.
 */
const PROTECTED_MASTER_TAGS = new Set(['paper', 'chunk', 'chunks']);


/**
 * Restores visibility for all data tags, purges protected master tags ('paper', 'chunk', 'chunks')
 * from active subclusters, clears all exclusion/hidden sets, resets selection states,
 * and refreshes the UI and canvas rendering.
 *
 * @returns {void}
 */
export function restoreAllMetaAndSubClusters() {
    if (!state.allData || !Array.isArray(state.allData)) return;

    // HARD GUARD: Purge master tags from activeSubClusters
    if (state.activeSubClusters) {
        PROTECTED_MASTER_TAGS.forEach(tag => {
            delete state.activeSubClusters[tag];
        });
    }

    // Add all unique tags back to visibleTags so points render on canvas
    if (!(state.visibleTags instanceof Set)) state.visibleTags = new Set();
    const uniqueTags = [...new Set(state.allData.map(d => d.tag || 'chunk'))];
    uniqueTags.forEach(tag => state.visibleTags.add(tag));

    // Clean out master tag references from subpath / subcluster exclusion sets
    if (state.hiddenTagSubPaths instanceof Set) {
        [...state.hiddenTagSubPaths].forEach(path => {
            if (PROTECTED_MASTER_TAGS.has(path.split('::')[0])) {
                state.hiddenTagSubPaths.delete(path);
            } else {
                state.hiddenTagSubPaths.delete(path); // Clear for full restore
            }
        });
    }
    if (state.hiddenSubClusters instanceof Set) state.hiddenSubClusters.clear();
    if (state.hiddenMetadataTags instanceof Set) state.hiddenMetadataTags.clear();
    if (state.hiddenMetaClusters instanceof Set) state.hiddenMetaClusters.clear();

    // Clear selection highlights
    state.selectedMetadataKey = null;
    state.selectedMetadataName = null;
    state.selectedMetadataTag = null;
    state.selectedMetadataSubPath = null;
    if (typeof window.toggleMetaClusterBorder === 'function' && state.activeBorderTag) {
        window.toggleMetaClusterBorder(state.activeBorderTag, false);
    }

    //  Rebuild UI & Redraw canvas
    if (typeof buildTagDropdownUI === "function") buildTagDropdownUI();

    import('../core/data.js').then(module => {
        if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
        import('../canvas/render.js').then(r => {
            if (typeof r.draw === 'function') r.draw();
        });
    });

    console.log("[System] Success: Restored all points and purged master subclusters.");
}


/**
 * Safely disables visibility across all tags and subclusters while hard-guarding master tags
 * ('paper', 'chunk', 'chunks') against subclustering operations, updating global state,
 * UI dropdowns, and canvas views.
 *
 * @returns {void}
 */
export function disableAllMetaAndSubClusters() {
    if (!state.allData || !Array.isArray(state.allData)) return;

    if (!(state.hiddenTagSubPaths instanceof Set)) state.hiddenTagSubPaths = new Set();
    if (!(state.hiddenSubClusters instanceof Set)) state.hiddenSubClusters = new Set();
    if (!(state.hiddenMetadataTags instanceof Set)) state.hiddenMetadataTags = new Set();
    if (!(state.hiddenMetaClusters instanceof Set)) state.hiddenMetaClusters = new Set();
    if (!(state.visibleTags instanceof Set)) state.visibleTags = new Set();

    const allTags = [...new Set(state.allData.map(d => d.tag || 'chunk'))];

    allTags.forEach(tag => {
        const isMasterTag = PROTECTED_MASTER_TAGS.has(tag);
        const isMetadataTag = String(tag).startsWith('metadata_');

        // Turn off tag visibility
        state.visibleTags.delete(tag);

        if (isMasterTag) {
            // HARD GUARD: Wipe out any active subclusters attached to master tags
            if (state.activeSubClusters && state.activeSubClusters[tag]) {
                delete state.activeSubClusters[tag];
            }
            // Strip any subpaths starting with 'chunk::' or 'paper::'
            if (state.hiddenTagSubPaths) {
                [...state.hiddenTagSubPaths].forEach(path => {
                    if (path.startsWith(`${tag}::`)) state.hiddenTagSubPaths.delete(path);
                });
            }
            // NEVER call recursivelyToggleTagSubpaths on master tags!
        } else if (isMetadataTag) {
            state.hiddenMetadataTags.add(tag);
            state.hiddenMetaClusters.add(tag);
            if (typeof window.recursivelyToggleTagSubpaths === "function") {
                window.recursivelyToggleTagSubpaths(tag, null, true);
            }
        } else {
            // Custom tags: disable subclusters normally
            if (state.activeSubClusters && state.activeSubClusters[tag]) {
                Object.keys(state.activeSubClusters[tag]).forEach(subPath => {
                    const fullPath = `${tag}::${subPath}`;
                    state.hiddenTagSubPaths.add(fullPath);
                    state.hiddenSubClusters.add(fullPath);
                });
            }
            if (typeof window.recursivelyToggleTagSubpaths === "function") {
                window.recursivelyToggleTagSubpaths(tag, null, true);
            }
        }
    });

    // Reset selection states
    state.selectedMetadataKey = null;
    state.selectedMetadataName = null;
    if (typeof window.toggleMetaClusterBorder === 'function' && state.activeBorderTag) {
        window.toggleMetaClusterBorder(state.activeBorderTag, false);
    }

    // Refresh Sidebar UI Dropdown
    if (typeof buildTagDropdownUI === "function") buildTagDropdownUI();

    // Apply Global Filters & Redraw canvas
    import('../core/data.js').then(module => {
        if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
        import('../canvas/render.js').then(r => {
            if (typeof r.draw === 'function') r.draw();
        });
    });

    // Refresh Active Panel if present
    const panel = document.getElementById("info");
    if (panel && panel.innerHTML.includes("Activated Chunk Segment")) {
        const activeHash = window.location.hash.replace("#node-", "");
        if (activeHash) {
            const activeNode = state.allData.find(d => String(d.chunk_id || d.id || d.paper_id) === String(activeHash));
            if (activeNode && typeof updatePanel === "function") updatePanel(activeNode);
        }
    }

    console.log("[System] Cleanly disabled all categories. Master tags ('paper', 'chunk', 'chunks') are strictly protected from subclustering.");
}


/**
 * 3. GLOBAL INTERCEPTOR / GUARD
 * Intercepts calls to recursivelyToggleTagSubpaths across the app
 * to prevent any other script from subclustering master tags.
 */
if (typeof window.recursivelyToggleTagSubpaths === "function" && !window._recursivelyToggleSubpathsGuarded) {
    const originalSubpathFunc = window.recursivelyToggleTagSubpaths;
    /**
     * Intercepts subpath toggling calls across the application to block subclustering operations
     * attempted on protected master tags ('paper', 'chunk', 'chunks').
     *
     * @param {string} tag - The target tag identifier to evaluate.
     * @param {string|null} subPath - The sub-path string to toggle.
     * @param {boolean} hideState - Desired visibility state (true to hide, false to show).
     * @returns {void}
     */
    window.recursivelyToggleTagSubpaths = function(tag, subPath, hideState) {
        if (PROTECTED_MASTER_TAGS.has(tag)) {
            console.warn(`[System Guard] Blocked subclustering attempt on protected master tag: "${tag}"`);
            return; // Intercept and block!
        }
        return originalSubpathFunc.apply(this, arguments);
    };
    window._recursivelyToggleSubpathsGuarded = true;
}


/**
 * Renders and updates the floating tag legend widget, constructing interactive hierarchical
 * trees for data tags, drag-and-drop reordering, subcluster controls, and automated labeling actions.
 *
 * @returns {void}
 */
export function buildTagDropdownUI() {
    // Target the floating widget container instead of the sidebar
    const container = document.getElementById("floatingTagLegend");
    if (!container || !state.allData || state.allData.length === 0) return;

    if (!state.tagSubClusterOrder) state.tagSubClusterOrder = {};
    if (!state.tagOrder) state.tagOrder = [];
    if (!state.collapsedTagNodes) state.collapsedTagNodes = new Set();
    let dragSourceEl = null;

    // INTERNAL HELPER FUNCTIONS
    const getEffectiveNodes = (tag) => {
        return state.allData.filter(d => d.tag === tag);
    };

    const getCleanPath = (val) => {
        return val ? String(val).replace(/^Cluster\s+/i, '').trim() : "";
    };

    const getAllKnownPaths = (tagNodes) => {
        const paths = new Set();
        tagNodes.forEach(d => {
            const clean = getCleanPath(d.tag_sub_path);
            if (clean) {
                const parts = clean.split('.');
                let currentPath = "";
                parts.forEach((part, idx) => {
                    currentPath = idx === 0 ? part : `${currentPath}.${part}`;
                    paths.add(currentPath);
                });
            }
        });
        return Array.from(paths);
    };

    const recursivelyToggleTagSubpaths = (tag, prefixPath, hide) => {
        if (!state.hiddenTagSubPaths) state.hiddenTagSubPaths = new Set();
        if (!state.hiddenSubClusters) state.hiddenSubClusters = new Set();

        const tagNodes = getEffectiveNodes(tag);
        const allKnown = getAllKnownPaths(tagNodes);

        if (!prefixPath) {
            const rootKey = `${tag}_root`;
            if (hide) {
                state.hiddenSubClusters.add(tag);
                state.hiddenSubClusters.add(rootKey);
            } else {
                state.hiddenSubClusters.delete(tag);
                state.hiddenSubClusters.delete(rootKey);
            }
        }

        allKnown.forEach(path => {
            if (!prefixPath || path === prefixPath || path.startsWith(`${prefixPath}.`)) {
                const fullKey = `${tag}::${path}`;
                const clusterKey = `${tag}_Cluster ${path}`;
                const alternativeKey = `${tag}_${path}`;

                if (hide) {
                    state.hiddenTagSubPaths.add(fullKey);
                    state.hiddenSubClusters.add(clusterKey);
                    state.hiddenSubClusters.add(alternativeKey);
                } else {
                    state.hiddenTagSubPaths.delete(fullKey);
                    state.hiddenSubClusters.delete(clusterKey);
                    state.hiddenSubClusters.delete(alternativeKey);
                }
            }
        });
    };

    const triggerGlobalSummaryOrKeywords = async (mode, btnEl) => {
        if (!state.clusterNames) state.clusterNames = {};
        const originalText = btnEl.innerText;
        btnEl.innerText = `Generating all ${mode}...`;
        btnEl.disabled = true;

        const getCleanId = (d) => {
            if (d.chunk_id) return String(d.chunk_id);
            if (d.paper_id) return String(d.paper_id);
            let id = d.id;
            if (typeof id === 'string' && id.startsWith('metadata_')) {
                const match = id.match(/(\d+)$/);
                if (match) return `paper_${match[1]}`;
            }
            return id;
        };

        try {
            const uniqueTags = [...new Set(state.allData.map(d => d.tag).filter(Boolean))];
            const clusterMap = {};

            uniqueTags.forEach(tag => {
                const tagNodes = state.allData.filter(d => d.tag === tag);
                clusterMap[`${tag}_root`] = [...new Set(tagNodes.map(getCleanId).filter(Boolean))];

                const allPaths = typeof getAllKnownPaths === 'function' ? getAllKnownPaths(tagNodes) : [];
                allPaths.forEach(subPath => {
                    const subNodes = tagNodes.filter(d => d.tag_sub_path === subPath || (d.tag_sub_path && String(d.tag_sub_path).startsWith(subPath + '.')));
                    clusterMap[`${tag}_${subPath}`] = [...new Set(subNodes.map(getCleanId).filter(Boolean))];
                });
            });

            const response = await fetch('/api/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: mode, clusters: clusterMap })
            });

            if (!response.ok) throw new Error(`Server returned ${response.status}`);

            const data = await response.json();

            Object.keys(clusterMap).forEach(key => {
                if (data && data[key]) {
                    state.clusterNames[key] = data[key];
                }
            });

            if (typeof buildTagDropdownUI === 'function') buildTagDropdownUI();

            import('../canvas/render.js').then(r => {
                if (typeof r.updateLabels === 'function') r.updateLabels();
                else if (typeof r.draw === 'function') r.draw();
            });

            if (typeof window.saveState === 'function' && !window.isRestoring) {
                window.saveState();
            } else if (typeof window.saveHistoryState === 'function' && !window.isRestoring) {
                window.saveHistoryState();
            }

        } catch (err) {
            console.error(`Failed global ${mode} generation:`, err);
            alert(`Failed to generate global ${mode}. See console for details.`);
        } finally {
            btnEl.innerText = originalText;
            btnEl.disabled = false;
        }
    };

    const attachDragListeners = (itemEl) => {
        itemEl.addEventListener('dragstart', function(e) {
            e.stopPropagation();
            dragSourceEl = this;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => this.style.opacity = '0.3', 0);
        });

        itemEl.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (dragSourceEl === this || !dragSourceEl) return;
            if (this.dataset.type !== dragSourceEl.dataset.type || this.dataset.parent !== dragSourceEl.dataset.parent) return;

            const rect = this.getBoundingClientRect();
            const relY = e.clientY - rect.top;

            this.style.borderTop = 'none';
            this.style.borderBottom = 'none';
            this.style.backgroundColor = '';
            this.style.outline = 'none';

            if (relY < rect.height * 0.25) {
                this.style.borderTop = '2px solid #2563eb';
                this.dataset.dropAction = 'before';
            } else if (relY > rect.height * 0.75) {
                this.style.borderBottom = '2px solid #2563eb';
                this.dataset.dropAction = 'after';
            } else {
                if (this.dataset.type === 'root') {
                    if (relY < rect.height * 0.5) {
                        this.style.borderTop = '2px solid #2563eb';
                        this.dataset.dropAction = 'before';
                    } else {
                        this.style.borderBottom = '2px solid #2563eb';
                        this.dataset.dropAction = 'after';
                    }
                } else {
                    this.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                    this.style.outline = '1px dashed #2563eb';
                    this.dataset.dropAction = 'merge';
                }
            }
        });

        itemEl.addEventListener('dragleave', function(e) {
            e.stopPropagation();
            this.style.borderTop = 'none';
            this.style.borderBottom = 'none';
            this.style.backgroundColor = '';
            this.style.outline = 'none';
        });

        itemEl.addEventListener('dragend', function(e) {
            e.stopPropagation();
            this.style.opacity = '1';
            dragSourceEl = null;
            document.querySelectorAll('.tag-drag-item').forEach(i => {
                i.style.borderTop = 'none';
                i.style.borderBottom = 'none';
                i.style.backgroundColor = '';
                i.style.outline = 'none';
            });
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        });

        itemEl.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.style.borderTop = 'none';
            this.style.borderBottom = 'none';
            this.style.backgroundColor = '';
            this.style.outline = 'none';

            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

            if (dragSourceEl === this || !dragSourceEl) return;
            if (this.dataset.type !== dragSourceEl.dataset.type || this.dataset.parent !== dragSourceEl.dataset.parent) return;

            const dropAction = this.dataset.dropAction;
            const sourceId = dragSourceEl.dataset.id;
            const targetId = this.dataset.id;
            const parentKey = this.dataset.parent;
            const itemTag = this.dataset.tag;
            const isRoot = this.dataset.type === 'root';

            if (dropAction === 'merge' && !isRoot) {
                if (typeof window.mergeTagSubClusters === 'function') {
                    window.mergeTagSubClusters(itemTag, sourceId, targetId, isRoot, parentKey);
                } else {
                    state.allData.forEach(d => {
                        if (d.tag === itemTag && d.tag_sub_path) {
                            const clean = getCleanPath(d.tag_sub_path);
                            if (clean === sourceId || clean.startsWith(sourceId + '.')) {
                                d.tag_sub_path = clean.replace(sourceId, targetId);
                            }
                        }
                    });
                    buildTagDropdownUI();
                    import('../core/data.js').then(m => { if (typeof m.applyGlobalFilters === 'function') m.applyGlobalFilters(); });
                    import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
                }
            } else if (dropAction !== 'merge') {
                const insertAfter = (dropAction === 'after');
                let arr = isRoot ? state.tagOrder : state.tagSubClusterOrder[parentKey];

                const fromIndex = arr.findIndex(v => String(v) === String(sourceId));
                const toIndex = arr.findIndex(v => String(v) === String(targetId));

                if (fromIndex > -1 && toIndex > -1) {
                    const [movedItem] = arr.splice(fromIndex, 1);
                    const adjustedToIndex = arr.findIndex(v => String(v) === String(targetId));
                    arr.splice(insertAfter ? adjustedToIndex + 1 : adjustedToIndex, 0, movedItem);
                    buildTagDropdownUI();
                }
            }
        });
    };

    const renderTagSubtree = (tag, parentPath, containerDom, depth = 1) => {
        const tagNodes = getEffectiveNodes(tag);
        const allKnownPaths = getAllKnownPaths(tagNodes);

        const immediateChildren = allKnownPaths.filter(path => {
            if (!parentPath) return !path.includes('.');
            const prefix = parentPath + '.';
            return path.startsWith(prefix) && !path.slice(prefix.length).includes('.');
        });

        if (immediateChildren.length === 0) return;

        const parentKey = `${tag}::${parentPath || 'root'}`;
        if (!state.tagSubClusterOrder[parentKey]) state.tagSubClusterOrder[parentKey] = [];
        immediateChildren.forEach(child => {
            if (!state.tagSubClusterOrder[parentKey].includes(child)) {
                state.tagSubClusterOrder[parentKey].push(child);
            }
        });
        state.tagSubClusterOrder[parentKey] = state.tagSubClusterOrder[parentKey].filter(child => immediateChildren.includes(child));

        const orderedChildren = state.tagSubClusterOrder[parentKey];
        const uniqueTags = [...new Set(state.allData.map(d => d.tag).filter(Boolean))].sort();
        const tagIdx = uniqueTags.indexOf(tag);

        const parentNodeStateKey = parentPath === null ? tag : `${tag}::${parentPath}`;
        const isParentCollapsed = state.collapsedTagNodes.has(parentNodeStateKey);
        const isParentHidden = parentPath === null
            ? !state.visibleTags.has(tag)
            : (state.hiddenTagSubPaths && state.hiddenTagSubPaths.has(`${tag}::${parentPath}`));

        const treeContainer = document.createElement("div");
        treeContainer.className = "sub-cluster-tree-container";
        treeContainer.style.cssText = `margin-left: ${depth === 1 ? '16' : '12'}px; padding-left: 8px; border-left: 1.5px solid #e5e7eb; margin-top: 4px; display: ${isParentHidden || isParentCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 4px;`;

        orderedChildren.forEach(subPath => {
            const subDiv = document.createElement("div");
            subDiv.className = "tag-drag-item";
            subDiv.draggable = true;
            subDiv.dataset.type = "sub";
            subDiv.dataset.id = subPath;
            subDiv.dataset.parent = parentKey;
            subDiv.dataset.tag = tag;
            subDiv.style.cssText = "margin-bottom: 4px; border-radius: 4px; transition: background-color 0.15s;";

            const safeSubId = `${tag}_${subPath}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const count = tagNodes.filter(d => {
                const cleanNodePath = getCleanPath(d.tag_sub_path);
                return cleanNodePath === subPath || cleanNodePath.startsWith(subPath + '.');
            }).length;

            const fullKey = `${tag}::${subPath}`;
            const clusterKey = `${tag}_${subPath}`;
            const isCollapsed = state.collapsedTagNodes.has(fullKey);

            if (!state.hiddenTagSubPaths) state.hiddenTagSubPaths = new Set();
            const isHidden = state.hiddenTagSubPaths.has(fullKey);
            const hasChildren = allKnownPaths.some(p => p.startsWith(`${subPath}.`));

            const hyphenPath = subPath.replace(/\./g, '-');
            const nodeColor = getTagSubClusterColor(tag, tagIdx, hyphenPath);

            const row = document.createElement("div");
            row.style.cssText = "display: flex; align-items: center; cursor: pointer; user-select: none; padding: 2px 4px;";

            const dragHandle = document.createElement("div");
            dragHandle.style.cssText = "cursor: grab; margin-right: 4px; color: #d1d5db; display: flex; align-items: center;";
            dragHandle.title = "Drag to reorder or merge";
            dragHandle.innerHTML = `
                <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                    <circle cx="2" cy="2" r="1.2"></circle><circle cx="6" cy="2" r="1.2"></circle>
                    <circle cx="2" cy="6" r="1.2"></circle><circle cx="6" cy="6" r="1.2"></circle>
                    <circle cx="2" cy="10" r="1.2"></circle><circle cx="6" cy="10" r="1.2"></circle>
                </svg>
            `;
            dragHandle.addEventListener("mousedown", (e) => { e.stopPropagation(); dragHandle.style.cursor = 'grabbing'; });
            dragHandle.addEventListener("mouseup", () => { dragHandle.style.cursor = 'grab'; });
            dragHandle.addEventListener("click", (e) => e.stopPropagation());
            row.appendChild(dragHandle);

            if (hasChildren && !isHidden) {
                const collapseToggle = document.createElement("span");
                collapseToggle.title = isCollapsed ? "Expand subclusters" : "Collapse subclusters";
                collapseToggle.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-right: 4px; color: #6b7280; font-size: 10px; user-select: none; transition: color 0.15s;";
                collapseToggle.innerText = isCollapsed ? '▶' : '▼';
                collapseToggle.addEventListener("mouseover", () => collapseToggle.style.color = '#111827');
                collapseToggle.addEventListener("mouseout", () => collapseToggle.style.color = '#6b7280');
                collapseToggle.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (state.collapsedTagNodes.has(fullKey)) state.collapsedTagNodes.delete(fullKey);
                    else state.collapsedTagNodes.add(fullKey);
                    buildTagDropdownUI();
                });
                row.appendChild(collapseToggle);
            }

            const icon = document.createElement("div");
            icon.style.cssText = `width: 8px; height: 8px; border: 2px solid ${nodeColor}; border-radius: 50%; margin-right: 8px; flex-shrink: 0; transition: all 0.2s ease; opacity: ${isHidden ? '0.25' : '1'}; box-shadow: 0 0 0 1px rgba(0,0,0,0.05); box-sizing: border-box;`;

           const customName = state.clusterNames && state.clusterNames[clusterKey];

            // Check if the current cluster is the noise cluster (-1)
            const isNoise = String(subPath) === "-1" || String(subPath).endsWith(".-1");
            const defaultLabelName = isNoise ? "Noise" : `Subcluster ${subPath}`;

            const displayName = customName ? `${customName} (${count})` : `${defaultLabelName} (${count})`;

            const label = document.createElement("span");
            label.innerText = displayName;
            label.title = customName || defaultLabelName;
            label.style.cssText = `color: ${isHidden ? '#9ca3af' : '#4b5563'}; font-size: 10px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; text-decoration: ${isHidden ? "line-through" : "none"}; transition: all 0.2s ease;`;

            row.appendChild(icon);
            row.appendChild(label);
            if (hasChildren && isCollapsed && !isHidden) {
                const countLabel = document.createElement("span");
                countLabel.style.cssText = "font-size: 10px; color: #9ca3af; margin-left: 6px; font-weight: 500;";
                const activeChildCount = allKnownPaths.filter(p => p.startsWith(`${subPath}.`) && p.split('.').length === subPath.split('.').length + 1).length;
                countLabel.innerText = `(${activeChildCount})`;
                row.appendChild(countLabel);
            }

            if (hasChildren && !isHidden) {
                const deleteBtn = document.createElement("button");
                deleteBtn.innerText = "Clear";
                deleteBtn.title = "Delete all subclusters below and allow reclustering";
                deleteBtn.style.cssText = `margin-left: auto; background: transparent; border: 1px solid #fee2e2; color: #ef4444; font-size: 9px; font-weight: 600; border-radius: 3px; padding: 1px 5px; cursor: pointer; transition: all 0.15s ease;`;
                deleteBtn.addEventListener("mouseover", () => { deleteBtn.style.background = '#fef2f2'; deleteBtn.style.borderColor = '#fca5a5'; });
                deleteBtn.addEventListener("mouseout", () => { deleteBtn.style.background = 'transparent'; deleteBtn.style.borderColor = '#fee2e2'; });
                deleteBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    window.deleteTagSubClusters(tag, subPath);
                });
                row.appendChild(deleteBtn);
            }

            row.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!state.hiddenTagSubPaths) state.hiddenTagSubPaths = new Set();
                const nextHidden = !state.hiddenTagSubPaths.has(fullKey);

                recursivelyToggleTagSubpaths(tag, subPath, nextHidden);

                icon.style.opacity = nextHidden ? '0.25' : '1';
                label.style.color = nextHidden ? '#9ca3af' : '#4b5563';
                label.style.textDecoration = nextHidden ? 'line-through' : 'none';

                const childTree = subDiv.querySelector('.sub-cluster-tree-container');
                const controlsEl = subDiv.querySelector('.tag-controls');
                if (childTree) childTree.style.display = nextHidden || state.collapsedTagNodes.has(fullKey) ? 'none' : 'flex';
                if (controlsEl) controlsEl.style.display = (!nextHidden && !hasChildren) ? 'flex' : 'none';

                import('../core/data.js').then(module => {
                    if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
                    import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
                });
            });

            subDiv.appendChild(row);

            const showControls = !isHidden && !hasChildren;

            const controls = document.createElement("div");
            controls.className = "tag-controls";
            controls.style.cssText = `margin-left: 16px; margin-top: 4px; display: ${showControls ? 'flex' : 'none'}; gap: 6px; align-items: center; font-size: 10px; flex-wrap: nowrap;`;
            controls.innerHTML = `
                <span style="color: #6b7280; font-weight: 600;">K:</span>
                <input type="number" id="tagSubK-${safeSubId}" value="3" min="2" max="15" style="width: 28px; border: 1px solid #d1d5db; border-radius: 2px; text-align: center; background: #fff; padding: 1px 0;">
                <select id="tagSubMethod-${safeSubId}" style="width: 68px; border: 1px solid #d1d5db; border-radius: 2px; background: white; padding: 1px 0;">
                    <option value="kmeans">K-Means</option>
                    <option value="hdbscan">HDBSCAN</option>
                </select>
                <button id="splitBtn-${safeSubId}" style="cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 2px; padding: 2px 6px; font-weight: 500;">Split</button>
            `;
            controls.addEventListener("click", (e) => e.stopPropagation());
            subDiv.appendChild(controls);

            const splitBtn = controls.querySelector(`#splitBtn-${safeSubId}`);
            if (splitBtn) {
                splitBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (typeof window.triggerTagSubCluster === 'function') {
                        window.triggerTagSubCluster(tag, safeSubId, subPath);
                    }
                });
            }

            attachDragListeners(subDiv);
            renderTagSubtree(tag, subPath, subDiv, depth + 1);
            treeContainer.appendChild(subDiv);
        });

        containerDom.appendChild(treeContainer);
    };

    // 2. MAIN UI INITIALIZATION - RENDER TO FLOATING WIDGET

    // Clear out the container for rebuilding
    container.innerHTML = "";

    const isCollapsed = container.classList.contains('is-collapsed');

    // 2a. Create Panel Header (Stays visible when collapsed)
    const header = document.createElement("div");
    header.className = "panel-header drag-handle";
    header.title = "Drag to move or dock in sidebar";
    header.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; cursor: grab; user-select: none;";

    header.innerHTML = `
        <span style="font-size: 12px; font-weight: 700; color: #111827;" id="floatingTagLegendHeader">Toggle & Cluster by Tag</span>
        
        <div style="display: flex; align-items: center; gap: 4px;">
            <!-- Collapse / Expand Button -->
            <button class="collapse-btn" onclick="window.togglePanelCollapse('floatingTagLegend')" title="${isCollapsed ? 'Expand Panel' : 'Collapse Panel'}" style="
                background: transparent; border: none; font-size: 14px; font-weight: bold; 
                color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#9ca3af'">
                ${isCollapsed ? '+' : '−'}
            </button>
            
            <!-- Dock & Collapse (X) Button -->
            <button onclick="window.dockAndCollapse('floatingTagLegend')" title="Dock to Sidebar & Collapse" style="
                background: transparent; border: none; font-size: 16px; font-weight: 300; 
                color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
        </div>
    `;

    // Create Panel Body Container (Hides when collapsed)
    const panelBody = document.createElement("div");
    panelBody.className = "panel-body";
    panelBody.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    // Inner content container replacing 'tagFilterContent'
    const contentContainer = document.createElement("div");
    contentContainer.id = "tagFilterContent";
    contentContainer.style.paddingTop = "2px";

    panelBody.appendChild(contentContainer);

    // Append Header and Body to Main Container
    container.appendChild(header);
    container.appendChild(panelBody);

    // Initialize drag and dock mechanics
    makeDraggableAndDockable('floatingTagLegend');

    // Data initialization logic
    const rawUniqueTags = [...new Set(state.allData.map(d => d.tag).filter(Boolean))].sort();

    rawUniqueTags.forEach(t => {
        if (!state.tagOrder.includes(t)) state.tagOrder.push(t);
    });
    state.tagOrder = state.tagOrder.filter(t => rawUniqueTags.includes(t));
    const uniqueTags = state.tagOrder;

    if (!state.tagsInitialized) {
        state.visibleTags = new Set(uniqueTags.filter(tag => !tag.startsWith('metadata_')));
        state.hiddenTagSubPaths = new Set();
        state.tagsInitialized = true;
    }
    // Global Actions (Keywords / Summary)
const globalActionsDiv = document.createElement("div");
globalActionsDiv.style.cssText = "display: flex; background: #f3f4f6; border-radius: 4px; padding: 2px; gap: 2px; margin-bottom: 8px;";

// Summary Button
const globalSumBtn = document.createElement("button");
const isSumActive = state.globalClusterLabelMode === 'summary';
globalSumBtn.className = `legend-mode-btn ${isSumActive ? 'active' : ''}`;
globalSumBtn.dataset.mode = 'summaries';
globalSumBtn.innerText = "Summary";
globalSumBtn.style.cssText = `flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; transition: all 0.15s ease; background: ${isSumActive ? '#ffffff' : 'transparent'}; box-shadow: ${isSumActive ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};`;

globalSumBtn.addEventListener("click", () => {
    state.globalClusterLabelMode = 'summary';
    triggerGlobalSummaryOrKeywords('summaries', globalSumBtn);
});

// Keywords Button
const globalKwBtn = document.createElement("button");
const isKwActive = state.globalClusterLabelMode === 'keywords';
globalKwBtn.className = `legend-mode-btn ${isKwActive ? 'active' : ''}`;
globalKwBtn.dataset.mode = 'keywords';
globalKwBtn.innerText = "Keywords";
globalKwBtn.style.cssText = `flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; transition: all 0.15s ease; background: ${isKwActive ? '#ffffff' : 'transparent'}; box-shadow: ${isKwActive ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};`;

globalKwBtn.addEventListener("click", () => {
    state.globalClusterLabelMode = 'keywords';
    triggerGlobalSummaryOrKeywords('keywords', globalKwBtn);
});

// Append to DOM
globalActionsDiv.appendChild(globalSumBtn);
globalActionsDiv.appendChild(globalKwBtn);
contentContainer.appendChild(globalActionsDiv);
const isColorActive = state.colorByMetadata === true;

const colorToggleDiv = document.createElement("div");
colorToggleDiv.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; margin-bottom: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; user-select: none; transition: border-color 0.15s ease;";
colorToggleDiv.title = "Toggle coloring nodes by their metadata tags instead of standard clustering.";

colorToggleDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isColorActive ? '#2563eb' : '#64748b'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="color-icon" style="flex-shrink: 0; transition: stroke 0.2s ease;">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
            <path d="M2 12h20"></path>
        </svg>
        <span style="font-size: 10.5px; font-weight: 600; color: #334155; white-space: nowrap;">Color by Tag</span>
    </div>
    <label style="position: relative; display: inline-block; width: 28px; height: 16px; cursor: pointer; flex-shrink: 0; margin: 0;">
        <input type="checkbox" id="colorByMetadataToggle" ${isColorActive ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
        <span class="toggle-track" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isColorActive ? '#2563eb' : '#cbd5e1'}; transition: background-color 0.2s ease; border-radius: 16px;">
            <span class="toggle-knob" style="position: absolute; height: 12px; width: 12px; left: 2px; bottom: 2px; background-color: white; transition: transform 0.2s ease; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transform: ${isColorActive ? 'translateX(12px)' : 'translateX(0px)'};"></span>
        </span>
    </label>
`;

const colorInput = colorToggleDiv.querySelector("#colorByMetadataToggle");
const colorTrack = colorToggleDiv.querySelector(".toggle-track");
const colorKnob = colorToggleDiv.querySelector(".toggle-knob");
const colorIcon = colorToggleDiv.querySelector(".color-icon");

colorInput.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    state.colorByMetadata = isChecked;

    // Update UI animations
    colorTrack.style.backgroundColor = isChecked ? '#2563eb' : '#cbd5e1';
    colorKnob.style.transform = isChecked ? 'translateX(12px)' : 'translateX(0px)';
    colorIcon.setAttribute("stroke", isChecked ? '#2563eb' : '#64748b');
    updatePanel();
    // Trigger map redraw immediately
     import('../core/data.js').then(data => {
         if (typeof data.applyGlobalFilters === 'function')
             data.applyGlobalFilters();
     });
    import('../canvas/render.js').then(r => {
        if (typeof r.draw === 'function') r.draw();
    });
});

contentContainer.appendChild(colorToggleDiv);
    // CASCADING TOGGLE COMPONENT
    const isCascadeActive = state.hideAssociatedChunks !== false;

    const cascadeToggleDiv = document.createElement("div");
    cascadeToggleDiv.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; user-select: none; transition: border-color 0.15s ease;";
    cascadeToggleDiv.title = "When active, hiding a metadata tag also suppresses all associated nodes across the view.";

    cascadeToggleDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isCascadeActive ? '#2563eb' : '#64748b'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cascade-icon" style="flex-shrink: 0; transition: stroke 0.2s ease;">
                <rect x="3" y="3" width="6" height="6" rx="1.5"/>
                <rect x="15" y="15" width="6" height="6" rx="1.5"/>
                <path d="M6 9v3a3 3 0 0 0 3 3h6"/>
            </svg>
            <span style="font-size: 10.5px; font-weight: 600; color: #334155; white-space: nowrap;">Cascade Embeddings</span>
        </div>
        <label style="position: relative; display: inline-block; width: 28px; height: 16px; cursor: pointer; flex-shrink: 0; margin: 0;">
            <input type="checkbox" id="cascadeHideToggle" ${isCascadeActive ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
            <span class="toggle-track" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${isCascadeActive ? '#2563eb' : '#cbd5e1'}; transition: background-color 0.2s ease; border-radius: 16px;">
                <span class="toggle-knob" style="position: absolute; height: 12px; width: 12px; left: 2px; bottom: 2px; background-color: white; transition: transform 0.2s ease; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transform: ${isCascadeActive ? 'translateX(12px)' : 'translateX(0px)'};"></span>
            </span>
        </label>
    `;

    const toggleInput = cascadeToggleDiv.querySelector("#cascadeHideToggle");
    const toggleTrack = cascadeToggleDiv.querySelector(".toggle-track");
    const toggleKnob = cascadeToggleDiv.querySelector(".toggle-knob");
    const cascadeIcon = cascadeToggleDiv.querySelector(".cascade-icon");

    toggleInput.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        toggleTrack.style.backgroundColor = isChecked ? '#2563eb' : '#cbd5e1';
        toggleKnob.style.transform = isChecked ? 'translateX(12px)' : 'translateX(0px)';
        cascadeIcon.setAttribute("stroke", isChecked ? '#2563eb' : '#64748b');

        if (typeof window.toggleHideAssociatedChunks === 'function') {
            window.toggleHideAssociatedChunks(isChecked);
        } else {
            state.hideAssociatedChunks = isChecked;
            import('../core/data.js').then(module => {
                if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
            });
        }
    });

    contentContainer.appendChild(cascadeToggleDiv);

    // 3. TAG LIST RENDER LOOP
    uniqueTags.forEach((tag, tagIdx) => {
        const tagItemContainer = document.createElement("div");
        tagItemContainer.className = "tag-drag-item";
        tagItemContainer.draggable = true;
        tagItemContainer.dataset.type = "root";
        tagItemContainer.dataset.id = tag;
        tagItemContainer.dataset.parent = "root";
        tagItemContainer.dataset.tag = tag;
        tagItemContainer.style.cssText = "margin-bottom: 8px; font-family: system-ui, sans-serif; border-radius: 4px; transition: background-color 0.15s;";

        const isVisible = state.visibleTags.has(tag);
        const hasSubClusters = state.allData.some(d => d.tag === tag && d.tag_sub_path && String(d.tag_sub_path).trim() !== '');
        const isCollapsed = state.collapsedTagNodes.has(tag);

        const row = document.createElement("div");
        row.className = "tag-checkbox-row";
        row.style.cssText = "display: flex; align-items: center; cursor: pointer; user-select: none; padding: 2px 4px;";

        const dragHandle = document.createElement("div");
        dragHandle.style.cssText = "cursor: grab; margin-right: 4px; color: #d1d5db; display: flex; align-items: center;";
        dragHandle.title = "Drag to reorder";
        dragHandle.innerHTML = `
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                <circle cx="2" cy="2" r="1.2"></circle><circle cx="6" cy="2" r="1.2"></circle>
                <circle cx="2" cy="6" r="1.2"></circle><circle cx="6" cy="6" r="1.2"></circle>
                <circle cx="2" cy="10" r="1.2"></circle><circle cx="6" cy="10" r="1.2"></circle>
            </svg>
        `;
        dragHandle.addEventListener("mousedown", (e) => { e.stopPropagation(); dragHandle.style.cursor = 'grabbing'; });
        dragHandle.addEventListener("mouseup", () => { dragHandle.style.cursor = 'grab'; });
        dragHandle.addEventListener("click", (e) => e.stopPropagation());
        row.appendChild(dragHandle);

        if (hasSubClusters && isVisible) {
            const collapseToggle = document.createElement("span");
            collapseToggle.title = isCollapsed ? "Expand categories" : "Collapse categories";
            collapseToggle.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-right: 4px; color: #6b7280; font-size: 10px; user-select: none; transition: color 0.15s;";
            collapseToggle.innerText = isCollapsed ? '▶' : '▼';
            collapseToggle.addEventListener("mouseover", () => collapseToggle.style.color = '#111827');
            collapseToggle.addEventListener("mouseout", () => collapseToggle.style.color = '#6b7280');
            collapseToggle.addEventListener("click", (e) => {
                e.stopPropagation();
                if (state.collapsedTagNodes.has(tag)) state.collapsedTagNodes.delete(tag);
                else state.collapsedTagNodes.add(tag);
                buildTagDropdownUI();
            });
            row.appendChild(collapseToggle);
        }

        const tagColor = getTagRegionColor(tag, tagIdx);

        const icon = document.createElement("div");
        icon.style.cssText = `width: 10px; height: 10px; border: 2px solid ${tagColor}; border-radius: 50%; margin-right: 8px; flex-shrink: 0; transition: all 0.2s ease; opacity: ${!isVisible ? '0.25' : '1'}; box-shadow: 0 0 0 1px rgba(0,0,0,0.05); box-sizing: border-box;`;

        const rootKey = `${tag}_root`;
        const customName = state.clusterNames && state.clusterNames[rootKey];
        const displayName = tag.replace(/^metadata_/i, '');

        const label = document.createElement("span");
        label.innerText = displayName;
        label.title = customName ? `${displayName} (${customName})` : displayName;
        label.style.cssText = `text-transform: capitalize; color: ${!isVisible ? '#9ca3af' : '#1f2937'}; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; text-decoration: ${!isVisible ? 'line-through' : 'none'}; transition: all 0.2s ease;`;

        const selectBox = document.createElement("input");
        selectBox.type = "checkbox";
        selectBox.className = "metadata-select-box";
        selectBox.style.cssText = "margin-right: 6px; cursor: pointer; width: 11px; height: 11px;";
        selectBox.checked = state.selectedMetadataKey === rootKey;
        selectBox.dataset.tag = tag;

        selectBox.addEventListener("click", (e) => e.stopPropagation());
        selectBox.addEventListener("change", () => {
            if (selectBox.checked) {
                document.querySelectorAll(".metadata-select-box").forEach(cb => {
                    if (cb !== selectBox && cb.checked) {
                        cb.checked = false;
                        if (cb.dataset.tag) window.toggleMetaClusterBorder(cb.dataset.tag, false);
                    }
                });
                state.selectedMetadataKey = rootKey;
                state.selectedMetadataName = displayName;
                state.selectedMetadataTag = tag;
                state.selectedMetadataSubPath = null;
                window.toggleMetaClusterBorder(tag, true);
            } else {
                if (state.selectedMetadataKey === rootKey) {
                    state.selectedMetadataKey = null;
                    state.selectedMetadataName = null;
                    state.selectedMetadataTag = null;
                    state.selectedMetadataSubPath = null;
                }
                window.toggleMetaClusterBorder(tag, false);
            }
        });

        row.appendChild(selectBox);
        row.appendChild(icon);
        row.appendChild(label);

        if (hasSubClusters && isCollapsed && isVisible) {
            const countLabel = document.createElement("span");
            countLabel.style.cssText = "font-size: 10px; color: #9ca3af; margin-left: 6px; font-weight: 500;";
            const tagNodes = getEffectiveNodes(tag);
            const activeChildCount = getAllKnownPaths(tagNodes).filter(p => !p.includes('.')).length;
            countLabel.innerText = `(${activeChildCount})`;
            row.appendChild(countLabel);
        }

        if (hasSubClusters && isVisible) {
            const rootDeleteBtn = document.createElement("button");
            rootDeleteBtn.innerText = "Clear";
            rootDeleteBtn.title = "Delete all subclusters below and allow reclustering";
            rootDeleteBtn.style.cssText = `margin-left: auto; background: transparent; border: 1px solid #fee2e2; color: #ef4444; font-size: 9px; font-weight: 600; border-radius: 3px; padding: 1px 5px; cursor: pointer; transition: all 0.15s ease;`;
            rootDeleteBtn.addEventListener("mouseover", () => { rootDeleteBtn.style.background = '#fef2f2'; rootDeleteBtn.style.borderColor = '#fca5a5'; });
            rootDeleteBtn.addEventListener("mouseout", () => { rootDeleteBtn.style.background = 'transparent'; rootDeleteBtn.style.borderColor = '#fee2e2'; });
            rootDeleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                window.deleteTagSubClusters(tag, null);
            });
            row.appendChild(rootDeleteBtn);
        }

        row.addEventListener("click", (e) => {
            e.stopPropagation();
            const nextVisible = !state.visibleTags.has(tag);

            if (nextVisible) {
                state.visibleTags.add(tag);
                recursivelyToggleTagSubpaths(tag, null, false);
                icon.style.opacity = '1';
                label.style.color = '#1f2937';
                label.style.textDecoration = 'none';
            } else {
                state.visibleTags.delete(tag);
                recursivelyToggleTagSubpaths(tag, null, true);
                icon.style.opacity = '0.25';
                label.style.color = '#9ca3af';
                label.style.textDecoration = 'line-through';
            }

            const childTree = tagItemContainer.querySelector('.sub-cluster-tree-container');
            const controlsEl = tagItemContainer.querySelector('.tag-controls');

            if (childTree) childTree.style.display = (nextVisible && !state.collapsedTagNodes.has(tag)) ? 'flex' : 'none';
            if (controlsEl) controlsEl.style.display = (nextVisible && !hasSubClusters) ? 'flex' : 'none';

            import('../core/data.js').then(module => {
                if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
                import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
            });
        });

        tagItemContainer.appendChild(row);

        const showControls = isVisible && !hasSubClusters;

        const controls = document.createElement("div");
        controls.className = "tag-controls";
        controls.style.cssText = `margin-left: 20px; margin-top: 4px; display: ${showControls ? 'flex' : 'none'}; gap: 6px; align-items: center; font-size: 10px; flex-wrap: nowrap;`;

        const safeTagId = String(tag).replace(/[^a-zA-Z0-9_-]/g, '_');
        controls.innerHTML = `
            <span style="color: #6b7280; font-weight: 600;">K:</span>
            <input type="number" id="tagSubK-${safeTagId}" value="3" min="2" max="15" style="width: 28px; border: 1px solid #d1d5db; border-radius: 2px; text-align: center; background: #ffffff; padding: 1px 0;">
            <select id="tagSubMethod-${safeTagId}" style="width: 68px; border: 1px solid #d1d5db; border-radius: 2px; background: white; padding: 1px 0;">
                <option value="kmeans">K-Means</option>
                <option value="hdbscan">HDBSCAN</option>
            </select>
            <button id="splitBtn-${safeTagId}" style="cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 2px; padding: 2px 6px; font-weight: 500;">Split</button>
        `;
        controls.addEventListener("click", (e) => e.stopPropagation());
        tagItemContainer.appendChild(controls);

        const rootSplitBtn = controls.querySelector(`#splitBtn-${safeTagId}`);
        if (rootSplitBtn) {
            rootSplitBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (typeof window.triggerTagSubCluster === 'function') {
                    window.triggerTagSubCluster(tag, safeTagId, null);
                }

            });
        }

        attachDragListeners(tagItemContainer);
        renderTagSubtree(tag, null, tagItemContainer, 1);
        contentContainer.appendChild(tagItemContainer);
    });
}
