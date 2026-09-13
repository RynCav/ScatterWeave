import { state } from '../core/state.js';
import { draw, mapX, mapY } from './render.js';
import {updateBottomPanelTrajectory } from '../components/ui.js';
import {updatePanel} from "../components/meta_panel.js";
import { applyGlobalFilters } from '../core/data.js';
import {
    handleHierarchyClick,
    hitTestHierarchy,
    startHierarchyDrag,
    moveHierarchyDrag,
    stopHierarchyDrag,
    drawHierarchy,handleHierarchyDoubleClick
} from './hierarchy.js';


/**
 * Computes and updates the array of selected nodes in global state
 * based on whether node screen coordinates fall within the active selection box boundaries.
 *
 * @returns {void}
 */
function calculateSelectedNodes() {
    if (!state.selectionBox) return;

    const xMin = Math.min(state.selectionBox.startX, state.selectionBox.currentX);
    const xMax = Math.max(state.selectionBox.startX, state.selectionBox.currentX);
    const yMin = Math.min(state.selectionBox.startY, state.selectionBox.currentY);
    const yMax = Math.max(state.selectionBox.startY, state.selectionBox.currentY);

    state.selectedNodes = state.filteredData.filter(d => {
        const sx = mapX(d.x);
        const sy = mapY(d.y);

        return sx >= xMin && sx <= xMax && sy >= yMin && sy <= yMax;
    });
}


/**
 * Handles canvas click interactions including pin placement, dropped pin selections,
 * view mode event routing (hierarchy/network), and updating info panels for clicked nodes.
 *
 * @param {MouseEvent} event - The mouse click event object.
 * @returns {void}
 */
export function handleCanvasClick(event) {
    if (state.hasDragged) {
        state.hasDragged = false;
        return;
    }
    // Handle hierarchy clicks
    if (state.viewMode === 'hierarchy' || state.viewMode === 'hNetwork') {
        if (handleHierarchyClick(event)) return;
    }
    // Allow Shift + Click inside Network view
    if (state.viewMode === 'network' || state.viewMode === "scatter") {
        handleNetworkClick(event); return;
    }

    if (event.shiftKey) return;

    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const wantsToPin = document.body.classList.contains('body-pin-active') || state.pinModeActive;

    if (wantsToPin) {
        if (!state.allData || state.allData.length === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        state.allData.forEach(d => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y < minY) minY = d.y;
            if (d.y > maxY) maxY = d.y;
        });

        const paddingX = (maxX - minX) * 0.05 || 1;
        const paddingY = (maxY - minY) * 0.05 || 1;
        minX -= paddingX; maxX += paddingX;
        minY -= paddingY; maxY += paddingY;

        const baseX = (mouseX - state.transform.x) / state.transform.k;
        const baseY = (mouseY - state.transform.y) / state.transform.k;

        const dataX = (baseX / state.canvas.width) * (maxX - minX) + minX;
        const dataY = (baseY / state.canvas.height) * (maxY - minY) + minY;

        const newPin = {
            id: Date.now().toString(),
            x: dataX,
            y: dataY,
            name: `Coordinate Pin ${state.droppedPins.length + 1}`,
            cluster: "None",
            notes: `Manual spatial placement at coordinates [${dataX.toFixed(1)}, ${dataY.toFixed(1)}]`
        };
        state.droppedPins.push(newPin);

        updateBottomPanelTrajectory(state.droppedPins, "pins");

        if (state.spiralEnabled) {
            import('./layout.js').then(layout => {
                if (typeof layout.applySpiralLayout === 'function') layout.applySpiralLayout();
            });
        } else {
            draw();
        }

        document.body.classList.remove('body-pin-active');
        state.pinModeActive = false;
        state.canvas.style.cursor = state.hoveredNode ? 'pointer' : 'default';
        return;
    }

    let clickedPin = null;
    for (let i = state.droppedPins.length - 1; i >= 0; i--) {
        const pin = state.droppedPins[i];
        const dx = mouseX - mapX(pin.x);
        const dy = mouseY - mapY(pin.y);
        if (dx * dx + dy * dy < 225) {
            clickedPin = pin;
            break;
        }
    }

    if (clickedPin) {
        const popup = document.getElementById('pinPopup');
        if (popup) popup.style.display = 'none';

        updateBottomPanelTrajectory(state.droppedPins, "pins");
        return;
    }

    if (state.hoveredNode && (state.viewMode !== 'hierarchy' || state.viewMode !== 'hNetwork')) {
        updatePanel(state.hoveredNode);
        if (state.lastSearchTrajectory && state.lastSearchTrajectory.length > 0) {
            updateBottomPanelTrajectory(state.lastSearchTrajectory, "trajectory");
        }
    }
}


/**
 * Manages canvas cursor hover states, node and pin hit-testing, selection box coordinate tracking,
 * drag/pan operations, and conditional view redraws.
 *
 * @param {MouseEvent} event - The mouse movement event object.
 * @returns {void}
 */
