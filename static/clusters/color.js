import {state} from "../core/state.js";
import {updateLegend} from "../components/global_legend.js";

//Global Window Bindings
if (typeof window !== "undefined") {
    window.getMetaClusterColor = getMetaClusterColor;
    window.getClusterColor = getClusterColor;
}

const gradientChk = document.getElementById("legendGradient");

const tagColorCache = new Map();
const TABLEAU_PALETTE = [
    '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
    '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'
];

const REGION_PALETTES = [
    ["#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#2dd4bf", "#67e8f9"], // Cool Blues
    ["#ef4444", "#f97316", "#f59e0b", "#fbbf24", "#fca5a5", "#fdba74"], // Warm Sunset
    ["#10b981", "#22c55e", "#84cc16", "#a3e635", "#6ee7b7", "#86efac"], // Nature
    ["#8b5cf6", "#a855f7", "#d946ef", "#e879f9", "#c084fc", "#f472b6"], // Twilight
    ["#eab308", "#ca8a04", "#a16207", "#fde047", "#fef08a", "#d97706"]  // Amber
];

const metaClusterPalette = [
    0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd, 0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
    0x393b79, 0x5254a3, 0x6b6ecf, 0x9c9ede, 0x637939, 0x8ca252, 0xb5cf6b, 0xcedb9c, 0x8c6d31, 0xbd9e39,
    0xe7ba52, 0xe7cb94, 0x843c39, 0xad494a, 0xd6616b, 0xe7969c, 0x7b4173, 0xa55194, 0xce6dbd, 0xde9ed6,
    0x3182bd, 0x6baed6, 0x9ecae1, 0xc6dbef, 0xe6550d, 0xfd8d3c, 0xfdae6b, 0xfdd0a2, 0x31a354, 0x74c476
];


/**
 * Converts a hex color string to an RGB numeric array.
 * @param {string} hexStr - Hex color code (e.g., "#FF0000" or "#F00").
 * @returns {number[]} Array containing [red, green, blue] byte values (0-255).
 */
export function hexToRgb(hexStr) {
    if (!hexStr) return [156, 163, 175];
    let hex = String(hexStr).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
    const bigint = parseInt(hex, 16);
    if (isNaN(bigint)) return [156, 163, 175];
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}


/**
 * Applies an alpha transparency value to Hex (#RGB, #RRGGBB) or RGB color strings.
 * @param {string} color - Hex or RGB/RGBA color string.
 * @param {number} alpha - Desired alpha transparency float (0.0 to 1.0).
 * @returns {string} Formatted RGBA color string or unchanged fallback color.
 */
export function applyAlphaToColor(color, alpha) {
    if (!color) return `rgba(156, 163, 175, ${alpha})`;

    // Hex (#RGB or #RRGGBB)
    if (color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }

    // rgb() or rgba()
    if (color.startsWith('rgb')) {
        const match = color.match(/\d+(\.\d+)?/g);
        if (match && match.length >= 3) {
            return `rgba(${match[0]}, ${match[1]}, ${match[2]}, ${alpha})`;
        }
    }

    return color;
}


/**
 * Converts a hexadecimal color string to HSL (Hue, Saturation, Lightness) format.
 *
 * @param {string} hex - Hexadecimal color string (e.g., "#ff0000").
 * @returns {Array<number>} Array containing [hue (0–360), saturation (0–1), lightness (0–1)].
 */
function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max == min) h = s = 0;
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}


/**
 * Converts HSL (Hue, Saturation, Lightness) color values to a hexadecimal color string.
 *
 * @param {number} h - Hue angle in degrees (0–360).
 * @param {number} s - Saturation fraction (0–1).
 * @param {number} l - Lightness fraction (0–1).
 * @returns {string} Hexadecimal color string (e.g., "#ff0000").
 */
function hslToHex(h, s, l) {
    h /= 360; let r, g, b;
    if (s === 0) r = g = b = l;
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    const toHex = x => { const hex = Math.round(x * 255).toString(16); return hex.length === 1 ? '0' + hex : hex; };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}


/**
 * Resolves the primary base color for a given cluster ID based on region palette settings.
 *
 * @param {number|string} cId - Cluster identifier.
 * @returns {string} Hexadecimal color string.
 */
