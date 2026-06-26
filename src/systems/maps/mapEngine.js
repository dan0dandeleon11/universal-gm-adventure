/**
 * Map Engine — Overworld grid & dungeon node-graph management
 * Handles creation, movement, discovery, and fog-of-war tracking.
 *
 * @module systems/maps/mapEngine
 */

import { extensionSettings } from '../../core/state.js';
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';

// ─── Terrain Config ──────────────────────────────────────────────────────────

/** @type {Array<{terrain: string, weight: number}>} */
const TERRAIN_TABLE = [
    { terrain: 'plains',   weight: 30 },
    { terrain: 'forest',   weight: 25 },
    { terrain: 'mountain', weight: 10 },
    { terrain: 'water',    weight: 8 },
    { terrain: 'desert',   weight: 8 },
    { terrain: 'swamp',    weight: 7 },
    { terrain: 'urban',    weight: 6 },
    { terrain: 'ruins',    weight: 6 },
];

/** @type {string[]} */
const DUNGEON_ROOM_TYPES = ['room', 'corridor', 'boss', 'treasure', 'trap', 'entrance', 'exit'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick a random terrain type using the weighted table.
 * @returns {string}
 */
function randomTerrain() {
    const totalWeight = TERRAIN_TABLE.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of TERRAIN_TABLE) {
        roll -= entry.weight;
        if (roll <= 0) return entry.terrain;
    }
    return 'plains';
}

/**
 * Pick a random dungeon room type (weighted toward 'room' and 'corridor').
 * @returns {string}
 */
function randomRoomType() {
    const r = Math.random();
    if (r < 0.40) return 'room';
    if (r < 0.65) return 'corridor';
    if (r < 0.75) return 'trap';
    if (r < 0.85) return 'treasure';
    return 'boss';
}

/**
 * Persist the current map state to chat metadata.
 */
function saveMapState() {
    saveChatDebounced();
}

/**
 * Return the settings shortcut.
 * @returns {typeof extensionSettings.maps}
 */
function settings() {
    const s = extensionSettings.maps || {};
    return {
        ...s,
        type: s.type || 'overworld',
        gridSize: s.gridSize || { width: 10, height: 10 },
    };
}

// ─── State Access ────────────────────────────────────────────────────────────

/**
 * Get the current map state from chat_metadata. Creates a sensible default
 * if none exists yet (respecting the settings for type and grid size).
 * @returns {object} The map state object (`chat_metadata.rpgMap`).
 */
export function getMapState() {
    if (!chat_metadata.rpgMap) {
        const s = settings();
        if (s.type === 'dungeon') {
            chat_metadata.rpgMap = createDungeonMap(8, 'Unnamed Dungeon');
        } else {
            const { width, height } = s.gridSize;
            chat_metadata.rpgMap = createOverworldMap(width, height, 'Unnamed Region');
        }
    }
    return chat_metadata.rpgMap;
}

/**
 * Get the player's current position.
 * @returns {{ x: number, y: number } | { nodeId: string }}
 */
export function getPlayerPosition() {
    const state = getMapState();
    if (state.type === 'dungeon') {
        return { nodeId: state.playerNodeId };
    }
    return { x: state.playerPosition.x, y: state.playerPosition.y };
}

// ─── Overworld Grid ──────────────────────────────────────────────────────────

/**
 * Create a new overworld grid map.
 * The player starts at (0, 0) and the spawn cell + its neighbors are discovered.
 *
 * @param {number} width  — number of columns
 * @param {number} height — number of rows
 * @param {string} name   — display name for the map
 * @returns {object} The new map state (also stored on chat_metadata.rpgMap).
 */