export function handleCanvasHover(event) {
    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    state.mouseX = mouseX;
    state.mouseY = mouseY;

    // Fully intercept Hierarchy hover and panning ---
    if (state.viewMode === 'hierarchy' || state.viewMode === 'hNetwork') {
        if (state.isHierarchyNodeDragging) {
            state.hasDragged = true;
            moveHierarchyDrag(mouseX, mouseY);
            drawHierarchy();
            return;
        }

        // Handle panning the background in hierarchy mode
        if (state.isDragging) {
            state.hasDragged = true;
            state.transform.x = event.clientX - state.dragStart.x;
            state.transform.y = event.clientY - state.dragStart.y;
            drawHierarchy();
            return;
        }

        // Highlight nodes on hover without calling the scatterplot draw()
        const hitNode = hitTestHierarchy(mouseX, mouseY);
        if (hitNode !== state.hoveredNode) {
            state.hoveredNode = hitNode;
            drawHierarchy();
        }

        state.canvas.style.cursor = hitNode ? 'pointer' : 'default';
        return; // EXIT HERE so scatterplot hover logic does not run
    }

    // --- Existing Scatter/Network Logic ---
    if (state.selectionModeActive && state.selectionBox) {
        state.selectionBox.currentX = mouseX;
        state.selectionBox.currentY = mouseY;
        calculateSelectedNodes();
        draw();
        return;
    }

    if (state.isDragging) {
        state.hasDragged = true;
        state.transform.x = event.clientX - state.dragStart.x;
        state.transform.y = event.clientY - state.dragStart.y;
        draw();
        return;
    }

    const pinActive = state.pinModeActive || document.body.classList.contains('body-pin-active');

    let foundPin = null;
    if (!pinActive && state.droppedPins && state.droppedPins.length > 0) {
        for (let i = state.droppedPins.length - 1; i >= 0; i--) {
            const pin = state.droppedPins[i];
            const dx = mouseX - mapX(pin.x);
            const dy = mouseY - mapY(pin.y);
            if (dx * dx + dy * dy < 225) {
                foundPin = pin;
                break;
            }
        }
    }

    let foundNode = null;
    if (!foundPin && state.filteredData) {
        for (let i = state.filteredData.length - 1; i >= 0; i--) {
            const d = state.filteredData[i];

            let sx, sy;
            if (state.viewMode === 'network' || state.viewMode === 'chord') {
                sx = d.networkScreenX;
                sy = d.networkScreenY;
            } else {
                sx = mapX(d.x);
                sy = mapY(d.y);
            }

            if (sx === undefined || sy === undefined) continue;

            const dx = mouseX - sx;
            const dy = mouseY - sy;

            if (dx * dx + dy * dy < 36) {
                foundNode = d;
                break;
            }
        }
    }

    let shouldRedraw = false;

    if (state.graphData && Array.isArray(state.graphData.nodes) && state.graphData.nodes.length > 0) {
        shouldRedraw = true;
    }

    if (foundNode !== state.hoveredNode) {
        state.hoveredNode = foundNode;
        shouldRedraw = true;
    }


    if (pinActive) {
        state.canvas.style.cursor = 'crosshair';
    } else {
        state.canvas.style.cursor = (state.hoveredNode || foundPin) ? 'pointer' : 'default';
    }

    if (shouldRedraw) {
        draw();
    }
}


/**
 * Processes canvas mouse wheel events to perform focal zoom transformations
 * relative to the cursor position across various view modes.
 *
 * @param {WheelEvent} event - The mouse wheel scroll event object.
 * @returns {void}
 */
export function handleWheel(event) {
    event.preventDefault();
    const zoomSensitivity = 0.001;
    const zoomFactor = Math.exp(event.deltaY * -zoomSensitivity);

    const rect = state.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const newK = Math.max(0.2, Math.min(state.transform.k * zoomFactor, 140));

    state.transform.x = mouseX - ((mouseX - state.transform.x) / state.transform.k) * newK;
    state.transform.y = mouseY - ((mouseY - state.transform.y) / state.transform.k) * newK;
    state.transform.k = newK;

// Route rendering based on viewMode
    if (state.viewMode === 'hierarchy' || state.viewMode === 'hNetwork'
    ) {
        drawHierarchy();
    } else {
        draw();
    }
}

/**
 * Initializes canvas dragging, panning, or shift-drag box selection modes
 * based on active tools and input modifier state.
 *
 * @param {MouseEvent} event - The mouse down event object.
 * @returns {void}
 */