export function getClusterColor(cId) {
    if (cId === -1 || cId === "-1") return "#9ca3af"; // Noise

    const numRegions = state.regionCountCache || 1;
    const baseIdx = Math.max(0, parseInt(cId) || 0);


    if (numRegions <= 1) return TABLEAU_PALETTE[0];

    //Multi-Region Active
    const paletteIdx = baseIdx % 5;
    const generation = Math.floor(baseIdx / 5);

    let hex = REGION_PALETTES[paletteIdx][0];
    if (generation > 0) {
        let [h, s, l] = hexToHsl(hex);
        l = Math.max(0.15, l - (0.15 * generation));
        hex = hslToHex(h, s, l);
    }

    return hex;
}


/**
 * Resolves a visual color for a subcluster based on its hierarchy path, depth, and region palette settings.
 *
 * @param {number|string} cId - Parent cluster identifier.
 * @param {string|number} path - Subcluster hierarchy path string (e.g., "0-1" or "2").
 * @returns {string} Hexadecimal color string.
 */
export function getSubClusterColor(cId, path) {

    const rawSplit = String(path).split('-');
    const parts = [];
    for (let i = 0; i < rawSplit.length; i++) {
        if (rawSplit[i] === "") {

            if (i + 1 < rawSplit.length) {
                parts.push("-" + rawSplit[i + 1]);
                i++;
            }
        } else parts.push(rawSplit[i]);

    }
    const depth = parts.length;


    if (parts.length > 0 && parseInt(parts[parts.length - 1], 10) === -1) {
        return "#9ca3af"; // Sub-Noise (Grey)
    }

    const numRegions = state.regionCountCache || 1;


    if (numRegions <= 1) {

        const rootToken = Math.abs(parseInt(parts[0])) || 0;
        let baseHex = TABLEAU_PALETTE[rootToken % TABLEAU_PALETTE.length];

        if (depth <= 1) return baseHex;

        const lastToken = Math.abs(parseInt(parts[parts.length - 1])) || 0;
        let [h, s, l] = hexToHsl(baseHex);


        if (lastToken === 0 && depth === 2) {
            return baseHex;
        }

        //DYNAMIC HUE SHIFT
        const isEven = lastToken % 2 === 0;
        const direction = isEven ? 1 : -1;
        const shiftMag = 10 + (Math.floor((lastToken - 1) / 2) * 8);
        const hueShift = direction * Math.min(shiftMag, 35);
        h = (h + hueShift + 360) % 360;


        s = Math.min(0.98, Math.max(0.65, s + 0.25));


        const lightMag = 0.15 + (Math.floor((lastToken - 1) / 2) * 0.08);
        const lightShift = direction === -1 ? -lightMag : lightMag;

        const depthDim = Math.max(0, depth - 2) * 0.04;
        l = Math.max(0.20, Math.min(0.85, l + lightShift - depthDim));

        return hslToHex(h, s, l);
    }


    const baseIdx = Math.max(0, parseInt(cId) || 0);
    const paletteIdx = baseIdx % REGION_PALETTES.length;
    const generation = Math.floor(baseIdx / REGION_PALETTES.length);
    const palette = REGION_PALETTES[paletteIdx];

    const token = Math.abs(parseInt(parts[parts.length - 1])) || 0;


    let colorIdx = (1 + token + depth) % palette.length;
    if (colorIdx === 0) colorIdx = 1;

    let hex = palette[colorIdx];
    if (generation > 0) {
        let [h, s, l] = hexToHsl(hex);
        l = Math.max(0.15, l - (0.15 * generation));
        hex = hslToHex(h, s, l);
    }

    return hex;
}


/**
 * Resolves a visual color for a tag subcluster based on tag index, depth, and region palette settings.
 *
 * @param {string} tagName - Tag category identifier.
 * @param {number} [tagIndex] - Numerical index associated with the tag.
 * @param {string|number} [path] - Subcluster hierarchy path string.
 * @returns {string} Hexadecimal color string.
 */
