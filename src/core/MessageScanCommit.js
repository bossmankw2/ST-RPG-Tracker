import { getChatKey } from './ChatLockStore.js';
import { backupToMessage } from './JSONTracker_Timeline.js';
import { MESSAGE_SCAN_KEY } from './MessageScanState.js';

export function createMessageScanCommit({ getContext, getBridge, saveChat, verifySaved, refresh }) {
    return async ({ target, before, updated, record, stillCurrent }) => {
        if (!stillCurrent()) throw new Error('The selected chat or reply changed. Please scan it again.');
        const bridge = getBridge();
        const source = target.message;
        const tail = target.tail;
        const oldRecord = source.swipe_info?.[target.swipeId]?.extra?.[MESSAGE_SCAN_KEY];
        const oldSnapshot = tail.swipe_info?.[target.tailSwipeId]?.extra?.rpgTrackerData;
        let snapshot;
        let applied;
        const rollback = (message, swipe, key, written, previous) => {
            const extra = message.swipe_info?.[swipe]?.extra;
            if (!extra || written === undefined || extra[key] !== written) return;
            if (previous === undefined) delete extra[key];
            else extra[key] = previous;
        };
        try {
            source.swipe_info ??= [];
            source.swipe_info[target.swipeId] ??= {};
            source.swipe_info[target.swipeId].extra ??= {};
            source.swipe_info[target.swipeId].extra[MESSAGE_SCAN_KEY] = record;

            // Keep old source snapshots/automatic deltas intact. Current state
            // belongs to the tail, even when an older reply was scanned.
            backupToMessage(target.chat, target.length - 1, updated, null, null, -1, target.tailSwipeId);
            snapshot = tail.swipe_info[target.tailSwipeId].extra.rpgTrackerData;
            bridge.syncChatData(updated);
            applied = bridge.currentTrackerData;
            await saveChat();
            // SillyTavern's save helper can swallow errors. Read back the captured
            // chat before claiming success, including if selection changed meanwhile.
            await verifySaved?.({ target, record, snapshot });
        } catch (error) {
            rollback(source, target.swipeId, MESSAGE_SCAN_KEY, record, oldRecord);
            rollback(tail, target.tailSwipeId, 'rpgTrackerData', snapshot, oldSnapshot);
            if (applied && getChatKey(getContext()) === target.chatKey && bridge.currentTrackerData === applied) {
                bridge.syncChatData(before);
            }
            throw error;
        } finally {
            refresh?.();
        }
    };
}
