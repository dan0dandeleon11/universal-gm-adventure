/**
 * Co-Op Relay Module
 * Formats GM narration for clipboard relay to a partner SillyTavern instance.
 */

export { formatGMOutputForRelay, copyToClipboard, onGMTurnComplete } from './relay.js';
export { formatDualInput, detectPartnerPaste, wrapWithPartnerPrefix } from './inputFormatter.js';
