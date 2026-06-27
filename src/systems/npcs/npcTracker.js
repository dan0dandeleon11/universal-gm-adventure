/**
 * NPC Tracker Module
 * Manages NPC profiles with reputation tracking for RPG campaigns.
 * Data persists in SillyTavern's chat_metadata at chat_metadata.rpgNPCs.
 */

import { extensionSettings } from '../../core/state.js';
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { createDefaultNeeds, tickNeeds, decide, applyAction, formatNeedsSummary } from './utilityAI.js';

// ─── Helpers ──────────────────────────────────────────────

/** @returns {{ enabled: boolean, maxTracked: number, injectRelevant: boolean, relevanceThreshold: number }} */
function settings() {
    const s = extensionSettings.npcSystem ?? {};
    return {
        enabled: s.enabled ?? true,
        maxTracked: s.maxTracked ?? 50,
        injectRelevant: s.injectRelevant ?? true,
        relevanceThreshold: s.relevanceThreshold ?? 3,
    };
}

/** @returns {object[]} Ensures chat_metadata.rpgNPCs exists. */
function store() {
    if (!Array.isArray(chat_metadata.rpgNPCs)) {
        chat_metadata.rpgNPCs = [];
    }
    return chat_metadata.rpgNPCs;
}

/** Persist after any mutation. */
function persist() {
    saveChatDebounced();
}

// ─── CRUD ─────────────────────────────────────────────────

/** @returns {object[]} All tracked NPCs. */
export function getNPCs() {
    return store();
}

/**
 * @param {string} id
 * @returns {object|undefined}
 */
export function getNPC(id) {
    return store().find(n => n.id === id);
}

/**
 * Create a new NPC. Missing fields are filled with defaults.
 * Respects the maxTracked limit — oldest-seen NPC is evicted when full.
 * @param {object} profile - Partial NPC profile (name is required).
 * @returns {object} The completed profile with generated id.
 */
export function addNPC(profile) {
    const npcs = store();
    const { maxTracked } = settings();

    if (npcs.length >= maxTracked) {
        // Evict the NPC with the earliest lastSeenTurn
        const oldest = npcs.reduce((a, b) => (a.lastSeenTurn <= b.lastSeenTurn ? a : b));
        const idx = npcs.indexOf(oldest);
        if (idx !== -1) npcs.splice(idx, 1);
    }

    const entry = {
        id: `npc_${Date.now()}`,
        name: profile.name ?? 'Unnamed NPC',
        title: profile.title ?? '',
        description: profile.description ?? '',
        reputation: clampRep(profile.reputation ?? 0),
        faction: profile.faction ?? '',
        location: profile.location ?? '',
        status: profile.status ?? 'alive',
        tags: Array.isArray(profile.tags) ? [...profile.tags] : [],
        firstSeenTurn: profile.firstSeenTurn ?? 0,
        lastSeenTurn: profile.lastSeenTurn ?? 0,
        notes: profile.notes ?? '',
        personality: profile.personality ?? '',
        dialogueStyle: profile.dialogueStyle ?? '',
        // Utility AI
        needs: profile.needs ?? null,
        currentAction: null,
        lastTickTime: 0,
        // Social model
        affinity: profile.affinity ?? 50,
        relationship: profile.relationship ?? 'associate',
        thoughts: profile.thoughts ?? '',
        likes: profile.likes ?? '',
        dislikes: profile.dislikes ?? '',
        memories: Array.isArray(profile.memories) ? [...profile.memories] : [],
    };

    npcs.push(entry);
    persist();
    return entry;
}

/**
 * Merge updates into an existing NPC.
 * @param {string} id
 * @param {object} updates - Fields to merge.
 * @returns {object|null} Updated NPC, or null if not found.
 */
export function updateNPC(id, updates) {
    const npc = getNPC(id);
    if (!npc) return null;

    for (const [key, value] of Object.entries(updates)) {
        if (key === 'id') continue; // id is immutable
        if (key === 'reputation') {
            npc.reputation = clampRep(value);
        } else if (key === 'tags') {
            npc.tags = Array.isArray(value) ? [...value] : npc.tags;
        } else {
            npc[key] = value;
        }
    }

    persist();
    return npc;
}

/**
 * @param {string} id
 * @returns {boolean} True if removed.
 */
export function removeNPC(id) {
    const npcs = store();
    const idx = npcs.findIndex(n => n.id === id);
    if (idx === -1) return false;
    npcs.splice(idx, 1);
    persist();
    return true;
}

// ─── Reputation ───────────────────────────────────────────

const clampRep = v => Math.max(-100, Math.min(100, Math.round(v)));

/**
 * Adjust an NPC's reputation by a delta, clamped to [-100, 100].
 * @param {string} id
 * @param {number} delta
 * @param {boolean} [shouldPersist=true] — pass false when batching multiple mutations
 * @returns {number|null} New reputation, or null if NPC not found.
 */
export function adjustReputation(id, delta, shouldPersist = true) {
    const npc = getNPC(id);
    if (!npc) return null;
    npc.reputation = clampRep(npc.reputation + delta);
    if (shouldPersist) persist();
    return npc.reputation;
}

/**
 * @param {number} reputation
 * @returns {string} Human-readable label.
 */
