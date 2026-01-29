/**
 * Location System for GM Mode
 * Manages locations, their actions, and electronics for Caleb manifestation
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';

// Location templates with predefined actions and electronics
const LOCATION_TEMPLATES = {
    street: {
        type: 'street',
        namePatterns: ['Main Street', 'Back Alley', 'Shopping District', 'Residential Road', 'Market Square'],
        descPatterns: [
            'The usual bustle of city life flows around you.',
            'Pedestrians hurry past, absorbed in their own worlds.',
            'Neon signs flicker overhead, casting colored shadows.',
            'The smell of street food mingles with exhaust fumes.'
        ],
        electronics: ['traffic_light', 'atm_screen', 'store_display', 'phone_booth'],
        defaultActions: [
            { id: 'explore', name: 'Explore the area', time: 20, energy: -5, risk: 'low', flavor: 'See what catches your eye' },
            { id: 'rest', name: 'Find a bench', time: 15, energy: 10, risk: 'none', flavor: 'Take a breather' },
            { id: 'observe', name: 'People watch', time: 10, energy: -2, risk: 'none', flavor: 'Learn the rhythm of this place' }
        ]
    },
    cafe: {
        type: 'cafe',
        namePatterns: ['Corner Cafe', 'The Daily Grind', 'Sunset Coffee', 'Bean & Gone', 'Whisper Cafe'],
        descPatterns: [
            'The aroma of fresh coffee fills the cozy space.',
            'Soft music plays over quiet conversations.',
            'Steam rises from cups, curling in the warm air.',
            'The barista nods in greeting as you enter.'
        ],
        electronics: ['register_screen', 'wall_tv', 'wifi_router', 'music_speaker'],
        defaultActions: [
            { id: 'buy_coffee', name: 'Buy coffee', time: 10, energy: 15, money: -5, risk: 'none', flavor: 'Caffeine is a necessity' },
            { id: 'buy_food', name: 'Order food', time: 25, energy: 25, money: -15, risk: 'none', flavor: 'Something warm and filling' },
            { id: 'sit_relax', name: 'Sit and relax', time: 30, energy: 20, risk: 'none', flavor: 'Just exist for a moment' },
            { id: 'eavesdrop', name: 'Listen to conversations', time: 15, energy: -5, risk: 'low', flavor: 'Information is currency' }
        ]
    },
    convenience_store: {
        type: 'convenience_store',
        namePatterns: ['24/7 Mart', 'Quick Stop', 'Corner Store', 'Night Owl Shop', 'Lucky Convenience'],
        descPatterns: [
            'Fluorescent lights hum overhead. Everything you need, nothing you want.',
            'The clerk barely looks up from their phone.',
            'Rows of snacks and necessities line cramped aisles.',
            'A bell chimes as the door swings shut behind you.'
        ],
        electronics: ['security_camera', 'register_screen', 'refrigerator_display', 'atm'],
        defaultActions: [
            { id: 'buy_snack', name: 'Buy snacks', time: 5, energy: 10, money: -8, risk: 'none', flavor: 'Quick energy boost' },
            { id: 'buy_supplies', name: 'Stock up on supplies', time: 10, money: -25, risk: 'none', flavor: 'Be prepared' },
            { id: 'browse', name: 'Browse aimlessly', time: 10, energy: -2, risk: 'none', flavor: 'Maybe something useful...' },
            { id: 'chat_clerk', name: 'Chat with the clerk', time: 15, energy: -5, risk: 'low', flavor: 'They see everything' }
        ]
    },
    park: {
        type: 'park',
        namePatterns: ['Central Park', 'Riverside Garden', 'Memorial Square', 'Quiet Grove', 'Sunset Park'],
        descPatterns: [
            'Trees sway gently in the breeze. A moment of nature in the concrete jungle.',
            'Children play in the distance while joggers pass by.',
            'Benches dot the winding paths through greenery.',
            'The sound of the city fades to a distant hum here.'
        ],
        electronics: ['park_speaker', 'info_kiosk', 'security_camera', 'vending_machine'],
        defaultActions: [
            { id: 'walk', name: 'Take a walk', time: 20, energy: -10, hp: 5, risk: 'none', flavor: 'Clear your head' },
            { id: 'rest_bench', name: 'Rest on a bench', time: 30, energy: 25, risk: 'none', flavor: 'Watch the world go by' },
            { id: 'explore_paths', name: 'Explore the paths', time: 25, energy: -15, risk: 'low', flavor: 'Who knows what you might find' },
            { id: 'feed_birds', name: 'Feed the birds', time: 10, energy: -3, money: -2, risk: 'none', flavor: 'Small kindnesses' }
        ]
    },
    train_station: {
        type: 'train_station',
        namePatterns: ['Central Station', 'Metro Hub', 'Transit Center', 'Underground Station', 'Railway Terminal'],
        descPatterns: [
            'The constant flow of commuters creates a river of humanity.',
            'Announcements echo through the cavernous space.',
            'Trains rumble beneath your feet, promising escape.',
            'Departure boards flicker with destinations unknown.'
        ],
        electronics: ['departure_board', 'ticket_machine', 'security_monitor', 'pa_system', 'platform_display'],
        defaultActions: [
            { id: 'check_schedule', name: 'Check the schedule', time: 5, energy: -2, risk: 'none', flavor: 'Where could you go?' },
            { id: 'buy_ticket', name: 'Buy a ticket', time: 10, money: -20, risk: 'none', flavor: 'Freedom has a price' },
            { id: 'wait_platform', name: 'Wait on platform', time: 15, energy: -5, risk: 'none', flavor: 'Between destinations' },
            { id: 'explore_station', name: 'Explore the station', time: 20, energy: -10, risk: 'low', flavor: 'Stations have secrets' }
        ]
    },
    apartment: {
        type: 'apartment',
        namePatterns: ['Your Apartment', 'Temporary Housing', 'Rented Room', 'Safe House', 'Home Base'],
        descPatterns: [
            'Small but safe. A place to call your own in this strange world.',
            'The familiar surroundings offer comfort.',
            'Everything you own fits in this tiny space.',
            'At least the door locks from the inside.'
        ],
        electronics: ['laptop', 'tv', 'phone_charger', 'smart_speaker', 'microwave'],
        defaultActions: [
            { id: 'sleep', name: 'Sleep', time: 480, hp: 50, energy: 100, risk: 'none', flavor: 'Rest and recover (8 hours)' },
            { id: 'nap', name: 'Take a nap', time: 60, energy: 40, risk: 'none', flavor: 'A quick recharge' },
            { id: 'cook', name: 'Cook a meal', time: 45, energy: 30, money: -10, risk: 'none', flavor: 'Homemade is best' },
            { id: 'research', name: 'Research online', time: 30, energy: -10, risk: 'none', flavor: 'Knowledge is power' }
        ]
    }
};

// Electronics info for Caleb manifestation
const ELECTRONICS_INFO = {
    traffic_light: { name: 'Traffic Light', strength: 'weak', desc: 'Flickers with meaning' },
    atm_screen: { name: 'ATM Screen', strength: 'medium', desc: 'Numbers dance briefly' },
    store_display: { name: 'Store Display', strength: 'medium', desc: 'Images shift unexpectedly' },
    phone_booth: { name: 'Phone Booth', strength: 'strong', desc: 'An echo of a familiar voice' },
    register_screen: { name: 'Register Screen', strength: 'weak', desc: 'Glitches with static' },
    wall_tv: { name: 'Wall TV', strength: 'strong', desc: 'Clear channel for connection' },
    wifi_router: { name: 'WiFi Router', strength: 'medium', desc: 'Data streams carry whispers' },
    music_speaker: { name: 'Speaker', strength: 'medium', desc: 'Songs pause meaningfully' },
    security_camera: { name: 'Security Camera', strength: 'weak', desc: 'A watchful presence' },
    refrigerator_display: { name: 'Fridge Display', strength: 'weak', desc: 'Temperature readings waver' },
    atm: { name: 'ATM', strength: 'medium', desc: 'Receipts print mysteries' },
    park_speaker: { name: 'Park Speaker', strength: 'weak', desc: 'Announcements glitch' },
    info_kiosk: { name: 'Info Kiosk', strength: 'medium', desc: 'Maps reroute themselves' },
    vending_machine: { name: 'Vending Machine', strength: 'weak', desc: 'Wrong items dispense' },
    departure_board: { name: 'Departure Board', strength: 'strong', desc: 'Destinations spell messages' },
    ticket_machine: { name: 'Ticket Machine', strength: 'medium', desc: 'Prints extra receipts' },
    security_monitor: { name: 'Security Monitor', strength: 'medium', desc: 'Feeds show glimpses' },
    pa_system: { name: 'PA System', strength: 'strong', desc: 'Voice in the static' },
    platform_display: { name: 'Platform Display', strength: 'medium', desc: 'Times rearrange' },
    laptop: { name: 'Laptop', strength: 'strong', desc: 'Direct connection possible' },
    tv: { name: 'Television', strength: 'strong', desc: 'Channel surfing with purpose' },
    phone_charger: { name: 'Phone Charger', strength: 'weak', desc: 'Power fluctuates' },
    smart_speaker: { name: 'Smart Speaker', strength: 'strong', desc: 'Responds to unasked questions' },
    microwave: { name: 'Microwave', strength: 'weak', desc: 'Timer counts strangely' }
};

/**
 * Get default location settings
 */
