import { state } from '../core/state.js';
import { getClusterColor, getMetaClusterColor, getSubClusterColor, getNodeColor,
    getTagRegionColor, getTagSubClusterColor, hexToRgb, applyAlphaToColor } from '../clusters/color.js';
import * as PIXI from 'https://esm.sh/pixi.js@7.3.2';
import { drawHierarchy, initHierarchy } from './hierarchy.js';
import { buildKeywordNetwork } from '../clusters/labels.js';

// Module-level boundary variables
let minX = Infinity, maxX = -Infinity;
let minY = Infinity, maxY = -Infinity;
let lastDataRef = null;
let activeLodIndex = 0;
//canvas state
let pixiApp = null;
let pixiGridGraphics = null;
let bgCanvas = null;
let bgCtx = null;


let AI_HOVER_MODE = 'none';
let ENABLE_AI_EDGE_SUMMARIES = true;


// Shader & Geometry references for GPU processing
let lodMeshes = [];
let lodData = [];
let pointShader = null;


let LOCAL_NEIGHBORS_PER_NODE = 1;
let MAX_SPATIAL_DISTANCE = 100;


const BASE_POINT_SIZE    =25.0;   // Baseline point diameter in pixels
const MIN_POINT_SIZE     = 15.0;   // Minimum point size clamp limit
const MAX_POINT_SIZE     = 120.0; // Maximum point size clamp limit
const HOVER_SCALE_BOOST  = 1;   // Scale multiplier applied to hovered point
const HITBOX_PADDING_PX  = 12.0;  // Extra hit area radius in pixels
const HOVER_RING_GAP_PX  = 0.05;   // Pixel gap between node edge and hover ring


export let manualLodOverride = 'auto';
const renderStateCache = {
    hoveredId: null,
    selectedStr: '',
    hiddenMeta: '',
    hiddenClusters: '',
    hiddenPaths: '',
    viewMode: '',
    isHeatmap: false,
    colorHash: ''
};


/**
 * Converts a JavaScript number to a GLSL float string representation (e.g., 8 -> "8.0").
 * @param {number} num - The number to convert.
 * @returns {string} Clean GLSL float string.
 */
const toGLSLFloat = (num) => Number.isInteger(num) ? `${num}.0` : `${num}`;

const vertexSrc = `
    precision highp float;
    
    attribute vec2 aVertexPosition;
    attribute vec3 aColor;
    attribute float aAlpha;
    attribute float aScale;
    
    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;
    uniform vec2 uCameraOffset;
    uniform float uCameraZoom;
    uniform float uCanvasWidth;
    uniform float uCanvasHeight;
    uniform float uMinX;
    uniform float uMaxX;
    uniform float uMinY;
    uniform float uMaxY;
    uniform float uXScale;
    uniform float uYScale;
    
    uniform vec2 uHoverPos;
    uniform float uHoverActive;
    uniform float uHoverRadius;
    
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        float baseX = ((aVertexPosition.x - uMinX) / (uMaxX - uMinX)) * uCanvasWidth;
        float baseY = ((aVertexPosition.y - uMinY) / (uMaxY - uMinY)) * uCanvasHeight;
        
        float finalX = (baseX * uCameraZoom * uXScale) + uCameraOffset.x;
        float finalY = (baseY * uCameraZoom * uYScale) + uCameraOffset.y;
        
        // Controlled point size clamping parameterized via JS constants
        float zoomFactor = pow(uCameraZoom, 0.85); 
        float ptSize = clamp(${toGLSLFloat(BASE_POINT_SIZE)} * aScale * zoomFactor, ${toGLSLFloat(MIN_POINT_SIZE)}, ${toGLSLFloat(MAX_POINT_SIZE)});
        
        float pad = ptSize * 0.5;
        if (finalX < -pad || finalX > uCanvasWidth + pad || finalY < -pad || finalY > uCanvasHeight + pad) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); 
            return;
        }
        
        float currentAlpha = aAlpha;
        float currentScale = aScale;
        
        if (uHoverActive > 0.5) {
            float dist = distance(aVertexPosition, uHoverPos);
            if (dist < uHoverRadius) {
                currentScale *= ${toGLSLFloat(HOVER_SCALE_BOOST)};
                currentAlpha = 1.0;
            } else {
                currentAlpha *= 0.35; 
            }
        }
        
        vColor = aColor / 255.0; 
        vAlpha = currentAlpha;
        
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(finalX, finalY, 1.0)).xy, 0.0, 1.0);
        gl_PointSize = ptSize;
    }
`;

const fragmentSrc = `
    precision highp float;
    varying vec3 vColor;
    varying float vAlpha;
    
    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        
        if (dist > 0.5) discard;
        
        float alpha = vAlpha * smoothstep(0.5, 0.42, dist);
        vec3 finalColor = mix(vColor * 0.75, vColor, smoothstep(0.48, 0.38, dist));
        
        gl_FragColor = vec4(finalColor * alpha, alpha);
    }
`;


/**
 * Main render function for the visualization canvas.
 * Initializes WebGL/Pixi.js, builds spatial Level-of-Detail (LOD) hierarchies,
 * handles mouse interaction/selection, updates GPU buffers, and triggers layer passes
 * (grid, centroids, graph overlays, tooltips, and search trajectories).
 */
