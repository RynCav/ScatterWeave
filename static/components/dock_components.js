import { setLodMode } from '../canvas/render.js';
import {makeDraggableAndDockable} from "./dock.js";
import {state} from '../core/state.js';


//Global Window Bindings
if (typeof window !== "undefined") {
    window.updateNetworkUI = updateNetworkUI;

    /**
     * Toggles the display state for AI-generated edge summaries, invalidating graph
     * overlay caches and triggering a canvas redraw.
     *
     * @param {boolean} isChecked - True if AI edge summaries should be enabled, false otherwise.
     * @returns {void}
     */
    window.toggleAIEdgeSummaries = function(isChecked) {
        if (typeof ENABLE_AI_EDGE_SUMMARIES !== 'undefined') {
            ENABLE_AI_EDGE_SUMMARIES = isChecked;
        }
        window.ENABLE_AI_EDGE_SUMMARIES = isChecked;

        if (typeof state !== 'undefined' && state && state.graphData) {
            state.graphData._scatterOverlayCache = null;
        }

        if (typeof draw === "function") draw();
        else if (typeof window.draw === "function") window.draw();
    };

    /**
     * Syncs UI input controls for network settings (keyword filter, max connections, distance cap)
     * to global state and forces a graph overlay cache invalidation and canvas redraw.
     *
     * @returns {void}
     */
    window.updateNetworkParams = function() {
        const keywordElem = document.getElementById('customKeywordInput');
        const connsElem = document.getElementById('networkMaxConnections');
        const distElem = document.getElementById('networkMaxDistance');

        const keyword = keywordElem ? keywordElem.value : "";
        const maxConns = connsElem ? parseInt(connsElem.value, 10) : 1;
        const maxDist = distElem ? parseFloat(distElem.value) : 100;

        if (typeof LOCAL_NEIGHBORS_PER_NODE !== 'undefined') LOCAL_NEIGHBORS_PER_NODE = maxConns;
        if (typeof MAX_SPATIAL_DISTANCE !== 'undefined') MAX_SPATIAL_DISTANCE = maxDist;

        if (typeof state !== 'undefined' && state) {
            state.networkFilterKeyword = keyword;
            state.networkMaxConnections = maxConns;
            state.networkMaxDistance = maxDist;
            if (state.graphData) state.graphData._scatterOverlayCache = null;
        }

        if (typeof draw === "function") draw();
        else if (typeof window.draw === "function") window.draw();
    };

    /**
     * Toggles the visibility of the floating tag legend panel, refreshing
     * the tag dropdown UI state when shown.
     *
     * @returns {void}
     */
    window.toggleBuildTag = function() {
        const container = document.getElementById('floatingTagLegend');
        if (!container) return;

        if (container.style.display === 'none' || container.style.display === '') {
            container.style.display = 'block';

            // Rebuild the dropdown UI to ensure state is up-to-date when opened
            if (typeof buildTagDropdownUI === 'function') {
                buildTagDropdownUI();
            }
        } else {
            container.style.display = 'none';
        }
    };
}


/**
 * Creates and renders the Level of Detail (LOD) & AI Controls UI widget,
 * mounting it either docked within the sidebar or floating over the canvas.
 *
 * @param {boolean} [startDocked=true] - Whether the widget should initially render docked in the sidebar tray.
 * @returns {void}
 */
