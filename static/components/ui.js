import { state } from '../core/state.js';
import { fetchClusterData, autoLabelAllClusters, buildKeywordNetwork } from '../clusters/api.js';
import { draw, mapX, mapY, invertMapX, invertMapY, getLodBaseNodes } from '../canvas/render.js';
import {undoStack} from '../core/history.js'
import {updateLegend} from './global_legend.js';
import {getMetaClusterColor, getClusterColor, getSubClusterColor, getTagSubClusterColor, getNodeColor, getTagRegionColor} from '../clusters/color.js'
import{buildTagDropdownUI} from './tag_legend.js';
import {createAdvancedSearchWidget, createLodWidget} from "./dock_components.js";
import { drawHierarchy, updateKeywordNetwork } from '../canvas/hierarchy.js';
import {updatePanel} from "./meta_panel.js";


// Global Window Bindings
if (typeof window !== "undefined") {
    window.toggleSubClusterFilter = toggleSubClusterFilter;
    window.reassignPointsToCentroids = reassignPointsToCentroids;
    window.toggleSpiralMode = toggleSpiral;
    window.refreshPanelAfterUndoRedo = refreshPanelAfterUndoRedo;
    window.handleUnifiedSearchKeydown = handleUnifiedSearchKeydown;
    window.addSearchBadgeFromInput = addSearchBadgeFromInput;
    window.removeSearchBadge = removeSearchBadge;
    window.toggleSearchBadge = toggleSearchBadge; // <-- ADD THIS LINE
    window.triggerScatterMode = triggerScatterMode;
    window.triggerScatterMode = triggerScatterMode;
    window.createNewClusterCentroid = createNewClusterCentroid;
    window.switchViewMode = switchViewMode;
    window.triggerNetworkGraphMode = triggerNetworkGraphMode;
}


const SCIENCE_KEYWORDS = new Set([
    'ion', 'ions', 'plasma', 'plasmas', 'solar', 'wind', 'earth', 'space',
    'electron', 'electrons', 'proton', 'protons', 'wave', 'waves', 'magnetic',
    'field', 'fields', 'radar', 'orbit', 'satellite', 'aurora', 'auroral',
    'radio', 'model', 'data', 'index', 'drift', 'storm', 'substorm'
]);
const KNOWN_INSTRUMENT_TERMS = new Set([
    'tec', 'isr', 'fpi', 'gps', 'pfisr', 'risr', 'superdarn',
    'lidar', 'radar', 'magnetometer', 'spectrometer', 'photometer',
    'imager', 'ionosonde', 'gnss', 'digisonde', 'fabry-perot'
]);


/**
 * Toggles the visibility state of a given cluster or subcluster path key.
 *
 * @param {string|number} pathKey - The unique path identifier (e.g., "0-0" or root ID) to hide or show.
 * @returns {void}
 */
window.togglePath = function (pathKey) {
    if (!state.hiddenPaths) state.hiddenPaths = new Set();

    //string conversion so "0-0" is never treated as a falsy number or misread
    const safeKey = String(pathKey);

    if (state.hiddenPaths.has(safeKey)) {
        state.hiddenPaths.delete(safeKey);
    } else {
        state.hiddenPaths.add(safeKey);
    }


    import('./ui.js').then(ui => {
        if (typeof ui.updateLegend === 'function') ui.updateLegend();
    });

    // Force Data redraw to apply the filter and remove dots
    import('../core/data.js').then(d => {
        if (typeof d.applyGlobalFilters === 'function') d.applyGlobalFilters();
    });
};


/**
 * Handles selection of cluster label naming options, toggling active button state
 * and updating global cluster label settings or fetching new labels from API.
 *
 * @param {HTMLElement} btn - The toggle button element that triggered the action.
 * @param {string} option - The chosen labeling scheme/option (e.g., 'none', 'llm', 'tfidf').
 * @returns {void}
 */
export function selectClusterLabelOption(btn, option) {
    const parent = btn.parentElement;
    const isActive = btn.classList.contains('active');
    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));

    if (isActive) {state.globalClusterLabelMode = 'none';
        updateLegend(); // Instantly revert to numbers!
    } else {
        btn.classList.add('active');
        state.globalClusterLabelMode = option;


        if (state.clusterLabels && state.clusterLabels[option] && Object.keys(state.clusterLabels[option]).length > 0) {
            updateLegend();
        } else import('../clusters/api.js').then(api => api.fetchLabels(option));

    }
}


/**
 * Updates the search trajectory label mode state based on UI toggle selection.
 *
 * @param {HTMLElement} btn - The toggle button element clicked.
 * @param {string} option - The selected search label mode.
 * @returns {void}
 */
export function selectSearchLabelOption(btn, option) {
    const parent = btn.parentElement;
    const isActive = btn.classList.contains('active');
    parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));

    if (isActive) state.trajectorySearchLabelMode = 'none';
     else {
        btn.classList.add('active');
        state.trajectorySearchLabelMode = option;
    }
}


/**
 * Initializes UI event listeners, sidebar trays, sliders, search widgets, and controls.
 *
 * @returns {void}
 */
export function initUI() {
    const searchInput = document.getElementById("search");
    const kElement = document.getElementById("kClusters");
    const clusterMethod = document.getElementById("clusterMethod");
    const anchorCheckbox = document.getElementById("showAnchors");

    // Wire up the pre-defined layout elements for menu visibility toggling
    const bottomPanel = document.getElementById("bottom-panel");
    const toggleBtn = document.getElementById("toggleTrayBtn");
    createAdvancedSearchWidget();
    updateNetworkUI();
    if (toggleBtn && bottomPanel) {
        // Start cleanly collapsed without causing structural layout shifts
        bottomPanel.classList.add("tray-collapsed");
        bottomPanel.style.setProperty('display', 'none', 'important');
        toggleBtn.textContent = "Show Menu";

        toggleBtn.addEventListener("click", () => {
            const isCollapsed = bottomPanel.classList.toggle("tray-collapsed");

            if (isCollapsed) {
                bottomPanel.style.setProperty('display', 'none', 'important');
                toggleBtn.textContent = "Show Menu";
            } else {
                bottomPanel.style.setProperty('display', 'flex', 'important');
                toggleBtn.textContent = "Hide Menu";
            }
        });
    }


    const tabTraj = document.getElementById("tab-trajectory");
    const tabPins = document.getElementById("tab-pins");

    if (tabTraj && bottomPanel) {
        tabTraj.addEventListener("click", (e) => {
            const isOpened = !bottomPanel.classList.contains("tray-collapsed");
            const isActive = tabTraj.classList.contains("active-traj");

            if (isOpened && isActive) {
                bottomPanel.classList.add("tray-collapsed");
                bottomPanel.style.setProperty('display', 'none', 'important');
                if (toggleBtn) toggleBtn.textContent = "Show Menu";

                e.stopImmediatePropagation();
            }
        }, true);
    }

    if (tabPins && bottomPanel) {
        tabPins.addEventListener("click", (e) => {
            const isOpened = !bottomPanel.classList.contains("tray-collapsed");
            const isActive = tabPins.classList.contains("active-pins");

            if (isOpened && isActive) {
                bottomPanel.classList.add("tray-collapsed");
                bottomPanel.style.setProperty('display', 'none', 'important');
                if (toggleBtn) toggleBtn.textContent = "Show Menu";


                e.stopImmediatePropagation();
            }
        }, true);
    }


    if (searchInput) {
        searchInput.addEventListener("input", () => {draw(); });
    }
    createLodWidget();
    if (kElement) kElement.onchange = debounce(fetchClusterData, 200);

    if (clusterMethod) {
        clusterMethod.onchange = () => {
            if (typeof updateUI === "function") updateUI();
            fetchClusterData();
        };
        if (typeof updateUI === "function") updateUI();
    }

    if (anchorCheckbox) {
        anchorCheckbox.addEventListener("change", (e) => {
            state.showAnchors = e.target.checked;
            draw();
        });
    }


    if (typeof initYearSlider === "function") initYearSlider();

}


/**
 * Adjusts UI input controls (labels, default values, visibility) according to the selected clustering method.
 *
 * @returns {void}
 */
export function updateUI() {
    const method = document.getElementById("clusterMethod").value;
    const label = document.getElementById("kLabel");
    const input = document.getElementById("kClusters");

    if (!label || !input) return;

    if (method === "none") {
        label.style.display = "none";
        input.style.display = "none";
    } else {
        label.style.display = "block";
        input.style.display = "block";

        if (method === "hdbscan") {
            label.innerText = "Min Cluster Size";
            input.value = input.value === "8" ? "15" : input.value;
        } else {
            label.innerText = "Number of Clusters (K)";
            input.value = input.value === "15" ? "8" : input.value;
        }
    }
}


/**
 * Creates a debounced version of a target function to limit execution rate.
 *
 * @param {Function} fn - The target function to debounce.
 * @param {number} [delay=100] - Time delay in milliseconds before invoking the function.
 * @returns {Function} A debounced wrapper function.
 */
export function debounce(fn, delay = 100) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
}


/**
 * Binds event handlers and updates visual gradient tracks for the dual-range year slider UI component.
 *
 * @returns {void}
 */
export function initYearSlider() {
    const start = document.getElementById("yearStart");
    const end = document.getElementById("yearEnd");
    const track = document.getElementById("sliderTrack");
    const startLabel = document.getElementById("yearStartLabel");
    const endLabel = document.getElementById("yearEndLabel");

    if (!start || !end || !track) return;

    function sync() {
        let s = parseInt(start.value);
        let eVal = parseInt(end.value);
        if (s > eVal) { eVal = s; end.value = s; }
        if (startLabel) startLabel.innerText = s;
        if (endLabel) endLabel.innerText = eVal;

        const min = 1960; const max = 2026;
        const pctStart = ((s - min) / (max - min)) * 100;
        const pctEnd = ((eVal - min) / (max - min)) * 100;
        track.style.background = `linear-gradient(to right, #e5e7eb 0%, #e5e7eb ${pctStart}%, #2563eb ${pctStart}%, #2563eb ${pctEnd}%, #e5e7eb ${pctEnd}%, #e5e7eb 100%)`;
        draw();
    }
    start.oninput = sync; end.oninput = sync;
    sync();
}


/**
 * Renders the active scatter or network plot, including data points, connection edges, selection rings,
 * axes, titles, and legend onto an offscreen high-resolution HTML canvas, triggering a PNG download.
 *
 * @returns {Promise<void>} Resolves when export image generation completes and file prompt is triggered.
 */
