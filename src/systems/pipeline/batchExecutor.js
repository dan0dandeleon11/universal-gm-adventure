/**
 * Batch Executor
 * Groups agents by provider+model and executes them in batched API calls
 * using XML-delimited task/result format (Marinara Engine pattern).
 */

import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const LOG = '[Pipeline][Batch]';

/**
 * Execute a single agent via an external OpenAI-compatible API.
 * @param {object} connection — { endpoint, model, temperature, maxTokens, apiKey }
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function callExternalAPI(connection, messages) {
    const url = connection.endpoint.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (connection.apiKey) headers['Authorization'] = `Bearer ${connection.apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: connection.model,
            messages,
            max_tokens: connection.maxTokens,
            temperature: connection.temperature
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Build a batched system prompt that combines multiple agent tasks.
 * Uses XML-delimited format so the LLM returns tagged results.
 *
 * @param {object[]} agents — agent manifests with buildPrompt method
 * @param {object} context — shared pipeline context
 * @returns {{ system: string, user: string }}
 */
function buildBatchedPrompt(agents, context) {
    const taskBlocks = agents.map(agent => {
        const prompt = agent.buildPrompt(context);
        return `<agent_task id="${agent.id}" name="${agent.name}">\n${prompt.system || prompt.instruction || prompt.user || ''}\n</agent_task>`;
    });

    const system = [
        'You are executing multiple specialized agent tasks. Complete ALL tasks and return ALL results.',
        'Wrap each task output in a <result agent="AGENT_ID"> tag.',
        '',
        ...taskBlocks,
        '',
        '── REQUIRED OUTPUT FORMAT ──',
        ...agents.map(a => `<result agent="${a.id}">\n... your output for ${a.name} ...\n</result>`),
        '',
        'CRITICAL: Output ALL result blocks. Each must contain valid content.'
    ].join('\n');

    const user = context.recentMessages
        ? context.recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')
        : '';

    return { system, user };
}

/**
 * Parse batched XML results into per-agent outputs.
 * @param {string} raw — raw LLM response
 * @param {string[]} agentIds — expected agent IDs
 * @returns {Map<string, string>} — agentId → extracted text
 */
function parseBatchedResults(raw, agentIds) {
    const results = new Map();
    for (const id of agentIds) {
        const pattern = new RegExp(`<result\\s+agent=["']${id}["']>([\\s\\S]*?)</result>`, 'i');
        const match = raw.match(pattern);
        results.set(id, match ? match[1].trim() : null);
    }
    return results;
}

/**
 * Execute a group of agents that share the same connection.
 * If multiple agents, attempts batching; falls back to individual execution on failure.
 *
 * @param {object|null} connection — API connection config, or null for ST generateRaw
 * @param {object[]} agents — agent manifests
 * @param {object} context — pipeline context
 * @returns {Promise<Map<string, object>>} — agentId → { success, data, error, durationMs }
 */
export async function executeAgentGroup(connection, agents, context) {
    const results = new Map();

    if (agents.length === 1 || !connection) {
        // Single agent or ST generateRaw — execute individually
        for (const agent of agents) {
            results.set(agent.id, await executeSingleAgent(connection, agent, context));
        }
        return results;
    }

    // Try batched execution
    try {
        const batchStart = performance.now();
        const { system, user } = buildBatchedPrompt(agents, context);

        const messages = [
            { role: 'system', content: system },
            ...(user ? [{ role: 'user', content: user }] : [])
        ];

        const raw = await callExternalAPI(connection, messages);
        const parsed = parseBatchedResults(raw, agents.map(a => a.id));
        const batchDuration = performance.now() - batchStart;

        let allParsed = true;
        for (const agent of agents) {
            const output = parsed.get(agent.id);
            if (output !== null) {
                results.set(agent.id, {
                    success: true,
                    data: tryParseJSON(output),
                    raw: output,
                    durationMs: Math.round(batchDuration),
                    batched: true
                });
            } else {
                allParsed = false;
            }
        }

        // Fall back to individual for any agents that weren't in the batch response
        if (!allParsed) {
            const missing = agents.filter(a => !results.has(a.id));
            console.warn(LOG, `Batch missing ${missing.length} agents, falling back to individual`);
            for (const agent of missing) {
                results.set(agent.id, await executeSingleAgent(connection, agent, context));
            }
        }

        console.log(LOG, `Batched ${agents.length} agents in ${Math.round(batchDuration)}ms`);
    } catch (err) {
        console.warn(LOG, 'Batch execution failed, falling back to individual:', err.message);
        for (const agent of agents) {
            if (!results.has(agent.id)) {
                results.set(agent.id, await executeSingleAgent(connection, agent, context));
            }
        }
    }

    return results;
}

/**
 * Execute a single agent.
 * @param {object|null} connection
 * @param {object} agent — manifest
 * @param {object} context
 * @returns {Promise<object>}
 */
async function executeSingleAgent(connection, agent, context) {
    const start = performance.now();
    try {
        if (agent.execute) {
            const data = await agent.execute(context);
            if (data !== undefined) {
                return {
                    success: true,
                    data,
                    durationMs: Math.round(performance.now() - start),
                    batched: false
                };
            }
            // execute returned undefined — fall through to buildPrompt
        }

        if (!agent.buildPrompt) {
            return { success: false, error: 'No execute or buildPrompt method', durationMs: 0 };
        }

        const prompt = agent.buildPrompt(context);
        const messages = [
            { role: 'system', content: prompt.system || prompt.instruction || '' },
            ...(prompt.user ? [{ role: 'user', content: prompt.user }] : [])
        ];

        let raw;
        if (connection) {
            raw = await callExternalAPI(connection, messages);
        } else {
            raw = await safeGenerateRaw({ prompt: messages, quietToLoud: false });
        }

        return {
            success: true,
            data: tryParseJSON(raw),
            raw,
            durationMs: Math.round(performance.now() - start),
            batched: false
        };
    } catch (err) {
        console.error(LOG, `Agent ${agent.id} failed:`, err.message);
        return {
            success: false,
            error: err.message,
            durationMs: Math.round(performance.now() - start),
            batched: false
        };
    }
}

function tryParseJSON(text) {
    if (!text || typeof text !== 'string') return text;
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try {
        return JSON.parse(cleaned);
    } catch {
        return text;
    }
}
