/**
 * Summary Injector
 * Injects rolling summary and recent beats into SillyTavern's prompt pipeline
 * for Bedrock prefix caching stability.
 */

import { setExtensionPrompt, extension_prompt_types } from '../../../../../../../script.js';
import {
    extensionSettings,
    getRollingSummaryData,
    setRollingSummaryData
} from '../../core/state.js';
import { detectBeats } from './beatDetector.js';
import { createEmptySummary, shouldRefreshSummary, generateSummaryUpdate, getRecentBeats } from './rollingSummary.js';

const PROMPT_KEY_SUMMARY = 'rpg_companion_summary';
const PROMPT_KEY_RECENT = 'rpg_companion_recent_beats';

/**
 * Inject summary and recent beats into the prompt at configured depths.
 *
 * Summary goes deep (default depth -10) for Bedrock cache stability.
 * Recent beats go shallow (default depth -3) for immediate context.
 *
 * @param {object} summaryData - The rolling summary object
 * @param {string} recentBeatsText - Pre-formatted recent beats text
 */
export function injectSummary(summaryData, recentBeatsText) {
    const settings = extensionSettings.summarizer;
    const tags = settings.tags || { outer: 'story_context', summary: 'summary', recent: 'recent_events' };
    const summaryDepth = settings.summaryDepth ?? 10;
    const recentDepth = settings.recentDepth ?? 3;

    // Build the summary block
    const summaryContent = formatSummaryBlock(summaryData, tags);

    // Build the full context block with both summary and recent events
    const fullBlock = [
        `<${tags.outer}>`,
        `<${tags.summary}>`,
        summaryContent,
        `</${tags.summary}>`,
        `<${tags.recent}>`,
        recentBeatsText || '(No recent events yet)',
        `</${tags.recent}>`,
        `</${tags.outer}>`
    ].join('\n');

    // Inject summary at deep depth for cache stability
    setExtensionPrompt(
        PROMPT_KEY_SUMMARY,
        fullBlock,
        extension_prompt_types.IN_CHAT,
        summaryDepth
    );
}

/**
 * Clear all summary-related extension prompts.
 */
export function clearSummaryInjection() {
    setExtensionPrompt(PROMPT_KEY_SUMMARY, '', extension_prompt_types.IN_CHAT, 0);
    setExtensionPrompt(PROMPT_KEY_RECENT, '', extension_prompt_types.IN_CHAT, 0);
}

/**
 * Check if the summary needs refreshing, regenerate if so, and inject.
 * Intended to be called before each generation.
 */
export async function maybeRefreshSummary() {
    const settings = extensionSettings.summarizer;
    if (!settings.enabled) return;

    // Get chat context from SillyTavern
    const chat = window.SillyTavern?.getContext?.()?.chat;
    if (!chat || chat.length === 0) return;

    // Detect beats
    const beatIndices = await detectBeats(chat, settings.strategy);
    const currentBeatCount = beatIndices.length;

    // Get or create summary state
    let summary = getRollingSummaryData();
    if (!summary) {
        summary = createEmptySummary();
        setRollingSummaryData(summary);
    }

    // Check if refresh is needed
    if (settings.autoRefresh && shouldRefreshSummary(summary, currentBeatCount)) {
        // Get new messages since last summary
        const newMessages = chat.slice(summary.lastUpdatedAtMessage);
        if (newMessages.length > 0) {
            const updated = await generateSummaryUpdate(summary, newMessages);
            updated.lastUpdatedAtMessage = chat.length;
            updated.beatCount = currentBeatCount;
            setRollingSummaryData(updated);
            summary = updated;
        }
    }

    // Build recent beats text and inject
    const recentText = getRecentBeats(chat, beatIndices, settings.recentBeatsToKeep);
    injectSummary(summary, recentText);
}

/** Format summary data into readable text for injection. */
function formatSummaryBlock(summaryData, tags) {
    if (!summaryData) return '(No summary available)';

    const parts = [];

    if (summaryData.narrative) {
        parts.push(summaryData.narrative);
    }

    if (summaryData.keyDetails?.length > 0) {
        parts.push('Key details: ' + summaryData.keyDetails.join('; '));
    }

    if (summaryData.characterMoments?.length > 0) {
        parts.push('Character moments: ' + summaryData.characterMoments.join('; '));
    }

    if (summaryData.activeThreads?.length > 0) {
        parts.push('Active threads: ' + summaryData.activeThreads.join('; '));
    }

    if (summaryData.worldState && Object.keys(summaryData.worldState).length > 0) {
        const entries = Object.entries(summaryData.worldState)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        parts.push('World state: ' + entries);
    }

    return parts.join('\n') || '(No summary available)';
}
