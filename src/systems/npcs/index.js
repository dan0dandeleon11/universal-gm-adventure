/**
 * NPC System - Main Entry Point
 * Exports all NPC tracking and reputation modules
 */

export {
    getNPCs,
    getNPC,
    addNPC,
    updateNPC,
    removeNPC,
    adjustReputation,
    getReputationLabel,
    getRelevantNPCs,
    formatNPCsForInjection,
    findNPCByName,
    tickAllNeeds,
    addMemory,
    getNPCContextSummary,
} from './npcTracker.js';

export {
    createDefaultNeeds,
    tickNeeds,
    decide,
    applyAction,
    getUrgentNeed,
    formatNeedsSummary,
} from './utilityAI.js';