export function draw() {
    if (!state.ctx || !state.canvas) return;

    // Helper to calculate scale factor consistently across initial build and buffer updates
    const getNodeScaleFactor = (node) => {
        const baseRadius = state.heatmapModeActive ? 7 : 2.5;
        const baseScaleFactor = baseRadius / 10.0;
        const aggMult = node.isAggregate ? Math.max(1.0, Math.pow(node.count, 0.33)) : 1.0;
        let scale = baseScaleFactor * aggMult;

        const isSelected = state.selectedNodes && state.selectedNodes.some(n =>
            (n.rawRef || n) === (node.rawRef || node) || (n.id != null && n.id === node.id)
        );
        if (isSelected) scale *= 3.0;

        return scale;
    };

    // Helper to calculate exact GPU-rendered point diameter in screen pixels
    const getRenderedPointSize = (node, isHovered = false) => {
        const zoomFactor = Math.pow(state.transform.k || 1, 0.85);
        let aScale = getNodeScaleFactor(node);
        if (isHovered) aScale *= HOVER_SCALE_BOOST;

        const rawPtSize = BASE_POINT_SIZE * aScale * zoomFactor;
        return Math.max(MIN_POINT_SIZE, Math.min(rawPtSize, MAX_POINT_SIZE));
    };

    // Helper to resolve the correct color based on the current active view mode
    const resolveNodeColor = (d) => {
        if (state.colorByMetadata && d.tag) {
            try {
                if (typeof getTagSubClusterColor === 'function') {
                    const tagIdx = (state.tagOrder || []).indexOf(d.tag);
                    const safeIdx = tagIdx > -1 ? tagIdx : 0;
                    const cleanPath = d.tag_sub_path ? String(d.tag_sub_path).replace(/^Cluster\s+/i, '').trim().replace(/\./g, '-') : null;
                    return getTagSubClusterColor(d.tag, safeIdx, cleanPath) || "#9ca3af";
                }
            } catch (e) {
                return "#9ca3af";
            }
        }
        return typeof getNodeColor === 'function' ? getNodeColor(d) : "#9ca3af";
    };

    if (state.canvas && !state.canvas._networkClickAttached) {
        state.canvas._networkClickAttached = true;
        let mouseDownPos = null;

        state.canvas.addEventListener('mousedown', (e) => {
            mouseDownPos = { x: e.clientX, y: e.clientY };
        });

        state.canvas.addEventListener('click', (e) => {
            if (mouseDownPos) {
                const distMoved = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
                if (distMoved > 5) return;
            }

            if (state.viewMode === 'chord' || state.viewMode === 'hierarchy') return;

            const rect = state.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let clickedNode = null;
            let minDist = Infinity;

            const activeData = (lodData && lodData.length > activeLodIndex)
                ? lodData[activeLodIndex]
                : (state.filteredData || []);

            for (let i = 0; i < activeData.length; i++) {
                const d = activeData[i];
                if (d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) continue;

                const ptSize = getRenderedPointSize(d, state.hoveredNode === d);
                const nodeRenderedRadius = ptSize / 2.0;
                const hitThreshold = nodeRenderedRadius + HITBOX_PADDING_PX;

                const dist = Math.hypot(mouseX - mapX(d.x), mouseY - mapY(d.y));
                if (dist < hitThreshold && dist < minDist) {
                    minDist = dist;
                    clickedNode = d;
                }
            }

            if (!state.selectedNodes) state.selectedNodes = [];


        if (clickedNode) {
                // Ensure array exists
                if (!state.selectedNodes) state.selectedNodes = [];

                // Allow shift-click to append or toggle regardless of prior array length
                if (e.shiftKey) {
                    const existingIdx = state.selectedNodes.findIndex(n =>
                        (n.id != null && n.id === clickedNode.id) ||
                        n === clickedNode
                    );

                    if (existingIdx >= 0) {
                        state.selectedNodes.splice(existingIdx, 1);
                    } else {
                        state.selectedNodes.push(clickedNode);
                    }
                } else {
                    state.selectedNodes = [clickedNode];
                }

                state.selectedNode = state.selectedNodes.length > 0 ? state.selectedNodes[state.selectedNodes.length - 1] : null;
                updateNetworkShortestPath();

                import('../components/ui.js').then(ui => {
                    if (state.selectedNodes.length > 1 && typeof ui.displaySelectedPapersSummary === 'function') {
                        ui.displaySelectedPapersSummary();
                    } else if (state.selectedNodes.length === 1 && typeof ui.updatePanel === 'function') {
                        ui.updatePanel(state.selectedNodes[0]);
                    } else if (typeof ui.updatePanel === 'function') {
                        ui.updatePanel(null);
                    }
                }).catch(() => {});
            } else {


            }
            draw();
        });
    }

    if (!pixiApp) {
        const baseZIndex = state.canvas.style.zIndex ? parseInt(state.canvas.style.zIndex) : 0;

        bgCanvas = document.createElement('canvas');
        bgCanvas.style.position = 'absolute';
        bgCanvas.style.left = state.canvas.offsetLeft + 'px';
        bgCanvas.style.top = state.canvas.offsetTop + 'px';
        bgCanvas.style.width = state.canvas.clientWidth + 'px';
        bgCanvas.style.height = state.canvas.clientHeight + 'px';
        bgCanvas.style.zIndex = baseZIndex - 2;
        bgCanvas.style.pointerEvents = 'none';
        state.canvas.parentElement.insertBefore(bgCanvas, state.canvas);

        state.bgCanvas = bgCanvas;
        bgCtx = bgCanvas.getContext('2d');
        state.bgCtx = bgCtx;

        const webglCanvas = document.createElement('canvas');
        webglCanvas.style.position = 'absolute';
        webglCanvas.style.left = state.canvas.offsetLeft + 'px';
        webglCanvas.style.top = state.canvas.offsetTop + 'px';
        webglCanvas.style.width = state.canvas.clientWidth + 'px';
        webglCanvas.style.height = state.canvas.clientHeight + 'px';
        webglCanvas.style.zIndex = baseZIndex - 1;
        webglCanvas.style.pointerEvents = 'none';

        state.canvas.parentElement.insertBefore(webglCanvas, state.canvas);
        state.canvas.style.backgroundColor = 'transparent';

        pixiApp = new PIXI.Application({
            view: webglCanvas,
            width: state.canvas.clientWidth,
            height: state.canvas.clientHeight,
            backgroundAlpha: 0,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            preserveDrawingBuffer: true
        });

        pixiGridGraphics = new PIXI.Graphics();
        pixiApp.stage.addChild(pixiGridGraphics);

        pointShader = PIXI.Shader.from(vertexSrc, fragmentSrc, {
            uCameraOffset: [0, 0],
            uCameraZoom: 1.0,
            uCanvasWidth: state.canvas.width,
            uCanvasHeight: state.canvas.height,
            uMinX: 0, uMaxX: 1, uMinY: 0, uMaxY: 1,
            uXScale: 1, uYScale: 1,
            uHoverPos: [-9999, -9999],
            uHoverActive: 0.0,
            uHoverRadius: 10.0
        });
    }

    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    if (state.bgCtx) {
        if (state.bgCanvas.width !== state.canvas.width || state.bgCanvas.height !== state.canvas.height) {
            state.bgCanvas.width = state.canvas.width;
            state.bgCanvas.height = state.canvas.height;
        }
        state.bgCtx.clearRect(0, 0, state.bgCanvas.width, state.bgCanvas.height);
    }

    if (!state.filteredData || state.filteredData.length === 0) {
        pixiGridGraphics.clear();
        lodMeshes.forEach(m => m.visible = false);
        return;
    }

    if (state.viewMode === 'hierarchy') {
        initHierarchy();
        if (pixiGridGraphics) pixiGridGraphics.clear();
        lodMeshes.forEach(m => m.visible = false);
        if (state.bgCtx) state.bgCtx.clearRect(0, 0, state.bgCanvas.width, state.bgCanvas.height);
        drawHierarchy();
        return;
    }



    if (state.filteredData !== lastDataRef) {
        minX = Infinity; maxX = -Infinity;
        minY = Infinity; maxY = -Infinity;

        state.filteredData.forEach(d => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y < minY) minY = d.y;
            if (d.y > maxY) maxY = d.y;
        });

        const paddingX = (maxX - minX) * 0.05 || 1;
        const paddingY = (maxY - minY) * 0.05 || 1;
        minX -= paddingX; maxX += paddingX;
        minY -= paddingY; maxY += paddingY;

        lodMeshes.forEach(m => { pixiApp.stage.removeChild(m); m.destroy(); });
        lodMeshes = [];
        lodData = [];

        const totalEmbeddings = state.filteredData.length || 1;
        const tier0 = state.filteredData;
        const tiers = [{ id: 0, data: tier0 }];

        if (totalEmbeddings > 150) {
            const maxDim = Math.max((maxX - minX), (maxY - minY)) || 1;
            const densityFactor = Math.max(1.0, Math.log10(totalEmbeddings) / 4.0);

            const r1 = maxDim * (0.0025 / densityFactor);
            const r2 = maxDim * (0.0080 / densityFactor);
            const r3 = maxDim * (0.0200 / densityFactor);
            const r4 = maxDim * (0.0450 / densityFactor);
            const r5 = maxDim * (0.0900 / densityFactor);
            const r6 = maxDim * (0.1800 / densityFactor); // New layer 6
            const r7 = maxDim * (0.3600 / densityFactor); // New layer 7

            // Helper to ensure LOD nodes only merge within their respective region or tag
            const generateSegmentedClusters = (data, radius) => {
                const groups = {};
                data.forEach(d => {
                    const key = state.colorByMetadata
                        ? (d.tag || 'unknown_tag')
                        : (d.cluster !== undefined ? String(d.cluster) : 'unknown_cluster');

                    if (!groups[key]) groups[key] = [];
                    groups[key].push(d);
                });

                let clusteredResult = [];
                for (const key in groups) {
                    // Cluster isolated groups so regions/tags never merge together
                    clusteredResult = clusteredResult.concat(generateOrganicClusters(groups[key], radius));
                }
                return clusteredResult;
            };

    const tier1 = generateSegmentedClusters(tier0, r1);
            const tier2 = generateSegmentedClusters(tier1, r2);
            const tier3 = generateSegmentedClusters(tier2, r3);
            const tier4 = generateSegmentedClusters(tier3, r4);
            const tier5 = generateSegmentedClusters(tier4, r5);
            const tier6 = generateSegmentedClusters(tier5, r6); // New layer 6
            const tier7 = generateSegmentedClusters(tier6, r7); // New layer 7

            tiers.push(
                { id: 1, data: tier1 },
                { id: 2, data: tier2 },
                { id: 3, data: tier3 },
                { id: 4, data: tier4 },
                { id: 5, data: tier5 },
                { id: 6, data: tier6 }, // New layer 6
                { id: 7, data: tier7 }  // New layer 7
            );
        }

        tiers.forEach(tier => {
            const count = tier.data.length;
            const positions = new Float32Array(count * 2);
            const colors = new Float32Array(count * 3);
            const alphas = new Float32Array(count);
            const scales = new Float32Array(count);

            tier.data.forEach((d, index) => {
                if (d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) {
                    positions[index * 2] = -9999;
                    positions[index * 2 + 1] = -9999;
                    alphas[index] = 0;
                } else {
                    positions[index * 2] = d.x;
                    positions[index * 2 + 1] = d.y;
                    alphas[index] = state.heatmapModeActive ? 0.15 : 1.0;
                }

                scales[index] = getNodeScaleFactor(d);

                let finalHex = resolveNodeColor(d);
                const rgb = hexToRgb(finalHex);
                colors[index * 3] = rgb[0];
                colors[index * 3 + 1] = rgb[1];
                colors[index * 3 + 2] = rgb[2];
            });

            const geo = new PIXI.Geometry()
                .addAttribute('aVertexPosition', positions, 2)
                .addAttribute('aColor', colors, 3)
                .addAttribute('aAlpha', alphas, 1)
                .addAttribute('aScale', scales, 1);

            const mesh = new PIXI.Mesh(geo, pointShader, PIXI.State.for2d(), PIXI.DRAW_MODES.POINTS);
            mesh.visible = false;
            pixiApp.stage.addChild(mesh);

            lodMeshes.push(mesh);
            lodData.push(tier.data);
        });

        lastDataRef = state.filteredData;
        renderStateCache.dataRef = null;
    }

    if (pixiApp.renderer.width !== state.canvas.clientWidth || pixiApp.renderer.height !== state.canvas.clientHeight) {
        pixiApp.renderer.resize(state.canvas.clientWidth, state.canvas.clientHeight);
    }

    const screenMinX = invertMapX(0);
    const screenMaxX = invertMapX(state.canvas.width);
    const screenMinY = invertMapY(0);
    const screenMaxY = invertMapY(state.canvas.height);

    let visibleNodes = 0;
    if (lodData.length > 0) {
        const baseTier = lodData[0];
        for (let i = 0; i < baseTier.length; i++) {
            const d = baseTier[i];
            if (d.x >= screenMinX && d.x <= screenMaxX && d.y >= screenMinY && d.y <= screenMaxY) {
                visibleNodes++;
            }
        }
    }

    // Replace the existing activeLodIndex logic in draw()[cite: 1]:
    const maxLodTier = lodData.length - 1;
    activeLodIndex = 0;

    if (maxLodTier > 0) {
        if (manualLodOverride === 'auto') {
            // Existing automatic logic based on zoom and visible nodes[cite: 1]
            if (visibleNodes < 200) {
                activeLodIndex = 0;
            } else {
                if (state.transform.k < 0.125) activeLodIndex = 7;
                else if (state.transform.k < 0.25) activeLodIndex = 6;
                else if (state.transform.k < 0.5) activeLodIndex = 5;
                else if (state.transform.k < 1.5) activeLodIndex = 4;
                else if (state.transform.k < 4.0) activeLodIndex = 3;
                else if (state.transform.k < 10.0) activeLodIndex = 2;
                else if (state.transform.k < 20.0) activeLodIndex = 1;
                else activeLodIndex = 0;
            }
        } else {
            // Apply the user's manual selection from the widget
            activeLodIndex = parseInt(manualLodOverride, 10);
        }

        // Ensure the index doesn't exceed the available LOD tiers[cite: 1]
        activeLodIndex = Math.min(activeLodIndex, maxLodTier);
    }

    lodMeshes.forEach((mesh, idx) => {
        mesh.visible = (idx === activeLodIndex);
    });

    if (!state.isDragging && typeof state.mouseX === "number" && typeof state.mouseY === "number") {
        let minDist = Infinity;
        state.hoveredNode = null;

        const activeTier = lodData[activeLodIndex];

        for (let i = 0; i < activeTier.length; i++) {
            const d = activeTier[i];
            if (d.x < screenMinX || d.x > screenMaxX || d.y < screenMinY || d.y > screenMaxY) continue;
            if (d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) continue;

            const ptSize = getRenderedPointSize(d, false);
            const nodeRenderedRadius = ptSize / 2.0;
            const hitThreshold = nodeRenderedRadius + HITBOX_PADDING_PX;

            const dist = Math.hypot(state.mouseX - mapX(d.x), state.mouseY - mapY(d.y));
            if (dist < hitThreshold && dist < minDist) {
                minDist = dist;
                state.hoveredNode = d;
            }
        }
    }

    pointShader.uniforms.uCameraOffset = [state.transform.x, state.transform.y];
    pointShader.uniforms.uCameraZoom = state.transform.k;
    pointShader.uniforms.uCanvasWidth = state.canvas.width;
    pointShader.uniforms.uCanvasHeight = state.canvas.height;
    pointShader.uniforms.uMinX = minX;
    pointShader.uniforms.uMaxX = maxX;
    pointShader.uniforms.uMinY = minY;
    pointShader.uniforms.uMaxY = maxY;
    pointShader.uniforms.uHoverActive = state.hoveredNode ? 1.0 : 0.0;
    pointShader.uniforms.uHoverPos = state.hoveredNode ? [state.hoveredNode.x, state.hoveredNode.y] : [-9999, -9999];
    pointShader.uniforms.uHoverRadius = (maxX - minX) * 0.005 * (1.0 / state.transform.k);

    const currentSelectedStr = (state.selectedNodes || []).map(n => n.id || n.chunk_id).join(',');
    const currentHiddenMeta = state.hiddenMetaClusters ? Array.from(state.hiddenMetaClusters).sort().join(',') : '';
    const currentHiddenClusters = state.hiddenClusters ? Array.from(state.hiddenClusters).sort().join(',') : '';
    const currentHiddenPaths = state.hiddenPaths ? Array.from(state.hiddenPaths).sort().join(',') : '';

    let currentColorHash = '';
    if (state.filteredData.length > 0) {
        for(let i=0; i<Math.min(5, state.filteredData.length); i++){
            try { currentColorHash += resolveNodeColor(state.filteredData[i]); } catch(e){}
        }
    }

    let needsBufferUpdate = false;

    if (
        renderStateCache.dataRef !== state.filteredData ||
        currentSelectedStr !== renderStateCache.selectedStr ||
        currentHiddenMeta !== renderStateCache.hiddenMeta ||
        currentHiddenClusters !== renderStateCache.hiddenClusters ||
        currentHiddenPaths !== renderStateCache.hiddenPaths ||
        currentColorHash !== renderStateCache.colorHash ||
        state.viewMode !== renderStateCache.viewMode ||
        !!state.heatmapModeActive !== renderStateCache.isHeatmap ||
        !!state.colorByMetadata !== renderStateCache.colorByMetadata
    ) {
        needsBufferUpdate = true;
        renderStateCache.dataRef = state.filteredData;
        renderStateCache.selectedStr = currentSelectedStr;
        renderStateCache.hiddenMeta = currentHiddenMeta;
        renderStateCache.hiddenClusters = currentHiddenClusters;
        renderStateCache.hiddenPaths = currentHiddenPaths;
        renderStateCache.colorHash = currentColorHash;
        renderStateCache.viewMode = state.viewMode;
        renderStateCache.isHeatmap = !!state.heatmapModeActive;
        renderStateCache.colorByMetadata = !!state.colorByMetadata;
    }

    if (needsBufferUpdate) {
        lodData.forEach((tierData, tierIdx) => {
            const mesh = lodMeshes[tierIdx];
            const alphasBuf = mesh.geometry.getBuffer('aAlpha');
            const scalesBuf = mesh.geometry.getBuffer('aScale');
            const colorsBuf = mesh.geometry.getBuffer('aColor');

            tierData.forEach((d, i) => {
                let isHidden = false;

                const mcValue = d.meta_cluster_name ?? d.meta_cluster ?? d.metaCluster;
                if (mcValue && state.hiddenMetaClusters && state.hiddenMetaClusters.has(mcValue)) isHidden = true;
                if (!isHidden && state.hiddenClusters && (state.hiddenClusters.has(d.cluster) || state.hiddenClusters.has(String(d.cluster)))) isHidden = true;

                if (isHidden) {
                    alphasBuf.data[i] = 0.0;
                    return;
                }

                let finalHex = resolveNodeColor(d);
                const rgb = hexToRgb(finalHex);
                colorsBuf.data[i * 3] = rgb[0];
                colorsBuf.data[i * 3 + 1] = rgb[1];
                colorsBuf.data[i * 3 + 2] = rgb[2];

                let currentScaleFactor = getNodeScaleFactor(d);
                let nodeAlpha = state.heatmapModeActive ? 0.15 : 1.0;

                if (state.selectedNodes && state.selectedNodes.length > 0) {
                    const isTarget = state.selectedNodes.some(n =>
                        (n.rawRef || n) === (d.rawRef || d) || (n.id != null && n.id === d.id)
                    );
                    if (!isTarget) nodeAlpha = 0.1;
                }

                alphasBuf.data[i] = nodeAlpha;
                scalesBuf.data[i] = currentScaleFactor;
            });

            alphasBuf.update();
            scalesBuf.update();
            colorsBuf.update();
        });
    }

    pixiGridGraphics.clear();

    const rawStep = (screenMaxX - screenMinX) / 20;
    const logStep = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const gridStep = logStep * (rawStep / logStep < 2 ? 1 : rawStep / logStep < 5 ? 2 : 5);

    const startGridX = Math.floor(screenMinX / gridStep) * gridStep;
    const endGridX = Math.ceil(screenMaxX / gridStep) * gridStep;
    const startGridY = Math.floor(screenMinY / gridStep) * gridStep;
    const endGridY = Math.ceil(screenMaxY / gridStep) * gridStep;

    if (state.viewMode !== 'chord' && state.plotSettings
        && state.plotSettings.showGridLines && state.viewMode !== 'hierarchy') {
        pixiGridGraphics.lineStyle(1, 0xe5e7eb, 0.35);

        for (let xVal = startGridX; xVal <= endGridX; xVal += gridStep) {
            const sx = mapX(xVal);
            pixiGridGraphics.moveTo(sx, 0);
            pixiGridGraphics.lineTo(sx, state.canvas.height);
        }

        for (let yVal = startGridY; yVal <= endGridY; yVal += gridStep) {
            const sy = mapY(yVal);
            pixiGridGraphics.moveTo(0, sy);
            pixiGridGraphics.lineTo(state.canvas.width, sy);
        }
    }

    if (pixiApp && pixiApp.renderer) {
        pixiApp.renderer.render(pixiApp.stage);
    }

    if (state.bgCtx && state.ctx && state.viewMode === 'network') {
        drawGraphOverlayOnScatter(state.bgCtx, state.ctx, mapX, mapY);
    }
    drawClusterCentroids(state, mapX, mapY, getClusterColor);
    drawHoverTooltip(state, mapX, mapY, getRenderedPointSize);

    const axisConfig = {
        mapX: mapX,
        mapY: mapY,
        startGridX: startGridX,
        endGridX: endGridX,
        startGridY: startGridY,
        endGridY: endGridY,
        gridStep: gridStep,
        drawOutlinedText: drawOutlinedText
    };
    if (state.viewMode !== 'chord' && state.viewMode !== 'hierarchy') drawGridAndAxes(state, axisConfig);



    drawUserPins(state, mapX, mapY);

    // INJECT THE TRAJECTORY CALL HERE
    // Pass activeLodIndex to ensure hover highlights snap to the correct zoomed clusters
    if (state.viewMode !== 'chord' && state.viewMode !== 'hierarchy') {
        drawSearchTrajectory(state, state.ctx, mapX, mapY, activeLodIndex);
    }
}


