/**
 * GM Mode - Main Entry Point
 * Exports all GM system modules
 */

// Dice system
export {
    rollDice,
    evaluateRoll,
    performRoll,
    rollForGM,
    peekPendingGMRoll,
    consumePendingGMRoll,
    formatRollResult,
    formatRollForGM,
    getResultClass,
    getResultEmoji,
    parseDiceNotation,
    rollFromNotation
} from './dice.js';

// Frameworks
export {
    getAvailableFrameworks,
    getFramework,
    getActiveFramework,
    setActiveFramework,
    registerFramework,
    hasFeature,
    getMechanic,
    parseFrameworkResponse,
    BUILTIN_FRAMEWORKS
} from './frameworks.js';

// GM Engine
export {
    buildGMContext,
    buildGMPrompt,
    callGMAPI,
    processGMTurn,
    testGMAPIConnection,
    saveGMApiKey
} from './gmEngine.js';

// GM Injection
export {
    injectGMRuling,
    clearGMInjection,
    getCurrentGMInjection,
    previewInjection,
    getDefaultTemplates
} from './gmInjection.js';
