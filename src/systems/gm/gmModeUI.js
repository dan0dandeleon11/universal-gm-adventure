/**
 * GM Mode UI Components
 * Renders location display, actions, and queue
 */

import { extensionSettings } from '../../core/state.js';
import {
    getCurrentLocation,
    getElectronicsForLocation,
    generateLocation,
    saveLocation,
    setCurrentLocation,
    getLocationTypes,
    formatTimeCost,
    getRiskDisplay,
    getTimeOfDay,
    getStrengthIndicator,
    getAllLocations
} from './locations.js';
import {
    addToQueue,
    removeFromQueue,
    clearQueue,
    getQueue,
    getQueueSummary,
    isInQueue,
    subscribeToQueue,
    formatQueueTime,
    formatStatChange
} from './actionQueue.js';

// Store unsubscribe function
let queueUnsubscribe = null;

/**
 * Create the GM Mode tab content HTML
 */
export function createGMModeTabHTML() {
    const location = getCurrentLocation();
    const timeOfDay = getTimeOfDay();

    return `
    <div class="rpg-gm-tab-content">
        <!-- Location Section -->
        <div class="rpg-gm-location-section">
            ${location ? createLocationHTML(location, timeOfDay) : createNoLocationHTML()}
        </div>

        <!-- Action Queue Section -->
        <div class="rpg-gm-queue-section">
            <div class="rpg-gm-section-header">
                <span><i class="fa-solid fa-list-check"></i> Action Queue</span>
                <button id="rpg-gm-clear-queue" class="rpg-btn-icon rpg-gm-clear-queue" title="Clear Queue">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>

            <div id="rpg-gm-queue-list" class="rpg-gm-queue-list">
                ${renderQueueList()}
            </div>

            <div id="rpg-gm-queue-summary" class="rpg-gm-queue-summary">
                ${renderQueueSummary()}
            </div>

            <div class="rpg-gm-queue-actions">
                <button id="rpg-gm-send-turn" class="rpg-btn-primary rpg-gm-send-btn">
                    <i class="fa-solid fa-dice-d20"></i> Roll & Send Turn
                </button>
            </div>
        </div>
    </div>
    `;
}

/**
 * Create location display HTML
 */
