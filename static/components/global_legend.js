import {state} from "../core/state.js";
import {updatePanel} from "./meta_panel.js";
import {applyGradientColors, getClusterColor, getSubClusterColor} from '../clusters/color.js';
import {makeDraggableAndDockable} from './dock.js';

// global window handlers for toggling legend UI visibility
if (typeof window !== "undefined") {
    /**
     * Toggles the collapsed/expanded UI state of a specific legend node.
     *
     * @param {string} pathKey - Unique identifier key for the cluster/subcluster node (e.g., "0" or "0-1").
     * @returns {void}
     */
    window.toggleLegendCollapse = function (pathKey) {
        if (!state.collapsedLegendNodes) state.collapsedLegendNodes = new Set();
        if (state.collapsedLegendNodes.has(pathKey)) {
            state.collapsedLegendNodes.delete(pathKey);
        } else {
            state.collapsedLegendNodes.add(pathKey);
        }
        updateLegend();
    };

    /**
     * Toggles the collapse state of all active split subcluster nodes simultaneously.
     * Collapses all active splits if any are currently expanded, or expands all if all are collapsed.
     *
     * @returns {void}
     */
    window.toggleAllLegendCollapses = function () {
        if (!state.collapsedLegendNodes) state.collapsedLegendNodes = new Set();
        if (state.collapsedLegendNodes.size >= state.activeSplits.size) {
            state.collapsedLegendNodes.clear();
        } else {
            state.activeSplits.forEach(key => state.collapsedLegendNodes.add(key));
        }
        updateLegend();
    };
}

