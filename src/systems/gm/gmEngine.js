/**
 * GM Mode - Engine
 * Handles GM API calls and turn processing
 * Ported from Universe GM Adventure
 */

import { extensionSettings } from '../../core/state.js';
import { getActiveFramework, hasFeature, parseFrameworkResponse } from './frameworks.js';
import { consumePendingGMRoll, formatRollForGM, formatRollResult } from './dice.js';
import { injectGMRuling } from './gmInjection.js';

/**
 * Get GM API settings
 */
function getGMApiSettings() {
    const gmSettings = extensionSettings.gmMode?.api || {};
    const provider = gmSettings.provider || 'custom';
    const providerSettings = gmSettings.settings?.[provider] || {};

    return {
        provider,
        endpoint: providerSettings.endpoint || '',
        model: providerSettings.model || '',
        temperature: providerSettings.temperature ?? 0.8,
        maxTokens: gmSettings.maxTokens || 1000
    };
}

/**
 * Load API key from localStorage (secure storage)
 */
function loadGMApiKey(provider) {
    const key = `rpg_companion_gm_api_key_${provider}`;
    return localStorage.getItem(key) || '';
}

/**
 * Save API key to localStorage
 */
export function saveGMApiKey(provider, apiKey) {
    const key = `rpg_companion_gm_api_key_${provider}`;
    if (apiKey && apiKey.trim()) {
        localStorage.setItem(key, apiKey.trim());
    } else {
        localStorage.removeItem(key);
    }
}

/**
 * Build context for GM API call
 */
export function buildGMContext(playerMessage = '', diceRoll = null) {
    const framework = getActiveFramework();
    const trackerConfig = extensionSettings.trackerConfig;

    let context = {
        systemPrompt: framework.gm.systemPrompt,
        responseFormat: framework.gm.responseFormat,
        gmName: framework.gm.gmName || 'Game Master',
        framework
    };

    // Build action context from player message
    let actionContext = `PLAYER ACTION:\n${playerMessage || '(No specific action described)'}`;

    // Add dice roll if present
    if (diceRoll) {
        actionContext += `\n\nDICE ROLL RESULT:\n${formatRollResult(diceRoll)}`;
        actionContext += `\n\nIMPORTANT: The dice have spoken. Narrate the outcome accordingly:`;

        // Add roll interpretation guidance
        switch (diceRoll.result) {
            case 'crit-fail':
                actionContext += `\n- This is a CRITICAL FAILURE. Something goes dramatically wrong.`;
                break;
            case 'fail':
                actionContext += `\n- This is a FAILURE. The action doesn't succeed, but it's not catastrophic.`;
                break;
            case 'partial':
                actionContext += `\n- This is a PARTIAL SUCCESS. The action partially works, but with complications.`;
                break;
            case 'success':
                actionContext += `\n- This is a SUCCESS. The action works as intended.`;
                break;
            case 'crit-success':
                actionContext += `\n- This is a CRITICAL SUCCESS! Something extra good happens.`;
                break;
        }
    }

    // Add tracker context if available (location, time, etc.)
    let trackerContext = '';

    // Try to get current tracker data
    try {
        // Parse current info box for location/time
        const infoBox = extensionSettings.infoBox;
        if (infoBox) {
            const parsed = typeof infoBox === 'string' ? JSON.parse(infoBox) : infoBox;

            if (parsed.location?.value) {
                trackerContext += `CURRENT LOCATION: ${parsed.location.value}\n`;
            }
            if (parsed.time?.start) {
                trackerContext += `TIME: ${parsed.time.start}`;
                if (parsed.time.end && parsed.time.end !== parsed.time.start) {
                    trackerContext += ` - ${parsed.time.end}`;
                }
                trackerContext += '\n';
            }
            if (parsed.weather?.forecast) {
                trackerContext += `WEATHER: ${parsed.weather.emoji || ''} ${parsed.weather.forecast}\n`;
            }
        }
    } catch (e) {
        // Ignore parsing errors
    }

    context.actionContext = actionContext;
    context.trackerContext = trackerContext;

    return context;
}

/**
 * Build the full prompt for GM API
 */