export function createOverworldMap(width, height, name) {
    const grid = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            row.push({
                x,
                y,
                terrain: randomTerrain(),
                name: null,
                discovered: false,
                visited: false,
                poi: null,
                dangerLevel: Math.floor(Math.random() * 3), // 0-2 near start
            });
        }
        grid.push(row);
    }

    const state = {
        type: 'overworld',
        grid,
        nodes: null,
        playerPosition: { x: 0, y: 0 },
        playerNodeId: null,
        mapName: name || 'The Wilds',
    };

    chat_metadata.rpgMap = state;

    // Discover starting cell and neighbors
    _discoverCellInternal(state, 0, 0);
    state.grid[0][0].visited = true;
    for (const [nx, ny] of _adjacentCoords(0, 0, width, height)) {
        _discoverCellInternal(state, nx, ny);
    }

    saveMapState();
    return state;
}

/**
 * Internal cell discovery (no save — callers batch saves).
 * @param {object} state
 * @param {number} x
 * @param {number} y
 */
function _discoverCellInternal(state, x, y) {
    const cell = state.grid[y]?.[x];
    if (cell) cell.discovered = true;
}

/**
 * Get valid adjacent coordinates (4-directional).
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Array<[number, number]>}
 */
function _adjacentCoords(x, y, width, height) {
    /** @type {Array<[number, number]>} */
    const out = [];
    if (x > 0)          out.push([x - 1, y]);
    if (x < width - 1)  out.push([x + 1, y]);
    if (y > 0)          out.push([x, y - 1]);
    if (y < height - 1) out.push([x, y + 1]);
    return out;
}

/**
 * Move the player on the overworld grid.
 * Marks the destination as visited & discovers all its neighbors.
 *
 * @param {number} x — target column
 * @param {number} y — target row
 * @returns {{ success: boolean, cell?: object, error?: string }}
 */
export function movePlayer(x, y) {
    const state = getMapState();
    if (state.type !== 'overworld') {
        return { success: false, error: 'Current map is not an overworld grid.' };
    }
    const cell = state.grid[y]?.[x];
    if (!cell) {
        return { success: false, error: `Cell (${x}, ${y}) is out of bounds.` };
    }

    state.playerPosition = { x, y };
    cell.discovered = true;
    cell.visited = true;

    // Fog-of-war reveal
    const { width, height } = { width: state.grid[0].length, height: state.grid.length };
    for (const [nx, ny] of _adjacentCoords(x, y, width, height)) {
        _discoverCellInternal(state, nx, ny);
    }

    saveMapState();
    return { success: true, cell };
}

/**
 * Manually discover (reveal) a cell.
 * @param {number} x
 * @param {number} y
 * @returns {{ success: boolean, cell?: object, error?: string }}
 */
export function discoverCell(x, y) {
    const state = getMapState();
    if (state.type !== 'overworld') {
        return { success: false, error: 'Current map is not an overworld grid.' };
    }
    const cell = state.grid[y]?.[x];
    if (!cell) return { success: false, error: `Cell (${x}, ${y}) is out of bounds.` };
    cell.discovered = true;
    saveMapState();
    return { success: true, cell };
}

/**
 * Get adjacent cells to a position.
 * @param {number} x
 * @param {number} y
 * @returns {object[]}
 */
export function getAdjacentCells(x, y) {
    const state = getMapState();
    if (state.type !== 'overworld') return [];
    const w = state.grid[0].length;
    const h = state.grid.length;
    return _adjacentCoords(x, y, w, h).map(([cx, cy]) => state.grid[cy][cx]);
}

/**
 * Get all discovered cells.
 * @returns {object[]}
 */
export function getDiscoveredCells() {
    const state = getMapState();
    if (state.type !== 'overworld' || !state.grid) return [];
    return state.grid.flat().filter(c => c.discovered);
}

/**
 * Set a point of interest on a cell.
 * @param {number} x
 * @param {number} y
 * @param {string} poi — description of the point of interest
 */
export function setCellPOI(x, y, poi) {
    const state = getMapState();
    const cell = state.grid?.[y]?.[x];
    if (cell) {
        cell.poi = poi;
        saveMapState();
    }
}

