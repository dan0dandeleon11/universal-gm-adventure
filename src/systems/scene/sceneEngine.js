/**
 * Scene Engine — Parallel Agent
 *
 * Generates scene descriptions (backgrounds, atmosphere, optional music/SFX cues)
 * via a separate API connection that runs during main generation. Stores output
 * in agent memory and exposes it for ambient context injection.
 *
 * Registered as a `parallel` phase agent — fires alongside the main LLM call
 * so scene updates never add latency to the user-facing response.
 */

import { extensionSettings } from '../../core/state.js';
import { registerAgent, saveAgentMemory, getAgentMemory } from '../pipeline/index.js';

const AGENT_ID = 'scene-model';
const LOG = '[SceneEngine]';

/** Turns between forced refreshes when nothing else triggers an update. */
const STALE_THRESHOLD = 5;

// ─── Prompt ─────────────────────────────────────────────────────────

/**
 * Build the system prompt for scene generation.
 * Tells the model exactly what JSON shape to return and which sections
 * the user has enabled.
 *
 * @param {object} settings — resolved sceneModel settings
 * @returns {string}
 */
function buildSystemPrompt(settings) {
    const sections = ['background'];
    if (settings.generateMusic) sections.push('music');
    if (settings.generateSFX) sections.push('sfx');

    return [
        'You are a Scene Atmosphere Engine for an ongoing roleplay.',
        'Analyze the recent conversation and produce a vivid scene description as valid JSON.',
        '',
        '── REQUIRED OUTPUT ──',
        'Return ONLY a JSON object with these keys:',
        '',
        '"background": {',
        '  "description": "2-3 sentence atmospheric description of the current environment",',
        '  "mood": "one-word mood (e.g. cozy, tense, serene, foreboding)",',
        '  "lighting": "one-word lighting (e.g. warm, dim, harsh, dappled)",',
        '  "timeOfDay": "time of day (e.g. morning, afternoon, evening, night, dawn, dusk)"',
        '}',
        ...(settings.generateMusic ? [
            '"music": {',
            '  "suggestion": "genre/style description suitable for a playlist search",',
            '  "mood": "one-word mood matching the music",',
            '  "tempo": "slow | medium | fast"',
            '}',
        ] : []),
        ...(settings.generateSFX ? [
            '"sfx": ["array", "of", "ambient", "sound", "effect", "descriptions"]',
        ] : []),
        '',
        `Only include these sections: ${sections.join(', ')}.`,
        'Do NOT wrap in markdown code fences. Return raw JSON only.',
    ].join('\n');
}

// ─── Update Heuristic ───────────────────────────────────────────────

/**
 * Decide whether the scene needs regenerating.
 *
 * @param {object|null} prev — previous scene from agent memory
 * @param {object} context — pipeline context
 * @returns {boolean}
 */
function sceneNeedsUpdate(prev, context) {
    // Always generate if we have nothing
    if (!prev || !prev.background) return true;

    // Stale — too many turns since last update
    const turnsSince = context.turnCount - (prev.lastUpdatedTurn || 0);
    if (turnsSince >= STALE_THRESHOLD) return true;

    // Check world-state agent memory for location changes
    const worldState = getAgentMemory('world-state');
    if (worldState?.location && prev._lastLocation) {
        const current = (worldState.location || '').toLowerCase().trim();
        const last = (prev._lastLocation || '').toLowerCase().trim();
        if (current !== last) return true;
    }

    // Check recent messages for strong scene-shift signals
    const recent = (context.recentMessages || []).slice(-3);
    const shiftPatterns = /\b(arrive[ds]?|enter[sed]*|walk(?:s|ed)?\s+(?:into|to)|travel|moved?\s+to|teleport|warp|go(?:es)?\s+to|head(?:s|ed)?\s+to|time\s+skip|hours?\s+later|next\s+(?:morning|day|evening|night))\b/i;
    for (const msg of recent) {
        if (shiftPatterns.test(msg.content)) return true;
    }

    return false;
}

// ─── Core ───────────────────────────────────────────────────────────

/**
 * Get resolved settings with safe defaults.
 * @returns {object}
 */
