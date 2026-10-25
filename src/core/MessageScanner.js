import { getChatKey } from './ChatLockStore.js';
import { applyLLMPatch } from './JSONTracker_Patcher.js';
import { getAppliedDelta } from './AppliedDelta.js';
import { buildMessageScanPrompt, extractEmbeddedScanPatch, parseMessageScanPatch, stripMessageScanMarkup } from './MessageScanInput.js';
import { getMessageSwipeId, getMessageScanRecord } from './MessageScanState.js';

const isAssistant = message => message?.is_user === false && !message.is_system
    && !message.extra?.is_system && message.extra?.type !== 'system';

// Host operations are injected so selection races can be tested without a model.
export function createMessageScanner({ getContext, getBridge, generate, commit, isGenerating = () => false }) {
    let busy = false;
    const canScanMessage = index => {
        const context = getContext();
        const bridge = getBridge();
        const message = context?.chat?.[index];
        return !busy && !isGenerating() && !bridge?.isQuietUpdating
            && bridge?.latestSettings?.enabled !== false && Boolean(getChatKey(context))
            && Number.isInteger(index) && isAssistant(message)
            && Boolean(stripMessageScanMarkup(message.mes));
    };

    async function scanMessage(index) {
        if (busy) throw new Error('Another reply is already being scanned. Wait for it to finish.');
        if (!canScanMessage(index)) throw new Error('Open an AI reply and wait for generation to finish before scanning.');
        const bridge = getBridge();
        bridge.flushSave?.();
        const context = getContext();
        const message = context.chat[index];
        const target = {
            chatKey: getChatKey(context), chat: context.chat, message, index,
            storage: { chatId: context.chatId, groupId: context.groupId,
                avatar: context.characters?.[context.characterId]?.avatar },
            swipeId: getMessageSwipeId(message), sourceText: stripMessageScanMarkup(message.mes),
            historyRevision: bridge.historyRevision || 0, scanRevision: bridge.scanRevision || 0,
            length: context.chat.length, tail: context.chat.at(-1),
            tailSwipeId: getMessageSwipeId(context.chat.at(-1)), tailText: context.chat.at(-1)?.mes,
        };
        const stillCurrent = () => {
            const current = getContext();
            const currentBridge = getBridge();
            return getChatKey(current) === target.chatKey && current?.chat === target.chat
                && current.chat[index] === message && getMessageSwipeId(message) === target.swipeId
                && stripMessageScanMarkup(message.mes) === target.sourceText
                && current.chat.length === target.length && current.chat.at(-1) === target.tail
                && getMessageSwipeId(target.tail) === target.tailSwipeId && target.tail.mes === target.tailText
                && (currentBridge.historyRevision || 0) === target.historyRevision
                && (currentBridge.scanRevision || 0) === target.scanRevision
                && currentBridge.latestSettings?.enabled !== false;
        };
        if (getMessageScanRecord(message)) return { status: 'already-scanned' };

        busy = true;
        try {
            let tracker = bridge.applyChatLocks?.(bridge.currentTrackerData) || bridge.currentTrackerData;
            if (!Array.isArray(tracker?.characters)) throw new Error('The chat tracker is not ready. Open the tracker and try again.');
            const embedded = extractEmbeddedScanPatch(target.sourceText, tracker);
            const output = embedded === null
                ? await generate(buildMessageScanPrompt(target.sourceText, tracker)) : null;
            if (!stillCurrent()) return { status: 'cancelled' };

            // Preserve locks changed while the model request was running.
            tracker = bridge.applyChatLocks?.(bridge.currentTrackerData) || bridge.currentTrackerData;
            const patch = embedded === null ? parseMessageScanPatch(output, tracker)
                : parseMessageScanPatch(JSON.stringify(embedded), tracker);
            const patched = applyLLMPatch(tracker, patch);
            const updated = bridge.applyChatLocks?.(patched) || patched;
            const delta = getAppliedDelta(tracker, updated, patch);
            const record = { version: 1, sourceText: target.sourceText, delta, scannedAt: new Date().toISOString() };
            if (!stillCurrent()) return { status: 'cancelled' };
            await commit({ target, before: tracker, updated, record, stillCurrent });
            return { status: Object.keys(delta).length ? 'updated' : 'no-changes' };
        } finally {
            busy = false;
        }
    }

    return { scanMessage, canScanMessage, isMessageScanBusy: () => busy };
}
