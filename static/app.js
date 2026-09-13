// app.js
import { state } from './core/state.js';
import { draw, invertMapX, invertMapY } from './canvas/render.js';
import { fetchClusterData, search, clearLassoSelection } from './clusters/api.js';
import { handleCanvasClick, handleCanvasHover, handleWheel, handleMouseDown, handleMouseUp, resetZoom, handleCanvasDoubleClick } from './canvas/events.js';
import {
    initUI, armPinMode, clearPins, downloadPlot,
    selectClusterLabelOption, selectSearchLabelOption, toggleAnchors,
    toggleHeatmap, updateBottomPanelTrajectory, initPlotOptions,
    initResizablePanel, toggleIslands, toggleSpiral
} from './components/ui.js';
import { buildTagDropdownUI } from './components/tag_legend.js';
import { applyGlobalFilters, exportNodesToCSV, exportTrayCombinedData } from './core/data.js';
import { updateLegend } from "./components/global_legend.js";
import './core/datasets.js';
import './components/dock.js';
import './components/dock_components.js';

/**
 * Resizes the main WebGL/2D canvas to match its parent container.
 */
function resizeCanvas() {
    const container = document.getElementById("plot");
    if (container && state.canvas) {
        state.canvas.width = container.clientWidth;
        state.canvas.height = container.clientHeight;
    }
}

let draggedCentroidId = null;

// ============================================================================
// GLOBAL FUNCTION EXPORTS (Contracts)
// ============================================================================

window.applyGlobalFilters = applyGlobalFilters;
window.armPinMode = armPinMode;
window.clearPins = clearPins;
window.downloadPlot = downloadPlot;
window.selectClusterLabelOption = selectClusterLabelOption;
window.selectSearchLabelOption = selectSearchLabelOption;
window.toggleAnchors = toggleAnchors;
window.search = search;
window.resetZoom = resetZoom;
window.toggleHeatmap = toggleHeatmap;
window.clearLassoSelection = clearLassoSelection;

/**
 * Removes a specific dropped pin from the state and updates the UI.
 * @param {string|number} pinId - The unique identifier of the pin to remove.
 */
window.removeSelectedPin = function(pinId) {
    state.droppedPins = state.droppedPins.filter(pin => {
        const id = pin.chunk_id || pin.id;
        return String(id) !== String(pinId);
    });

    const popup = document.getElementById('pinPopup');
    if (popup) popup.style.display = 'none';

    updateBottomPanelTrajectory(state.droppedPins, "pins");
    draw();
};

/**
 * Toggles the visibility of the metadata panel.
 * @param {boolean} [show] - Optional explicitly defined state (true for show, false for hide).
 */
window.toggleMetaPanel = function(show) {
    const panel = document.getElementById("metaPanel");
    if (!panel) return;

    const isCurrentlyCollapsed = panel.classList.contains("panel-collapsed");
    const shouldCollapse = (typeof show === "boolean") ? !show : !isCurrentlyCollapsed;

    panel.classList.toggle("panel-collapsed", shouldCollapse);

    setTimeout(() => {
        if (typeof draw === "function") draw();
        else if (typeof window.draw === "function") window.draw();
    }, 260);
};

/**
 * Exports currently filtered nodes to a CSV file.
 */
window.exportCurrentPlotToCSV = function() {
    exportNodesToCSV(state.filteredData, "Research_Explorer_Export.csv");
};

/**
 * Toggles the visibility of a specific cluster.
 * @param {number|string} clusterId - The ID of the cluster to toggle.
 */
window.toggleClusterFilter = function(clusterId) {
    if (!state.hiddenClusters) state.hiddenClusters = new Set();

    if (state.hiddenClusters.has(clusterId)) {
        state.hiddenClusters.delete(clusterId);
    } else {
        state.hiddenClusters.add(clusterId);
    }

    updateLegend();
    applyGlobalFilters();
};

/**
 * Toggles the visibility of a specific hierarchical path.
 * @param {string} pathKey - The path branch to hide/show.
 */
window.togglePath = function(pathKey) {
    if (!state.hiddenPaths) state.hiddenPaths = new Set();

    if (state.hiddenPaths.has(pathKey)) {
        state.hiddenPaths.delete(pathKey);
    } else {
        state.hiddenPaths.add(pathKey);
    }

    if (typeof updateLegend === 'function') updateLegend();
    applyGlobalFilters();
};

/**
 * Generates a new cluster centroid at the center of the viewport.
 */