export function createLodWidget(startDocked = true) {
    const widgetId = 'lodWidget';

    // Remove existing instance if re-creating
    const existing = document.getElementById(widgetId);
    if (existing) existing.remove();

    const sidebar = document.getElementById('sidebar');
    const isDocked = startDocked && sidebar !== null;

    const container = document.createElement('div');
    container.id = widgetId;

    // General typography and base styles (Applied to BOTH docked and floating)
    container.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    container.style.fontSize = '12px';
    container.style.userSelect = 'none';
    container.style.boxSizing = 'border-box';

    // Semi-transparent background with a blur effect for better readability
    container.style.background = 'rgba(255, 255, 255, 0.9)';
    container.style.backdropFilter = 'blur(4px)'; // Adds a nice frosted glass effect
    container.style.WebkitBackdropFilter = 'blur(4px)'; // Safari support

    container.style.borderRadius = '4px';   // Less rounded corners (down from 8px)
    container.style.padding = '8px';        // Standard padding
    container.style.border = 'none';        // No border

    if (isDocked) {
        // --- DOCKED INITIALIZATION ---
        container.classList.add('docked-panel');
    } else {
        // FLOATING INITIALIZATION (FALLBACK)
        container.style.position = 'fixed';
        container.style.top = '100px';
        container.style.left = '20px';
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.height = 'auto';
        container.style.zIndex = '9999';
        container.style.width = '240px';

        // Keep the shadow to separate it from the background since there is no border
        container.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)';
    }

    // Header Bar
    const header = document.createElement('div');
    header.className = 'panel-header drag-handle';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.paddingBottom = '6px';
    header.style.marginBottom = '8px';
    header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.1)';
    header.style.cursor = 'grab';
    header.title = 'Drag to move or dock in sidebar';

    // Title and buttons exactly matching the legend's header layout
    header.innerHTML = `
        <span style="font-size: 12px; font-weight: 700; color: #111827;">LOD & AI Controls</span>
        <div style="display: flex; align-items: center; gap: 4px;">
            <button class="collapse-btn" onclick="window.togglePanelCollapse('${widgetId}')" title="Collapse Panel" style="
                background: transparent; border: none; font-size: 14px; font-weight: bold; 
                color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#9ca3af'">−</button>
            
            <button onclick="window.dockAndCollapse('${widgetId}')" title="Dock to Sidebar & Collapse" style="
                background: transparent; border: none; font-size: 16px; font-weight: 300; 
                color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
        </div>
    `;
    container.appendChild(header);

    // Panel Body
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';

    const applyButtonState = (btn, isActive) => {
        btn.dataset.active = isActive ? 'true' : 'false';
        if (isActive) {
            btn.style.background = '#ffffff'; // Solid white button on top of transparent panel
            btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
            btn.style.color = '#2563eb'; // Blue highlight for active font color
        } else {
            btn.style.background = 'transparent';
            btn.style.boxShadow = 'none';
            btn.style.color = '#374151'; // Default gray for inactive
        }
    };

    const createButtonGroupSection = (title, options, defaultValue, onClickCallback) => {
        const section = document.createElement('div');
        section.style.display = 'flex';
        section.style.flexDirection = 'column';
        section.style.gap = '4px';

        const label = document.createElement('label');
        label.innerText = title;
        label.style.fontSize = '10px';
        label.style.fontWeight = '700';
        label.style.color = '#6b7280';
        label.style.textTransform = 'uppercase';
        label.style.letterSpacing = '0.3px';
        section.appendChild(label);

        const buttonGroup = document.createElement('div');
        buttonGroup.style.display = 'flex';
        buttonGroup.style.background = 'rgba(0, 0, 0, 0.04)'; // Slightly darker transparent background for the pill group
        buttonGroup.style.borderRadius = '4px';
        buttonGroup.style.padding = '2px';
        buttonGroup.style.gap = '2px';
        buttonGroup.style.flexWrap = 'wrap';

        const buttons = [];

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.innerText = opt.text;
            btn.style.flex = '1';
            btn.style.minWidth = opt.text.length > 2 ? '38px' : '20px';
            btn.style.padding = '4px 0';
            btn.style.border = 'none';
            btn.style.borderRadius = '3px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '10px';
            btn.style.fontWeight = '500';
            btn.style.textAlign = 'center';

            const isActive = opt.value === defaultValue;
            applyButtonState(btn, isActive);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                buttons.forEach(b => applyButtonState(b, false));
                applyButtonState(btn, true);
                onClickCallback(opt.value, btn);
            });

            buttons.push(btn);
            buttonGroup.appendChild(btn);
        });

        section.appendChild(buttonGroup);
        return section;
    };

    // LOD Control
    const lodOptions = [
        { value: 'auto', text: 'Auto' },
        { value: '0', text: '0' },
        { value: '1', text: '1' },
        { value: '2', text: '2' },
        { value: '3', text: '3' },
        { value: '4', text: '4' },
        { value: '5', text: '5' },
        { value: '6', text: '6' },
        { value: '7', text: '7' }
    ];

    const lodSection = createButtonGroupSection('LOD Control', lodOptions, 'auto', (value) => {
        if (typeof setLodMode === 'function') {
            setLodMode(value);
        } else if (typeof window.setLodMode === 'function') {
            window.setLodMode(value);
        }
    });
    body.appendChild(lodSection);

    // AI Hover Detail
    const hoverOptions = [
        { value: 'none', text: 'None' },       // Reordered to the left
        { value: 'summary', text: 'Summary' },
        { value: 'keywords', text: 'Keywords' }
    ];

    // Default value changed to 'none'
    const hoverSection = createButtonGroupSection('AI Hover Detail Level', hoverOptions, 'none', (value, btn) => {
        if (typeof window.setHoverMode === 'function') {
            window.setHoverMode(value, btn);
        }
    });
    body.appendChild(hoverSection);

    container.appendChild(body);

    // APPEND TO DOM
    if (isDocked) {
        sidebar.appendChild(container);
    } else {
        const plotContainer = (typeof state !== 'undefined' && state?.canvas?.parentElement)
            ? state.canvas.parentElement
            : null;

        if (plotContainer) {
            plotContainer.style.position = 'relative';
            plotContainer.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
    }

    // Attach drag-and-dock functionality
    if (typeof window.makeDraggableAndDockable === 'function') {
        window.makeDraggableAndDockable(widgetId);
    } else if (typeof makeDraggableAndDockable === 'function') {
        makeDraggableAndDockable(widgetId);
    }
}