/**
 * Draws outlined text on the 2D canvas context for enhanced visibility over dark or multi-colored backgrounds.
 * @param {string} text - The text string to render.
 * @param {number} x - The screen X coordinate.
 * @param {number} y - The screen Y coordinate.
 * @param {string} font - CSS font specification string.
 * @param {string} [fillStyle="#000000"] - Text fill color.
 * @param {string} [strokeStyle="rgba(255, 255, 255, 0.8)"] - Text stroke/outline color.
 */
function drawOutlinedText(text, x, y, font, fillStyle = "#000000", strokeStyle = "rgba(255, 255, 255, 0.8)") {
    state.ctx.font = font;
    state.ctx.lineJoin = "round";
    state.ctx.miterLimit = 2;
    state.ctx.strokeStyle = strokeStyle;
    state.ctx.lineWidth = 2.5;
    state.ctx.strokeText(text, x, y);
    state.ctx.fillStyle = fillStyle;
    state.ctx.fillText(text, x, y);
}


/**
 * Renders spatial grid lines, axis tick marks, axis titles, and bounding borders on the canvas context.
 * @param {Object} state - The global state object containing plot settings and filtered data.
 * @param {Object} config - Axis configuration object containing coordinate mapping functions, bounds, and step sizes.
 */
export function drawGridAndAxes(state, config) {
    //Guard clause: Exit immediately if not in the correct view mode
    if (state.viewMode === 'chord' || state.viewMode === 'hierarchy') {
        return;
    }

    //Destructure the required external dependencies and functions
    const {
        mapX,
        mapY,
        startGridX,
        endGridX,
        startGridY,
        endGridY,
        gridStep,
        drawOutlinedText
    } = config;

    //Calculate data bounds
    let layoutMinX = Infinity, layoutMaxX = -Infinity;
    let layoutMinY = Infinity, layoutMaxY = -Infinity;

    state.filteredData.forEach(d => {
        if (d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) return;
        if (d.x < layoutMinX) layoutMinX = d.x;
        if (d.x > layoutMaxX) layoutMaxX = d.x;
        if (d.y < layoutMinY) layoutMinY = d.y;
        if (d.y > layoutMaxY) layoutMaxY = d.y;
    });

    if (layoutMinX !== Infinity && layoutMaxX !== -Infinity) {
        const padX = (layoutMaxX - layoutMinX) * 0.05 || 1;
        const padY = (layoutMaxY - layoutMinY) * 0.05 || 1;
        layoutMinX -= padX;
        layoutMaxX += padX;
        layoutMinY -= padY;
        layoutMaxY += padY;
    }

    const hasDataBounds = (layoutMinX !== Infinity && layoutMaxX !== -Infinity);
    const hasBorder = state.plotSettings && state.plotSettings.showBorder && hasDataBounds;

    let boxMinX = 0, boxMaxX = state.canvas.width;
    let boxMinY = 0, boxMaxY = state.canvas.height;

    //Draw bounding box if enabled
    if (hasBorder) {
        boxMinX = Math.min(mapX(layoutMinX), mapX(layoutMaxX));
        boxMaxX = Math.max(mapX(layoutMinX), mapX(layoutMaxX));
        boxMinY = Math.min(mapY(layoutMinY), mapY(layoutMaxY));
        boxMaxY = Math.max(mapY(layoutMinY), mapY(layoutMaxY));

        state.ctx.save();
        state.ctx.strokeStyle = "#4b5563";
        state.ctx.lineWidth = 1.5;
        state.ctx.strokeRect(boxMinX, boxMinY, boxMaxX - boxMinX, boxMaxY - boxMinY);
        state.ctx.restore();
    }

    //Draw grid lines
    if (state.plotSettings && state.plotSettings.showGridLines) {
        state.ctx.save();
        state.ctx.fillStyle = "#111827";
        state.ctx.strokeStyle = "#4b5563";
        state.ctx.lineWidth = 1;
        state.ctx.font = "12px 'Times New Roman', Times, serif";

        // X-Axis Grid
        state.ctx.textAlign = "center";
        state.ctx.textBaseline = "top";
        for (let xVal = startGridX; xVal <= endGridX; xVal += gridStep) {
            const sx = mapX(xVal);
            if (sx >= boxMinX && sx <= boxMaxX) {
                if (hasBorder) {
                    state.ctx.beginPath();
                    state.ctx.moveTo(sx, boxMaxY);
                    state.ctx.lineTo(sx, boxMaxY + 6);
                    state.ctx.stroke();
                }
                state.ctx.fillText(xVal.toFixed(1), sx, hasBorder ? boxMaxY + 10 : state.canvas.height - 18);
            }
        }

        // Y-Axis Grid
        state.ctx.textAlign = "right";
        state.ctx.textBaseline = "middle";
        for (let yVal = startGridY; yVal <= endGridY; yVal += gridStep) {
            const sy = mapY(yVal);
            if (sy >= boxMinY && sy <= boxMaxY) {
                if (hasBorder) {
                    state.ctx.beginPath();
                    state.ctx.moveTo(boxMinX, sy);
                    state.ctx.lineTo(boxMinX - 6, sy);
                    state.ctx.stroke();
                }
                state.ctx.fillText(yVal.toFixed(1), hasBorder ? boxMinX - 10 : 28, sy);
            }
        }
        state.ctx.restore();
    }

    //Draw Title and Axis Labels
    if (state.plotSettings) {
        let titleX = state.canvas.width / 2;
        let titleY = 30;
        let xAxisX = state.canvas.width / 2;
        let xAxisY = state.canvas.height - 15;
        let yAxisX = 25;
        let yAxisY = state.canvas.height / 2;

        let titleAlign = "top";
        let xAxisAlign = "bottom";
        let yAxisAlign = "middle";

        if (hasBorder) {
            titleX = boxMinX + (boxMaxX - boxMinX) / 2;
            titleY = boxMinY - 8;
            titleAlign = "bottom";

            const xOffset = state.plotSettings.showGridLines ? 40 : 20;
            xAxisX = boxMinX + (boxMaxX - boxMinX) / 2;
            xAxisY = boxMaxY + xOffset;
            xAxisAlign = "top";

            const yOffset = state.plotSettings.showGridLines ? 45 : 20;
            yAxisX = boxMinX - yOffset;
            yAxisY = boxMinY + (boxMaxY - boxMinY) / 2;
            yAxisAlign = "bottom";
        }

        if (state.plotSettings.title) {
            state.ctx.textAlign = "center";
            state.ctx.textBaseline = titleAlign;
            drawOutlinedText(state.plotSettings.title, titleX, titleY, "22px 'Times New Roman', Times, serif", "#000000");
        }

        if (state.plotSettings.xAxisName) {
            state.ctx.textAlign = "center";
            state.ctx.textBaseline = xAxisAlign;
            drawOutlinedText(state.plotSettings.xAxisName, xAxisX, xAxisY, "italic 18px 'Times New Roman', Times, serif", "#000000");
        }

        if (state.plotSettings.yAxisName) {
            state.ctx.save();
            state.ctx.translate(yAxisX, yAxisY);
            state.ctx.rotate(-Math.PI / 2);
            state.ctx.textAlign = "center";
            state.ctx.textBaseline = yAxisAlign;
            drawOutlinedText(state.plotSettings.yAxisName, 0, 0, "italic 18px 'Times New Roman', Times, serif", "#000000");
            state.ctx.restore();
        }
    }
}


/**
 * Calculates spatial arithmetic centroids (X/Y coordinate averages) for root clusters
 * and sub-clusters based on `state.allData`, populating `state.clusterCentroids` and `state.subClusterCentroids`.
 */
export function rebuildClusterCentroids() {
    state.clusterCentroids = {};
    state.subClusterCentroids = {};

    if (!state.allData || state.allData.length === 0) return;

    state.allData.forEach(paper => {
        if (paper.cluster === undefined || paper.cluster === null) return;

        //Accumulate Root Clusters
        if (!state.clusterCentroids[paper.cluster]) {
            state.clusterCentroids[paper.cluster] = {
                xSum: 0, ySum: 0, count: 0,
                color: paper.color // Cache root color
            };
        }
        state.clusterCentroids[paper.cluster].xSum += paper.x;
        state.clusterCentroids[paper.cluster].ySum += paper.y;
        state.clusterCentroids[paper.cluster].count += 1;

        //Accumulate Sub-Clusters
        if (paper.sub_path !== undefined && paper.sub_path !== null) {
            const subKey = `${paper.cluster}-${paper.sub_path}`;
            if (!state.subClusterCentroids[subKey]) {
                state.subClusterCentroids[subKey] = {
                    xSum: 0, ySum: 0, count: 0,
                    color: paper.color // Cache exact sub-cluster color from the data
                };
            }
            state.subClusterCentroids[subKey].xSum += paper.x;
            state.subClusterCentroids[subKey].ySum += paper.y;
            state.subClusterCentroids[subKey].count += 1;
        }
    });

    //Average Root Centroids
    Object.keys(state.clusterCentroids).forEach(cId => {
        const group = state.clusterCentroids[cId];
        if (group.count > 0) {
            state.clusterCentroids[cId] = {
                x: group.xSum / group.count,
                y: group.ySum / group.count,
                color: group.color
            };
        }
    });

    //Average Sub-Cluster Centroids
    Object.keys(state.subClusterCentroids).forEach(subKey => {
        const group = state.subClusterCentroids[subKey];
        if (group.count > 0) {
            state.subClusterCentroids[subKey] = {
                x: group.xSum / group.count,
                y: group.ySum / group.count,
                color: group.color
            };
        }
    });
}


/**
 * Computes or retrieves cached graph network overlay connections, adjacency maps,
 * and edge relationship tags for scatter plot rendering under active LOD and spatial limits.
 * @returns {Object|null} Cache object containing resolved edges, node connections, and adjacency maps.
 */
