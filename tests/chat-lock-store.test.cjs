const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

const loaded = Promise.all([
    loadEsm('src/core/ChatLockStore.js'),
    loadEsm('src/core/JSONTracker_Timeline.js'),
]);
const copy = value => JSON.parse(JSON.stringify(value));

function tracker(height = '200 cm', locked = true) {
    return {
        worldState: { weather: locked ? 'Clear' : 'Rain' },
        worldStateLocks: { weather: locked },
        characters: [{
            id: 'same-character', name: 'Player',
            statusSchema: [], status: {},
            profile: { Height: height }, profileLocks: { Height: locked },
        }],
    };
}

function context(chatId, characterId = 1, groupId = null) {
    return {
        chatId, characterId, groupId, chatMetadata: {}, saves: 0,
        saveMetadata() { this.saves += 1; return Promise.resolve(); },
    };
}

test('chat keys distinguish character/group ownership, even for identical chat names', async () => {
    const [{ getChatKey }] = await loaded;
    assert.equal(getChatKey({}), null);
    assert.notEqual(getChatKey(context('Chat', 1)), getChatKey(context('Chat', 2)));
    assert.notEqual(getChatKey(context('Chat', null, 1)), getChatKey(context('Chat', null, 2)));
    assert.notEqual(getChatKey(context('Chat', 1)), getChatKey(context('Chat', null, 1)));
});

test('remember persists chat metadata once and restore overlays current lock values', async () => {
    const [{ createChatLockStore, CHAT_LOCKS_KEY }] = await loaded;
    const active = context('A');
    const store = createChatLockStore(() => active);
    const locked = tracker();
    store.remember(locked);
    store.remember(copy(locked));
    assert.equal(active.saves, 1, 'Unchanged lock metadata should not trigger another save');
    assert.equal(active.chatMetadata[CHAT_LOCKS_KEY].version, 1);
    const snapshot = tracker('180 cm', false);
    const restored = store.restore(snapshot);
    assert.equal(restored.characters[0].profile.Height, '200 cm');
    assert.equal(restored.characters[0].profileLocks.Height, true);
    assert.equal(restored.worldState.weather, 'Clear');
    assert.equal(snapshot.characters[0].profile.Height, '180 cm', 'A historical snapshot stays immutable');
});

test('unlock replaces saved protection instead of reviving a historical lock', async () => {
    const [{ createChatLockStore }] = await loaded;
    const active = context('A');
    const store = createChatLockStore(() => active);
    store.remember(tracker());
    store.remember(tracker('210 cm', false));
    const restored = store.restore(tracker('190 cm', true));
    assert.equal(restored.characters[0].profileLocks.Height, false);
    assert.equal(restored.characters[0].profile.Height, '190 cm', 'Unlocked fields follow the selected history');
    assert.equal(restored.worldStateLocks.weather, false);
    assert.equal(active.saves, 2);
});

test('switching chats never imports another chat lock state and returns to saved locks', async () => {
    const [{ createChatLockStore, CHAT_LOCKS_KEY }] = await loaded;
    const first = context('Same name', 1);
    const second = context('Same name', 2);
    let active = first;
    const store = createChatLockStore(() => active);
    store.remember(tracker('200 cm', true));
    const firstMetadata = copy(first.chatMetadata);
    active = second;
    const secondRecovered = tracker('160 cm', false);
    const secondResult = store.restore(secondRecovered);
    assert.equal(secondResult.characters[0].profile.Height, '160 cm');
    assert.equal(secondResult.characters[0].profileLocks.Height, false);
    assert.equal(second.chatMetadata[CHAT_LOCKS_KEY].characters['same-character'].profile.flags.Height, false);
    assert.deepEqual(copy(first.chatMetadata), firstMetadata);
    active = first;
    const firstResult = store.restore(tracker('150 cm', false));
    assert.equal(firstResult.characters[0].profile.Height, '200 cm');
    assert.equal(firstResult.characters[0].profileLocks.Height, true);
});

test('legacy chat without lock metadata migrates only its own recovered snapshot', async () => {
    const [{ createChatLockStore, CHAT_LOCKS_KEY }] = await loaded;
    const active = context('Legacy');
    const store = createChatLockStore(() => active);
    const recovered = tracker('170 cm', true);
    assert.equal(store.restore(recovered), recovered);
    assert.equal(active.chatMetadata[CHAT_LOCKS_KEY].characters['same-character'].profile.values.Height, '170 cm');
    assert.equal(active.saves, 1);
    const nextSnapshot = tracker('140 cm', false);
    assert.equal(store.restore(nextSnapshot).characters[0].profile.Height, '170 cm');
});

test('an old async request cannot remember or restore against the newly selected chat', async () => {
    const [{ createChatLockStore, getChatKey }] = await loaded;
    let active = context('A');
    const previous = active;
    const oldKey = getChatKey(active);
    const store = createChatLockStore(() => active);
    active = context('B');
    const stale = tracker('999 cm', true);
    store.remember(stale, oldKey);
    assert.equal(store.restore(stale, oldKey), stale);
    assert.deepEqual(active.chatMetadata, {});
    assert.deepEqual(previous.chatMetadata, {});
    assert.equal(active.saves, 0);
});

test('welcome screen and a context without metadata do not persist lock state', async () => {
    const [{ createChatLockStore }] = await loaded;
    let active = context(null);
    const store = createChatLockStore(() => active);
    store.remember(tracker());
    store.restore(tracker());
    assert.deepEqual(active.chatMetadata, {});
    assert.equal(active.saves, 0);
    active = { chatId: 'No metadata' };
    assert.doesNotThrow(() => store.restore(tracker()));
    assert.equal(active.chatMetadata, undefined);
});

test('deferred backup targets its original swipe after selection changes', async () => {
    const [, { backupToMessage }] = await loaded;
    const originalState = tracker('200 cm', true);
    originalState.characters[0].avatarUrl = 'data:image/png;base64,temporary';
    const selectedState = tracker('180 cm', false);
    const message = {
        mes: 'Second response', swipe_id: 1,
        swipes: ['First response', 'Second response'],
        swipe_info: [
            { extra: { rpgTrackerData: tracker('150 cm', false) } },
            { extra: { rpgTrackerData: copy(selectedState) } },
        ],
    };
    let saves = 0;
    backupToMessage([message], 0, originalState, null, () => { saves += 1; }, 20, 0);
    assert.equal(message.swipe_info[0].extra.rpgTrackerData.characters[0].profile.Height, '200 cm');
    assert.equal(message.swipe_info[0].extra.rpgTrackerData.characters[0].profileLocks.Height, true);
    assert.deepEqual(message.swipe_info[1].extra.rpgTrackerData, selectedState);
    assert.equal(message.swipe_id, 1);
    assert.equal(message.mes, 'Second response');
    assert.equal(message.swipe_info[0].extra.rpgTrackerData.characters[0].avatarUrl, undefined);
    assert.equal(originalState.characters[0].avatarUrl, 'data:image/png;base64,temporary');
    assert.equal(saves, 1);
});

test('ordinary backup still resolves the active message text when no target is supplied', async () => {
    const [, { backupToMessage }] = await loaded;
    const message = { mes: 'Second', swipe_id: 0, swipes: ['First', 'Second'], swipe_info: [] };
    backupToMessage([message], 0, tracker(), null, null);
    assert.equal(message.swipe_info[0], undefined);
    assert.equal(message.swipe_info[1].extra.rpgTrackerData.characters[0].profile.Height, '200 cm');
});
