const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let formatWorldEventTime, buildSnapshotHtml, buildDeltaLogHtml;
test.before(async () => {
  ({ formatWorldEventTime } = await loadEsm('src/tracker/WorldEventTimeLabel.js'));
  ({ buildSnapshotHtml } = await loadEsm('src/messagetracker/SnapshotRenderer.js'));
  ({ buildDeltaLogHtml } = await loadEsm('src/tracker/DeltaLogRenderer.js'));
});

test('story time shows same-day ranges, cross-day dates, and fictional calendars without parsing', () => {
  assert.equal(formatWorldEventTime({
    startDate: '2025-12-17', startTime: '10:02 AM', endDate: '2025-12-17', endTime: '11:30 AM',
  }), '2025-12-17 · 10:02 AM–11:30 AM');
  assert.equal(formatWorldEventTime({
    startDate: 'Day 9, First Moon', startTime: 'Dusk', endDate: 'Day 10, First Moon', endTime: 'Dawn',
  }), 'Start: Day 9, First Moon · Dusk → End: Day 10, First Moon · Dawn');
});

test('partial and legacy event times stay partial instead of acquiring the current date', () => {
  assert.equal(formatWorldEventTime({ name: 'Legacy' }), '');
  assert.equal(formatWorldEventTime('Legacy description'), '');
  assert.equal(formatWorldEventTime({ startDate: '  ', startTime: null }), '');
  assert.equal(formatWorldEventTime({ endTime: 'Noon' }), 'End: Noon');
  assert.equal(formatWorldEventTime({ startDate: '2025-12-17', startTime: '10:02', endTime: '11:30' }),
    'Start: 2025-12-17 · 10:02 → End: 11:30');
});

test('snapshot and accepted-change recap include escaped timestamps while retaining event text', () => {
  const event = {
    name: 'Discovery', desc: 'A hidden letter was found.',
    startDate: '<img src=x onerror=alert(1)>', startTime: '"Noon" & \'Dawn\'',
  };
  for (const html of [buildSnapshotHtml({ world: { events: [event] } }), buildDeltaLogHtml({ World: { events: [event] } })]) {
    assert.match(html, /Discovery/);
    assert.match(html, /A hidden letter was found\./);
    assert.match(html, /In-story time:/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&quot;Noon&quot; &amp; &#39;Dawn&#39;/);
    assert.doesNotMatch(html, /<img/);
  }
});

test('undated events keep their existing snapshot and recap text without an empty time row', () => {
  const event = { name: 'Discovery', desc: 'A hidden letter was found.' };
  for (const html of [buildSnapshotHtml({ world: { events: [event] } }), buildDeltaLogHtml({ World: { events: [event] } })]) {
    assert.match(html, /Discovery/);
    assert.match(html, /A hidden letter was found\./);
    assert.doesNotMatch(html, /In-story time:/);
  }
});