export function ensureScatterOverlayCache() {
    if (!state) return null;
    if (!state.graphData) state.graphData = {};

    const activeData = Array.isArray(state.filteredData) && state.filteredData.length > 0
        ? state.filteredData
        : (Array.isArray(state.allData) ? state.allData : []);

    let allEdges = state.graphData.edges || state.graphData.links || [];

    if (allEdges.length === 0 && typeof buildKeywordNetwork === 'function') {
        if (state.graphData._nlpEdges) {
            allEdges = state.graphData._nlpEdges;
        } else if (activeData.length > 0) {
            try {
                const nlpData = buildKeywordNetwork(activeData);
                allEdges = nlpData.links || [];
                state.graphData._nlpEdges = allEdges;
            } catch (e) {
                console.warn("Failed to build keyword network:", e);
            }
        }
    }

    const inputElem = document.getElementById("customKeywordInput");
    const QUERY_SENTENCE = inputElem ? inputElem.value.trim() : "";
    const queryCacheKey = QUERY_SENTENCE.toLowerCase();

// Capture the current dynamic limits
    const currentMaxConns = typeof LOCAL_NEIGHBORS_PER_NODE !== 'undefined' ? LOCAL_NEIGHBORS_PER_NODE : 1;
    const currentMaxDist = typeof MAX_SPATIAL_DISTANCE !== 'undefined' ? MAX_SPATIAL_DISTANCE : 100;

    const cache = state.graphData._scatterOverlayCache;
    const isCacheValid = cache &&
        cache.nodeDegreeMap &&
        cache.adjacencyMap &&
        cache.graphData === state.graphData &&
        cache.allData === state.allData &&
        cache.filteredData === state.filteredData &&
        cache.filteredCount === (state.filteredData ? state.filteredData.length : -1) &&
        cache.edgeCount === allEdges.length &&
        cache.queryCacheKey === queryCacheKey &&
        cache.activeLodIndex === activeLodIndex &&
        cache.maxConns === currentMaxConns &&
        cache.maxDist === currentMaxDist; // Forces rebuild if distance/connections change

    if (isCacheValid) return cache;


    const cleanTag = (str) => {
        if (!str) return '';
        return String(str).trim().replace(/^(kw|keyword|topic|rel|chunk|doc|paper|id)[_-]?/gi, '').trim();
    };

    const STOP_WORDS = new Set([
        "the", "and", "for", "with", "that", "this", "from", "are", "have",
        "not", "but", "what", "where", "when", "why", "how", "all", "any",
        "both", "each", "few", "more", "most", "other", "some", "such",
        "nor", "too", "very", "can", "will", "just", "about", "into", "over"
    ]);

    const queryTokens = QUERY_SENTENCE
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 3 && !STOP_WORDS.has(word));

    const matchesQuery = (str) => {
        if (!str) return false;
        if (!queryTokens.length) return true;
        const cleanStr = cleanTag(str).toLowerCase();
        return queryTokens.some(token => cleanStr.includes(token) || token.includes(cleanStr));
    };

    const getId = (val) => {
        if (val == null) return undefined;
        if (typeof val === 'object') {
            const raw = val.node_id ?? val.id ?? val.chunk_id ?? val.paper_id ??
                        val.source_id ?? val.target_id ?? val.name ?? val.title ?? val.label;
            return raw != null ? String(raw).trim().toLowerCase() : undefined;
        }
        return String(val).trim().toLowerCase();
    };

    const getVariations = (rawId) => {
        if (rawId == null) return [];
        const str = String(rawId).trim().toLowerCase();
        if (!str) return [];
        const stripped = cleanTag(str);
        return [str, stripped, `chunk_${stripped}`, `doc_${stripped}`, `paper_${stripped}`, `embedding_${stripped}`];
    };

    // Helper: Validates if two nodes belong to the exact same region/tag
    const canConnect = (nodeA, nodeB) => {
        if (!nodeA || !nodeB) return false;
        if (state.colorByMetadata) {
            const tagA = nodeA.tag || 'unknown_tag';
            const tagB = nodeB.tag || 'unknown_tag';
            return tagA === tagB;
        } else {
            const clusterA = nodeA.cluster !== undefined ? String(nodeA.cluster) : 'unknown_cluster';
            const clusterB = nodeB.cluster !== undefined ? String(nodeB.cluster) : 'unknown_cluster';
            return clusterA === clusterB;
        }
    };

    // --- LOD AWARENESS SETUP ---
    const baseData = (lodData && lodData.length > 0) ? lodData[0] : activeData;
    const currentLodData = (lodData && lodData.length > activeLodIndex) ? lodData[activeLodIndex] : activeData;

    const getActiveLodNode = (baseNode) => {
        let curr = baseNode;
        for (let i = 0; i < activeLodIndex; i++) {
            if (curr._lod_next) curr = curr._lod_next;
            else break;
        }
        return curr;
    };

    const baseCoordMap = new Map();
    baseData.forEach((d, index) => {
        if (!d || d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) return;
        const primaryId = d.id ?? d.chunk_id ?? d.paper_id ?? `target-${index}`;
        const rawKeys = [primaryId, d.title, d.type, `target-${index}`];
        rawKeys.forEach(k => {
            getVariations(k).forEach(varKey => {
                if (varKey && !baseCoordMap.has(varKey)) baseCoordMap.set(varKey, d);
            });
        });
    });

    const activeCoordMap = new Map();
    currentLodData.forEach((d, index) => {
        if (!d || d.x == null || d.y == null || isNaN(d.x) || isNaN(d.y)) return;
        const primaryId = d.id ?? d.chunk_id ?? d.paper_id ?? `target-${index}`;
        const entry = {
            id: getId(primaryId),
            rawRef: d,
            get x() { return (this.rawRef && !isNaN(this.rawRef.x)) ? this.rawRef.x : d.x; },
            get y() { return (this.rawRef && !isNaN(this.rawRef.y)) ? this.rawRef.y : d.y; },
            hasEdge: false
        };
        activeCoordMap.set(d, entry);
    });

    const directEdgeMap = new Map();
    const edgeMetaMap = new Map();
    const keywordToNodesMap = new Map();

    allEdges.forEach(edge => {
        const srcId = getId(edge.source ?? edge.from ?? edge.u ?? edge.source_id ?? edge.sourceId);
        const tgtId = getId(edge.target ?? edge.to ?? edge.v ?? edge.target_id ?? edge.targetId);
        if (!srcId || !tgtId || srcId === tgtId) return;

        const baseSrc = baseCoordMap.get(srcId);
        const baseTgt = baseCoordMap.get(tgtId);

        if (baseSrc && baseTgt) {
            // Strictly enforce boundary logic: no cross-region/cross-tag connections
            if (!canConnect(baseSrc, baseTgt)) return;

            const activeSrc = getActiveLodNode(baseSrc);
            const activeTgt = getActiveLodNode(baseTgt);

            if (activeSrc === activeTgt) return;

            const srcNodeEntry = activeCoordMap.get(activeSrc);
            const tgtNodeEntry = activeCoordMap.get(activeTgt);

            if (srcNodeEntry && tgtNodeEntry) {
                const relLabel = edge.rel_type || edge.label || edge.type || edge.keyword || edge.topic || "connected";
                if (matchesQuery(relLabel)) {
                    const uId = srcNodeEntry.id;
                    const vId = tgtNodeEntry.id;
                    if (uId === vId) return;

                    const pairKey = uId < vId ? `${uId}||${vId}` : `${vId}||${uId}`;
                    if (!directEdgeMap.has(pairKey)) {
                        directEdgeMap.set(pairKey, new Set());
                        edgeMetaMap.set(pairKey, relLabel);
                    }
                    directEdgeMap.get(pairKey).add(relLabel);

                    if(!edgeMetaMap.has(pairKey + "_src")) {
                        edgeMetaMap.set(pairKey + "_src", srcNodeEntry);
                        edgeMetaMap.set(pairKey + "_tgt", tgtNodeEntry);
                    }
                }
            }
        } else if (baseSrc && !baseTgt) {
            if (!keywordToNodesMap.has(tgtId)) keywordToNodesMap.set(tgtId, new Set());
            keywordToNodesMap.get(tgtId).add(baseSrc);
        } else if (!baseSrc && baseTgt) {
            if (!keywordToNodesMap.has(srcId)) keywordToNodesMap.set(srcId, new Set());
            keywordToNodesMap.get(srcId).add(baseTgt);
        }
    });

    let controlledKeywords = Array.from(keywordToNodesMap.entries())
        .filter(([key]) => matchesQuery(key));

    if (!queryTokens.length) {
        controlledKeywords = controlledKeywords
            .sort((a, b) => b[1].size - a[1].size)
            .slice(0, 20);
    }

    controlledKeywords.forEach(([keyword, baseNodeSet]) => {
        const baseNodes = Array.from(baseNodeSet);
        const activeNodesSet = new Set();
        baseNodes.forEach(bn => {
            const an = getActiveLodNode(bn);
            if (an) activeNodesSet.add(an);
        });
        const activeNodes = Array.from(activeNodesSet);

        for (let i = 0; i < activeNodes.length; i++) {
            const uActive = activeNodes[i];
            const uNode = activeCoordMap.get(uActive);
            if (!uNode) continue;

            const peers = [];
            for (let j = 0; j < activeNodes.length; j++) {
                if (i === j) continue;
                const vActive = activeNodes[j];
                const vNode = activeCoordMap.get(vActive);
                if (!vNode) continue;

                // Strictly enforce boundary logic for spatially inferred local peers
                if (!canConnect(uNode.rawRef, vNode.rawRef)) continue;

                const dist = Math.hypot(uNode.x - vNode.x, uNode.y - vNode.y);
                if (dist > MAX_SPATIAL_DISTANCE) continue;

                peers.push({ node: vNode, dist });
            }

            peers.sort((a, b) => a.dist - b.dist);
            const localPeers = peers.slice(0, LOCAL_NEIGHBORS_PER_NODE);

            for (let k = 0; k < localPeers.length; k++) {
                const vNode = localPeers[k].node;
                const uId = uNode.id;
                const vId = vNode.id;
                if (uId === vId) continue;

                const pairKey = uId < vId ? `${uId}||${vId}` : `${vId}||${uId}`;
                if (!directEdgeMap.has(pairKey)) directEdgeMap.set(pairKey, new Set());
                directEdgeMap.get(pairKey).add(keyword);

                if(!edgeMetaMap.has(pairKey + "_src")) {
                    edgeMetaMap.set(pairKey + "_src", uNode);
                    edgeMetaMap.set(pairKey + "_tgt", vNode);
                }
            }
        }
    });

    const resolvedEdges = [];
    const allConnectedNodesSet = new Set();
    const adjacencyMap = new Map();

    const addAdjacency = (raw1, raw2) => {
        if (!raw1 || !raw2 || raw1 === raw2) return;
        if (!adjacencyMap.has(raw1)) adjacencyMap.set(raw1, new Set());
        if (!adjacencyMap.has(raw2)) adjacencyMap.set(raw2, new Set());
        adjacencyMap.get(raw1).add(raw2);
        adjacencyMap.get(raw2).add(raw1);
    };

    directEdgeMap.forEach((keywordSet, key) => {
        const src = edgeMetaMap.get(key + "_src");
        const tgt = edgeMetaMap.get(key + "_tgt");

        if (src && tgt) {
            src.hasEdge = true;
            tgt.hasEdge = true;

            const rawKeywords = Array.from(keywordSet);
            const matchedKeywords = Array.from(new Set(
                rawKeywords.map(cleanTag).filter(Boolean)
            ));

            const displayTags = [...matchedKeywords];

            if (displayTags.length < 2) {
                const relMeta = edgeMetaMap.get(key);
                const rawTarget = tgt.rawRef || {};
                const rawSource = src.rawRef || {};

                const realFallback =
                    (relMeta && relMeta !== displayTags[0] ? relMeta : null) ||
                    rawTarget.cluster_name || rawTarget.type ||
                    rawSource.cluster_name || rawSource.type;

                if (realFallback && typeof realFallback === 'string') {
                    const cleanFallback = cleanTag(realFallback);
                    if (cleanFallback && !displayTags.includes(cleanFallback)) {
                        displayTags.push(cleanFallback);
                    }
                }
            }

            const finalDisplayTags = displayTags
                .filter(tag => tag.toLowerCase() !== 'all documents')
                .slice(0, 4);

            resolvedEdges.push({
                src,
                tgt,
                keywords: matchedKeywords,
                displayLabel: finalDisplayTags.join(' • '),
                matchCount: matchedKeywords.length,
                connectionWeight: Math.min(1.0 + (matchedKeywords.length - 1) * 0.6, 2.5)
            });

            allConnectedNodesSet.add(src);
            allConnectedNodesSet.add(tgt);

            if (src.rawRef && tgt.rawRef) {
                addAdjacency(src.rawRef, tgt.rawRef);
            }
        }
    });

  const nodeDegreeMap = new Map();
    state.graphData._scatterOverlayCache = {
        graphData: state.graphData,
        allData: state.allData,
        filteredData: state.filteredData,
        filteredCount: state.filteredData ? state.filteredData.length : -1,
        edgeCount: allEdges.length,
        queryCacheKey,
        activeLodIndex,
        maxConns: currentMaxConns, // Store in cache for validation
        maxDist: currentMaxDist,   // Store in cache for validation
        resolvedEdges,
        allConnectedNodes: Array.from(allConnectedNodesSet),
        nodeDegreeMap,
        adjacencyMap
    };

    return state.graphData._scatterOverlayCache;
}


/**
 * Renders graph overlay lines, active node relationship highlights, optional AI edge summaries,
 * and dynamic multi-tag badges over the scatter plot.
 * @param {CanvasRenderingContext2D} lineCtx - canvas context for drawing connecting lines.
 * @param {CanvasRenderingContext2D} badgeCtx - canvas context for drawing overlay labels and badges.
 * @param {Function} mapX - Mapping function from data X to canvas screen X coordinate.
 * @param {Function} mapY - Mapping function from data Y to canvas screen Y coordinate.
 */
