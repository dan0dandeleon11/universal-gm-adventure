/**
 * Lorebook Limiter Module
 * Caps the number of World Info entries that activate per generation
 * to prevent token bloat from overly broad keyword matching.
 */

import { extensionSettings } from '../../core/state.js';
import { getContext } from '../../../../../../extensions.js';

const LOG_PREFIX = '[RPG Companion][LorebookLimiter]';

/** Tracks whether the hook has already been installed */
let hookInstalled = false;

/**
 * Whether the lorebook limiter is enabled and has a positive cap.
 * @returns {boolean}
 */
export function isLorebookLimiterEnabled() {
    const settings = extensionSettings.lorebookLimiter || {};
    return !!settings.enabled && (settings.maxActivations || 0) > 0;
}

/**
 * Apply the lorebook activation limit.
 *
 * Reads `extensionSettings.lorebookLimiter.maxActivations`.
 * If 0 or absent, this is a no-op (unlimited).
 *
 * Hooks into SillyTavern's WORLD_INFO_ACTIVATED event (fired after WI
 * entries are collected but before they are injected into context).
 * When the number of activated entries exceeds `maxActivations`, the
 * list is trimmed to keep only the most-recently-triggered entries.
 */
export function applyLorebookLimit() {
    if (!isLorebookLimiterEnabled()) return;
    if (hookInstalled) return;

    const context = getContext();
    const eventSource = context?.eventSource;
    if (!eventSource) {
        console.warn(LOG_PREFIX, 'eventSource not available — cannot install WI hook');
        return;
    }

    const maxActivations = extensionSettings.lorebookLimiter.maxActivations;

    // SillyTavern emits 'worldInfoActivated' with { entries: [] } after
    // WI scanning completes. Mutating the array in-place trims what gets
    // injected into the prompt.
    eventSource.on('worldInfoActivated', (data) => {
        if (!data?.entries || !Array.isArray(data.entries)) return;
        if (data.entries.length <= maxActivations) return;

        // Keep the tail (most recently matched entries are appended last
        // during the scan, so tail ≈ most recent triggers).
        const removed = data.entries.length - maxActivations;
        data.entries.splice(0, removed);

        console.log(LOG_PREFIX, `Trimmed ${removed} WI entries — kept ${maxActivations}`);
    });

    hookInstalled = true;
    console.log(LOG_PREFIX, `Installed — max ${maxActivations} activations per generation`);
}
