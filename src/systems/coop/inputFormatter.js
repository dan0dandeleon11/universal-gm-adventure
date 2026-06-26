/**
 * Co-Op Input Formatter — helpers for formatting dual-character input
 * when both player and AI partner have actions.
 */

import { extensionSettings } from '../../core/state.js';

/**
 * Format combined input from both player and AI partner.
 * @param {string} playerAction - The player's action text
 * @param {string} partnerAction - The AI partner's action text
 * @param {string} [playerName] - Player character name
 * @param {string} [partnerName] - Partner character name (defaults to coopRelay.partnerName)
 * @returns {string} Combined formatted input
 */
export function formatDualInput(playerAction, partnerAction, playerName, partnerName) {
    const pName = playerName || 'Player';
    const aName = partnerName || (extensionSettings.coopRelay && extensionSettings.coopRelay.partnerName) || 'Partner';

    return `[${pName}]: ${playerAction}\n[${aName}]: ${partnerAction}`;
}

/**
 * Detect whether pasted text looks like it came from a partner ST response.
 * Uses simple heuristics: multi-paragraph content, or starts with common
 * AI response patterns (action narration, dialogue, emotes).
 * @param {string} text - The pasted text to check
 * @param {string} [partnerName] - Partner name to check for
 * @returns {boolean}
 */
export function detectPartnerPaste(text, partnerName) {
    if (!text || typeof text !== 'string') return false;

    const trimmed = text.trim();
    if (!trimmed) return false;

    const name = partnerName || (extensionSettings.coopRelay && extensionSettings.coopRelay.partnerName) || '';

    // Check if it starts with the partner's name
    if (name && trimmed.startsWith(name)) return true;

    // Multi-paragraph text (2+ paragraphs) is likely pasted from a response
    const paragraphs = trimmed.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length >= 2) return true;

    // Starts with common AI narration patterns: asterisk actions, quotes, third person
    if (/^\*[^*]/.test(trimmed)) return true;           // *action narration*
    if (/^"[^"]{10,}/.test(trimmed)) return true;       // "dialogue..."
    if (/^[A-Z][a-z]+ (?:looks|turns|steps|moves|nods|shakes|smiles|frowns|reaches|walks|says|whispers|murmurs|glances)/
        .test(trimmed)) return true;                     // Third-person narration

    return false;
}

/**
 * Wrap text with the partner's name prefix if not already prefixed.
 * @param {string} text - Text to wrap
 * @param {string} [partnerName] - Partner name (defaults to coopRelay.partnerName)
 * @returns {string}
 */
export function wrapWithPartnerPrefix(text, partnerName) {
    const name = partnerName || (extensionSettings.coopRelay && extensionSettings.coopRelay.partnerName) || 'Partner';
    const prefix = `[${name}]: `;

    if (text && text.trimStart().startsWith(prefix)) {
        return text;
    }

    return prefix + (text || '');
}