export function drawGraphOverlayOnScatter(lineCtx, badgeCtx, mapX, mapY) {
    // Backwards compatibility safeguard
    if (typeof badgeCtx === 'function') {
        mapY = mapX;
        mapX = badgeCtx;
        badgeCtx = lineCtx;
    }

    if (!state || !state.graphData || !lineCtx || !badgeCtx || !lineCtx.canvas) return;

    // ALWAYS ensure the cache is built BEFORE checking if edges exist
    ensureScatterOverlayCache();

    const cache = state.graphData._scatterOverlayCache;
    if (!cache || !cache.resolvedEdges || !cache.resolvedEdges.length) return;

    const { resolvedEdges, allConnectedNodes } = cache;
    const canvasW = lineCtx.canvas.width;
    const canvasH = lineCtx.canvas.height;

    state.graphData._frameId = (state.graphData._frameId || 0) + 1;
    const currentFrame = state.graphData._frameId;

    const isOnCanvas = (x, y) => x >= -50 && x <= canvasW + 50 && y >= -50 && y <= canvasH + 50;

    let hoveredNode = state._hoveredGraphNode || null;

    if (!state.isDragging && typeof state.mouseX === "number" && typeof state.mouseY === "number") {
        let minDistance = Infinity;
        let detectedNode = null;

        for (let i = 0; i < allConnectedNodes.length; i++) {
            const node = allConnectedNodes[i];
            const sx = mapX(node.x);
            const sy = mapY(node.y);

            if (isNaN(sx) || isNaN(sy) || !isOnCanvas(sx, sy)) continue;

            const dist = Math.hypot(state.mouseX - sx, state.mouseY - sy);
            if (dist <= 12 && dist < minDistance) {
                minDistance = dist;
                detectedNode = node;
            }
        }
        hoveredNode = detectedNode;
        state._hoveredGraphNode = detectedNode;
    }

    const hasExplicitSelection = (state.selectedNodes && state.selectedNodes.length > 0) || state.selectedNode;
    const targetNodes = hasExplicitSelection
        ? (state.selectedNodes || [state.selectedNode])
        : (state._hoveredGraphNode || state.hoveredNode ? [state._hoveredGraphNode || state.hoveredNode] : []);

    const targetRaws = new Set(targetNodes.map(n => n ? (n.rawRef || n) : null).filter(Boolean));

    lineCtx.save();

    const passiveEdges = [];
    const highlightedEdges = [];

    for (let i = 0; i < resolvedEdges.length; i++) {
        const item = resolvedEdges[i];

        const x1 = mapX(item.src.x);
        const y1 = mapY(item.src.y);
        const x2 = mapX(item.tgt.x);
        const y2 = mapY(item.tgt.y);

        if (!isOnCanvas(x1, y1) && !isOnCanvas(x2, y2)) continue;

        const isConnectedToHover = targetRaws.size > 0 && (
            targetRaws.has(item.src) || targetRaws.has(item.tgt) ||
            targetRaws.has(item.src.rawRef) || targetRaws.has(item.tgt.rawRef)
        );

        const edgeObj = {
            x1, y1, x2, y2,
            displayLabel: item.displayLabel,
            matchCount: item.matchCount,
            connectionWeight: item.connectionWeight,
            srcRaw: item.src.rawRef,
            tgtRaw: item.tgt.rawRef,
            cacheItem: item // Inject original item reference to attach API cache state
        };

        if (isConnectedToHover) {
            highlightedEdges.push(edgeObj);
        } else {
            passiveEdges.push(edgeObj);
        }
    }

    const applyEdgeStyle = (ctxTarget, e, alpha = 1.0) => {
        let c1 = "#9ca3af";
        let c2 = "#9ca3af";

        try {
            if (state.colorByMetadata) {
                const getTagColor = (node) => {
                    if (!node || !node.tag) return "#9ca3af";
                    const tagIdx = state.tagOrder ? state.tagOrder.indexOf(node.tag) : 0;
                    const safeIdx = Math.max(0, tagIdx);

                    if (typeof window.getTagRegionColor === 'function') {
                        return window.getTagRegionColor(node.tag, safeIdx) || "#9ca3af";
                    } else if (typeof getTagRegionColor === 'function') {
                        return getTagRegionColor(node.tag, safeIdx) || "#9ca3af";
                    }
                    return "#9ca3af";
                };
                c1 = getTagColor(e.srcRaw);
                c2 = getTagColor(e.tgtRaw);
            } else {
                if (e.srcRaw) c1 = getNodeColor(e.srcRaw);
                if (e.tgtRaw) c2 = getNodeColor(e.tgtRaw);
            }
        } catch (err) {
            console.warn("Error applying edge style colors:", err);
        }

        const color1 = typeof applyAlphaToColor === 'function' ? applyAlphaToColor(c1, alpha) : c1;
        const color2 = typeof applyAlphaToColor === 'function' ? applyAlphaToColor(c2, alpha) : c2;

        if (c1 === c2) {
            ctxTarget.strokeStyle = color1;
        } else {
            const grad = ctxTarget.createLinearGradient(e.x1, e.y1, e.x2, e.y2);
            grad.addColorStop(0, color1);
            grad.addColorStop(1, color2);
            ctxTarget.strokeStyle = grad;
        }
    };

    //Passive Network
    for (let i = 0; i < passiveEdges.length; i++) {
        const e = passiveEdges[i];
        lineCtx.lineWidth = 0.8 * e.connectionWeight;

        let lineAlpha = Math.min(0.35 * e.connectionWeight, 0.70);
        if (targetRaws.size > 0) {
            lineAlpha = hasExplicitSelection ? 0.15 : 0.30;
        }

        lineCtx.beginPath();
        lineCtx.moveTo(e.x1, e.y1);
        lineCtx.lineTo(e.x2, e.y2);
        applyEdgeStyle(lineCtx, e, lineAlpha);
        lineCtx.stroke();
    }

   //Active Highlighted Connections
    if (highlightedEdges.length > 0) {
        for (let i = 0; i < highlightedEdges.length; i++) {
            const e = highlightedEdges[i];
            lineCtx.lineWidth = 2 + (e.matchCount * 0.1);

            lineCtx.beginPath();
            lineCtx.moveTo(e.x1, e.y1);
            lineCtx.lineTo(e.x2, e.y2);
            applyEdgeStyle(lineCtx, e, 1.0);
            lineCtx.stroke();
        }
    }

    // AI Edge Summaries Interception
    if (ENABLE_AI_EDGE_SUMMARIES && highlightedEdges.length > 0) {
        for (let i = 0; i < highlightedEdges.length; i++) {
            const e = highlightedEdges[i];
            const cache = e.cacheItem;

            if (!cache._cachedSummary && !cache._isFetchingSummary) {
                cache._isFetchingSummary = true;

                // Extract IDs from both connected nodes
                const targetIds = [
                    e.srcRaw?.chunk_id || e.srcRaw?.id,
                    e.tgtRaw?.chunk_id || e.tgtRaw?.id
                ].filter(Boolean);

                const payload = {
                    mode: 'summary',
                    clusters: { "edge_summary": targetIds }
                };

                fetch('/api/labels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                .then(r => {
                    if (!r.ok) console.error(`[Edge Summary] HTTP Error: ${r.status}`);
                    return r.ok ? r.json() : null;
                })
                .then(labels => {
                    if (labels && labels["edge_summary"]) {
                        console.log(`[Edge Summary] Success: "${labels["edge_summary"]}"`);
                        cache._cachedSummary = labels["edge_summary"];
                    } else {
                        cache._cachedSummary = e.displayLabel; // Fallback to raw keywords
                    }
                })
                .catch(err => {
                    console.error("[Edge Summary] Fetch failed:", err);
                    cache._cachedSummary = e.displayLabel;
                })
                .finally(() => {
                    cache._isFetchingSummary = false;
                    if (typeof draw === "function") draw();
                });
            }

            // Animate label while fetching, or apply the resolved cached label
            if (cache._isFetchingSummary) {
                const dots = ".".repeat(Math.floor(Date.now() / 600) % 4);
                e.displayLabel = `Summarizing connection${dots}`;

                // Force continuous redraws to animate the ellipsis
                if (typeof draw === "function" && !cache._loadingInterval) {
                    cache._loadingInterval = setInterval(() => {
                        if (!cache._isFetchingSummary) {
                            clearInterval(cache._loadingInterval);
                            cache._loadingInterval = null;
                        } else {
                            draw();
                        }
                    }, 600);
                }
            } else {
                e.displayLabel = cache._cachedSummary || e.displayLabel;
            }
        }
    }


    //Cluster-Styled Multi-Tag Badge Layout
    badgeCtx.save();
    if (highlightedEdges.length > 0) {
        badgeCtx.font = "bold 11px Inter, system-ui, -apple-system, sans-serif";
        badgeCtx.textAlign = "center";
        badgeCtx.textBaseline = "middle";
        const badgeBoxes = [];

        for (let i = 0; i < highlightedEdges.length; i++) {
            const e = highlightedEdges[i];
            if (!e.displayLabel) continue;

            const midX = (e.x1 + e.x2) / 2;
            const midY = (e.y1 + e.y2) / 2 - 14;
            if (!isOnCanvas(midX, midY)) continue;

            const textWidth = badgeCtx.measureText(e.displayLabel).width;
            const boxWidth = textWidth + 20;
            const boxHeight = 22;

            badgeBoxes.push({
                edge: e, anchorX: midX, anchorY: midY,
                x: midX - boxWidth / 2, y: midY - boxHeight / 2,
                w: boxWidth, h: boxHeight, label: e.displayLabel
            });
        }

        const MARGIN = 6;
        for (let iter = 0; iter < 12; iter++) {
            let moved = false;
            for (let a = 0; a < badgeBoxes.length; a++) {
                for (let b = a + 1; b < badgeBoxes.length; b++) {
                    const b1 = badgeBoxes[a];
                    const b2 = badgeBoxes[b];
                    if (
                        b1.x < b2.x + b2.w + MARGIN && b1.x + b1.w + MARGIN > b2.x &&
                        b1.y < b2.y + b2.h + MARGIN && b1.y + b1.h + MARGIN > b2.y
                    ) {
                        moved = true;
                        const overlapY = (Math.min(b1.y + b1.h, b2.y + b2.h) - Math.max(b1.y, b2.y)) + MARGIN;
                        if (b1.y <= b2.y) { b1.y -= overlapY / 2; b2.y += overlapY / 2; }
                        else { b1.y += overlapY / 2; b2.y -= overlapY / 2; }
                    }
                }
            }
            if (!moved) break;
        }

        for (let i = 0; i < badgeBoxes.length; i++) {
            const b = badgeBoxes[i];
            b.x = Math.max(8, Math.min(canvasW - b.w - 8, b.x));
            b.y = Math.max(8, Math.min(canvasH - b.h - 8, b.y));
            const badgeCenterX = b.x + b.w / 2;
            const badgeCenterY = b.y + b.h / 2;

            if (Math.hypot(badgeCenterX - b.anchorX, badgeCenterY - b.anchorY) > 10) {
                badgeCtx.beginPath();
                badgeCtx.moveTo(b.anchorX, b.anchorY);
                badgeCtx.lineTo(badgeCenterX, badgeCenterY);
                badgeCtx.strokeStyle = "rgba(148, 163, 184, 0.6)";
                badgeCtx.lineWidth = 1;
                badgeCtx.stroke();
            }

            badgeCtx.save();
            badgeCtx.shadowColor = "rgba(15, 23, 42, 0.12)";
            badgeCtx.shadowBlur = 8;
            badgeCtx.shadowOffsetY = 2;
            badgeCtx.fillStyle = "rgba(255, 255, 255, 0.96)";
            badgeCtx.beginPath();
            if (badgeCtx.roundRect) badgeCtx.roundRect(b.x, b.y, b.w, b.h, 6);
            else badgeCtx.rect(b.x, b.y, b.w, b.h);
            badgeCtx.fill();
            badgeCtx.restore();

            badgeCtx.fillStyle = "#0f172a";
            badgeCtx.fillText(b.label, badgeCenterX, badgeCenterY);
        }
    }
    badgeCtx.restore();
}


/**
 * Visualizes root cluster and sub-cluster centroid anchor points as diamond markers on the canvas context.
 * @param {Object} state - Global application state.
 * @param {Function} mapX - Mapping function from data X to canvas screen X coordinate.
 * @param {Function} mapY - Mapping function from data Y to canvas screen Y coordinate.
 * @param {Function} getClusterColor - Resolver function for retrieving cluster colors.
 */
export function drawClusterCentroids(state, mapX, mapY, getClusterColor) {
    if (!state.showAnchors) return;

    // Standard Tableau 10 Palette for fallback
    const TABLEAU_PALETTE = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];

    // Determine if there is only 1 region ("All Documents")
    let isSingleRegion = true;
    if (state.allData && state.allData.length > 0) {
        const uniqueClusters = [...new Set(state.allData.map(d => parseInt(d.cluster, 10)))].filter(c => c !== -1);
        isSingleRegion = uniqueClusters.length <= 1;
    } else if (state.regionCountCache !== undefined) {
        isSingleRegion = state.regionCountCache <= 1;
    }

    // Helper to get the normal node color to perfectly match clusters
    const resolveCentroidColor = (d) => {
        if (state.colorByMetadata && d.tag) {
            try {
                if (typeof getTagSubClusterColor === 'function') {
                    const tagIdx = (state.tagOrder || []).indexOf(d.tag);
                    const safeIdx = tagIdx > -1 ? tagIdx : 0;
                    const cleanPath = d.tag_sub_path ? String(d.tag_sub_path).replace(/^Cluster\s+/i, '').trim().replace(/\./g, '-') : null;
                    return getTagSubClusterColor(d.tag, safeIdx, cleanPath) || "#9ca3af";
                }
            } catch (e) {
                return "#9ca3af";
            }
        }
        return typeof getNodeColor === 'function' ? getNodeColor(d) : "#9ca3af";
    };

    // Helper to calculate a darker variant of a hex color
    function darkenColor(colorStr, factor = 0.6) {
        if (typeof d3 !== 'undefined' && d3.color) {
            return d3.color(colorStr).darker(1.5).toString();
        }
        let hex = String(colorStr).replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6) return 'rgba(0,0,0,0.5)';

        const r = Math.floor(parseInt(hex.substring(0, 2), 16) * factor);
        const g = Math.floor(parseInt(hex.substring(2, 4), 16) * factor);
        const b = Math.floor(parseInt(hex.substring(4, 6), 16) * factor);

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    if (!state.clusterCentroids) state.clusterCentroids = {};
    if (!state.subClusterCentroids) state.subClusterCentroids = {};

    const calculatedCentroids = {};
    const counts = {};

    const calcSubCentroids = {};
    const subCounts = {};

    state.filteredData.forEach(d => {
        if (d.cluster === -1) return;

        // Root accumulations
        if (!calculatedCentroids[d.cluster]) {
            calculatedCentroids[d.cluster] = {
                x: 0,
                y: 0,
                // Account for TABLEAU_PALETTE override on 1-region maps
                color: (isSingleRegion && !state.colorByMetadata) ? TABLEAU_PALETTE[0] : resolveCentroidColor(d)
            };
            counts[d.cluster] = 0;
        }
        calculatedCentroids[d.cluster].x += d.x;
        calculatedCentroids[d.cluster].y += d.y;
        counts[d.cluster]++;

        // Sub-cluster accumulations
        if (d.sub_path !== undefined && d.sub_path !== null) {
            const subKey = `${d.cluster}-${d.sub_path}`;
            if (!calcSubCentroids[subKey]) {
                calcSubCentroids[subKey] = {
                    x: 0,
                    y: 0,
                    color: resolveCentroidColor(d)
                };
                subCounts[subKey] = 0;
            }
            calcSubCentroids[subKey].x += d.x;
            calcSubCentroids[subKey].y += d.y;
            subCounts[subKey]++;
        }
    });

    // 1. Draw Root Centroids (Large Diamonds) - Hidden if only 1 region exists
    if (!isSingleRegion) {
        Object.keys(calculatedCentroids).forEach(cId => {
            const count = counts[cId];
            if (count > 0) {
                if (!state.clusterCentroids[cId]) {
                    state.clusterCentroids[cId] = { x: calculatedCentroids[cId].x / count, y: calculatedCentroids[cId].y / count };
                }

                const cx = mapX(state.clusterCentroids[cId].x);
                const cy = mapY(state.clusterCentroids[cId].y);
                const size = 9;

                state.clusterCentroids[cId].pixelX = cx;
                state.clusterCentroids[cId].pixelY = cy;

                const baseColor = calculatedCentroids[cId].color;

                state.ctx.beginPath();
                state.ctx.moveTo(cx, cy - size);
                state.ctx.lineTo(cx + size, cy);
                state.ctx.lineTo(cx, cy + size);
                state.ctx.lineTo(cx - size, cy);
                state.ctx.closePath();

                state.ctx.fillStyle = baseColor;
                state.ctx.fill();
                state.ctx.strokeStyle = darkenColor(baseColor, 0.5);
                state.ctx.lineWidth = 3;
                state.ctx.stroke();
            }
        });
    }

    // Draw Sub-Cluster Centroids (Smaller Diamonds with Crisp White Borders)
    Object.keys(calcSubCentroids).forEach(subKey => {
        const count = subCounts[subKey];
        if (count > 0) {
            if (!state.subClusterCentroids[subKey]) {
                state.subClusterCentroids[subKey] = { x: calcSubCentroids[subKey].x / count, y: calcSubCentroids[subKey].y / count };
            }

            const cx = mapX(state.subClusterCentroids[subKey].x);
            const cy = mapY(state.subClusterCentroids[subKey].y);
            const size = 6.5;

            state.subClusterCentroids[subKey].pixelX = cx;
            state.subClusterCentroids[subKey].pixelY = cy;

            const baseColor = calcSubCentroids[subKey].color;

            // Draw main diamond
            state.ctx.beginPath();
            state.ctx.moveTo(cx, cy - size);
            state.ctx.lineTo(cx + size, cy);
            state.ctx.lineTo(cx, cy + size);
            state.ctx.lineTo(cx - size, cy);
            state.ctx.closePath();

            state.ctx.fillStyle = baseColor;
            state.ctx.fill();

            // Thick white inner border
            state.ctx.strokeStyle = '#ffffff';
            state.ctx.lineWidth = 2.5;
            state.ctx.stroke();

            // Subtle dark outer ring to make the white border pop
            state.ctx.beginPath();
            const outerSize = size + 1.25;
            state.ctx.moveTo(cx, cy - outerSize);
            state.ctx.lineTo(cx + outerSize, cy);
            state.ctx.lineTo(cx, cy + outerSize);
            state.ctx.lineTo(cx - outerSize, cy);
            state.ctx.closePath();

            state.ctx.strokeStyle = darkenColor(baseColor, 0.4);
            state.ctx.lineWidth = 1;
            state.ctx.stroke();
        }
    });
}


