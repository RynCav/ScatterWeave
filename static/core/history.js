import { state } from './state.js';
import { draw } from '../canvas/render.js';
import {updateLegend} from "../components/global_legend.js";

export const undoStack = [];

const redoStack = [];
const MAX_HISTORY = 40; // Keeps memory consumption optimized
let isRestoring = false; // Guard flag to prevent re-entrant saves during render cycles

// Set absolute initial state upon load completion
setTimeout(() => {
    if (state && undoStack.length === 0) saveHistoryState();
}, 1000);

// Global Exposure
if (typeof window !== "undefined") {
    window.saveHistoryState = saveHistoryState;
    window.undo = undo;
    window.redo = redo;
}


/**
 * Safely creates a deep clone of a plain object or array using JSON serialization.
 *
 * @param {Object|Array|null} obj - Target object or array to clone.
 * @returns {Object|Array|null} Deep copy of the object, or `null` if serialization fails.
 */
const safeCloneJSON = (obj) => {
    try {
        return obj ? JSON.parse(JSON.stringify(obj)) : null;
    } catch (e) {
        console.error("History clone error:", e);
        return null;
    }
};


/**
 * Captures a deep snapshot of the active application state, including DOM input filter values,
 * data coordinates, state sets, maps, and UI configuration properties.
 *
 * @param {Object} s - Current application state instance.
 * @returns {Object} A deep-cloned snapshot of the current state.
 */
