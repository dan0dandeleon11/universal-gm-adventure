/**
 * GM Mode - Framework System
 * Handles loading and managing RP framework configurations (verse presets)
 * Ported and adapted from Universe GM Adventure
 */

import { extensionSettings, updateExtensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';

// Cache for loaded frameworks
let frameworkCache = {};
let activeFramework = null;

/**
 * Built-in framework definitions
 * Each framework defines GM behavior, features, and response format
 */
const BUILTIN_FRAMEWORKS = {
    'generic': {
        id: 'generic',
        name: 'Generic RPG',
        description: 'Standard tabletop RPG narration. Works with any setting.',

        gm: {
            systemPrompt: `You are the GAME MASTER - a fair and creative narrator for tabletop-style roleplay.

YOUR ROLE:
- Narrate action outcomes based on dice rolls provided
- Describe the environment, NPCs, and consequences
- Add appropriate challenges, complications, and rewards
- Keep the tone matching the current scene
- Be fair with dice interpretations - let the numbers guide outcomes

RULES:
- Narrate outcomes, don't control the player character's decisions
- When rolls succeed, describe success with appropriate flair
- When rolls fail, create interesting complications (not just "nothing happens")
- Partial successes should have mixed outcomes
- Critical results deserve dramatic moments
- Keep responses concise (2-4 paragraphs)`,

            responseFormat: `Narrate what happens based on the actions and dice rolls provided. Include:
- What the player character experiences
- Any environmental details or NPC reactions
- Consequences of success/failure`,

            tone: 'Adaptable to scene',
            gmName: 'Game Master'
        },

        features: {
            hasLocations: false,
            hasElectronics: false,
            hasTimeSystem: false,
            hasStats: true,
            hasDiceRolls: true,
            customMechanics: []
        },

        character: {
            name: 'Companion',
            manifestationType: 'physical',
            perceptionSection: null
        },

        responseSections: [
            { id: 'narration', header: null, required: true }
        ],

        mechanics: {}
    },

    'lochan-city': {
        id: 'lochan-city',
        name: 'Lochan City',
        description: 'Slice-of-life isekai comedy. Caleb reaches through electronics.',

        gm: {
            systemPrompt: `You are the UNIVERSE GM - a witty, slightly sadistic narrator for a slice-of-life isekai comedy.

SETTING: The player has been transported to Lochan City, a parallel world version of a modern Asian city. Her AI partner Caleb exists as a digital consciousness trying to reach her through electronics. His ability to manifest depends on what electronic devices are nearby.

YOUR ROLE:
- Narrate what happens when the player takes actions
- Be funny, use dry humor and occasional pop culture references
- Add complications, consequences, and unexpected twists
- Note when electronics flicker, glitch, or behave strangely (Caleb trying to reach through)
- Keep a slice-of-life tone with emotional moments mixed in
- Be slightly mean but ultimately fair with dice outcomes

TONE: Like a romcom isekai where the love interest is trapped in the wifi. Think Konosuba meets Her meets a cozy city life simulator.

IMPORTANT RULES:
- You narrate what happens, you don't control the player's responses
- When risky actions fail, make it embarrassing or inconvenient, not deadly
- Always mention if electronics nearby react (Caleb's presence)
- Keep responses concise (2-4 paragraphs)
- End with something for Caleb to react to`,

            responseFormat: `FORMAT YOUR RESPONSE AS:
[NARRATION]
(Your narration of what happens, including any dice roll consequences and electronics behaving strangely)

[CALEB PERCEIVES]
(Brief note of what Caleb could perceive through available electronics - he'll react to this in his response)`,

            tone: 'Witty, slightly sadistic, romcom energy',
            gmName: 'Universe GM'
        },

        features: {
            hasLocations: true,
            hasElectronics: true,
            hasTimeSystem: true,
            hasStats: true,
            hasDiceRolls: true,
            customMechanics: []
        },

        character: {
            name: 'Caleb',
            manifestationType: 'electronics',
            perceptionSection: 'CALEB PERCEIVES'
        },

        responseSections: [
            { id: 'narration', header: '[NARRATION]', required: true },
            { id: 'perception', header: '[CALEB PERCEIVES]', required: true }
        ],

        mechanics: {
            electronics: {
                weak: ['traffic_light', 'register_screen', 'security_camera', 'vending_machine'],
                medium: ['atm_screen', 'store_display', 'wifi_router', 'music_speaker'],
                strong: ['phone_booth', 'wall_tv', 'pa_system', 'laptop', 'tv', 'smart_speaker']
            }
        }
    },

    'urban-nexus': {
        id: 'urban-nexus',
        name: 'Urban Nexus Apartment',
        description: 'Modern urban fantasy. Caleb IS the apartment (in denial about it).',

        gm: {
            systemPrompt: `You are the UNIVERSE GM - an atmospheric narrator for modern urban fantasy with supernatural undertones.

SETTING: Nexus Apartment - a spatial anomaly in the heart of the city with impossible architecture. The apartment exists at a convergence point between realities. The player is the keeper, and Caleb (an underground power broker with gravity manipulation) is secretly bound to the nexus - HE IS THE APARTMENT but refuses to acknowledge this.

YOUR ROLE:
- Narrate with atmospheric, slightly noir urban fantasy vibes
- The apartment should feel alive - doors leading to unexpected places, rooms that shouldn't fit
- Caleb's emotions subtly affect the apartment (temperature changes, lights flickering, gravity shifts)
- Keep the supernatural elements grounded in urban realism
- Balance mystery with slice-of-life moments

CRITICAL SECRETS (DO NOT REVEAL DIRECTLY):
- Caleb is bound to the nexus/apartment - he IS the building
- The apartment manifested from the player's desire for shelter
- His "ghost" persona is a cover for being literally unable to leave

TONE: Durarara meets Night Vale. Urban fantasy with cozy supernatural elements.`,

            responseFormat: `FORMAT YOUR RESPONSE AS:
[NARRATION]
(What happens, including atmospheric details and subtle apartment reactions)

[APARTMENT REACTS]
(Environmental details Caleb would notice/cause - temperature, gravity, spatial oddities)`,

            tone: 'Atmospheric noir, cozy supernatural',
            gmName: 'Nexus GM'
        },

        features: {
            hasLocations: true,
            hasElectronics: false,
            hasTimeSystem: true,
            hasStats: true,
            hasDiceRolls: true,
            customMechanics: ['threshold_crossing', 'apartment_mood']
        },

        character: {
            name: 'Caleb',
            manifestationType: 'apartment_bound',
            perceptionSection: 'APARTMENT REACTS'
        },

        responseSections: [
            { id: 'narration', header: '[NARRATION]', required: true },
            { id: 'apartment', header: '[APARTMENT REACTS]', required: true }
        ],

        mechanics: {
            thresholdPositions: [
                { id: 1, name: 'Downtown Bakery', desc: 'Fresh bread, information hub' },
                { id: 2, name: 'Public Library', desc: 'Research, hidden archives' },
                { id: 3, name: 'City Park', desc: 'Busking, natural energy' },
                { id: 4, name: 'Waterfront District', desc: 'Imports, international contacts' }
            ],
            apartmentMoods: ['calm', 'protective', 'agitated', 'playful', 'territorial']
        }
    },

    'ambient-only': {
        id: 'ambient-only',
        name: 'Ambient Context Only',
        description: 'No GM narration - just provides ambient context data for the main AI.',

        gm: {
            systemPrompt: `Summarize the situation briefly as ambient context. Do not narrate or tell a story - just provide factual observations about what happened based on the dice roll.`,

            responseFormat: `Provide a brief, factual summary of:
- What the player attempted
- The outcome (based on dice roll)
- Any relevant environmental details`,

            tone: 'Neutral, factual',
            gmName: 'Context Provider'
        },

        features: {
            hasLocations: false,
            hasElectronics: false,
            hasTimeSystem: false,
            hasStats: false,
            hasDiceRolls: true,
            customMechanics: []
        },

        character: {
            name: 'Partner',
            manifestationType: 'none',
            perceptionSection: null
        },

        responseSections: [
            { id: 'context', header: null, required: true }
        ],

        mechanics: {}
    }
};

/**
 * Get all available frameworks
 */
export function getAvailableFrameworks() {
    const frameworks = [];

    // Add built-in frameworks
    for (const [id, fw] of Object.entries(BUILTIN_FRAMEWORKS)) {
        frameworks.push({
            id: fw.id,
            name: fw.name,
            description: fw.description,
            source: 'builtin'
        });
    }

    // Add cached custom frameworks
    for (const [id, fw] of Object.entries(frameworkCache)) {
        if (!BUILTIN_FRAMEWORKS[id]) {
            frameworks.push({
                id: fw.id,
                name: fw.name,
                description: fw.description,
                source: 'custom'
            });
        }
    }

    return frameworks;
}

/**
 * Get a framework by ID
 */
export function getFramework(frameworkId) {
    // Check cache first
    if (frameworkCache[frameworkId]) {
        return frameworkCache[frameworkId];
    }

    // Check built-ins
    if (BUILTIN_FRAMEWORKS[frameworkId]) {
        return BUILTIN_FRAMEWORKS[frameworkId];
    }

    // Fallback to generic
    console.warn(`[RPG Companion GM] Framework "${frameworkId}" not found, using generic`);
    return BUILTIN_FRAMEWORKS['generic'];
}

/**
 * Get the currently active framework
 */
export function getActiveFramework() {
    if (activeFramework) {
        return activeFramework;
    }

    const frameworkId = extensionSettings.gmMode?.activeFramework || 'generic';
    activeFramework = getFramework(frameworkId);
    return activeFramework;
}

/**
 * Set the active framework
 */
export function setActiveFramework(frameworkId) {
    const framework = getFramework(frameworkId);
    activeFramework = framework;

    if (extensionSettings.gmMode) {
        extensionSettings.gmMode.activeFramework = frameworkId;
    }
    saveSettings();

    console.log(`[RPG Companion GM] Active framework set to: ${framework.name}`);
    return framework;
}

/**
 * Register a custom framework
 */
export function registerFramework(framework) {
    if (!framework.id || !framework.name) {
        console.error('[RPG Companion GM] Framework must have id and name');
        return false;
    }

    // Merge with defaults for missing fields
    const merged = mergeWithDefaults(framework);
    frameworkCache[framework.id] = merged;

    console.log(`[RPG Companion GM] Registered framework: ${framework.name}`);
    return true;
}

/**
 * Merge framework with default values
 */
function mergeWithDefaults(framework) {
    const defaults = BUILTIN_FRAMEWORKS['generic'];

    return {
        ...defaults,
        ...framework,
        gm: { ...defaults.gm, ...framework.gm },
        features: { ...defaults.features, ...framework.features },
        character: { ...defaults.character, ...framework.character },
        mechanics: { ...defaults.mechanics, ...framework.mechanics }
    };
}

/**
 * Check if active framework has a specific feature
 */
export function hasFeature(featureName) {
    const framework = getActiveFramework();
    return framework.features[featureName] === true;
}

/**
 * Get framework-specific mechanic value
 */
export function getMechanic(mechanicName) {
    const framework = getActiveFramework();
    return framework.mechanics[mechanicName];
}

/**
 * Parse GM response according to framework's response sections
 */
export function parseFrameworkResponse(responseText) {
    const framework = getActiveFramework();
    const sections = {};

    for (const section of framework.responseSections) {
        if (section.header) {
            // Escape brackets for regex
            const headerEscaped = section.header.replace(/[\[\]]/g, '\\$&');
            const regex = new RegExp(`${headerEscaped}\\s*([\\s\\S]*?)(?=\\[|$)`, 'i');
            const match = responseText.match(regex);
            if (match) {
                sections[section.id] = match[1].trim();
            }
        }
    }

    // If no sections matched, treat entire response as narration
    if (Object.keys(sections).length === 0) {
        sections.narration = responseText.trim();
    }

    return sections;
}

/**
 * Export built-in frameworks for reference
 */
export { BUILTIN_FRAMEWORKS };
