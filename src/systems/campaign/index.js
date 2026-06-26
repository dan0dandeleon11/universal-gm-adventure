/**
 * Campaign System - Main Entry Point
 * Exports all campaign planner modules
 */

export {
    getCampaignState,
    addArc,
    updateArc,
    removeArc,
    setActiveArc,
    getActiveArc,
    triggerPlotPoint,
    addEncounter,
    updateEncounter,
    removeEncounter,
    triggerEncounter,
    getPendingEncounters,
    formatCampaignForInjection,
    getCompletionSummary,
} from './campaignPlanner.js';
