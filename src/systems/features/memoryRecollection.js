/**
 * Memory Recollection Module
 * Batches chat history, summarizes via the Summary API, and creates
 * SillyTavern World Info (lorebook) entries with keyword triggers
 * so that distilled memories activate automatically in future context.
 */

import { getContext } from '../../../../../../extensions.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { extensionSettings } from '../../core/state.js';

const LOG_PREFIX = '[RPG Companion][Memory]';

/**
 * Resolve the API configuration for memory summarization.
 * Falls back through the Summary → Tracker → GM chain when
 * "useTrackerConnection" / "useGmConnection" flags are set,
 * then finally to SillyTavern's own generateRaw if nothing is configured.
 *
 * @param {object} [overrideConfig] - Optional caller-supplied config
 * @returns {{ endpoint: string, model: string, temperature: number, maxTokens: number, apiKey: string } | null}
 *   null means "use SillyTavern's generateRaw instead"
 */
function resolveApiConfig(overrideConfig) {
    if (overrideConfig?.endpoint) return overrideConfig;

    const gm = extensionSettings.gmMode || {};

    // Summary API
    const summaryApi = gm.summaryApi || {};
    if (!summaryApi.useTrackerConnection) {
        const provider = summaryApi.provider || 'custom';
        const s = summaryApi.settings?.[provider] || {};
        if (s.endpoint) {
            return {
                endpoint: s.endpoint,
                model: s.model || '',
                temperature: s.temperature ?? 0.3,
                maxTokens: summaryApi.maxTokens || 800,
                apiKey: localStorage.getItem(`rpg_companion_gm_api_key_${provider}`) || ''
            };
        }
    }

    // Tracker API
    const trackerApi = gm.trackerApi || {};
    if (!trackerApi.useGmConnection) {
        const provider = trackerApi.provider || 'custom';
        const s = trackerApi.settings?.[provider] || {};
        if (s.endpoint) {
            return {
                endpoint: s.endpoint,
                model: s.model || '',
                temperature: s.temperature ?? 0.3,
                maxTokens: trackerApi.maxTokens || 500,
                apiKey: localStorage.getItem(`rpg_companion_gm_api_key_${provider}`) || ''
            };
        }
    }

    // GM API
    const gmApi = gm.api || {};
    const provider = gmApi.provider || 'custom';
    const s = gmApi.settings?.[provider] || {};
    if (s.endpoint) {
        return {
            endpoint: s.endpoint,
            model: s.model || '',
            temperature: s.temperature ?? 0.8,
            maxTokens: gmApi.maxTokens || 1000,
            apiKey: localStorage.getItem(`rpg_companion_gm_api_key_${provider}`) || ''
        };
    }

    return null; // fall back to safeGenerateRaw
}

/**
 * Call an OpenAI-compatible chat endpoint directly.
 *
 * @param {object} apiConfig - Resolved API config from resolveApiConfig
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function callExternalApi(apiConfig, messages) {
    const endpoint = apiConfig.endpoint.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (apiConfig.apiKey) headers['Authorization'] = `Bearer ${apiConfig.apiKey}`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: apiConfig.model,
            messages,
            max_tokens: apiConfig.maxTokens,
            temperature: apiConfig.temperature
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Memory API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Summarize a batch of messages into structured memory entries.
 *
 * @param {string} batchText - Concatenated messages
 * @param {object|null} apiConfig - Resolved external config, or null for ST generateRaw
 * @returns {Promise<Array<{title: string, content: string, keywords: string[]}>>}
 */
async function summarizeBatch(batchText, apiConfig) {
    const systemPrompt = [
        'You are a memory curator for a role-playing story.',
        'Given the following conversation excerpt, extract the most important memories.',
        'Return a JSON array of objects, each with:',
        '  "title" (short label),',
        '  "content" (1-3 sentence summary of the event/fact),',
        '  "keywords" (array of 3-6 single-word trigger terms a lorebook can match on).',
        'Return ONLY the JSON array, no commentary.'
    ].join('\n');

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: batchText }
    ];

    let raw;
    if (apiConfig) {
        raw = await callExternalApi(apiConfig, messages);
    } else {
        raw = await safeGenerateRaw({ prompt: messages, quietToLoud: false });
    }

    // Strip markdown fences if present
    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(m => m && m.title && m.content && Array.isArray(m.keywords));
    } catch {
        console.warn(LOG_PREFIX, 'Failed to parse memory JSON:', raw.slice(0, 300));
        return [];
    }
}