function cloneState(s) {
    return {
        // Active input states from the DOM
        searchKeyword: document.getElementById('search')?.value || "",
        yearStart: document.getElementById('yearStart')?.value || "",
        yearEnd: document.getElementById('yearEnd')?.value || "",

        // Data Arrays (Shallow copy objects to capture point coordinate shifts)
        allData: s.allData ? s.allData.map(d => ({ ...d })) : [],
        filteredData: s.filteredData ? s.filteredData.map(d => ({ ...d })) : [],

        // Coordinate / Layout Modes
        islandsEnabled: !!s.islandsEnabled,
        spiralEnabled: !!s.spiralEnabled,
        originalCoordsSaved: !!s.originalCoordsSaved,

        // Sets (Must be cloned as new Sets)
        hiddenClusters: s.hiddenClusters ? new Set(s.hiddenClusters) : new Set(),
        hiddenMetaClusters: s.hiddenMetaClusters ? new Set(s.hiddenMetaClusters) : new Set(),
        hiddenPaths: s.hiddenPaths ? new Set(s.hiddenPaths) : new Set(),
        hiddenSubClusters: s.hiddenSubClusters ? new Set(s.hiddenSubClusters) : new Set(),
        activeSplits: s.activeSplits ? new Set(s.activeSplits) : new Set(),
        collapsedLegendNodes: s.collapsedLegendNodes ? new Set(s.collapsedLegendNodes) : new Set(),
        hiddenTagSubPaths: s.hiddenTagSubPaths ? new Set(s.hiddenTagSubPaths) : new Set(),
        visibleTags: s.visibleTags ? new Set(s.visibleTags) : new Set(),
        hiddenMetadataTags: s.hiddenMetadataTags ? new Set(s.hiddenMetadataTags) : new Set(),
        hiddenMetadataSections: s.hiddenMetadataSections ? new Set(s.hiddenMetadataSections) : new Set(),
        flatSearchIds: s.flatSearchIds ? new Set(s.flatSearchIds) : null,
        hiddenHierarchyPaths: s.hiddenHierarchyPaths ? new Set(s.hiddenHierarchyPaths) : new Set(),
        tagsToCluster: s.tagsToCluster ? new Set(s.tagsToCluster) : new Set(),
        activeMetadataSplits: s.activeMetadataSplits ? new Set(s.activeMetadataSplits) : new Set(),
        hiddenMetadataSubClusters: s.hiddenMetadataSubClusters ? new Set(s.hiddenMetadataSubClusters) : new Set(),
        lockedRegions: s.lockedRegions ? new Set(s.lockedRegions) : new Set(),
        tickedMetaClustersForBorder: s.tickedMetaClustersForBorder ? new Set(s.tickedMetaClustersForBorder) : new Set(),

        // Maps (Clone node-by-node)
        lockedNodes: s.lockedNodes ? new Map(Array.from(s.lockedNodes, ([k, v]) => [k, { ...v }])) : new Map(),

        // Primitives & Active UI States
        viewMode: s.viewMode || 'scatter',
        globalClusterLabelMode: s.globalClusterLabelMode || 'none',
        selectedMetadataKey: s.selectedMetadataKey || null,
        activeClusteringView: s.activeClusteringView || 'default',
        isSubClustered: !!s.isSubClustered,
        isTargetedClusteringActive: !!s.isTargetedClusteringActive,
        showAnchors: !!s.showAnchors,
        pinModeActive: !!s.pinModeActive,
        trajectorySearchLabelMode: s.trajectorySearchLabelMode || 'none',
        activeBorderTag: s.activeBorderTag || null,

        // Deep Objects & Arrays
        clusterLabels: s.clusterLabels ? safeCloneJSON(s.clusterLabels) : { keywords: {}, summaries: {} },
        clusterNames: s.clusterNames ? safeCloneJSON(s.clusterNames) : {},
        metadataCategoryTags: s.metadataCategoryTags ? safeCloneJSON(s.metadataCategoryTags) : [],
        currentPath: s.currentPath ? safeCloneJSON(s.currentPath) : [],
        clusterCentroids: s.clusterCentroids ? safeCloneJSON(s.clusterCentroids) : {},
        droppedPins: s.droppedPins ? s.droppedPins.map(p => ({ ...p })) : [],
        clusterKeywordNames: s.clusterKeywordNames ? safeCloneJSON(s.clusterKeywordNames) : {},
        metadataSubClusterColors: s.metadataSubClusterColors ? safeCloneJSON(s.metadataSubClusterColors) : {},
        activeSubClusters: s.activeSubClusters ? safeCloneJSON(s.activeSubClusters) : {},
        savedClusterings: s.savedClusterings ? safeCloneJSON(s.savedClusterings) : {},
        colorBordersByMetadata: s.colorBordersByMetadata ? safeCloneJSON(s.colorBordersByMetadata) : [],
        metadataPaperMappings: s.metadataPaperMappings ? safeCloneJSON(s.metadataPaperMappings) : {},
        metadataAnchors: s.metadataAnchors ? safeCloneJSON(s.metadataAnchors) : [],
        currentQueryPoint: s.currentQueryPoint ? { ...s.currentQueryPoint } : null,
        currentGoalPoint: s.currentGoalPoint ? { ...s.currentGoalPoint } : null,
        searchDistances: s.searchDistances ? safeCloneJSON(s.searchDistances) : {}
    };
}


/**
 * Performs a deep functional equality check between two state snapshots to prevent redundant history entries.
 *
 * @param {Object|null} s1 - First state snapshot.
 * @param {Object|null} s2 - Second state snapshot.
 * @returns {boolean} `true` if snapshots are functionally identical, `false` otherwise.
 */