export async function downloadPlot() {
    if (!state.filteredData || state.filteredData.length === 0) {
        alert("No data to export!");
        return;
    }

    // High-Resolution Configuration
    const resolutionScale = 3;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Software Application Typography Stack (Sans-Serif UI)
    const uiFontStack = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    const titleFontStack = "Georgia, Cambria, 'Times New Roman', Times, serif";

    // Helper for Meta Cluster Colors
    const getValidMetaColor = (mcValue) => {
        let metaColorHex = "#cccccc";
        let c = null;
        if (typeof window.getMetaClusterColor === 'function') c = window.getMetaClusterColor(mcValue);
        else if (typeof getMetaClusterColor === 'function') c = getMetaClusterColor(mcValue);

        if (c !== null && c !== undefined) {
            metaColorHex = typeof c === 'number' ? "#" + c.toString(16).padStart(6, '0') : c;
        }
        return metaColorHex;
    };

    // Helper for Node Colors
    const getValidNodeColor = (d) => {
        let colorStr = "#6b7280";
        if (typeof window.getNodeColor === 'function') colorStr = window.getNodeColor(d);
        else if (typeof getNodeColor === 'function') colorStr = getNodeColor(d);
        if (!colorStr || colorStr.includes("undefined")) colorStr = "#6b7280";
        return colorStr;
    };

    // Helper to evaluate visibility
    const isNodeHidden = (d) => {
        const rootId = d.cluster !== undefined && d.cluster !== null ? parseInt(d.cluster, 10) : -1;
        let pathStr = (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") ? String(d.sub_path) :
                      (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");
        const pathKey = pathStr === "" ? String(rootId) : `${rootId}-${pathStr}`;

        if (state.hiddenClusters && state.hiddenClusters.has(rootId)) return true;
        if (state.hiddenPaths && state.hiddenPaths.has(pathKey)) return true;

        const mcValue = d.meta_cluster_name ?? d.meta_cluster ?? d.metaCluster;
        if (mcValue && state.hiddenMetaClusters && state.hiddenMetaClusters.has(mcValue)) return true;

        return false;
    };

    // Robust Helper to Resolve Cluster & Region Names (WITH STRICT NOISE CHECK)
    const resolveClusterName = (rId, pathKey, isSubcluster, sampleNode = null) => {
        if (rId === -1 || pathKey === "-1" || pathKey === "Noise") return "Noise";

        if (isSubcluster) {
            const segments = String(pathKey).split('-');
            if (segments[segments.length - 1] === "-1") return "Noise";
        }

        // Check state.clusterLabels
        if (state.clusterLabels) {
            const activeMode = (state.globalClusterLabelMode && state.globalClusterLabelMode !== 'none') ? state.globalClusterLabelMode : null;
            if (activeMode && state.clusterLabels[activeMode]?.[pathKey]) return state.clusterLabels[activeMode][pathKey];
            if (activeMode && !isSubcluster && state.clusterLabels[activeMode]?.[rId]) return state.clusterLabels[activeMode][rId];
            if (state.clusterLabels[pathKey]) return state.clusterLabels[pathKey];
            if (!isSubcluster && state.clusterLabels[rId]) return state.clusterLabels[rId];

            for (const modeKey in state.clusterLabels) {
                if (typeof state.clusterLabels[modeKey] === 'object' && state.clusterLabels[modeKey] !== null) {
                    if (state.clusterLabels[modeKey][pathKey]) return state.clusterLabels[modeKey][pathKey];
                    if (!isSubcluster && state.clusterLabels[modeKey][rId]) return state.clusterLabels[modeKey][rId];
                }
            }
        }

        // Check properties directly on the sample node
        if (sampleNode) {
            if (isSubcluster) {
                const subName = sampleNode.sub_cluster_name || sampleNode.subcluster_name || sampleNode.subClusterName || sampleNode.sub_name;
                if (subName && typeof subName === 'string') return subName;
            } else {
                const rootName = sampleNode.cluster_name || sampleNode.clusterName || sampleNode.region_name || sampleNode.regionName || sampleNode.name || sampleNode.label;
                if (rootName && typeof rootName === 'string') return rootName;
            }
        }

        // Fallback: Search filteredData
        const match = state.filteredData.find(n => {
            const nRootId = n.cluster !== undefined && n.cluster !== null ? parseInt(n.cluster, 10) : -1;
            if (isSubcluster) {
                let pStr = (n.sub_path !== undefined && n.sub_path !== null && String(n.sub_path) !== "") ? String(n.sub_path) :
                              (n.sub_cluster !== undefined && n.sub_cluster !== null ? String(n.sub_cluster) : "");
                const pKey = pStr === "" ? String(nRootId) : `${nRootId}-${pStr}`;
                return pKey === pathKey && (n.sub_cluster_name || n.subcluster_name || n.subClusterName || n.sub_name);
            } else {
                return nRootId === rId && (n.cluster_name || n.clusterName || n.region_name || n.regionName || n.name || n.label);
            }
        });

        if (match) {
            if (isSubcluster) {
                return match.sub_cluster_name || match.subcluster_name || match.subClusterName || match.sub_name;
            } else {
                return match.cluster_name || match.clusterName || match.region_name || match.regionName || match.name || match.label;
            }
        }

        return isSubcluster ? `Subcluster ${pathKey.split('-').pop()}` : `Cluster ${rId}`;
    };

    // BUILD LEGEND DATA & HIERARCHY
    const legendMap = new Map();

    state.filteredData.forEach(d => {
        if (isNodeHidden(d)) return;

        const rootId = d.cluster !== undefined && d.cluster !== null ? parseInt(d.cluster, 10) : -1;
        let pathStr = (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") ? String(d.sub_path) :
                      (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");

        const pathKey = pathStr === "" ? String(rootId) : `${rootId}-${pathStr}`;

        if (!legendMap.has(pathKey)) {
            const colorStr = getValidNodeColor(d);
            const depth = pathStr === "" ? 0 : pathStr.split('-').length;
            const name = resolveClusterName(rootId, pathKey, depth > 0, d);

            legendMap.set(pathKey, { pathKey, name, colorStr, depth, isHeader: false, isMeta: false });
        }
    });

    const existingKeys = Array.from(legendMap.keys());
    existingKeys.forEach(key => {
        const tokens = key.split('-');
        let currentPath = "";
        for (let i = 0; i < tokens.length - 1; i++) {
            currentPath = currentPath === "" ? tokens[i] : `${currentPath}-${tokens[i]}`;
            if (!legendMap.has(currentPath)) {
                const rId = parseInt(tokens[0], 10);
                const hName = resolveClusterName(rId, currentPath, i > 0, null);
                legendMap.set(currentPath, {
                    pathKey: currentPath, name: hName, colorStr: null, depth: i, isHeader: true, isMeta: false
                });
            }
        }
    });

    let visibleLegendItems = Array.from(legendMap.values()).sort((a, b) => {
        const aTokens = a.pathKey.split('-').map(Number);
        const bTokens = b.pathKey.split('-').map(Number);
        const minLen = Math.min(aTokens.length, bTokens.length);
        for (let i = 0; i < minLen; i++) {
            if (aTokens[i] !== bTokens[i]) return aTokens[i] - bTokens[i];
        }
        return aTokens.length - bTokens.length;
    });

    // CALCULATE CONFIG & DIMENSIONS
    const exportW = 1920;
    const exportH = 1080;

    let maxContentWidth = 0;
    ctx.font = `400 12px ${uiFontStack}`;

    visibleLegendItems.forEach(item => {
        let displayName = item.name;
        if (displayName.length > 40) displayName = displayName.substring(0, 38) + "...";
        item.displayName = displayName;

        ctx.font = item.isHeader ? `600 12px ${uiFontStack}` : `400 12px ${uiFontStack}`;
        const textWidth = ctx.measureText(displayName).width;

        const totalWidth = (item.depth * 14) + 35 + textWidth;
        if (totalWidth > maxContentWidth) maxContentWidth = totalWidth;
    });

    const itemSpacing = 24;
    const hasLegend = visibleLegendItems.length > 0;

    const legendBoxW = hasLegend ? Math.max(180, maxContentWidth + 30) : 0;
    const legendBoxH = hasLegend ? 45 + (visibleLegendItems.length * itemSpacing) : 0;

    // Dynamically expand right padding so the legend sits outside the plot area
    const padTop = 130;
    const padBottom = 130;
    const padLeft = 140;
    const padRight = hasLegend ? legendBoxW + 80 : 140;

    const plotW = exportW - padLeft - padRight;
    const plotH = exportH - padTop - padBottom;

    // APPLY RESIZE & INITIALIZE HIGH-RES BACKING STORE
    canvas.width = exportW * resolutionScale;
    canvas.height = exportH * resolutionScale;

    ctx.scale(resolutionScale, resolutionScale);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportW, exportH);

    // CALCULATE DATA BOUNDS
    let dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
    let origMinX = Infinity, origMaxX = -Infinity, origMinY = Infinity, origMaxY = -Infinity;

    state.filteredData.forEach(d => {
        if (d.x != null && !isNaN(d.x)) {
            if (d.x < dMinX) dMinX = d.x;
            if (d.x > dMaxX) dMaxX = d.x;
        }
        if (d.y != null && !isNaN(d.y)) {
            if (d.y < dMinY) dMinY = d.y;
            if (d.y > dMaxY) dMaxY = d.y;
        }

        const ox = d.orig_x !== undefined ? d.orig_x : d.x;
        const oy = d.orig_y !== undefined ? d.orig_y : d.y;

        if (ox != null && !isNaN(ox)) {
            if (ox < origMinX) origMinX = ox;
            if (ox > origMaxX) origMaxX = ox;
        }
        if (oy != null && !isNaN(oy)) {
            if (oy < origMinY) origMinY = oy;
            if (oy > origMaxY) origMaxY = oy;
        }
    });

    const rangeX = dMaxX - dMinX || 1;
    const rangeY = dMaxY - dMinY || 1;
    dMinX -= rangeX * 0.15; dMaxX += rangeX * 0.15;
    dMinY -= rangeY * 0.15; dMaxY += rangeY * 0.15;

    const globalRangeX = (origMaxX !== Infinity && origMaxX > origMinX) ? (origMaxX - origMinX) : 1;
    const globalRangeY = (origMaxY !== Infinity && origMaxY > origMinY) ? (origMaxY - origMinY) : 1;

    const canvasW = state.canvas ? state.canvas.width : 1000;
    const canvasH = state.canvas ? state.canvas.height : 1000;

    const baseRatioX = canvasW / globalRangeX;
    const baseRatioY = canvasH / globalRangeY;

    const visualW = (dMaxX - dMinX) * baseRatioX;
    const visualH = (dMaxY - dMinY) * baseRatioY;

    const scale = Math.min(plotW / visualW, plotH / visualH);
    const actualPlotW = visualW * scale;
    const actualPlotH = visualH * scale;

    const offsetX = padLeft + (plotW - actualPlotW) / 2;
    const offsetY = padTop + (plotH - actualPlotH) / 2;

    const mapX = (x) => offsetX + ((x - dMinX) * baseRatioX) * scale;
    const mapY = (y) => offsetY + ((y - dMinY) * baseRatioY) * scale;

    const hasBorder = state.plotSettings && state.plotSettings.showBorder;

    if (hasBorder) {
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(offsetX, offsetY, actualPlotW, actualPlotH);

        const getStep = (min, max) => {
            const rawStep = (max - min) / 10;
            const logStep = Math.pow(10, Math.floor(Math.log10(rawStep)));
            return logStep * (rawStep / logStep < 2 ? 1 : rawStep / logStep < 5 ? 2 : 5);
        };

        const stepX = getStep(dMinX, dMaxX);
        const stepY = getStep(dMinY, dMaxY);

        const startGridX = Math.ceil(dMinX / stepX) * stepX;
        const startGridY = Math.ceil(dMinY / stepY) * stepY;

        ctx.fillStyle = "#64748b";
        ctx.font = `500 13px ${uiFontStack}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (let xVal = startGridX; xVal <= dMaxX; xVal += stepX) {
            const px = mapX(xVal);
            if (px >= offsetX && px <= offsetX + actualPlotW) {
                ctx.beginPath();
                ctx.moveTo(px, offsetY + actualPlotH);
                ctx.lineTo(px, offsetY + actualPlotH + 5);
                ctx.stroke();
                ctx.fillText(xVal.toFixed(1), px, offsetY + actualPlotH + 10);
            }
        }

        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let yVal = startGridY; yVal <= dMaxY; yVal += stepY) {
            const py = mapY(yVal);
            if (py >= offsetY && py <= offsetY + actualPlotH) {
                ctx.beginPath();
                ctx.moveTo(offsetX, py);
                ctx.lineTo(offsetX - 5, py);
                ctx.stroke();
                ctx.fillText(yVal.toFixed(1), offsetX - 10, py);
            }
        }
    }

    // RE-CALCULATE NETWORK MODE & DRAW CONNECTION LINES
    const isNetworkMode = state.viewMode === 'network' && state.graphData && state.graphData._scatterOverlayCache;
    let nodeDegreeMap = null;
    let activeTargetRaws = new Set();

    if (isNetworkMode) {
        const cache = state.graphData._scatterOverlayCache;
        nodeDegreeMap = cache.nodeDegreeMap;
        const resolvedEdges = cache.resolvedEdges || [];

        const targets = (state.selectedNodes && state.selectedNodes.length > 0)
            ? state.selectedNodes
            : (state.selectedNode ? [state.selectedNode] : (state.hoveredNode || state._hoveredGraphNode ? [state.hoveredNode || state._hoveredGraphNode] : []));

        targets.forEach(t => {
            if (t) activeTargetRaws.add(t.rawRef || t);
        });

        if (resolvedEdges.length > 0) {
            ctx.save();
            const passiveEdges = [];
            const highlightedEdges = [];

            resolvedEdges.forEach(item => {
                const x1 = mapX(item.src.x);
                const y1 = mapY(item.src.y);
                const x2 = mapX(item.tgt.x);
                const y2 = mapY(item.tgt.y);

                const isConnectedToHover = activeTargetRaws.size > 0 && (
                    activeTargetRaws.has(item.src) || activeTargetRaws.has(item.tgt) ||
                    activeTargetRaws.has(item.src.rawRef) || activeTargetRaws.has(item.tgt.rawRef)
                );

                const edgeObj = { x1, y1, x2, y2, item, isConnectedToHover };
                if (isConnectedToHover) highlightedEdges.push(edgeObj);
                else passiveEdges.push(edgeObj);
            });

            const applyEdgeStyle = (e) => {
                let c1 = getValidNodeColor(e.item.src.rawRef || e.item.src);
                let c2 = getValidNodeColor(e.item.tgt.rawRef || e.item.tgt);

                if (c1 === c2) {
                    ctx.strokeStyle = c1;
                } else {
                    const grad = ctx.createLinearGradient(e.x1, e.y1, e.x2, e.y2);
                    grad.addColorStop(0, c1);
                    grad.addColorStop(1, c2);
                    ctx.strokeStyle = grad;
                }
            };

            passiveEdges.forEach(e => {
                ctx.globalAlpha = (activeTargetRaws.size > 0) ? 0.12 : Math.min(0.35 * e.item.connectionWeight, 0.70);
                ctx.lineWidth = 0.8 * e.item.connectionWeight;
                ctx.beginPath();
                ctx.moveTo(e.x1, e.y1);
                ctx.lineTo(e.x2, e.y2);
                applyEdgeStyle(e);
                ctx.stroke();
            });

            if (highlightedEdges.length > 0) {
                ctx.globalAlpha = 1.0;
                highlightedEdges.forEach(e => {
                    ctx.lineWidth = 2.4 + (e.item.matchCount * 0.8);
                    ctx.setLineDash([7, 4]);
                    ctx.beginPath();
                    ctx.moveTo(e.x1, e.y1);
                    ctx.lineTo(e.x2, e.y2);
                    applyEdgeStyle(e);
                    ctx.stroke();
                });
                ctx.setLineDash([]);
            }
            ctx.restore();
        }
    }

    // DATA POINT VISUALIZATION
    const hasSelection = state.selectedNodes && state.selectedNodes.length > 0;

    state.filteredData.forEach(d => {
        if (isNodeHidden(d)) return;
        if (d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) return;

        const cx = mapX(d.x);
        const cy = mapY(d.y);

        const isSelected = hasSelection && state.selectedNodes.includes(d);
        ctx.globalAlpha = (hasSelection && !isSelected) ? 0.15 : 1.0;

        let nodeRadius = 3.5;
        if (isNetworkMode && nodeDegreeMap) {
            const connections = nodeDegreeMap.get(d) || 0;
            if (connections > 0) {
                const multiplier = Math.min(1.0 + Math.pow(connections, 1.3) * 0.08, 4.5);
                nodeRadius = 3.5 * multiplier;
            }
        }

        const mcValue = d.meta_cluster_name ?? d.meta_cluster ?? d.metaCluster;
        if (mcValue && !(state.hiddenMetaClusters && state.hiddenMetaClusters.has(mcValue))) {
            ctx.beginPath();
            ctx.arc(cx, cy, nodeRadius + 2, 0, Math.PI * 2);
            ctx.fillStyle = getValidMetaColor(mcValue);
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = getValidNodeColor(d);
        ctx.fill();
    });

    ctx.globalAlpha = 1.0;

    // SELECTION ACCENT RINGS
    if (isNetworkMode && activeTargetRaws.size > 0) {
        activeTargetRaws.forEach(sn => {
            if (sn && sn.x != null && sn.y != null && !isNaN(sn.x) && !isNaN(sn.y)) {
                const sx = mapX(sn.x);
                const sy = mapY(sn.y);
                let selRadius = 3.5;
                if (nodeDegreeMap) {
                    const connections = nodeDegreeMap.get(sn) || 0;
                    if (connections > 0) {
                        const multiplier = Math.min(1.0 + Math.pow(connections, 1.3) * 0.08, 4.5);
                        selRadius = 3.5 * multiplier;
                    }
                }
                ctx.save();
                ctx.beginPath();
                ctx.arc(sx, sy, selRadius + 3, 0, 2 * Math.PI);
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = 2.0;
                ctx.stroke();
                ctx.restore();
            }
        });
    }

    // ANCHORS & PIN OVERLAYS
    if (state.showAnchors && state.clusterCentroids) {
        Object.keys(state.clusterCentroids).forEach(cId => {
            const centroid = state.clusterCentroids[cId];
            if (centroid && centroid.x != null && centroid.y != null) {
                const cx = mapX(centroid.x);
                const cy = mapY(centroid.y);
                const size = 11;

                if (cx >= offsetX && cx <= offsetX + actualPlotW && cy >= offsetY && cy <= offsetY + actualPlotH) {
                    ctx.beginPath();
                    ctx.moveTo(cx - size, cy - size); ctx.lineTo(cx + size, cy + size);
                    ctx.moveTo(cx + size, cy - size); ctx.lineTo(cx - size, cy + size);
                    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4; ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(cx - size, cy - size); ctx.lineTo(cx + size, cy + size);
                    ctx.moveTo(cx + size, cy - size); ctx.lineTo(cx - size, cy + size);
                    ctx.strokeStyle = typeof getClusterColor === 'function' ? getClusterColor(Number(cId)) : '#ff0000';
                    ctx.lineWidth = 1.5; ctx.stroke();
                }
            }
        });
    }

    if (state.droppedPins && state.droppedPins.length > 0) {
        state.droppedPins.forEach(pin => {
            if (pin.x == null || pin.y == null) return;
            const px = mapX(pin.x); const py = mapY(pin.y);
            if (px >= offsetX && px <= offsetX + actualPlotW && py >= offsetY && py <= offsetY + actualPlotH) {
                ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI);
                ctx.fillStyle = '#ef4444'; ctx.fill();
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
            }
        });
    }

    //  ANNOTATION GRAPH LABELS & TITLES
    if (state.plotSettings?.title) {
        ctx.fillStyle = "#0f172a";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = `bold 34px ${titleFontStack}`;
        ctx.fillText(state.plotSettings.title, offsetX + (actualPlotW / 2), offsetY - 15);
    }

    ctx.fillStyle = "#475569";
    ctx.textAlign = "center";

    if (state.plotSettings?.xAxisName) {
        ctx.font = `600 16px ${uiFontStack}`;
        ctx.textBaseline = "top";
        ctx.fillText(state.plotSettings.xAxisName, offsetX + (actualPlotW / 2), offsetY + actualPlotH + 40);
    }

    if (state.plotSettings?.yAxisName) {
        ctx.save();
        ctx.translate(offsetX - 65, offsetY + (actualPlotH / 2));
        ctx.rotate(-Math.PI / 2);
        ctx.font = `600 16px ${uiFontStack}`;
        ctx.textBaseline = "bottom";
        ctx.fillText(state.plotSettings.yAxisName, 0, 0);
        ctx.restore();
    }

    // --- 7. DRAW STANDARD EXTERNAL LEGEND ---
    if (hasLegend) {
        // Position 30px outside the right border of the graph, aligned to the top
        const legendBoxX = offsetX + actualPlotW + 30;
        const legendBoxY = offsetY;

        ctx.save();
        ctx.fillStyle = "#ffffff"; // Solid white background
        ctx.strokeStyle = "#000000"; // Standard black outline
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.rect(legendBoxX, legendBoxY, legendBoxW, legendBoxH); // Sharp standard rectangle
        ctx.fill();
        ctx.stroke();

        const textStartX = legendBoxX + 16;
        const textStartY = legendBoxY + 16;

        ctx.fillStyle = "#0f172a";
        ctx.font = `600 12px ${uiFontStack}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("Clusters", textStartX, textStartY);

        let currentY = textStartY + 24;

        visibleLegendItems.forEach((item) => {
            const indentPixels = item.depth * 14;

            if (item.isHeader) {
                ctx.fillStyle = "#334155";
                ctx.font = `600 11px ${uiFontStack}`;
                ctx.fillText(item.displayName, textStartX + indentPixels, currentY);
            } else if (item.isMeta) {
                ctx.beginPath();
                ctx.arc(textStartX + 5 + indentPixels, currentY + 7, 4, 0, Math.PI * 2);
                ctx.strokeStyle = item.colorStr;
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.fillStyle = "#64748b";
                ctx.font = `400 11px ${uiFontStack}`;
                ctx.fillText(item.displayName, textStartX + 18 + indentPixels, currentY);
            } else {
                ctx.beginPath();
                ctx.arc(textStartX + 5 + indentPixels, currentY + 7, 4, 0, Math.PI * 2);
                ctx.fillStyle = item.colorStr;
                ctx.fill();

                ctx.fillStyle = "#64748b";
                ctx.font = `400 11px ${uiFontStack}`;
                ctx.fillText(item.displayName, textStartX + 18 + indentPixels, currentY);
            }

            currentY += itemSpacing;
        });

        ctx.restore();
    }

    // TRIGGER DOWNLOAD
    const dataURL = canvas.toDataURL('image/png', 1.0);
    const link = document.createElement('a');
    link.download = state.plotSettings?.title ? `${state.plotSettings.title.replace(/\s+/g, '_')}_Plot.png` : 'Research_Explorer_Plot.png';
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


/**
 * Toggles the map's pin placement mode, updating global state, canvas cursor style,
 * and toggling the 'body-pin-active' class on the document body.
 *
 * @returns {void}
 */
export function armPinMode() {
    const isCurrentlyActive = document.body.classList.contains('body-pin-active') || state.pinModeActive;

    if (isCurrentlyActive) {
        document.body.classList.remove('body-pin-active');
        state.pinModeActive = false;
        if (state.canvas) state.canvas.style.cursor = state.hoveredNode ? 'pointer' : 'default';
        console.log("❌ Pin mode deactivated.");
    } else {
        document.body.classList.add('body-pin-active');
        state.pinModeActive = true;
        if (state.canvas) state.canvas.style.cursor = 'crosshair';
        console.log("📍 Pin mode armed. Click anywhere on the plot to place.");
    }
}


/**
 * Clears all user-placed pins from state, resets the bottom panel trajectory tray,
 * and triggers a canvas redraw.
 *
 * @returns {void}
 */
export function clearPins() {
    state.droppedPins = [];
    updateBottomPanelTrajectory([]);
    draw();
    console.log("🧹 All pins cleared.");
}


/**
 * Toggles the visibility state of anchor nodes and triggers a canvas redraw.
 *
 * @param {boolean} isChecked - Whether anchor point rendering should be enabled.
 * @returns {void}
 */
export function toggleAnchors(isChecked) {
    state.showAnchors = isChecked;
    draw();
}


/**
 * Toggles the active state of the canvas heatmap layer, updates the toggle button UI state,
 * and triggers a canvas redraw.
 *
 * @returns {void}
 */
export function toggleHeatmap() {
    state.heatmapModeActive = !state.heatmapModeActive;

    const btn = document.getElementById("heatmapToggleBtn");
    if (btn) {
        btn.classList.toggle("active", state.heatmapModeActive);
    }

    draw();
}


/**
 * Renders and updates the expandable bottom tray displaying sequence step cards
 * for either search trajectories or placed pins, complete with proximity documents,
 * cluster badges, and interactive controls.
 *
 * @param {Array<Object>} dataSequence - Sequence of trajectory nodes or pin objects to display.
 * @param {string} [dataType="trajectory"] - Mode of data provided ("trajectory" | "pins").
 * @returns {void}
 */
export function updateBottomPanelTrajectory(dataSequence, dataType = "trajectory") {
    const bottomPanel = document.getElementById("bottom-panel");
    if (!bottomPanel) return;

    // Track state mode internally
    if (typeof state !== 'undefined') {
        state.activeTrayMode = dataType;
    }

    const tabTraj = document.getElementById("tab-trajectory");
    const tabPins = document.getElementById("tab-pins");
    const tabContainer = document.getElementById("bottom-panel-tabs");

    if (tabTraj && tabPins) {
        if (dataType === "trajectory") {
            // Highlight Search Path in Blue
            tabTraj.className = "tray-tab active-traj";
            tabPins.className = "tray-tab";
        } else {
            // Highlight Dropped Pins in Red
            tabTraj.className = "tray-tab";
            tabPins.className = "tray-tab active-pins";
        }
    }

    // Hide the tabs entirely if there are no pins AND no active search
    if (tabContainer) {
        const hasTraj = state.lastSearchTrajectory && state.lastSearchTrajectory.length > 0;
        const hasPins = state.droppedPins && state.droppedPins.length > 0;
        tabContainer.style.display = (!hasTraj && !hasPins) ? "none" : "flex";
    }

    // Handle empty state gracefully
    if (!Array.isArray(dataSequence) || dataSequence.length === 0) {
        bottomPanel.classList.remove("tray-collapsed");
        bottomPanel.style.setProperty('display', 'flex', 'important'); // ✨ Keeps background visible

        bottomPanel.innerHTML = `
            <div style="width: 100%; display: flex; align-items: center; justify-content: center; height: 110px; color: #9ca3af; font-size: 13px; font-weight: 500; font-family: system-ui, sans-serif;">
                No ${dataType === 'pins' ? 'dropped pins' : 'search path steps'} available.
            </div>
        `;
        return;
    }

    bottomPanel.classList.remove("tray-collapsed");
    const toggleBtn = document.getElementById("toggleTrayBtn");
    if (toggleBtn) toggleBtn.textContent = "Hide Menu";

    bottomPanel.style.setProperty('display', 'flex', 'important');
    bottomPanel.innerHTML = "";

    function getClusterLabelText(clusterId, subPath = "") {
        if (clusterId === "None" || clusterId === undefined) return "Unclustered";

        const fullPathKey = subPath ? `${clusterId}-${subPath}` : String(clusterId);
        if (typeof state !== 'undefined' && state.globalClusterLabelMode && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[fullPathKey]) {
            return state.clusterLabels[state.globalClusterLabelMode][fullPathKey];
        }

        if (!subPath) {
            const legendEl = document.getElementById("clusterLegend");
            if (legendEl && legendEl.children.length > 0) {
                const items = Array.from(legendEl.children);
                if (clusterId >= 0 && clusterId < items.length) {
                    let text = items[clusterId].textContent || "";
                    text = text.replace(/^[\s\S]*?(Cluster\s*\d+[:\-\s]+)/i, '')
                               .replace(/^[^\w\s\(\)\[\]]+/, '')
                               .trim();
                    if (text.length > 0) return text;
                }
            }

            if (typeof state !== 'undefined' && state.clusterLabels && state.clusterLabels[clusterId]) {
                return state.clusterLabels[clusterId];
            }
            return `Cluster ${clusterId}`;
        }

        return `Subcluster ${subPath.split('-').pop()}`;
    }

    dataSequence.forEach((item, index) => {
        if (!item) return;

        const card = document.createElement("div");
        card.className = "path-step-card";

        if (dataType === "pins") {
            const pinName = item.name && item.name !== 'Unknown Paper' ? item.name : `Pin Location ${index + 1}`;

            const startYear = parseInt(document.getElementById("yearStart")?.value || 1960);
            const endYear = parseInt(document.getElementById("yearEnd")?.value || 2026);
            const textFilter = document.getElementById("search")?.value?.toLowerCase() || "";

            const visibleData = (state.allData || []).filter(d => {
                if (d.year < startYear || d.year > endYear) return false;
                if (state.hiddenClusters && state.hiddenClusters.has(d.cluster)) return false;
                if (textFilter && d.title && !d.title.toLowerCase().includes(textFilter)) return false;
                return true;
            });

            const nearestItems = visibleData
                .map(d => {
                    const dx = d.x - item.x;
                    const dy = d.y - item.y;
                    return { paper: d, distSq: (dx * dx) + (dy * dy) };
                })
                .sort((a, b) => a.distSq - b.distSq)
                .slice(0, 5); // Fetch top 5 closest documents

            // Inherit visual color styling from the absolute nearest paper
            let pinCluster = item.cluster !== undefined ? item.cluster : "None";
            let pinPath = (item.sub_path !== undefined && item.sub_path !== null && String(item.sub_path) !== "") ? String(item.sub_path) :
                          (item.sub_cluster !== undefined && item.sub_cluster !== null ? String(item.sub_cluster) : "");

            if (pinCluster === "None" && nearestItems.length > 0) {
                pinCluster = nearestItems[0].paper.cluster !== undefined ? nearestItems[0].paper.cluster : "None";
                pinPath = (nearestItems[0].paper.sub_path !== undefined && nearestItems[0].paper.sub_path !== null && String(nearestItems[0].paper.sub_path) !== "") ? String(nearestItems[0].paper.sub_path) :
                          (nearestItems[0].paper.sub_cluster !== undefined && nearestItems[0].paper.sub_cluster !== null ? String(nearestItems[0].paper.sub_cluster) : "");
            }

            let pinColor = "#ef4444";
            if (pinCluster !== "None") {
                if (pinPath !== "" && typeof getSubClusterColor === "function") {
                    pinColor = getSubClusterColor(pinCluster, pinPath);
                } else if (typeof getClusterColor === "function") {
                    pinColor = getClusterColor(pinCluster);
                }
            }

            const badgeLabel = getClusterLabelText(pinCluster, pinPath);

            // Setup custom annotations descriptions if available
            const pinNotes = item.notes || "Manual coordinate point placed on the map.";
            const shortNotes = pinNotes.length > 60 ? pinNotes.substring(0, 60) + "..." : pinNotes;

            // Coordinates layout completely stripped out per instructions
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px; flex-shrink: 0;">
                    <div style="font-size: 10px; font-weight: 800; color: black; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%;" title="${pinName}">
                        ${pinName}
                    </div>
                    <div style="font-size: 9px; font-weight: 700; color: white; background: ${pinColor}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; white-space: nowrap; max-width: 42%; overflow: hidden; text-overflow: ellipsis;" title="${badgeLabel}">
                        ${badgeLabel}
                    </div>
                </div>
                <div style="font-size: 11px; color: #4b5563; line-height: 1.3; font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex-shrink: 0; margin-top: 2px;" title="${pinNotes}">
                    "${shortNotes}"
                </div>
                <div class="card-papers-list" style="margin-top: 4px;"></div>
                <button class="pin-delete-btn" style="width: 100%; text-align: center; font-size: 10px; margin-top: auto; padding: 4px; background: #fef2f2; border: 1px solid #fee2e2; color: #ef4444; border-radius: 4px; cursor: pointer; font-weight: 700; transition: background 0.2s; flex-shrink: 0;">
                    Delete Pin
                </button>
            `;

            // Append each computed proximity document dynamically to the container scroll box
            const papersContainer = card.querySelector(".card-papers-list");
            nearestItems.forEach(({ paper }) => {
                const paperCluster = paper.cluster !== undefined ? paper.cluster : "None";
                const paperPath = (paper.sub_path !== undefined && paper.sub_path !== null && String(paper.sub_path) !== "") ? String(paper.sub_path) :
                                  (paper.sub_cluster !== undefined && paper.sub_cluster !== null ? String(paper.sub_cluster) : "");

                let paperColor = "#d1d5db";
                if (paperCluster !== "None") {
                    if (paperPath !== "" && typeof getSubClusterColor === "function") {
                        paperColor = getSubClusterColor(paperCluster, paperPath);
                    } else if (typeof getClusterColor === "function") {
                        paperColor = getClusterColor(paperCluster);
                    }
                }

                const paperItem = document.createElement("div");
                paperItem.className = "step-paper-item";
                paperItem.style.cssText = `
                    font-size: 11px; font-weight: 600; color: #374151; padding: 4px 6px 4px 8px;
                    background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${paperColor};
                    border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    flex-shrink: 0; margin-top: 4px;
                `;
                paperItem.innerHTML = `${paper.title || "Untitled Document"}`;
                paperItem.title = paper.title || "";

                paperItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (typeof updatePanel === "function") {
                        updatePanel(paper);
                    }
                });
                papersContainer.appendChild(paperItem);
            });

            const deleteBtn = card.querySelector(".pin-delete-btn");
            if (deleteBtn && typeof window.removeSelectedPin === "function") {
                deleteBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    window.removeSelectedPin(item.id);
                });
            }

        } else {

            const hasPapersArray = Array.isArray(item.papers);
            const stepPapers = hasPapersArray ? item.papers : [item];

            let prominentCluster = "None";
            let prominentPath = "";
            let maxCount = 0;
            const counts = {};

            stepPapers.forEach(p => {
                if (p && p.cluster !== undefined) {
                    const pPath = (p.sub_path !== undefined && p.sub_path !== null && String(p.sub_path) !== "") ? String(p.sub_path) :
                                  (p.sub_cluster !== undefined && p.sub_cluster !== null ? String(p.sub_cluster) : "");
                    const comboKey = `${p.cluster}|${pPath}`;
                    counts[comboKey] = (counts[comboKey] || 0) + 1;
                    if (counts[comboKey] > maxCount) {
                        maxCount = counts[comboKey];
                        prominentCluster = p.cluster;
                        prominentPath = pPath;
                    }
                }
            });

            let cardClusterColor = "#2563eb";
            if (prominentCluster !== "None") {
                if (prominentPath !== "" && typeof getSubClusterColor === "function") {
                    cardClusterColor = getSubClusterColor(prominentCluster, prominentPath);
                } else if (typeof getClusterColor === "function") {
                    cardClusterColor = getClusterColor(prominentCluster);
                }
            }

            const primaryNode = hasPapersArray ? (item.primaryNode || stepPapers[0] || {}) : item;
            const cardTitleText = primaryNode.title ? primaryNode.title : `Sequence Step ${index + 1}`;
            const rawSummary = primaryNode.excerpt || primaryNode.abstract || "No summary excerpt available for this step.";
            const shortSummary = rawSummary.length > 85 ? rawSummary.substring(0, 85) + "..." : rawSummary;
            const badgeLabel = getClusterLabelText(prominentCluster, prominentPath);

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px; flex-shrink: 0;">
                    <div style="font-size: 10px; font-weight: 800; color: #2563eb; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%;" title="${cardTitleText}">
                        ${cardTitleText}
                    </div>
                    <div style="font-size: 9px; font-weight: 700; color: white; background: ${cardClusterColor}; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; white-space: nowrap; max-width: 42%; overflow: hidden; text-overflow: ellipsis;" title="${badgeLabel}">
                        ${badgeLabel}
                    </div>
                </div>
                <div style="font-size: 11px; color: #4b5563; line-height: 1.3; font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex-shrink: 0;" title="${rawSummary}">
                    "${shortSummary}"
                </div>
                <div class="card-papers-list"></div>
            `;

            const papersContainer = card.querySelector(".card-papers-list");
            stepPapers.forEach((paper) => {
                if (!paper) return;
                const paperCluster = paper.cluster !== undefined ? paper.cluster : "None";
                const paperPath = (paper.sub_path !== undefined && paper.sub_path !== null && String(paper.sub_path) !== "") ? String(paper.sub_path) :
                                  (paper.sub_cluster !== undefined && paper.sub_cluster !== null ? String(paper.sub_cluster) : "");

                let paperColor = "#d1d5db";
                if (paperCluster !== "None") {
                    if (paperPath !== "" && typeof getSubClusterColor === "function") {
                        paperColor = getSubClusterColor(paperCluster, paperPath);
                    } else if (typeof getClusterColor === "function") {
                        paperColor = getClusterColor(paperCluster);
                    }
                }

                const paperItem = document.createElement("div");
                paperItem.className = "step-paper-item";
                paperItem.style.cssText = `
                    font-size: 11px; font-weight: 600; color: #374151; padding: 4px 6px 4px 8px;
                    background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${paperColor};
                    border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    flex-shrink: 0; margin-top: 4px;
                `;
                paperItem.innerHTML = `${paper.title || "Untitled Document"}`;

                paperItem.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (typeof updatePanel === "function") updatePanel(paper);
                });
                papersContainer.appendChild(paperItem);
            });
        }

        bottomPanel.appendChild(card);

        if (index < dataSequence.length - 1) {
            const arrow = document.createElement("div");
            arrow.innerHTML = `
                <svg width="20" height="20" fill="none" stroke="${dataType === 'pins' ? '#ef4444' : '#9ca3af'}" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
            `;
            bottomPanel.appendChild(arrow);
        }
    });
}


/**
 * Initializes controls and event listeners for the draggable plot options dialog window,
 * binding inputs to global plot display settings and canvas redraw triggers.
 *
 * @returns {void}
 */
export function initPlotOptions() {
    const dialog = document.getElementById("plotOptionsDialog");
    const header = document.getElementById("plotDialogHeader");
    const btn = document.getElementById("plotOptionsBtn");
    const closeBtn = document.getElementById("closePlotDialog");

    if (!dialog || !btn) return;

    // Helper function to update the button's visual state based on dialog visibility
    const updateButtonVisuals = () => {
        const isOpen = dialog.style.display !== "none";
        btn.classList.toggle("active", isOpen);
    };

    // Toggle Visibility & update button visual
    btn.addEventListener("click", () => {
        dialog.style.display = dialog.style.display === "none" ? "flex" : "none";
        updateButtonVisuals();
    });

    // Close Dialog & turn off button visual
    closeBtn.addEventListener("click", () => {
        dialog.style.display = "none";
        updateButtonVisuals();
    });


    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener("mousedown", (e) => {
        if (e.target.closest('select, input, button, label, option, textarea, a')) {
            return;
        }
        isDragging = true;
        offsetX = e.clientX - dialog.offsetLeft;
        offsetY = e.clientY - dialog.offsetTop;
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        dialog.style.left = `${e.clientX - offsetX}px`;
        dialog.style.top = `${e.clientY - offsetY}px`;
    });

    document.addEventListener("mouseup", () => { isDragging = false; });

    // Bind inputs to the state and trigger a re-draw when changed
    document.getElementById("plotTitleInput").addEventListener("input", (e) => { state.plotSettings.title = e.target.value; draw(); });
    document.getElementById("plotBorderCheckbox").addEventListener("change", (e) => { state.plotSettings.showBorder = e.target.checked; draw(); });
    document.getElementById("plotLinesCheckbox").addEventListener("change", (e) => { state.plotSettings.showGridLines = e.target.checked; draw(); });
    document.getElementById("plotPinCheckbox").addEventListener("change", (e) => { state.plotSettings.showPin = e.target.checked; draw(); });
    document.getElementById("plotXAxisInput").addEventListener("input", (e) => { state.plotSettings.xAxisName = e.target.value; draw(); });
    document.getElementById("plotYAxisInput").addEventListener("input", (e) => { state.plotSettings.yAxisName = e.target.value; draw(); });

    // Scale inputs
    document.getElementById("plotXScaleInput").addEventListener("input", (e) => {
        state.plotSettings.xScale = parseFloat(e.target.value) || 1;
        draw();
    });
    document.getElementById("plotYScaleInput").addEventListener("input", (e) => {
        state.plotSettings.yScale = parseFloat(e.target.value) || 1;
        draw();
    });
}


/**
 * Instantiates a horizontal resizing handle on the metadata panel, enabling user drag interaction
 * to adjust panel width and recalculate canvas dimensions dynamically.
 *
 * @returns {void}
 */
export function initResizablePanel() {
    const panel = document.getElementById("metaPanel");
    if (!panel) return;


    panel.style.height = "100vh";
    panel.style.position = "fixed";
    panel.style.top = "0";
    panel.style.bottom = "0";
    panel.style.right = "0";
    panel.style.boxSizing = "border-box";

    const resizer = document.createElement("div");
    resizer.id = "metaPanelResizer";
    resizer.style.position = "absolute";
    resizer.style.left = "0";
    resizer.style.top = "0";
    resizer.style.bottom = "0";
    resizer.style.width = "8px";
    resizer.style.cursor = "ew-resize";
    resizer.style.zIndex = "9999";
    resizer.style.backgroundColor = "transparent";
    panel.appendChild(resizer);

    let isResizing = false;
    let savedTransition = "";

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;


        savedTransition = panel.style.transition;
        panel.style.transition = "none";

        document.body.style.cursor = "ew-resize";


        document.body.style.userSelect = "none";
        document.body.style.webkitUserSelect = "none";
    });


    window.addEventListener("mousemove", (e) => {
        if (!isResizing) return;


        let newWidth = window.innerWidth - e.clientX;


        const minWidth = 260;
        const maxWidth = window.innerWidth * 0.75;

        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;

        panel.style.width = `${newWidth}px`;


        const container = document.getElementById("plot");
        if (container && state.canvas) {
            state.canvas.width = container.clientWidth;
            state.canvas.height = container.clientHeight;
        }

        // Redraw rendering cycles immediately
        if (typeof draw === "function") draw();
    });

    window.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "default";
            document.body.style.userSelect = "auto";
            document.body.style.webkitUserSelect = "auto";

            panel.style.transition = savedTransition;

            const container = document.getElementById("plot");
            if (container && state.canvas) {
                state.canvas.width = container.clientWidth;
                state.canvas.height = container.clientHeight;
            }
            if (typeof draw === "function") draw();
        }
    });
}

