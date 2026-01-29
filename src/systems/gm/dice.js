/**
 * GM Mode - Dice System
 * Handles dice rolling with configurable thresholds
 * Ported from Universe GM Adventure
 */

import {
    extensionSettings,
    setPendingGMRoll,
    getPendingGMRoll
} from '../../core/state.js';

/**
 * Get dice thresholds from settings
 */
function getThresholds() {
    return extensionSettings.gmMode?.dice?.thresholds || {
        critFail: 1,
        fail: 5,
        partial: 10,
        success: 15,
        critSuccess: 20
    };
}

/**
 * Roll dice with XdY notation
 * @param {number} count - Number of dice
 * @param {number} sides - Number of sides per die
 * @returns {{total: number, rolls: number[], formula: string}}
 */
export function rollDice(count = 1, sides = 20) {
    const rolls = [];
    let total = 0;

    for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * sides) + 1;
        rolls.push(roll);
        total += roll;
    }

    return {
        total,
        rolls,
        formula: `${count}d${sides}`
    };
}

/**
 * Evaluate a roll result against thresholds
 * @param {number} total - The roll total
 * @param {number} sides - Die sides (for nat 1/nat max detection)
 * @returns {{result: string, description: string, isNatural: boolean}}
 */
export function evaluateRoll(total, sides = 20) {
    const thresholds = getThresholds();

    // Check for natural 1 or natural max
    const isNat1 = total === 1;
    const isNatMax = total === sides;

    let result, description;

    if (isNat1 || total <= thresholds.critFail) {
        result = 'crit-fail';
        description = 'Critical Failure!';
    } else if (total <= thresholds.fail) {
        result = 'fail';
        description = 'Failure';
    } else if (total <= thresholds.partial) {
        result = 'partial';
        description = 'Partial Success';
    } else if (total <= thresholds.success) {
        result = 'success';
        description = 'Success!';
    } else if (isNatMax || total >= thresholds.critSuccess) {
        result = 'crit-success';
        description = 'Critical Success!';
    } else {
        result = 'success';
        description = 'Success!';
    }

    return {
        result,
        description,
        isNatural: isNat1 || isNatMax
    };
}

/**
 * Perform a full dice roll with evaluation
 * @param {number} count - Number of dice
 * @param {number} sides - Sides per die
 * @param {number} modifier - Optional modifier to add to roll
 * @returns {Object} Complete roll result
 */
export function performRoll(count = 1, sides = 20, modifier = 0) {
    const roll = rollDice(count, sides);
    const modifiedTotal = roll.total + modifier;
    const evaluation = evaluateRoll(modifiedTotal, sides);

    const result = {
        ...roll,
        modifier,
        modifiedTotal,
        ...evaluation,
        timestamp: Date.now()
    };

    return result;
}

/**
 * Roll and store as pending GM roll (for next message)
 * @param {number} count - Number of dice
 * @param {number} sides - Sides per die
 * @param {number} modifier - Optional modifier
 * @param {string} action - Description of what this roll is for
 * @returns {Object} The roll result
 */
export function rollForGM(count = 1, sides = 20, modifier = 0, action = '') {
    const result = performRoll(count, sides, modifier);
    result.action = action;

    // Store as pending for GM processing
    setPendingGMRoll(result);

    console.log('[RPG Companion GM] Rolled for GM:', result);
    return result;
}

/**
 * Get the pending GM roll without clearing it
 */
export function peekPendingGMRoll() {
    return getPendingGMRoll();
}

/**
 * Get and clear the pending GM roll
 */
export function consumePendingGMRoll() {
    const roll = getPendingGMRoll();
    setPendingGMRoll(null);
    return roll;
}

/**
 * Format a roll result for display
 * @param {Object} result - Roll result object
 * @returns {string} Formatted string
 */
export function formatRollResult(result) {
    let text = `${result.formula}: ${result.total}`;

    if (result.modifier !== 0) {
        const sign = result.modifier > 0 ? '+' : '';
        text += ` ${sign}${result.modifier} = ${result.modifiedTotal}`;
    }

    text += ` (${result.description})`;

    if (result.action) {
        text = `${result.action}: ${text}`;
    }

    return text;
}

/**
 * Format roll for GM prompt injection
 * @param {Object} result - Roll result object
 * @returns {string} Formatted for GM context
 */
export function formatRollForGM(result) {
    let text = `Rolled ${result.modifiedTotal || result.total}`;

    if (result.modifier !== 0) {
        text += ` (${result.total} ${result.modifier > 0 ? '+' : ''}${result.modifier})`;
    }

    text += ` - ${result.description}`;

    return text;
}

/**
 * Get CSS class for result type (for styling)
 * @param {string} result - The result type
 * @returns {string} CSS class name
 */
export function getResultClass(result) {
    const classes = {
        'crit-fail': 'rpg-gm-roll-crit-fail',
        'fail': 'rpg-gm-roll-fail',
        'partial': 'rpg-gm-roll-partial',
        'success': 'rpg-gm-roll-success',
        'crit-success': 'rpg-gm-roll-crit-success'
    };
    return classes[result] || '';
}

/**
 * Get emoji for result type
 * @param {string} result - The result type
 * @returns {string} Emoji
 */
export function getResultEmoji(result) {
    const emojis = {
        'crit-fail': '💀',
        'fail': '❌',
        'partial': '⚠️',
        'success': '✅',
        'crit-success': '🌟'
    };
    return emojis[result] || '🎲';
}

/**
 * Parse dice notation string (e.g., "2d6+3")
 * @param {string} notation - Dice notation
 * @returns {{count: number, sides: number, modifier: number} | null}
 */
export function parseDiceNotation(notation) {
    const match = notation.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (!match) return null;

    return {
        count: parseInt(match[1]) || 1,
        sides: parseInt(match[2]),
        modifier: parseInt(match[3]) || 0
    };
}

/**
 * Roll from notation string
 * @param {string} notation - e.g., "1d20+5"
 * @param {string} action - Optional action description
 * @returns {Object | null} Roll result or null if invalid notation
 */
export function rollFromNotation(notation, action = '') {
    const parsed = parseDiceNotation(notation);
    if (!parsed) return null;

    return rollForGM(parsed.count, parsed.sides, parsed.modifier, action);
}