function areStatesEqual(s1, s2) {
    if (!s1 || !s2) return false;

    // Primitive checks
    const primitives = [
        'searchKeyword', 'yearStart', 'yearEnd', 'viewMode', 
        'globalClusterLabelMode', 'selectedMetadataKey', 
        'islandsEnabled', 'spiralEnabled', 'originalCoordsSaved',
        'activeClusteringView', 'isSubClustered', 'isTargetedClusteringActive',
        'showAnchors', 'pinModeActive', 'trajectorySearchLabelMode', 'activeBorderTag'
    ];
    for (const p of primitives) {
        if (s1[p] !== s2[p]) return false;
    }

    // High-speed O(1) coordinate sanity check (First, Middle, and Last Node)
    if (s1.allData && s2.allData) {
        if (s1.allData.length !== s2.allData.length) return false;
        if (s1.allData.length > 0) {
            const indices = [0, Math.floor(s1.allData.length / 2), s1.allData.length - 1];
            for (const idx of indices) {
                if (s1.allData[idx].x !== s2.allData[idx].x || s1.allData[idx].y !== s2.allData[idx].y) {
                    return false;
                }
            }
        }
    }

    // Set structural checks
    const setsEqual = (set1, set2) => {
        if (!set1 || !set2) return set1 === set2;
        if (set1.size !== set2.size) return false;
        for (let item of set1) {
            if (!set2.has(item)) return false;
        }
        return true;
    };

    const setKeys = [
        'hiddenClusters', 'hiddenMetaClusters', 'hiddenPaths', 
        'hiddenSubClusters', 'activeSplits', 'collapsedLegendNodes', 
        'hiddenTagSubPaths', 'visibleTags', 'hiddenMetadataTags', 
        'hiddenMetadataSections', 'hiddenHierarchyPaths', 'tagsToCluster',
        'activeMetadataSplits', 'hiddenMetadataSubClusters', 'lockedRegions',
        'tickedMetaClustersForBorder'
    ];
    for (const key of setKeys) {
        if (!setsEqual(s1[key], s2[key])) return false;
    }
    if (!setsEqual(s1.flatSearchIds, s2.flatSearchIds)) return false;

    // Map checks
    const mapsEqual = (map1, map2) => {
        if (!map1 || !map2) return map1 === map2;
        if (map1.size !== map2.size) return false;
        for (let [key, val] of map1) {
            if (!map2.has(key)) return false;
            if (JSON.stringify(val) !== JSON.stringify(map2.get(key))) return false;
        }
        return true;
    };
    if (!mapsEqual(s1.lockedNodes, s2.lockedNodes)) return false;

    // JSON serialization comparison for complex configurations
    const jsonEqual = (obj1, obj2) => JSON.stringify(obj1) === JSON.stringify(obj2);

    const jsonKeys = [
        'clusterLabels', 'clusterNames', 'metadataCategoryTags', 'currentPath',
        'clusterCentroids', 'droppedPins', 'clusterKeywordNames', 'metadataSubClusterColors',
        'activeSubClusters', 'savedClusterings', 'colorBordersByMetadata', 'metadataPaperMappings',
        'metadataAnchors', 'currentQueryPoint', 'currentGoalPoint', 'searchDistances'
    ];
    for (const key of jsonKeys) {
        if (!jsonEqual(s1[key], s2[key])) return false;
    }

    return true;
}


/**
 * Restores a state snapshot into the global state references, syncs DOM input states,
 * and triggers re-filtering and rendering re-paints.
 *
 * @param {Object} snapshot - Target state snapshot object to apply.
 * @returns {void}
 */