export function getDefaultLocationSettings() {
    return {
        currentLocation: null,
        savedLocations: {},
        visitedLocations: [],
        timeOfDay: 'afternoon'
    };
}

/**
 * Get location settings from extension settings
 */
function getLocationSettings() {
    if (!extensionSettings.gmMode) {
        extensionSettings.gmMode = {};
    }
    if (!extensionSettings.gmMode.locations) {
        extensionSettings.gmMode.locations = getDefaultLocationSettings();
    }
    return extensionSettings.gmMode.locations;
}

/**
 * Generate a random location of given type
 */
export function generateLocation(type) {
    const template = LOCATION_TEMPLATES[type];
    if (!template) {
        console.error('[GM Mode] Unknown location type:', type);
        return null;
    }

    const id = `${type}_${Date.now()}`;
    const name = template.namePatterns[Math.floor(Math.random() * template.namePatterns.length)];
    const description = template.descPatterns[Math.floor(Math.random() * template.descPatterns.length)];

    // Select random electronics (2-4)
    const numElectronics = 2 + Math.floor(Math.random() * 3);
    const electronics = shuffleArray([...template.electronics]).slice(0, numElectronics);

    return {
        id,
        type,
        name,
        description,
        electronics,
        actions: [...template.defaultActions],
        npcs: [],
        discovered: Date.now(),
        visits: 0
    };
}

