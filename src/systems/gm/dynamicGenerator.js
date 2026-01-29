/**
 * Dynamic Generator for GM Mode
 * Uses GM API to generate context-aware actions and locations
 * Keeps flavor text light/quirky - Caleb does the heavy lifting on humor
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { callGMAPI } from './gmEngine.js';
import { getCurrentLocation, getTimeOfDay, saveLocation, setCurrentLocation } from './locations.js';

// ============================================
// GENERATION PROMPTS (defaults - user can override in settings)
// ============================================

const DEFAULT_ACTION_PROMPT = `You are a game master generating actions for a player.

CONTEXT:
Location: {{LOCATION}}
Time: {{TIME_OF_DAY}}
Player: {{PLAYER_STATS}}
Recent: {{RECENT_EVENTS}}

Generate 4-6 context-appropriate actions the player can take. Each action should:
- Make sense for the current location and situation
- Have a brief, quirky flavor text (1 sentence max, slightly playful but not over-the-top)
- Include stat effects using ONLY the exact stat names listed below
- Include risk level (none, low, medium, or high)
- Occasionally include discovery of new locations (mark with discovers: "location_type")

CRITICAL - ONLY USE THESE EXACT STAT NAMES:
{{AVAILABLE_STATS}}

Respond in this exact JSON format:
{
  "actions": [
    {
      "id": "unique_id",
      "name": "Action Name",
      "flavor": "Brief quirky description.",
      "time": 15,
      "energy": -5,
      "risk": "none",
      "discovers": null
    }
  ],
  "ambient_note": "One sentence about something interesting in the environment."
}`;

const DEFAULT_LOCATION_PROMPT = `You are a game master creating a new location.

The player is discovering: {{LOCATION_TYPE}}
From: {{CURRENT_LOCATION}}
Via action: {{DISCOVERY_ACTION}}

Create a unique, atmospheric location with:
- A specific name (not generic)
- A brief evocative description (2-3 sentences)
- List of electronics/devices present (for AI manifestation - TVs, speakers, screens, etc.)
- Mood/atmosphere hint

Keep it grounded but with subtle hints of the unusual.

Respond in this exact JSON format:
{
  "name": "Specific Location Name",
  "description": "Evocative 2-3 sentence description.",
  "electronics": ["device1", "device2"],
  "mood": "one word mood",
  "ambient_detail": "One quirky environmental detail."
}`;

// Default available stats for actions
const DEFAULT_AVAILABLE_STATS = `- "time": minutes the action takes (required, positive number like 10, 15, 30, 60)
- "energy": energy change (negative = costs energy like -5, positive = restores like +20)
- "money": money change (negative = costs money like -10, positive = gains like +5)
- "hp": health change (negative = damage like -10, positive = heals like +15)
- "risk": must be exactly "none", "low", "medium", or "high"`;

/**
 * Get action generation prompt (user-editable)
 */
export function getActionPrompt() {
    const gmSettings = extensionSettings.gmMode || {};
    return gmSettings.actionPrompt || DEFAULT_ACTION_PROMPT;
}

/**
 * Get location generation prompt (user-editable)
 */
export function getLocationPrompt() {
    const gmSettings = extensionSettings.gmMode || {};
    return gmSettings.locationPrompt || DEFAULT_LOCATION_PROMPT;
}

/**
 * Get available stats definition (user-editable)
 */
export function getAvailableStats() {
    const gmSettings = extensionSettings.gmMode || {};
    return gmSettings.availableStats || DEFAULT_AVAILABLE_STATS;
}

/**
 * Save custom prompts
 */
export function saveCustomPrompts(actionPrompt, locationPrompt, availableStats) {
    if (!extensionSettings.gmMode) extensionSettings.gmMode = {};
    if (actionPrompt) extensionSettings.gmMode.actionPrompt = actionPrompt;
    if (locationPrompt) extensionSettings.gmMode.locationPrompt = locationPrompt;
    if (availableStats) extensionSettings.gmMode.availableStats = availableStats;
    saveSettings();
}

/**
 * Reset prompts to defaults
 */
