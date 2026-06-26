/**
 * Beat Detector
 * Identifies major narrative beats in conversation history using configurable strategies.
 */

import { extensionSettings } from '../../core/state.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

/**
 * Available beat detection strategies.
 * - fixed: Every N messages marks a beat. Zero API cost.
 * - heuristic: Detects scene transitions from tracker state changes. Zero API cost.
 * - llm: Sends recent messages to the Summary API for beat identification. Costs one API call.
 */
export const STRATEGIES = {
    fixed: 'fixed',
    heuristic: 'heuristic',
    llm: 'llm'
};

/**
 * Detect narrative beat boundaries in conversation messages.
 *
 * @param {Array<object>} messages - SillyTavern chat messages array
 * @param {string} [strategy] - Detection strategy (defaults to settings)
 * @param {object} [config] - Optional overrides for strategy-specific config
 * @returns {Promise<number[]>} Array of message indices that are beat boundaries
 */
export async function detectBeats(messages, strategy, config) {
    const settings = extensionSettings.summarizer;
    const activeStrategy = strategy || settings.strategy || STRATEGIES.heuristic;
    const mergedConfig = { ...settings, ...config };

    switch (activeStrategy) {
        case STRATEGIES.fixed:
            return detectFixedBeats(messages, mergedConfig);
        case STRATEGIES.heuristic:
            return detectHeuristicBeats(messages, mergedConfig);
        case STRATEGIES.llm:
            return await detectLLMBeats(messages, mergedConfig);
        default:
            console.warn(`[Summarizer] Unknown beat strategy "${activeStrategy}", falling back to fixed`);
            return detectFixedBeats(messages, mergedConfig);
    }
}

/**
 * Fixed-interval beat detection. Every N messages = 1 beat.
 */
function detectFixedBeats(messages, config) {
    const interval = config.beatInterval || 10;
    const beats = [];
    for (let i = interval - 1; i < messages.length; i += interval) {
        beats.push(i);
    }
    return beats;
}

/**
 * Heuristic beat detection. Parses tracker state embedded in messages
 * to find scene transitions: location changes, time jumps, character
 * entry/exit, significant stat changes, quest state changes.
 */
function detectHeuristicBeats(messages, config) {
    const beats = [];
    let prevState = null;

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const state = extractTrackerState(msg);
        if (!state) continue;

        if (prevState && hasSceneTransition(prevState, state)) {
            beats.push(i);
        }
        prevState = state;
    }

    return beats;
}

/** Pull tracker state from a message's extra metadata or inline JSON. */
function extractTrackerState(message) {
    // SillyTavern stores extension data in message.extra
    const trackerData = message?.extra?.rpgCompanion;
    if (trackerData) return trackerData;

    // Fallback: try to find inline tracker block in message text
    const text = message?.mes || message?.message || '';
    const match = text.match(/```tracker\s*\n([\s\S]*?)```/);
    if (match) {
        try {
            return JSON.parse(match[1]);
        } catch {
            return null;
        }
    }
    return null;
}

/** Compare two tracker states for scene-transition signals. */
function hasSceneTransition(prev, curr) {
    // Location change
    if (getLocation(prev) !== getLocation(curr) &&
        getLocation(curr) !== null) {
        return true;
    }

    // Time period change (start/end jump)
    if (getTime(prev) !== getTime(curr) &&
        getTime(curr) !== null) {
        return true;
    }

    // Character entry or exit
    const prevChars = getCharacterNames(prev);
    const currChars = getCharacterNames(curr);
    if (prevChars && currChars) {
        const entered = currChars.filter(c => !prevChars.includes(c));
        const exited = prevChars.filter(c => !currChars.includes(c));
        if (entered.length > 0 || exited.length > 0) return true;
    }

    // Quest state change
    const prevQuest = getQuestState(prev);
    const currQuest = getQuestState(curr);
    if (prevQuest && currQuest && prevQuest !== currQuest) {
        return true;
    }

    // Significant stat change (HP drop > 30% etc.)
    if (hasSignificantStatChange(prev, curr)) return true;

    return false;
}

