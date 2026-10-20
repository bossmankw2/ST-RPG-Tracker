import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/core/PresetStorage.js', import.meta.url), 'utf8');
const { createPresetStorage, getPresetLocation, validatePresetCharacters } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const copy = value => JSON.parse(JSON.stringify(value));
const characters = [{
  id: 'character-a',
  name: 'Aster',
  profile: { Height: '200 cm' },
  profileLocks: { Height: true },
  statusSchema: [{ id: 'hp', name: 'HP', isLocked: true }],
  status: { hp: 80 },
}];

function fixture(initial = [], cache = {}) {
  let server = copy(initial);
  let failure = null;
  let writes = 0;
  const values = new Map(Object.entries(cache));
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
  };
  const bridge = {
    readPresetSettings: async () => copy(server),
    persistPresetSettings: async (next, expected) => {
      writes++;
      assert.deepEqual(expected, server);
      if (failure) throw new Error(failure);
      server = copy(next);
      return copy(server);
    },
  };
  return {
    client: createPresetStorage({ bridge, storage, idFactory: () => 'new-id', now: () => '2026-10-20T00:00:00.000Z' }),
    storage,
    bridge,
    values,
    server: () => copy(server),
    writes: () => writes,
    fail: message => { failure = message; },
    replace: presets => { server = copy(presets); },
  };
}

test('migration moves available browser and inline legacy presets to the server without losing missing entries or local backups', async () => {
  const local = { id: 'RT1', name: 'Browser preset', type: 'cache' };
  const missing = { id: 'RT2', name: 'Other device', type: 'cache' };
  const legacy = { id: 'RT3', name: 'Legacy inline', data: characters };
  const packaged = { id: 'bundled', name: 'Built in', type: 'file', file: 'bundled.json' };
  const instance = fixture([local, missing, legacy, packaged], { rpg_tracker_preset_RT1: JSON.stringify(characters) });
  const result = await instance.client.refresh();

  assert.equal(result.migratedCount, 2);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.presets[1], missing);
  assert.deepEqual(result.presets[3], packaged);
  assert.deepEqual(result.presets[0].data, characters);
  assert.deepEqual(result.presets[2].data, characters);
  assert.equal(result.presets[0].type, 'account');
  assert.equal(instance.values.get('rpg_tracker_preset_RT1'), JSON.stringify(characters));
  assert.deepEqual(instance.server(), result.presets);
  assert.equal((await instance.client.refresh()).migratedCount, 0);
  assert.equal(instance.writes(), 1, 'opening the library again must not repeat migration writes');
});

test('failed migration leaves both server metadata and browser contents intact and can be retried', async () => {
  const initial = [{ id: 'RT1', name: 'Browser preset', type: 'cache' }];
  const instance = fixture(initial, { rpg_tracker_preset_RT1: JSON.stringify(characters) });
  instance.fail('Connection lost');
  const failed = await instance.client.refresh();
  assert.equal(failed.migratedCount, 0);
  assert.match(failed.migrationError, /Connection lost/);
  assert.deepEqual(instance.server(), initial);
  assert.deepEqual(failed.presets, initial);
  assert.equal(instance.values.get('rpg_tracker_preset_RT1'), JSON.stringify(characters));
  instance.fail(null);
  assert.equal((await instance.client.refresh()).migratedCount, 1);
});

test('a second browser with empty local storage can load the saved preset including IDs, values and locks', async () => {
  const first = fixture();
  const saved = await first.client.save({ name: 'Adventure', data: characters });
  const second = fixture(first.server());
  const loaded = await second.client.load(saved.preset.id);
  assert.deepEqual(loaded.data, characters);
  assert.equal(getPresetLocation(loaded.preset, second.storage), 'Server');
  loaded.data[0].profile.Height = 'Changed draft';
  assert.equal(second.server()[0].data[0].profile.Height, '200 cm');
});

test('missing browser presets explain recovery instead of being silently deleted', async () => {
  const initial = [{ id: 'RT1', name: 'Browser preset', type: 'cache' }];
  const instance = fixture(initial);
  assert.equal(getPresetLocation(initial[0], instance.storage), 'Original browser');
  await assert.rejects(instance.client.load('RT1'), /original browser and address/);
  assert.deepEqual(instance.server(), initial);
  assert.equal(instance.writes(), 0);
});

test('overwriting a preset keeps its ID and requires the version that the user reviewed', async () => {
  const instance = fixture();
  const first = await instance.client.save({ name: 'Adventure', data: characters });
  const edited = copy(characters);
  edited[0].name = 'Renamed character';
  const second = await instance.client.save({ id: first.preset.id, name: 'Renamed preset', data: edited, expectedPreset: first.preset });
  assert.equal(second.preset.id, first.preset.id);
  assert.equal(second.preset.data[0].id, characters[0].id);
  assert.deepEqual(characters[0].profileLocks, { Height: true });
  await assert.rejects(instance.client.save({ id: first.preset.id, name: 'Stale edit', data: characters, expectedPreset: first.preset }), /changed on another device/);
  assert.deepEqual(instance.server()[0], second.preset);
});

test('new saves cannot overwrite an unseen same-name preset from another device', async () => {
  const instance = fixture();
  await instance.client.save({ name: 'Adventure', data: characters });
  await assert.rejects(instance.client.save({ name: ' adventure ', data: characters }), /name already exists/);
  assert.equal(instance.server().length, 1);
});

test('a failed save is rejected instead of being reported as confirmed', async () => {
  const instance = fixture();
  instance.fail('HTTP 500');
  await assert.rejects(instance.client.save({ name: 'Adventure', data: characters }), /HTTP 500/);
  assert.deepEqual(instance.server(), []);
  assert.deepEqual(characters[0].status, { hp: 80 });
});

test('deletion retains the browser backup until the server confirms it and detects stale deletion', async () => {
  const record = { id: 'RT1', name: 'Legacy', type: 'cache' };
  const instance = fixture([record], { rpg_tracker_preset_RT1: JSON.stringify(characters) });
  instance.fail('Offline');
  await assert.rejects(instance.client.remove(record.id, record), /Offline/);
  assert(instance.values.has('rpg_tracker_preset_RT1'));
  instance.fail(null);
  const changed = { ...record, name: 'Changed on phone' };
  instance.replace([changed]);
  await assert.rejects(instance.client.remove(record.id, record), /changed on another device/);
  assert(instance.values.has('rpg_tracker_preset_RT1'));
  assert.deepEqual(await instance.client.remove(changed.id, changed), []);
  assert.equal(instance.values.has('rpg_tracker_preset_RT1'), false);
});

test('invalid imports are rejected before any server write', async () => {
  const instance = fixture();
  for (const data of [[], {}, [null], [{ name: 'Missing ID' }], [...characters, ...characters]]) {
    await assert.rejects(instance.client.save({ name: 'Invalid', data }));
  }
  assert.equal(instance.writes(), 0);
  assert.throws(() => validatePresetCharacters([{ ...characters[0], name: ' ' }]), /name/);
});

test('unconfirmed server responses do not count as a successful save', async () => {
  const instance = fixture();
  instance.bridge.persistPresetSettings = async () => [];
  await assert.rejects(instance.client.save({ name: 'Adventure', data: characters }), /did not confirm/);
});