export function resetPromptsToDefault() {
    if (!extensionSettings.gmMode) extensionSettings.gmMode = {};
    delete extensionSettings.gmMode.actionPrompt;
    delete extensionSettings.gmMode.locationPrompt;
    delete extensionSettings.gmMode.availableStats;
    saveSettings();
}

/**
 * Get default prompts (for reset/reference)
 */
export function getDefaultPrompts() {
    return {
        actionPrompt: DEFAULT_ACTION_PROMPT,
        locationPrompt: DEFAULT_LOCATION_PROMPT,
        availableStats: DEFAULT_AVAILABLE_STATS
    };
}

// ============================================
// USER-EDITABLE PRESETS (stored in settings)
// ============================================

/**
 * Get user's custom location presets
 */
export function getLocationPresets() {
    const gmSettings = extensionSettings.gmMode || {};
    return gmSettings.locationPresets || getDefaultLocationPresets();
}

/**
 * Save location presets
 */
export function saveLocationPresets(presets) {
    if (!extensionSettings.gmMode) extensionSettings.gmMode = {};
    extensionSettings.gmMode.locationPresets = presets;
    saveSettings();
}

/**
 * Get default presets (user can override)
 */
function getDefaultLocationPresets() {
    return {
        orphanage: {
            name: "Orphanage",
            baseDescription: "An old building full of echoes and memories.",
            typicalElectronics: ["old_tv", "hallway_speaker", "wall_clock"],
            typicalActions: ["sleep", "explore", "hide", "sneak"],
            canDiscoverTypes: ["attic", "basement", "garden", "office"]
        },
        bedroom: {
            name: "Bedroom",
            baseDescription: "A small space to call your own.",
            typicalElectronics: ["night_light", "old_radio"],
            typicalActions: ["sleep", "hide", "look_window"],
            canDiscoverTypes: ["closet", "under_bed_space"]
        },
        kitchen: {
            name: "Kitchen",
            baseDescription: "Where meals are made and secrets overheard.",
            typicalElectronics: ["refrigerator", "kitchen_radio"],
            typicalActions: ["eat", "sneak_food", "help_cook", "eavesdrop"],
            canDiscoverTypes: ["pantry", "back_door"]
        },
        playground: {
            name: "Playground",
            baseDescription: "Freedom within the fence.",
            typicalElectronics: ["outdoor_speaker"],
            typicalActions: ["play", "explore", "sit_alone", "climb"],
            canDiscoverTypes: ["shed", "fence_gap", "old_tree"]
        },
        attic: {
            name: "Attic",
            baseDescription: "Dusty and forgotten, full of old things.",
            typicalElectronics: ["broken_radio", "old_tv"],
            typicalActions: ["search", "hide", "read_old_things"],
            canDiscoverTypes: ["hidden_room", "window_escape"]
        },
        basement: {
            name: "Basement",
            baseDescription: "Dark and damp. Things are stored here... and forgotten.",
            typicalElectronics: ["flickering_light", "old_furnace"],
            typicalActions: ["explore", "search", "hide", "listen"],
            canDiscoverTypes: ["tunnel", "hidden_room"]
        }
    };
}

// ============================================
// LOCKED LOCATIONS
// ============================================

/**
 * Get locked (pinned) locations
 */
export function getLockedLocations() {
    const gmSettings = extensionSettings.gmMode || {};
    return gmSettings.lockedLocations || [];
}

/**
 * Lock a location (prevent deletion)
 */
export function lockLocation(locationId) {
    if (!extensionSettings.gmMode) extensionSettings.gmMode = {};
    if (!extensionSettings.gmMode.lockedLocations) {
        extensionSettings.gmMode.lockedLocations = [];
    }
    if (!extensionSettings.gmMode.lockedLocations.includes(locationId)) {
        extensionSettings.gmMode.lockedLocations.push(locationId);
        saveSettings();
    }
}

/**
 * Unlock a location
 */
export function unlockLocation(locationId) {
    if (!extensionSettings.gmMode?.lockedLocations) return;
    const idx = extensionSettings.gmMode.lockedLocations.indexOf(locationId);
    if (idx > -1) {
        extensionSettings.gmMode.lockedLocations.splice(idx, 1);
        saveSettings();
    }
}

