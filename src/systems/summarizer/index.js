/**
 * Summarizer - Main Entry Point
 * Exports all summarizer system modules
 */

// Beat detection
export {
    detectBeats,
    STRATEGIES
} from './beatDetector.js';

// Rolling summary
export {
    createEmptySummary,
    shouldRefreshSummary,
    generateSummaryUpdate,
    getRecentBeats
} from './rollingSummary.js';

// Summary injection
export {
    injectSummary,
    clearSummaryInjection,
    maybeRefreshSummary
} from './summaryInjector.js';