/**
 * Renders user-placed spatial pins and dashed connecting line paths on the canvas context.
 * @param {Object} state - Global application state containing dropped pin coordinates.
 * @param {Function} mapX - Mapping function from data X to canvas screen X coordinate.
 * @param {Function} mapY - Mapping function from data Y to canvas screen Y coordinate.
 */
function drawUserPins(state, mapX, mapY) {
    if (!state.plotSettings || !state.plotSettings.showPin) return;

    if (state.droppedPins && state.droppedPins.length > 0) {
        // Draw dashed connecting line if there are multiple pins
        if (state.droppedPins.length > 1) {
            state.ctx.beginPath();
            state.ctx.strokeStyle = '#2563eb';
            state.ctx.lineWidth = 2.5;
            state.ctx.setLineDash([6, 4]);

            state.ctx.moveTo(mapX(state.droppedPins[0].x), mapY(state.droppedPins[0].y));
            for (let i = 1; i < state.droppedPins.length; i++) {
                state.ctx.lineTo(mapX(state.droppedPins[i].x), mapY(state.droppedPins[i].y));
            }
            state.ctx.stroke();
            state.ctx.setLineDash([]);
        }

        // Draw each individual pin
        state.droppedPins.forEach(pin => {
            if (pin.x == null || pin.y == null || isNaN(pin.x) || isNaN(pin.y)) return;

            const px = mapX(pin.x);
            const py = mapY(pin.y);

            state.ctx.beginPath();
            state.ctx.arc(px, py, 6, 0, 2 * Math.PI);
            state.ctx.fillStyle = '#ef4444';
            state.ctx.fill();
            state.ctx.strokeStyle = '#ffffff';
            state.ctx.lineWidth = 2;
            state.ctx.stroke();
        });
    }
}


/**
 * Displays an interactive hover tooltip detailing document titles, authors, publication year,
 * taxonomy/cluster badges, and asynchronous AI-generated cluster summaries.
 * @param {Object} state - Global application state containing hovered node data.
 * @param {Function} mapX - Mapping function from data X to canvas screen X coordinate.
 * @param {Function} mapY - Mapping function from data Y to canvas screen Y coordinate.
 * @param {Function} getRenderedPointSize - Helper function computing rendered node diameter in pixels.
 */