export function handleMouseDown(event) {
    if (document.body.classList.contains('body-pin-active')) return;

    // Prevent lasso selection in scatter mode so Shift+Click can multi-select
    if (event.shiftKey && state.viewMode !== 'network' && state.viewMode !== 'scatter') {
        state.selectionModeActive = true;

        state.lassoFilterActive = false;
        import('../core/data.js').then(data => {
            if (typeof data.applyGlobalFilters === 'function') data.applyGlobalFilters(true);
        });

        const rect = state.canvas.getBoundingClientRect();
        state.selectionBox = {
            startX: event.clientX - rect.left,
            startY: event.clientY - rect.top,
            currentX: event.clientX - rect.left,
            currentY: event.clientY - rect.top
        };
        return;
    }

    state.isDragging = true;
    state.hasDragged = false;
    state.dragStart.x = event.clientX - state.transform.x;
    state.dragStart.y = event.clientY - state.transform.y;
    state.canvas.style.cursor = 'grabbing';
}


/**
 * Finalizes drag, pan, anchor modification, box selection, or node merge operations,
 * applying global filters, reassignment calculations, and view re-renders as required.
 *
 * @returns {void}
 */
export function handleMouseUp() {
    if (state.draggingAnchorIndex !== undefined && state.draggingAnchorIndex !== null) {
        state.draggingAnchorIndex = null;
        import('../clusters/api.js').then(api => {
            if (typeof api.search === 'function') api.search();
        });
        draw();
        return;
    }

    if (state.selectionModeActive) {
        state.selectionModeActive = false;
        state.selectionBox = null;

        if (state.selectedNodes && state.selectedNodes.length > 0) {
            state.lassoFilterActive = true;
        } else {
            state.lassoFilterActive = false;
        }

        import('../core/data.js').then(data => {
            if (typeof data.applyGlobalFilters === 'function') data.applyGlobalFilters();
        });

        import('../components/ui.js').then(ui => {
            if (typeof ui.displaySelectedPapersSummary === 'function') {
                ui.displaySelectedPapersSummary();
            }
        });

        if (state.showAnchors && typeof window.recalculateClusterAssignments === 'function') {
            window.recalculateClusterAssignments();
        }
        return;
    }

    // HIERARCHY DRAG RELEASE
    if ((state.viewMode === 'hierarchy' ||state.viewMode === 'hNetwork') && state.isHierarchyNodeDragging) {
        state.isHierarchyNodeDragging = false;

        // Check for merge target with current mouse coordinates
        stopHierarchyDrag(state.mouseX, state.mouseY);

        state.canvas.style.cursor = state.hoveredNode ? 'pointer' : 'default';

        // Simply redraw to keep the card at its custom dragged position
        drawHierarchy();
        return;
    }

    if (state.isDragging) {
        state.isDragging = false;
        state.canvas.style.cursor = state.hoveredNode ? 'pointer' : 'default';

        if (state.viewMode === 'hierarchy' || state.viewMode === 'hNetwork') {
            drawHierarchy();
        } else {
            draw();
        }
    }
}


/**
 * Resets the canvas pan and zoom transformation coordinates back to default scale and origin,
 * triggering a canvas redraw.
 *
 * @returns {void}
 */
export function resetZoom() {
    state.transform = { k: 1, x: 0, y: 0 };
    draw();
}


/**
 * Handles canvas double-click interactions, expanding LOD aggregate nodes to select child elements
 * or routing double-clicks to hierarchy view handlers.
 *
 * @param {MouseEvent} event - The double-click event object.
 * @returns {void}
 */
export function handleCanvasDoubleClick(event) {
    // Intercept double clicks for the hierarchy view
    if (state.viewMode === 'hierarchy' || state.viewMode === 'hNetowrk') {
        if (handleHierarchyDoubleClick(event)) {
            return; // Stop execution if a hierarchy node was successfully double-clicked
        }
    }

    // Handle double-click on LOD (Aggregate) nodes in the scatterplot
    if (state.hoveredNode && state.hoveredNode.isAggregate) {
        const selected = [];
        // Iterate over the currently active dataset
        const baseData = state.filteredData || [];

        // Traverse data to find nodes that eventually collapse into this LOD node
        for (let i = 0; i < baseData.length; i++) {
            let curr = baseData[i];
            let isChild = false;

            // Trace up the LOD chain using the _lod_next reference
            while (curr) {
                if (curr === state.hoveredNode) {
                    isChild = true;
                    break;
                }
                curr = curr._lod_next;
            }

            if (isChild) {
                selected.push(baseData[i]);
            }
        }

        if (selected.length > 0) {
            // Mimic lasso selection tool behavior by setting selected nodes and enabling the filter flag
            state.selectedNodes = selected;
            state.lassoFilterActive = true;

            // Apply filters to only show the selected grouped nodes
            import('../core/data.js').then(data => {
                if (typeof data.applyGlobalFilters === 'function') data.applyGlobalFilters();
            });

            // Update the UI panel summary with the newly selected papers
            import('../components/ui.js').then(ui => {
                if (typeof ui.displaySelectedPapersSummary === 'function') {
                    ui.displaySelectedPapersSummary();
                }
            });

            // Trigger a re-draw to update the canvas
            import('./render.js').then(render => {
                if (typeof render.draw === 'function') render.draw();
            });
        }
    }
}