/** Extract location string from tracker state. */
function getLocation(state) {
    // infoBox may be stringified JSON or an object
    const info = parseInfoBox(state);
    return info?.location?.value || null;
}

/** Extract time string from tracker state. */
function getTime(state) {
    const info = parseInfoBox(state);
    if (!info?.time) return null;
    return `${info.time.start || ''}-${info.time.end || ''}`;
}

/** Parse the infoBox field, handling both string and object forms. */
function parseInfoBox(state) {
    if (!state?.infoBox) return null;
    if (typeof state.infoBox === 'string') {
        try { return JSON.parse(state.infoBox); } catch { return null; }
    }
    return state.infoBox;
}

/** Get character names from characterThoughts. */
function getCharacterNames(state) {
    if (!state?.characterThoughts) return null;
    let thoughts = state.characterThoughts;
    if (typeof thoughts === 'string') {
        try { thoughts = JSON.parse(thoughts); } catch { return null; }
    }
    if (!thoughts?.characters || !Array.isArray(thoughts.characters)) return null;
    return thoughts.characters.map(c => c.name || c.character).filter(Boolean);
}

/** Get quest state string for comparison. */
function getQuestState(state) {
    if (!state?.quests) return null;
    const q = state.quests;
    const parts = [q.main || ''];
    if (Array.isArray(q.optional)) parts.push(...q.optional);
    return parts.join('|');
}

/** Check for significant stat changes (e.g. large HP loss). */
function hasSignificantStatChange(prev, curr) {
    const prevStats = prev?.userStats;
    const currStats = curr?.userStats;
    if (!prevStats || !currStats) return false;

    // Check HP field specifically
    const prevHP = parseStatValue(prevStats, 'hp');
    const currHP = parseStatValue(currStats, 'hp');
    if (prevHP !== null && currHP !== null && prevHP > 0) {
        const dropRatio = (prevHP - currHP) / prevHP;
        if (dropRatio > 0.3) return true;
    }

    return false;
}

/** Try to extract a numeric stat value. */
function parseStatValue(stats, key) {
    if (typeof stats === 'string') {
        try { stats = JSON.parse(stats); } catch { return null; }
    }
    // stats might be { hp: { current: 50, max: 100 } } or { hp: 50 }
    const val = stats?.[key];
    if (val === undefined || val === null) return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val.current !== undefined) return Number(val.current);
    return Number(val) || null;
}

/**
 * LLM-based beat detection. Sends recent messages to the Summary API
 * and asks it to identify beat boundaries. Most accurate, costs one call.
 */
async function detectLLMBeats(messages, config) {
    const windowSize = Math.min(messages.length, 40);
    const recentMessages = messages.slice(-windowSize);
    const startIndex = messages.length - windowSize;

    const transcript = recentMessages.map((msg, i) => {
        const role = msg.is_user ? 'Player' : 'Narrator';
        const text = (msg.mes || msg.message || '').substring(0, 500);
        return `[${startIndex + i}] ${role}: ${text}`;
    }).join('\n\n');

    const prompt = [
        {
            role: 'system',
            content: `You are a narrative analyst. Given a transcript of an RPG session, identify the message indices where major narrative beats occur. A beat is a significant story moment: scene transitions, major revelations, combat starts/ends, character introductions, quest completions, dramatic turning points.

Return ONLY a JSON array of message index numbers. Example: [3, 12, 25]`
        },
        {
            role: 'user',
            content: `Identify the beat boundaries in this RPG transcript:\n\n${transcript}`
        }
    ];

    try {
        const raw = await safeGenerateRaw({ prompt });
        const match = raw.match(/\[[\d\s,]*\]/);
        if (match) {
            const indices = JSON.parse(match[0]);
            return indices.filter(i => typeof i === 'number' && i >= 0 && i < messages.length);
        }
        console.warn('[Summarizer] LLM beat detection returned unparseable response, falling back to fixed');
        return detectFixedBeats(messages, config);
    } catch (err) {
        console.error('[Summarizer] LLM beat detection failed:', err);
        return detectFixedBeats(messages, config);
    }
}
