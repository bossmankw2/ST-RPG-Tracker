import { MESSAGE_SCAN_KEY } from './MessageScanState.js';

export function createMessageScanVerifier({ getRequestHeaders, fetchImpl = fetch }) {
    return async ({ target, record, snapshot }) => {
        const storage = target.storage;
        const isGroup = storage?.groupId !== null && storage?.groupId !== undefined;
        if (!storage?.chatId || (!isGroup && !storage.avatar)) {
            throw new Error('Could not confirm the tracker save for this chat. Please reopen the chat and try again.');
        }
        const response = await fetchImpl(isGroup ? '/api/chats/group/get' : '/api/chats/get', {
            method: 'POST', headers: getRequestHeaders(), cache: 'no-store',
            body: JSON.stringify(isGroup ? { id: storage.chatId }
                : { file_name: storage.chatId, avatar_url: storage.avatar }),
        });
        if (!response.ok) throw new Error('Could not confirm the tracker save on the server. Please try again.');
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('The server did not return a saved chat. Please try again.');
        const chat = data[0] && Object.prototype.hasOwnProperty.call(data[0], 'chat_metadata') ? data.slice(1) : data;
        const savedRecord = chat[target.index]?.swipe_info?.[target.swipeId]?.extra?.[MESSAGE_SCAN_KEY];
        const savedSnapshot = chat[target.length - 1]?.swipe_info?.[target.tailSwipeId]?.extra?.rpgTrackerData;
        if (JSON.stringify(savedRecord) !== JSON.stringify(record)
            || JSON.stringify(savedSnapshot) !== JSON.stringify(snapshot)) {
            throw new Error('The tracker save could not be confirmed. The chat may have changed; reopen it before trying again.');
        }
    };
}