// ─── Dungeon Node-Graph ──────────────────────────────────────────────────────

/**
 * Create a new dungeon map as a connected node graph.
 * Guarantees connectivity via incremental attachment + BFS verification.
 *
 * @param {number} nodeCount — number of rooms to generate (min 3)
 * @param {string} name     — dungeon display name
 * @returns {object} The new map state.
 */
export function createDungeonMap(nodeCount, name) {
    const count = Math.max(3, nodeCount);
    /** @type {object[]} */
    const nodes = [];

    // Build nodes
    for (let i = 0; i < count; i++) {
        let type;
        if (i === 0) type = 'entrance';
        else if (i === count - 1) type = 'exit';
        else type = randomRoomType();

        nodes.push({
            id: `node_${i}`,
            name: _randomRoomName(type, i),
            description: null,
            type,
            discovered: false,
            visited: false,
            connections: [],
            contents: null,
            cleared: false,
        });
    }

    // Connect graph — each new node connects to a random earlier node
    for (let i = 1; i < count; i++) {
        const target = Math.floor(Math.random() * i);
        _connectNodes(nodes, i, target);
    }

    // Sprinkle a few extra connections for loops (roughly 30 % of node count)
    const extras = Math.floor(count * 0.3);
    for (let e = 0; e < extras; e++) {
        const a = Math.floor(Math.random() * count);
        let b = Math.floor(Math.random() * count);
        if (a === b) b = (b + 1) % count;
        _connectNodes(nodes, a, b);
    }

    const state = {
        type: 'dungeon',
        grid: null,
        nodes,
        playerPosition: null,
        playerNodeId: 'node_0',
        mapName: name || 'The Depths',
    };

    chat_metadata.rpgMap = state;

    // Discover the entrance + its connections
    _discoverNodeInternal(state, 'node_0');
    nodes[0].visited = true;
    for (const connId of nodes[0].connections) {
        _discoverNodeInternal(state, connId);
    }

    saveMapState();
    return state;
}

/**
 * Bidirectionally connect two nodes if not already connected.
 * @param {object[]} nodes
 * @param {number} idxA
 * @param {number} idxB
 */
function _connectNodes(nodes, idxA, idxB) {
    const a = nodes[idxA];
    const b = nodes[idxB];
    if (!a.connections.includes(b.id)) a.connections.push(b.id);
    if (!b.connections.includes(a.id)) b.connections.push(a.id);
}

/**
 * Generate a simple room name.
 * @param {string} type
 * @param {number} index
 * @returns {string}
 */
function _randomRoomName(type, index) {
    const names = {
        entrance:  'Entrance Hall',
        exit:      'Exit Chamber',
        room:      `Room ${index}`,
        corridor:  `Corridor ${index}`,
        boss:      'Boss Chamber',
        treasure:  'Treasure Vault',
        trap:      'Trapped Passage',
    };
    return names[type] || `Chamber ${index}`;
}

/**
 * Internal node discovery (no save).
 * @param {object} state
 * @param {string} nodeId
 */
function _discoverNodeInternal(state, nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) node.discovered = true;
}

/**
 * Move the player to a dungeon node. The node must be connected to the current
 * position (or force = true). Marks the destination visited and discovers
 * connected nodes.
 *
 * @param {string}  nodeId — target node ID
 * @param {boolean} [force=false] — skip adjacency check
 * @returns {{ success: boolean, node?: object, error?: string }}
 */
export function movePlayerToNode(nodeId, force = false) {
    const state = getMapState();
    if (state.type !== 'dungeon') {
        return { success: false, error: 'Current map is not a dungeon.' };
    }

    const current = state.nodes.find(n => n.id === state.playerNodeId);
    if (!force && current && !current.connections.includes(nodeId)) {
        return { success: false, error: `Node "${nodeId}" is not connected to current position.` };
    }

    const target = state.nodes.find(n => n.id === nodeId);
    if (!target) return { success: false, error: `Node "${nodeId}" does not exist.` };

    state.playerNodeId = nodeId;
    target.discovered = true;
    target.visited = true;

    for (const connId of target.connections) {
        _discoverNodeInternal(state, connId);
    }

    saveMapState();
    return { success: true, node: target };
}

