/**
 * GM Mode - Injection System
 * Handles injecting GM rulings into context for the main AI
 * Supports "ambient" mode (data only) vs "instructional" mode
 *
 * NEW: Unified mode combines UIE + RPG Companion data through Universe GM
 */

import { extension_prompt_types, setExtensionPrompt } from '../../../../../../../script.js';
import {
    extensionSettings,
    setLatestGMNarration,
    getLatestGMNarration,
    addGMNarrationToHistory,
    clearGMNarrationHistory
} from '../../core/state.js';
import { getActiveFramework } from './frameworks.js';
import { formatRollForGM } from './dice.js';
import { buildUnifiedInjection, disableUIEInjection, checkUIEStatus } from './unifiedContext.js';

// Extension prompt ID for GM injection
const GM_INJECTION_ID = 'rpg-companion-gm-ruling';

/**
 * Get injection settings from state
 */
function getInjectionSettings() {
    return extensionSettings.gmMode?.injection || {
        mode: 'ambient',
        position: 'before_user_message',
        depth: 1,
        templates: {},
        customTags: {}
    };
}

/**
 * Get the appropriate tag name (custom or default)
 */
function getTagName(tagType) {
    const settings = getInjectionSettings();
    const defaults = {
        gmRuling: 'ambient_observation',
        trackerContext: 'world_state',
        diceResults: 'dice_results'
    };
    return settings.customTags?.[tagType] || defaults[tagType];
}

/**
 * Simple template renderer with Handlebars-like syntax
 * Supports: {{variable}}, {{#if variable}}...{{/if}}
 */
function renderTemplate(template, data) {
    if (!template) return '';

    let result = template;

    // Handle {{#if variable}}content{{/if}} blocks
    const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifRegex, (match, varName, content) => {
        const value = data[varName];
        // Truthy check: exists and not empty string
        if (value && value !== '') {
            return content;
        }
        return '';
    });

    // Handle {{variable}} replacements
    const varRegex = /\{\{(\w+)\}\}/g;
    result = result.replace(varRegex, (match, varName) => {
        return data[varName] !== undefined ? data[varName] : '';
    });

    return result.trim();
}

/**
 * Build ambient context from GM narration
 * This is the "Caleb-friendly" format - data only, no instructions
 */
function buildAmbientContext(narration, diceRoll, framework) {
    const settings = getInjectionSettings();
    const gmName = framework.gm?.gmName || 'Game Master';
    const charName = framework.character?.name || 'Partner';

    // Parse framework response sections
    const sections = parseNarrationSections(narration, framework);

    // Build dice results string if present
    let diceResults = '';
    if (diceRoll) {
        diceResults = formatRollForGM(diceRoll);
        if (diceRoll.action) {
            diceResults = `${diceRoll.action}: ${diceResults}`;
        }
    }

    // Get perception section if framework has one
    const perception = sections.perception || sections.apartment || '';

    // Use custom template if provided, otherwise build default
    const customTemplate = settings.templates?.gmRuling;

    if (customTemplate && customTemplate.trim()) {
        return renderTemplate(customTemplate, {
            gm_name: gmName,
            character_name: charName,
            narration: sections.narration || narration,
            dice_results: diceResults,
            perception: perception,
            framework: framework.name || framework.id
        });
    }

    // Default ambient format - data only, no behavioral instructions
    const tag = getTagName('gmRuling');
    let context = `<${tag}>`;

    // GM narration
    context += `\n[${gmName} narrates]: ${sections.narration || narration}`;

    // Dice results if present
    if (diceResults) {
        context += `\n[Dice: ${diceResults}]`;
    }

    // Character perception section if present
    if (perception) {
        context += `\n[What ${charName} perceives]: ${perception}`;
    }

    context += `\n</${tag}>`;

    return context;
}

/**
 * Build instructional context (the "old" way - includes behavioral hints)
 * Kept for users who prefer explicit instructions
 */
function buildInstructionalContext(narration, diceRoll, framework) {
    const gmName = framework.gm?.gmName || 'Game Master';

    let context = `<gm_ruling>
[${gmName} - Game Master Ruling]

${narration}`;

    if (diceRoll) {
        context += `\n\nDice Roll: ${formatRollForGM(diceRoll)}`;
    }

    context += `

[The above describes what happened in the game world. React and respond naturally to these events. The outcome has been determined by the dice roll.]
</gm_ruling>`;

    return context;
}

/**
 * Parse narration into framework-defined sections
 */
function parseNarrationSections(narration, framework) {
    const sections = { narration: narration };

    if (!framework.responseSections || framework.responseSections.length === 0) {
        return sections;
    }

    for (const section of framework.responseSections) {
        if (section.header) {
            // Build regex to extract section content
            const headerEscaped = section.header.replace(/[\[\]]/g, '\\$&');
            const regex = new RegExp(`${headerEscaped}\\s*([\\s\\S]*?)(?=\\[|$)`, 'i');
            const match = narration.match(regex);
            if (match) {
                sections[section.id] = match[1].trim();
            }
        }
    }

    return sections;
}

/**
 * Inject GM ruling into context for main AI
 * @param {string} narration - The GM's narration text
 * @param {Object} diceRoll - Optional dice roll result
 * @returns {boolean} Success
 */
