/**
 * Narrative Director Agent
 *
 * Pre-generation agent that creates story direction hooks injected before
 * the main LLM response. Two operating modes:
 *   - natural: pushes existing plot forward using unresolved tension
 *   - random:  creates surprising but plausible random events
 *
 * Maintains a hidden "secret plot" — a long-term narrative arc stored in
 * agent memory (persistent per-chat via chat_metadata). The secret plot
 * surfaces every N turns (configurable) to quietly steer the story.
 */

import { extensionSettings } from '../../core/state.js';
import { registerAgent, saveAgentMemory, getAgentMemory } from '../pipeline/index.js';

const AGENT_ID = 'narrative-director';
const LOG = `[NarrativeDirector]`;

// ─── Prompt Templates ────────────────────────────────────────────────

const NATURAL_DIRECTION = [
    'You are the Narrative Director for an ongoing roleplay story.',
    'Analyze the recent conversation and identify the strongest unresolved tension,',
    'dangling plot thread, or emotional throughline that has NOT been addressed.',
    '',
    'Write a brief (2-4 sentences) story direction that pushes this thread forward.',
    'Do NOT resolve anything — escalate, complicate, or recontextualize.',
    'Stay grounded in the established setting and characters.',
].join('\n');

const RANDOM_DIRECTION = [
    'You are the Narrative Director for an ongoing roleplay story.',
    'Create a surprising but plausible random event that disrupts the current scene.',
    'It should feel like it belongs in this world but nobody saw it coming.',
    '',
    'Write a brief (2-4 sentences) story direction introducing this event.',
    'Make it actionable — something the characters must react to immediately.',
    'Stay grounded in the established setting.',
].join('\n');

const SECRET_PLOT_SEED = [
    'You are the Narrative Director. Based on the story so far, create a hidden',
    'overarching narrative arc that will develop slowly over many turns.',
    '',
    'Return valid JSON with this exact structure:',
    '{',
    '  "overarchingArc": {',
    '    "description": "2-4 sentences describing the hidden arc",',
    '    "protagonistArc": "1-2 sentences about user character growth",',
    '    "characterArc": "1-2 sentences about a key NPC\'s arc (optional, can be empty)",',
    '    "completed": false',
    '  }',
    '}',
    '',
    'The arc should be something that can be woven subtly into scenes without',
    'being explicitly stated — foreshadowing, recurring motifs, slowly shifting',
    'NPC behavior, environmental hints.',
].join('\n');

const SECRET_PLOT_UPDATE = [
    'You are the Narrative Director. A hidden arc is in progress:',
    '',
    '{{SECRET_PLOT}}',
    '',
    'Given the recent events, provide a brief (1-2 sentences) subtle nudge that',
    'advances this arc without revealing it. This should feel organic — a small',
    'detail, a character\'s offhand remark, an environmental shift.',
    'If the arc has naturally concluded, set "completed" to true.',
    '',
    'Return valid JSON: { "nudge": "your direction text", "completed": false }',
].join('\n');

// ─── Core Logic ──────────────────────────────────────────────────────

/**
 * Get the current settings, with safe defaults.
 * @returns {{ enabled: boolean, mode: string, secretPlotEnabled: boolean, secretPlotRunInterval: number, pushStoryArmed: boolean }}
 */
function getSettings() {
    const s = extensionSettings.narrativeDirector || {};
    return {
        enabled: s.enabled === true,
        mode: s.mode || 'natural',
        secretPlotEnabled: s.secretPlotEnabled === true,
        secretPlotRunInterval: s.secretPlotRunInterval || 8,
        pushStoryArmed: s.pushStoryArmed === true,
    };
}

/**
 * Read persisted secret plot state from agent memory.
 * @returns {{ overarchingArc: object|null, lastUpdatedTurn: number }|null}
 */
function getSecretPlotState() {
    return getAgentMemory(AGENT_ID);
}

/**
 * Determine whether the secret plot needs a check this turn.
 * @param {number} turnCount
 * @param {number} interval
 * @param {object|null} state
 * @returns {boolean}
 */
function shouldRunSecretPlot(turnCount, interval, state) {
    if (!state?.overarchingArc) return true; // needs seeding
    if (state.overarchingArc.completed) return false;
    const turnsSinceLast = turnCount - (state.lastUpdatedTurn || 0);
    return turnsSinceLast >= interval;
}

/**
 * Build the instruction prompt for the current mode and secret plot state.
 * @param {object} context — pipeline context
 * @returns {{ instruction: string, user: string }}
 */