if (!window.mergeClusters) {
    /**
     * Merges a source cluster or subcluster into a target cluster or subcluster.
     * Re-indexes sub-paths, updates cluster labels, clears obsolete hierarchies, and triggers full re-renders.
     *
     * @param {string|number} sourceId - ID of the source cluster or subcluster to be merged.
     * @param {string|number} targetId - ID of the destination cluster or subcluster.
     * @param {boolean} isRoot - True if merging top-level root clusters; false if merging subclusters.
     * @param {string} [parentKey] - The parent path key context when merging subclusters (e.g., "0-1").
     * @returns {void}
     */
    window.mergeClusters = function(sourceId, targetId, isRoot, parentKey) {
        if (!state.allData) return;
        if (String(sourceId) === "-1" || String(targetId) === "-1") return;

        if (isRoot) {
            const sId = parseInt(sourceId, 10);
            const tId = parseInt(targetId, 10);
            const sourceIsSubclustered = state.allData.some(d => parseInt(d.cluster, 10) === sId && String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || "")) !== "");
            const targetIsSubclustered = state.allData.some(d => parseInt(d.cluster, 10) === tId && String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || "")) !== "");

            let maxSubId = -1;
            state.allData.forEach(d => {
                if (parseInt(d.cluster, 10) === tId) {
                    const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                    if (sp !== "") {
                        const val = parseInt(sp.split('-')[0], 10);
                        if (!isNaN(val) && val > maxSubId) maxSubId = val;
                    }
                }
            });

            if (!targetIsSubclustered && sourceIsSubclustered) {
                maxSubId = 0;
                state.allData.forEach(d => {
                    if (parseInt(d.cluster, 10) === tId) {
                        d.sub_path = "0";
                        d.sub_cluster = "0";
                    }
                });
            }

            const offset = maxSubId + 1;
            let sourceMaxId = -1;
            if (sourceIsSubclustered) {
                state.allData.forEach(d => {
                    if (parseInt(d.cluster, 10) === sId) {
                        const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                        if (sp !== "") {
                            const val = parseInt(sp.split('-')[0], 10);
                            if (!isNaN(val) && val > sourceMaxId) sourceMaxId = val;
                        }
                    }
                });
            }
            const flatNodeTargetId = String(sourceIsSubclustered ? offset + sourceMaxId + 1 : offset);

            state.allData.forEach(d => {
                if (parseInt(d.cluster, 10) === sId) {
                    d.cluster = tId;
                    const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));

                    if (sp !== "") {
                        const parts = sp.split('-');
                        parts[0] = parseInt(parts[0], 10) + offset;
                        d.sub_path = parts.join('-');
                        d.sub_cluster = d.sub_path;
                    } else {
                        if (targetIsSubclustered || sourceIsSubclustered) {
                            d.sub_path = flatNodeTargetId;
                            d.sub_cluster = d.sub_path;
                        } else {
                            d.sub_path = "";
                            d.sub_cluster = "";
                        }
                    }
                }
            });

            state.clusterOrder = state.clusterOrder.filter(c => c !== sId);
            state.hiddenClusters?.delete(sId);

            if (state.clusterLabels) {
                ['keywords', 'summaries'].forEach(mode => {
                    if (state.clusterLabels[mode]) {
                        delete state.clusterLabels[mode][String(sId)];
                        delete state.clusterLabels[mode][String(tId)];
                        Object.keys(state.clusterLabels[mode]).forEach(key => {
                            if (key.startsWith(`${sId}-`) || key.startsWith(`${tId}-`)) delete state.clusterLabels[mode][key];
                        });
                    }
                });
            }
        } else {
            const cId = parseInt(parentKey.split('-')[0], 10);
            const parentPrefix = parentKey.includes('-') ? parentKey.substring(parentKey.indexOf('-') + 1) : '';
            const sPath = parentPrefix ? `${parentPrefix}-${sourceId}` : String(sourceId);
            const tPath = parentPrefix ? `${parentPrefix}-${targetId}` : String(targetId);

            let sourceIsSubclustered = false;
            let targetIsSubclustered = false;
            let maxSubId = -1;

            state.allData.forEach(d => {
                if (parseInt(d.cluster, 10) === cId) {
                    const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                    if (sp.startsWith(sPath + '-')) sourceIsSubclustered = true;
                    if (sp.startsWith(tPath + '-')) {
                        targetIsSubclustered = true;
                        const remainder = sp.slice(tPath.length + 1);
                        const val = parseInt(remainder.split('-')[0], 10);
                        if (!isNaN(val) && val > maxSubId) maxSubId = val;
                    }
                }
            });

            if (!targetIsSubclustered && sourceIsSubclustered) {
                maxSubId = 0;
                state.allData.forEach(d => {
                    if (parseInt(d.cluster, 10) === cId) {
                        const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                        if (sp === tPath) {
                            d.sub_path = `${tPath}-0`;
                            d.sub_cluster = d.sub_path;
                        }
                    }
                });
            }

            const offset = maxSubId + 1;
            let sourceMaxId = -1;
            if (sourceIsSubclustered) {
                state.allData.forEach(d => {
                    if (parseInt(d.cluster, 10) === cId) {
                        const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                        if (sp.startsWith(sPath + '-')) {
                            const remainder = sp.slice(sPath.length + 1);
                            const val = parseInt(remainder.split('-')[0], 10);
                            if (!isNaN(val) && val > sourceMaxId) sourceMaxId = val;
                        }
                    }
                });
            }
            const flatNodeTargetId = `${tPath}-${sourceIsSubclustered ? offset + sourceMaxId + 1 : offset}`;

            state.allData.forEach(d => {
                if (parseInt(d.cluster, 10) === cId) {
                    const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                    if (sp.startsWith(sPath + '-')) {
                        const remainder = sp.slice(sPath.length + 1);
                        const parts = remainder.split('-');
                        parts[0] = parseInt(parts[0], 10) + offset;
                        d.sub_path = `${tPath}-${parts.join('-')}`;
                        d.sub_cluster = d.sub_path;
                    } else if (sp === sPath) {
                        if (targetIsSubclustered || sourceIsSubclustered) {
                            d.sub_path = flatNodeTargetId;
                            d.sub_cluster = d.sub_path;
                        } else {
                            d.sub_path = tPath;
                            d.sub_cluster = tPath;
                        }
                    }
                }
            });

            if (state.subClusterOrder[parentKey]) {
                state.subClusterOrder[parentKey] = state.subClusterOrder[parentKey].filter(v => String(v) !== String(sourceId));
            }
            const fullSourceKey = `${cId}-${sPath}`;
            const fullTargetKey = `${cId}-${tPath}`;

            state.hiddenPaths?.delete(fullSourceKey);
            state.collapsedLegendNodes?.delete(fullSourceKey);
            state.activeSplits?.delete(fullSourceKey);

            if (state.clusterLabels) {
                ['keywords', 'summaries'].forEach(mode => {
                    if (state.clusterLabels[mode]) {
                        delete state.clusterLabels[mode][fullSourceKey];
                        delete state.clusterLabels[mode][fullTargetKey];
                        Object.keys(state.clusterLabels[mode]).forEach(key => {
                            if (key.startsWith(`${fullSourceKey}-`) || key.startsWith(`${fullTargetKey}-`)) delete state.clusterLabels[mode][key];
                        });
                    }
                });
            }
        }

        state.hierarchyData = null;
        state.packData = null;
        state.treeData = null;

        setTimeout(() => {
            if (typeof updateLegend === 'function') updateLegend();
            if (state.globalClusterLabelMode && state.globalClusterLabelMode !== 'none') {
                import('../clusters/api.js').then(api => { if (typeof api.fetchLabels === 'function') api.fetchLabels(state.globalClusterLabelMode); });
            }
            import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
            if (typeof updatePanel === "function") updatePanel();
        }, 10);
    };
}

if (!window.createNewClusterCentroid) {
    /**
     * Creates a new empty cluster centroid with an incremental ID and registers it in global state.
     *
     * @returns {void}
     */
    window.createNewClusterCentroid = function() {
        let maxId = -1;
        if (state.clusterOrder) state.clusterOrder.forEach(c => { if (c > maxId) maxId = c; });
        if (state.allData) state.allData.forEach(d => { let c = parseInt(d.cluster, 10); if (!isNaN(c) && c > maxId) maxId = c; });

        const newId = maxId < 0 ? 0 : maxId + 1;

        if (!state.emptyClusters) state.emptyClusters = new Set();
        state.emptyClusters.add(newId);

        if (!state.clusterOrder) state.clusterOrder = [];
        if (!state.clusterOrder.includes(newId)) state.clusterOrder.push(newId);

        updateLegend();
    };
}