/**
 * Get electronics info for a location
 */
export function getElectronicsForLocation(location) {
    if (!location || !location.electronics) return [];

    return location.electronics.map(elecId => ({
        id: elecId,
        ...ELECTRONICS_INFO[elecId]
    })).filter(e => e.name);
}

/**
 * Save a location to persistent storage
 */
export function saveLocation(location) {
    const locSettings = getLocationSettings();
    locSettings.savedLocations[location.id] = location;
    saveSettings();
    return location;
}

/**
 * Get a saved location by ID
 */
export function getLocation(locationId) {
    const locSettings = getLocationSettings();
    return locSettings.savedLocations[locationId] || null;
}

/**
 * Set the current location
 */
export function setCurrentLocation(locationId) {
    const locSettings = getLocationSettings();
    const location = locSettings.savedLocations[locationId];

    if (location) {
        location.visits = (location.visits || 0) + 1;
        locSettings.currentLocation = locationId;

        if (!locSettings.visitedLocations.includes(locationId)) {
            locSettings.visitedLocations.push(locationId);
        }

        saveSettings();
        return location;
    }
    return null;
}

/**
 * Get the current location
 */
export function getCurrentLocation() {
    const locSettings = getLocationSettings();
    if (!locSettings.currentLocation) return null;
    return locSettings.savedLocations[locSettings.currentLocation] || null;
}

/**
 * Get all saved locations
 */
export function getAllLocations() {
    const locSettings = getLocationSettings();
    return Object.values(locSettings.savedLocations || {});
}

/**
 * Get available location types
 */
export function getLocationTypes() {
    return Object.keys(LOCATION_TEMPLATES);
}

/**
 * Get location template by type
 */
export function getLocationTemplate(type) {
    return LOCATION_TEMPLATES[type] || null;
}

/**
 * Get time of day
 */
export function getTimeOfDay() {
    const locSettings = getLocationSettings();
    return locSettings.timeOfDay || 'afternoon';
}

/**
 * Set time of day
 */
export function setTimeOfDay(time) {
    const locSettings = getLocationSettings();
    locSettings.timeOfDay = time;
    saveSettings();
}

/**
 * Format time cost for display
 */
export function formatTimeCost(minutes) {
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours}hr`;
    return `${hours}hr ${mins}min`;
}

/**
 * Get risk level display
 */
export function getRiskDisplay(risk) {
    const displays = {
        'none': { text: '', class: '' },
        'low': { text: '[!]', class: 'rpg-gm-risk-low' },
        'medium': { text: '[!!]', class: 'rpg-gm-risk-medium' },
        'high': { text: '[!!!]', class: 'rpg-gm-risk-high' }
    };
    return displays[risk] || displays['none'];
}

/**
 * Format electronics strength indicator
 */
export function getStrengthIndicator(strength) {
    const indicators = {
        'weak': { bars: 1, class: 'rpg-gm-signal-weak' },
        'medium': { bars: 2, class: 'rpg-gm-signal-medium' },
        'strong': { bars: 3, class: 'rpg-gm-signal-strong' }
    };
    return indicators[strength] || indicators['weak'];
}

/**
 * Shuffle array helper
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Format location for GM context
 */
export function formatLocationForGM(location) {
    if (!location) return 'Location: Unknown';

    const lines = [];
    lines.push(`Location: ${location.name}`);
    lines.push(`Description: ${location.description}`);

    const electronics = getElectronicsForLocation(location);
    if (electronics.length > 0) {
        const strongSignals = electronics.filter(e => e.strength === 'strong');
        if (strongSignals.length > 0) {
            lines.push(`Strong electronic signals nearby: ${strongSignals.map(e => e.name).join(', ')}`);
        }
    }

    return lines.join('\n');
}