export function drawHoverTooltip(state, mapX, mapY, getRenderedPointSize) {
    if (!state.hoveredNode || state.isDragging) return;

    state.ctx.save();
    state.ctx.globalAlpha = 1.0;
    state.ctx.setLineDash([]);

    const node = state.hoveredNode;
    const isCombinedNode = node.isAggregate && node.count > 1;

    state.ctx.textAlign = "left";
    state.ctx.textBaseline = "alphabetic";

    const hx = mapX(node.x);
    const hy = mapY(node.y);

    const ptSize = getRenderedPointSize(node, true);
    const actualRenderedRadius = ptSize / 2.0;
    const hoverRingRadius = actualRenderedRadius + HOVER_RING_GAP_PX;

    // Draw Outer White Ring
    state.ctx.beginPath();
    state.ctx.arc(hx, hy, hoverRingRadius, 0, 2 * Math.PI);
    state.ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    state.ctx.lineWidth = 2.5;
    state.ctx.stroke();

    // Draw Inner Dark Outline Ring
    state.ctx.beginPath();
    state.ctx.arc(hx, hy, hoverRingRadius, 0, 2 * Math.PI);
    state.ctx.strokeStyle = "#111827";
    state.ctx.lineWidth = 1.25;
    state.ctx.stroke();

    const cleanYear = (rawYear) => {
        if (rawYear === undefined || rawYear === null || rawYear === "") return "N/A";
        const match = String(rawYear).match(/\b(19[6-9]\d|20[0-2]\d)\b/);
        if (match) {
            const parsed = parseInt(match[0], 10);
            if (parsed >= 1960 && parsed <= 2026) return String(parsed);
        }
        return "N/A";
    };

    if (!state.pendingMetadataRequests) state.pendingMetadataRequests = new Set();
    if (!state.failedMetadataRequests) state.failedMetadataRequests = new Set();

    // Collect all underlying paper nodes
    const targetPapers = node.isAggregate ? getLodBaseNodes(node) : [node];

    // Fetch metadata in parallel for underlying papers
    targetPapers.forEach(p => {
        const pKey = p.paper_id || p.PAPER_ID || p.id || p.chunk_id;
        const pMeta = (state.paperMap && state.paperMap[pKey]) ||
                      (state.papers && state.papers[pKey]) ||
                      (state.metadata && state.metadata[pKey]) ||
                      (state.paperMetadata && state.paperMetadata[pKey]) ||
                      (state.metadataCache && state.metadataCache[pKey]) ||
                      (p.metadata || p.meta || {});

        const pTitle = p.title || p.TITLE || p.paper_title || p.t ||
                       pMeta.title || pMeta.TITLE || pMeta.paper_title || pMeta.t;
        const hasResolved = Boolean(pTitle && String(pTitle).trim() !== "" && !String(pTitle).startsWith("Paper "));

        const isPending = pKey && state.pendingMetadataRequests.has(pKey);
        const hasFailed = pKey && state.failedMetadataRequests.has(pKey);

        if (pKey && !hasResolved && !isPending && !hasFailed) {
            state.pendingMetadataRequests.add(pKey);

            fetch(`/api/paper-metadata/${encodeURIComponent(pKey)}`)
                .then(r => r.ok ? r.json() : null)
                .then(metaData => {
                    if (metaData) {
                        if (!state.paperMap) state.paperMap = {};
                        state.paperMap[pKey] = metaData;
                        p.title = metaData.title || metaData.t || p.title;
                        p.authors = metaData.authors || metaData.AUTHOR || metaData.a || p.authors;
                        p.year = metaData.year || metaData.YEAR || metaData.y || p.year;
                    } else {
                        state.failedMetadataRequests.add(pKey);
                    }
                })
                .catch(() => state.failedMetadataRequests.add(pKey))
                .finally(() => {
                    state.pendingMetadataRequests.delete(pKey);
                    if (typeof draw === "function") draw();
                });
        }
    });

    let titleTxt, metaTxt;
    let exampleLines = [];

    if (isCombinedNode) {
        if (AI_HOVER_MODE !== 'none') {
            const dots = ".".repeat(Math.floor(Date.now() / 600) % 4);
            const loadingMessage = AI_HOVER_MODE === 'keywords'
                ? `Extracting keywords${dots}`
                : `Summarizing embeddings${dots}`;


            titleTxt = node._cachedHoverLabel || loadingMessage;
            metaTxt = `${node.count} Grouped Documents`;

            // Append zooming instructions once the summary is fully loaded
            if (node._cachedHoverLabel && node._cachedHoverLabel !== "Unlabeled Cluster") {
                metaTxt += " \u2022 Zoom in closer to reveal items.";
            }

            // Asynchronous LOD Label Request ---
            if (!node._cachedHoverLabel && !node._isFetchingHoverLabel) {
                node._isFetchingHoverLabel = true;

                if (typeof draw === "function") {
                    node._loadingInterval = setInterval(draw, 600);
                }

                // Gather the IDs for all underlying papers absorbed in this LOD node
                let targetIds = targetPapers.map(p => p.chunk_id || p.id).filter(Boolean);

                // Cap the number of IDs to prevent LLM context size exceeded errors
                const MAX_CONTEXT_ITEMS = 10;
                if (targetIds.length > MAX_CONTEXT_ITEMS) {
                    console.log(`[LOD ${AI_HOVER_MODE}] Capping items from ${targetIds.length} to ${MAX_CONTEXT_ITEMS} to avoid context overflow.`);
                    targetIds = targetIds.slice(0, MAX_CONTEXT_ITEMS);
                }

                console.log(`[LOD ${AI_HOVER_MODE}] Fetching ${AI_HOVER_MODE} for hovered_lod with ${targetIds.length} items:`, targetIds);

                // Format the payload identically to the global fetchLabels structure
                const payload = {
                    mode: AI_HOVER_MODE,
                    clusters: { "hovered_lod": targetIds }
                };

                fetch('/api/labels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                .then(r => {
                    if (!r.ok) {
                        console.error(`[LOD ${AI_HOVER_MODE}] HTTP Error: ${r.status} ${r.statusText}`);
                    }
                    return r.ok ? r.json() : null;
                })
                .then(labels => {
                    // Apply the returned label if successful
                    if (labels && labels["hovered_lod"]) {
                        console.log(`[LOD ${AI_HOVER_MODE}] Success! Generated label: "${labels["hovered_lod"]}"`);
                        node._cachedHoverLabel = labels["hovered_lod"];
                    } else {
                        console.log(`[LOD ${AI_HOVER_MODE}] No valid label returned. Using fallback.`);
                        node._cachedHoverLabel = `Unlabeled Cluster`;
                    }
                })
                .catch(err => {
                    console.error(`[LOD ${AI_HOVER_MODE}] Fetch failed:`, err);
                    node._cachedHoverLabel = `Unlabeled Cluster`;
                })
                .finally(() => {
                    node._isFetchingHoverLabel = false;

                    // Clear the animation interval once the fetch completes
                    if (node._loadingInterval) {
                        clearInterval(node._loadingInterval);
                    }

                    // Force a final canvas redraw so the tooltip instantly updates with the new title
                    if (typeof draw === "function") draw();
                });
            }
            // --- END NEW ---
        } else {
            // Static text fallback when AI Hover is set to 'none'
            titleTxt = node._cachedHoverLabel || "Grouped Documents";
            metaTxt = `${node.count} Grouped Documents \u2022 Zoom in closer to reveal items.`;
        }

        let found = [];
        for (let i = 0; i < targetPapers.length && found.length < 2; i++) {
            const p = targetPapers[i];
            const pKey = p.paper_id || p.PAPER_ID || p.id || p.chunk_id;
            const pMeta = (state.paperMap && state.paperMap[pKey]) || (p.metadata || {});
            const t = p.title || p.TITLE || p.t || pMeta.title || pMeta.t;

            if (t && String(t).trim().length > 3 && !String(t).startsWith("Paper ") && !found.includes(t)) {
                found.push(t);
            }
        }
        node._cachedExamples = found;
    } else {
        const paperKey = node.paper_id || node.PAPER_ID || node.id || node.chunk_id;
        const paperMeta = (state.paperMap && state.paperMap[paperKey]) || (node.metadata || {});
        const rawTitle = node.title || node.TITLE || node.paper_title || node.t || paperMeta.title;
        const hasResolvedTitle = Boolean(rawTitle && String(rawTitle).trim() !== "" && !String(rawTitle).startsWith("Paper "));

        titleTxt = hasResolvedTitle ? String(rawTitle).trim() : "Untitled Document";

        const rawAuthor = node.authors || node.AUTHOR || node.authors_str || node.author || node.a || paperMeta.authors;
        const authorTxt = (rawAuthor && String(rawAuthor).trim()) ? String(rawAuthor).trim() : "Unknown";

        const rawYear = node.year || node.YEAR || node.y || paperMeta.year;
        const yearTxt = cleanYear(rawYear);

        metaTxt = `${authorTxt} • ${yearTxt}`;
    }

    const rawBadges = [];

    // ========================================================================
    // BADGE GENERATION LOGIC
    // ========================================================================
    if (state.colorByMetadata && node.tag) {
        const tag = node.tag;
        const tagIdx = (state.tagOrder || []).indexOf(tag);
        const safeIdx = tagIdx > -1 ? tagIdx : 0;

        // Keep the root tag name exactly as it is (e.g., "CHUNK") but strip "metadata_" if present
        const displayName = tag.replace(/^metadata_/i, '');
        const rootColor = typeof getTagRegionColor === 'function' ? getTagRegionColor(tag, safeIdx) : "#4b5563";
        rawBadges.push({ text: displayName, color: rootColor });

        const subPathStr = node.tag_sub_path ? String(node.tag_sub_path).replace(/^Cluster\s+/i, '').trim() : "";
        if (subPathStr) {
            // Tags use periods for hierarchy (e.g., "0.1")
            const parts = subPathStr.split('.');
            for (let i = 0; i < parts.length; i++) {
                const subPathAccumulated = parts.slice(0, i + 1).join('.');
                const hyphenPath = subPathAccumulated.replace(/\./g, '-');
                const fullKey = `${tag}_${subPathAccumulated}`;

                // Default to standard "Subcluster X" unless a summary/keyword exists
                let subName = `Subcluster ${parts[i]}`;
                if (state.clusterNames && state.clusterNames[fullKey]) {
                    subName = state.clusterNames[fullKey];
                }

                const subColor = typeof getTagSubClusterColor === 'function' ? getTagSubClusterColor(tag, safeIdx, hyphenPath) : "#9ca3af";
                rawBadges.push({ text: subName, color: subColor });
            }
        }
    } else {
        // Default Global Cluster Logic
        const rootId = node.cluster !== undefined && node.cluster !== null ? parseInt(node.cluster, 10) : -1;

        let isSingleRegion = true;
        if (state.allData && state.allData.length > 0) {
            const uniqueClusters = [...new Set(state.allData.map(d => parseInt(d.cluster, 10)))].filter(c => c !== -1);
            isSingleRegion = uniqueClusters.length <= 1;
        } else if (state.regionCountCache !== undefined) {
            isSingleRegion = state.regionCountCache <= 1;
        }

        let baseName = `Region ${rootId + 1}`;
        if (isSingleRegion && rootId !== -1) {
            baseName = "All Documents";
        }

        let cName = node.cluster_name;
        if (cName === "All Documents" || cName === "Cluster 0") {
            cName = null;
        }

        const rootName = rootId === -1 ? "Noise" : (cName || baseName);
        let rootColor = typeof getClusterColor === "function" ? getClusterColor(rootId) : "#4b5563";
        rawBadges.push({ text: rootName, color: rootColor });

        let pathStr = "";
        if (node.sub_path !== undefined && node.sub_path !== null && String(node.sub_path) !== "") {
            pathStr = String(node.sub_path);
        } else if (node.sub_cluster !== undefined && node.sub_cluster !== null && String(node.sub_cluster) !== "") {
            pathStr = String(node.sub_cluster);
        }

        if (pathStr !== "") {
            const rawSplit = pathStr.split('-');
            const parts = [];
            for (let i = 0; i < rawSplit.length; i++) {
                if (rawSplit[i] === "") {
                    if (i + 1 < rawSplit.length) { parts.push("-" + rawSplit[i + 1]); i++; }
                } else { parts.push(rawSplit[i]); }
            }

            for (let i = 0; i < parts.length; i++) {
                const val = parseInt(parts[i], 10);
                const subPathAccumulated = parts.slice(0, i + 1).join('-');
                const fullPathKey = `${rootId}-${subPathAccumulated}`;

                let subName = val === -1 ? "Noise" : `Subcluster ${val}`;
                if (val !== -1 && state.globalClusterLabelMode !== 'none' && state.clusterLabels?.[state.globalClusterLabelMode]?.[fullPathKey]) {
                    subName = state.clusterLabels[state.globalClusterLabelMode][fullPathKey];
                }

                let subColor = typeof getSubClusterColor === "function" ? getSubClusterColor(rootId, subPathAccumulated) : "#9ca3af";
                rawBadges.push({ text: subName, color: subColor });
            }
        }
    }

    const badges = rawBadges.filter(b => b.text.toUpperCase() !== "ALL DOCUMENTS");

    // ========================================================================
    // TOOLTIP RENDERING
    // ========================================================================
    const MAX_TOOLTIP_WIDTH = 400;
    const PADDING_X = 14;
    const PADDING_Y = 12;
    const maxContentWidth = MAX_TOOLTIP_WIDTH - (PADDING_X * 2);

    const titleFont = "bold 13px system-ui, sans-serif";
    const metaFont = "11px system-ui, sans-serif";

    const wrapText = (text, font, maxW) => {
        state.ctx.font = font;
        const words = String(text).split(" ");
        const lines = [];
        let current = "";
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = current ? current + " " + word : word;
            if (state.ctx.measureText(testLine).width > maxW && current) {
                lines.push(current);
                current = word;
            } else {
                current = testLine;
            }
        }
        if (current) lines.push(current);
        return lines;
    };

    const titleLines = wrapText(titleTxt, titleFont, maxContentWidth);
    const metaLines = wrapText(metaTxt, metaFont, maxContentWidth);

    if (isCombinedNode && node._cachedExamples && node._cachedExamples.length > 0) {
        exampleLines.push("Examples:");
        node._cachedExamples.forEach(ex => {
            const wrapped = wrapText(`• ${ex}`, metaFont, maxContentWidth - 10);
            exampleLines.push(...wrapped);
        });
    }

    state.ctx.font = "bold 10px system-ui, sans-serif";
    const badgeRows = [[]];
    let currentRowWidth = 0;

    badges.forEach(b => {
        const w = state.ctx.measureText(b.text.toUpperCase()).width + 12;
        if (currentRowWidth > 0 && currentRowWidth + w > maxContentWidth) {
            badgeRows.push([{ ...b, width: w }]);
            currentRowWidth = w + 6;
        } else {
            badgeRows[badgeRows.length - 1].push({ ...b, width: w });
            currentRowWidth += w + 6;
        }
    });

    let actualMaxW = 0;
    state.ctx.font = titleFont;
    titleLines.forEach(l => actualMaxW = Math.max(actualMaxW, state.ctx.measureText(l).width));

    state.ctx.font = metaFont;
    metaLines.forEach(l => actualMaxW = Math.max(actualMaxW, state.ctx.measureText(l).width));
    exampleLines.forEach(l => actualMaxW = Math.max(actualMaxW, state.ctx.measureText(l).width + 10));

    if (badges.length > 0) {
        badgeRows.forEach(row => {
            const rowW = row.reduce((acc, b) => acc + b.width + 6, 0) - 6;
            actualMaxW = Math.max(actualMaxW, rowW);
        });
    }

    const boxW = Math.max(180, Math.min(MAX_TOOLTIP_WIDTH, actualMaxW + (PADDING_X * 2)));

    const titleLineHeight = 16;
    const metaLineHeight = 15;
    const badgeRowHeight = 22;

    const titleHeight = titleLines.length * titleLineHeight;
    const metaHeight = metaLines.length * metaLineHeight;
    const hasBadges = badges.length > 0;
    const badgeHeight = hasBadges ? (badgeRows.length * badgeRowHeight) : 0;

    let boxH = PADDING_Y + titleHeight + 4;
    if (hasBadges) boxH += badgeHeight + 4;
    boxH += metaHeight;
    if (exampleLines.length > 0) boxH += 8 + (exampleLines.length * metaLineHeight);
    boxH += PADDING_Y;

    let boxX = hx + 12;
    let boxY = hy - (boxH / 2);

    if (boxX + boxW > state.canvas.width) boxX = hx - boxW - 12;
    if (boxX < 0) boxX = 12;
    if (boxY < 0) boxY = hy + 12;
    if (boxY + boxH > state.canvas.height) boxY = state.canvas.height - boxH - 12;
    if (boxY < 0) boxY = 12;

    state.ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    state.ctx.beginPath();
    if (typeof state.ctx.roundRect === "function") {
        state.ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    } else {
        state.ctx.rect(boxX, boxY, boxW, boxH);
    }
    state.ctx.fill();

    state.ctx.strokeStyle = "#e5e7eb";
    state.ctx.lineWidth = 1;
    state.ctx.stroke();

    let currentY = boxY + PADDING_Y;

    state.ctx.fillStyle = "#111827";
    state.ctx.font = titleFont;
    titleLines.forEach(line => {
        state.ctx.fillText(line, boxX + PADDING_X, currentY + 12);
        currentY += titleLineHeight;
    });

    if (hasBadges) {
        currentY += 4;
        state.ctx.font = "bold 10px system-ui, sans-serif";

        badgeRows.forEach(row => {
            let currentBadgeX = boxX + PADDING_X;
            row.forEach(b => {
                state.ctx.fillStyle = b.color.length === 7 ? b.color + "1a" : "rgba(200,200,200,0.1)";
                state.ctx.beginPath();
                if (typeof state.ctx.roundRect === "function") {
                    state.ctx.roundRect(currentBadgeX, currentY, b.width, 16, 4);
                } else {
                    state.ctx.rect(currentBadgeX, currentY, b.width, 16);
                }
                state.ctx.fill();

                state.ctx.strokeStyle = b.color.length === 7 ? b.color + "40" : "#d1d5db";
                state.ctx.lineWidth = 1;
                state.ctx.stroke();

                state.ctx.fillStyle = b.color;
                state.ctx.fillText(b.text.toUpperCase(), currentBadgeX + 6, currentY + 12);

                currentBadgeX += b.width + 6;
            });
            currentY += badgeRowHeight;
        });
    }

    currentY += 2;
    state.ctx.fillStyle = "#4b5563";
    state.ctx.font = metaFont;
    metaLines.forEach(line => {
        state.ctx.fillText(line, boxX + PADDING_X, currentY + 11);
        currentY += metaLineHeight;
    });

    if (exampleLines.length > 0) {
        currentY += 8;
        state.ctx.fillStyle = "#6b7280";
        exampleLines.forEach((line, idx) => {
            const isHeader = idx === 0 && line === "Examples:";
            state.ctx.font = isHeader ? "bold 11px system-ui, sans-serif" : metaFont;
            state.ctx.fillText(line, boxX + PADDING_X + (isHeader ? 0 : 4), currentY + 11);
            currentY += metaLineHeight;
        });
    }

    state.ctx.restore();
}


/**
 * Resolves the parent node visible at the specified LOD tier by traversing up the `_lod_next` hierarchy.
 * @param {Object} node - The target data node.
 * @param {number} currentLodIndex - The active Level of Detail index.
 * @returns {Object|null} The resolved visible node at the current LOD level.
 */
function resolveVisibleNode(node, currentLodIndex) {
    if (!node) return null;
    let currentNode = node;
    // Traverse up the LOD hierarchy up to the currently active tier
    for (let i = 0; i < currentLodIndex; i++) {
        if (currentNode._lod_next) {
            currentNode = currentNode._lod_next;
        } else {
            break;
        }
    }
    return currentNode;
}


/**
 * Draws predicted search trajectories, step anchor nodes (start, intermediate, end),
 * and connecting doc halos during trajectory hover inspection.
 * @param {Object} state - Global application state containing trajectory paths.
 * @param {CanvasRenderingContext2D} ctx - canvas rendering context.
 * @param {Function} mapX - Mapping function from data X to canvas screen X coordinate.
 * @param {Function} mapY - Mapping function from data Y to canvas screen Y coordinate.
 * @param {number} currentLodIndex - The currently active LOD level index.
 */