function restoreState(snapshot) {
    if (!snapshot) return;
    isRestoring = true; // Lock saving while UI components re-render

    // Sync input values and layout mode checkboxes back to DOM elements
    const syncCheckbox = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            if (el.type === 'checkbox') el.checked = !!value;
            else el.value = value;
        }
    };
    
    syncCheckbox('search', snapshot.searchKeyword);
    syncCheckbox('yearStart', snapshot.yearStart);
    syncCheckbox('yearEnd', snapshot.yearEnd);
    
    // Automatically flips associated layout toggles visually to match state
    syncCheckbox('islandsEnabled', snapshot.islandsEnabled);
    syncCheckbox('toggleIslands', snapshot.islandsEnabled);
    syncCheckbox('spiralEnabled', snapshot.spiralEnabled);
    syncCheckbox('toggleSpiral', snapshot.spiralEnabled);
    syncCheckbox('pinModeActive', snapshot.pinModeActive);

    // Deep rebuild array instances to capture precise layout coordinate configurations
    state.allData = snapshot.allData ? snapshot.allData.map(d => ({ ...d })) : [];
    state.filteredData = snapshot.filteredData ? snapshot.filteredData.map(d => ({ ...d })) : [];
    
    // Restore layout toggle states
    state.islandsEnabled = snapshot.islandsEnabled;
    state.spiralEnabled = snapshot.spiralEnabled;
    state.originalCoordsSaved = snapshot.originalCoordsSaved;

    // Rebuild Sets
    state.hiddenClusters = new Set(snapshot.hiddenClusters);
    state.hiddenMetaClusters = new Set(snapshot.hiddenMetaClusters);
    state.hiddenPaths = new Set(snapshot.hiddenPaths);
    state.hiddenSubClusters = new Set(snapshot.hiddenSubClusters);
    state.activeSplits = new Set(snapshot.activeSplits);
    state.collapsedLegendNodes = new Set(snapshot.collapsedLegendNodes);
    state.hiddenTagSubPaths = new Set(snapshot.hiddenTagSubPaths);
    state.visibleTags = new Set(snapshot.visibleTags);
    state.hiddenMetadataTags = new Set(snapshot.hiddenMetadataTags);
    state.hiddenMetadataSections = new Set(snapshot.hiddenMetadataSections);
    state.flatSearchIds = snapshot.flatSearchIds ? new Set(snapshot.flatSearchIds) : null;
    state.hiddenHierarchyPaths = new Set(snapshot.hiddenHierarchyPaths);
    state.tagsToCluster = new Set(snapshot.tagsToCluster);
    state.activeMetadataSplits = new Set(snapshot.activeMetadataSplits);
    state.hiddenMetadataSubClusters = new Set(snapshot.hiddenMetadataSubClusters);
    state.lockedRegions = new Set(snapshot.lockedRegions);
    state.tickedMetaClustersForBorder = new Set(snapshot.tickedMetaClustersForBorder);

    // Rebuild Maps
    state.lockedNodes = snapshot.lockedNodes ? new Map(Array.from(snapshot.lockedNodes, ([k, v]) => [k, { ...v }])) : new Map();

    // Re-assign basic UI states
    state.viewMode = snapshot.viewMode || 'scatter';
    state.globalClusterLabelMode = snapshot.globalClusterLabelMode || 'none';
    state.selectedMetadataKey = snapshot.selectedMetadataKey || null;
    state.activeClusteringView = snapshot.activeClusteringView || 'default';
    state.isSubClustered = snapshot.isSubClustered;
    state.isTargetedClusteringActive = snapshot.isTargetedClusteringActive;
    state.showAnchors = snapshot.showAnchors;
    state.pinModeActive = snapshot.pinModeActive;
    state.trajectorySearchLabelMode = snapshot.trajectorySearchLabelMode || 'none';
    state.activeBorderTag = snapshot.activeBorderTag || null;

    // Re-assign structural objects
    const safeRestoreJSON = (obj) => obj ? JSON.parse(JSON.stringify(obj)) : null;

    state.clusterLabels = snapshot.clusterLabels ? safeRestoreJSON(snapshot.clusterLabels) : { keywords: {}, summaries: {} };
    state.clusterNames = snapshot.clusterNames ? safeRestoreJSON(snapshot.clusterNames) : {};
    state.metadataCategoryTags = snapshot.metadataCategoryTags ? safeRestoreJSON(snapshot.metadataCategoryTags) : [];
    state.currentPath = snapshot.currentPath ? safeRestoreJSON(snapshot.currentPath) : [];
    state.clusterCentroids = snapshot.clusterCentroids ? safeRestoreJSON(snapshot.clusterCentroids) : {};
    state.droppedPins = snapshot.droppedPins ? snapshot.droppedPins.map(p => ({ ...p })) : [];
    state.clusterKeywordNames = snapshot.clusterKeywordNames ? safeRestoreJSON(snapshot.clusterKeywordNames) : {};
    state.metadataSubClusterColors = snapshot.metadataSubClusterColors ? safeRestoreJSON(snapshot.metadataSubClusterColors) : {};
    state.activeSubClusters = snapshot.activeSubClusters ? safeRestoreJSON(snapshot.activeSubClusters) : {};
    state.savedClusterings = snapshot.savedClusterings ? safeRestoreJSON(snapshot.savedClusterings) : {};
    state.colorBordersByMetadata = snapshot.colorBordersByMetadata ? safeRestoreJSON(snapshot.colorBordersByMetadata) : [];
    state.metadataPaperMappings = snapshot.metadataPaperMappings ? safeRestoreJSON(snapshot.metadataPaperMappings) : {};
    state.metadataAnchors = snapshot.metadataAnchors ? safeRestoreJSON(snapshot.metadataAnchors) : [];
    state.currentQueryPoint = snapshot.currentQueryPoint ? { ...snapshot.currentQueryPoint } : null;
    state.currentGoalPoint = snapshot.currentGoalPoint ? { ...snapshot.currentGoalPoint } : null;
    state.searchDistances = snapshot.searchDistances ? safeRestoreJSON(snapshot.searchDistances) : {};

    // Execute standard rendering layout pipelines
    import('./data.js')
        .then(d => {
            try {
                if (typeof d.applyGlobalFilters === 'function') d.applyGlobalFilters();
                if (typeof updateLegend === 'function') updateLegend();
                if (typeof draw === 'function') draw();
            } catch (renderError) {
                console.error("UI rendering failed during history restore:", renderError);
            }
        })
        .catch(importError => {
            console.error("Failed to import data module on restore:", importError);
        })
        .finally(() => {
            // Re-entrant lock released after DOM layout computations settle
            // Execute standard rendering layout pipelines sequentially
    (async () => {
        try {
            const d = await import('./data.js');
            if (typeof d.applyGlobalFilters === 'function') d.applyGlobalFilters();
            if (typeof updateLegend === 'function') updateLegend();
            
            // Wait for the browser to physically paint the canvas before releasing the lock
            requestAnimationFrame(() => {
                if (typeof draw === 'function') draw();
                requestAnimationFrame(() => {
                    isRestoring = false; // ✅ Only releases after the frame completes
                });
            });
        } catch (renderError) {
            console.error("UI rendering failed during history restore:", renderError);
            isRestoring = false;
        }
    })();
        });
}


