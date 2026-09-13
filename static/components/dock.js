export function toggleDock(elementId) {
    const el = document.getElementById(elementId);
    const sidebar = document.getElementById('sidebar');

    if (!el || !sidebar) return;

    if (el.classList.contains('docked-panel')) {
        // Undock: Remove class and move back to the body
        el.classList.remove('docked-panel');
        document.body.appendChild(el);
    } else {
        // Dock: Add class and append to the bottom of the sidebar
        el.classList.add('docked-panel');
        sidebar.appendChild(el);
    }
}


//Global Window Bindings
if (typeof window !== "undefined") {
    window.toggleDock = toggleDock;
    window.togglePanelCollapse = togglePanelCollapse;
    window.dockAndCollapse = dockAndCollapse;
}


/**
 * Attaches drag, drop, and docking event listeners to a DOM element, enabling it to be
 * dragged across the viewport, docked into the sidebar container, or collapsed on click.
 *
 * @param {string} elementId - The HTML element ID of the target UI panel.
 * @returns {void}
 */
export function makeDraggableAndDockable(elementId) {
    const el = document.getElementById(elementId);
    const sidebar = document.getElementById('sidebar');
    if (!el || !sidebar) return;

    // Prevent duplicate event listener attachments on re-renders
    if (el.dataset.dragInitialized === "true") return;
    el.dataset.dragInitialized = "true";

    let isMouseDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    const dragThreshold = 5; // Movement threshold in pixels to differentiate click from drag

    el.addEventListener('mousedown', (e) => {
        // Prevent dragging if clicking buttons, inputs, selects, or items
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('.legend-drag-item')) return;

        // Ensure clicking/dragging only triggers from the panel header
        const header = el.querySelector('.panel-header');
        if (header && !header.contains(e.target)) return;

        isMouseDown = true;
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = el.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isMouseDown) return;

        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);

        // Transition from click candidate to active drag ONLY if mouse moved past threshold
        if (!isDragging && (deltaX > dragThreshold || deltaY > dragThreshold)) {
            isDragging = true;

            // Pick up / undock panel now that dragging has officially started
            if (el.classList.contains('docked-panel')) {
                el.classList.remove('docked-panel');
                document.body.appendChild(el);
            }

            el.style.position = 'fixed';
            el.style.left = (e.clientX - offsetX) + 'px';
            el.style.top = (e.clientY - offsetY) + 'px';
            el.style.margin = '0';
        }

        if (isDragging) {
            // Move panel
            el.style.left = (e.clientX - offsetX) + 'px';
            el.style.top = (e.clientY - offsetY) + 'px';

            // Highlight sidebar if hovering over it
            const sidebarRect = sidebar.getBoundingClientRect();
            if (e.clientX >= sidebarRect.left && e.clientX <= sidebarRect.right &&
                e.clientY >= sidebarRect.top && e.clientY <= sidebarRect.bottom) {
                sidebar.classList.add('sidebar-drop-target');
            } else {
                sidebar.classList.remove('sidebar-drop-target');
            }
        }
    }

    function onMouseUp(e) {
        if (!isMouseDown) return;

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        sidebar.classList.remove('sidebar-drop-target');

        if (!isDragging) {
            // --- NORMAL CLICK DETECTED ---
            togglePanelCollapse(elementId);
        } else {
            // --- DRAG COMPLETED ---
            const sidebarRect = sidebar.getBoundingClientRect();
            if (e.clientX >= sidebarRect.left && e.clientX <= sidebarRect.right &&
                e.clientY >= sidebarRect.top && e.clientY <= sidebarRect.bottom) {

                // Dock into sidebar
                el.classList.add('docked-panel');
                sidebar.appendChild(el);

                el.style.position = '';
                el.style.left = '';
                el.style.top = '';
            }
        }

        isMouseDown = false;
        isDragging = false;
    }
}


/**
 * Toggles the collapsed state class of a specified panel element and updates its toggle button text and title.
 *
 * @param {string} elementId - The HTML element ID of the panel to toggle.
 * @returns {void}
 */
export function togglePanelCollapse(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const isCollapsed = el.classList.toggle('is-collapsed');

    // Update button icon (+ or −)
    const btn = el.querySelector('.collapse-btn');
    if (btn) {
        btn.innerHTML = isCollapsed ? '+' : '−';
        btn.title = isCollapsed ? 'Expand Panel' : 'Collapse Panel';
    }
}


/**
 * Docks a floating panel element into the sidebar container, resets inline positioning styles,
 * and forces the panel into a collapsed state.
 *
 * @param {string} elementId - The HTML element ID of the panel to dock and collapse.
 * @returns {void}
 */
export function dockAndCollapse(elementId) {
    const el = document.getElementById(elementId);
    const sidebar = document.getElementById('sidebar');
    if (!el || !sidebar) return;

    // Move into sidebar and apply docked styling
    el.classList.add('docked-panel');
    sidebar.appendChild(el);

    // Reset inline floating positioning
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';

    // Force collapsed state
    if (!el.classList.contains('is-collapsed')) {
        togglePanelCollapse(elementId);
    }
}
