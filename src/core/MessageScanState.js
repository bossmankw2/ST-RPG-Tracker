import { stripMessageScanMarkup } from './MessageScanInput.js';

export const MESSAGE_SCAN_KEY = 'rpgTrackerScan';

export function getMessageSwipeId(message) {
    const selected = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
    if (message?.swipes?.[selected] === message.mes) return selected;
    const matched = message?.swipes?.findIndex(text => text === message.mes) ?? -1;
    return matched >= 0 ? matched : selected;
}

export function getMessageScanRecord(message) {
    const record = message?.swipe_info?.[getMessageSwipeId(message)]?.extra?.[MESSAGE_SCAN_KEY];
    return record?.version === 1 && record.sourceText === stripMessageScanMarkup(message.mes)
        ? record : null;
}

export function mergeScanDelta(original, scanned) {
    const merged = { ...(original || {}) };
    for (const [key, value] of Object.entries(scanned || {})) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        merged[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? mergeScanDelta(merged[key], value) : value;
    }
    return merged;
}