window.createNewClusterCentroid = function() {
    if (!state.clusterCentroids) state.clusterCentroids = {};

    const existingIds = Object.keys(state.clusterCentroids).map(Number);
    const nextClusterId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

    const canvasCenterPixelX = state.canvas.width / 2;
    const canvasCenterPixelY = state.canvas.height / 2;

    state.clusterCentroids[nextClusterId] = {
        x: invertMapX(canvasCenterPixelX),
        y: invertMapY(canvasCenterPixelY),
        name: `Cluster ${nextClusterId}`
    };

    recalculateClusterAssignments();
};

/**
 * Mathematically reassigns nodes to the nearest dropped anchor/centroid.
 * @param {string} [scope='root'] - The hierarchy level to calculate ('root' or 'sub').
 * @param {string|null} [targetId=null] - The specific cluster ID to target, if applicable.
 */
window.recalculateClusterAssignments = async function(scope = 'root', targetId = null) {
    if (!state.clusterCentroids || Object.keys(state.clusterCentroids).length === 0) return;

    // 1. Reassign nodes to the nearest dropped anchor
    state.allData.forEach(paper => {
        if (scope === 'root') {
            let minDist = Infinity;
            let bestCluster = paper.cluster;

            Object.keys(state.clusterCentroids).forEach(cId => {
                const c = state.clusterCentroids[cId];
                const dist = Math.pow(paper.x - c.x, 2) + Math.pow(paper.y - c.y, 2);
                if (dist < minDist) {
                    minDist = dist;
                    bestCluster = parseInt(cId);
                }
            });
            paper.cluster = bestCluster;

        } else if (scope === 'sub' && state.subClusterCentroids) {
            let minDist = Infinity;
            let bestSubPath = paper.sub_path;

            Object.keys(state.subClusterCentroids).forEach(subKey => {
                const separatorIdx = subKey.indexOf('-');
                const rootId = parseInt(subKey.substring(0, separatorIdx));
                const subPath = subKey.substring(separatorIdx + 1);

                if (rootId === paper.cluster) {
                    const sc = state.subClusterCentroids[subKey];
                    const dist = Math.pow(paper.x - sc.x, 2) + Math.pow(paper.y - sc.y, 2);
                    if (dist < minDist) {
                        minDist = dist;
                        bestSubPath = subPath;
                    }
                }
            });
            if (bestSubPath !== undefined) paper.sub_path = bestSubPath;
        }
    });

    if (typeof applyGlobalFilters === 'function') applyGlobalFilters();
    if (typeof updateLegend === 'function') updateLegend();

    // 2. Trigger LLM/TF-IDF updates if a label mode is active
    if (state.globalClusterLabelMode === 'keywords' || state.globalClusterLabelMode === 'summary') {
        const endpoint = state.globalClusterLabelMode === 'keywords' ? '/api/keywords' : '/api/summarize';

        let targetRootId;
        if (scope === 'sub' && targetId) {
            targetRootId = targetId.substring(0, targetId.indexOf('-'));
        }

        const rootIdsToUpdate = scope === 'root'
            ? Object.keys(state.clusterCentroids)
            : [targetRootId];

        for (const cId of rootIdsToUpdate) {
            if (!cId) continue;

            const idsInCluster = state.allData
                .filter(d => d.cluster === parseInt(cId))
                .map(d => d.chunk_id || d.id);

            if (idsInCluster.length > 0) {
                try {
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids: idsInCluster })
                    });
                    const data = await res.json();
                    const newName = data.keywords || data.topic || `Cluster ${cId}`;

                    state.clusterCentroids[cId].name = newName;
                    state.allData.forEach(d => {
                        if (d.cluster === parseInt(cId)) d.cluster_name = newName;
                    });
                } catch (error) {
                    console.error(`Label fetch failed for Cluster ${cId}:`, error);
                }
            }
        }

        if (typeof updateLegend === 'function') updateLegend();
        if (typeof draw === 'function') draw();
    }
};

window.performUndo = function() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        state.clusterCentroids = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
        window.recalculateClusterAssignments();
    }
};

window.performRedo = function() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        state.clusterCentroids = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
        window.recalculateClusterAssignments();
    }
};

window.toggleClusterKey = function() {
    const legend = document.getElementById("floatingLegend");
    if (!legend) return;
    legend.style.display = legend.style.display === "none" ? "block" : "none";
};

window.toggleMetaClusterFilter = function(metaClusterName) {
    if (!state.hiddenMetaClusters) state.hiddenMetaClusters = new Set();

    if (state.hiddenMetaClusters.has(metaClusterName)) {
        state.hiddenMetaClusters.delete(metaClusterName);
    } else {
        state.hiddenMetaClusters.add(metaClusterName);
    }

    import('./components/ui.js').then(ui => ui.updateLegend());
    import('./core/data.js').then(data => data.applyGlobalFilters());
};