if (!window.deleteSubClusters) {
    /**
     * Deletes sub-clusters under a specified cluster ID and sub-path prefix, resetting affected nodes back to parent path level.
     *
     * @param {number|string} cId - Root cluster ID.
     * @param {string} subPath - Sub-cluster path prefix to clear/reset.
     * @returns {void}
     */
    window.deleteSubClusters = function(cId, subPath) {
        if (!state.allData) return;
        const prefix = subPath === "" ? "" : `${subPath}-`;

        state.allData.forEach(d => {
            if (parseInt(d.cluster, 10) === parseInt(cId, 10)) {
                const sp = String(d.sub_path !== undefined ? d.sub_path : (d.sub_cluster || ""));
                if (subPath === "" || sp.startsWith(prefix) || sp === subPath) {
                    d.sub_path = subPath === "" ? "" : subPath;
                    d.sub_cluster = d.sub_path;
                }
            }
        });

        const pathKey = subPath === "" ? String(cId) : `${cId}-${subPath}`;
        if (state.activeSplits) state.activeSplits.delete(pathKey);
        if (state.subClusterOrder) delete state.subClusterOrder[pathKey];

        updateLegend();

        import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
    };
}

state.activePreset = state.activePreset || "Default View";
state.legendPresets = JSON.parse(localStorage.getItem('legend_presets')) || {
    "Default View": {
        globalClusterLabelMode: 'none',
        useGradientColors: false,
        showAnchors: true,
        hiddenClusters: [],
        hiddenMetaClusters: [],
        hiddenPaths: [],
        activeSplits: [],
        collapsedLegendNodes: [],
        nodeSubPaths: []
    }
};


/**
 * Serializes the current legend parameters, visibility states, and node splits, saving them to local storage as a preset.
 *
 * @param {string|null} [customName=null] - Custom preset name to save under. Prompts user if null.
 * @returns {void}
 */
window.saveLegendPreset = function(customName = null) {
    const name = customName || prompt("Enter a name for this legend configuration:", `Preset ${Object.keys(state.legendPresets).length + 1}`);
    if (!name) return;

    // Serialize Sets and critical data attributes
    const snapshot = {
        globalClusterLabelMode: state.globalClusterLabelMode || 'none',
        useGradientColors: !!state.useGradientColors,
        showAnchors: !!state.showAnchors,
        hiddenClusters: Array.from(state.hiddenClusters || []),
        hiddenMetaClusters: Array.from(state.hiddenMetaClusters || []),
        hiddenPaths: Array.from(state.hiddenPaths || []),
        activeSplits: Array.from(state.activeSplits || []),
        collapsedLegendNodes: Array.from(state.collapsedLegendNodes || []),
        // Capture sub-clustering splits on individual data nodes
        nodeSubPaths: (state.allData || []).map(d => ({
            id: String(d.chunk_id || d.id),
            cluster: d.cluster,
            sub_path: d.sub_path
        }))
    };

    state.legendPresets[name] = snapshot;
    state.activePreset = name;
    localStorage.setItem('legend_presets', JSON.stringify(state.legendPresets));

    updateLegend();
    console.log(`[Preset Engine] Saved configuration: "${name}"`);
};


/**
 * Loads and restores a previously saved legend state configuration preset by name.
 *
 * @param {string} presetName - Key name of the preset configuration to load.
 * @returns {void}
 */
window.loadLegendPreset = function(presetName) {
    if (!state.legendPresets || !state.legendPresets[presetName]) return;

    state.activePreset = presetName;
    const preset = state.legendPresets[presetName];

    // Restore hidden states
    state.hiddenClusters = new Set(preset.hiddenClusters || []);
    state.hiddenPaths = new Set(preset.hiddenPaths || []);

    // Meta Regions Preset
    if (presetName === 'Sync Meta Regions' || preset.viewMode === 'metaregions') {
        const metaField = preset.metaKey || 'section';
        if (typeof window.mapToMetaIslands === 'function') {
            window.mapToMetaIslands(metaField);
        }
        return;
    }

    // Dataset Regions Preset ( must be a separate IF block, not nested inside Meta )
    if (presetName === 'Sync Dataset Regions' || preset.viewMode === 'datasetregions') {
        if (typeof window.mapToDatasetIslands === 'function') {
            window.mapToDatasetIslands();
        } else {
            console.error("window.mapToDatasetIslands is not defined on window!");
        }
        return;
    }

    // Fallback / Default View
    if (state.viewMode === 'metaregions' || state.viewMode === 'datasetregions') {
        if (typeof window.resetPlot === 'function') {
            window.resetPlot();
        }
    }

    state.viewMode = preset.viewMode || 'default';
    if (typeof draw === 'function') draw();

    updateLegend();
};


/**
 * Deletes a specified legend configuration preset from local storage and state.
 *
 * @param {string} name - Name of the preset configuration to delete.
 * @param {Event} [event] - Optional click/DOM event to stop propagation.
 * @returns {void}
 */
