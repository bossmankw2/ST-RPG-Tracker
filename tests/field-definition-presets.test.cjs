const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');
let createDefinitionPresetStorage;
let previewDefinitionPreset;
let validateDefinitionGuidelines;
let createPresetBridge;
test.before(async () => {
    ({ createDefinitionPresetStorage, previewDefinitionPreset, validateDefinitionGuidelines } = await loadEsm('src/core/FieldDefinitionPresets.js'));
    ({ createPresetBridge } = await loadEsm('src/core/PresetBridge.js'));
});

const copy = value => JSON.parse(JSON.stringify(value));
const definitions = { profile_Appearance: 'Describe visible physical traits.', status_hp: 'Track current health.', relation_trust: 'Track trust in the target.' };
const extensionName = 'ST-RPG-Tracker';
const characterPresets = [{ id: 'char-preset', name: 'Characters', type: 'account', data: [{ id: 'a', name: 'Aster' }] }];
function fixture(initial = []) {
    let stored = {
        username: 'Fixture user',
        extension_settings: {
            [extensionName]: { enabled: true, presets: characterPresets, fieldDefinitionPresets: copy(initial) },
            other: { keep: true },
        },
    };
    let nextFailure;
    let writes = 0;
    let id = 0;
    function client() {
        const bridge = createPresetBridge({
            extensionName,
            getRequestHeaders: () => ({ 'X-CSRF-Token': 'test' }),
            syncPresets: () => {},
            syncFieldDefinitionPresets: () => {},
            fetchImpl: async (url, options) => {
                assert.equal(options.headers['X-CSRF-Token'], 'test');
                if (nextFailure) {
                    const error = nextFailure;
                    nextFailure = null;
                    throw new Error(error);
                }
                if (url === '/api/settings/get') return { ok: true, json: async () => ({ settings: JSON.stringify(stored) }) };
                writes++;
                stored = JSON.parse(options.body);
                return { ok: true, json: async () => ({ result: 'ok' }) };
            },
        });
        return createDefinitionPresetStorage({ bridge, idFactory: () => `guide-${++id}`, now: () => '2026-11-17T00:00:00.000Z' });
    }
    return { client, stored: () => copy(stored), replace: library => { stored.extension_settings[extensionName].fieldDefinitionPresets = copy(library); }, fail: message => { nextFailure = message; }, writes: () => writes };
}

test('a fresh device loads saved guidelines from the account without character data or browser storage', async () => {
    const server = fixture();
    const first = server.client();
    const saved = await first.save({ name: ' Fantasy ', definitions });
    assert.equal(saved.preset.name, 'Fantasy');
    assert.deepEqual(saved.preset.definitions, definitions);
    assert.deepEqual(Object.keys(saved.preset).sort(), ['definitions', 'id', 'name', 'storageVersion', 'type', 'updatedAt']);
    const second = server.client();
    const loaded = await second.load(saved.preset.id);
    assert.deepEqual(loaded.definitions, definitions);
    assert.deepEqual((await second.refresh()).presets, saved.presets);
    loaded.definitions.profile_Appearance = 'Local only';
    assert.equal((await first.load(saved.preset.id)).definitions.profile_Appearance, definitions.profile_Appearance);
    assert.deepEqual(server.stored().extension_settings[extensionName].presets, characterPresets);
    assert.deepEqual(server.stored().extension_settings.other, { keep: true });
});

test('only reviewed versions can be overwritten or deleted after another device changes a preset', async () => {
    const server = fixture();
    const desktop = server.client();
    const phone = server.client();
    const saved = await desktop.save({ name: 'Shared', definitions });
    const remote = await phone.save({ id: saved.preset.id, name: 'Shared', definitions: { ...definitions, status_hp: 'New guide' }, expectedPreset: saved.preset });
    await assert.rejects(desktop.save({ id: saved.preset.id, name: 'Overwrite', definitions, expectedPreset: saved.preset }), /changed on another device/i);
    await assert.rejects(desktop.remove(saved.preset.id, saved.preset), /changed on another device/i);
    assert.deepEqual(await desktop.remove(remote.preset.id, remote.preset), []);
    await assert.rejects(phone.save({ id: remote.preset.id, name: 'Recreate', definitions, expectedPreset: remote.preset }), /removed on another device/i);
    await assert.rejects(desktop.load(remote.preset.id), /no longer exists/i);
});