window.toggleIslandMode = function() {
    toggleIslands();
    const btn = document.getElementById("islandToggleBtn");
    if (btn) {
        btn.classList.toggle("active-mode", state.islandsEnabled);
    }
};

window.toggleSpiralMode = function() {
    toggleSpiral();
    const btn = document.getElementById("spiralToggleBtn");
    if (btn) {
        btn.classList.toggle("active-mode", state.spiralEnabled);
    }
};

window.toggleTagBorderMode = function(tagName) {
    if (state.activeBorderTag === tagName) {
        state.activeBorderTag = null;
    } else {
        state.activeBorderTag = tagName;
    }

    document.querySelectorAll('.tag-list-item').forEach(el => {
        el.classList.toggle('active-border-tag', el.dataset.tag === state.activeBorderTag);
    });

    import('./canvas/render.js').then(r => {
        if (typeof r.draw === 'function') r.draw();
    });
};

/**
 * Automates the extraction and labeling of multiple clusters.
 * @param {string} mode - The labeling mode.
 * @param {Array} targets - Array of target cluster definitions.
 */
window.autoLabelAllClusters = async function(mode, targets) {
    console.log(`Starting ${mode} extraction for ${targets.length} clusters...`, targets);

    for (const target of targets) {
        const matchingNodes = state.allData.filter(d => {
            const nodeTag = d.tag || 'chunk';
            if (nodeTag !== target.tag) return false;
            if (!target.subPath) return true;
            return d.tag_sub_path && (d.tag_sub_path === target.subPath || d.tag_sub_path.startsWith(target.subPath + '.'));
        });

        const sampleTexts = matchingNodes.map(n => n.text || n.content).slice(0, 15);
        // LLM Execution logic would proceed here based on sampleTexts
    }

    buildTagDropdownUI();
};

window.toggleHierarchyView = function() {
    state.viewMode = state.viewMode === 'hierarchy' ? 'scatter' : 'hierarchy';

    import('./canvas/render.js').then(render => {
        if (typeof render.draw === 'function') {
            render.draw();
        }
    });

    if (state.viewMode === 'hierarchy') {
        import('./hierarchy_2.js').then(hierarchy => {
            if (typeof hierarchy.drawHierarchy === 'function') {
                hierarchy.drawHierarchy();
            }
        });
    }
};


