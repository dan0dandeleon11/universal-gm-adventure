/**
 * Unified Context Collector
 * Bridges UIE + RPG Companion data → Universe GM → Clean ambient output for Caleb
 *
 * This is the "master context controller" that:
 * 1. Collects data from UIE (if available)
 * 2. Collects data from RPG Companion tracker
 * 3. Sends combined data to Universe GM for processing
 * 4. Outputs ONE clean <world_state> block with NO instructions
 */

import { extensionSettings } from '../../core/state.js';
import { getCurrentLocation, getElectronicsForLocation, getTimeOfDay } from './locations.js';
import { getQueue, getQueueSummary } from './actionQueue.js';

/**
 * Try to get UIE's context data
 * UIE exposes rootProtocolBlock() which builds its ambient context
 */
async function getUIEContext() {
    try {
        // Check if UIE is loaded and has the rootProtocolBlock function
        if (window.UIE?.rootProtocolBlock) {
            const uieData = await window.UIE.rootProtocolBlock('');
            return uieData || '';
        }

        // Alternative: try to import from UIE if it's a module
        // This would require UIE to be in a known location
        return '';
    } catch (error) {
        console.log('[Unified Context] UIE not available:', error.message);
        return '';
    }
}

/**
 * Get UIE's settings/state directly if available
 */
