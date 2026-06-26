/**
 * World State Agent
 * Post-processing agent that auto-tracks narrative state (date, time, location,
 * weather, temperature, present characters) by analyzing the main LLM response.
 *
 * Preserves previous state unless the narrative explicitly changes it --
 * a new message arriving does NOT advance time or shift location by default.
 *
 * Registration: pipeline phase "post_processing", result type "state_update".
 * The batch executor calls buildPrompt → API → saves parsed JSON via
 * applyAgentResult → saveAgentMemory. No execute() needed.
 */

import { registerAgent, getAgentMemory } from '../pipeline/index.js';
import { extensionSettings } from '../../core/state.js';

const AGENT_ID = 'world-state';
const LOG = '[WorldState]';

/**
 * Default empty world state.
 * @returns {{ date: string|null, time: string|null, location: string|null, weather: string|null, temperature: string|null, characters: string[], lastUpdatedTurn: number }}
 */
function emptyState() {
    return {
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        characters: [],
        lastUpdatedTurn: 0
    };
}

/**
 * Build the extraction prompt sent to the LLM.
 * Called by the batch executor (single or batched path).
 *
 * @param {object} context - pipeline context
 * @param {string|null} context.mainResponse - the latest assistant response
 * @param {Array<{role: string, content: string}>} context.recentMessages
 * @param {number} context.turnCount
 * @returns {{ system: string, user: string }}
 */
function buildPrompt(context) {
    const settings = extensionSettings.worldStateAgent || {};
    const fields = settings.trackedFields || [
        'date', 'time', 'location', 'weather', 'temperature', 'characters'
    ];
    const previous = getAgentMemory(AGENT_ID) || emptyState();

    const system = [
        'You are a world-state extraction agent. Analyze the latest narrative response and extract ONLY the fields listed below.',
        '',
        'RULES:',
        '- Output valid JSON matching the schema exactly. No commentary, no markdown fences.',
        '- For each field, extract a value ONLY if the narrative explicitly states or strongly implies a change.',
        '- If a field is not mentioned or unchanged, output its previous value verbatim.',
        '- Do NOT invent, infer, or advance state that the text does not support.',
        '- "characters" is an array of first names (or short names) of characters present in the current scene.',
        '- Include "lastUpdatedTurn" set to ' + context.turnCount + '.',
        '',
        'Tracked fields: ' + JSON.stringify(fields),
        '',
        'Previous state:',
        JSON.stringify(previous, null, 2),
        '',
        'Return ONLY this JSON shape:',
        '{ "date": "...", "time": "...", "location": "...", "weather": "...", "temperature": "...", "characters": [...], "lastUpdatedTurn": N }'
    ].join('\n');

    const recentText = (context.recentMessages || [])
        .map(m => `[${m.role}] ${m.content}`)
        .join('\n---\n');

    const user = [
        'Latest response to analyze:',
        context.mainResponse || '(no response)',
        '',
        'Recent conversation for context:',
        recentText
    ].join('\n');

    return { system, user };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Get the current world state from agent memory.
 * Returns a defensive copy with all fields guaranteed.
 * @returns {{ date: string|null, time: string|null, location: string|null, weather: string|null, temperature: string|null, characters: string[], lastUpdatedTurn: number }}
 */
export function getWorldState() {
    const stored = getAgentMemory(AGENT_ID);
    if (!stored) return emptyState();

    // Defensive merge: ensure all fields exist even if the LLM omitted some
    const base = emptyState();
    return {
        date: stored.date ?? base.date,
        time: stored.time ?? base.time,
        location: stored.location ?? base.location,
        weather: stored.weather ?? base.weather,
        temperature: stored.temperature ?? base.temperature,
        characters: Array.isArray(stored.characters) ? stored.characters : base.characters,
        lastUpdatedTurn: stored.lastUpdatedTurn ?? base.lastUpdatedTurn
    };
}

/**
 * Format world state as an XML block suitable for prompt injection.
 * Returns empty string if no state has been tracked yet.
 * @returns {string}
 */
export function formatWorldStateForInjection() {
    const state = getWorldState();
    const lines = [];

    if (state.date) lines.push(`  <date>${state.date}</date>`);
    if (state.time) lines.push(`  <time>${state.time}</time>`);
    if (state.location) lines.push(`  <location>${state.location}</location>`);
    if (state.weather) lines.push(`  <weather>${state.weather}</weather>`);
    if (state.temperature) lines.push(`  <temperature>${state.temperature}</temperature>`);
    if (state.characters?.length > 0) {
        lines.push(`  <characters>${state.characters.join(', ')}</characters>`);
    }

    if (lines.length === 0) return '';
    return `<world_state>\n${lines.join('\n')}\n</world_state>`;
}

/**
 * Register the world-state agent with the pipeline.
 * Called once during extension initialization.
 */
export function initWorldStateAgent() {
    registerAgent({
        id: AGENT_ID,
        name: 'World State Tracker',
        phase: 'post_processing',
        resultType: 'state_update',
        settingsKey: 'worldStateAgent',
        contextSize: 3,
        buildPrompt
        // No execute — the batch executor uses buildPrompt + API call,
        // parses the JSON result, and applyAgentResult saves it via
        // saveAgentMemory(AGENT_ID, data).
    });

    console.log(LOG, 'Registered');
}
