/**
 * Agent Registry
 * Declarative agent registration with phase, connection, and settings.
 * Agents register themselves and the pipeline queries the registry to
 * build the execution plan for each phase.
 */

import { extensionSettings } from '../../core/state.js';

const PHASES = ['pre_generation', 'parallel', 'post_processing'];

const registry = new Map();

/**
 * Register an agent with the pipeline.
 *
 * @param {object} manifest
 * @param {string} manifest.id — unique agent ID (e.g. 'world-state')
 * @param {string} manifest.name — display name
 * @param {string} manifest.phase — 'pre_generation' | 'parallel' | 'post_processing'
 * @param {string} [manifest.resultType] — output type: 'context_injection' | 'state_update' | 'text_rewrite' | 'scene_output' | 'director_event'
 * @param {string} [manifest.settingsKey] — key in extensionSettings to check enabled state
 * @param {Function} manifest.execute — async (context) => result
 * @param {Function} [manifest.buildPrompt] — (context) => { system, user } messages for API call
 * @param {string} [manifest.connectionKey] — settings key for API connection override (e.g. 'sceneModel')
 * @param {number} [manifest.contextSize=5] — how many recent messages to include
 * @param {number} [manifest.runInterval] — run every N turns (0 = every turn)
 * @param {boolean} [manifest.enabledByDefault=false]
 */
export function registerAgent(manifest) {
    if (!manifest.id || !manifest.phase || (!manifest.execute && !manifest.buildPrompt)) {
        console.error('[Pipeline] Invalid agent manifest:', manifest.id);
        return;
    }
    if (!PHASES.includes(manifest.phase)) {
        console.error('[Pipeline] Invalid phase for agent', manifest.id, ':', manifest.phase);
        return;
    }
    registry.set(manifest.id, {
        ...manifest,
        contextSize: manifest.contextSize ?? extensionSettings.pipeline?.defaultContextSize ?? 5,
        runInterval: manifest.runInterval ?? 0,
        enabledByDefault: manifest.enabledByDefault ?? false,
    });
}

/**
 * Unregister an agent.
 * @param {string} id
 */
export function unregisterAgent(id) {
    registry.delete(id);
}

/**
 * Check if an agent is enabled (settings key exists and is enabled, or enabled by default).
 * @param {object} manifest
 * @returns {boolean}
 */
function isAgentEnabled(manifest) {
    if (manifest.settingsKey) {
        const settings = extensionSettings[manifest.settingsKey];
        return settings?.enabled === true;
    }
    return manifest.enabledByDefault;
}

/**
 * Check if an agent should run this turn based on runInterval.
 * @param {object} manifest
 * @param {number} turnCount
 * @returns {boolean}
 */
function shouldRunThisTurn(manifest, turnCount) {
    if (!manifest.runInterval || manifest.runInterval <= 1) return true;
    return turnCount % manifest.runInterval === 0;
}

/**
 * Get all enabled agents for a given phase.
 * @param {string} phase
 * @param {number} [turnCount=0]
 * @returns {object[]}
 */
export function getAgentsForPhase(phase, turnCount = 0) {
    const agents = [];
    for (const manifest of registry.values()) {
        if (manifest.phase !== phase) continue;
        if (!isAgentEnabled(manifest)) continue;
        if (!shouldRunThisTurn(manifest, turnCount)) continue;
        agents.push(manifest);
    }
    return agents;
}

/**
 * Get a specific agent manifest by ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getAgent(id) {
    return registry.get(id);
}

/**
 * Get all registered agent IDs.
 * @returns {string[]}
 */
export function getRegisteredAgentIds() {
    return [...registry.keys()];
}

/**
 * Resolve the API connection config for an agent.
 * Falls back through: agent connectionKey → GM API → safeGenerateRaw (null).
 * @param {object} manifest
 * @returns {{ endpoint: string, model: string, temperature: number, maxTokens: number, apiKey: string }|null}
 */
export function resolveAgentConnection(manifest) {
    const gm = extensionSettings.gmMode || {};

    if (manifest.connectionKey) {
        const conn = extensionSettings[manifest.connectionKey];
        if (conn && !conn.useGmConnection) {
            const provider = conn.provider || 'custom';
            const s = conn.settings?.[provider] || {};
            if (s.endpoint) {
                return {
                    endpoint: s.endpoint,
                    model: s.model || '',
                    temperature: s.temperature ?? 0.3,
                    maxTokens: conn.maxTokens || 500,
                    apiKey: localStorage.getItem(`rpg_companion_${manifest.connectionKey}_api_key`)
                        || localStorage.getItem(`rpg_companion_gm_api_key_${provider}`)
                        || s.apiKey || ''
                };
            }
        }
    }

    // Fall back to GM API
    const gmApi = gm.api || {};
    if (!gmApi.useMainApi) {
        const provider = gmApi.provider || 'custom';
        const s = gmApi.settings?.[provider] || {};
        if (s.endpoint) {
            return {
                endpoint: s.endpoint,
                model: s.model || '',
                temperature: s.temperature ?? 0.8,
                maxTokens: gmApi.maxTokens || 1000,
                apiKey: localStorage.getItem(`rpg_companion_gm_api_key_${provider}`) || s.apiKey || ''
            };
        }
    }

    return null;
}

/**
 * Group agents by their resolved connection (endpoint + model) for batching.
 * @param {object[]} agents
 * @returns {Map<string, { connection: object|null, agents: object[] }>}
 */
export function groupAgentsByConnection(agents) {
    const groups = new Map();
    for (const agent of agents) {
        const conn = resolveAgentConnection(agent);
        const key = conn ? `${conn.endpoint}|${conn.model}` : '__st_generate__';
        if (!groups.has(key)) {
            groups.set(key, { connection: conn, agents: [] });
        }
        groups.get(key).agents.push(agent);
    }
    return groups;
}
