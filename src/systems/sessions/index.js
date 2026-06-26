/**
 * Session Management Module
 * Multi-session campaign support with carry-forward summaries.
 */

export {
    getSessionState,
    startNewSession,
    endCurrentSession,
    getCurrentSessionSummary,
    getPastSessionSummaries,
    formatSessionsForInjection,
    incrementTurnCount,
    generateSessionSummary
} from './sessionManager.js';