/**
 * Resets or reverts tag sub-path strings across datasets back to parent levels,
 * purges sub-path visibility caches and custom labels, and triggers UI and canvas updates.
 *
 * @param {string} tag - Target tag name identifier.
 * @param {string|null} [subPath=null] - Specific sub-path string prefix to reset, or null to clear all sub-paths under tag.
 * @returns {void}
 */
window.deleteTagSubClusters = function(tag, subPath = null) {
    const datasets = [state.allData, state.filteredData, state.activeData, state.points, state.data]
        .filter(arr => Array.isArray(arr));

    datasets.forEach(dataset => {
        dataset.forEach(d => {
            const dTag = d.tag || 'chunk' || 'paper';
            if (dTag === tag) {
                const cleanNodePath = getCleanPath(d.tag_sub_path);
                if (subPath === null || subPath === "") {
                    // Resetting entirely at the root tag level
                    d.tag_sub_path = "";
                } else {
                    // Reverting nested tag subclusters back to parent level (e.g. "0.1.2" back to "0.1")
                    if (cleanNodePath.startsWith(subPath + '.')) {
                        d.tag_sub_path = subPath;
                    }
                }
            }
        });
    });

    // Clean up visibility and caching state
    const dotPrefix = subPath === null ? "" : `${subPath}.`;
    const fullKeyPrefix = subPath === null ? `${tag}::` : `${tag}::${dotPrefix}`;
    const clusterKeyPrefix = subPath === null ? `${tag}_` : `${tag}_${dotPrefix}`;
    const clusterAltPrefix = subPath === null ? `${tag}_Cluster ` : `${tag}_Cluster ${dotPrefix}`;

    if (state.hiddenTagSubPaths) {
        Array.from(state.hiddenTagSubPaths).forEach(key => {
            if (key.startsWith(fullKeyPrefix) || (subPath === null && key === `${tag}::`)) {
                state.hiddenTagSubPaths.delete(key);
            }
        });
    }

    if (state.hiddenSubClusters) {
        Array.from(state.hiddenSubClusters).forEach(key => {
            if (key.startsWith(clusterKeyPrefix) || key.startsWith(clusterAltPrefix)) {
                state.hiddenSubClusters.delete(key);
            }
        });
    }

    // Clean up custom names in state.clusterNames (preserving the tag root label)
    if (state.clusterNames) {
        Object.keys(state.clusterNames).forEach(key => {
            if (key.startsWith(clusterKeyPrefix) && key !== `${tag}_root`) {
                delete state.clusterNames[key];
            }
        });
    }

    // Rebuild sidebar UI and apply filters
    buildTagDropdownUI();

    import('../core/data.js').then(module => {
        if (typeof module.applyGlobalFilters === 'function') module.applyGlobalFilters();
        import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
    });
};

