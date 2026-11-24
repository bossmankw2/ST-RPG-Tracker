const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let sortWorldEventsByTime;
test.before(async () => {
  ({ sortWorldEventsByTime } = await loadEsm('src/core/WorldEventOrder.js'));
});

const event = (name, startDate, startTime) => ({ id: `event_${name}`, name, desc: name, startDate, startTime });

test('a late scan can be sorted before earlier rows without changing ties or any event data', () => {
  const date = '2025-12-14';
  const motorcade = { ...event('Motorcade', date, '10:22'), endTime: '10:23' };
  const ledger = event('Ledger', date, '10:24');
  const detail = event('Security', date, '10:24 AM');
  const swaps = event('Swaps', date, '10:18');
  const original = Object.freeze([motorcade, ledger, detail, swaps]);
  const sorted = sortWorldEventsByTime(original);
  [swaps, motorcade, ledger, detail].forEach((entry, i) => assert.equal(sorted[i], entry));
  assert.equal(original[0], motorcade);
  assert.equal(sortWorldEventsByTime(sorted), sorted);
});

test('unambiguous dates and 12/24-hour clocks compare across days and noon/midnight', () => {
  const previous = event('Leap day', '2024-02-29 (Thursday)', '23:59:59');
  const midnight = event('Midnight', '1 March 2024', '12 AM');
  const noon = event('Noon', 'Friday, March 1, 2024 AD', '12:00 PM');
  const later = event('Later', 'Mar. 1, 2024', '12:00:01');
  assert.deepEqual(sortWorldEventsByTime([later, noon, midnight, previous]), [previous, midnight, noon, later]);
});

test('unknown story dates and clocks keep their exact slots, even among valid days', () => {
  const early = event('Early', '2025-12-14', '10:18');
  const late = event('Late', '2025-12-16', '12:34');
  const pinned = [
    'Legacy text', { endDate: '2025-12-14', endTime: '10:00' },
    event('No date', '', '10:01 AM'), event('Fictional', 'Frostfall 30, Year 8', '10:02'),
    event('Ambiguous date', '03/02/2025', '10:04'), event('Invalid date', '2025-02-29', '09:01'),
    event('Invalid time', '2025-12-15', '13:00 PM'), event('Story clock', '2025-12-15', 'at dawn'),
  ];
  assert.deepEqual(sortWorldEventsByTime([late, ...pinned, early]), [early, ...pinned, late]);
});

test('date-only beats can sort across dates but stay pinned among known times on their day', () => {
  const before = event('Yesterday', '2025-12-13', '');
  const after = event('Tomorrow', '2025-12-15');
  const early = event('Early', '2025-12-14', '07:30');
  const unknown = event('Unknown time', '2025-12-14');
  const late = event('Late', '2025-12-14', '20:15');
  assert.deepEqual(sortWorldEventsByTime([after, late, unknown, early, before]), [before, early, unknown, late, after]);
});

test('saved story order survives reload, a later tracker update, AI recall and snapshot creation', async () => {
  const { backupToMessage, rehydrateFromHistory } = await loadEsm('src/core/JSONTracker_Timeline.js');
  const { applyLLMPatch } = await loadEsm('src/core/JSONTracker_Patcher.js');
  const { buildCleanStatusPrompt, buildDynamicValuesPrompt } = await loadEsm('src/core/ActivePrompt.js');
  const { buildSnapshotPayload } = await loadEsm('src/messagetracker/SnapshotCore.js');
  const list = [event('Detail', '2025-12-14', '10:24'), event('Swaps', '2025-12-14', '10:18')];
  const tracker = { characters: [], worldState: { events: sortWorldEventsByTime(list) } };
  const chat = [{ mes: 'Story turn', swipe_id: 0 }];
  backupToMessage(chat, 0, tracker);
  const restored = rehydrateFromHistory(JSON.parse(JSON.stringify(chat)));
  const next = applyLLMPatch(restored, { World: { events: [
    { name: 'Detail', desc: 'Arrived.' }, { name: 'Breakfast', desc: 'Found later.', startDate: '2025-12-14', startTime: '07:10' },
  ] } });
  const names = events => events.map(row => row.name);
  const expected = ['Swaps', 'Detail', 'Breakfast'];
  assert.deepEqual(names(next.worldState.events), expected);
  assert.equal(next.worldState.events[1].desc, 'Arrived.');
  for (const build of [buildCleanStatusPrompt, buildDynamicValuesPrompt]) {
    const json = JSON.parse(build(next).match(/`{3}json\n([\s\S]*?)\n`{3}/)[1]);
    assert.deepEqual(names(json.World.events), expected);
  }
  const snapshot = buildSnapshotPayload(next, { world: { selected: true, events: true }, chars: {} });
  assert.deepEqual(names(snapshot.world.events), expected);
});

test('later updates target the same event after a move when titles share a generated ID', async () => {
  const { applyLLMPatch } = await loadEsm('src/core/JSONTracker_Patcher.js');
  const first = { id: 'event_Act_I', name: 'Act I', desc: 'First.' };
  const second = { id: 'manual-card', name: 'Act-I', desc: 'Second.' };
  for (const order of [[first, second], [second, first]]) {
    const after = applyLLMPatch({ characters: [], worldState: { events: order } }, {
      World: { events: [{ name: 'Act-I', desc: 'Edited.' }, { name: 'Act: I', desc: 'New beat.' }] },
    }).worldState.events;
    assert.deepEqual(after.map(row => row.name), [...order.map(row => row.name), 'Act: I']);
    assert.deepEqual(after.find(row => row.name === 'Act I'), first);
    assert.deepEqual(after.find(row => row.name === 'Act-I'), { ...second, desc: 'Edited.' });
    assert.equal(new Set(after.map(row => row.id)).size, 3);
  }
});

test('numbered story days sort numerically within their own calendar slots', () => {
  const ten = event('Finale', 'Day 10', '8:00');
  const two = event('Overture', 'Day 2', '10:30 PM');
  const realDate = event('Dated note', '2025-12-14', '10:18');
  assert.deepEqual(sortWorldEventsByTime([ten, realDate, 'Unknown', two]), [two, realDate, 'Unknown', ten]);
});