/**
 * Create a World Info entry via SillyTavern's internal API.
 *
 * @param {string} lorebookName - Target lorebook/world name
 * @param {{ title: string, content: string, keywords: string[] }} entry
 * @returns {Promise<boolean>}
 */
async function createWorldInfoEntry(lorebookName, entry) {
    try {
        const response = await fetch('/api/worldinfo/create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                name: lorebookName,
                entry: {
                    key: entry.keywords,
                    content: entry.content,
                    comment: entry.title,
                    disable: false,
                    position: 0
                }
            })
        });
        return response.ok;
    } catch (err) {
        console.error(LOG_PREFIX, 'WI create failed:', err);
        return false;
    }
}

/**
 * Run memory recollection: batch chat history, summarize, create lorebook entries.
 *
 * @param {object} [options]
 * @param {number} [options.batchSize=10]  - Messages per summarization batch
 * @param {string} [options.lorebookName='Memory Recollection'] - Target lorebook name
 * @param {object} [options.apiConfig]     - Override API config (endpoint, model, etc.)
 * @returns {Promise<{ memoriesCreated: number, errors: string[] }>}
 */
export async function runMemoryRecollection(options = {}) {
    const settings = extensionSettings.memoryRecollection || {};
    const batchSize = options.batchSize || settings.batchSize || 10;
    const lorebookName = options.lorebookName || settings.lorebookName || 'Memory Recollection';
    const apiConfig = resolveApiConfig(options.apiConfig);

    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) {
        return { memoriesCreated: 0, errors: ['No chat history available.'] };
    }

    const errors = [];
    let memoriesCreated = 0;

    // Build batches
    const batches = [];
    for (let i = 0; i < chat.length; i += batchSize) {
        const slice = chat.slice(i, i + batchSize);
        const text = slice.map(msg => {
            const role = msg.is_user ? 'User' : (msg.name || 'Assistant');
            return `${role}: ${msg.mes || ''}`;
        }).join('\n');
        batches.push(text);
    }

    console.log(LOG_PREFIX, `Processing ${batches.length} batch(es) from ${chat.length} messages`);

    for (let b = 0; b < batches.length; b++) {
        try {
            const memories = await summarizeBatch(batches[b], apiConfig);
            for (const mem of memories) {
                const ok = await createWorldInfoEntry(lorebookName, mem);
                if (ok) {
                    memoriesCreated++;
                } else {
                    errors.push(`Failed to create WI entry: ${mem.title}`);
                }
            }
        } catch (err) {
            const msg = `Batch ${b + 1} failed: ${err.message}`;
            console.error(LOG_PREFIX, msg);
            errors.push(msg);
        }
    }

    console.log(LOG_PREFIX, `Done — ${memoriesCreated} memories created, ${errors.length} errors`);
    return { memoriesCreated, errors };
}

/**
 * Set up a "Recall Memories" button in the GM UI area.
 * Idempotent — safe to call multiple times.
 */
export function setupMemoryRecollectionButton() {
    if ($('#rpg-memory-recollection-btn').length > 0) return;

    // Create wrapper if not present (shared with plot buttons etc.)
    if ($('#extension-buttons-wrapper').length === 0) {
        $('#send_form').prepend('<div id="extension-buttons-wrapper" style="text-align: center; margin: 5px auto;"></div>');
    }

    const btn = $(`
        <button id="rpg-memory-recollection-btn" class="menu_button interactable" style="
            background-color: #7c3aed;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            margin: 0 2px;
        " tabindex="0" role="button" title="Summarize chat history into lorebook memories">
            <i class="fa-solid fa-brain"></i>&nbsp;Recall Memories
        </button>
    `);

    btn.on('click', async () => {
        btn.prop('disabled', true).css('opacity', '0.5')
            .html('<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Recalling...');

        try {
            const result = await runMemoryRecollection();
            if (result.errors.length > 0) {
                toastr.warning(
                    `Created ${result.memoriesCreated} memories with ${result.errors.length} error(s).`,
                    'Memory Recollection'
                );
            } else {
                toastr.success(
                    `Created ${result.memoriesCreated} memories.`,
                    'Memory Recollection'
                );
            }
        } catch (err) {
            console.error(LOG_PREFIX, err);
            toastr.error(err.message, 'Memory Recollection Error');
        } finally {
            btn.prop('disabled', false).css('opacity', '1')
                .html('<i class="fa-solid fa-brain"></i>&nbsp;Recall Memories');
        }
    });

    $('#extension-buttons-wrapper').append(btn);
}