/**
 * Sanitizes path or cluster label strings by removing leading "Cluster" prefixes and trimming whitespace.
 *
 * @param {string|number} val - Raw path or cluster string to sanitize.
 * @returns {string} The cleaned path string.
 */
function getCleanPath(val) {
    if (!val) return "";
    return String(val).replace(/^Cluster\s+/i, '').trim();
}


/**
 * Toggles border rendering for points matching a metadata tag, updating active border state
 * and initiating canvas re-renders.
 *
 * @param {string} tagName - Target metadata tag identifier.
 * @param {boolean} isChecked - Whether to highlight borders for the tag.
 * @returns {void}
 */
window.toggleMetaClusterBorder = function(tagName, isChecked) {
    if (!state.colorBordersByMetadata) state.colorBordersByMetadata = [];

    if (isChecked) {
        if (!state.colorBordersByMetadata.includes(tagName)) {
            state.colorBordersByMetadata.push(tagName);
        }
        state.activeBorderTag = tagName;

        // Resolve the specific color for this tag so the render engine has a color to draw
        state.activeBorderColor = getMetaClusterColor(tagName);
    } else {
        state.colorBordersByMetadata = state.colorBordersByMetadata.filter(t => t !== tagName);
        if (state.activeBorderTag === tagName) {
            state.activeBorderTag = state.colorBordersByMetadata.length > 0
                ? state.colorBordersByMetadata[state.colorBordersByMetadata.length - 1]
                : null;

            // Update the color to match the new active tag, or null if empty
            state.activeBorderColor = state.activeBorderTag ? getMetaClusterColor(state.activeBorderTag) : null;
        }
    }

    // Trigger canvas redraw immediately to reflect border changes
    import('../canvas/render.js').then(r => {
        if (typeof r.draw === 'function') r.draw();
    });
};