// ============================================================================
// DOM EVENT LISTENERS & INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    state.canvas = document.getElementById("canvas");

    if (state.canvas) {
        state.ctx = state.canvas.getContext("2d");
        const canvas = state.canvas;

        resizeCanvas();

        window.addEventListener('resize', () => {
            resizeCanvas();
            draw();
        });

        // Core canvas Event Mapping
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('mousemove', handleCanvasHover);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('dblclick', handleCanvasDoubleClick);

        // Anchor Dragging Logic
        let draggedAnchor = null;

        canvas.addEventListener('mousedown', (e) => {
            if (!state.showAnchors) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let allAnchors = [];

            if (state.clusterCentroids) {
                Object.keys(state.clusterCentroids).forEach(cId => {
                    allAnchors.push({ type: 'root', id: cId, ref: state.clusterCentroids[cId] });
                });
            }

            if (state.subClusterCentroids) {
                Object.keys(state.subClusterCentroids).forEach(subKey => {
                    allAnchors.push({ type: 'sub', id: subKey, ref: state.subClusterCentroids[subKey] });
                });
            }

            for (const anchor of allAnchors) {
                if (anchor.ref.pixelX && anchor.ref.pixelY) {
                    const distance = Math.sqrt((mouseX - anchor.ref.pixelX) ** 2 + (mouseY - anchor.ref.pixelY) ** 2);
                    if (distance <= 12) {
                        draggedAnchor = anchor;
                        canvas.style.cursor = 'grabbing';

                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        break;
                    }
                }
            }
        }, { capture: true });

        canvas.addEventListener('mousemove', (e) => {
            if (draggedAnchor !== null) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                draggedAnchor.ref.x = invertMapX(mouseX);
                draggedAnchor.ref.y = invertMapY(mouseY);

                draw();
            }
        }, { capture: true });

        window.addEventListener('mouseup', (e) => {
            if (draggedAnchor !== null) {
                const anchorType = draggedAnchor.type;
                const anchorId = draggedAnchor.id;

                draggedAnchor = null;
                canvas.style.cursor = 'default';

                recalculateClusterAssignments(anchorType, anchorId);
            }
        }, { capture: true });

        // Centroid Drag Logic
        canvas.addEventListener('mousemove', (e) => {
            if (draggedCentroidId !== null) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                state.clusterCentroids[draggedCentroidId].x = invertMapX(mouseX);
                state.clusterCentroids[draggedCentroidId].y = invertMapY(mouseY);

                draw();
            }
        }, { capture: true });

        window.addEventListener('mouseup', (e) => {
            if (draggedCentroidId !== null) {
                draggedCentroidId = null;
                canvas.style.cursor = 'default';
                recalculateClusterAssignments();
            }
        }, { capture: true });

        // Floating Legend Drag Logic
        const legendEl = document.getElementById("floatingLegend");

        if (legendEl) {
            let isDraggingLegend = false;
            let offsetX, offsetY;

            legendEl.addEventListener("wheel", (e) => e.stopPropagation());

            legendEl.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                isDraggingLegend = true;
                const rect = legendEl.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
            });

            window.addEventListener("mousemove", (e) => {
                if (!isDraggingLegend) return;

                let newX = e.clientX - offsetX;
                let newY = e.clientY - offsetY;

                newX = Math.max(0, Math.min(newX, window.innerWidth - legendEl.offsetWidth));
                newY = Math.max(0, Math.min(newY, window.innerHeight - legendEl.offsetHeight));

                legendEl.style.left = `${newX}px`;
                legendEl.style.top = `${newY}px`;
                legendEl.style.right = "auto";
                legendEl.style.bottom = "auto";
            });

            window.addEventListener("mouseup", () => {
                isDraggingLegend = false;
            });
        }

        // Tray Tabs Logic
        const tabTrajectory = document.getElementById("tab-trajectory");
        const tabPins = document.getElementById("tab-pins");

        if (tabTrajectory && tabPins) {
            tabTrajectory.addEventListener("click", () => {
                if (state.lastSearchTrajectory && state.lastSearchTrajectory.length > 0) {
                    updateBottomPanelTrajectory(state.lastSearchTrajectory, "trajectory");
                } else {
                    updateBottomPanelTrajectory([], "trajectory");
                }
            });

            tabPins.addEventListener("click", () => {
                updateBottomPanelTrajectory(state.droppedPins || [], "pins");
            });
        }

        // Real-Time Live Filtering Listeners
        const localSearchInput = document.getElementById('search');
        if (localSearchInput) {
            localSearchInput.addEventListener('input', () => {
                applyGlobalFilters();
            });
        }

        const yearStart = document.getElementById('yearStart');
        const yearEnd = document.getElementById('yearEnd');
        if (yearStart) {
            yearStart.addEventListener('input', () => applyGlobalFilters());
        }
        if (yearEnd) {
            yearEnd.addEventListener('input', () => applyGlobalFilters());
        }

        // FAISS Search Listeners (Debounced)
        let debounceTimeout;
        const triggerDebouncedSearch = () => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                const queryVal = document.getElementById('query')?.value.trim();
                if (queryVal !== '') {
                    search();
                } else {
                    import('./clusters/api.js').then(api => api.clearSearchTrajectory());
                }
            }, 500);
        };

        const faissQueryInput = document.getElementById('query');
        const faissGoalInput = document.getElementById('goal');

        if (faissQueryInput) faissQueryInput.addEventListener('input', triggerDebouncedSearch);
        if (faissGoalInput) faissGoalInput.addEventListener('input', triggerDebouncedSearch);

        // Export Actions
        const exportTrayBtn = document.getElementById("exportTrayBtn");
        if (exportTrayBtn) {
            exportTrayBtn.addEventListener("click", () => {
                exportTrayCombinedData();
            });
        }

        // Isolate Data Bindings
        const isolateBtn = document.getElementById('isolate-btn');
        if (isolateBtn) {
            isolateBtn.addEventListener('click', function() {
                if (!state.lassoFilterActive && (!state.selectedNodes || state.selectedNodes.length === 0)) {
                    console.warn("No nodes selected to isolate.");
                    return;
                }
                state.lassoFilterActive = !state.lassoFilterActive;
                this.innerText = state.lassoFilterActive ? "Clear Isolation" : "Isolate Selected";
                applyGlobalFilters();
            });
        }

        // Initial setup execution
        initUI();
        initResizablePanel();
        fetchClusterData();

    } else {
        console.error("CRITICAL ERROR: Could not find HTML element with id='canvas'. JavaScript initialization aborted.");
    }
});

// Escape Key Binding for Global UI Clearing
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.clearLassoSelection();
    }
});

// Bootstrap Plot Options
initPlotOptions();