const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let createPresetBridge;
test.before(async () => {
    ({ createPresetBridge } = await loadEsm('src/core/PresetBridge.js'));
});

const copy = value => JSON.parse(JSON.stringify(value));
const extensionName = 'rpg-tracker-for-sillytavern';
const library = [{ id: 'preset-a', name: 'Aster', type: 'account', data: [] }];
const response = (body, ok = true) => ({ ok, json: async () => copy(body) });
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function fixture({ initial = [], onRead, onWrite, document } = {}) {
    let stored = copy(document || {
        username: 'Fixture user',
        main_api: 'textgenerationwebui',
        extension_settings: {
            [extensionName]: { enabled: true, theme: 'custom', presets: initial },
            unrelatedExtension: { keep: 'unchanged' },
        },
    });
    const calls = [];
    const synced = [];
    let reads = 0;
    let writes = 0;
    let headerCalls = 0;
    const bridge = createPresetBridge({
        extensionName,
        getRequestHeaders: () => {
            headerCalls++;
            return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' };
        },
        syncPresets: presets => synced.push(copy(presets)),
        fetchImpl: async (url, options) => {
            calls.push({ url, options: copy(options) });
            if (url === '/api/settings/get') {
                reads++;
                const custom = await onRead?.({ number: reads, stored: copy(stored), replace: value => { stored = copy(value); } });
                return custom || response({ settings: JSON.stringify(stored) });
            }
            if (url === '/api/settings/save') {
                writes++;
                const payload = JSON.parse(options.body);
                const custom = await onWrite?.({ number: writes, payload, replace: value => { stored = copy(value); } });
                if (custom) return custom;
                stored = copy(payload);
                return response({ result: 'ok' });
            }
            throw new Error(`Unexpected endpoint ${url}`);
        },
    });
    return {
        bridge, calls, synced,
        stored: () => copy(stored),
        reads: () => reads,
        writes: () => writes,
        headerCalls: () => headerCalls,
    };
}

test('authenticated read uses host headers and returns an isolated account library', async () => {
    const instance = fixture({ initial: library });
    const presets = await instance.bridge.readPresetSettings();
    assert.deepEqual(presets, library);
    assert.deepEqual(instance.synced, [library]);
    assert.equal(instance.headerCalls(), 1);
    assert.equal(instance.calls[0].url, '/api/settings/get');
    assert.deepEqual(instance.calls[0].options, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' },
        body: '{}',
        cache: 'no-store',
    });
    presets[0].name = 'Changed only by caller';
    assert.equal(instance.stored().extension_settings[extensionName].presets[0].name, 'Aster');
});

test('save preserves unrelated settings and confirms the account library by reading it back', async () => {
    const instance = fixture();
    const original = instance.stored();
    const saved = await instance.bridge.persistPresetSettings(library, []);
    assert.deepEqual(saved, library);
    assert.equal(instance.reads(), 2);
    assert.equal(instance.writes(), 1);
    assert.equal(instance.headerCalls(), 3);
    assert.deepEqual(instance.calls.map(call => call.url), ['/api/settings/get', '/api/settings/save', '/api/settings/get']);
    assert.deepEqual(instance.stored(), {
        ...original,
        extension_settings: {
            ...original.extension_settings,
            [extensionName]: { ...original.extension_settings[extensionName], presets: library },
        },
    });
    for (const call of instance.calls) {
        assert.equal(call.options.headers['X-CSRF-Token'], 'test-csrf');
        assert.equal(call.options.method, 'POST');
        assert.equal(call.options.cache, 'no-store');
    }
});

test('HTTP 200 without a successful save result is rejected and not synced as success', async () => {
    const instance = fixture({ onWrite: () => response({ error: 'Disk write failed' }) });
    await assert.rejects(instance.bridge.persistPresetSettings(library, []), /could not be saved/i);
    assert.deepEqual(instance.synced, []);
    assert.deepEqual(instance.stored().extension_settings[extensionName].presets, []);
    assert.equal(instance.reads(), 1);
});

test('HTTP read and save errors reject without pretending the preset was persisted', async () => {
    const readFailure = fixture({ onRead: () => response({}, false) });
    await assert.rejects(readFailure.bridge.readPresetSettings(), /could not read/i);
    assert.deepEqual(readFailure.synced, []);
    const writeFailure = fixture({ onWrite: () => response({}, false) });
    await assert.rejects(writeFailure.bridge.persistPresetSettings(library, []), /could not be saved/i);
    assert.deepEqual(writeFailure.synced, []);
});

