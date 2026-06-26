/**
 * Campaign Planner Module
 * Manages story arcs, plot twists, and pre-planned encounters
 * that the GM follows across sessions.
 *
 * Storage: chat_metadata.rpgCampaign = { arcs, encounters, currentArcId }
 */

import { extensionSettings } from '../../core/state.js';
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';

/** @typedef {{ id: string, description: string, triggered: boolean, triggerCondition?: string }} PlotPoint */
/** @typedef {{ id: string, name: string, description: string, status: 'planned'|'active'|'completed'|'abandoned', plotPoints: PlotPoint[], notes: string, createdAt: string }} StoryArc */
/** @typedef {{ id: string, name: string, description: string, triggerCondition: string, status: 'pending'|'triggered'|'completed'|'skipped', difficulty: 'easy'|'medium'|'hard'|'deadly', rewards?: string, linkedArcId: string|null, notes: string }} Encounter */
/** @typedef {{ arcs: StoryArc[], encounters: Encounter[], currentArcId: string|null }} CampaignData */

const DEFAULT_CAMPAIGN = { arcs: [], encounters: [], currentArcId: null };

// ─── Internal helpers ───────────────────────────────────────────────

/** @returns {CampaignData} Ensures rpgCampaign exists on chat_metadata. */
function ensureStorage() {
    if (!chat_metadata.rpgCampaign) {
        chat_metadata.rpgCampaign = structuredClone(DEFAULT_CAMPAIGN);
    }
    const c = chat_metadata.rpgCampaign;
    if (!Array.isArray(c.arcs)) c.arcs = [];
    if (!Array.isArray(c.encounters)) c.encounters = [];
    if (c.currentArcId === undefined) c.currentArcId = null;
    return c;
}

function save() { saveChatDebounced(); }
function makeId(prefix) { return `${prefix}_${Date.now()}`; }

// ─── Story Arcs ─────────────────────────────────────────────────────

/** Returns the full campaign state (arcs, encounters, currentArcId). @returns {CampaignData} */
export function getCampaignState() {
    return ensureStorage();
}

/**
 * Create a new story arc.
 * @param {Partial<StoryArc> & {name: string}} arc
 * @returns {StoryArc}
 */
export function addArc(arc) {
    const data = ensureStorage();
    const newArc = {
        id: makeId('arc'),
        name: arc.name,
        description: arc.description ?? '',
        status: arc.status ?? 'planned',
        plotPoints: Array.isArray(arc.plotPoints) ? arc.plotPoints : [],
        notes: arc.notes ?? '',
        createdAt: arc.createdAt ?? new Date().toISOString(),
    };
    data.arcs.push(newArc);
    save();
    return newArc;
}

/**
 * Update fields on an existing arc.
 * @param {string} id  @param {Partial<StoryArc>} updates  @returns {StoryArc|null}
 */
export function updateArc(id, updates) {
    const data = ensureStorage();
    const arc = data.arcs.find(a => a.id === id);
    if (!arc) return null;
    Object.assign(arc, updates, { id });
    save();
    return arc;
}

/** Remove an arc by id. @param {string} id  @returns {boolean} */
export function removeArc(id) {
    const data = ensureStorage();
    const idx = data.arcs.findIndex(a => a.id === id);
    if (idx === -1) return false;
    data.arcs.splice(idx, 1);
    if (data.currentArcId === id) data.currentArcId = null;
    save();
    return true;
}

/** Set the currently active arc (also flips status to 'active'). @param {string} id  @returns {StoryArc|null} */
export function setActiveArc(id) {
    const data = ensureStorage();
    const arc = data.arcs.find(a => a.id === id);
    if (!arc) return null;
    data.currentArcId = id;
    arc.status = 'active';
    save();
    return arc;
}

/** Returns the currently active arc, or null. @returns {StoryArc|null} */
export function getActiveArc() {
    const data = ensureStorage();
    if (!data.currentArcId) return null;
    return data.arcs.find(a => a.id === data.currentArcId) ?? null;
}

/**
 * Mark a specific plot point as triggered.
 * @param {string} arcId  @param {string} plotPointId  @returns {PlotPoint|null}
 */
export function triggerPlotPoint(arcId, plotPointId) {
    const data = ensureStorage();
    const arc = data.arcs.find(a => a.id === arcId);
    if (!arc) return null;
    const pp = arc.plotPoints.find(p => p.id === plotPointId);
    if (!pp) return null;
    pp.triggered = true;
    save();
    return pp;
}

// ─── Encounters ─────────────────────────────────────────────────────

/**
 * Create a new encounter.
 * @param {Partial<Encounter> & {name: string}} encounter  @returns {Encounter}
 */
