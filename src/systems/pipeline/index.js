/**
 * Pipeline - Main Entry Point
 */

export {
    registerAgent,
    unregisterAgent,
    getAgentsForPhase,
    getAgent,
    getRegisteredAgentIds,
    resolveAgentConnection,
    groupAgentsByConnection
} from './agentRegistry.js';

export {
    executeAgentGroup
} from './batchExecutor.js';

export {
    runPreGenerationAgents,
    startParallelAgents,
    collectParallelResults,
    runPostProcessingAgents,
    clearPipelineState,
    saveAgentMemory,
    getAgentMemory
} from './pipeline.js';