/**
 * Toggles the hidden state of a specific subcluster key, updates legend UI, and triggers a canvas redraw.
 *
 * @param {number|string} parentClusterId - Parent cluster identifier.
 * @param {number|string} subId - Subcluster identifier.
 * @returns {void}
 */
export function toggleSubClusterFilter(parentClusterId, subId) {
    if (!state.hiddenSubClusters) state.hiddenSubClusters = new Set();

    const subKey = `${parentClusterId}-${subId}`;

    if (state.hiddenSubClusters.has(subKey)) {
        state.hiddenSubClusters.delete(subKey);
    } else state.hiddenSubClusters.add(subKey);

    updateLegend();

    import('../canvas/render.js').then(r => r.draw());
}


/**
 * Computes the mean coordinates across all data points to create a new cluster centroid ID
 * and invokes spatial reassignment.
 *
 * @returns {void}
 */
export function createNewClusterCentroid() {
    if (!state.allData || state.allData.length === 0) return;

    // Find the next available Cluster ID
    const existingIds = [...new Set(state.allData.map(d => d.cluster))];
    const newClusterId = Math.max(...existingIds, 0) + 1;

    let centerX = 0, centerY = 0;
    state.allData.forEach(d => { centerX += d.x; centerY += d.y; });
    centerX /= state.allData.length;
    centerY /= state.allData.length;


    if (!state.clusterCentroids) state.clusterCentroids = {};
    state.clusterCentroids[newClusterId] = {
        xSum: centerX,
        ySum: centerY,
        count: 1,
        x: centerX,
        y: centerY
    };

    reassignPointsToCentroids();
}



/**
 * Reassigns all dataset points to their nearest cluster centroid using Euclidean distance metrics,
 * resets sub-cluster hierarchies, and updates legend and canvas render layers.
 *
 * @returns {void}
 */
export function reassignPointsToCentroids() {
    if (!state.clusterCentroids) return;

    state.hiddenPaths = new Set();
    state.activeSubClusters = {};
    if (state.hiddenSubClusters) state.hiddenSubClusters = new Set();


    const activeCentroids = Object.keys(state.clusterCentroids).map(id => {
        const c = state.clusterCentroids[id];
        // If rebuildClusterCentroids ran, x is (xSum/count). If manual, use x.
        const actualX = c.x !== undefined ? c.x : (c.xSum / c.count);
        const actualY = c.y !== undefined ? c.y : (c.ySum / c.count);
        return { id: parseInt(id), x: actualX, y: actualY };
    });


    state.allData.forEach(d => {
        delete d.sub_path;
        delete d.sub_cluster;

        let minDist = Infinity;
        let closestId = d.cluster;

        activeCentroids.forEach(c => {
            const dist = Math.pow(d.x - c.x, 2) + Math.pow(d.y - c.y, 2);
            if (dist < minDist) {
                minDist = dist;
                closestId = c.id;
            }
        });


        if (d.cluster !== closestId) d.cluster = closestId;

    });


    import('./ui.js').then(ui => {
        if (typeof ui.updateLegend === 'function') ui.updateLegend();
    });
    import('../canvas/render.js').then(r => {
        // Recalculate true mathematical centers based on the newly claimed dots
        if (typeof r.rebuildClusterCentroids === 'function') r.rebuildClusterCentroids();
        if (typeof r.draw === 'function') r.draw();
    });
}


/**
 * Toggles the "Islands" macro/micro coordinate layout transformation,
 * expanding main clusters and pulling subclusters into dense landmasses,
 * before rebuilding centroids and updating the canvas render cache.
 *
 * @returns {void}
 */
export function toggleIslands() {
    state.islandsEnabled = !state.islandsEnabled;

    // VISUAL BUTTON TOGGLE
    const btn = document.getElementById("islandToggleBtn");
    if (btn) {
        btn.classList.toggle("active", state.islandsEnabled);
    }

    // Backup the original coordinates on first run
    if (!state.originalCoordsSaved) {
        state.allData.forEach(d => {
            d.orig_x = d.x;
            d.orig_y = d.y;
        });
        state.originalCoordsSaved = true;
    }

    if (state.islandsEnabled) {
        // Calculate coordinate scale to dynamically space islands
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        state.allData.forEach(d => {
            if (d.orig_x < minX) minX = d.orig_x;
            if (d.orig_x > maxX) maxX = d.orig_x;
            if (d.orig_y < minY) minY = d.orig_y;
            if (d.orig_y > maxY) maxY = d.orig_y;
        });

        const scaleX = maxX - minX;
        const scaleY = maxY - minY;

        const mainPushFactor = 1.8;   // Explodes main clusters 180% further apart
        const subPushRadius = Math.max(scaleX, scaleY) * 0.15; // Much wider circle for subclusters
        const gravity = 0.85;         // 85% shrink - pulls points tightly into dense "landmasses"

        // Global center of the entire dataset
        let globalCx = minX + scaleX / 2;
        let globalCy = minY + scaleY / 2;

        // Group points by their main cluster OR metadata tag
        const clusterGroups = {};
        state.allData.forEach(node => {
            let cId;
            if (state.colorByMetadata) {
                cId = node.tag || "unknown";
            } else {
                cId = node.cluster !== undefined && node.cluster !== null ? node.cluster : -1;
            }

            if (!clusterGroups[cId]) clusterGroups[cId] = [];
            clusterGroups[cId].push(node);
        });

        Object.keys(clusterGroups).forEach(clusterId => {
            // Noise points (-1) are unaffected in standard mode
            if (!state.colorByMetadata && clusterId == -1) {
                clusterGroups[clusterId].forEach(n => { n.x = n.orig_x; n.y = n.orig_y; });
                return;
            }

            const nodesInCluster = clusterGroups[clusterId];

            // Find the center of this specific main group
            let cx = 0, cy = 0;
            nodesInCluster.forEach(n => { cx += n.orig_x; cy += n.orig_y; });
            cx /= nodesInCluster.length;
            cy /= nodesInCluster.length;

            // Push main group heavily away from the global center
            const mainOffsetX = (cx - globalCx) * mainPushFactor;
            const mainOffsetY = (cy - globalCy) * mainPushFactor;

            // Sub-group points by their subcluster ID (sub_path OR tag_sub_path)
            const subGroups = {};
            nodesInCluster.forEach(node => {
                let subId;
                if (state.colorByMetadata) {
                    subId = node.tag_sub_path !== undefined && node.tag_sub_path !== null
                        ? String(node.tag_sub_path).replace(/^Cluster\s+/i, '').trim()
                        : "main";
                } else {
                    subId = node.sub_path || "main";
                }

                if (!subGroups[subId]) subGroups[subId] = [];
                subGroups[subId].push(node);
            });

            const subKeys = Object.keys(subGroups);

            // Layout each subcluster
            subKeys.forEach((subId, idx) => {
                const subNodes = subGroups[subId];

                // Find the exact center of this specific subcluster
                let subCx = 0, subCy = 0;
                subNodes.forEach(n => { subCx += n.orig_x; subCy += n.orig_y; });
                subCx /= subNodes.length;
                subCy /= subNodes.length;

                // Calculate wide circular push for this subcluster
                const angle = (idx / subKeys.length) * Math.PI * 2;
                const applySubPush = subKeys.length > 1;
                const soX = applySubPush ? Math.cos(angle) * subPushRadius : 0;
                const soY = applySubPush ? Math.sin(angle) * subPushRadius : 0;

                // Apply gravity and offsets
                subNodes.forEach(n => {
                    // Pull point toward its subcluster center (Condensation)
                    const localDx = n.orig_x - subCx;
                    const localDy = n.orig_y - subCy;
                    const condensedX = subCx + (localDx * (1 - gravity));
                    const condensedY = subCy + (localDy * (1 - gravity));

                    // Apply the macro and micro offsets
                    n.x = condensedX + mainOffsetX + soX;
                    n.y = condensedY + mainOffsetY + soY;
                });
            });
        });

    } else {
        // Restore original mapped coordinates when toggled off
        state.allData.forEach(d => {
            d.x = d.orig_x;
            d.y = d.orig_y;
        });
    }

    // Update Centroids and refresh the canvas
    import('../canvas/render.js').then(r => {
        if (typeof r.rebuildClusterCentroids === 'function') r.rebuildClusterCentroids();

        // break the LOD Cache so the engine knows coordinates shifted
        if (typeof r.invalidateRenderCache === 'function') r.invalidateRenderCache();

        r.draw();
    });
}


