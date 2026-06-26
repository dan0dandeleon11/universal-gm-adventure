/**
 * NPC Dialogue Router — Post-Processing Agent
 *
 * Generates independent NPC dialogue via a separate API connection after
 * the main character responds.  NPCs with a defined `personality` field
 * are eligible for routing; all others remain context-injection-only.
 *
 * Uses the N-1 pattern: reputation deltas from the previous turn's NPC
 * responses are applied at the start of the next turn (swipe-safe).
 *
 * Registered as `post_processing` phase — runs after every assistant message.
 */

import { extensionSettings } from '../../core/state.js';
import { registerAgent, saveAgentMemory, getAgentMemory } from '../pipeline/index.js';
import { getRelevantNPCs, adjustReputation, getReputationLabel } from '../npcs/index.js';

const AGENT_ID = 'npc-router';
const LOG = '[NPCRouter]';

let pendingNPCs = [];

// ─── Settings ──────────────────────────────────────────────

function getSettings() {
    const s = extensionSettings.npcRouter || {};
    return {
        enabled: s.enabled === true,
        maxNPCsPerTurn: s.maxNPCsPerTurn || 3,
        autonomy: s.autonomy || 'reactive',
        applyReputationDeltas: s.applyReputationDeltas !== false,
        injectResponses: s.injectResponses !== false,
        mentionThreshold: s.mentionThreshold ?? 1,
    };
}

// ─── Execute (gating) ──────────────────────────────────────

async function execute(context) {
    const settings = getSettings();
    const stored = getAgentMemory(AGENT_ID);
    if (!settings.enabled) return stored || { responses: [], deltasApplied: true };

    // N-1: apply reputation deltas from previous turn
    if (stored?.responses?.length && !stored.deltasApplied && settings.applyReputationDeltas) {
        for (const r of stored.responses) {
            if (r.id && r.reputationDelta) {
                adjustReputation(r.id, r.reputationDelta);
            }
        }
        saveAgentMemory(AGENT_ID, { ...stored, deltasApplied: true });
    }

    // Find NPCs with personality defined that are mentioned in recent messages
    const msgs = (context.recentMessages || []).map(m => m.content);
    const relevant = getRelevantNPCs(msgs, settings.mentionThreshold)
        .filter(n => n.personality);

    if (relevant.length === 0) {
        return stored || { responses: [], deltasApplied: true };
    }

    // Proactive mode: also include NPCs at the same location (if world state knows)
    let candidates = [...relevant];
    if (settings.autonomy === 'proactive') {
        const worldState = context.agentMemory?.['world-state'];
        if (worldState?.location) {
            const loc = worldState.location.toLowerCase().trim();
            const allNPCs = getRelevantNPCs(msgs, 0)
                .filter(n => n.personality && n.location?.toLowerCase().trim() === loc);
            for (const npc of allNPCs) {
                if (!candidates.find(c => c.id === npc.id)) {
                    candidates.push(npc);
                }
            }
        }
    }

    pendingNPCs = candidates.slice(0, settings.maxNPCsPerTurn);
    console.log(LOG, `Routing ${pendingNPCs.length} NPC(s): ${pendingNPCs.map(n => n.name).join(', ')}`);

    return undefined; // fall through to buildPrompt
}

// ─── Prompt Builder ────────────────────────────────────────

function buildPrompt(context) {
    const npcs = pendingNPCs;
    pendingNPCs = [];
    if (npcs.length === 0) {
        return { system: 'Return an empty JSON array: []', user: '' };
    }

    const npcBlocks = npcs.map(npc => {
        const repLabel = getReputationLabel(npc.reputation);
        const lines = [
            `<npc id="${npc.id}" name="${npc.name}" reputation="${repLabel} (${npc.reputation})">`,
            `  Personality: ${npc.personality}`,
        ];
        if (npc.dialogueStyle) lines.push(`  Dialogue style: ${npc.dialogueStyle}`);
        if (npc.faction) lines.push(`  Faction: ${npc.faction}`);
        if (npc.location) lines.push(`  Location: ${npc.location}`);
        if (npc.status) lines.push(`  Status: ${npc.status}`);
        if (npc.notes) lines.push(`  Notes: ${npc.notes}`);
        lines.push('</npc>');
        return lines.join('\n');
    });

    const system = [
        'You are an NPC Dialogue Generator for an ongoing roleplay.',
        'Generate brief, in-character dialogue and actions for each NPC based on the recent conversation.',
        'Each NPC is an independent character with their own voice and motivations.',
        '',
        '── NPCs TO VOICE ──',
        ...npcBlocks,
        '',
        '── REQUIRED OUTPUT FORMAT ──',
        'Return a JSON array. Each element:',
        '{',
        '  "id": "npc_id_from_above",',
        '  "name": "NPC Name",',
        '  "dialogue": "What they say, in character (1-3 sentences)",',
        '  "action": "Brief physical action or body language (optional, empty string if none)",',
        '  "mood": "one-word mood (e.g. amused, wary, angry, warm)",',
        '  "reputationDelta": 0',
        '}',
        '',
        'Rules:',
        '- Stay in character. Match each NPC\'s personality and dialogue style.',
        '- Dialogue should be natural and brief — these are side characters, not narrators.',
        '- reputationDelta: integer from -5 to +5. How the interaction shifted their opinion.',
        '  0 = neutral, positive = warming up, negative = souring.',
        '- Only include NPCs who would realistically speak or act right now.',
        '- If an NPC would stay silent, omit them from the array.',
        '- Return [] if no NPC would naturally respond.',
        '- Return raw JSON only. No markdown fences, no explanation.',
    ].join('\n');

    const user = context.recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

    return { system, user };
}

// ─── Context Injection ─────────────────────────────────────

/**
 * Format NPC responses from the previous turn as an XML block
 * for injection into the current generation's context.
 */
export function formatNPCResponsesForInjection() {
    const memory = getAgentMemory(AGENT_ID);
    if (!memory?.responses?.length) return '';

    const parts = memory.responses
        .filter(r => r && (r.dialogue || r.action))
        .map(r => {
            const lines = [];
            if (r.dialogue) lines.push(`  "${r.dialogue}"`);
            if (r.action) lines.push(`  *${r.action}*`);
            return [
                `  <npc_voice name="${r.name || 'Unknown'}" mood="${r.mood || 'neutral'}">`,
                ...lines,
                '  </npc_voice>',
            ].join('\n');
        });

    return `<npc_responses>\n${parts.join('\n')}\n</npc_responses>`;
}

// ─── Registration ──────────────────────────────────────────

export function initNPCRouter() {
    registerAgent({
        id: AGENT_ID,
        name: 'NPC Dialogue Router',
        phase: 'post_processing',
        resultType: 'npc_dialogue',
        settingsKey: 'npcRouter',
        connectionKey: 'npcRouter',
        execute,
        buildPrompt,
        contextSize: 8,
        runInterval: 0,
        enabledByDefault: false,
    });

    console.log(LOG, 'Registered with pipeline');
}