function getUIEState() {
    try {
        if (window.UIE?.getSettings) {
            return window.UIE.getSettings();
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Get RPG Companion tracker context
 */
function getRPGCompanionContext() {
    const parts = [];

    try {
        // Get user stats
        const userStats = extensionSettings.userStats;
        if (userStats) {
            const parsed = typeof userStats === 'string' ? JSON.parse(userStats) : userStats;
            if (parsed.stats && Array.isArray(parsed.stats)) {
                const statsLine = parsed.stats
                    .filter(s => s.value !== undefined)
                    .map(s => `${s.name}: ${s.value}`)
                    .join(', ');
                if (statsLine) {
                    parts.push(`Player Stats: ${statsLine}`);
                }
            }
        }

        // Get info box (location, time, weather)
        const infoBox = extensionSettings.infoBox;
        if (infoBox) {
            const parsed = typeof infoBox === 'string' ? JSON.parse(infoBox) : infoBox;

            if (parsed.location?.value) {
                parts.push(`Location: ${parsed.location.value}`);
            }
            if (parsed.time?.start) {
                let timeStr = parsed.time.start;
                if (parsed.time.end && parsed.time.end !== parsed.time.start) {
                    timeStr += ` - ${parsed.time.end}`;
                }
                parts.push(`Time: ${timeStr}`);
            }
            if (parsed.weather?.forecast) {
                const emoji = parsed.weather.emoji || '';
                parts.push(`Weather: ${emoji} ${parsed.weather.forecast}`.trim());
            }
            if (parsed.date?.value) {
                parts.push(`Date: ${parsed.date.value}`);
            }
        }

        // Get present characters/NPCs
        const thoughts = extensionSettings.characterThoughts;
        if (thoughts) {
            const parsed = typeof thoughts === 'string' ? JSON.parse(thoughts) : thoughts;
            if (parsed.characters && Array.isArray(parsed.characters) && parsed.characters.length > 0) {
                const chars = parsed.characters.map(c => {
                    let charInfo = c.name || 'Unknown';
                    if (c.relationship) charInfo += ` (${c.relationship})`;
                    return charInfo;
                });
                parts.push(`Present: ${chars.join(', ')}`);
            }
        }

        // Get RPG attributes if available
        const classicStats = extensionSettings.classicStats;
        if (classicStats) {
            const attrs = Object.entries(classicStats)
                .filter(([k, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
                .join(', ');
            if (attrs) {
                parts.push(`Attributes: ${attrs}`);
            }
        }

        // Get level
        if (extensionSettings.level) {
            parts.push(`Level: ${extensionSettings.level}`);
        }

    } catch (error) {
        console.error('[Unified Context] Error getting RPG Companion context:', error);
    }

    return parts.join('\n');
}

/**
 * Get GM Mode specific context (locations, actions, queue)
 */
function getGMModeContext() {
    const parts = [];

    try {
        // Get current location from GM Mode
        const location = getCurrentLocation();
        if (location) {
            parts.push(`Current Location: ${location.name}`);
            if (location.description) {
                parts.push(`Scene: ${location.description}`);
            }

            // Get electronics for Caleb manifestation
            const electronics = getElectronicsForLocation(location);
            if (electronics && electronics.length > 0) {
                const strongSignals = electronics.filter(e => e.strength === 'strong');
                const mediumSignals = electronics.filter(e => e.strength === 'medium');

                if (strongSignals.length > 0) {
                    parts.push(`Strong electronic signals: ${strongSignals.map(e => e.name).join(', ')}`);
                }
                if (mediumSignals.length > 0) {
                    parts.push(`Moderate signals: ${mediumSignals.map(e => e.name).join(', ')}`);
                }
            }
        }

        // Get time of day
        const timeOfDay = getTimeOfDay();
        if (timeOfDay) {
            parts.push(`Time of day: ${timeOfDay}`);
        }

        // Get queued actions
        const queue = getQueue();
        if (queue && queue.length > 0) {
            const actionList = queue.map((a, i) => `${i + 1}. ${a.name}`).join(', ');
            parts.push(`Queued actions: ${actionList}`);

            const summary = getQueueSummary();
            if (summary.totalTime > 0) {
                parts.push(`Total time cost: ${summary.totalTime} minutes`);
            }
        }

    } catch (error) {
        console.error('[Unified Context] Error getting GM Mode context:', error);
    }

    return parts.join('\n');
}

/**
 * Get last dice roll info
 */
function getDiceContext() {
    try {
        const lastRoll = extensionSettings.lastDiceRoll;
        if (lastRoll) {
            return `Last roll: ${lastRoll.total} (${lastRoll.formula})`;
        }
    } catch (error) {
        // Ignore
    }
    return '';
}

/**
 * Collect ALL context from all sources
 */
export async function collectUnifiedContext() {
    const sections = [];

    // 1. Get UIE context (if available)
    const uieContext = await getUIEContext();
    if (uieContext) {
        sections.push({
            source: 'uie',
            label: 'Game Systems',
            content: uieContext
        });
    }

    // 2. Get RPG Companion context
    const rpgContext = getRPGCompanionContext();
    if (rpgContext) {
        sections.push({
            source: 'rpg-companion',
            label: 'Player Status',
            content: rpgContext
        });
    }

    // 3. Get GM Mode context
    const gmContext = getGMModeContext();
    if (gmContext) {
        sections.push({
            source: 'gm-mode',
            label: 'World State',
            content: gmContext
        });
    }

    // 4. Get dice context
    const diceContext = getDiceContext();
    if (diceContext) {
        sections.push({
            source: 'dice',
            label: 'Dice',
            content: diceContext
        });
    }

    return sections;
}

/**
 * Format unified context for GM API
 * This is what gets sent TO the Universe GM for processing
 */
export async function formatContextForGM() {
    const sections = await collectUnifiedContext();

    if (sections.length === 0) {
        return '';
    }

    const lines = ['=== CURRENT WORLD STATE ==='];

    for (const section of sections) {
        lines.push('');
        lines.push(`[${section.label}]`);
        lines.push(section.content);
    }

    return lines.join('\n');
}

/**
 * Format the FINAL output for Caleb
 * This is pure ambient data - NO instructions, NO commands
 * Just facts about the world state
 */
export function formatAmbientOutput(gmNarration = '', diceResult = null, worldState = '') {
    const parts = [];

    // World state section
    if (worldState) {
        parts.push(worldState);
    }

    // Dice result (just the facts)
    if (diceResult) {
        parts.push(`[Roll: ${diceResult.total} on ${diceResult.formula}]`);
    }

    // GM's ambient narration (what happened in the world)
    if (gmNarration) {
        parts.push('');
        parts.push('[Recent Events]');
        parts.push(gmNarration);
    }

    if (parts.length === 0) {
        return '';
    }

    // Wrap in world_state tags - clean, data-only
    return `<world_state>
${parts.join('\n')}
</world_state>`;
}

/**
 * Build the complete unified context for injection
 * This replaces BOTH UIE's and RPG Companion's separate injections
 */
export async function buildUnifiedInjection(gmNarration = '', diceResult = null) {
    // Collect all context
    const sections = await collectUnifiedContext();

    // Format as simple world state
    let worldState = '';
    for (const section of sections) {
        if (section.content) {
            worldState += section.content + '\n\n';
        }
    }

    // Create the final ambient output
    return formatAmbientOutput(gmNarration, diceResult, worldState.trim());
}

/**
 * Check if UIE is available and get its injection status
 */
export function checkUIEStatus() {
    try {
        const hasUIE = !!(window.UIE || window.UIE_getSettings);
        const uieSettings = getUIEState();
        const injectionDisabled = uieSettings?.disableInjection === true;

        return {
            available: hasUIE,
            injectionDisabled,
            settings: uieSettings
        };
    } catch (error) {
        return {
            available: false,
            injectionDisabled: false,
            settings: null
        };
    }
}

/**
 * Disable UIE's direct injection (so we can control it)
 */
export function disableUIEInjection() {
    try {
        if (window.UIE?.getSettings) {
            const settings = window.UIE.getSettings();
            if (settings) {
                settings.disableInjection = true;
                if (window.UIE.saveSettings) {
                    window.UIE.saveSettings();
                }
                console.log('[Unified Context] Disabled UIE direct injection');
                return true;
            }
        }
    } catch (error) {
        console.error('[Unified Context] Could not disable UIE injection:', error);
    }
    return false;
}

/**
 * Re-enable UIE's direct injection
 */
export function enableUIEInjection() {
    try {
        if (window.UIE?.getSettings) {
            const settings = window.UIE.getSettings();
            if (settings) {
                settings.disableInjection = false;
                if (window.UIE.saveSettings) {
                    window.UIE.saveSettings();
                }
                console.log('[Unified Context] Re-enabled UIE direct injection');
                return true;
            }
        }
    } catch (error) {
        console.error('[Unified Context] Could not enable UIE injection:', error);
    }
    return false;
}