/**
 * Toggles spiral layout mode and initiates spiral coordinate transformation calculations.
 *
 * @returns {void}
 */
export function toggleSpiral() {
    state.spiralEnabled = !state.spiralEnabled;

    const btn = document.getElementById("spiralToggleBtn");
    if (btn) {
        btn.classList.toggle("active", state.spiralEnabled);
    }

    applySpiralLayout();
}


/**
 * Transforms data point coordinates into a spiral pattern centered on a target pin or calculated centroid,
 * or restores mapped coordinates when spiral mode is disabled.
 *
 * @returns {void}
 */
export function applySpiralLayout() {
    // Backup the original coordinates on first run safely
    if (!state.originalCoordsSaved) {
        state.allData.forEach(d => { d.orig_x = d.x; d.orig_y = d.y; });
        state.originalCoordsSaved = true;
    }

    if (state.spiralEnabled) {
        let targetX, targetY;

        const newestPin = (state.droppedPins && state.droppedPins.length > 0)
            ? state.droppedPins[state.droppedPins.length - 1]
            : null;

        if (newestPin) {
            // Use the newest pin's original data coordinates
            targetX = newestPin.orig_x !== undefined ? newestPin.orig_x : newestPin.x;
            targetY = newestPin.orig_y !== undefined ? newestPin.orig_y : newestPin.y;
        } else {
            // Fallback: Calculate geometric data center if no pin exists
            let minX = state.allData[0].orig_x, maxX = minX;
            let minY = state.allData[0].orig_y, maxY = minY;

            state.allData.forEach(d => {
                if (d.orig_x < minX) minX = d.orig_x;
                if (d.orig_x > maxX) maxX = d.orig_x;
                if (d.orig_y < minY) minY = d.orig_y;
                if (d.orig_y > maxY) maxY = d.orig_y;
            });
            targetX = minX + (maxX - minX) / 2;
            targetY = minY + (maxY - minY) / 2;

            // Generate a temporary layout marker pin only because the user didn't have one
            state.droppedPins = [{
                x: targetX,
                y: targetY,
                orig_x: targetX,
                orig_y: targetY,
                isLayoutTempPin: true // Tag it so we can clean it up safely later
            }];
        }

        const screenCenterX = mapX(targetX);
        const screenCenterY = mapY(targetY);

        const hasSemanticSearch = state.searchDistances && Object.keys(state.searchDistances).length > 0;

        const nodesWithDist = state.allData.map(d => {
            const id = d.chunk_id || d.id;
            let dist = 0;

            if (hasSemanticSearch) {
                dist = state.searchDistances[id] !== undefined ? state.searchDistances[id] : Infinity;
            } else {
                // Calculate distance directly relative to our anchor pin/center
                const dx = d.orig_x - targetX;
                const dy = d.orig_y - targetY;
                dist = Math.sqrt(dx * dx + dy * dy);
            }
            return { node: d, dist: dist };
        });

        nodesWithDist.sort((a, b) => a.dist - b.dist);

        const compactness = 5.0;

        nodesWithDist.forEach((item, n) => {
            if (n === 0) {
                item.node.x = targetX;
                item.node.y = targetY;
                return;
            }

            // Determine original angle relative to the anchor pin to preserve topological shape
            const dx = item.node.orig_x - targetX;
            const dy = item.node.orig_y - targetY;
            const originalAngle = Math.atan2(dy, dx);
            const angularWobble = (Math.random() - 0.5) * 0.4;
            const theta = originalAngle + angularWobble;

            // Generate radius outward from the anchor point in uniform screen pixels
            const baseRadius = Math.sqrt(n) * compactness;
            const randomFuzz = (Math.random() - 0.5) * compactness;
            const pixelR = Math.max(0, baseRadius + randomFuzz);

            // Translate angle and radius into screen coordinates centered on the pin
            const px = screenCenterX + pixelR * Math.cos(theta);
            const py = screenCenterY + pixelR * Math.sin(theta);

            // Reverse map screen pixels securely back into real data coordinates
            item.node.x = invertMapX(px);
            item.node.y = invertMapY(py);
        });

    } else {
        if (state.flatSearchIds) {
            import('../core/data.js').then(d => d.applyGlobalFilters());
        }


        if (state.droppedPins && state.droppedPins.length > 0 && state.droppedPins[0].isLayoutTempPin) {
            state.droppedPins = [];
        }

        // Restore Map Positions
        state.allData.forEach(d => {
            d.x = d.orig_x;
            d.y = d.orig_y;
        });
    }

    import('../canvas/render.js').then(r => {
        // Force the rendering engine to discard the old coordinate cache and rebuild the LOD meshes
        if (typeof r.invalidateRenderCache === 'function') {
            r.invalidateRenderCache();
        }

        if (typeof r.rebuildClusterCentroids === 'function') {
            r.rebuildClusterCentroids();
        }

        r.draw();
    });
}


/**
 * Switches the global view mode between map and topology/chord diagram states,
 * updating the legend UI, zoom parameters, and rendering containers.
 *
 * @param {'map' | 'chord'} mode - Target visualization view mode.
 * @returns {void}
 */
export function switchViewMode(mode) {
    if (state.viewMode === mode) return;

    state.viewMode = mode;
    console.log(`Switching visualization layout to: ${mode}`);
    updateLegend();
    // Get your container elements
    const chordContainer = document.getElementById('chord-diagram') || document.getElementById('topology-container');

    if (mode === 'chord') {
        // Clear out any legacy SVG or canvas remnants inside the chord container
        if (chordContainer) {
            chordContainer.innerHTML = '';
        }

        // Initialize or refresh chord topology calculations
        if (typeof window.initTopology === 'function') {
            window.initTopology();
        } else if (typeof window.updateChordTopology === 'function') {
            window.updateChordTopology();
        }

        //  Reset zoom positioning to default layout space before rendering ribbons
        if (typeof resetZoom === 'function') {
            resetZoom();
        }
    } else {
        // Fallback or cleanup routine when reverting back to traditional scatter/map mode
        if (chordContainer) {
            chordContainer.innerHTML = '';
        }
    }

    // Trigger universal canvas redraw loop
    if (typeof draw === 'function') {
        requestAnimationFrame(() => draw());
    } else if (typeof window.draw === 'function') {
        requestAnimationFrame(() => window.draw());
    }
}

/**
 * Ensures state properties for active tags and hidden subclusters exist as valid Set instances.
 *
 * @returns {void}
 */
export function hydrateStateSets() {
    if (!state) return;

    const setToHydrate = ['visibleTags', 'hiddenTagSubPaths', 'hiddenSubClusters'];

    setToHydrate.forEach(key => {
        if (state[key] && !(state[key] instanceof Set)) {
            // Converts Arrays or Objects back into valid Sets
            state[key] = new Set(Array.isArray(state[key]) ? state[key] : Object.keys(state[key]));
        } else if (!state[key]) {
            state[key] = new Set();
        }
    });
}


/**
 * Restores UI and canvas state following an undo or redo event, re-hydrating sets,
 * rebuilding controls, applying active metadata borders, and triggering canvas updates.
 *
 * @returns {void}
 */
export function refreshPanelAfterUndoRedo() {
    if (!state || !state.allData) return;

    // Repair any broken Set objects from history restoration
    hydrateStateSets();

    // Rebuild the sidebar checkboxes and subtrees to match the restored state
    buildTagDropdownUI();

    // Restore the active metadata border highlighting
    if (state.selectedMetadataTag) {
        window.toggleMetaClusterBorder(state.selectedMetadataTag, true);
    } else if (typeof window.toggleMetaClusterBorder === 'function' && state.activeBorderTag) {
        // Clear active border if the restored state had no selection
        window.toggleMetaClusterBorder(state.activeBorderTag, false);
    }

    // Apply dataset filters and trigger canvas redraw
    import('../core/data.js').then(module => {
        if (typeof module.applyGlobalFilters === 'function') {
            module.applyGlobalFilters();
        }
        import('../canvas/render.js').then(r => {
            if (typeof r.updateLabels === 'function') r.updateLabels();
            if (typeof r.draw === 'function') r.draw();
        });
    });
}


/**
 * Serializes current visualization configuration, cluster centroids, labels, and paper positions
 * into a structured JSON file and initiates a browser file download.
 *
 * @returns {void}
 */