test('conflicting remote library prevents any save request', async () => {
    const instance = fixture({ initial: library });
    await assert.rejects(instance.bridge.persistPresetSettings([], []), /another device/i);
    assert.equal(instance.writes(), 0);
    assert.deepEqual(instance.stored().extension_settings[extensionName].presets, library);
});

test('verification mismatch reports failure and restores observed server state in live settings', async () => {
    const remote = [{ id: 'other', name: 'Other device', type: 'account', data: [] }];
    const instance = fixture({
        onRead: ({ number, stored, replace }) => {
            if (number === 2) {
                stored.extension_settings[extensionName].presets = remote;
                replace(stored);
            }
        },
    });
    await assert.rejects(instance.bridge.persistPresetSettings(library, []), /could not be confirmed/i);
    assert.deepEqual(instance.synced.at(-1), remote);
    assert.deepEqual(instance.stored().extension_settings[extensionName].presets, remote);
});

test('read-back network failure never reports a confirmed save', async () => {
    const instance = fixture({
        onRead: ({ number }) => number === 2 ? response({}, false) : undefined,
    });
    await assert.rejects(instance.bridge.persistPresetSettings(library, []), /could not read/i);
    assert.equal(instance.writes(), 1);
});

test('queued writes run in order and use their own immutable input snapshots', async () => {
    const started = deferred();
    const release = deferred();
    const instance = fixture({
        onWrite: async ({ number }) => {
            if (number === 1) {
                started.resolve();
                await release.promise;
            }
        },
    });
    const firstData = copy(library);
    const first = instance.bridge.persistPresetSettings(firstData, []);
    await started.promise;
    const nextData = [...library, { id: 'preset-b', name: 'Bram', type: 'account', data: [] }];
    const second = instance.bridge.persistPresetSettings(nextData, library);
    firstData[0].name = 'Changed after enqueue';
    nextData[1].name = 'Changed after enqueue';
    await Promise.resolve();
    const readsWhileBlocked = instance.reads();
    release.resolve();
    const [savedFirst, savedSecond] = await Promise.all([first, second]);
    assert.equal(readsWhileBlocked, 1, 'The second write cannot read until the first finishes verification');
    assert.equal(savedFirst[0].name, 'Aster');
    assert.equal(savedSecond[1].name, 'Bram');
    assert.deepEqual(instance.calls.map(call => call.url), [
        '/api/settings/get', '/api/settings/save', '/api/settings/get',
        '/api/settings/get', '/api/settings/save', '/api/settings/get',
    ]);
});

test('refresh waits for a pending write instead of syncing stale preset data', async () => {
    const started = deferred();
    const release = deferred();
    const instance = fixture({
        onWrite: async () => {
            started.resolve();
            await release.promise;
        },
    });
    const save = instance.bridge.persistPresetSettings(library, []);
    await started.promise;
    const read = instance.bridge.readPresetSettings();
    await Promise.resolve();
    const readsWhileBlocked = instance.reads();
    release.resolve();
    const [, refreshed] = await Promise.all([save, read]);
    assert.equal(readsWhileBlocked, 1);
    assert.deepEqual(refreshed, library);
    assert.deepEqual(instance.synced.at(-1), library);
});

test('a failed queued write does not prevent a later valid write', async () => {
    const instance = fixture({
        onWrite: ({ number }) => number === 1 ? response({}, false) : undefined,
    });
    const first = instance.bridge.persistPresetSettings(library, []);
    const second = instance.bridge.persistPresetSettings(library, []);
    await assert.rejects(first, /could not be saved/i);
    assert.deepEqual(await second, library);
    assert.equal(instance.writes(), 2);
});

test('malformed settings documents and invalid libraries are rejected before writes', async () => {
    for (const settings of [null, [], 'null', 'not JSON']) {
        const instance = fixture({ onRead: () => response({ settings }) });
        await assert.rejects(instance.bridge.persistPresetSettings(library, []));
        assert.equal(instance.writes(), 0);
    }
    const invalidLibrary = fixture({ document: { extension_settings: { [extensionName]: { presets: {} } } } });
    await assert.rejects(invalidLibrary.bridge.readPresetSettings(), /library is invalid/i);
});
