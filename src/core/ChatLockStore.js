import { captureLocks, applyLocks } from './TrackerLocks.js';

export const CHAT_LOCKS_KEY = 'rpgTrackerLocks';

export function getChatKey(context) {
    if (!context?.chatId) return null;
    return JSON.stringify([context.groupId ?? null, context.characterId ?? null, context.chatId]);
}

// Lock choices belong to chat metadata, not a response/swipe or global settings.
export function createChatLockStore(getContext) {
    function remember(tracker, expectedKey = getChatKey(getContext())) {
        const context = getContext();
        if (!expectedKey || getChatKey(context) !== expectedKey || !context.chatMetadata) return;
        const locks = captureLocks(tracker);
        if (JSON.stringify(context.chatMetadata[CHAT_LOCKS_KEY]) === JSON.stringify(locks)) return;
        context.chatMetadata[CHAT_LOCKS_KEY] = locks;
        Promise.resolve(context.saveMetadata?.()).catch(error => {
            console.error('[RPG Tracker] Could not save chat locks:', error);
        });
    }

    function restore(tracker, expectedKey = getChatKey(getContext())) {
        const context = getContext();
        if (!expectedKey || getChatKey(context) !== expectedKey) return tracker;
        const saved = context.chatMetadata?.[CHAT_LOCKS_KEY];
        if (saved?.version === 1) return applyLocks(tracker, saved);
        // Existing chats start with their own recovered locks, never another chat's.
        remember(tracker, expectedKey);
        return tracker;
    }

    return { remember, restore };
}