export function buildGMPrompt(playerMessage = '', diceRoll = null) {
    const context = buildGMContext(playerMessage, diceRoll);

    // Combine tracker context and action context
    let userPrompt = '';

    if (context.trackerContext) {
        userPrompt += context.trackerContext + '\n';
    }

    userPrompt += context.actionContext;

    if (context.responseFormat) {
        userPrompt += '\n\n' + context.responseFormat;
    }

    return {
        systemPrompt: context.systemPrompt,
        userPrompt,
        diceRoll,
        context
    };
}

/**
 * Call the GM API
 */
export async function callGMAPI(playerMessage = '', diceRoll = null) {
    const apiSettings = getGMApiSettings();
    const apiKey = loadGMApiKey(apiSettings.provider);

    if (!apiSettings.endpoint) {
        return {
            success: false,
            error: 'No GM API endpoint configured. Please set up the GM API in settings.'
        };
    }

    const { systemPrompt, userPrompt, context } = buildGMPrompt(playerMessage, diceRoll);

    const headers = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const requestBody = {
            model: (apiSettings.model || 'default').trim(),
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: apiSettings.maxTokens,
            temperature: apiSettings.temperature
        };

        console.log('[RPG Companion GM] API Request:', {
            endpoint: apiSettings.endpoint,
            model: apiSettings.model,
            temperature: apiSettings.temperature
        });

        const response = await fetch(apiSettings.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                error: `API Error ${response.status}: ${errorText.substring(0, 200)}`
            };
        }

        const data = await response.json();

        // Extract the response text (OpenAI-compatible format)
        let narration = '';
        if (data.choices && data.choices[0]) {
            narration = data.choices[0].message?.content || data.choices[0].text || '';
        }

        return {
            success: true,
            narration,
            diceRoll,
            context
        };

    } catch (error) {
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return {
                success: false,
                error: 'Network error - the API endpoint may be blocked by CORS or unreachable.'
            };
        }
        return { success: false, error: error.message };
    }
}

/**
 * Process a GM turn:
 * 1. Get pending dice roll (if any) or use provided roll
 * 2. Build context from queue, location, and tracker
 * 3. Call GM API
 * 4. Inject result into context
 * 5. Return result for UI display
 *
 * @param {string} playerMessage - Optional player message
 * @param {Object} options - Additional context options
 * @param {string} options.queueContext - Formatted queue for GM
 * @param {string} options.locationContext - Formatted location for GM
 * @param {Object} options.roll - Optional pre-rolled dice result
 */
export async function processGMTurn(playerMessage = '', options = {}) {
    // Get and consume any pending dice roll, or use provided roll
    const diceRoll = options.roll || consumePendingGMRoll();

    // Build enhanced context with queue and location
    const enhancedMessage = buildEnhancedPlayerMessage(playerMessage, options);

    // Call GM API
    const result = await callGMAPI(enhancedMessage, diceRoll);

    if (!result.success) {
        return {
            success: false,
            error: result.error,
            diceRoll
        };
    }

    // Parse response according to framework
    const parsedSections = parseFrameworkResponse(result.narration);

    // Inject into context for main AI
    injectGMRuling(result.narration, diceRoll);

    return {
        success: true,
        narration: result.narration,
        diceRoll,
        parsedSections,
        context: result.context,
        queueProcessed: !!options.queueContext
    };
}

/**
 * Build enhanced player message with queue and location context
 */
function buildEnhancedPlayerMessage(playerMessage, options) {
    const parts = [];

    // Add location context first
    if (options.locationContext) {
        parts.push(options.locationContext);
    }

    // Add queue context
    if (options.queueContext) {
        parts.push(options.queueContext);
    }

    // Add player message if any
    if (playerMessage && playerMessage.trim()) {
        parts.push(`PLAYER MESSAGE:\n${playerMessage.trim()}`);
    }

    return parts.join('\n\n') || '(Player takes their turn)';
}

/**
 * Test the GM API connection
 */
export async function testGMAPIConnection() {
    const apiSettings = getGMApiSettings();
    const apiKey = loadGMApiKey(apiSettings.provider);

    if (!apiSettings.endpoint) {
        return {
            success: false,
            message: 'No endpoint configured'
        };
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(apiSettings.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: (apiSettings.model || 'default').trim(),
                messages: [
                    { role: 'user', content: 'Respond with exactly: "Connection OK"' }
                ],
                max_tokens: 50,
                temperature: apiSettings.temperature
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                message: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
            };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

        return {
            success: true,
            message: `Connected! Response: ${content.substring(0, 50)}`,
            model: apiSettings.model
        };

    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
}