/**
 * Pushes a snapshot of the current state onto the undo stack if it differs from the most recent entry,
 * enforcing stack size limits and clearing the redo stack.
 *
 * @returns {void}
 */
export function saveHistoryState() {
    if (isRestoring) return; // Prevent render loops from poisoning the stack
    
    const newState = cloneState(state);

    // DEDUPLICATION: If this new state is identical to the top of the stack, ignore saving.
    if (undoStack.length > 0) {
        const lastSavedState = undoStack[undoStack.length - 1];
        if (areStatesEqual(newState, lastSavedState)) {
            return; 
        }
    }

    undoStack.push(newState);
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift(); 
    }
    redoStack.length = 0;
}

/**
 * Pushes a snapshot of the current state onto the undo stack if it differs from the most recent entry,
 * enforcing stack size limits and clearing the redo stack.
 *
 * @returns {void}
 */
export function undo() {
    if (undoStack.length <= 1) {
        console.warn("Undo: Reached initial state threshold.");
        return;
    }
    const currentActive = undoStack.pop();
    redoStack.push(currentActive);

    const targetState = undoStack[undoStack.length - 1];
    restoreState(targetState);
       if (typeof window.refreshPanelAfterUndoRedo === 'function') 
        window.refreshPanelAfterUndoRedo();
}


/**
 * Advances the application state to the next snapshot on the redo stack
 * and pushes the current state onto the undo stack.
 *
 * @returns {void}
 */
export function redo() {
    if (redoStack.length === 0) {
        console.warn("Redo: Nothing ahead in history pipeline.");
        return;
    }
    const targetState = redoStack.pop();
    undoStack.push(targetState);
    restoreState(targetState);
    
    if (typeof window.refreshPanelAfterUndoRedo === 'function') 
        window.refreshPanelAfterUndoRedo();
}


// Keyboard listener binding
document.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    let handled = false;

    if (isCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        handled = true;
    } else if (isCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        handled = true;
    }

    if (handled) {
        e.stopImmediatePropagation();
    }
});
