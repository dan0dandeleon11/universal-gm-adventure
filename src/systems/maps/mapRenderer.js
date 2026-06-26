/**
 * Map Renderer — HTML output for the RPG panel
 * Generates inline-styled HTML for overworld grids and dungeon node-graphs.
 *
 * @module systems/maps/mapRenderer
 */

// ─── Terrain Color Palette (dark-theme friendly) ────────────────────────────

/** @type {Record<string, string>} */
const TERRAIN_COLORS = {
    plains:   '#4a7a3b',
    forest:   '#2d5a1e',
    mountain: '#6b6b6b',
    water:    '#2a5a8c',
    desert:   '#b8943e',
    swamp:    '#4a5a3a',
    urban:    '#7a6a5a',
    ruins:    '#5a4a4a',
};

/** @type {Record<string, string>} */
const NODE_TYPE_ICONS = {
    entrance:  '🚪',
    exit:      '🏁',
    room:      '◻',
    corridor:  '━',
    boss:      '💀',
    treasure:  '💎',
    trap:      '⚠',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render the map as an HTML string for the RPG companion panel.
 *
 * @param {object} mapState — the rpgMap state object from chat_metadata
 * @returns {string} HTML string
 */
export function renderMapHTML(mapState) {
    if (!mapState) {
        return '<div class="rpg-map-empty" style="color:#888;padding:8px;font-style:italic;">No map data.</div>';
    }

    if (mapState.type === 'overworld') {
        return renderOverworld(mapState);
    }
    return renderDungeon(mapState);
}

// ─── Overworld Grid ──────────────────────────────────────────────────────────

/**
 * Render an overworld grid as a CSS-grid of colored cells.
 * @param {object} state
 * @returns {string}
 */
function renderOverworld(state) {
    const grid = state.grid;
    if (!grid || grid.length === 0) return '<div class="rpg-map-empty">Empty grid.</div>';

    const cols = grid[0].length;
    const pos = state.playerPosition;
    const fogEnabled = true; // always render fog mask, engine controls discovery

    let cellsHTML = '';
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < cols; x++) {
            const cell = grid[y][x];
            const isPlayer = (x === pos.x && y === pos.y);

            if (!cell.discovered && fogEnabled) {
                cellsHTML += `<div class="rpg-map-cell rpg-map-fog" style="background:#1a1a2e;border:1px solid #252540;" title="Undiscovered"></div>`;
                continue;
            }

            const bg = TERRAIN_COLORS[cell.terrain] || '#333';
            const visitedOpacity = cell.visited ? '1' : '0.6';
            const poiDot = cell.poi ? '<span style="position:absolute;top:1px;right:2px;font-size:7px;color:#ffcc00;">★</span>' : '';
            const dangerMark = cell.dangerLevel >= 3
                ? '<span style="position:absolute;bottom:0;left:1px;font-size:7px;color:#ff4444;">!</span>'
                : '';
            const playerMark = isPlayer
                ? '<span style="font-size:11px;line-height:1;">▲</span>'
                : '';
            const label = cell.name
                ? `<span style="font-size:6px;position:absolute;bottom:0;width:100%;text-align:center;overflow:hidden;white-space:nowrap;color:#ddd;">${cell.name}</span>`
                : '';
            const title = `${cell.terrain}${cell.name ? ' — ' + cell.name : ''}${cell.poi ? ' ★ ' + cell.poi : ''} (${x},${y})`;

            cellsHTML += `<div class="rpg-map-cell" style="background:${bg};opacity:${visitedOpacity};border:1px solid #252540;position:relative;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;cursor:default;" title="${title}">${playerMark}${poiDot}${dangerMark}${label}</div>`;
        }
    }

    return `
<div class="rpg-map-container" style="margin:4px 0;">
  <div class="rpg-map-title" style="font-size:12px;font-weight:600;color:#ccc;margin-bottom:4px;">${state.mapName || 'Map'}</div>
  <div class="rpg-map-grid" style="display:grid;grid-template-columns:repeat(${cols}, 24px);grid-auto-rows:24px;gap:1px;overflow:auto;max-height:320px;">
    ${cellsHTML}
  </div>
  <div class="rpg-map-legend" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:9px;color:#999;">
    ${Object.entries(TERRAIN_COLORS).map(([t, c]) => `<span><span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:1px;vertical-align:middle;"></span> ${t}</span>`).join('')}
  </div>
</div>`;
}

// ─── Dungeon Node Graph ──────────────────────────────────────────────────────

/**
 * Render a dungeon as a vertical node list with connection info.
 * @param {object} state
 * @returns {string}
 */
function renderDungeon(state) {
    const nodes = state.nodes;
    if (!nodes || nodes.length === 0) return '<div class="rpg-map-empty">No dungeon data.</div>';

    const currentId = state.playerNodeId;

    let nodesHTML = '';
    for (const node of nodes) {
        if (!node.discovered) continue;

        const isCurrent = (node.id === currentId);
        const borderColor = isCurrent ? '#ffcc00' : (node.visited ? '#555' : '#3a3a5a');
        const bg = isCurrent ? '#2a2a3e' : '#1e1e2e';
        const icon = NODE_TYPE_ICONS[node.type] || '◻';
        const clearedTag = node.cleared ? '<span style="color:#4a4;font-size:9px;margin-left:4px;">✓ cleared</span>' : '';
        const contentsLine = node.contents
            ? `<div style="font-size:9px;color:#aaa;margin-top:2px;font-style:italic;">${node.contents}</div>`
            : '';

        // Show connections to other discovered nodes
        const visibleConns = node.connections.filter(id => {
            const n = nodes.find(nn => nn.id === id);
            return n && n.discovered;
        });
        const connsLine = visibleConns.length > 0
            ? `<div style="font-size:9px;color:#777;margin-top:2px;">→ ${visibleConns.map(id => {
                const n = nodes.find(nn => nn.id === id);
                return n ? n.name : id;
            }).join(', ')}</div>`
            : '';

        nodesHTML += `
<div class="rpg-map-node" style="background:${bg};border:1px solid ${borderColor};border-radius:4px;padding:6px 8px;margin-bottom:4px;">
  <div style="display:flex;align-items:center;gap:4px;">
    <span style="font-size:12px;">${icon}</span>
    <span style="font-size:11px;font-weight:${isCurrent ? '600' : '400'};color:${isCurrent ? '#ffcc00' : '#ccc'};">${node.name}</span>
    ${clearedTag}
    ${isCurrent ? '<span style="font-size:9px;color:#ffcc00;margin-left:auto;">YOU</span>' : ''}
  </div>
  ${node.description ? `<div style="font-size:9px;color:#999;margin-top:2px;">${node.description}</div>` : ''}
  ${contentsLine}
  ${connsLine}
</div>`;
    }

    const discoveredCount = nodes.filter(n => n.discovered).length;

    return `
<div class="rpg-map-container" style="margin:4px 0;">
  <div class="rpg-map-title" style="font-size:12px;font-weight:600;color:#ccc;margin-bottom:4px;">${state.mapName || 'Dungeon'} <span style="font-size:9px;font-weight:400;color:#777;">(${discoveredCount}/${nodes.length} rooms)</span></div>
  <div class="rpg-map-dungeon-list" style="max-height:320px;overflow-y:auto;">
    ${nodesHTML}
  </div>
</div>`;
}