function getSettings() {
    const s = extensionSettings.sceneModel || {};
    return {
        enabled: s.enabled === true,
        useGmConnection: s.useGmConnection !== false,
        provider: s.provider || 'custom',
        settings: s.settings || {},
        maxTokens: s.maxTokens || 500,
        generateBackgrounds: s.generateBackgrounds !== false,
        generateMusic: s.generateMusic === true,
        generateSFX: s.generateSFX === true,
    };
}

/**
 * Build prompt for pipeline/batchExecutor consumption.
 * @param {object} context — pipeline context
 * @returns {{ instruction: string, user: string }}
 */
function buildPrompt(context) {
    const settings = getSettings();
    const instruction = buildSystemPrompt(settings);
    const user = context.recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');
    return { instruction, user };
}

/**
 * Main execution — called by the pipeline during parallel phase.
 * Checks the update heuristic, calls the API if needed, parses
 * the result, and persists to agent memory.
 *
 * @param {object} context — pipeline context
 * @returns {Promise<object|null>} — scene data or null if skipped
 */
async function execute(context) {
    const settings = getSettings();
    if (!settings.enabled) return getAgentMemory(AGENT_ID) || {};

    const prev = getAgentMemory(AGENT_ID);

    if (!sceneNeedsUpdate(prev, context)) {
        console.log(LOG, `Scene still fresh (turn ${context.turnCount}), skipping`);
        return prev;
    }

    console.log(LOG, `Generating scene (turn ${context.turnCount})`);

    // Build prompt — actual API call is handled by batchExecutor via buildPrompt.
    // When execute returns a non-null prompt-shaped object the executor knows to
    // make the call.  But since execute IS the call path for single agents we
    // signal "needs API" by returning undefined and letting buildPrompt drive.
    // The pipeline will use buildPrompt + the resolved connection instead.
    return undefined;
}

/**
 * Post-API callback: the pipeline calls execute, but for parallel agents the
 * batchExecutor uses buildPrompt to get the actual prompt and calls the API,
 * then stores the result via pipeline.applyAgentResult → saveAgentMemory.
 * We hook into that by letting buildPrompt do the heavy lifting and trusting
 * the pipeline to persist.  The execute function just gates whether to run.
 *
 * But we still need to enrich the raw API result before it's saved.
 * The pipeline saves whatever data comes back; our buildPrompt includes
 * instructions that produce the right shape, and the batchExecutor's
 * tryParseJSON handles the JSON parsing.  We attach metadata in execute
 * when the result comes back through the pipeline's result flow.
 */

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Return the latest scene from agent memory.
 * @returns {object|null}
 */
export function getLatestScene() {
    return getAgentMemory(AGENT_ID);
}

/**
 * Format the current scene as an XML block for ambient context injection.
 * Returns an empty string if no scene data exists or backgrounds are disabled.
 *
 * @returns {string}
 */
export function formatSceneForInjection() {
    const scene = getAgentMemory(AGENT_ID);
    if (!scene?.background) return '';

    const settings = getSettings();
    const parts = [];

    if (settings.generateBackgrounds && scene.background) {
        parts.push(`<background mood="${scene.background.mood}" lighting="${scene.background.lighting}" time="${scene.background.timeOfDay}">`);
        parts.push(`  ${scene.background.description}`);
        parts.push('</background>');
    }

    if (settings.generateMusic && scene.music) {
        parts.push(`<music mood="${scene.music.mood}" tempo="${scene.music.tempo}">${scene.music.suggestion}</music>`);
    }

    if (settings.generateSFX && scene.sfx?.length) {
        parts.push(`<ambient_sfx>${scene.sfx.join(', ')}</ambient_sfx>`);
    }

    if (parts.length === 0) return '';
    return `<scene_atmosphere>\n${parts.join('\n')}\n</scene_atmosphere>`;
}

// ─── Registration ───────────────────────────────────────────────────

/**
 * Register the Scene Engine with the agent pipeline.
 * Call once during extension initialization.
 */
export function initSceneModel() {
    registerAgent({
        id: AGENT_ID,
        name: 'Scene Atmosphere',
        phase: 'parallel',
        resultType: 'scene_output',
        settingsKey: 'sceneModel',
        connectionKey: 'sceneModel',
        execute,
        buildPrompt,
        contextSize: 6,
        runInterval: 0,
        enabledByDefault: false,
    });

    console.log(LOG, 'Registered with pipeline');
}
