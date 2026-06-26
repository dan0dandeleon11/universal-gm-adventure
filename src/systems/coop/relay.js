/**
 * Co-Op Relay — formats GM narration for clipboard relay to a partner ST instance.
 */

import { extensionSettings } from '../../core/state.js';

const DEFAULT_TEMPLATE = `=== GM Narration ===
{{narration}}

=== What {{partnerName}} Perceives ===
{{perception}}

=== Your turn ===`;

const COMMAND_TAG_PATTERN = /<\/?(?:dice_roll|roll_result|state_update|tracker_update|command|system|internal)[^>]*>[\s\S]*?<\/(?:dice_roll|roll_result|state_update|tracker_update|command|system|internal)>|<\/?(?:dice_roll|roll_result|state_update|tracker_update|command|system|internal)[^>]*\/?>/gi;

/**
 * Strip command/system tags from narration text, keeping narrative content.
 * @param {string} text
 * @returns {string}
 */
function stripCommandTags(text) {
    if (!text) return '';
    return text.replace(COMMAND_TAG_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract the perception section from parsed framework sections.
 * @param {Object} parsedSections - Parsed sections from framework response
 * @returns {string}
 */
function extractPerception(parsedSections) {
    if (!parsedSections) return '';

    // Check common section names for character perception content
    const perceptionKeys = [
        'perception', 'perceives', 'character_perception',
        'partner_perception', 'what_they_perceive', 'sensory'
    ];

    for (const key of perceptionKeys) {
        if (parsedSections[key]) {
            return stripCommandTags(
                typeof parsedSections[key] === 'string'
                    ? parsedSections[key]
                    : parsedSections[key].content || parsedSections[key].text || ''
            );
        }
    }

    // Check for keys containing "percei" as a substring
    for (const [key, value] of Object.entries(parsedSections)) {
        if (key.toLowerCase().includes('percei')) {
            return stripCommandTags(
                typeof value === 'string' ? value : value.content || value.text || ''
            );
        }
    }

    return '';
}

/**
 * Format GM output for relay to partner ST instance.
 * @param {string} narration - Raw GM narration text
 * @param {Object} parsedSections - Parsed framework response sections
 * @param {Object} [settings] - Override settings (defaults to extensionSettings.coopRelay)
 * @returns {string} Formatted text ready for clipboard
 */
export function formatGMOutputForRelay(narration, parsedSections, settings) {
    const config = settings || extensionSettings.coopRelay || {};
    const partnerName = config.partnerName || 'Partner';
    const cleanNarration = stripCommandTags(narration || '');
    const perception = extractPerception(parsedSections);

    if (config.outputTemplate) {
        return config.outputTemplate
            .replace(/\{\{narration\}\}/g, cleanNarration)
            .replace(/\{\{perception\}\}/g, perception || '(No specific perception data)')
            .replace(/\{\{partnerName\}\}/g, partnerName);
    }

    let output = DEFAULT_TEMPLATE
        .replace(/\{\{narration\}\}/g, cleanNarration)
        .replace(/\{\{perception\}\}/g, perception || '(No specific perception data)')
        .replace(/\{\{partnerName\}\}/g, partnerName);

    return output;
}

/**
 * Copy text to clipboard and show toast notification.
 * @param {string} text
 * @returns {Promise<boolean>} Whether the copy succeeded
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        toastr.success('GM narration copied to clipboard');
        return true;
    } catch (err) {
        console.error('[Co-Op Relay] Clipboard write failed:', err);
        toastr.error('Failed to copy GM narration to clipboard: ' + err.message);
        return false;
    }
}

/**
 * Called after GM generates narration. Formats output and optionally auto-copies.
 * @param {string} narration - Raw GM narration
 * @param {Object} parsedSections - Parsed framework response sections
 * @returns {Promise<string>} The formatted relay text
 */
export async function onGMTurnComplete(narration, parsedSections) {
    const config = extensionSettings.coopRelay || {};
    const formatted = formatGMOutputForRelay(narration, parsedSections);

    if (config.autoClipboard) {
        await copyToClipboard(formatted);
    }

    return formatted;
}