function createLocationHTML(location, timeOfDay) {
    const electronics = getElectronicsForLocation(location);

    return `
        <div class="rpg-gm-location-header">
            <div class="rpg-gm-location-info">
                <span class="rpg-gm-location-icon"><i class="fa-solid fa-map-marker-alt"></i></span>
                <span class="rpg-gm-location-name">${escapeHtml(location.name)}</span>
                <span class="rpg-gm-time-badge">${formatTimeOfDay(timeOfDay)}</span>
            </div>
            <button id="rpg-gm-change-location" class="rpg-btn-icon" title="Change Location">
                <i class="fa-solid fa-right-left"></i>
            </button>
        </div>

        <div class="rpg-gm-location-desc">${escapeHtml(location.description)}</div>

        ${electronics.length > 0 ? `
        <div class="rpg-gm-electronics">
            <span class="rpg-gm-electronics-label">
                <i class="fa-solid fa-wifi"></i> Nearby signals:
            </span>
            <div class="rpg-gm-electronics-list">
                ${electronics.map(e => {
                    const strength = getStrengthIndicator(e.strength);
                    return `
                    <span class="rpg-gm-electronic-item ${strength.class}" title="${escapeHtml(e.desc)}">
                        ${renderSignalBars(strength.bars)} ${escapeHtml(e.name)}
                    </span>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}

        <div class="rpg-gm-section-header rpg-gm-actions-header">
            <span><i class="fa-solid fa-hand-pointer"></i> Available Actions</span>
        </div>

        <div id="rpg-gm-actions-list" class="rpg-gm-actions-list">
            ${renderActionsList(location.actions)}
        </div>
    `;
}

/**
 * Create HTML for when no location is set
 */
function createNoLocationHTML() {
    const locationTypes = getLocationTypes();

    return `
        <div class="rpg-gm-no-location">
            <div class="rpg-gm-no-location-icon">
                <i class="fa-solid fa-map"></i>
            </div>
            <div class="rpg-gm-no-location-text">No location set</div>
            <div class="rpg-gm-no-location-hint">Generate a location to see available actions</div>

            <div class="rpg-gm-location-generator">
                <select id="rpg-gm-location-type" class="rpg-select">
                    ${locationTypes.map(type => `
                        <option value="${type}">${formatLocationType(type)}</option>
                    `).join('')}
                </select>
                <button id="rpg-gm-generate-location" class="rpg-btn-primary">
                    <i class="fa-solid fa-dice"></i> Generate
                </button>
            </div>
        </div>
    `;
}

/**
 * Render signal strength bars
 */
function renderSignalBars(count) {
    let bars = '';
    for (let i = 0; i < 3; i++) {
        const active = i < count ? 'active' : '';
        bars += `<span class="rpg-gm-signal-bar ${active}"></span>`;
    }
    return `<span class="rpg-gm-signal-bars">${bars}</span>`;
}

/**
 * Render the actions list
 */
function renderActionsList(actions) {
    if (!actions || actions.length === 0) {
        return '<div class="rpg-gm-no-actions">No actions available</div>';
    }

    return actions.map(action => {
        const inQueue = isInQueue(action.id);
        const risk = getRiskDisplay(action.risk);

        let statChanges = [];
        if (action.energy) statChanges.push(`E:${formatStatChange(action.energy)}`);
        if (action.money) statChanges.push(`$${formatStatChange(action.money)}`);
        if (action.hp) statChanges.push(`HP:${formatStatChange(action.hp)}`);

        return `
        <div class="rpg-gm-action-item ${inQueue ? 'rpg-gm-action-queued' : ''}" data-action-id="${action.id}">
            <div class="rpg-gm-action-main">
                <button class="rpg-gm-action-add ${inQueue ? 'in-queue' : ''}"
                        data-action='${JSON.stringify(action)}'
                        ${inQueue ? 'disabled' : ''}>
                    <i class="fa-solid ${inQueue ? 'fa-check' : 'fa-plus'}"></i>
                </button>
                <div class="rpg-gm-action-info">
                    <div class="rpg-gm-action-name">
                        ${escapeHtml(action.name)}
                        ${risk.text ? `<span class="${risk.class}">${risk.text}</span>` : ''}
                    </div>
                    ${action.flavor ? `<div class="rpg-gm-action-flavor">${escapeHtml(action.flavor)}</div>` : ''}
                </div>
                <div class="rpg-gm-action-meta">
                    <span class="rpg-gm-action-time">${formatTimeCost(action.time)}</span>
                    ${statChanges.length > 0 ? `<span class="rpg-gm-action-stats">${statChanges.join(' ')}</span>` : ''}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

/**
 * Render the queue list
 */
function renderQueueList() {
    const queue = getQueue();

    if (queue.length === 0) {
        return `
        <div class="rpg-gm-queue-empty">
            <i class="fa-solid fa-inbox"></i>
            <span>Click [+] to add actions to queue</span>
        </div>
        `;
    }

    return queue.map((action, index) => `
        <div class="rpg-gm-queue-item" data-index="${index}">
            <span class="rpg-gm-queue-number">${index + 1}.</span>
            <span class="rpg-gm-queue-name">${escapeHtml(action.name)}</span>
            <span class="rpg-gm-queue-time">${formatTimeCost(action.time)}</span>
            <button class="rpg-gm-queue-remove" data-index="${index}" title="Remove">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Render queue summary
 */
function renderQueueSummary() {
    const summary = getQueueSummary();

    if (summary.count === 0) {
        return '';
    }

    let parts = [`<span class="rpg-gm-summary-time"><i class="fa-solid fa-clock"></i> ${formatQueueTime(summary.totalTime)}</span>`];

    if (summary.totalEnergy !== 0) {
        const cls = summary.totalEnergy > 0 ? 'positive' : 'negative';
        parts.push(`<span class="rpg-gm-summary-stat ${cls}">E:${formatStatChange(summary.totalEnergy)}</span>`);
    }

    if (summary.totalMoney !== 0) {
        const cls = summary.totalMoney > 0 ? 'positive' : 'negative';
        parts.push(`<span class="rpg-gm-summary-stat ${cls}">$${formatStatChange(summary.totalMoney)}</span>`);
    }

    if (summary.hasRiskyActions) {
        parts.push('<span class="rpg-gm-summary-warning"><i class="fa-solid fa-exclamation-triangle"></i> Risky</span>');
    }

    return parts.join('');
}

/**
 * Setup GM Mode UI event listeners
 */
export function setupGMModeEvents() {
    // Unsubscribe from previous queue listener
    if (queueUnsubscribe) {
        queueUnsubscribe();
    }

    // Subscribe to queue changes
    queueUnsubscribe = subscribeToQueue((queue, summary) => {
        refreshQueueDisplay();
        refreshActionsDisplay();
    });

    // Generate location button
    $(document).off('click', '#rpg-gm-generate-location').on('click', '#rpg-gm-generate-location', function() {
        const type = $('#rpg-gm-location-type').val();
        const location = generateLocation(type);

        if (location) {
            saveLocation(location);
            setCurrentLocation(location.id);
            refreshGMModeDisplay();
            toastr.success(`Arrived at ${location.name}`);
        }
    });

    // Change location button
    $(document).off('click', '#rpg-gm-change-location').on('click', '#rpg-gm-change-location', function() {
        showLocationPicker();
    });

    // Add action to queue
    $(document).off('click', '.rpg-gm-action-add').on('click', '.rpg-gm-action-add', function() {
        if ($(this).hasClass('in-queue')) return;

        const actionData = $(this).data('action');
        const location = getCurrentLocation();

        const result = addToQueue(actionData, location);

        if (result.success) {
            $(this).addClass('in-queue').prop('disabled', true)
                .find('i').removeClass('fa-plus').addClass('fa-check');
            toastr.info(`Added: ${actionData.name}`);
        } else {
            toastr.warning(result.error);
        }
    });

    // Remove from queue
    $(document).off('click', '.rpg-gm-queue-remove').on('click', '.rpg-gm-queue-remove', function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        removeFromQueue(index);
    });

    // Clear queue
    $(document).off('click', '#rpg-gm-clear-queue').on('click', '#rpg-gm-clear-queue', function() {
        if (getQueue().length > 0) {
            clearQueue();
            toastr.info('Queue cleared');
        }
    });

    // Send turn button
    $(document).off('click', '#rpg-gm-send-turn').on('click', '#rpg-gm-send-turn', async function() {
        const queue = getQueue();
        if (queue.length === 0) {
            toastr.warning('No actions queued');
            return;
        }

        // Trigger the GM turn process
        // This will be connected to gmEngine
        const event = new CustomEvent('rpg-gm-send-turn', {
            detail: { queue: getQueue(), summary: getQueueSummary() }
        });
        document.dispatchEvent(event);
    });
}

/**
 * Refresh GM Mode display
 */
export function refreshGMModeDisplay() {
    const $container = $('#rpg-gm-tab-container');
    if ($container.length) {
        $container.html(createGMModeTabHTML());
    }
}

/**
 * Refresh just the queue display
 */
function refreshQueueDisplay() {
    $('#rpg-gm-queue-list').html(renderQueueList());
    $('#rpg-gm-queue-summary').html(renderQueueSummary());
}

/**
 * Refresh just the actions display
 */
function refreshActionsDisplay() {
    const location = getCurrentLocation();
    if (location) {
        $('#rpg-gm-actions-list').html(renderActionsList(location.actions));
    }
}

/**
 * Show location picker modal
 */
function showLocationPicker() {
    const locationTypes = getLocationTypes();
    const savedLocations = getAllLocations();

    const modalHtml = `
    <div id="rpg-gm-location-picker" class="rpg-modal-overlay">
        <div class="rpg-modal rpg-gm-location-modal">
            <div class="rpg-modal-header">
                <span><i class="fa-solid fa-map"></i> Change Location</span>
                <button class="rpg-modal-close" id="rpg-gm-location-picker-close">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="rpg-modal-body">
                <div class="rpg-gm-picker-section">
                    <h4>Generate New Location</h4>
                    <div class="rpg-gm-location-generator">
                        <select id="rpg-gm-picker-type" class="rpg-select">
                            ${locationTypes.map(type => `
                                <option value="${type}">${formatLocationType(type)}</option>
                            `).join('')}
                        </select>
                        <button id="rpg-gm-picker-generate" class="rpg-btn-primary">
                            <i class="fa-solid fa-dice"></i> Generate
                        </button>
                    </div>
                </div>

                ${savedLocations.length > 0 ? `
                <div class="rpg-gm-picker-section">
                    <h4>Saved Locations</h4>
                    <div class="rpg-gm-saved-locations">
                        ${savedLocations.map(loc => `
                            <div class="rpg-gm-saved-location" data-id="${loc.id}">
                                <span class="rpg-gm-saved-name">${escapeHtml(loc.name)}</span>
                                <span class="rpg-gm-saved-type">${formatLocationType(loc.type)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    </div>
    `;

    $('body').append(modalHtml);

    // Close modal
    $('#rpg-gm-location-picker-close, #rpg-gm-location-picker').on('click', function(e) {
        if (e.target === this || $(this).attr('id') === 'rpg-gm-location-picker-close') {
            $('#rpg-gm-location-picker').remove();
        }
    });

    // Prevent modal content click from closing
    $('#rpg-gm-location-picker .rpg-modal').on('click', function(e) {
        e.stopPropagation();
    });

    // Generate new location
    $('#rpg-gm-picker-generate').on('click', function() {
        const type = $('#rpg-gm-picker-type').val();
        const location = generateLocation(type);

        if (location) {
            saveLocation(location);
            setCurrentLocation(location.id);
            refreshGMModeDisplay();
            $('#rpg-gm-location-picker').remove();
            toastr.success(`Arrived at ${location.name}`);
        }
    });

    // Select saved location
    $('.rpg-gm-saved-location').on('click', function() {
        const id = $(this).data('id');
        setCurrentLocation(id);
        refreshGMModeDisplay();
        $('#rpg-gm-location-picker').remove();

        const loc = getCurrentLocation();
        if (loc) {
            toastr.success(`Returned to ${loc.name}`);
        }
    });
}

/**
 * Format location type for display
 */
function formatLocationType(type) {
    return type.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

/**
 * Format time of day for display
 */
function formatTimeOfDay(time) {
    const displays = {
        'morning': '<i class="fa-solid fa-sun"></i> Morning',
        'afternoon': '<i class="fa-solid fa-cloud-sun"></i> Afternoon',
        'evening': '<i class="fa-solid fa-cloud-moon"></i> Evening',
        'night': '<i class="fa-solid fa-moon"></i> Night'
    };
    return displays[time] || time;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Cleanup function
 */
export function cleanupGMModeUI() {
    if (queueUnsubscribe) {
        queueUnsubscribe();
        queueUnsubscribe = null;
    }
}