test('new saves cannot overwrite duplicate names or allocate duplicate identifiers', async () => {
    const server = fixture();
    const client = server.client();
    await client.save({ name: 'Fantasy', definitions });
    await assert.rejects(client.save({ name: ' FANTASY ', definitions }), /name already exists/i);
    assert.equal(server.writes(), 1);
    const saved = (await client.refresh()).presets;
    const colliding = createDefinitionPresetStorage({
        bridge: { readFieldDefinitionPresets: async () => saved, persistFieldDefinitionPresets: async () => { throw new Error('must not write'); } },
        idFactory: () => saved[0].id,
    });
    await assert.rejects(colliding.save({ name: 'Different', definitions }), /unique preset ID/i);
});

test('load preview matches exact field keys, preserves unrelated drafts, and reports overwrite/unknown counts', () => {
    const current = { profile_Appearance: 'My existing guide', status_hp: definitions.status_hp, profile_Notes: 'Keep my notes' };
    const incoming = { ...definitions, profile_appearance: 'Different case', profile_OldField: 'Unused here' };
    const preview = previewDefinitionPreset(incoming, current, ['profile_Appearance', 'status_hp', 'relation_trust', 'profile_Notes']);
    assert.deepEqual({ matched: preview.matchedCount, changed: preview.changedCount, overwrite: preview.overwriteCount, skipped: preview.skippedCount }, { matched: 3, changed: 2, overwrite: 1, skipped: 2 });
    assert.deepEqual(preview.definitions, { ...current, ...definitions });
    assert.equal(current.profile_Appearance, 'My existing guide');
    const emptyGuide = previewDefinitionPreset({ profile_Appearance: '' }, current, ['profile_Appearance']);
    assert.equal(emptyGuide.overwriteCount, 1);
    assert.equal(emptyGuide.definitions.profile_Appearance, '');
});

test('failed and unconfirmed saves preserve existing data and remain retryable', async () => {
    const server = fixture();
    const client = server.client();
    server.fail('Network disconnected');
    await assert.rejects(client.save({ name: 'Fantasy', definitions }), /Network disconnected/);
    assert.equal(server.writes(), 0);
    assert.deepEqual(server.stored().extension_settings[extensionName].fieldDefinitionPresets, []);
    await client.save({ name: 'Fantasy', definitions });
    const unconfirmed = createDefinitionPresetStorage({
        bridge: { readFieldDefinitionPresets: async () => [], persistFieldDefinitionPresets: async () => [] },
    });
    await assert.rejects(unconfirmed.save({ name: 'Not confirmed', definitions }), /did not confirm/i);
});

test('invalid guideline payloads, unsafe keys and corrupted libraries never trigger writes', async () => {
    const server = fixture();
    const client = server.client();
    for (const data of [null, [], { profile_Age: 20 }, { characters: [] }, { profile_: 'Invalid' }, JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: 'no' }]) {
        assert.throws(() => validateDefinitionGuidelines(data));
        await assert.rejects(client.save({ name: 'Invalid', definitions: data }));
    }
    await assert.rejects(client.save({ name: 'Empty', definitions: { profile_Appearance: '  ' } }), /at least one/i);
    assert.equal(server.writes(), 0);
    assert.equal({}.polluted, undefined);
    const saved = await client.save({ name: 'Valid', definitions });
    for (const bad of [
        { ...saved.preset, definitions: { status_hp: 20 } },
        { ...saved.preset, storageVersion: 99 },
        { ...saved.preset, characters: [{ name: 'Should not be stored here' }] },
    ]) {
        server.replace([bad]);
        await assert.rejects(client.refresh());
        await assert.rejects(client.save({ name: 'New', definitions }));
        assert.equal(server.writes(), 1);
    }
    server.replace([saved.preset, { ...saved.preset, id: 'duplicate-name' }]);
    await assert.rejects(client.refresh(), /duplicate/i);
    assert.equal(server.writes(), 1);
});

test('server operations use immutable input and fail clearly when the bridge is unavailable', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let persisted;
    const client = createDefinitionPresetStorage({ bridge: {
        readFieldDefinitionPresets: async () => { await pending; return []; },
        persistFieldDefinitionPresets: async next => { persisted = copy(next); return next; },
    } });
    const draft = { ...definitions };
    const save = client.save({ name: 'Immutable', definitions: draft });
    draft.status_hp = 'Changed during network request';
    release();
    await save;
    assert.equal(persisted[0].definitions.status_hp, definitions.status_hp);
    const disconnected = createDefinitionPresetStorage({ bridge: () => null });
    await assert.rejects(disconnected.refresh(), /not connected/i);
});
