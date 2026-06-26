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
} from './npcTracker.js';
