const BUTTON_LABEL = 'Scan / Update Tracker';
const BUTTON_TITLE = 'Scan this reply into RPG Tracker. Reading narrative text may use an additional AI request.';
const STYLE_ID = 'rpg-message-scan-styles';
const STATUS_ID = 'rpg-message-scan-status';

let pendingRequest = null;
let contextGetter = null;
let scanEnabled = true;

function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #chat .mes_buttons:has(> .rpg-scan-btn) { flex-wrap: wrap; }
        #chat .mes_buttons > .rpg-scan-btn {
            display: inline-flex; align-items: center; justify-content: center;
            gap: 0.35em; flex: 0 0 auto; width: auto; min-height: 24px;
            margin: 0; padding: 2px 5px; border: 1px solid transparent;
            border-radius: 4px; background: transparent; color: inherit;
            font: inherit; font-size: 0.78em; line-height: 1.25;
            opacity: 0.75; white-space: nowrap; cursor: pointer;
        }
        #chat .mes_buttons > .rpg-scan-btn:hover,
        #chat .mes_buttons > .rpg-scan-btn:focus-visible {
            opacity: 1; border-color: currentColor;
        }
        #chat .mes_buttons > .rpg-scan-btn:disabled { opacity: 0.45; cursor: wait; }
        #chat .rpg-scan-btn svg { width: 1.15em; height: 1.15em; flex: none; }
        #${STATUS_ID} {
            position: fixed; width: 1px; height: 1px; padding: 0; margin: -1px;
            overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
        }
    `;
    document.head.append(style);
}

function announce(text, level = 'info') {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
        status = document.createElement('div');
        status.id = STATUS_ID;
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        document.body.append(status);
    }
    status.textContent = text;
    if (level && typeof window.toastr?.[level] === 'function') {
        // Text-only feedback also avoids interpreting provider error text as HTML.
        window.toastr[level](text, 'RPG Tracker', { escapeHtml: true });
    }
}

function messageIndex(row) {
    const raw = row?.getAttribute('mesid');
    return raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
}

function isAssistant(message) {
    return message?.is_user === false && !message.is_system
        && !message.extra?.is_system && message.extra?.type !== 'system';
}

function isBusy() {
    return Boolean(pendingRequest || window.RPGBridge?.isMessageScanBusy?.());
}

function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function refreshButton(button, message, index, busy) {
    const bridge = window.RPGBridge;
    const working = Boolean(pendingRequest && pendingRequest.message === message);
    const ready = typeof bridge?.scanMessage === 'function';
    const empty = typeof message.mes !== 'string' || !message.mes.trim();
    const canScan = ready && !empty && (typeof bridge.canScanMessage !== 'function' || bridge.canScanMessage(index));
    const disabled = !scanEnabled || busy || !canScan;
    if (button.disabled !== disabled) button.disabled = disabled;
    const label = working ? 'Updating…' : BUTTON_LABEL;
    const labelNode = button.querySelector('.rpg-scan-label');
    if (labelNode.textContent !== label) labelNode.textContent = label;
    setAttributeIfChanged(button, 'aria-label', label);
    setAttributeIfChanged(button, 'aria-busy', working ? 'true' : 'false');
    const title = working ? 'Updating RPG Tracker from this reply…'
        : busy ? 'Wait for the current tracker update to finish.'
            : !ready ? 'RPG Tracker is still loading.'
                : empty ? 'This reply has no text to scan.'
                    : !canScan ? 'This reply cannot be scanned right now. Wait for generation to finish.'
                        : BUTTON_TITLE;
    setAttributeIfChanged(button, 'title', title);
}

async function handleScan(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!scanEnabled || isBusy()) return;
    const button = event.currentTarget;
    const index = messageIndex(button.closest('.mes'));
    const context = contextGetter?.();
    const message = context?.chat?.[index];
    const bridge = window.RPGBridge;
    if (!isAssistant(message) || typeof message.mes !== 'string' || !message.mes.trim()) return;
    if (typeof bridge?.scanMessage !== 'function') {
        announce('RPG Tracker is still loading. Try again in a moment.', 'warning');
        return;
    }
    if (typeof bridge.canScanMessage === 'function' && !bridge.canScanMessage(index)) return;

    const request = { message };
    pendingRequest = request;
    injectMessageScanButtons(contextGetter, scanEnabled);
    announce('Updating RPG Tracker from the selected reply…', null);
    try {
        const result = await bridge.scanMessage(index);
        const messages = {
            updated: 'RPG Tracker updated. See Tracker Changes for the accepted changes.',
            'no-changes': 'No new tracker changes were found in this reply.',
            'already-scanned': 'This version of the reply has already been scanned.',
            cancelled: 'Scan cancelled because the selected chat or reply changed. No update was applied.',
        };
        if (!result || !Object.prototype.hasOwnProperty.call(messages, result.status)) {
            throw new Error('The tracker scan did not return a confirmed result. Try again.');
        }
        announce(result.message || messages[result.status], result.status === 'updated' ? 'success' : 'info');
    } catch (error) {
        console.error('[RPG Tracker] Message scan failed:', error);
        announce(error?.message || 'The tracker scan failed. Try again.', 'error');
    } finally {
        if (pendingRequest === request) pendingRequest = null;
        injectMessageScanButtons(contextGetter, scanEnabled);
    }
}

function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mes_button rpg-scan-btn';
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 9h10M7 12h10M7 15h6" /></svg><span class="rpg-scan-label"></span>`;
    button.addEventListener('click', handleScan);
    return button;
}

// Called alongside the existing snapshot-button injection. This deliberately
// never changes, replaces, or handles clicks on Add/Edit Message Tracker.
export function injectMessageScanButtons(getContext, enabled = true) {
    contextGetter = getContext;
    scanEnabled = Boolean(enabled);
    if (!scanEnabled) {
        document.querySelectorAll('#chat .rpg-scan-btn').forEach(button => button.remove());
        return;
    }
    const context = getContext?.();
    if (!Array.isArray(context?.chat)) return;
    installStyles();
    const busy = isBusy();
    document.querySelectorAll('#chat .mes').forEach(row => {
        const index = messageIndex(row);
        const message = context.chat[index];
        let button = row.querySelector('.rpg-scan-btn');
        if (!isAssistant(message)) {
            button?.remove();
            return;
        }
        const actions = row.querySelector('.mes_buttons');
        if (!actions) return;
        if (!button) {
            button = createButton();
            const snapshot = actions.querySelector('.rpg-snapshot-btn');
            if (snapshot) snapshot.insertAdjacentElement('afterend', button);
            else actions.prepend(button);
        }
        refreshButton(button, message, index, busy);
    });
}
