/**
 * Global application state management object.
 * Holds datasets, rendering state, canvas parameters, filtering criteria, and UI tool settings.
 */
export const state = {

    // ==========================================
    // 1. DATASET & ENTITY STATE
    // ==========================================

    /** @type {Array<Object>} Complete dataset of nodes and document objects. */
    allData: [],

    /** @type {Array<Object>} Filtered subset of nodes passing active UI and search filters. */
    filteredData: [],

    /** @type {Object.<string, Array<number>>} Vector embeddings stored off-canvas for computation. */
    savedEmbeddings: {},

    /** @type {Array<string>} Unique list of harvested/loaded scientific or data instruments. */
    instruments: [],

    /** @type {Set<string|number>} Set of instrument identifiers currently hidden from view. */
    hiddenInstruments: new Set(),

    /** @type {Set<number>} Set of database source IDs (`db_sources`) toggled off/hidden. */
    hiddenDatasets: new Set([2]),

    /** @type {Object.<string, Array<Object>>} Dynamic mapping between metadata attributes and paper nodes. */
    metadataPaperMappings: {},

    /** @type {boolean} Toggle to filter out or hide associated chunk nodes from view. */
    hideAssociatedChunks: false,


    // ==========================================
    // 2. CLUSTERING & SUBCLUSTERING STATE
    // ==========================================

    /** @type {string} Active layout/clustering view identifier (e.g., 'default'). */
    activeClusteringView: 'default',

    /** @type {Object.<string, Object>} Named clustering structures and spatial assignments. */
    savedClusterings: {},

    /** @type {{ keywords: Object, summaries: Object }} Cached cluster naming maps by labeling scheme. */
    clusterLabels: { keywords: {}, summaries: {} },

    /** @type {Object.<string|number, string>} Alternative keyword labels mapped to cluster IDs. */
    clusterKeywordNames: {},

    /** @type {string} Scheme used for rendering cluster titles ('none', 'llm', 'tfidf', etc.). */
    globalClusterLabelMode: 'none',

    /** @type {boolean} Flag indicating whether subclustering analysis is currently applied. */
    isSubClustered: false,

    /** @type {Object.<string|number, Array<string>>} Active subcluster hierarchy paths per parent cluster. */
    activeSubClusters: {},

    /** @type {Set<number|string>} Root cluster IDs toggled off/hidden. */
    hiddenClusters: new Set(),

    /** @type {Set<string>} Meta-cluster categories toggled off/hidden. */
    hiddenMetaClusters: new Set(),

    /** @type {Set<string>} Targeted tag keys selected for dedicated re-clustering. */
    tagsToCluster: new Set(),

    /** @type {boolean} Whether targeted re-clustering mode is currently active. */
    isTargetedClusteringActive: false,


    // ==========================================
    // 3. METADATA & TAG MANAGEMENT STATE
    // ==========================================

    /** @type {boolean} Toggle to enable point color assignment based on metadata tags. */
    colorByMetadata: false,

    /** @type {Array<string>} Active metadata tag names used to render point stroke borders. */
    colorBordersByMetadata: [],

    /** @type {string|null} Active metadata tag currently driving point border colors. */
    activeBorderTag: null,

    /** @type {Set<string>} Set of metadata tags explicitly enabled for display. */
    visibleTags: new Set(),

    /** @type {Set<string>} UI metadata tags marked as struck-through or hidden. */
    hiddenMetadataTags: new Set(),

    /** @type {Set<string>} Hidden metadata field names or UI section groups. */
    hiddenMetadataSections: new Set(),

    /** @type {Set<string>} Set of active metadata parameters splitting node groups. */
    activeMetadataSplits: new Set(),

    /** @type {Object|null} Structured taxonomy and grouping configuration for metadata fields. */
    metadataGroups: null,

    /** @type {Array<Object>} Calculated metadata anchor point objects in data space. */
    metadataAnchors: [],

    /** @type {Array<string>} Category tag keys loaded into the metadata browser. */
    metadataCategoryTags: [],

    /** @type {Set<string>} Metadata subclusters explicitly hidden from the plot. */
    hiddenMetadataSubClusters: new Set(),

    /** @type {Object.<string, string>} Custom color mappings for metadata subclusters. */
    metadataSubClusterColors: {},


    // ==========================================
    // 4. SEARCH & FILTER STATE
    // ==========================================

    /** @type {Array<string|number>|null} Flat array of node IDs returned by active search. */
    flatSearchIds: null,

    /** @type {Object.<string|number, number>} Map of distance metrics relative to current search query. */
    searchDistances: {},

    /** @type {Set<string>} Active search tag or badge filters applied to dataset. */
    activeSearchBadges: new Set(),


    // ==========================================
    // 5. PATH, TRAJECTORY & PIN STATE
    // ==========================================

    /** @type {Array<Object>} Sequence of coordinate points forming the active trajectory path. */
    currentPath: [],

    /** @type {boolean} Flag to display spatial trajectory anchor points on the canvas. */
    showAnchors: false,

    /** @type {Array<Object>} User-placed coordinate pins on the plot map. */
    droppedPins: [],

    /** @type {Object|null} Coordinates or node serving as origin point for trajectory search. */
    currentQueryPoint: null,

    /** @type {Object|null} Coordinates or node serving as target goal for trajectory search. */
    currentGoalPoint: null,

    /** @type {string} Labeling mode for search trajectory steps ('none', 'llm', etc.). */
    trajectorySearchLabelMode: 'none',

    /** @type {boolean} Flag indicating whether user pin placement mode is armed. */
    pinModeActive: false,


    // ==========================================
    // 6. VISUAL LAYOUT & ALGORITHMIC STATE
    // ==========================================

    /** @type {boolean} Enable visual island separation algorithm for clusters. */
    islandsEnabled: false,

    /** @type {boolean} Enable spiral layout transformation on canvas nodes. */
    spiralEnabled: false,

    /** @type {boolean} Reduce node visual density using sparsification filtering. */
    sparsifyMode: false,

    /** @type {boolean} Flag indicating baseline spatial coordinates have been cached. */
    originalCoordsSaved: false,

    /** @type {boolean} Toggle topological/relational connections between canvas items. */
    linked: false,

    /** @type {string} Structural visualization mode ('hierarchy', 'flat', etc.). */
    viewMode: 'hierarchy',


    // ==========================================
    // 7. CANVAS & RENDER ENGINE STATE
    // ==========================================

    /** @type {HTMLCanvasElement|null} Main HTML canvas element instance. */
    canvas: null,

    /** @type {CanvasRenderingContext2D|null} 2D context for drawing operations. */
    ctx: null,

    /** @type {Object|null} Node object currently located under mouse cursor hover. */
    hoveredNode: null,

    /** @type {boolean} Enable color gradient fills for point rendering. */
    useGradientColors: false,

    /** @type {boolean} Toggle density heatmap layer on top of scatter plot. */
    heatmapModeActive: false,

    /** @type {Object} Display and presentation settings for exported and interactive plots. */
    plotSettings: {
        title: "",
        showBorder: false,
        showGridlines: false,
        xAxisName: "",
        yAxisName: "",
        xScale: 1,
        yScale: 1,
        showPin: true
    },


    // ==========================================
    // 8. INTERACTION, PAN, ZOOM & SELECTION STATE
    // ==========================================

    /** @type {{ k: number, x: number, y: number }} Pan and zoom scale/translation parameters. */
    transform: { k: 1, x: 0, y: 0 },

    /** @type {boolean} Indicates whether a canvas drag interaction is in progress. */
    isDragging: false,

    /** @type {boolean} Flag set during drag movement to suppress click events. */
    hasDragged: false,

    /** @type {{ x: number, y: number }} Initial viewport coordinates at start of drag gesture. */
    dragStart: { x: 0, y: 0 },

    /** @type {boolean} Flag indicating active lasso/box selection tool. */
    selectionModeActive: false,

    /** @type {Object|null} Bounding box dimensions for active drag-selection tool. */
    selectionBox: null,

    /** @type {Array<Object>} Currently highlighted/selected node instances. */
    selectedNodes: [],


    // ==========================================
    // 9. HISTORY & UNDO/REDO STATE
    // ==========================================

    /** @type {Array<Object>} Stack of application state snapshots for undo/redo actions. */
    history: [],

    /** @type {number} Current position pointer within the state history stack. */
    historyIndex: -1

};