export function getTagSubClusterColor(tagName, tagIndex, path) {
    if (!path) return getTagRegionColor(tagName, tagIndex);

    // 1. Path parsing (accounts for negatives)
    const rawSplit = String(path).split('-');
    const parts = [];
    for (let i = 0; i < rawSplit.length; i++) {
        if (rawSplit[i] === "") {
            if (i + 1 < rawSplit.length) {
                parts.push("-" + rawSplit[i + 1]);
                i++;
            }
        } else parts.push(rawSplit[i]);
    }
    const depth = parts.length;

    // 2. Sub-Noise check
    if (parts.length > 0 && parseInt(parts[parts.length - 1], 10) === -1) {
        return "#9ca3af"; // Sub-Noise (Grey)
    }

    const numRegions = state.regionCountCache || 1;

    // 3. SINGLE REGION MODE (Dynamic Hue Shift)
    if (numRegions <= 1) {
        // Use the root tag's color as the base rather than a Tableau fallback
        let baseHex = getTagRegionColor(tagName, tagIndex);
        const lastToken = Math.abs(parseInt(parts[parts.length - 1])) || 0;

        // If it's the primary/first sub-cluster, let it inherit the exact parent color
        if (lastToken === 0) return baseHex;

        let [h, s, l] = hexToHsl(baseHex);

        // DYNAMIC HUE SHIFT
        const isEven = lastToken % 2 === 0;
        const direction = isEven ? 1 : -1;
        const shiftMag = 10 + (Math.floor((lastToken - 1) / 2) * 8);
        const hueShift = direction * Math.min(shiftMag, 35);
        h = (h + hueShift + 360) % 360;

        s = Math.min(0.98, Math.max(0.65, s + 0.25));

        const lightMag = 0.15 + (Math.floor((lastToken - 1) / 2) * 0.08);
        const lightShift = direction === -1 ? -lightMag : lightMag;

        const depthDim = Math.max(0, depth - 1) * 0.04;
        l = Math.max(0.20, Math.min(0.85, l + lightShift - depthDim));

        return hslToHex(h, s, l);
    }

    // 4. MULTI-REGION MODE (Palette Indexing)
    const baseIdx = Math.max(0, tagIndex ?? tagColorCache.size);
    const paletteIdx = baseIdx % REGION_PALETTES.length;
    const generation = Math.floor(baseIdx / REGION_PALETTES.length);
    const palette = REGION_PALETTES[paletteIdx];

    const token = Math.abs(parseInt(parts[parts.length - 1])) || 0;

    let colorIdx = (1 + token + depth) % palette.length;
    if (colorIdx === 0) colorIdx = 1; // Avoid hitting the root index

    let hex = palette[colorIdx];
    if (generation > 0) {
        let [h, s, l] = hexToHsl(hex);
        l = Math.max(0.15, l - (0.15 * generation));
        hex = hslToHex(h, s, l);
    }

    return hex;
}

/**
 * Generates a deterministic color integer for a meta-cluster category name using string hashing.
 *
 * @param {string} metaName - Name of the meta-cluster category.
 * @returns {number} Hexadecimal integer color value (e.g., 0x1f77b4).
 */