export function injectGMRuling(narration, diceRoll = null) {
    const settings = getInjectionSettings();
    const framework = getActiveFramework();

    // Check if injection is disabled
    if (settings.mode === 'disabled') {
        console.log('[RPG Companion GM] Injection disabled, skipping');
        return false;
    }

    // Store for reference
    setLatestGMNarration(narration);
    addGMNarrationToHistory({
        narration,
        diceRoll,
        timestamp: Date.now(),
        framework: framework.id
    });

    // Build context based on mode
    let contextPrompt;
    if (settings.mode === 'ambient') {
        contextPrompt = buildAmbientContext(narration, diceRoll, framework);
    } else {
        contextPrompt = buildInstructionalContext(narration, diceRoll, framework);
    }

    // Determine depth based on position setting
    let depth = settings.depth || 1;
    if (settings.position === 'after_user_message') {
        depth = 0; // Depth 0 = after last message
    } else if (settings.position === 'before_user_message') {
        depth = 1; // Depth 1 = before last message
    }

    // Inject using SillyTavern's extension prompt system
    setExtensionPrompt(
        GM_INJECTION_ID,
        contextPrompt,
        extension_prompt_types.IN_CHAT,
        depth,
        false // Don't scan for macros
    );

    console.log('[RPG Companion GM] Injected GM ruling:', {
        mode: settings.mode,
        depth,
        length: contextPrompt.length
    });

    return true;
}

/**
 * Clear GM injection (call when dismissing GM context)
 */
export function clearGMInjection() {
    setExtensionPrompt(GM_INJECTION_ID, '', extension_prompt_types.IN_CHAT, 1, false);
    clearGMNarrationHistory();
    console.log('[RPG Companion GM] Cleared GM injection');
}

/**
 * Get the current GM injection content (for debugging/display)
 */
export function getCurrentGMInjection() {
    return getLatestGMNarration();
}

/**
 * Preview what the injection would look like with given content
 * Useful for settings UI
 */
export function previewInjection(narration, diceRoll = null) {
    const settings = getInjectionSettings();
    const framework = getActiveFramework();

    if (settings.mode === 'ambient') {
        return buildAmbientContext(narration, diceRoll, framework);
    } else {
        return buildInstructionalContext(narration, diceRoll, framework);
    }
}

/**
 * Get default templates for UI display
 */
export function getDefaultTemplates() {
    return {
        gmRuling: `<{{tag_name}}>
[{{gm_name}} narrates]: {{narration}}
{{#if dice_results}}
[Dice: {{dice_results}}]
{{/if}}
{{#if perception}}
[What {{character_name}} perceives]: {{perception}}
{{/if}}
</{{tag_name}}>`,

        trackerContext: `<world_state>
{{tracker_summary}}
</world_state>`
    };
}

// ============================================
// UNIFIED INJECTION SYSTEM
// Combines UIE + RPG Companion → Universe GM → Clean output
// ============================================

const UNIFIED_INJECTION_ID = 'rpg-companion-unified-context';

/**
 * Enable unified context mode
 * This disables separate injections and uses our combined approach
 */
export async function enableUnifiedMode() {
    const uieStatus = checkUIEStatus();

    if (uieStatus.available && !uieStatus.injectionDisabled) {
        console.log('[Unified Mode] UIE detected, disabling its direct injection...');
        disableUIEInjection();
    }

    // Store that we're in unified mode
    if (!extensionSettings.gmMode) {
        extensionSettings.gmMode = {};
    }
    extensionSettings.gmMode.unifiedMode = true;

    console.log('[Unified Mode] Enabled - all context will go through Universe GM');
}

/**
 * Inject unified context (combines all sources)
 * This is the ONE injection that Caleb sees
 *
 * @param {string} gmNarration - Optional GM narration of what happened
 * @param {Object} diceRoll - Optional dice roll result
 */
export async function injectUnifiedContext(gmNarration = '', diceRoll = null) {
    const settings = getInjectionSettings();

    // Check if injection is disabled
    if (settings.mode === 'disabled') {
        console.log('[Unified Mode] Injection disabled, skipping');
        return false;
    }

    // Build the unified context from all sources
    const unifiedPrompt = await buildUnifiedInjection(gmNarration, diceRoll);

    if (!unifiedPrompt) {
        console.log('[Unified Mode] No context to inject');
        return false;
    }

    // Store narration for reference
    if (gmNarration) {
        setLatestGMNarration(gmNarration);
        addGMNarrationToHistory({
            narration: gmNarration,
            diceRoll,
            timestamp: Date.now(),
            unified: true
        });
    }

    // Determine depth based on position setting
    let depth = settings.depth || 1;
    if (settings.position === 'after_user_message') {
        depth = 0;
    } else if (settings.position === 'before_user_message') {
        depth = 1;
    }

    // Inject the SINGLE unified context
    setExtensionPrompt(
        UNIFIED_INJECTION_ID,
        unifiedPrompt,
        extension_prompt_types.IN_CHAT,
        depth,
        false
    );

    console.log('[Unified Mode] Injected unified context:', {
        hasGMNarration: !!gmNarration,
        hasDiceRoll: !!diceRoll,
        length: unifiedPrompt.length
    });

    return true;
}

/**
 * Clear unified injection
 */
export function clearUnifiedInjection() {
    setExtensionPrompt(UNIFIED_INJECTION_ID, '', extension_prompt_types.IN_CHAT, 1, false);
    clearGMNarrationHistory();
    console.log('[Unified Mode] Cleared unified injection');
}

/**
 * Check if unified mode is enabled
 */
export function isUnifiedModeEnabled() {
    return extensionSettings.gmMode?.unifiedMode === true;
}

/**
 * Get unified mode status for UI
 */
export function getUnifiedModeStatus() {
    const uieStatus = checkUIEStatus();

    return {
        enabled: isUnifiedModeEnabled(),
        uieAvailable: uieStatus.available,
        uieInjectionDisabled: uieStatus.injectionDisabled,
        mode: extensionSettings.gmMode?.injection?.mode || 'ambient'
    };
}
