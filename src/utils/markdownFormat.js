/**
 * Markdown Format Utility
 * Token-efficient alternative to JSON for tracker data serialization.
 * Converts between the internal tracker object representation and a
 * compact markdown format suitable for prompt injection.
 */

import { extensionSettings } from '../core/state.js';

/**
 * Format tracker data as compact markdown.
 *
 * Accepts the same shape produced by the parser module:
 * - `userStats`          — string (JSON) or parsed object with stat fields
 * - `infoBox`            — string (JSON) or parsed object with date/weather/time/location/recentEvents
 * - `characterThoughts`  — string (JSON) or parsed object with { characters: [] }
 *
 * @param {{ userStats?: any, infoBox?: any, characterThoughts?: any }} trackerData
 * @returns {string} Markdown representation
 */
export function formatTrackerAsMarkdown(trackerData) {
    if (!trackerData) return '';

    const sections = [];

    // --- Stats ---
    const stats = safeParse(trackerData.userStats);
    if (stats) {
        const lines = ['## Stats'];
        const trackerConfig = extensionSettings.trackerConfig?.userStats;

        // Numeric stats (health, energy, etc.)
        if (trackerConfig?.customStats) {
            for (const def of trackerConfig.customStats) {
                if (!def.enabled) continue;
                const val = stats[def.id];
                if (val === undefined || val === null) continue;
                const max = def.maxValue || 100;
                lines.push(`- ${def.name}: ${val}/${max}`);
            }
        } else {
            // Fallback: iterate own numeric properties
            for (const [key, val] of Object.entries(stats)) {
                if (typeof val === 'number') {
                    lines.push(`- ${capitalize(key)}: ${val}/100`);
                }
            }
        }

        // Mood / conditions
        if (stats.mood) lines.push(`- Mood: ${stats.mood}`);
        if (stats.conditions && stats.conditions !== 'None') {
            lines.push(`- Conditions: ${stats.conditions}`);
        }

        // Skills
        if (Array.isArray(stats.skills) && stats.skills.length > 0) {
            lines.push(`- Skills: ${stats.skills.join(', ')}`);
        }

        if (lines.length > 1) sections.push(lines.join('\n'));
    }

    // --- Info Box ---
    const info = safeParse(trackerData.infoBox);
    if (info) {
        const lines = ['## Info Box'];

        if (info.date?.value) lines.push(`- Date: ${info.date.value}`);
        if (info.weather) {
            const emoji = info.weather.emoji || '';
            const forecast = info.weather.forecast || '';
            lines.push(`- Weather: ${emoji} ${forecast}`.trim());
        }
        if (info.temperature?.value !== undefined) {
            const unit = info.temperature.unit || 'C';
            lines.push(`- Temperature: ${info.temperature.value}°${unit}`);
        }
        if (info.time) {
            const start = info.time.start || '';
            const end = info.time.end || '';
            if (start || end) lines.push(`- Time: ${start}${end ? ' – ' + end : ''}`);
        }
        if (info.location?.value) lines.push(`- Location: ${info.location.value}`);
        if (info.recentEvents?.value) lines.push(`- Recent Events: ${info.recentEvents.value}`);

        if (lines.length > 1) sections.push(lines.join('\n'));
    }

    // --- Present Characters ---
    const thoughts = safeParse(trackerData.characterThoughts);
    if (thoughts) {
        const chars = Array.isArray(thoughts) ? thoughts : (thoughts.characters || []);
        if (chars.length > 0) {
            const lines = ['## Present Characters'];
            for (const ch of chars) {
                if (!ch || !ch.name) continue;
                lines.push(`### ${ch.emoji || ''} ${ch.name}`.trim());
                if (ch.relationship) lines.push(`- Relationship: ${ch.relationship}`);
                if (ch.appearance) lines.push(`- Appearance: ${ch.appearance}`);
                if (ch.demeanor) lines.push(`- Demeanor: ${ch.demeanor}`);
                if (ch.thoughts) lines.push(`- Thoughts: "${ch.thoughts}"`);

                // Character stats if present
                if (ch.stats && typeof ch.stats === 'object') {
                    for (const [k, v] of Object.entries(ch.stats)) {
                        lines.push(`- ${capitalize(k)}: ${v}`);
                    }
                }
            }
            sections.push(lines.join('\n'));
        }
    }

    return sections.join('\n\n');
}

/**
 * Parse a markdown tracker string back into a tracker data object.
 * Reverse of `formatTrackerAsMarkdown`.
 *
 * @param {string} markdown
 * @returns {{ userStats: object|null, infoBox: object|null, characterThoughts: object|null }}
 */