window.exportLayout = function() {
    if (!state.allData || state.allData.length === 0) {
        alert("No layout data available to export.");
        return;
    }

    const payload = {
        version: "1.1",
        timestamp: new Date().toISOString(),
        viewMode: state.viewMode,
        isSubClustered: state.isSubClustered,
        activeSplits: Array.from(state.activeSplits || []),
        clusterCentroids: state.clusterCentroids,
        clusterKeywordNames: state.clusterKeywordNames || {},
        clusterLabels: state.clusterLabels || { keywords: {}, summaries: {} },
        islandsEnabled: state.islandsEnabled,
        spiralEnabled: state.spiralEnabled,
        originalCoordsSaved: state.originalCoordsSaved,

        // Save paper states with backup identifiers to ensure reliable matching
        papers: state.allData.map((d, index) => ({
            index: index,
            id: d.id !== undefined ? d.id : null,
            chunk_id: d.chunk_id !== undefined ? d.chunk_id : null,
            paper_id: d.paper_id !== undefined ? d.paper_id : null,
            title: d.title || null,
            x: d.x,
            y: d.y,
            cluster: d.cluster,
            sub_cluster: d.sub_cluster !== undefined ? d.sub_cluster : null,
            sub_path: d.sub_path !== undefined ? d.sub_path : null
        }))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `research-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};


/**
 * Reads and parses an uploaded layout JSON file, mapping restored coordinates and metadata
 * back onto state collections using an ID lookup cascade before updating the UI and canvas.
 *
 * @param {Event} event - File input change event containing the uploaded file.
 * @returns {void}
 */
window.importLayout = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const savedLayout = JSON.parse(e.target.result);
            if (!savedLayout.papers || !Array.isArray(savedLayout.papers)) {
                throw new Error("Invalid layout file structure.");
            }

            // Turn on the restoration guard to block automatic API overwrites
            window.isRestoring = true;

            // Reset physical pan/zoom to prevent drawing outside of viewport bounds
            state.transform = { k: 1, x: 0, y: 0 };

            // Restore companion state variables (essential for rendering & legend)
            state.viewMode = savedLayout.viewMode || 'default';
            state.isSubClustered = savedLayout.isSubClustered || false;
            state.clusterCentroids = savedLayout.clusterCentroids;
            state.clusterKeywordNames = savedLayout.clusterKeywordNames || {};
            state.clusterLabels = savedLayout.clusterLabels || { keywords: {}, summaries: {} };
            state.islandsEnabled = savedLayout.islandsEnabled || false;
            state.spiralEnabled = savedLayout.spiralEnabled || false;
            state.originalCoordsSaved = savedLayout.originalCoordsSaved || false;
            state.activeSplits = new Set(savedLayout.activeSplits || []);

            // Map imported coordinates back onto state.allData using an ID Cascade
            const mapByChunkId = new Map();
            const mapById = new Map();
            const mapByPaperId = new Map();
            const mapByTitle = new Map();
            const mapByIndex = new Map();

            savedLayout.papers.forEach(p => {
                if (p.chunk_id !== null && p.chunk_id !== undefined) mapByChunkId.set(String(p.chunk_id), p);
                if (p.id !== null && p.id !== undefined) mapById.set(String(p.id), p);
                if (p.paper_id !== null && p.paper_id !== undefined) mapByPaperId.set(String(p.paper_id), p);
                if (p.title) mapByTitle.set(p.title, p);
                if (p.index !== undefined && p.index !== null) mapByIndex.set(Number(p.index), p);
            });

            state.allData.forEach((d, idx) => {
                let saved = null;

                // Hierarchical lookup cascade to prevent matching failures
                if (d.chunk_id !== undefined && d.chunk_id !== null && mapByChunkId.has(String(d.chunk_id))) {
                    saved = mapByChunkId.get(String(d.chunk_id));
                } else if (d.id !== undefined && d.id !== null && mapById.has(String(d.id))) {
                    saved = mapById.get(String(d.id));
                } else if (d.paper_id !== undefined && d.paper_id !== null && mapByPaperId.has(String(d.paper_id))) {
                    saved = mapByPaperId.get(String(d.paper_id));
                } else if (d.title && mapByTitle.has(d.title)) {
                    saved = mapByTitle.get(d.title);
                } else if (mapByIndex.has(idx)) {
                    saved = mapByIndex.get(idx);
                }

                if (saved) {
                    d.x = saved.x;
                    d.y = saved.y;
                    d.cluster = saved.cluster;

                    if (saved.sub_cluster !== null && saved.sub_cluster !== undefined) {
                        d.sub_cluster = saved.sub_cluster;
                    } else {
                        delete d.sub_cluster;
                    }

                    if (saved.sub_path !== null && saved.sub_path !== undefined) {
                        d.sub_path = saved.sub_path;
                    } else {
                        delete d.sub_path;
                    }
                }
            });

            // Sync downstream active arrays
            state.filteredData = [...state.allData];

            // Step F: Update UI toggles dynamically to match state
            const islandBtn = document.getElementById('islandToggleBtn');
            if (islandBtn) {

                islandBtn.classList.toggle('active', state.islandsEnabled);
            }
            const spiralBtn = document.getElementById('spiralToggleBtn');
            if (spiralBtn) {

                spiralBtn.classList.toggle('active', state.spiralEnabled);
            }

            // Trigger Global Filter, Zoom Reframing, Legend updates, and canvas Draw
            const dataModule = await import('../core/data.js').catch(() => null);
            if (dataModule && typeof dataModule.applyGlobalFilters === 'function') {
                dataModule.applyGlobalFilters();
            } else if (typeof window.applyGlobalFilters === 'function') {
                window.applyGlobalFilters();
            }

            const eventModule = await import('../canvas/events.js').catch(() => null);
            if (eventModule && typeof eventModule.resetZoom === 'function') {
                eventModule.resetZoom();
            } else if (typeof window.resetZoom === 'function') {
                window.resetZoom();
            } else if (typeof window.resetPlot === 'function') {
                window.resetPlot();
            }

            const uiModule = await import('./ui.js').catch(() => null);
            if (uiModule && typeof uiModule.updateLegend === 'function') {
                uiModule.updateLegend();
            } else if (typeof window.updateLegend === 'function') {
                window.updateLegend();
            }

            const renderModule = await import('../canvas/render.js').catch(() => null);
            if (renderModule && typeof renderModule.draw === 'function') {
                renderModule.draw();
            } else if (typeof window.draw === 'function') {
                window.draw();
            }

            // Save snapshot in history stack
            if (typeof window.saveState === 'function') {
                window.saveState();
            } else if (typeof window.saveHistoryState === 'function') {
                window.saveHistoryState();
            }

            window.isRestoring = false;
            event.target.value = ''; // Reset input element
            alert("Layout successfully restored!");

        } catch (err) {
            console.error("Failed to load layout:", err);
            alert("Error restoring file: " + err.message);
            window.isRestoring = false;
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};


/**
 * Toggles global network graph display states, switching between scatter, hierarchy, and network views.
 *
 * @returns {Promise<void>} Resolves when network mode transition and graph updates complete.
 */
export async function triggerNetworkGraphMode() {
    console.log(`[Network Toggle] Current viewMode: '${state.viewMode}'`);

    const btn = document.getElementById('btnToggleGraph');

    // TOGGLE OFF CHECKS (If already in a Network mode, switch back)
    if (state.viewMode === 'hNetwork') {
        state.viewMode = 'hierarchy';
        if (typeof updateKeywordNetwork === 'function') updateKeywordNetwork();
        if (typeof drawHierarchy === 'function') drawHierarchy();
        updateButtonUI(btn, false); // <-- Set to OFF
        return;
    }

    if (state.viewMode === 'network') {
        state.viewMode = 'scatter';
        if (typeof updateLegend === 'function') updateLegend();
        if (typeof draw === 'function') requestAnimationFrame(() => draw());
        updateButtonUI(btn, false); // <-- Set to OFF
        return;
    }

    // TOGGLE ON CHECKS (Context-aware based on active screen)
    if (state.viewMode === 'hierarchy') {
        state.previousViewMode = 'hierarchy';
        state.viewMode = 'hNetwork';
        if (typeof updateKeywordNetwork === 'function') updateKeywordNetwork();
        if (typeof drawHierarchy === 'function') drawHierarchy();
        updateButtonUI(btn, true); // <-- Set to ON
        return;
    }
    updateButtonUI(btn, true); // <-- Set to ON
    // Fallback to Full Network Graph Mode (from scatter)
    state.previousViewMode = state.viewMode || 'scatter';
    const rawNodes = state.allData || state.nodes || (state.graphData && state.graphData.nodes) || [];

    if (!rawNodes || rawNodes.length === 0) return;

    const targets = rawNodes.map((node, idx) => ({
        ...node,
        id: String(node.id || node.chunk_id || `node_${idx}`),
        type: node.type || 'entity',
        name: node.name || node.label || String(node.id || `Node ${idx}`)
    }));

    try {
        if (typeof autoLabelAllClusters === 'function') {
            await autoLabelAllClusters('keywords', targets);
        } else if (typeof buildKeywordNetwork === 'function') {
            const networkData = buildKeywordNetwork(targets);
            state.graphData = networkData;
            state.viewMode = 'network';
            if (typeof draw === 'function') requestAnimationFrame(() => draw());

            updateButtonUI(btn, true); // <-- Set to ON
        }
    } catch (err) {
        console.error(err);
    }
}


/**
 * Updates CSS styling and text label of a toggle button depending on its active state.
 *
 * @param {HTMLElement|null} btn - Button element to update.
 * @param {boolean} isActive - Active state flag.
 * @returns {void}
 */
function updateButtonUI(btn, isActive) {
    if (!btn) return;

    const span = btn.querySelector('span');

    if (isActive) {
        // Active State: Invert colors to look "pressed"
        btn.style.background = '#1d4ed8'; // Solid blue background
        btn.style.color = '#ffffff';      // White text/icon
        if (span) span.innerText = 'Exit Network';
    } else {
        // Inactive State: Back to soft blue
        btn.style.background = '#eff6ff'; // Soft blue background
        btn.style.color = '#1d4ed8';      // Dark blue text/icon
        if (span) span.innerText = 'Network';
    }
}


/**
 * Executes an AI query request using the user-provided question or prompt text.
 *
 * @param {string} queryText - The text query to be sent and processed.
 * @returns {void}
 */
document.addEventListener("DOMContentLoaded", () => {
    const aiQueryBtn = document.getElementById("aiQueryBtn");
    const aiQueryInput = document.getElementById("aiQuery");

    if (aiQueryBtn && aiQueryInput) {
        aiQueryBtn.addEventListener("click", () => {
            const queryText = aiQueryInput.value.trim();

            if (!queryText) {
                alert("Please enter a question first.");
                return;
            }

            // Trigger the aiQuery function defined previously
            window.aiQuery(queryText);
        });
    }
});


/**
 * Computes the Levenshtein distance between two strings.
 *
 * @param {string} a - First string.
 * @param {string} b - Second string.
 * @returns {number} The edit distance between strings `a` and `b`.
 */
function getEditDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return matrix[a.length][b.length];
}

/**
 * Determines whether a query string fuzzy matches a target text string based on length and edit distance thresholds.
 *
 * @param {string} query - Search term to match.
 * @param {string} text - Target string content.
 * @returns {boolean} True if query exact or fuzzy matches within the target text.
 */
function isFuzzyMatch(query, text) {
    if (!query || !text) return false;

    // Always check exact substring first (Fastest)
    if (text.includes(query)) return true;

    // Don't fuzzy match acronyms or tiny words (e.g., "ISR", "Ion") to prevent false positives
    if (query.length < 4) return false;

    // Dynamic typo tolerance: 1 typo for words 4-6 chars, 2 typos for 7+ chars
    const maxTypos = query.length >= 7 ? 2 : 1;

    const textWords = text.split(/[\s\-_,]+/);
    const queryWords = query.split(/[\s\-_,]+/);

    // Ensure EVERY word in the query has a fuzzy match in the target text
    return queryWords.every(qWord => {
        if (qWord.length < 4) return text.includes(qWord);
        const qMax = qWord.length >= 7 ? 2 : 1;

        return textWords.some(tWord => {
            // Quick length check before running expensive distance math
            if (Math.abs(tWord.length - qWord.length) > qMax) return false;
            return getEditDistance(qWord, tWord) <= qMax;
        });
    });
}


/**
 * Safely converts string, array, or null/undefined values into a lowercase string.
 *
 * @param {any} val - Value to convert.
 * @returns {string} Lowercase string representation of input value.
 */
function toSafeString(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(' ').toLowerCase();
    return String(val).toLowerCase();
}


/**
 * Checks whether a given term matches author fields within a dataset.
 *
 * @param {string} term - Search term.
 * @param {Array<Object>} dataset - Collection of data objects containing author metadata.
 * @returns {boolean} True if term matches an author in the dataset.
 */
function isAuthorMatch(term, dataset) {
    if (!dataset || dataset.length === 0) return false;
    const cleanTerm = term.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

    // Guard: Common domain keywords are never authors
    if (SCIENCE_KEYWORDS.has(cleanTerm)) return false;

    return dataset.some(d => {
        const authorStr = toSafeString(d.authors).replace(/[^a-z0-9\s]/g, '');
        if (!authorStr) return false;

        // Enforce exact word boundaries for single-word queries (e.g. "ion" vs "ionis")
        if (!cleanTerm.includes(' ')) {
            const regex = new RegExp(`\\b${cleanTerm}\\b`, 'i');
            if (regex.test(authorStr)) return true;
        } else if (typeof isFuzzyMatch === 'function') {
            if (isFuzzyMatch(cleanTerm, authorStr)) return true;
        } else if (authorStr.includes(cleanTerm)) {
            return true;
        }

        return false;
    });
}

/**
 * Checks whether a search term matches known instrument terms, flags, or instrument fields in a dataset.
 *
 * @param {string} term - Search term or acronym.
 * @param {Array<Object>} dataset - Collection of data objects containing instrument metadata.
 * @returns {boolean} True if term matches an instrument in the dataset.
 */
function isInstrumentMatch(term, dataset) {
    const cleanTerm = term.toLowerCase().trim();

    // Instant match for known instrument acronyms
    if (KNOWN_INSTRUMENT_TERMS.has(cleanTerm)) return true;

    if (!dataset || dataset.length === 0) return false;

    const instrumentSuffixes = ['meter', 'radar', 'imager', 'sensor', 'probe', 'camera', 'lidar', 'spectrometer'];
    const hasSuffix = instrumentSuffixes.some(kw => cleanTerm.includes(kw));

    return dataset.some(d => {
        // Direct flag check (e.g. d.tec === 1 or d.isr === 1)
        const flagMatch = Number(d[cleanTerm] || 0) === 1 || d[cleanTerm] === true;
        if (flagMatch) return true;

        const instString = toSafeString(d.instruments || d.instrument || d.inst || d.tag);
        if (instString.includes(cleanTerm)) return true;
        if (hasSuffix && typeof isFuzzyMatch === 'function' && isFuzzyMatch(cleanTerm, instString)) return true;

        return false;
    });
}

/**
 * Checks whether a search term matches title fields in a dataset.
 *
 * @param {string} term - Search term.
 * @param {Array<Object>} dataset - Collection of data objects containing title metadata.
 * @returns {boolean} True if term matches a title in the dataset.
 */
function isTitleMatch(term, dataset) {
    if (!dataset || dataset.length === 0) return false;
    const cleanTerm = term.toLowerCase().trim();
    return dataset.some(d => {
        const title = toSafeString(d.title);
        if (!title) return false;
        if (title.includes(cleanTerm)) return true;
        if (typeof isFuzzyMatch === 'function' && isFuzzyMatch(cleanTerm, title)) return true;
        return false;
    });
}



/**
 * Handles keydown events on the unified search input, triggering search badge creation on 'Enter'.
 *
 * @param {KeyboardEvent} event - Keyboard event object.
 * @returns {void}
 */
export function handleUnifiedSearchKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (typeof addSearchBadgeFromInput === 'function') {
            addSearchBadgeFromInput();
        }
    }
}


/**
 * Checks if a search term matches any journal, venue, publisher, or publication name in the dataset.
 *
 * @param {string} term - Search query term to evaluate.
 * @param {Array<Object>} dataset - Dataset containing publication and journal fields.
 * @returns {boolean} True if an exact, substring, or fuzzy match is found; false otherwise.
 */
function isJournalMatch(term, dataset) {
    if (!dataset || dataset.length === 0) return false;
    const cleanTerm = term.toLowerCase().trim();
    return dataset.some(d => {
        const journal = toSafeString(d.journal || d.publication || d.venue || d.publisher || d.source);
        if (!journal) return false;
        if (journal.includes(cleanTerm)) return true;
        if (typeof isFuzzyMatch === 'function' && isFuzzyMatch(cleanTerm, journal)) return true;
        return false;
    });
}


/**
 * Classifies a raw query term into a specific filter category (e.g., KEYWORD, INSTRUMENT, JOURNAL, AUTHOR, TITLE, AI_QUERY).
 *
 * @param {string} rawTerm - Raw query term to classify.
 * @returns {Object} Object containing classification category `type`, processed `term`, and tokenized `words` array.
 */
export function classifyQuery(rawTerm) {
    const term = rawTerm.trim();
    const appState = typeof state !== 'undefined' ? state : window.state;
    const dataset = (appState && appState.allData) ? appState.allData : [];

    const words = term.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const lowerTerm = term.toLowerCase();

    // CHECK FOR FORCED OVERRIDE FROM PANEL CLICKS
    if (window.forcedBadgeTypes && window.forcedBadgeTypes.has(term)) {
        return { type: window.forcedBadgeTypes.get(term), term, words };
    }

    // DOMAIN KEYWORD OVERRIDE: Single science terms (e.g. "Ion", "Plasma") are ALWAYS Keywords
    if (wordCount === 1 && SCIENCE_KEYWORDS.has(lowerTerm)) {
        return { type: 'KEYWORD', term, words };
    }

    // INSTRUMENT MATCH: Acronyms & hardware (e.g. "TEC", "ISR", "Magnetometer")
    if (typeof isInstrumentMatch === 'function' && isInstrumentMatch(term, dataset)) {
        return { type: 'INSTRUMENT', term, words };
    }

    //  DEDICATED JOURNAL / PUBLICATION MATCH
    if (isJournalMatch(term, dataset)) {
        return { type: 'JOURNAL', term, words };
    }

    // AUTHOR MATCH: (e.g. "Smith", "John Larson")
    if (typeof isAuthorMatch === 'function' && isAuthorMatch(term, dataset)) {
        return { type: 'AUTHOR', term, words };
    }

    // TITLE MATCH
    if (typeof isTitleMatch === 'function' && isTitleMatch(term, dataset)) {
        return { type: 'TITLE', term, words };
    }

    // AI QUERY: Unmatched multi-word phrases (3+ words) go to FAISS semantic vector search
    if (wordCount >= 3) {
        return { type: 'AI_QUERY', term, words };
    }

    // 7. FALLBACK
    return { type: 'KEYWORD', term, words };
}


/**
 * Extracts raw search term from input, forces state to active, re-renders badges, and triggers search execution.
 *
 * @returns {void}
 */
export function addSearchBadgeFromInput() {
    const input = document.getElementById('unifiedSearch');
    if (!input) return;

    const rawTerm = input.value.trim();
    if (!rawTerm) return;

    // Ensure state sets exist
    if (!state.disabledSearchBadges) state.disabledSearchBadges = new Set();
    if (!state.excludedSearchBadges) state.excludedSearchBadges = new Set();

    // No matter what state it was in, typing it anew forces it to Active (Include)
    state.disabledSearchBadges.delete(rawTerm);
    state.excludedSearchBadges.delete(rawTerm);

    if (!state.activeSearchBadges.has(rawTerm)) {
        state.activeSearchBadges.add(rawTerm);
    }

    renderBadges();
    executeUnifiedSearch();
    input.value = ''; // Clear input after submission
}


/**
 * Cycles a search badge through 3 operational states (Active -> Excluded -> Disabled -> Active), re-rendering UI and re-executing search.
 *
 * @param {string} term - The search badge term to cycle.
 * @returns {void}
 */
export function toggleSearchBadge(term) {
    if (!state.disabledSearchBadges) state.disabledSearchBadges = new Set();
    if (!state.excludedSearchBadges) state.excludedSearchBadges = new Set();

    if (state.activeSearchBadges.has(term)) {
        // Active -> Excluded
        state.activeSearchBadges.delete(term);
        state.excludedSearchBadges.add(term);
    } else if (state.excludedSearchBadges.has(term)) {
        // Excluded -> Disabled
        state.excludedSearchBadges.delete(term);
        state.disabledSearchBadges.add(term);
    } else if (state.disabledSearchBadges.has(term)) {
        // Disabled -> Active
        state.disabledSearchBadges.delete(term);
        state.activeSearchBadges.add(term);
    }

    renderBadges();
    executeUnifiedSearch();
}


/**
 * Re-renders all active, excluded, and disabled search badge elements into the badge DOM container.
 *
 * @returns {void}
 */
function renderBadges() {
    const container = document.getElementById('searchBadgesContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!state.disabledSearchBadges) state.disabledSearchBadges = new Set();
    if (!state.excludedSearchBadges) state.excludedSearchBadges = new Set();

    // Combine all badges for rendering
    const allBadges = new Set([
        ...state.activeSearchBadges,
        ...state.excludedSearchBadges,
        ...state.disabledSearchBadges
    ]);

    allBadges.forEach(term => {
        const classified = classifyQuery(term);
        const category = classified.type;

        const isActive = state.activeSearchBadges.has(term);
        const isExcluded = state.excludedSearchBadges.has(term);
        const isDisabled = state.disabledSearchBadges.has(term);

        // Parent Badge Container
        const badge = document.createElement('div');

        // Apply appropriate CSS classes based on state
        let stateClass = '';
        if (isExcluded) stateClass = 'badge-excluded';
        if (isDisabled) stateClass = 'badge-inactive';

        badge.className = `search-badge badge-${category.toLowerCase()} ${stateClass}`;

        let titleState = 'Filtering by';
        if (isExcluded) titleState = 'Excluding';
        if (isDisabled) titleState = 'Disabled filter';
        badge.title = `${titleState} ${category}: ${term}`;
        badge.style.cursor = 'pointer';

        badge.onclick = () => {
            toggleSearchBadge(term);
        };

        // Category Tag Pill
        const categoryLabel = document.createElement('span');
        categoryLabel.className = 'badge-category-label';
        // Prefix "NOT" if excluded
        categoryLabel.textContent = isExcluded ? `${category.replace('_', ' ')}` : category.replace('_', ' ');

        // Search Term Text
        const termText = document.createElement('span');
        termText.className = 'badge-term-text';
        termText.textContent = term;

        // Remove Button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'badge-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.setAttribute('aria-label', `Remove filter ${term}`);
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeSearchBadge(term);
        };

        badge.appendChild(categoryLabel);
        badge.appendChild(termText);
        badge.appendChild(removeBtn);
        container.appendChild(badge);
    });
}


/**
 * Removes a search badge term completely from active, excluded, and disabled sets, triggering UI and search updates if removed.
 *
 * @param {string} term - The search query term to purge.
 * @returns {void}
 */
export function removeSearchBadge(term) {
    if (!state.disabledSearchBadges) state.disabledSearchBadges = new Set();
    if (!state.excludedSearchBadges) state.excludedSearchBadges = new Set();

    let changed = false;

    if (state.activeSearchBadges.has(term)) { state.activeSearchBadges.delete(term); changed = true; }
    if (state.excludedSearchBadges.has(term)) { state.excludedSearchBadges.delete(term); changed = true; }
    if (state.disabledSearchBadges.has(term)) { state.disabledSearchBadges.delete(term); changed = true; }

    if (window.forcedBadgeTypes) window.forcedBadgeTypes.delete(term);

    if (changed) {
        renderBadges();
        executeUnifiedSearch();
    }
}


/**
 * Consolidates active and excluded query badges into state and text input, triggering backend FAISS/vector search and AI screening queries.
 *
 * @returns {void}
 */
export function executeUnifiedSearch() {
    const activeArray = state.activeSearchBadges ? Array.from(state.activeSearchBadges) : [];
    const excludedArray = state.excludedSearchBadges ? Array.from(state.excludedSearchBadges) : [];

    // Clear search state if no active OR excluded badges remain
    if (activeArray.length === 0 && excludedArray.length === 0) {
        state.flatSearchIds = null;
        state.activeQueryTypes = [];
        if (typeof window.applyGlobalFilters === 'function') window.applyGlobalFilters();
        if (typeof window.draw === 'function') window.draw();
        return;
    }

    // Classify badges and attach an "INCLUDE" or "EXCLUDE" mode flag
    const classifiedActive = activeArray.map(badge => ({ ...classifyQuery(badge), mode: 'INCLUDE' }));
    const classifiedExcluded = excludedArray.map(badge => ({ ...classifyQuery(badge), mode: 'EXCLUDE' }));

    state.activeQueryTypes = [...classifiedActive, ...classifiedExcluded];

    // Combine queries for the text box. Prefix excluded terms with "-"
    const formattedExcluded = excludedArray.map(term => `-${term}`);
    const combinedQuery = [...activeArray, ...formattedExcluded].join(' ');

    const queryInput = document.getElementById('query');
    if (queryInput) queryInput.value = combinedQuery;

    // Trigger vector/FAISS backend search
    if (typeof window.search === 'function') {
        window.search().then(() => {
            const hasAiQuery = classifiedActive.some(b => b.type === 'AI_QUERY');
            if (hasAiQuery && typeof triggerAiScreenQuery === 'function') {
                const aiTerms = classifiedActive.filter(b => b.type === 'AI_QUERY').map(b => b.term).join(' ');
                triggerAiScreenQuery(aiTerms);
            }
        });
    }
}


/**
 * Sends a POST request to the AI query screening endpoint using current visible item IDs and user query string.
 *
 * @param {string} userQuery - Formatted semantic search query.
 * @returns {Promise<void>} Resolves when API query fetch completes.
 */
async function triggerAiScreenQuery(userQuery) {
    const visibleIds = (state.filteredData || []).map(d => d.chunk_id || d.id);
    if (!visibleIds.length) return;

    try {
        const res = await fetch('/api/ai-query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userQuery, valid_ids: visibleIds })
        });
        const data = await res.json();
        if (data.answer) {
            console.log("[AI Query Answer]:", data.answer);
            // Display data.answer in your UI panel/modal if desired
        }
    } catch (err) {
        console.error("AI Query execution error:", err);
    }
}

/**
 * Binds UI click event listeners to toggle export dropdown visibility and handle plot PNG and CSV download actions.
 *
 * @returns {void}
 */
function setupExportDropdown() {
    const exportBtn = document.getElementById('exportDropdownBtn');
    const exportMenu = document.getElementById('exportDropdownMenu');
    const btnPlot = document.getElementById('btnExportPlot');
    const btnCSV = document.getElementById('btnExportCSV');

    if (!exportBtn || !exportMenu) return;

    // Toggle dropdown when clicking the button
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('show');
    });

    // Handle Image/Plot Download
    if (btnPlot) {
        btnPlot.addEventListener('click', (e) => {
            e.stopPropagation();
            exportMenu.classList.remove('show');
            if (typeof window.downloadPlot === 'function') {
                window.downloadPlot();
            } else if (typeof downloadPlot === 'function') {
                downloadPlot();
            }
        });
    }

    // Handle CSV Export
    if (btnCSV) {
        btnCSV.addEventListener('click', (e) => {
            e.stopPropagation();
            exportMenu.classList.remove('show');
            if (typeof window.exportCurrentPlotToCSV === 'function') {
                window.exportCurrentPlotToCSV();
            } else if (typeof exportCurrentPlotToCSV === 'function') {
                exportCurrentPlotToCSV();
            }
        });
    }

    // Close menu when clicking outside anywhere on the document
    document.addEventListener('click', (e) => {
        if (!exportMenu.contains(e.target) && !exportBtn.contains(e.target)) {
            exportMenu.classList.remove('show');
        }
    });
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupExportDropdown);
}
else setupExportDropdown();


/**
 * Switches global state between standard view modes and hierarchy view modes, updating legend and triggering canvas re-renders.
 *
 * @returns {void}
 */
window.toggleHierarchyView = function() {

    // 1. Toggle the state
    if (state.viewMode !== 'hierarchy' && state.viewMode !== 'hNetwork') {
        if (state.viewMode !== 'network')state.viewMode = 'hierarchy';
        else {
            state.viewMode = 'hNetwork';
        }
    }
 updateLegend();
    // Redraw the canvas based on the new state
    import('../canvas/render.js').then(render => {
        if (typeof render.draw === 'function') {
            render.draw();
        }
    });


    if (state.viewMode === 'hierarchy') {
        import('../canvas/hierarchy.js').then(hierarchy => {
            if (typeof hierarchy.drawHierarchy === 'function') {
                hierarchy.drawHierarchy();
            }
        });
    }
};


/**
 * Transitions canvas view mode to scatter plot mode or handles hNetwork transitions to full network graph mode.
 *
 * @returns {Promise<void>} Resolves when mode transitions, cluster network builds, and redraw calls finalize.
 */
export async function triggerScatterMode() {

    // Transitioning from 'hNetwork' to full 'network' view
    if (state.viewMode === 'hNetwork') {
        console.log("Switching from hNetwork to standard Network view...");

        state.previousViewMode = 'hNetwork';
        state.viewMode = 'network';

        // Build and format network nodes for standard network view
        const rawNodes = state.allData || state.nodes || (state.graphData && state.graphData.nodes) || [];

        if (rawNodes.length > 0) {
            const targets = rawNodes.map((node, idx) => ({
                ...node,
                id: String(node.id || node.chunk_id || `node_${idx}`),
                type: node.type || 'entity',
                name: node.name || node.label || String(node.id || `Node ${idx}`),
                description: node.description || ""
            }));

            try {
                if (typeof autoLabelAllClusters === 'function') {
                    await autoLabelAllClusters('keywords', targets);
                } else if (typeof buildKeywordNetwork === 'function') {
                    state.graphData = buildKeywordNetwork(targets);
                }
            } catch (err) {
                console.error("Error generating network data from hNetwork:", err);
            }
        }

        // Set the Network toggle button UI to active state
        const networkBtn = document.getElementById('btnToggleGraph');
        if (networkBtn) {
            networkBtn.style.background = '#1d4ed8'; // Active solid blue
            networkBtn.style.color = '#ffffff';
            const span = networkBtn.querySelector('span');
            if (span) span.innerText = 'Exit Network';
        }

        // Render the network view
        if (typeof updateLegend === 'function') updateLegend();
        if (typeof draw === 'function') requestAnimationFrame(() => draw());
        return;
    }


    // Guard check - already in scatter mode
    if (state.viewMode === 'scatter') {
        return;
    }


    // Standard transition to Scatter view
    console.log("Activating Scatter Mode...");

    state.previousViewMode = state.viewMode;
    state.viewMode = 'scatter';

    // Reset Network Button UI to inactive state
    const networkBtn = document.getElementById('btnToggleGraph');
    if (networkBtn) {
        networkBtn.style.background = '#eff6ff'; // Soft blue
        networkBtn.style.color = '#1d4ed8';
        const span = networkBtn.querySelector('span');
        if (span) span.innerText = 'Network';
    }


    // Redraw scatter map
    if (typeof updateLegend === 'function') updateLegend();
    if (typeof draw === 'function') requestAnimationFrame(() => draw());
}
