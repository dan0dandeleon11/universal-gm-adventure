/**
 * Session Manager
 * Handles multi-session campaigns where summaries carry forward between
 * sessions (chat reloads / new chats in the same campaign).
 *
 * Session data is persisted in chat_metadata.rpgSessions so it survives
 * page refreshes and travels with the chat file.
 */

import { extensionSettings } from '../../core/state.js';
import { chat, chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

const LOG_PREFIX = '[RPG Sessions]';

/**
 * Default session state when none exists yet.
 * @returns {{ currentSession: object|null, pastSessions: Array<object> }}
 */
function createDefaultState() {
    return {
        currentSession: null,
        pastSessions: []
    };
}

/**
 * Build a fresh session object.
 * @param {string} name - Human-readable session name
 * @returns {object}
 */
function createSession(name) {
    return {
        id: `session_${Date.now()}`,
        name: name || `Session ${(getSessionState().pastSessions?.length ?? 0) + 1}`,
        startedAt: new Date().toISOString(),
        turnCount: 0,
        summary: null
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current session data from chat_metadata.
 * Creates and persists a default structure if missing.
 * @returns {{ currentSession: object|null, pastSessions: Array<object> }}
 */
export function getSessionState() {
    if (!chat_metadata.rpgSessions) {
        chat_metadata.rpgSessions = createDefaultState();
    }
    return chat_metadata.rpgSessions;
}

/**
 * Start a new session, optionally ending (and auto-summarising) the current one.
 * @param {string} [name] - Name for the new session (auto-numbered if omitted)
 * @returns {Promise<object>} The newly created session
 */
export async function startNewSession(name) {
    const state = getSessionState();

    // Archive the current session if one is active
    if (state.currentSession) {
        await endCurrentSession();
    }

    const session = createSession(name);
    state.currentSession = session;
    saveChatDebounced();

    console.log(`${LOG_PREFIX} Started new session: ${session.name} (${session.id})`);
    return session;
}

/**
 * End the current session: generate a summary (if enabled), move it to
 * pastSessions, and clear currentSession.
 * @returns {Promise<object|null>} The archived session, or null if none was active
 */
export async function endCurrentSession() {
    const state = getSessionState();
    if (!state.currentSession) return null;

    const session = state.currentSession;
    const settings = extensionSettings.sessions || {};

    // Auto-summarise when enabled and there are messages to work with
    if (settings.autoSummaryOnEnd && chat && chat.length > 0) {
        try {
            session.summary = await generateSessionSummary(chat);
        } catch (err) {
            console.error(`${LOG_PREFIX} Summary generation failed:`, err);
            session.summary = '(Summary generation failed)';
        }
    }

    session.endedAt = new Date().toISOString();

    // Archive
    if (!state.pastSessions) state.pastSessions = [];
    state.pastSessions.push(session);
    state.currentSession = null;
    saveChatDebounced();

    console.log(`${LOG_PREFIX} Ended session: ${session.name} (${session.turnCount} turns)`);
    return session;
}

/**
 * Return the current session's running state (or null).
 * @returns {object|null}
 */
export function getCurrentSessionSummary() {
    return getSessionState().currentSession ?? null;
}

/**
 * Return the last N archived session summaries, most recent first.
 * @param {number} [depth] - How many to return (defaults to carryForwardDepth setting)
 * @returns {Array<object>}
 */
export function getPastSessionSummaries(depth) {
    const settings = extensionSettings.sessions || {};
    const d = depth ?? settings.carryForwardDepth ?? 3;
    const past = getSessionState().pastSessions || [];
    return past.slice(-d).reverse();
}

/**
 * Format past session summaries as an XML block suitable for prompt injection.
 * Respects the carryForwardDepth setting.
 * @returns {string} XML string, or empty string if no history
 */
export function formatSessionsForInjection() {
    const summaries = getPastSessionSummaries();
    if (summaries.length === 0) return '';

    const entries = summaries.map((s, i) => {
        const num = summaries.length - i;
        const summary = s.summary || '(no summary available)';
        return `  <session number="${num}" name="${escapeXml(s.name)}" turns="${s.turnCount}">\n    ${escapeXml(summary)}\n  </session>`;
    }).join('\n');

    return `<campaign_history>\n${entries}\n</campaign_history>`;
}

/**
 * Increment the turn counter for the active session.
 */
export function incrementTurnCount() {
    const state = getSessionState();
    if (state.currentSession) {
        state.currentSession.turnCount += 1;
        saveChatDebounced();
    }
}

/**
 * Use the connected LLM to produce a 2-3 paragraph narrative recap from a
 * batch of chat messages.
 * @param {Array<object>} messages - SillyTavern message objects ({ is_user, mes })
 * @returns {Promise<string>} Prose summary
 */
export async function generateSessionSummary(messages) {
    if (!messages || messages.length === 0) {
        return '(No messages to summarise)';
    }

    const transcript = messages.map(m => {
        const role = m.is_user ? 'Player' : 'Narrator';
        const text = m.mes || m.message || '';
        return `${role}: ${text}`;
    }).join('\n\n');

    const prompt = [
        {
            role: 'system',
            content: [
                'You are a campaign scribe for a tabletop RPG.',
                'Given a session transcript, write a 2-3 paragraph narrative recap.',
                'Cover: key events, important NPC interactions, decisions made,',
                'unresolved threads. Write in past tense, third person.',
                'Be concise but evocative. No meta-commentary, no markdown headings.'
            ].join(' ')
        },
        {
            role: 'user',
            content: `SESSION TRANSCRIPT:\n${transcript}\n\nWrite the session recap.`
        }
    ];

    const raw = await safeGenerateRaw({ prompt });

    if (!raw || typeof raw !== 'string' || !raw.trim()) {
        throw new Error('Empty response from summary generation');
    }

    return raw.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal XML-safe escaping for attribute / text content.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