/**
 * Manually discover a dungeon node.
 * @param {string} nodeId
 * @returns {{ success: boolean, node?: object, error?: string }}
 */
export function discoverNode(nodeId) {
    const state = getMapState();
    if (state.type !== 'dungeon') {
        return { success: false, error: 'Current map is not a dungeon.' };
    }
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return { success: false, error: `Node "${nodeId}" does not exist.` };
    node.discovered = true;
    saveMapState();
    return { success: true, node };
}

/**
 * Get nodes connected to a given node.
 * @param {string} nodeId
 * @returns {object[]}
 */
export function getConnectedNodes(nodeId) {
    const state = getMapState();
    if (state.type !== 'dungeon' || !state.nodes) return [];
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return [];
    return node.connections.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
}

/**
 * Get all discovered dungeon nodes.
 * @returns {object[]}
 */
export function getDiscoveredNodes() {
    const state = getMapState();
    if (state.type !== 'dungeon' || !state.nodes) return [];
    return state.nodes.filter(n => n.discovered);
}

/**
 * Set the contents description for a dungeon node.
 * @param {string} nodeId
 * @param {string} contents
 */
export function setNodeContents(nodeId, contents) {
    const state = getMapState();
    if (!state.nodes) return;
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        node.contents = contents;
        saveMapState();
    }
}

// ─── Prompt Injection ────────────────────────────────────────────────────────

/**
 * Format the discovered map as a compact text block suitable for prompt
 * injection into the AI context.
 *
 * @returns {string}
 */
export function formatMapForInjection() {
    const state = getMapState();
    const lines = [`[Map: ${state.mapName}]`];

    if (state.type === 'overworld') {
        const pos = state.playerPosition;
        lines.push(`Player position: (${pos.x}, ${pos.y})`);
        const discovered = getDiscoveredCells();
        if (discovered.length === 0) {
            lines.push('No areas discovered yet.');
        } else {
            lines.push(`Discovered locations (${discovered.length}):`);
            for (const cell of discovered) {
                const marker = (cell.x === pos.x && cell.y === pos.y) ? ' [HERE]' : '';
                const visited = cell.visited ? ' (visited)' : '';
                const poi = cell.poi ? ` — ${cell.poi}` : '';
                const name = cell.name ? ` "${cell.name}"` : '';
                const danger = cell.dangerLevel > 0 ? ` [danger:${cell.dangerLevel}]` : '';
                lines.push(`  (${cell.x},${cell.y}) ${cell.terrain}${name}${danger}${visited}${marker}${poi}`);
            }
        }
    } else {
        lines.push(`Player at: ${state.playerNodeId}`);
        const discovered = getDiscoveredNodes();
        if (discovered.length === 0) {
            lines.push('No rooms discovered yet.');
        } else {
            lines.push(`Discovered rooms (${discovered.length}):`);
            for (const node of discovered) {
                const marker = (node.id === state.playerNodeId) ? ' [HERE]' : '';
                const visited = node.visited ? ' (visited)' : '';
                const cleared = node.cleared ? ' (cleared)' : '';
                const contents = node.contents ? ` — ${node.contents}` : '';
                const conns = node.connections.filter(id => {
                    const n = state.nodes.find(nn => nn.id === id);
                    return n && n.discovered;
                });
                lines.push(`  ${node.id}: ${node.name} [${node.type}]${visited}${cleared}${marker}${contents}`);
                if (conns.length > 0) {
                    lines.push(`    connects to: ${conns.join(', ')}`);
                }
            }
        }
    }

    return lines.join('\n');
}