/**
 * Check if location is locked
 */
export function isLocationLocked(locationId) {
    return getLockedLocations().includes(locationId);
}

// ============================================
// DYNAMIC GENERATION
// ============================================

/**
 * Generate actions for current location using GM API
 */
export async function generateDynamicActions() {
    const location = getCurrentLocation();
    const timeOfDay = getTimeOfDay();

    // Build context for the prompt
    let locationContext = 'Unknown location';
    if (location) {
        locationContext = `${location.name}: ${location.description}`;
    }

    // Get player stats if available
    let statsContext = 'No stats available';
    try {
        const userStats = extensionSettings.userStats;
        if (userStats) {
            const parsed = typeof userStats === 'string' ? JSON.parse(userStats) : userStats;
            if (parsed.stats) {
                statsContext = parsed.stats.map(s => `${s.name}: ${s.value}`).join(', ');
            }
        }
    } catch (e) {
        // Ignore
    }

    // Get recent events from chat context
    let recentEvents = 'None noted';
    // TODO: Could pull from recent chat messages

    // Get user-editable prompt and stats
    const actionPrompt = getActionPrompt();
    const availableStats = getAvailableStats();

    // Build the prompt with all replacements
    const prompt = actionPrompt
        .replace('{{LOCATION}}', locationContext)
        .replace('{{TIME_OF_DAY}}', timeOfDay || 'day')
        .replace('{{PLAYER_STATS}}', statsContext)
        .replace('{{RECENT_EVENTS}}', recentEvents)
        .replace('{{AVAILABLE_STATS}}', availableStats);

    try {
        const result = await callGMAPI(prompt);

        if (!result.success) {
            console.error('[Dynamic Generator] API call failed:', result.error);
            return { success: false, error: result.error };
        }

        // Parse the JSON response
        const parsed = parseJSONResponse(result.narration);
        if (!parsed) {
            return { success: false, error: 'Failed to parse action response' };
        }

        // Sanitize and normalize actions
        if (parsed.actions) {
            parsed.actions = parsed.actions.map((action, idx) => {
                // Normalize stat names (Kimi might use different names)
                const normalized = {
                    id: action.id || `dynamic_${Date.now()}_${idx}`,
                    name: action.name || 'Unknown Action',
                    flavor: action.flavor || action.description || '',
                    time: parseInt(action.time) || parseInt(action.duration) || parseInt(action.minutes) || 10,
                    energy: parseInt(action.energy) || parseInt(action.stamina) || parseInt(action.fatigue) || 0,
                    money: parseInt(action.money) || parseInt(action.cost) || parseInt(action.gold) || 0,
                    hp: parseInt(action.hp) || parseInt(action.health) || parseInt(action.damage) || 0,
                    risk: normalizeRisk(action.risk || action.danger || 'none'),
                    discovers: action.discovers || action.unlocks || action.reveals || null
                };
                return normalized;
            });
        }

        return {
            success: true,
            actions: parsed.actions || [],
            ambientNote: parsed.ambient_note || null
        };

    } catch (error) {
        console.error('[Dynamic Generator] Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Generate a new location when discovered
 */
export async function generateDiscoveredLocation(locationType, discoveryAction = null) {
    const currentLocation = getCurrentLocation();

    // Get user-editable prompt
    const locationPrompt = getLocationPrompt();

    // Build the prompt
    const prompt = locationPrompt
        .replace('{{LOCATION_TYPE}}', locationType)
        .replace('{{CURRENT_LOCATION}}', currentLocation?.name || 'Unknown')
        .replace('{{DISCOVERY_ACTION}}', discoveryAction || 'exploration');

    try {
        const result = await callGMAPI(prompt);

        if (!result.success) {
            console.error('[Dynamic Generator] Location generation failed:', result.error);
            return { success: false, error: result.error };
        }

        // Parse the JSON response
        const parsed = parseJSONResponse(result.narration);
        if (!parsed) {
            return { success: false, error: 'Failed to parse location response' };
        }

        // Create the location object
        const newLocation = {
            id: `discovered_${locationType}_${Date.now()}`,
            type: locationType,
            name: parsed.name || `The ${locationType}`,
            description: parsed.description || 'A newly discovered area.',
            electronics: parsed.electronics || [],
            mood: parsed.mood || 'neutral',
            ambientDetail: parsed.ambient_detail || null,
            actions: [], // Will be populated by generateDynamicActions when visiting
            discovered: Date.now(),
            discoveredFrom: currentLocation?.id || null,
            visits: 0
        };

        // Save the location
        saveLocation(newLocation);

        return {
            success: true,
            location: newLocation
        };

    } catch (error) {
        console.error('[Dynamic Generator] Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Handle action execution - check for discoveries
 */
export async function executeAction(action) {
    const results = {
        action,
        success: true,
        message: null,
        discoveredLocation: null
    };

    // Check if this action discovers a new location
    if (action.discovers) {
        const discoveryResult = await generateDiscoveredLocation(
            action.discovers,
            action.name
        );

        if (discoveryResult.success) {
            results.discoveredLocation = discoveryResult.location;
            results.message = `You discovered: ${discoveryResult.location.name}!`;
        }
    }

    return results;
}

// ============================================
// HELPERS
// ============================================

/**
 * Normalize risk level to expected values
 */
function normalizeRisk(risk) {
    if (!risk) return 'none';
    const r = String(risk).toLowerCase().trim();
    if (r === 'none' || r === 'safe' || r === 'no') return 'none';
    if (r === 'low' || r === 'minor' || r === 'slight') return 'low';
    if (r === 'medium' || r === 'moderate' || r === 'mid') return 'medium';
    if (r === 'high' || r === 'dangerous' || r === 'risky' || r === 'extreme') return 'high';
    return 'none';
}

/**
 * Parse JSON from GM response (handles markdown code blocks)
 */
function parseJSONResponse(text) {
    if (!text) return null;

    try {
        // Try direct parse first
        return JSON.parse(text);
    } catch (e) {
        // Try to extract from markdown code block
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch (e2) {
                // Ignore
            }
        }

        // Try to find JSON object in text
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) {
            try {
                return JSON.parse(objMatch[0]);
            } catch (e3) {
                // Ignore
            }
        }
    }

    console.error('[Dynamic Generator] Could not parse JSON from:', text);
    return null;
}

/**
 * Fallback actions when API fails
 */
export function getFallbackActions(locationType) {
    const presets = getLocationPresets();
    const preset = presets[locationType];

    if (!preset) {
        return [
            { id: 'look_around', name: 'Look around', time: 10, energy: -2, risk: 'none', flavor: 'Take in your surroundings.' },
            { id: 'wait', name: 'Wait', time: 15, energy: 5, risk: 'none', flavor: 'Sometimes patience is key.' },
            { id: 'leave', name: 'Leave', time: 5, energy: -1, risk: 'none', flavor: 'Head somewhere else.' }
        ];
    }

    // Generate basic actions from preset
    const actions = [];

    if (preset.typicalActions.includes('sleep')) {
        actions.push({ id: 'sleep', name: 'Sleep', time: 480, energy: 100, risk: 'none', flavor: 'Rest until morning.' });
    }
    if (preset.typicalActions.includes('explore')) {
        actions.push({
            id: 'explore',
            name: 'Explore',
            time: 20,
            energy: -5,
            risk: 'low',
            flavor: 'See what you can find.',
            discovers: preset.canDiscoverTypes?.[0] || null
        });
    }
    if (preset.typicalActions.includes('hide')) {
        actions.push({ id: 'hide', name: 'Find a hiding spot', time: 10, energy: -3, risk: 'none', flavor: 'Somewhere quiet.' });
    }
    if (preset.typicalActions.includes('sneak')) {
        actions.push({ id: 'sneak', name: 'Sneak around', time: 15, energy: -5, risk: 'medium', flavor: 'Careful now...' });
    }
    if (preset.typicalActions.includes('eat')) {
        actions.push({ id: 'eat', name: 'Eat something', time: 20, energy: 20, risk: 'none', flavor: 'Food is fuel.' });
    }

    // Always add basic actions
    actions.push({ id: 'look_around', name: 'Look around', time: 10, energy: -2, risk: 'none', flavor: 'Take in your surroundings.' });

    return actions;
}