export function getReputationLabel(reputation) {
    if (reputation <= -60) return 'Hostile';
    if (reputation <= -20) return 'Unfriendly';
    if (reputation <= 19) return 'Neutral';
    if (reputation <= 59) return 'Friendly';
    return 'Allied';
}

// ─── Relevance & Injection ────────────────────────────────

/**
 * Find NPCs whose names appear in recent messages.
 * @param {string[]} recentMessages - Array of message texts to scan.
 * @param {number}   [threshold]    - Minimum mention count. Falls back to settings.
 * @returns {object[]} NPCs that meet the threshold.
 */
export function getRelevantNPCs(recentMessages, threshold) {
    const t = threshold ?? settings().relevanceThreshold;
    const combined = recentMessages.join(' ').toLowerCase();

    return store().filter(npc => {
        const name = npc.name.toLowerCase();
        // Count non-overlapping occurrences
        let count = 0;
        let pos = 0;
        while ((pos = combined.indexOf(name, pos)) !== -1) {
            count++;
            pos += name.length;
        }
        return count >= t;
    });
}

/**
 * @param {object[]} npcs
 * @returns {string} XML `<known_npcs>` block for prompt injection.
 */
export function formatNPCsForInjection(npcs) {
    if (!npcs.length) return '';

    const lines = npcs.map(n => {
        const label = getReputationLabel(n.reputation);
        const parts = [`  <npc name="${n.name}" reputation="${label} (${n.reputation})" status="${n.status}">`];
        if (n.title) parts.push(`    <title>${n.title}</title>`);
        if (n.description) parts.push(`    <description>${n.description}</description>`);
        if (n.faction) parts.push(`    <faction>${n.faction}</faction>`);
        if (n.location) parts.push(`    <location>${n.location}</location>`);
        if (n.tags.length) parts.push(`    <tags>${n.tags.join(', ')}</tags>`);
        if (n.notes) parts.push(`    <notes>${n.notes}</notes>`);
        parts.push('  </npc>');
        return parts.join('\n');
    });

    return `<known_npcs>\n${lines.join('\n')}\n</known_npcs>`;
}

// ─── Utility AI ──────────────────────────────────────

/**
 * Tick all NPCs' needs based on real elapsed time, run decide() for each,
 * and persist once at the end. Returns NPCs whose chosen action is social.
 * @returns {object[]} NPCs that want to interact (social action chosen).
 */
export function tickAllNeeds(shouldPersist = true) {
    const npcs = store();
    const now = Date.now();
    const socialNPCs = [];

    for (const npc of npcs) {
        if (!npc.needs) {
            npc.needs = createDefaultNeeds();
            npc.lastTickTime = now;
            continue;
        }

        const elapsed = npc.lastTickTime ? (now - npc.lastTickTime) / 60000 : 0;
        if (elapsed < 0.5) continue;

        tickNeeds(npc.needs, elapsed);
        npc.lastTickTime = now;

        const action = decide(npc.needs);
        npc.currentAction = action;
        applyAction(npc.needs, action);

        if (action.social) {
            socialNPCs.push(npc);
        }
    }

    if (shouldPersist) persist();
    return socialNPCs;
}

/**
 * Add a memory entry to an NPC's memory log.
 * Keeps the most recent 20 memories per NPC.
 * @param {string} id
 * @param {string} text
 * @param {string} [type='event'] — 'event', 'dialogue', 'impression'
 * @returns {boolean}
 */
export function addMemory(id, text, type = 'event', shouldPersist = true) {
    const npc = getNPC(id);
    if (!npc) return false;
    if (!Array.isArray(npc.memories)) npc.memories = [];
    npc.memories.push({ text, type, turn: npc.lastSeenTurn, ts: Date.now() });
    if (npc.memories.length > 20) npc.memories = npc.memories.slice(-20);
    if (shouldPersist) persist();
    return true;
}

/**
 * Get a compact summary of an NPC's current state for prompt building.
 * @param {string} id
 * @returns {string}
 */
export function getNPCContextSummary(id) {
    const npc = getNPC(id);
    if (!npc) return '';
    const parts = [];
    if (npc.currentAction) parts.push(`Currently: ${npc.currentAction.name}`);
    if (npc.needs) parts.push(`Needs: ${formatNeedsSummary(npc.needs)}`);
    if (npc.thoughts) parts.push(`Thinking: ${npc.thoughts}`);
    if (npc.likes) parts.push(`Likes: ${npc.likes}`);
    if (npc.dislikes) parts.push(`Dislikes: ${npc.dislikes}`);
    if (npc.memories?.length) {
        const recent = npc.memories.slice(-3).map(m => m.text).join('; ');
        parts.push(`Recent memories: ${recent}`);
    }
    return parts.join('\n  ');
}

// ─── Search ───────────────────────────────────────────────

/**
 * Fuzzy-match an NPC by name (case-insensitive). Prefers exact matches, falls back to substring.
 * @param {string} name
 * @returns {object|undefined}
 */
export function findNPCByName(name) {
    const npcs = store();
    const lower = name.toLowerCase().trim();

    return npcs.find(n => n.name.toLowerCase() === lower)
        ?? npcs.find(n => n.name.toLowerCase().includes(lower));
}