export function addEncounter(encounter) {
    const data = ensureStorage();
    const newEnc = {
        id: makeId('enc'),
        name: encounter.name,
        description: encounter.description ?? '',
        triggerCondition: encounter.triggerCondition ?? 'manual',
        status: encounter.status ?? 'pending',
        difficulty: encounter.difficulty ?? 'medium',
        rewards: encounter.rewards ?? '',
        linkedArcId: encounter.linkedArcId ?? null,
        notes: encounter.notes ?? '',
    };
    data.encounters.push(newEnc);
    save();
    return newEnc;
}

/** Update fields on an existing encounter. @param {string} id  @param {Partial<Encounter>} updates  @returns {Encounter|null} */
export function updateEncounter(id, updates) {
    const data = ensureStorage();
    const enc = data.encounters.find(e => e.id === id);
    if (!enc) return null;
    Object.assign(enc, updates, { id });
    save();
    return enc;
}

/** Remove an encounter by id. @param {string} id  @returns {boolean} */
export function removeEncounter(id) {
    const data = ensureStorage();
    const idx = data.encounters.findIndex(e => e.id === id);
    if (idx === -1) return false;
    data.encounters.splice(idx, 1);
    save();
    return true;
}

/** Mark an encounter as triggered. @param {string} id  @returns {Encounter|null} */
export function triggerEncounter(id) {
    const data = ensureStorage();
    const enc = data.encounters.find(e => e.id === id);
    if (!enc) return null;
    enc.status = 'triggered';
    save();
    return enc;
}

/** Get all encounters with status 'pending'. @returns {Encounter[]} */
export function getPendingEncounters() {
    const data = ensureStorage();
    return data.encounters.filter(e => e.status === 'pending');
}

// ─── Prompt Injection ───────────────────────────────────────────────

/**
 * Format the active arc and pending encounters as an XML `<campaign_plan>`
 * block for injection into the GM prompt context.
 * @returns {string} XML string, or empty string if nothing to inject
 */
export function formatCampaignForInjection() {
    if (!extensionSettings.campaign?.enabled) return '';
    const arc = getActiveArc();
    const pending = getPendingEncounters();
    if (!arc && pending.length === 0) return '';

    const lines = ['<campaign_plan>'];
    if (arc) {
        lines.push('  <active_arc>');
        lines.push(`    <name>${arc.name}</name>`);
        lines.push(`    <description>${arc.description}</description>`);
        const triggered = arc.plotPoints.filter(p => p.triggered);
        const remaining = arc.plotPoints.filter(p => !p.triggered);
        if (triggered.length > 0) {
            lines.push('    <triggered_plot_points>');
            triggered.forEach(p => lines.push(`      <point>${p.description}</point>`));
            lines.push('    </triggered_plot_points>');
        }
        if (remaining.length > 0) {
            lines.push('    <remaining_plot_points>');
            remaining.forEach(p => {
                const cond = p.triggerCondition ? ` condition="${p.triggerCondition}"` : '';
                lines.push(`      <point${cond}>${p.description}</point>`);
            });
            lines.push('    </remaining_plot_points>');
        }
        if (arc.notes) lines.push(`    <notes>${arc.notes}</notes>`);
        lines.push('  </active_arc>');
    }
    if (pending.length > 0) {
        lines.push('  <pending_encounters>');
        pending.forEach(enc => {
            lines.push(`    <encounter difficulty="${enc.difficulty}">`);
            lines.push(`      <name>${enc.name}</name>`);
            lines.push(`      <description>${enc.description}</description>`);
            lines.push(`      <trigger>${enc.triggerCondition}</trigger>`);
            if (enc.rewards) lines.push(`      <rewards>${enc.rewards}</rewards>`);
            lines.push('    </encounter>');
        });
        lines.push('  </pending_encounters>');
    }
    lines.push('</campaign_plan>');
    return lines.join('\n');
}

/**
 * Returns a summary of completed arcs and triggered encounters.
 * @returns {{ completedArcs: StoryArc[], triggeredEncounters: Encounter[], stats: Object }}
 */
export function getCompletionSummary() {
    const data = ensureStorage();
    const completedArcs = data.arcs.filter(a => a.status === 'completed');
    const triggeredEncounters = data.encounters.filter(e => e.status === 'triggered' || e.status === 'completed');
    return {
        completedArcs,
        triggeredEncounters,
        stats: {
            arcsTotal: data.arcs.length,
            arcsCompleted: completedArcs.length,
            encountersTotal: data.encounters.length,
            encountersTriggered: triggeredEncounters.length,
        },
    };
}