/**
 * Creates and mounts the Advanced Search widget panel, providing UI controls
 * for path trajectory parameters, step limits, paper sample sizes, and search execution.
 *
 * @param {boolean} [startDocked=true] - Whether the widget should initially render docked in the sidebar tray.
 * @returns {void}
 */
export function createAdvancedSearchWidget(startDocked = true) {
    const widgetId = 'advancedSearchWidget';

    // Remove existing instance if re-creating
    const existing = document.getElementById(widgetId);
    if (existing) existing.remove();

    const sidebar = document.getElementById('sidebar');
    const isDocked = startDocked && sidebar !== null;

    // Main Container
    const container = document.createElement('div');
    container.id = widgetId;

    // Base styling (Applied to BOTH docked and floating)
    container.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    container.style.userSelect = 'none';
    container.style.boxSizing = 'border-box';
    container.style.background = 'rgba(255, 255, 255, 0.75)';
    container.style.backdropFilter = 'blur(10px)';
    container.style.webkitBackdropFilter = 'blur(10px)';
    container.style.border = '1px solid rgba(229, 231, 235, 0.8)';
    container.style.borderRadius = '8px';
    container.style.padding = '10px';

    if (isDocked) {
        //DOCKED INITIALIZATION
        container.classList.add('docked-panel');
    } else {
        // FLOATING INITIALIZATION (FALLBACK)
        container.style.position = 'fixed';
        container.style.top = '100px';
        container.style.left = '280px';
        container.style.zIndex = '9999';
        container.style.width = '260px';
        container.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)';
    }

    // Shared styles mapped directly from updateLegend
    const labelStyle = "font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;";
    const inputStyle = "width: 100%; box-sizing: border-box; font-size: 11px; font-weight: 500; padding: 5px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background-color: #f9fafb; color: #374151; outline: none; transition: all 0.15s ease;";
    const inputFocus = "onfocus=\"this.style.borderColor='#3b82f6'; this.style.backgroundColor='#ffffff';\" onblur=\"this.style.borderColor='#e5e7eb'; this.style.backgroundColor='#f9fafb';\"";

    //  Template HTML
    container.innerHTML = `
        <!-- HEADER BAR -->
        <div class="panel-header drag-handle" style="
            display: flex; align-items: center; justify-content: space-between; 
            padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; 
            cursor: grab; user-select: none;
        " title="Drag to move or dock in sidebar">
            <span style="font-size: 12px; font-weight: 700; color: #111827;">Advanced Search</span>
            
            <div style="display: flex; align-items: center; gap: 4px;">
                <button class="collapse-btn" onclick="window.togglePanelCollapse('${widgetId}')" title="Collapse Panel" style="
                    background: transparent; border: none; font-size: 14px; font-weight: bold; 
                    color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
                " onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#9ca3af'">−</button>
                
                <button onclick="window.dockAndCollapse('${widgetId}')" title="Dock to Sidebar & Collapse" style="
                    background: transparent; border: none; font-size: 16px; font-weight: 300; 
                    color: #9ca3af; cursor: pointer; padding: 2px 5px; line-height: 1; transition: color 0.2s;
                " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
            </div>
        </div>

        <!-- PANEL BODY -->
        <div class="panel-body" style="display: flex; flex-direction: column; gap: 8px;">
            
            <!-- Origin Input -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label for="query1" style="${labelStyle}">Start / Origin Point</label>
                <input type="text" id="query1" placeholder="e.g., Quantum Computing" style="${inputStyle}" ${inputFocus}>
            </div>

            <!-- Goal Input -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label for="goal" style="${labelStyle}">Search Goal</label>
                <input type="text" id="goal" placeholder="Target destination..." style="${inputStyle}" ${inputFocus}>
            </div>

            <!-- Labels Toggle -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="${labelStyle}">Labels</label>
                <div style="display: flex; background: #f3f4f6; border-radius: 4px; padding: 2px; gap: 2px;">
                    <button class="adv-search-toggle-btn active" data-mode="keywords" style="flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #2563eb;">Keywords</button>
                    <button class="adv-search-toggle-btn" data-mode="summary" style="flex: 1; border: none; font-size: 10px; padding: 4px 0; border-radius: 3px; cursor: pointer; font-weight: 500; background: transparent; box-shadow: none; color: #6b7280;">Summary</button>
                </div>
            </div>

            <!-- Number Inputs Row -->
            <div style="display: flex; gap: 8px;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <label for="steps" style="${labelStyle}">Max Steps (s)</label>
                    <input id="steps" type="number" min="1" max="100" value="10" style="${inputStyle}" ${inputFocus}>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <label for="papers" style="${labelStyle}">Papers (k)</label>
                    <input id="papers" type="number" min="1" max="100" value="5" style="${inputStyle}" ${inputFocus}>
                </div>
            </div>

            <!-- Search Button -->
            <button id="advSearchSubmitBtn" style="
                width: 100%; padding: 8px; margin-top: 4px; background: #2563eb; color: #ffffff; 
                border: none; border-radius: 6px; font-size: 11px; font-weight: 600; 
                cursor: pointer; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.3); transition: background 0.15s ease;
            " onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">
                Calculate Path
            </button>
        </div>
    `;

    // --- Wire up event listeners ---
    const toggleButtons = container.querySelectorAll('.adv-search-toggle-btn');
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Reset styles on all buttons
            toggleButtons.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.boxShadow = 'none';
                b.style.color = '#6b7280'; // Default gray for inactive
            });

            // Set active style on clicked button with blue text
            btn.classList.add('active');
            btn.style.background = '#ffffff';
            btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';
            btn.style.color = '#2563eb'; // Blue highlight

            // Trigger corresponding global logic
            const val = btn.getAttribute('data-mode');
            if (typeof selectSearchLabelOption === 'function') {
                selectSearchLabelOption(btn, val);
            } else if (typeof window.selectSearchLabelOption === 'function') {
                window.selectSearchLabelOption(btn, val);
            }
        });
    });

    const searchBtn = container.querySelector('#advSearchSubmitBtn');
    searchBtn.addEventListener('click', () => {
        if (typeof search === 'function') search();
        else if (typeof window.search === 'function') window.search();
    });

    // --- Append to Target Container ---
    if (isDocked) {
        sidebar.appendChild(container);
    } else {
        const plotContainer = (typeof state !== 'undefined' && state?.canvas?.parentElement)
            ? state.canvas.parentElement
            : null;

        if (plotContainer) {
            plotContainer.style.position = 'relative';
            plotContainer.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
    }

    // --- Make Panel Draggable & Dockable ---
    if (typeof window.makeDraggableAndDockable === 'function') {
        window.makeDraggableAndDockable(widgetId);
    } else if (typeof makeDraggableAndDockable === 'function') {
        makeDraggableAndDockable(widgetId);
    }
}