function buildDirectorPrompt(context) {
    const settings = getSettings();
    const base = settings.mode === 'random' ? RANDOM_DIRECTION : NATURAL_DIRECTION;

    const parts = [base];

    // Inject secret plot context if available and not completed
    if (settings.secretPlotEnabled) {
        const state = getSecretPlotState();
        if (state?.overarchingArc && !state.overarchingArc.completed) {
            parts.push(
                '',
                '── Hidden Arc Context (DO NOT reveal directly) ──',
                `Arc: ${state.overarchingArc.description}`,
                `Protagonist growth: ${state.overarchingArc.protagonistArc}`,
                state.overarchingArc.characterArc
                    ? `NPC arc: ${state.overarchingArc.characterArc}`
                    : '',
                '',
                'Subtly weave hints of this arc into your direction without stating it outright.',
            );
        }
    }

    const instruction = parts.filter(Boolean).join('\n');
    const user = context.recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

    return { instruction, user };
}

/**
 * Main execution function called by the pipeline.
 * Handles push-story arming, secret plot lifecycle, and direction generation.
 *
 * @param {object} context — pipeline context (recentMessages, agentMemory, turnCount, extensionSettings)
 * @returns {Promise<string|null>} — direction text to inject, or null to skip
 */
async function execute(context) {
    const settings = getSettings();

    // Gate: only run when explicitly armed via the push-story button
    if (!settings.pushStoryArmed) {
        // Still handle secret plot seeding/updating even when not armed
        if (settings.secretPlotEnabled) {
            await maybeUpdateSecretPlot(context);
        }
        return null;
    }

    // Clear the armed flag so it doesn't fire again next turn
    extensionSettings.narrativeDirector.pushStoryArmed = false;

    // Update secret plot if needed (before building direction prompt)
    if (settings.secretPlotEnabled) {
        await maybeUpdateSecretPlot(context);
    }

    // Build and return the direction prompt for injection
    const { instruction } = buildDirectorPrompt(context);
    console.log(LOG, `Generating ${settings.mode} direction (turn ${context.turnCount})`);
    return instruction;
}

/**
 * Seed or update the secret plot state if conditions are met.
 * @param {object} context
 */
async function maybeUpdateSecretPlot(context) {
    const settings = getSettings();
    const state = getSecretPlotState();
    const interval = settings.secretPlotRunInterval;

    if (!shouldRunSecretPlot(context.turnCount, interval, state)) return;

    if (!state?.overarchingArc) {
        // Seed: store a placeholder — the actual arc gets generated when the
        // agent runs through the batch executor with buildPrompt (SECRET_PLOT_SEED).
        // For now, mark that we need seeding so buildPrompt can branch.
        console.log(LOG, 'Secret plot needs seeding — will be generated on next batched run');
    }

    // Persist updated turn marker
    saveAgentMemory(AGENT_ID, {
        ...(state || {}),
        lastUpdatedTurn: context.turnCount,
    });
}

/**
 * Build prompt for batched execution (used by batchExecutor).
 * Returns system + user messages depending on secret plot lifecycle.
 *
 * @param {object} context
 * @returns {{ instruction: string, user: string }}
 */
function buildPrompt(context) {
    const settings = getSettings();
    const state = getSecretPlotState();

    // If secret plot enabled and needs seeding, generate the arc
    if (settings.secretPlotEnabled && !state?.overarchingArc) {
        const user = context.recentMessages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
        return { instruction: SECRET_PLOT_SEED, user };
    }

    // If secret plot needs an update nudge
    if (settings.secretPlotEnabled && state?.overarchingArc && !state.overarchingArc.completed) {
        const sinceUpdate = context.turnCount - (state.lastUpdatedTurn || 0);
        if (sinceUpdate >= settings.secretPlotRunInterval) {
            const instruction = SECRET_PLOT_UPDATE.replace(
                '{{SECRET_PLOT}}',
                JSON.stringify(state.overarchingArc, null, 2),
            );
            const user = context.recentMessages
                .map(m => `${m.role}: ${m.content}`)
                .join('\n');
            return { instruction, user };
        }
    }

    // Default: standard direction prompt
    return buildDirectorPrompt(context);
}

// ─── Registration ────────────────────────────────────────────────────

/**
 * Register the Narrative Director with the agent pipeline.
 * Call once during extension initialization.
 */
export function initNarrativeDirector() {
    registerAgent({
        id: AGENT_ID,
        name: 'Narrative Director',
        phase: 'pre_generation',
        resultType: 'context_injection',
        settingsKey: 'narrativeDirector',
        execute,
        buildPrompt,
        contextSize: 8,
        runInterval: 0,
        enabledByDefault: false,
    });

    console.log(LOG, 'Registered with pipeline');
}