window.deleteLegendPreset = function(name, event) {
    if (event) event.stopPropagation();
    if (name === "Default View") {
        alert("Cannot delete the Default View.");
        return;
    }
    if (confirm(`Delete configuration "${name}"?`)) {
        delete state.legendPresets[name];
        if (state.activePreset === name) state.activePreset = "Default View";
        localStorage.setItem('legend_presets', JSON.stringify(state.legendPresets));
        window.loadLegendPreset(state.activePreset);
    }
};


/**
 * Renders and updates the floating global cluster legend DOM panel.
 * Reconstructs cluster tree nodes, attaches HTML controls, and sets up drag-and-drop merge/reorder listeners.
 *
 * @export
 * @returns {void}
 */
export function updateLegend() {
    const legendContainer = document.getElementById("floatingLegend");
    if (!legendContainer) return;
    if (!state.allData || state.allData.length === 0) return;

    const clusterSubPathsMap = new Map();
    state.allData.forEach(d => {
        const cid = parseInt(d.cluster, 10);
        if (!clusterSubPathsMap.has(cid)) clusterSubPathsMap.set(cid, []);
        const nodePath = d.sub_path !== undefined && d.sub_path !== null ? String(d.sub_path) :
                         (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");
        if (nodePath) clusterSubPathsMap.get(cid).push(nodePath);
    });

    if (!state.emptyClusters) state.emptyClusters = new Set();
    const dataClusters = [...new Set(state.allData.map(d => parseInt(d.cluster, 10)))];

    if (state.clusterCentroids) {
        Object.keys(state.clusterCentroids).forEach(centroidId => {
            const parsedId = parseInt(centroidId, 10);
            if (!isNaN(parsedId) && !dataClusters.includes(parsedId)) {
                state.emptyClusters.add(parsedId);
            }
        });
    }

    dataClusters.forEach(c => state.emptyClusters.delete(c));
    const uniqueClusters = [...dataClusters, ...state.emptyClusters];

    if (!state.hiddenClusters) state.hiddenClusters = new Set();
    if (!state.activeSplits) state.activeSplits = new Set();
    if (!state.hiddenPaths) state.hiddenPaths = new Set();
    if (!state.clusterLabels) state.clusterLabels = { keywords: {}, summaries: {} };
    if (!state.collapsedLegendNodes) state.collapsedLegendNodes = new Set();
    if (!state.legendPresets) state.legendPresets = {};
    if (!state.clusterOrder) state.clusterOrder = [];
    if (!state.subClusterOrder) state.subClusterOrder = {};

    uniqueClusters.forEach(c => {
        if (!state.clusterOrder.includes(c)) state.clusterOrder.push(c);
    });
    state.clusterOrder = state.clusterOrder.filter(c => uniqueClusters.includes(c));

    const realClusters = uniqueClusters.filter(c => c !== -1);
    state.regionCountCache = realClusters.length;
    const isSingleRegion = realClusters.length <= 1;

    const presetNames = Object.keys(state.legendPresets);
    const presetOptionsHTML = presetNames.map(name => `
        <option value="${name}" ${state.activePreset === name ? 'selected' : ''}>${name}</option>
    `).join('');

    // --- 1. HEADER BAR ---
    const headerHTML = `
        <div class="panel-header drag-handle" style="
            display: flex; align-items: center; justify-content: space-between; 
            padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; 
            cursor: grab; user-select: none;
        " title="Drag to move or dock in sidebar">
            <span style="font-size: 12px; font-weight: 700; color: #111827;">Global Cluster</span>
            
            <div style="display: flex; align-items: center; gap: 4px;">
                <button class="collapse-btn" onclick="window.togglePanelCollapse('floatingLegend')" title="Collapse Panel" style="
                    background: transparent; border: none; font-size: 14px; font-weight: bold; 
                    color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
                " onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#9ca3af'">
                    ${legendContainer.classList.contains('is-collapsed') ? '+' : '−'}
                </button>
                
                <button onclick="window.dockAndCollapse('floatingLegend')" title="Dock to Sidebar & Collapse" style="
                    background: transparent; border: none; font-size: 16px; font-weight: 300; 
                    color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
                " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
            </div>
        </div>
    `;

    // --- 2. START PANEL BODY ---
    let bodyControlsHTML = `
        <div class="panel-body" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; background: #f3f4f6; border-radius: 4px; padding: 2px; gap: 2px;">
                    <button class="legend-mode-btn ${state.globalClusterLabelMode === 'summary' ? 'active' : ''}" data-mode='summaries' style="flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; background: ${state.globalClusterLabelMode === 'summary' ? '#ffffff' : 'transparent'}; box-shadow: ${state.globalClusterLabelMode === 'summary' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">Summary</button>
                    <button class="legend-mode-btn ${state.globalClusterLabelMode === 'keywords' ? 'active' : ''}" data-mode="keywords" style="flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; background: ${state.globalClusterLabelMode === 'keywords' ? '#ffffff' : 'transparent'}; box-shadow: ${state.globalClusterLabelMode === 'keywords' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'};">Keywords</button>
                </div>
            </div>

            <div style="padding: 2px 0 6px 0; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <span style="font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Views</span>
                    <div style="display: flex; gap: 4px; align-items: center;">
                        <button onclick="window.saveLegendPreset()" title="Save Current Preset" style="
                            background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; 
                            border-radius: 4px; font-size: 10px; padding: 2px 7px; 
                            cursor: pointer; font-weight: 600; transition: all 0.15s ease;
                        " onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">+ Save</button>
                        ${state.activePreset && state.activePreset !== 'Default View' && state.activePreset !== 'Sync Meta Regions' && state.activePreset !== 'Sync Dataset Regions' ? `
                            <button onclick="window.deleteLegendPreset('${state.activePreset}', event)" title="Delete Preset" style="
                                background: transparent; color: #9ca3af; border: none; 
                                border-radius: 4px; font-size: 14px; padding: 0 4px; line-height: 1; 
                                cursor: pointer; font-weight: bold; transition: color 0.15s ease;
                            " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
                        ` : ''}
                    </div>
                </div>
                
                <div style="position: relative; width: 100%;">
                    <select onchange="window.loadLegendPreset(this.value)" style="
                        width: 100%; font-size: 11px; font-weight: 500; padding: 5px 24px 5px 8px; 
                        border: 1px solid #e5e7eb; border-radius: 6px; background-color: #f9fafb; 
                        color: #374151; cursor: pointer; outline: none; appearance: none; 
                        -webkit-appearance: none; transition: all 0.15s ease;
                    " onmouseover="this.style.borderColor='#d1d5db'; this.style.backgroundColor='#f3f4f6';" 
                      onmouseout="this.style.borderColor='#e5e7eb'; this.style.backgroundColor='#f9fafb';"
                      onfocus="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 0 0 2px rgba(59, 130, 246, 0.1)';">
                        ${presetOptionsHTML}
                    </select>
                    <div style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #6b7280; font-size: 9px;">▼</div>
                </div>

                ${state.activeSplits.size > 0 ? `
                    <div style="display: flex; justify-content: flex-end; margin-top: 3px;">
                        <button onclick="window.toggleAllLegendCollapses()" style="background: none; border: none; font-size: 10px; color: #2563eb; cursor: pointer; padding: 0; font-weight: 500; text-decoration: underline;">
                            ${state.collapsedLegendNodes.size >= state.activeSplits.size ? 'Expand All Subclusters' : 'Collapse All Subclusters'}
                        </button>
                    </div>
                ` : ''}
            </div>

            <!-- CLUSTERING BIAS INPUT -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label for="globalBiasInput" style="font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Clustering Bias</label>
                <input id="globalBiasInput" type="text" placeholder="Enter bias keywords..." value="${state.clusterBias || ''}" style="
                    width: 100%; box-sizing: border-box; font-size: 11px; font-weight: 500; padding: 5px 8px; 
                    border: 1px solid #e5e7eb; border-radius: 6px; background-color: #f9fafb; 
                    color: #374151; outline: none; transition: all 0.15s ease;
                " onchange="state.clusterBias = this.value;" onfocus="this.style.borderColor='#3b82f6'; this.style.backgroundColor='#ffffff';" onblur="this.style.borderColor='#e5e7eb'; this.style.backgroundColor='#f9fafb';" />
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0px; width: 100%; min-height: 24px;">
                <span style="font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Index</span>
                
                ${state.viewMode !== 'hierarchy' && state.viewMode !== 'chord' && state.viewMode !== 'hNetwork'? `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label title="Toggle Spatial Gradient Colors" style="
                        cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;
                        font-size: 10px; font-weight: 700; color: ${state.useGradientColors ? '#2563eb' : '#9ca3af'};
                        transition: color 0.2s;
                    ">
                        <input type="checkbox" id="legendGradient" ${state.useGradientColors ? 'checked' : ''} style="margin: 0; width: 11px; height: 11px; accent-color: #2563eb;" />
                        GRADIENT
                    </label>

                    <div style="display: flex; align-items: center; justify-content: center; width: 14px; height: 14px;">
                        <label title="Toggle Centroids View" style="
                            cursor: pointer; display: block; user-select: none; width: 7px; height: 7px; 
                            border-radius: 1px; border: 2px solid ${state.showAnchors ? '#2563eb' : '#9ca3af'}; 
                            background: ${state.showAnchors ? '#2563eb33' : '#ffffff'};
                            transform: rotate(45deg); transition: all 0.15s ease;
                        ">
                            <input type="checkbox" id="legendShowAnchors" ${state.showAnchors ? 'checked' : ''} style="display: none;" />
                        </label>
                    </div>
                </div>
                ` : ''}
            </div>
    `;

    // --- 3. NODE BUILDER FUNCTION ---
    /**
     * Helper to construct HTML markup string for a cluster or subcluster legend row recursively.
     *
     * @param {number|string} cId - Root cluster ID.
     * @param {string} subPath - Relative sub-path string for subclusters.
     * @param {string} nodeName - Display label for the legend entry.
     * @param {string} color - Hex/CSS color code for indicator badge.
     * @param {boolean} isRoot - True if this node represents a top-level cluster.
     * @param {string} [parentPathKey='root'] - Parent node identifier key.
     * @returns {string} Formatted HTML element string for the legend entry.
     */
    const buildLegendNode = (cId, subPath, nodeName, color, isRoot, parentPathKey = 'root') => {
        const safeSubPath = String(subPath);
        const pathKey = safeSubPath === "" ? String(cId) : `${cId}-${safeSubPath}`;

        const dragId = isRoot ? String(cId) : safeSubPath.split('-').pop();
        const isCollapsed = state.collapsedLegendNodes.has(pathKey);
        const isHidden = isRoot ? state.hiddenClusters.has(cId) : state.hiddenPaths.has(pathKey);
        const leftMargin = isRoot ? 0 : 20;
        const iconSize = isRoot ? 10 : 8;

        const prefix = safeSubPath === "" ? "" : `${safeSubPath}-`;
        const childTokens = new Set();

        const paths = clusterSubPathsMap.get(parseInt(cId, 10)) || [];
        paths.forEach(nodePath => {
            if (nodePath.startsWith(prefix)) {
                const remainder = nodePath.slice(prefix.length);
                if (remainder.length > 0) {
                    const match = remainder.match(/^-?\d+/);
                    if (match) childTokens.add(match[0]);
                }
            }
        });

        let isSplit = state.activeSplits.has(pathKey) || childTokens.size > 0;

        if (childTokens.size > 0) {
            state.activeSplits.add(pathKey);
            isSplit = true;
            if (!state.subClusterOrder[pathKey]) state.subClusterOrder[pathKey] = [];
            childTokens.forEach(t => {
                if (!state.subClusterOrder[pathKey].includes(t)) state.subClusterOrder[pathKey].push(t);
            });
            state.subClusterOrder[pathKey] = state.subClusterOrder[pathKey].filter(t => childTokens.has(t));
        } else {
            state.activeSplits.delete(pathKey);
            isSplit = false;
        }

        let controls = '';
        const isNoiseNode = cId === -1 || safeSubPath === "-1" || safeSubPath.endsWith("--1");

        // Fixed margin-top and padding to enforce clear vertical spacing
        if (!isNoiseNode && !isHidden && !isSplit) {
            controls = `
                <div style="margin-left: ${isRoot ? 24 : 20}px; margin-top: 8px; margin-bottom: 4px; display: flex; gap: 5px; align-items: center; font-size: 10px; height: 22px; box-sizing: border-box;">
                    <span style="color: #6b7280; font-weight: 500; font-size: 10px; line-height: 1;">K:</span>
                    <input type="number" id="subK-${pathKey}" value="3" min="2" max="15" style="width: 36px; height: 20px; box-sizing: border-box; padding: 0 2px; border: 1px solid #d1d5db; border-radius: 3px; text-align: center; background: #ffffff; font-size: 10px; line-height: 18px; outline: none;">
                    <select id="subMethod-${pathKey}" style="height: 20px; box-sizing: border-box; padding: 0 2px; border: 1px solid #d1d5db; border-radius: 3px; background: white; font-size: 10px; line-height: 18px; outline: none;">
                        <option value="kmeans">K-Means</option>
                        <option value="hdbscan">HDBSCAN</option>
                    </select>
                    <button onclick="event.stopPropagation(); window.triggerSubCluster(${cId}, '${safeSubPath}')" style="cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 3px; height: 20px; padding: 0 6px; font-size: 10px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;">Split</button>
                </div> 
            `;
        }

        let childrenHTML = "";
        if (isSplit && !isHidden && !isCollapsed) {
            const sortedTokens = state.subClusterOrder[pathKey];
            childrenHTML = sortedTokens.map(token => {
                const nextPath = prefix + token;
                const fullPathKey = `${cId}-${nextPath}`;

                let nextColor = "#9ca3af";
                if (typeof getSubClusterColor === "function") {
                    nextColor = getSubClusterColor(cId, nextPath);
                    if (!nextColor || nextColor.includes("undefined")) {
                         nextColor = getSubClusterColor(color, parseInt(token));
                    }
                }

                let nextName = (token === "-1" || token === -1) ? "Noise" : `Subcluster ${token}`;
                if (token !== "-1" && token !== -1 && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[fullPathKey]) {
                    nextName = state.clusterLabels[state.globalClusterLabelMode][fullPathKey];
                }

                return buildLegendNode(cId, nextPath, nextName, nextColor, false, pathKey);
            }).join("");
        }

        const toggleEvent = isRoot ? `window.toggleClusterFilter(${cId})` : `window.togglePath('${pathKey}')`;

        let collapseToggle = "";
        if (isSplit && !isHidden) {
            collapseToggle = `
                <span onclick="event.stopPropagation(); window.toggleLegendCollapse('${pathKey}');" 
                      title="${isCollapsed ? 'Expand subclusters' : 'Collapse subclusters in legend'}"
                      style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-right: 4px; color: #6b7280; font-size: 10px; user-select: none; transition: color 0.15s;"
                      onmouseover="this.style.color='#111827'" onmouseout="this.style.color='#6b7280'">
                    ${isCollapsed ? '▶' : '▼'}
                </span>
            `;
        }

        let deleteButton = "";
        if (isSplit && !isHidden) {
            deleteButton = `
                <button onclick="event.stopPropagation(); window.deleteSubClusters(${cId}, '${safeSubPath}'); applyGlobalFilters();" 
                        title="Delete all subclusters and allow reclustering" 
                        style="
                            margin-left: auto; background: transparent; border: 1px solid #fee2e2; 
                            color: #ef4444; font-size: 9px; font-weight: 600; border-radius: 3px; 
                            padding: 1px 5px; cursor: pointer; transition: all 0.15s ease;
                        "
                        onmouseover="this.style.background='#fef2f2'; this.style.borderColor='#fca5a5';" 
                        onmouseout="this.style.background='transparent'; this.style.borderColor='#fee2e2';">
                    Reset
                </button>
            `;
        }

        return `
            <div class="legend-drag-item" draggable="${!isNoiseNode}" 
                 data-type="${isRoot ? 'root' : 'sub'}" 
                 data-id="${dragId}" 
                 data-parent="${parentPathKey}" 
                 data-is-noise="${isNoiseNode}"
                 onmousedown="event.stopPropagation();" 
                 style="${!isRoot ? `margin-left: ${leftMargin}px; margin-top: 4px;` : ''} margin-bottom: ${isSplit && !isHidden ? '8px' : '6px'}; border-radius: 4px; transition: background-color 0.15s;">
                 
                <!-- Title row: clean padding and no negative margin so controls stay below -->
                <div style="display: flex; align-items: center; cursor: pointer; padding: 2px 4px; border-radius: 4px;" onclick="event.stopPropagation(); ${toggleEvent};">
                    
                    ${!isNoiseNode ? `
                    <div style="cursor: grab; margin-right: 4px; color: #d1d5db; display: flex; align-items: center;" title="Drag to reorder or merge" onmousedown="event.stopPropagation(); this.style.cursor='grabbing'" onmouseup="this.style.cursor='grab'" onclick="event.stopPropagation();">
                        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                            <circle cx="2" cy="2" r="1.2"></circle><circle cx="6" cy="2" r="1.2"></circle>
                            <circle cx="2" cy="6" r="1.2"></circle><circle cx="6" cy="6" r="1.2"></circle>
                            <circle cx="2" cy="10" r="1.2"></circle><circle cx="6" cy="10" r="1.2"></circle>
                        </svg>
                    </div>
                    ` : `<div style="width: 12px; margin-right: 4px;"></div>`}

                    ${collapseToggle}
                    <div style="width: ${iconSize}px; height: ${iconSize}px; background-color: ${color}; border-radius: 50%; margin-right: 8px; flex-shrink: 0; opacity: ${isHidden ? 0.25 : 1}; box-shadow: 0 0 0 1px rgba(0,0,0,0.05);"></div>
                    <span style="color: ${isHidden ? '#9ca3af' : (isRoot ? '#1f2937' : '#4b5563')}; text-decoration: ${isHidden ? 'line-through' : 'none'}; font-size: ${isRoot ? 11 : 10}px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: ${isRoot ? 120 : 90}px;" title="${nodeName}">
                        ${nodeName}
                    </span>
                    ${isSplit && !isHidden && isCollapsed ? `<span style="font-size: 10px; color: #9ca3af; margin-left: 6px; font-weight: 500;">(${childTokens.size})</span>` : ''}
                    
                    ${deleteButton}
                </div>
                ${isSplit ? childrenHTML : controls}
            </div>
        `;
    };

    // --- 4. BUILD CLUSTER LIST HTML INSIDE PANEL BODY ---
    let treeNodesHTML = state.clusterOrder.map(cId => {
        let color = "#d1d5db";
        if (typeof getClusterColor === "function") color = getClusterColor(cId);

        const node = state.allData.find(d => parseInt(d.cluster, 10) === parseInt(cId, 10));

        let baseName = `Region ${parseInt(cId, 10) + 1}`;
        if (isSingleRegion && realClusters.includes(cId)) baseName = "All Documents";

        let cName = node?.cluster_name;
        if (cName === "All Documents" || cName === "Cluster 0") cName = null;

        const name = cId === -1 ? "Noise" : (cName || baseName);

        let finalName = name;

        if (name !== "All Documents" && state.globalClusterLabelMode && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[String(cId)]) {
            finalName = state.clusterLabels[state.globalClusterLabelMode][String(cId)];
        }

        return buildLegendNode(cId, "", finalName, color, true, 'root');
    }).join("");

    if (state.viewMode !== 'hierarchy' && state.viewMode !== 'chord' && state.viewMode !== 'hNetwork') {
        treeNodesHTML += `
            <div style="display: flex; align-items: center; margin-top: 8px; margin-bottom: 8px; padding-top: 6px; border-top: 1px solid #e5e7eb; cursor: pointer;" 
                 onclick="event.stopPropagation(); window.createNewClusterCentroid(); console.log(1);">
                <div style="width: 10px; height: 10px; display: flex; align-items: center; justify-content: center; color: #2563eb; font-weight: 800; margin-right: 8px; font-size: 11px;">+</div>
                <span style="font-size: 11px; color: #2563eb; font-weight: 600;">Add Region</span>
            </div>
        `;
    }

    // --- 5. RENDER DOM & CLOSE PANEL-BODY ---
    legendContainer.innerHTML = headerHTML + bodyControlsHTML + treeNodesHTML + `</div>`;

    makeDraggableAndDockable('floatingLegend');

    // --- 6. NATIVE DRAG, REORDER, AND MERGE LOGIC ---
    let dragSourceEl = null;
    const items = legendContainer.querySelectorAll('.legend-drag-item');

    items.forEach(item => {
        item.addEventListener('dragstart', function(e) {
            if (this.dataset.isNoise === "true") {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
            dragSourceEl = this;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => this.style.opacity = '0.3', 0);
        });

        item.addEventListener('dragover', function(e) {
            if (this.dataset.isNoise === "true") return;

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
                this.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                this.style.outline = '1px dashed #2563eb';
                this.dataset.dropAction = 'merge';
            }
        });

        item.addEventListener('dragleave', function(e) {
            e.stopPropagation();
            this.style.borderTop = 'none';
            this.style.borderBottom = 'none';
            this.style.backgroundColor = '';
            this.style.outline = 'none';
        });

        item.addEventListener('dragend', function(e) {
            e.stopPropagation();
            this.style.opacity = '1';
            dragSourceEl = null;
            items.forEach(i => {
                i.style.borderTop = 'none';
                i.style.borderBottom = 'none';
                i.style.backgroundColor = '';
                i.style.outline = 'none';
            });
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        });

        item.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            this.style.borderTop = 'none';
            this.style.borderBottom = 'none';
            this.style.backgroundColor = '';
            this.style.outline = 'none';

            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

            if (dragSourceEl === this || !dragSourceEl) return;
            if (this.dataset.isNoise === "true" || dragSourceEl.dataset.isNoise === "true") return;
            if (this.dataset.type !== dragSourceEl.dataset.type || this.dataset.parent !== dragSourceEl.dataset.parent) return;

            const dropAction = this.dataset.dropAction;
            const sourceId = dragSourceEl.dataset.id;
            const targetId = this.dataset.id;
            const parentKey = this.dataset.parent;
            const isRoot = this.dataset.type === 'root';

            if (dropAction === 'merge') {
                window.mergeClusters(sourceId, targetId, isRoot, parentKey);
            } else {
                const insertAfter = (dropAction === 'after');
                let arr = isRoot ? state.clusterOrder : state.subClusterOrder[parentKey];

                const fromIndex = arr.findIndex(v => String(v) === String(sourceId));
                const toIndex = arr.findIndex(v => String(v) === String(targetId));

                if (fromIndex > -1 && toIndex > -1) {
                    const [movedItem] = arr.splice(fromIndex, 1);
                    const adjustedToIndex = arr.findIndex(v => String(v) === String(targetId));
                    arr.splice(insertAfter ? adjustedToIndex + 1 : adjustedToIndex, 0, movedItem);
                    setTimeout(() => updateLegend(), 10);
                }
            }
        });
    });

    // --- 7. ATTACH SETTINGS EVENT LISTENERS ---
    const showCentroidsChk = document.getElementById("legendShowAnchors");
    if (showCentroidsChk) {
        showCentroidsChk.addEventListener("change", (e) => {
            state.showAnchors = e.target.checked;
            const alternateChk = document.getElementById("showAnchors");
            if (alternateChk) alternateChk.checked = e.target.checked;
            updateLegend();
            import('../canvas/render.js').then(r => { if (typeof r.draw === 'function' && state.viewMode !== 'hierarchy') r.draw(); });
        });
    }

    const gradientChk = document.getElementById("legendGradient");
    if (gradientChk) {
        gradientChk.addEventListener("change", (e) => {
            state.useGradientColors = e.target.checked;
            if (state.useGradientColors) {
                if (typeof applyGradientColors === 'function') applyGradientColors();
            }
            updateLegend();
            import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
        });
    }

    legendContainer.querySelectorAll(".legend-mode-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const selectedMode = btn.getAttribute("data-mode");
            if (state.globalClusterLabelMode === selectedMode) {
                state.globalClusterLabelMode = 'none';
                updateLegend();
            } else {
                state.globalClusterLabelMode = selectedMode;
                if (state.clusterLabels && state.clusterLabels[selectedMode] && Object.keys(state.clusterLabels[selectedMode]).length > 0) {
                    updateLegend();
                } else {
                    import('../clusters/api.js').then(api => { if (typeof api.fetchLabels === 'function') api.fetchLabels(selectedMode); });
                }
            }
        });
    });

    if (typeof updatePanel === "function") {
        const activeNode = state.selectedNode || state.activeNode || null;
        updatePanel(activeNode);
    }

    if (state.viewMode === 'hierarchy') {
        import('../canvas/hierarchy.js').then(hierarchy => {
            if (typeof hierarchy.initHierarchy === 'function') {
                hierarchy.initHierarchy();
                if (typeof hierarchy.drawHierarchy === 'function') hierarchy.drawHierarchy();
            }
        }).catch(err => console.warn("Hierarchy module not ready:", err));
    }

    const biasInput = document.getElementById("globalBiasInput");
    if (biasInput) {
        biasInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                state.clusterBias = e.target.value;
                if (typeof window.reclusterWithBias === "function") {
                    window.reclusterWithBias(state.clusterBias);
                }
            }
        });
    }
}