export function parseMarkdownTracker(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return { userStats: null, infoBox: null, characterThoughts: null };
    }

    const result = { userStats: null, infoBox: null, characterThoughts: null };

    // Split on h2 headers
    const sectionRegex = /^## (.+)$/gm;
    const sectionStarts = [];
    let match;
    while ((match = sectionRegex.exec(markdown)) !== null) {
        sectionStarts.push({ title: match[1].trim(), index: match.index });
    }

    for (let i = 0; i < sectionStarts.length; i++) {
        const start = sectionStarts[i].index;
        const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : markdown.length;
        const body = markdown.slice(start, end);
        const title = sectionStarts[i].title;

        if (title === 'Stats') {
            result.userStats = parseStatsSection(body);
        } else if (title === 'Info Box') {
            result.infoBox = parseInfoBoxSection(body);
        } else if (title === 'Present Characters') {
            result.characterThoughts = parseCharactersSection(body);
        }
    }

    return result;
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Parse key-value lines (- Key: Value) from a block of text.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseKVLines(text) {
    const map = new Map();
    const re = /^- (.+?):\s*(.+)$/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        map.set(m[1].trim(), m[2].trim());
    }
    return map;
}

function parseStatsSection(body) {
    const kv = parseKVLines(body);
    const stats = {};

    for (const [key, val] of kv) {
        const lower = key.toLowerCase();

        // "Health: 85/100" → numeric
        const numMatch = val.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (numMatch) {
            stats[lower] = parseInt(numMatch[1], 10);
            continue;
        }

        if (lower === 'mood') { stats.mood = val; continue; }
        if (lower === 'conditions') { stats.conditions = val; continue; }
        if (lower === 'skills') {
            stats.skills = val.split(',').map(s => s.trim()).filter(Boolean);
            continue;
        }

        // Generic fallback
        const num = Number(val);
        stats[lower] = isNaN(num) ? val : num;
    }

    return Object.keys(stats).length > 0 ? stats : null;
}

function parseInfoBoxSection(body) {
    const kv = parseKVLines(body);
    const info = {};

    const date = kv.get('Date');
    if (date) info.date = { value: date };

    const weather = kv.get('Weather');
    if (weather) {
        // Split leading emoji from text
        const emojiMatch = weather.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)\s*/u);
        if (emojiMatch) {
            info.weather = {
                emoji: emojiMatch[1],
                forecast: weather.slice(emojiMatch[0].length).trim()
            };
        } else {
            info.weather = { emoji: '', forecast: weather };
        }
    }

    const temp = kv.get('Temperature');
    if (temp) {
        const m = temp.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([CF]?)$/i);
        if (m) {
            info.temperature = { value: parseFloat(m[1]), unit: (m[2] || 'C').toUpperCase() };
        }
    }

    const time = kv.get('Time');
    if (time) {
        const parts = time.split(/\s*[–-]\s*/);
        info.time = { start: parts[0] || '', end: parts[1] || '' };
    }

    const loc = kv.get('Location');
    if (loc) info.location = { value: loc };

    const events = kv.get('Recent Events');
    if (events) info.recentEvents = { value: events };

    return Object.keys(info).length > 0 ? info : null;
}

function parseCharactersSection(body) {
    const characters = [];
    // Split on h3 headers (### Name)
    const charBlocks = body.split(/^### /gm).slice(1);

    for (const block of charBlocks) {
        const lines = block.split('\n');
        const nameLine = (lines[0] || '').trim();
        if (!nameLine) continue;

        // Separate leading emoji from name
        const emojiMatch = nameLine.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)\s*/u);
        const emoji = emojiMatch ? emojiMatch[1] : '';
        const name = emojiMatch ? nameLine.slice(emojiMatch[0].length).trim() : nameLine;

        const kv = parseKVLines(block);
        const ch = { name, emoji };

        if (kv.has('Relationship')) ch.relationship = kv.get('Relationship');
        if (kv.has('Appearance')) ch.appearance = kv.get('Appearance');
        if (kv.has('Demeanor')) ch.demeanor = kv.get('Demeanor');
        if (kv.has('Thoughts')) {
            // Strip surrounding quotes
            ch.thoughts = kv.get('Thoughts').replace(/^[""]|[""]$/g, '');
        }

        characters.push(ch);
    }

    return characters.length > 0 ? { characters } : null;
}

/**
 * Safely parse a value that may already be an object or may be a JSON string.
 * @param {any} val
 * @returns {object|null}
 */
function safeParse(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val !== 'string') return null;
    try {
        return JSON.parse(val);
    } catch {
        return null;
    }
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
