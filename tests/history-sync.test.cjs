const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/core/ExtensionBridge.js'), 'utf8');
const snapshot = id => ({ characters: [{ id, name: id }] });
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

// Exercise the native bridge's actual history orchestration. Host APIs and React
// callbacks are isolated so event ordering can be controlled without real timers.
async function setup() {
    const events = [];
    const state = {
        context: { chatId: null, characterId: 1, chat: [] },
        snapshot: snapshot('old'),
        pending: null,
    };
    state.read = async () => {
        events.push('read');
        return structuredClone(state.snapshot);
    };
    const bridge = {
        currentTrackerData: snapshot('old'),
        syncSettings() {},
        prepareChatScope() { events.push('scope'); },
        flushSave() {
            events.push('flush');
            if (state.pending) {
                state.snapshot = state.pending;
                state.pending = null;
            }
        },
        syncChatData(data) {
            events.push('restore');
            bridge.currentTrackerData = data;
        },
        resetToDefault() { events.push('reset'); },
        setChatConnectionStatus() {},
    };
    let connect;
    const context = vm.createContext({
        window: { RPGBridge: bridge },
        console,
        setInterval(callback) { connect = callback; return 1; },
        clearInterval() {},
        setTimeout() { return 2; },
    });
    const overrides = {
        getContext: () => state.context,
        extension_settings: { tracker: {} },
        getChatKey: ctx => ctx.chatId ? JSON.stringify([ctx.characterId, ctx.chatId]) : null,
        createChatLockStore: () => ({ remember() {}, restore: value => value }),
        createPresetBridge: () => ({}),
        rehydrateFromHistoryAsync: () => state.read(),
    };
    const imported = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)]
        .map(([, names, specifier]) => [specifier, names.split(',').map(name => name.trim())]));
    const entry = new vm.SourceTextModule(source, { context });
    await entry.link(specifier => {
        const names = imported.get(specifier);
        assert(names, `Unexpected import ${specifier}`);
        return new vm.SyntheticModule(names, function () {
            for (const name of names) this.setExport(name, overrides[name] ?? (() => {}));
        }, { context });
    });
    await entry.evaluate();
    entry.namespace.establishBridgeConnection('tracker');
    connect();
    state.context.chatId = 'A';
    events.length = 0;
    return { bridge, state, events };
}

test('a settings refresh flushes pending editor data before reading its snapshot', async () => {
    const { bridge, state, events } = await setup();
    state.pending = snapshot('reordered');
    await bridge.syncFromHistoryOrMeta();
    assert.deepEqual(events, ['scope', 'flush', 'read', 'restore']);
    assert.equal(bridge.currentTrackerData.characters[0].id, 'reordered');
    assert.equal(state.pending, null);
});

test('a late history result cannot overwrite an edit made while it was loading', async () => {
    const { bridge, state, events } = await setup();
    const read = deferred();
    state.read = () => read.promise;
    const syncing = bridge.syncFromHistoryOrMeta();
    bridge.currentTrackerData = snapshot('edited');
    bridge.trackerRevision = 1;
    read.resolve(snapshot('old'));
    await syncing;
    assert.equal(bridge.currentTrackerData.characters[0].id, 'edited');
    assert(!events.includes('restore'));
    assert.equal(bridge.historyRevision, undefined, 'Ordinary edits do not invalidate pending model requests');
});

test('a late history result cannot overwrite a newer swipe restoration', async () => {
    const { bridge, state, events } = await setup();
    const read = deferred();
    state.read = () => read.promise;
    const syncing = bridge.syncFromHistoryOrMeta();
    bridge.currentTrackerData = snapshot('swiped');
    bridge.historyRevision = 1;
    read.resolve(snapshot('old'));
    await syncing;
    assert.equal(bridge.currentTrackerData.characters[0].id, 'swiped');
    assert(!events.includes('restore'));
});

test('a newer history refresh supersedes an earlier unresolved read', async () => {
    const { bridge, state, events } = await setup();
    const first = deferred();
    const second = deferred();
    let calls = 0;
    state.read = () => ++calls === 1 ? first.promise : second.promise;
    const earlier = bridge.syncFromHistoryOrMeta();
    const later = bridge.syncFromHistoryOrMeta();
    second.resolve(snapshot('latest'));
    await later;
    first.resolve(snapshot('old'));
    await earlier;
    assert.equal(bridge.currentTrackerData.characters[0].id, 'latest');
    assert.equal(events.filter(event => event === 'restore').length, 1);
});

test('a late result from another chat is ignored', async () => {
    const { bridge, state, events } = await setup();
    const read = deferred();
    state.read = () => read.promise;
    const syncing = bridge.syncFromHistoryOrMeta();
    state.context = { ...state.context, chatId: 'B' };
    bridge.currentTrackerData = snapshot('chat-B');
    read.resolve(snapshot('chat-A'));
    await syncing;
    assert.equal(bridge.currentTrackerData.characters[0].id, 'chat-B');
    assert(!events.includes('restore'));
});

test('chat scope is prepared before flushing so a prior chat draft is discarded', async () => {
    const { bridge, state, events } = await setup();
    state.pending = snapshot('chat-A-draft');
    state.snapshot = snapshot('chat-B');
    state.context.chatId = 'B';
    bridge.prepareChatScope = () => {
        events.push('scope');
        state.pending = null;
    };
    await bridge.syncFromHistoryOrMeta();
    assert.deepEqual(events, ['scope', 'flush', 'read', 'restore']);
    assert.equal(bridge.currentTrackerData.characters[0].id, 'chat-B');
});