/**
 * Renders or updates the Network Configuration UI dialog panel, setting input controls
 * for AI edge summaries, local neighbor limits, distance thresholds, and connection filtering.
 *
 * @param {boolean} [startDocked=true] - Whether the dialog panel should initially render docked in the sidebar tray.
 * @returns {void}
 */
export function updateNetworkUI(startDocked = true) {
    const dialogId = 'networkDialog';

    // Remove existing instance if re-creating
    const existing = document.getElementById(dialogId);
    if (existing) existing.remove();

    const sidebar = document.getElementById('sidebar');
    const isDocked = startDocked && sidebar !== null;

    const dialog = document.createElement('div');
    dialog.id = dialogId;

    // Base Typography & Styling (Applied to BOTH docked and floating)
    dialog.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    dialog.style.fontSize = '12px';
    dialog.style.userSelect = 'none';
    dialog.style.boxSizing = 'border-box';

    // Semi-transparent background with blur effect for readability when floating
    dialog.style.background = 'rgba(255, 255, 255, 0.9)';
    dialog.style.backdropFilter = 'blur(4px)';
    dialog.style.WebkitBackdropFilter = 'blur(4px)';

    dialog.style.borderRadius = '4px';
    dialog.style.padding = '8px';
    dialog.style.border = 'none';

    if (isDocked) {
        // DOCKED INITIALIZATION
        dialog.classList.add('docked-panel');
    } else {
        // FLOATING INITIALIZATION
        dialog.style.position = 'fixed';
        dialog.style.top = '100px';
        dialog.style.left = '20px';
        dialog.style.bottom = 'auto';
        dialog.style.right = 'auto';
        dialog.style.height = 'auto';
        dialog.style.zIndex = '9999';
        dialog.style.width = '260px';
        dialog.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)';
    }

    // Pull current parameter values from state or globals
    const currentMaxConns = (typeof state !== 'undefined' && state.networkMaxConnections !== undefined)
        ? state.networkMaxConnections
        : (typeof LOCAL_NEIGHBORS_PER_NODE !== 'undefined' ? LOCAL_NEIGHBORS_PER_NODE : 1);

    const currentMaxDist = (typeof state !== 'undefined' && state.networkMaxDistance !== undefined)
        ? state.networkMaxDistance
        : (typeof MAX_SPATIAL_DISTANCE !== 'undefined' ? MAX_SPATIAL_DISTANCE : 100);

    const currentKeyword = (typeof state !== 'undefined' && state.networkFilterKeyword !== undefined)
        ? state.networkFilterKeyword
        : '';

    const isAiEdgesChecked = (typeof ENABLE_AI_EDGE_SUMMARIES !== 'undefined')
        ? ENABLE_AI_EDGE_SUMMARIES
        : false;

    // --- 1. TALLER HEADER BAR ---
    const header = document.createElement('div');
    header.className = 'panel-header drag-handle';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '10px 4px 8px 4px';
    header.style.marginBottom = '8px';
    header.style.minHeight = '42px';
    header.style.boxSizing = 'border-box';
    header.style.borderBottom = '1px solid rgba(0, 0, 0, 0.1)';
    header.style.cursor = 'grab';
    header.title = 'Drag to move or dock in sidebar';

    header.innerHTML = `
        <span style="font-size: 13px; font-weight: 700; color: #111827;">Network Configuration</span>
        
        <div style="display: flex; align-items: center; gap: 6px;">
            <button class="collapse-btn" onclick="window.togglePanelCollapse('${dialogId}')" title="Collapse Panel" style="
                background: transparent; border: none; font-size: 16px; font-weight: bold; 
                color: #9ca3af; cursor: pointer; padding: 2px 6px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#9ca3af'">−</button>
            
            <button onclick="window.dockAndCollapse('${dialogId}')" title="Dock to Sidebar & Collapse" style="
                background: transparent; border: none; font-size: 18px; font-weight: 300; 
                color: #9ca3af; cursor: pointer; padding: 2px 6px; line-height: 1; transition: color 0.2s;
            " onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">×</button>
        </div>
    `;
    dialog.appendChild(header);

    // --- 2. BODY CONTENT ---
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';

    body.innerHTML = `
        <!-- AI Edge Summaries Checkbox -->
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; font-weight: 600; color: #374151;">
            <input type="checkbox" id="aiEdgeSummaryCheckbox" ${isAiEdgesChecked ? 'checked' : ''} style="margin: 0; width: 13px; height: 13px; accent-color: #2563eb;" />
            Enable AI Edge Summaries
        </label>

        <!-- Connections Search Input -->
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="customKeywordInput" style="font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Connections Search</label>
            <input id="customKeywordInput" type="text" placeholder="Enter keywords..." value="${currentKeyword}" style="
                width: 100%; box-sizing: border-box; font-size: 11px; font-weight: 500; padding: 5px 8px; 
                border: 1px solid #e5e7eb; border-radius: 4px; background-color: #f9fafb; 
                color: #374151; outline: none; transition: all 0.15s ease;
            " onfocus="this.style.borderColor='#3b82f6'; this.style.backgroundColor='#ffffff';" onblur="this.style.borderColor='#e5e7eb'; this.style.backgroundColor='#f9fafb';" />
        </div>

        <!-- Parameters Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label for="networkMaxConnections" style="font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Max Conns (k)</label>
                <input id="networkMaxConnections" type="number" min="1" max="50" value="${currentMaxConns}" style="
                    width: 100%; box-sizing: border-box; font-size: 11px; font-weight: 500; padding: 5px 6px; 
                    border: 1px solid #e5e7eb; border-radius: 4px; background-color: #f9fafb; 
                    color: #374151; outline: none; text-align: center;
                " />
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label for="networkMaxDistance" style="font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px;">Max Distance</label>
                <input id="networkMaxDistance" type="number" min="1" value="${currentMaxDist}" style="
                    width: 100%; box-sizing: border-box; font-size: 11px; font-weight: 500; padding: 5px 6px; 
                    border: 1px solid #e5e7eb; border-radius: 4px; background-color: #f9fafb; 
                    color: #374151; outline: none; text-align: center;
                " />
            </div>
        </div>
    `;

    dialog.appendChild(body);

    // --- APPEND TO DOM ---
    if (isDocked) {
        sidebar.appendChild(dialog);
    } else {
        const plotContainer = (typeof state !== 'undefined' && state?.canvas?.parentElement)
            ? state.canvas.parentElement
            : null;

        if (plotContainer) {
            plotContainer.style.position = 'relative';
            plotContainer.appendChild(dialog);
        } else {
            document.body.appendChild(dialog);
        }
    }

    // Attach Event Listeners
    const aiSummaryChk = document.getElementById('aiEdgeSummaryCheckbox');
    if (aiSummaryChk) {
        aiSummaryChk.addEventListener('change', (e) => {
            window.toggleAIEdgeSummaries(e.target.checked);
        });
    }

    const keywordInput = document.getElementById('customKeywordInput');
    const connsInput = document.getElementById('networkMaxConnections');
    const distInput = document.getElementById('networkMaxDistance');

    [keywordInput, connsInput, distInput].forEach(elem => {
        if (elem) elem.addEventListener('input', () => window.updateNetworkParams());
    });

    // Make Draggable & Dockable
    if (typeof window.makeDraggableAndDockable === 'function') {
        window.makeDraggableAndDockable(dialogId);
    } else if (typeof makeDraggableAndDockable === 'function') {
        makeDraggableAndDockable(dialogId);
    }
}
