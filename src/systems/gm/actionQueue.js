/**
 * Action Queue System for GM Mode
 * Manages queued actions for turn submission
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';

// Runtime queue state (not persisted - clears on refresh)
let actionQueue = [];
let queueListeners = [];

/**
 * Get default queue settings
 */
export function getDefaultQueueSettings() {
    return {
        maxQueueSize: 5,
        autoRollRisky: true
    };
}

/**
 * Add action to queue
 */
export function addToQueue(action, location) {
    const maxSize = extensionSettings.gmMode?.queueSettings?.maxQueueSize || 5;

    if (actionQueue.length >= maxSize) {
        return { success: false, error: 'Queue is full' };
    }

    const queuedAction = {
        ...action,
        locationId: location?.id,
        locationName: location?.name,
        queuedAt: Date.now()
    };

    actionQueue.push(queuedAction);
    notifyListeners();

    return { success: true, action: queuedAction };
}

/**
 * Remove action from queue by index
 */
export function removeFromQueue(index) {
    if (index < 0 || index >= actionQueue.length) {
        return { success: false, error: 'Invalid index' };
    }

    const removed = actionQueue.splice(index, 1)[0];
    notifyListeners();

    return { success: true, action: removed };
}

/**
 * Clear entire queue
 */
export function clearQueue() {
    actionQueue = [];
    notifyListeners();
}

/**
 * Get current queue
 */
export function getQueue() {
    return [...actionQueue];
}

/**
 * Get queue summary (totals)
 */
export function getQueueSummary() {
    const summary = {
        count: actionQueue.length,
        totalTime: 0,
        totalEnergy: 0,
        totalMoney: 0,
        totalHp: 0,
        hasRiskyActions: false,
        actions: []
    };

    for (const action of actionQueue) {
        summary.totalTime += action.time || 0;
        summary.totalEnergy += action.energy || 0;
        summary.totalMoney += action.money || 0;
        summary.totalHp += action.hp || 0;

        if (action.risk && action.risk !== 'none') {
            summary.hasRiskyActions = true;
        }

        summary.actions.push({
            name: action.name,
            time: action.time,
            risk: action.risk
        });
    }

    return summary;
}

/**
 * Check if an action is already in queue
 */
export function isInQueue(actionId) {
    return actionQueue.some(a => a.id === actionId);
}

/**
 * Move action in queue (reorder)
 */
export function moveInQueue(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= actionQueue.length ||
        toIndex < 0 || toIndex >= actionQueue.length) {
        return false;
    }

    const [item] = actionQueue.splice(fromIndex, 1);
    actionQueue.splice(toIndex, 0, item);
    notifyListeners();

    return true;
}

/**
 * Execute queue - processes actions and returns for GM
 * Note: Stat changes are applied AFTER GM determines outcome
 */
export function executeQueue() {
    const executed = [...actionQueue];

    // Clear the queue
    actionQueue = [];
    notifyListeners();

    return {
        executed,
        summary: getQueueSummary()
    };
}

/**
 * Apply stat effects from action results
 * Called after GM determines outcome severity
 */
export function applyActionEffects(action, severity = 1.0) {
    // Severity multiplier: 0.5 = light, 1.0 = normal, 1.5 = harsh, 2.0 = dire
    const effects = {
        energy: Math.round((action.energy || 0) * severity),
        money: Math.round((action.money || 0) * severity),
        hp: Math.round((action.hp || 0) * severity),
        time: action.time || 0
    };

    return effects;
}

/**
 * Format queue for GM prompt
 */
export function formatQueueForGM() {
    if (actionQueue.length === 0) {
        return 'No actions queued.';
    }

    const lines = ['Player\'s Queued Actions:'];

    for (let i = 0; i < actionQueue.length; i++) {
        const action = actionQueue[i];
        let line = `${i + 1}. ${action.name}`;

        if (action.time) line += ` (${action.time}min)`;
        if (action.risk && action.risk !== 'none') {
            line += ` [Risk: ${action.risk}]`;
        }
        if (action.flavor) {
            line += ` - "${action.flavor}"`;
        }

        lines.push(line);
    }

    const summary = getQueueSummary();
    lines.push('');
    lines.push(`Total time: ${formatQueueTime(summary.totalTime)}`);

    if (summary.totalEnergy !== 0) {
        lines.push(`Estimated energy: ${formatStatChange(summary.totalEnergy)}`);
    }
    if (summary.totalMoney !== 0) {
        lines.push(`Estimated cost: ${formatStatChange(summary.totalMoney)}`);
    }
    if (summary.hasRiskyActions) {
        lines.push('Note: Some actions involve risk - outcome depends on dice roll.');
    }

    return lines.join('\n');
}

/**
 * Subscribe to queue changes
 */
export function subscribeToQueue(callback) {
    queueListeners.push(callback);

    return () => {
        const index = queueListeners.indexOf(callback);
        if (index > -1) {
            queueListeners.splice(index, 1);
        }
    };
}

/**
 * Notify all listeners of queue change
 */
function notifyListeners() {
    const queue = getQueue();
    const summary = getQueueSummary();

    for (const listener of queueListeners) {
        try {
            listener(queue, summary);
        } catch (error) {
            console.error('[GM Mode] Queue listener error:', error);
        }
    }
}

/**
 * Format time for display
 */
export function formatQueueTime(minutes) {
    if (minutes < 60) {
        return `${minutes}min`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins === 0) {
        return `${hours}hr`;
    }

    return `${hours}hr ${mins}min`;
}

/**
 * Format stat change for display
 */
export function formatStatChange(value, prefix = '') {
    if (value === 0) return '';
    const sign = value > 0 ? '+' : '';
    return `${prefix}${sign}${value}`;
}

/**
 * Get queue as structured data for context injection
 */
export function getQueueContextData() {
    if (actionQueue.length === 0) return null;

    return {
        count: actionQueue.length,
        actions: actionQueue.map(a => ({
            name: a.name,
            time: a.time,
            risk: a.risk,
            effects: {
                energy: a.energy || 0,
                money: a.money || 0,
                hp: a.hp || 0
            }
        })),
        summary: getQueueSummary()
    };
}