export function getMetaClusterColor(metaName) {
    if (!metaName) return 0x7f7f7f;

    // Simple deterministic string hashing to map name to palette index safely
    let hash = 0;
    for (let i = 0; i < metaName.length; i++) {
        hash = metaName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % metaClusterPalette.length;
    return metaClusterPalette[idx];
}


/**
 * Retrieves or caches a regional color for a specified tag name.
 *
 * @param {string} tagName - Tag category identifier.
 * @param {number} [tagIndex] - Optional numerical index for palette positioning.
 * @returns {string} Hexadecimal color string.
 */
export function getTagRegionColor(tagName, tagIndex) {
    if (!tagName || tagName.toLowerCase() === 'noise') return "#9ca3af";

    // Check if we already computed this tag's color
    if (tagColorCache.has(tagName)) return tagColorCache.get(tagName);

    // Default to the index provided, or use the size of the cache as the index
    const baseIdx = Math.max(0, tagIndex ?? tagColorCache.size);

    const paletteIdx = baseIdx % 5;
    const generation = Math.floor(baseIdx / 5);

    // Assuming REGION_PALETTES is globally accessible
    let hex = REGION_PALETTES[paletteIdx][0];

    if (generation > 0) {
        // Assuming hexToHsl and hslToHex are globally accessible
        let [h, s, l] = hexToHsl(hex);
        l = Math.max(0.15, l - (0.15 * generation));
        hex = hslToHex(h, s, l);
    }

    tagColorCache.set(tagName, hex);
    return hex;
}


/**
 * Calculates inverse-distance weighted color gradients across dataset nodes based on spatial distance
 * from cluster anchors, writing the computed `_gradientColor` property onto each node.
 *
 * @returns {void}
 */
export function applyGradientColors() {
    if (!state.useGradientColors || !state.allData) return;

    const anchorsMap = new Map();
    const data = state.filteredData && state.filteredData.length > 0 ? state.filteredData : state.allData;

    data.forEach(d => {
        const rootId = d.cluster !== undefined && d.cluster !== null ? parseInt(d.cluster, 10) : -1;
        if (rootId === -1) return;

        let pathStr = (d.sub_path !== undefined && d.sub_path !== null && String(d.sub_path) !== "") ? String(d.sub_path) :
                      (d.sub_cluster !== undefined && d.sub_cluster !== null ? String(d.sub_cluster) : "");

        const fullPathKey = pathStr !== "" ? `${rootId}-${pathStr}` : String(rootId);

        if (!anchorsMap.has(fullPathKey)) {
            const hex = pathStr !== "" ? getSubClusterColor(rootId, pathStr) : getClusterColor(rootId);
            anchorsMap.set(fullPathKey, { xSum: 0, ySum: 0, count: 0, hex: hex });
        }

        const a = anchorsMap.get(fullPathKey);
        a.xSum += d.x;
        a.ySum += d.y;
        a.count += 1;
    });

    const anchors = Array.from(anchorsMap.values()).map(a => {
        let hexStr = a.hex ? String(a.hex).replace('#', '') : "9ca3af";
        if (hexStr.length === 3) hexStr = hexStr.split('').map(c => c + c).join('');
        const num = parseInt(hexStr, 16) || 0x9ca3af;
        return {
            x: a.xSum / a.count,
            y: a.ySum / a.count,
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    });

    if (anchors.length === 0) return;


    state.allData.forEach(node => {
        const rootId = node.cluster !== undefined && node.cluster !== null ? parseInt(node.cluster, 10) : -1;
        if (rootId === -1) {
            node._gradientColor = "#9ca3af"; // Noise is always grey
            return;
        }

        let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

        for (let i = 0; i < anchors.length; i++) {
            const a = anchors[i];
            const dx = node.x - a.x;
            const dy = node.y - a.y;
            // The + 0.0001 prevents dividing by zero if a point sits perfectly on the anchor!
            const distSq = (dx * dx) + (dy * dy) + 0.0001;

            // Weight = 1 / d^4 (Keeps colors pure near the center, blending at the borders)
            const w = 1.0 / (distSq * distSq);
            wSum += w;
            rSum += a.r * w;
            gSum += a.g * w;
            bSum += a.b * w;
        }

        const fR = Math.min(255, Math.max(0, Math.round(rSum / wSum)));
        const fG = Math.min(255, Math.max(0, Math.round(gSum / wSum)));
        const fB = Math.min(255, Math.max(0, Math.round(bSum / wSum)));

        node._gradientColor = `#${(1 << 24 | fR << 16 | fG << 8 | fB).toString(16).slice(1)}`;
    });
}


/**
 * Evaluates node properties and active rendering settings to return the effective visual color string.
 *
 * @param {Object} node - Target data node object.
 * @param {number|string} [node.cluster] - Root cluster ID.
 * @param {string} [node.sub_path] - Subcluster hierarchy path string.
 * @param {string} [node.sub_cluster] - Alternative subcluster identifier.
 * @param {string} [node._gradientColor] - Precomputed gradient color string.
 * @returns {string} Resolved hexadecimal color code.
 */
export function getNodeColor(node) {
    if (state.useGradientColors && node._gradientColor)  return node._gradientColor;

    const rootId = node.cluster !== undefined && node.cluster !== null ? parseInt(node.cluster, 10) : -1;
    if (rootId === -1) return "#9ca3af";

    let pathStr = (node.sub_path !== undefined && node.sub_path !== null && String(node.sub_path) !== "") ? String(node.sub_path) :
                  (node.sub_cluster !== undefined && node.sub_cluster !== null ? String(node.sub_cluster) : "");

    if (pathStr !== "") return getSubClusterColor(rootId, pathStr);

    return getClusterColor(rootId);
}


if (gradientChk) {
    gradientChk.addEventListener("change", (e) => {
        state.useGradientColors = e.target.checked;

            //calculate the gradient when true
            if (state.useGradientColors) {
                applyGradientColors();
            }

            updateLegend();
            import('../canvas/render.js').then(r => { if (typeof r.draw === 'function') r.draw(); });
        });
    }
