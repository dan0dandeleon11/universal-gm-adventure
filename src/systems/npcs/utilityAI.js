/**
 * Utility AI — Need-based decision engine for NPCs
 *
 * Each NPC has needs that decay over real time. Actions satisfy needs.
 * The NPC picks the action with the highest deficit-weighted utility score.
 * Social actions signal the NPC Router that this NPC wants to interact.
 *
 * Pure logic module — no SillyTavern dependencies.
 */

// ─── Default Need Templates ────────────────────────────────

const DEFAULT_NEEDS = {
    energy:  { cur: 100, max: 100, decay: 0.5 },
    hunger:  { cur: 100, max: 100, decay: 1.0 },
    social:  { cur: 100, max: 100, decay: 0.8 },
    fun:     { cur: 100, max: 100, decay: 0.6 },
    purpose: { cur: 80,  max: 100, decay: 0.3 },
};

// ─── Action Catalog ────────────────────────────────────────

const ACTIONS = [
    { name: 'Rest',    impact: { energy: +50, hunger: -10 },            duration: 480, social: false },
    { name: 'Eat',     impact: { hunger: +40, energy: +5 },             duration: 30,  social: false },
    { name: 'Chat',    impact: { social: +30, fun: +10 },               duration: 15,  social: true  },
    { name: 'Play',    impact: { fun: +40, energy: -10, social: +15 },  duration: 60,  social: true  },
    { name: 'Work',    impact: { purpose: +40, energy: -20 },           duration: 240, social: false },
    { name: 'Explore', impact: { fun: +20, purpose: +15, energy: -15 }, duration: 120, social: false },
    { name: 'Trade',   impact: { purpose: +20, social: +10 },           duration: 30,  social: true  },
    { name: 'Guard',   impact: { purpose: +30, energy: -10 },           duration: 180, social: false },
    { name: 'Argue',   impact: { social: -10, fun: -10, purpose: +5 },  duration: 15,  social: true  },
];

// ─── Core Functions ────────────────────────────────────────

/**
 * Create a fresh set of needs for a new NPC.
 * @returns {object} Deep copy of default needs.
 */
export function createDefaultNeeds() {
    return JSON.parse(JSON.stringify(DEFAULT_NEEDS));
}

/**
 * Decay needs based on elapsed time.
 * Mutates the needs object in place.
 *
 * @param {object} needs — the NPC's needs object
 * @param {number} minutes — real minutes elapsed since last tick
 * @returns {object} The mutated needs object
 */
export function tickNeeds(needs, minutes = 1) {
    if (!needs) return createDefaultNeeds();
    for (const key of Object.keys(needs)) {
        const n = needs[key];
        if (n && typeof n.cur === 'number') {
            n.cur = Math.max(0, n.cur - (n.decay * (minutes / 60)));
        }
    }
    return needs;
}

/**
 * Score all available actions and pick the best one.
 * Uses deficit-weighted utility: the lower a need is, the more
 * weight actions that satisfy it receive.
 *
 * @param {object} needs — the NPC's current needs
 * @returns {{ name: string, impact: object, duration: number, social: boolean, score: number }}
 */
export function decide(needs) {
    if (!needs) return { ...ACTIONS[0], score: 0 };

    let bestAction = null;
    let bestScore = -Infinity;

    for (const action of ACTIONS) {
        let score = 0;
        for (const [key, impact] of Object.entries(action.impact)) {
            if (needs[key]) {
                const deficit = needs[key].max - needs[key].cur;
                const weight = deficit / needs[key].max;
                score += impact * weight;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestAction = action;
        }
    }

    return { ...bestAction, score: bestScore };
}

/**
 * Apply an action's impact to needs (when the NPC "does" the action).
 * @param {object} needs
 * @param {{ impact: object }} action
 * @returns {object} Mutated needs
 */
export function applyAction(needs, action) {
    if (!needs || !action?.impact) return needs;
    for (const [key, impact] of Object.entries(action.impact)) {
        if (needs[key]) {
            needs[key].cur = Math.max(0, Math.min(needs[key].max, needs[key].cur + impact));
        }
    }
    return needs;
}

/**
 * Find the NPC's most urgent need (below 30% threshold).
 * @param {object} needs
 * @returns {string|null} Need key, or null if nothing is urgent.
 */
export function getUrgentNeed(needs) {
    if (!needs) return null;
    let worst = null;
    let worstRatio = 1;
    for (const [key, n] of Object.entries(needs)) {
        if (!n || typeof n.cur !== 'number') continue;
        const ratio = n.cur / n.max;
        if (ratio < worstRatio) {
            worstRatio = ratio;
            worst = key;
        }
    }
    return worstRatio < 0.3 ? worst : null;
}

/**
 * Format a needs summary as a compact string for prompt injection.
 * @param {object} needs
 * @returns {string}
 */
export function formatNeedsSummary(needs) {
    if (!needs) return '';
    return Object.entries(needs)
        .map(([key, n]) => `${key}: ${Math.round(n.cur)}/${n.max}`)
        .join(', ');
}
