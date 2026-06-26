/**
 * Agent Pipeline — 3-Phase Orchestrator
 *
 * Phases:
 *   1. pre_generation  — runs BEFORE main LLM call. Injects context (narrative director hooks, etc.)
 *   2. parallel        — fires DURING main generation. Agents run async (scene model, etc.)
 *   3. post_processing — runs AFTER response received. Updates state (world state, NPC tracker, etc.)
 *
 * Batching: agents sharing the same API endpoint+model are grouped into one call.
 * Results are typed (context_injection, state_update, text_rewrite, scene_output, director_event).
 */

import { extensionSettings } from '../../core/state.js';
import { getContext } from '../../../../../../extensions.js';
import { extension_prompt_types, setExtensionPrompt, chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { getAgentsForPhase, groupAgentsByConnection } from './agentRegistry.js';
import { executeAgentGroup } from './batchExecutor.js';

const LOG = '[Pipeline]';
const INJECTION_KEY = 'rpg_companion_pipeline';

let turnCount = 0;
let parallelPromises = [];
let parallelResults = [];
let lastPreGenInjections = [];

/**
 * Build the shared context object passed to all agents.
 * @param {string|null} mainResponse — the main LLM response (only for post-processing)
 * @returns {object}
 */
function buildPipelineContext(mainResponse = null) {
    const context = getContext();
    const chat = context?.chat || [];
    const contextSize = extensionSettings.pipeline?.defaultContextSize ?? 5;

    const recentMessages = chat.slice(-contextSize).map(msg => ({
        role: msg.is_user ? 'user' : 'assistant',
        content: msg.mes || '',
        name: msg.name || undefined
    }));

    return {
        chatId: chat_metadata?.chat_id || null,
        chat,
        recentMessages,
        mainResponse,
        turnCount,
        preGenInjections: lastPreGenInjections,
        parallelResults,
        agentMemory: chat_metadata?.rpgAgentMemory || {},
        extensionSettings,
    };
}

/**
 * Save agent memory to chat metadata for persistence across reloads.
 * @param {string} agentId
 * @param {object} data
 */
export function saveAgentMemory(agentId, data) {
    if (!chat_metadata) return;
    if (!chat_metadata.rpgAgentMemory) chat_metadata.rpgAgentMemory = {};
    chat_metadata.rpgAgentMemory[agentId] = data;
    saveChatDebounced();
}

/**
 * Read agent memory from chat metadata.
 * @param {string} agentId
 * @returns {object|null}
 */
export function getAgentMemory(agentId) {
    return chat_metadata?.rpgAgentMemory?.[agentId] || null;
}

/**
 * Phase 1: Pre-Generation
 * Called from onGenerationStarted in injector.js.
 * Runs narrative director, knowledge agents, etc.
 * Injects their output into the prompt via setExtensionPrompt.
 *
 * @returns {Promise<string[]>} — array of injection texts
 */
export async function runPreGenerationAgents() {
    if (!extensionSettings.pipeline?.enabled) return [];

    turnCount++;
    const agents = getAgentsForPhase('pre_generation', turnCount);
    if (agents.length === 0) return [];

    console.log(LOG, `Pre-gen: running ${agents.length} agent(s)`);
    const ctx = buildPipelineContext();
    const groups = groupAgentsByConnection(agents);
    const injections = [];

    const groupPromises = [...groups.values()].map(async ({ connection, agents: groupAgents }) => {
        const results = await executeAgentGroup(connection, groupAgents, ctx);
        for (const [agentId, result] of results) {
            if (!result.success) continue;
            const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
            if (text) injections.push({ agentId, text });
        }
    });

    const maxConcurrent = extensionSettings.pipeline?.maxConcurrentGroups || 8;
    await settleWithLimit(groupPromises, maxConcurrent);

    lastPreGenInjections = injections;

    if (injections.length > 0) {
        const combined = injections.map(i => `<agent_context source="${i.agentId}">\n${i.text}\n</agent_context>`).join('\n');
        setExtensionPrompt(INJECTION_KEY, combined, extension_prompt_types.IN_CHAT, 1);
    }

    return injections;
}

/**
 * Phase 2: Parallel
 * Called right after pre-gen. Fires off async API calls that run during main generation.
 * Results are collected later in collectParallelResults().
 */
export function startParallelAgents() {
    if (!extensionSettings.pipeline?.enabled) return;

    const agents = getAgentsForPhase('parallel', turnCount);
    if (agents.length === 0) return;

    console.log(LOG, `Parallel: launching ${agents.length} agent(s)`);
    const ctx = buildPipelineContext();
    const groups = groupAgentsByConnection(agents);

    parallelResults = [];
    parallelPromises = [...groups.values()].map(async ({ connection, agents: groupAgents }) => {
        const results = await executeAgentGroup(connection, groupAgents, ctx);
        for (const [agentId, result] of results) {
            parallelResults.push({ agentId, ...result });
        }
    });
}

/**
 * Collect parallel agent results. Call before post-processing.
 * @returns {Promise<object[]>}
 */
export async function collectParallelResults() {
    if (parallelPromises.length === 0) return [];
    await Promise.allSettled(parallelPromises);
    parallelPromises = [];
    console.log(LOG, `Parallel: collected ${parallelResults.length} result(s)`);
    return parallelResults;
}

/**
 * Phase 3: Post-Processing
 * Called from onMessageReceived in sillytavern.js.
 * Runs world state, NPC tracker, etc. with access to the main response.
 *
 * @param {string} mainResponse — the AI's response text
 * @returns {Promise<object[]>} — array of { agentId, resultType, data }
 */
export async function runPostProcessingAgents(mainResponse) {
    if (!extensionSettings.pipeline?.enabled) return [];

    await collectParallelResults();

    const agents = getAgentsForPhase('post_processing', turnCount);
    if (agents.length === 0) return [];

    console.log(LOG, `Post-processing: running ${agents.length} agent(s)`);
    const ctx = buildPipelineContext(mainResponse);
    const groups = groupAgentsByConnection(agents);
    const outputs = [];

    const groupPromises = [...groups.values()].map(async ({ connection, agents: groupAgents }) => {
        const results = await executeAgentGroup(connection, groupAgents, ctx);
        for (const [agentId, result] of results) {
            const manifest = groupAgents.find(a => a.id === agentId);
            outputs.push({
                agentId,
                resultType: manifest?.resultType || 'context_injection',
                ...result
            });
        }
    });

    const maxConcurrent = extensionSettings.pipeline?.maxConcurrentGroups || 8;
    await settleWithLimit(groupPromises, maxConcurrent);

    // Apply results by type
    for (const output of outputs) {
        if (!output.success) continue;
        try {
            applyAgentResult(output);
        } catch (err) {
            console.error(LOG, `Failed to apply result from ${output.agentId}:`, err);
        }
    }

    return outputs;
}

/**
 * Apply an agent result based on its type.
 * @param {object} output — { agentId, resultType, data }
 */
function applyAgentResult(output) {
    switch (output.resultType) {
        case 'state_update':
            if (output.data && typeof output.data === 'object') {
                saveAgentMemory(output.agentId, output.data);
            }
            break;
        case 'context_injection':
            // Already handled during pre-gen; post-gen injections stored for next turn
            if (output.data) {
                saveAgentMemory(output.agentId, output.data);
            }
            break;
        case 'director_event':
            if (output.data) saveAgentMemory(output.agentId, output.data);
            break;
        case 'scene_output':
            if (output.data) saveAgentMemory(output.agentId, output.data);
            break;
        case 'npc_dialogue':
            if (output.data) {
                saveAgentMemory(output.agentId, {
                    responses: Array.isArray(output.data) ? output.data : [],
                    turn: turnCount,
                    deltasApplied: false,
                });
            }
            break;
        default:
            if (output.data) {
                saveAgentMemory(output.agentId, output.data);
            }
    }
}

/**
 * Clear pipeline state (on chat change, etc.)
 */
export function clearPipelineState() {
    turnCount = 0;
    parallelPromises = [];
    parallelResults = [];
    lastPreGenInjections = [];
    setExtensionPrompt(INJECTION_KEY, '', extension_prompt_types.IN_CHAT, 0);
}

/**
 * Run promises with a concurrency limit.
 * @param {Promise[]} promises
 * @param {number} limit
 */
async function settleWithLimit(promises, limit) {
    const executing = new Set();
    for (const p of promises) {
        const wrapped = Promise.resolve(p).then(
            () => executing.delete(wrapped),
            () => executing.delete(wrapped)
        );
        executing.add(wrapped);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    await Promise.allSettled(executing);
}