export function drawSearchTrajectory(state, ctx, mapX, mapY, currentLodIndex) {
    if (!state.currentPath || state.currentPath.length === 0) return;

    // Draw the predicted trajectory path
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 69, 58, 0.9)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);

    state.currentPath.forEach((p, i) => {
        const sx = mapX(p.x);
        const sy = mapY(p.y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw step anchor points
    state.currentPath.forEach((p, i) => {
        const sx = mapX(p.x);
        const sy = mapY(p.y);
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);

        // Start = Green, End = Blue, Intermediate = Red
        ctx.fillStyle = i === 0 ? "#34d399" : (i === state.currentPath.length - 1 ? "#60a5fa" : "#ff453a");
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
    });

    // Highlight step documents when hovering over a step anchor
    if (state.hoveredNode && state.lastSearchTrajectory) {
        // Find if the currently hovered node is an anchor in the trajectory
        const activeStep = state.lastSearchTrajectory.find(step =>
            step.primaryNode &&
            (step.primaryNode.id === state.hoveredNode.id || step.primaryNode.chunk_id === state.hoveredNode.chunk_id)
        );

        if (activeStep && activeStep.papers) {
            const anchorNode = resolveVisibleNode(activeStep.primaryNode, currentLodIndex);
            if (!anchorNode) return;

            const anchorX = mapX(anchorNode.x);
            const anchorY = mapY(anchorNode.y);

            activeStep.papers.forEach(doc => {
                // Apply LOD resolution to find where the document currently sits on screen
                const visibleDoc = resolveVisibleNode(doc, currentLodIndex);
                if (visibleDoc.x == null || visibleDoc.y == null) return;

                const dsx = mapX(visibleDoc.x);
                const dsy = mapY(visibleDoc.y);

                // Draw connecting line from anchor to document
                ctx.beginPath();
                ctx.moveTo(anchorX, anchorY);
                ctx.lineTo(dsx, dsy);
                ctx.strokeStyle = "rgba(255, 165, 0, 0.3)";
                ctx.lineWidth = 1;
                ctx.stroke();

                // Draw halo around the document
                ctx.beginPath();
                ctx.arc(dsx, dsy, 14, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 165, 0, 0.4)";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 165, 0, 0.9)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });
        }
    }
}


/**
 * Performs grid-based spatial hashing to group nearby 2D points into organic LOD cluster aggregate objects.
 * @param {Array<Object>} points - Array of input point objects containing X and Y coordinates.
 * @param {number} radius - Spatial distance threshold for clustering.
 * @returns {Array<Object>} Array of aggregate cluster nodes.
 */
function generateOrganicClusters(points, radius) {
    if (!points || points.length === 0) return [];

    let boundsMinX = Infinity, boundsMinY = Infinity;
    let boundsMaxX = -Infinity, boundsMaxY = -Infinity;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x < boundsMinX) boundsMinX = p.x;
        if (p.x > boundsMaxX) boundsMaxX = p.x;
        if (p.y < boundsMinY) boundsMinY = p.y;
        if (p.y > boundsMaxY) boundsMaxY = p.y;
    }

    boundsMinX -= radius; boundsMaxX += radius;
    boundsMinY -= radius; boundsMaxY += radius;

    const cols = Math.max(1, Math.ceil((boundsMaxX - boundsMinX) / radius));
    const rows = Math.max(1, Math.ceil((boundsMaxY - boundsMinY) / radius));
    const cellCount = cols * rows;

    const head = new Int32Array(cellCount).fill(-1);
    const next = new Int32Array(points.length).fill(-1);

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const cx = Math.floor((p.x - boundsMinX) / radius);
        const cy = Math.floor((p.y - boundsMinY) / radius);
        const idx = cy * cols + cx;

        if (idx >= 0 && idx < cellCount) {
            next[i] = head[idx];
            head[idx] = i;
        }
    }

    const clusters = [];
    const grouped = new Uint8Array(points.length);
    const radiusSq = radius * radius;

    for (let i = 0; i < points.length; i++) {
        if (grouped[i]) continue;
        const p = points[i];

        const cx = Math.floor((p.x - boundsMinX) / radius);
        const cy = Math.floor((p.y - boundsMinY) / radius);

        let sumX = 0, sumY = 0;
        let totalCount = 0;
        const clusterCounts = {};
        let maxCount = 0;
        let repNode = p;

        // ADDED: Track which child nodes fall into this LOD cluster
        const absorbed = [];

        for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= cols) continue;

            for (let dy = -1; dy <= 1; dy++) {
                const ny = cy + dy;
                if (ny < 0 || ny >= rows) continue;

                const cellIdx = ny * cols + nx;
                let curr = head[cellIdx];

                while (curr !== -1) {
                    if (!grouped[curr]) {
                        const cp = points[curr];
                        const distSq = (cp.x - p.x) * (cp.x - p.x) + (cp.y - p.y) * (cp.y - p.y);

                        if (distSq <= radiusSq) {
                            grouped[curr] = 1;
                            absorbed.push(curr); // ADDED: Save index

                            const ptCount = cp.count || 1;
                            totalCount += ptCount;

                            sumX += cp.x * ptCount;
                            sumY += cp.y * ptCount;

                            const cStr = String(cp.cluster);
                            clusterCounts[cStr] = (clusterCounts[cStr] || 0) + ptCount;
                            if (clusterCounts[cStr] > maxCount) {
                                maxCount = clusterCounts[cStr];
                                repNode = cp;
                            }
                        }
                    }
                    curr = next[curr];
                }
            }
        }

        const avgX = sumX / totalCount;
        const avgY = sumY / totalCount;

// In generateOrganicClusters() inside render.js:
const clusterObj = {
    ...repNode,
    x: (repNode.x * 0.75) + (avgX * 0.25),
    y: (repNode.y * 0.75) + (avgY * 0.25),
    count: totalCount,
    isAggregate: true,
    children: absorbed.map(idx => points[idx]) // Save references to child nodes
};

        // ADDED: Assign the parent LOD reference to all absorbed nodes
        for (let j = 0; j < absorbed.length; j++) {
            points[absorbed[j]]._lod_next = clusterObj;
        }

        clusters.push(clusterObj);
    }

    return clusters;
}


/**
 * Recursively retrieves all underlying leaf document/paper nodes absorbed within an aggregate LOD node.
 * @param {Object} node - Target LOD aggregate or leaf node.
 * @returns {Array<Object>} Flattened array of constituent base nodes.
 */
export function getLodBaseNodes(node) {
    if (!node) return [];
    if (!node.isAggregate || !node.children) return [node];
    return node.children.flatMap(getLodBaseNodes);
}

/**
 * Computes the shortest graph path (Breadth-First Search) between selected nodes in network view mode.
 */
function updateNetworkShortestPath() {
    // ADD THIS GUARD: Skip expensive network pathfinding in scatter mode
    if (state.viewMode !== 'network') {
        state.networkShortestPath = null;
        return;
    }

    if (!state.selectedNodes || state.selectedNodes.length < 2) {
        state.networkShortestPath = null;
        return;
    }

    if (!state.graphData || !state.graphData._scatterOverlayCache) {
        if (typeof ensureScatterOverlayCache === 'function') ensureScatterOverlayCache();
    }
    const adjacencyMap = state.graphData?._scatterOverlayCache?.adjacencyMap;
    if (!adjacencyMap) {
        state.networkShortestPath = null;
        return;
    }

    const findSegment = (startNode, endNode) => {
        const startRef = startNode.rawRef || startNode;
        const endRef = endNode.rawRef || endNode;
        if (!startRef || !endRef || startRef === endRef) return null;

        const queue = [[startRef]];
        const visited = new Set([startRef]);

        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];

            if (current === endRef) return path;

            const neighbors = adjacencyMap.get(current);
            if (neighbors) {
                for (const nbr of neighbors) {
                    if (!visited.has(nbr)) {
                        visited.add(nbr);
                        queue.push([...path, nbr]);
                    }
                }
            }
        }
        return null;
    };

    const fullPath = [];
    for (let i = 0; i < state.selectedNodes.length - 1; i++) {
        const segment = findSegment(state.selectedNodes[i], state.selectedNodes[i + 1]);
        if (!segment) continue;
        if (fullPath.length > 0) {
            fullPath.push(...segment.slice(1));
        } else {
            fullPath.push(...segment);
        }
    }
    state.networkShortestPath = fullPath.length > 1 ? fullPath : null;
}


/**
 * Invalidates cached data references and scatter overlay caches to force a full GPU buffer rebuild on the next draw frame.
 */
export function invalidateRenderCache() {
    lastDataRef = null;
    if (state && state.graphData) {
        state.graphData._scatterOverlayCache = null;
    }
    renderStateCache.colorHash = 'INVALIDATED';
}


/**
 * Maps a data space X coordinate to a canvas screen X coordinate considering zoom and pan transformations.
 * @param {number} x - Data X coordinate.
 * @returns {number} Screen X pixel coordinate.
 */
export function mapX(x) {
    if (!state.canvas || maxX === -Infinity) return x;
    const scale = state.plotSettings ? state.plotSettings.xScale : 1;
    const baseX = ((x - minX) / (maxX - minX)) * state.canvas.width;
    return (baseX * state.transform.k * scale) + state.transform.x;
}


/**
 * Maps a data space Y coordinate to a canvas screen Y coordinate considering zoom and pan transformations.
 * @param {number} y - Data Y coordinate.
 * @returns {number} Screen Y pixel coordinate.
 */
export function mapY(y) {
    if (!state.canvas || maxY === -Infinity) return y;
    const scale = state.plotSettings ? state.plotSettings.yScale : 1;
    const baseY = ((y - minY) / (maxY - minY)) * state.canvas.height;
    return (baseY * state.transform.k * scale) + state.transform.y;
}

/**
 * Converts a canvas screen X pixel coordinate back into data space X coordinate.
 * @param {number} sx - Screen X pixel coordinate.
 * @returns {number} Data space X coordinate.
 */
export function invertMapX(sx) {
    if (!state.canvas || maxX === -Infinity) return sx;
    const scale = state.plotSettings ? state.plotSettings.xScale : 1;
    const baseX = (sx - state.transform.x) / (state.transform.k * scale);
    return (baseX / state.canvas.width) * (maxX - minX) + minX;
}


/**
 * Converts a canvas screen Y pixel coordinate back into data space Y coordinate.
 * @param {number} sy - Screen Y pixel coordinate.
 * @returns {number} Data space Y coordinate.
 */
export function invertMapY(sy) {
    if (!state.canvas || maxY === -Infinity) return sy;
    const scale = state.plotSettings ? state.plotSettings.yScale : 1;
    const baseY = (sy - state.transform.y) / (state.transform.k * scale);
    return (baseY / state.canvas.height) * (maxY - minY) + minY;
}


/**
 * Attaches drag event listeners to a UI dialog header to allow fixed mouse positioning across the screen.
 * @param {string} dialogId - DOM element ID of the target dialog container.
 * @param {string} headerId - DOM element ID of the drag handle header.
 */
function makeDialogDraggable(dialogId, headerId) {
    const dialog = document.getElementById(dialogId);
    const header = document.getElementById(headerId);

    if (!dialog || !header) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    // Set cursor to indicate it can be moved
    header.style.cursor = 'grab';

    header.addEventListener('mousedown', (e) => {
        // Don't drag if clicking the close button or an input inside the header
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        isDragging = true;
        header.style.cursor = 'grabbing';

        startX = e.clientX;
        startY = e.clientY;

        const rect = dialog.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Ensure absolute positioning is clean
        dialog.style.margin = '0';
        dialog.style.transform = 'none';
        dialog.style.position = 'fixed'; // or 'absolute' depending on your CSS setup

        // Prevent text selection while dragging
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        dialog.style.left = `${initialLeft + dx}px`;
        dialog.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = 'grab';
        }
    });
}


/**
 * Sets the manual Level-of-Detail (LOD) rendering mode override and triggers an immediate canvas redraw.
 *
 * @param {string|number} mode - The target level-of-detail mode setting or override threshold.
 * @returns {void}
 */
export function setLodMode(mode) {
    manualLodOverride = mode;
    draw(); // Force a redraw to apply the new LOD immediately
}


// Initialize the drag behavior once the page loads
document.addEventListener('DOMContentLoaded', () => {
    makeDialogDraggable('networkDialog', 'networkDialogHeader');

    // You can also reuse this for your other dialogs!
    makeDialogDraggable('plotOptionsDialog', 'plotDialogHeader');
    makeDialogDraggable('datasetDialog', 'datasetDialogHeader');
});


/**
 * Updates the global AI hover mode setting, updates UI button active states, and triggers a canvas redraw.
 * @param {string} mode - Hover mode ('none', 'keywords', 'summary').
 * @param {HTMLElement} btn - Clicked UI button element.
 */
window.setHoverMode = function(mode, btn) {
    // Update the variable
    AI_HOVER_MODE = mode;

    // Update the active CSS class visually
    const group = btn.parentElement;
    group.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Force a canvas redraw to instantly reflect the hover mode change
    if (typeof draw === "function") draw();
};


/**
 * Toggles the AI edge summary feature flag, invalidates the scatter graph cache, and requests a canvas redraw.
 * @param {boolean} isChecked - Checkbox state.
 */
window.toggleAIEdgeSummaries = function(isChecked) {
    ENABLE_AI_EDGE_SUMMARIES = isChecked;

    // Clear the cache so it forces a recalculation/fetch on the next frame
    if (state && state.graphData) {
        state.graphData._scatterOverlayCache = null;
    }

    if (typeof draw === "function") draw();
};


/**
 * Reads user parameters for network connections and distance from DOM elements, updates global state, invalidates graph cache, and redraws.
 */
window.updateNetworkParams = function() {
    const keywordElem = document.getElementById('networkKeywordInput') || document.getElementById('customKeywordInput');
    const connsElem = document.getElementById('networkMaxConnections');
    const distElem = document.getElementById('networkMaxDistance');

    const keyword = keywordElem ? keywordElem.value : "";
    const maxConns = connsElem ? parseInt(connsElem.value, 10) : 1;
    const maxDist = distElem ? parseFloat(distElem.value) : 100;

    // IMPORTANT: Update the global variables that your caching logic relies on
    if (typeof LOCAL_NEIGHBORS_PER_NODE !== 'undefined') {
        LOCAL_NEIGHBORS_PER_NODE = maxConns;
    }
    if (typeof MAX_SPATIAL_DISTANCE !== 'undefined') {
        MAX_SPATIAL_DISTANCE = maxDist;
    }

    if (typeof state !== 'undefined') {
        state.networkFilterKeyword = keyword;
        state.networkMaxConnections = maxConns;
        state.networkMaxDistance = maxDist;
    }

    if (typeof state !== 'undefined' && state && state.graphData) {
        // Clearing this forces ensureScatterOverlayCache to run again
        state.graphData._scatterOverlayCache = null;
    }

    if (typeof draw === "function") draw();
};
