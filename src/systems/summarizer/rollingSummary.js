/**
 * Rolling Summary
 * Maintains and updates a rolling narrative summary of conversation history.
 */

import { extensionSettings } from '../../core/state.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const SUMMARY_SCHEMA_KEYS = [
    'narrative', 'keyDetails', 'characterMoments',
    'activeThreads', 'worldState', 'lastUpdatedAtMessage', 'beatCount'
];

/**
 * Create an empty summary object matching the canonical schema.
 * @returns {object} Fresh summary with all fields at defaults
 */
export function createEmptySummary() {
    return {
        narrative: '',
        keyDetails: [],
        characterMoments: [],
        activeThreads: [],
        worldState: {},
        lastUpdatedAtMessage: 0,
        beatCount: 0
    };
}

/**
 * Check whether the summary is stale and needs regeneration.
 *
 * @param {object} summary - Current rolling summary
 * @param {number} currentBeatCount - Total beats detected so far
 * @param {number} [threshold] - How many new beats before refresh (defaults to settings)
 * @returns {boolean} True if summary should be refreshed
 */
export function shouldRefreshSummary(summary, currentBeatCount, threshold) {
    const settings = extensionSettings.summarizer;
    const th = threshold ?? settings.refreshThreshold ?? 3;
    if (!summary || !summary.beatCount) return currentBeatCount >= 1;
    return (currentBeatCount - summary.beatCount) >= th;
}

/**
 * Generate an updated rolling summary by feeding existing summary + new messages
 * to the model.
 *
 * @param {object} existingSummary - Current summary (or null for first run)
 * @param {Array<object>} newMessages - New messages since last summary update
 * @param {object} [apiConfig] - Optional overrides (unused currently; reserved)
 * @returns {Promise<object>} Updated summary object
 */
export async function generateSummaryUpdate(existingSummary, newMessages, apiConfig) {
    const settings = extensionSettings.summarizer;
    const current = existingSummary || createEmptySummary();

    const transcript = newMessages.map(msg => {
        const role = msg.is_user ? 'Player' : 'Narrator';
        const text = msg.mes || msg.message || '';
        return `${role}: ${text}`;
    }).join('\n\n');

    const existingSummaryJSON = JSON.stringify(current, null, 2);

    const prompt = [
        {
            role: 'system',
            content: `You are a narrative summarizer for a tabletop RPG session. You maintain a rolling summary that captures the essential story state.

Given the existing summary and new transcript, produce an UPDATED summary as a JSON object with exactly these fields:

- "narrative" (string): A concise prose summary of the story so far, incorporating the new events. Keep under ${settings.summaryMaxTokens || 800} tokens.
- "keyDetails" (array of strings): Important facts, names, items, locations that matter going forward. Drop obsolete entries, add new ones.
- "characterMoments" (array of strings): Notable character moments, relationship shifts, emotional beats. Keep the most recent and impactful.
- "activeThreads" (array of strings): Unresolved plot threads, open questions, pending decisions. Remove resolved ones, add new ones.
- "worldState" (object): Key world-state facts as key-value pairs (e.g. {"currentLocation": "Dark Forest", "timeOfDay": "night", "partyGold": 250}). Update with current values.

Return ONLY valid JSON. No markdown fences, no explanation.`
        },
        {
            role: 'user',
            content: `EXISTING SUMMARY:
${existingSummaryJSON}

NEW EVENTS:
${transcript}

Produce the updated summary JSON.`
        }
    ];

    try {
        const raw = await safeGenerateRaw({ prompt });
        const parsed = parseJSONResponse(raw);

        // Merge with schema defaults so no field is missing
        const updated = createEmptySummary();
        for (const key of SUMMARY_SCHEMA_KEYS) {
            if (key === 'lastUpdatedAtMessage' || key === 'beatCount') continue;
            if (parsed[key] !== undefined) {
                updated[key] = parsed[key];
            }
        }

        // Preserve metadata fields — caller is responsible for setting these
        updated.lastUpdatedAtMessage = current.lastUpdatedAtMessage;
        updated.beatCount = current.beatCount;

        return updated;
    } catch (err) {
        console.error('[Summarizer] Failed to generate summary update:', err);
        return current;
    }
}

/**
 * Extract full-text content of the most recent N beats from messages.
 *
 * @param {Array<object>} messages - Full chat messages array
 * @param {number[]} beatIndices - Beat boundary indices from detectBeats
 * @param {number} [keepCount] - Number of recent beats to keep (defaults to settings)
 * @returns {string} Concatenated text of recent beat-window messages
 */
export function getRecentBeats(messages, beatIndices, keepCount) {
    const settings = extensionSettings.summarizer;
    const count = keepCount ?? settings.recentBeatsToKeep ?? 3;

    if (!beatIndices || beatIndices.length === 0) return '';

    // Take the last `count` beat boundaries
    const relevantBeats = beatIndices.slice(-count);
    const startIdx = relevantBeats[0];

    // Grab everything from the earliest selected beat to end of messages
    const segment = messages.slice(startIdx);
    return segment.map(msg => {
        const role = msg.is_user ? 'Player' : 'Narrator';
        const text = msg.mes || msg.message || '';
        return `${role}: ${text}`;
    }).join('\n\n');
}

/** Attempt to parse a JSON response, handling markdown fences and trailing text. */
function parseJSONResponse(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Empty or non-string response');
    }

    // Strip markdown code fences if present
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    // Try parsing directly
    try {
        return JSON.parse(cleaned);
    } catch {
        // Try extracting the first {...} block
        const braceMatch = cleaned.match(/\{[\s\S]*\}/);
        if (braceMatch) {
            return JSON.parse(braceMatch[0]);
        }
        throw new Error('Could not parse JSON from response');
    }
}
