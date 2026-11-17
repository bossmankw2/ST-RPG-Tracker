const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let applyLLMPatch, sanitizeTrackerData, getWorldEventTiming, getAppliedDelta;
let buildDynamicValuesPrompt, buildCleanStatusPrompt, getDynamicSchemaExample;
let buildGuidePromptsSection, buildUpdatePromptWrapper, buildDefinitionPromptWrapper;
let parseMessageScanPatch, buildMessageScanPrompt, backupToMessage, rehydrateFromHistory, buildSnapshotPayload;
test.before(async () => {
    ({ applyLLMPatch } = await loadEsm('src/core/JSONTracker_Patcher.js'));
    ({ sanitizeTrackerData } = await loadEsm('src/core/JSONTracker_Migrator.js'));
    ({ getWorldEventTiming } = await loadEsm('src/core/WorldEventTime.js'));
    ({ getAppliedDelta } = await loadEsm('src/core/AppliedDelta.js'));
    ({ buildDynamicValuesPrompt, buildCleanStatusPrompt, getDynamicSchemaExample, buildGuidePromptsSection,
        buildUpdatePromptWrapper, buildDefinitionPromptWrapper } = await loadEsm('src/core/ActivePrompt.js'));
    ({ parseMessageScanPatch, buildMessageScanPrompt } = await loadEsm('src/core/MessageScanInput.js'));
    ({ backupToMessage, rehydrateFromHistory } = await loadEsm('src/core/JSONTracker_Timeline.js'));
    ({ buildSnapshotPayload } = await loadEsm('src/messagetracker/SnapshotCore.js'));
});

const timedEvent = () => ({ id: 'event_Discovery', name: 'Discovery', desc: 'A new clue.',
    startDate: '2025-12-17', startTime: '10:02 AM', endDate: '2025-12-17', endTime: '11:30 AM' });
const tracker = events => ({ characters: [], worldState: { date: '2026-01-01', time: '20:00', events }, worldStateLocks: {} });
const promptJson = prompt => JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)[1]);

test('event migration preserves established story timing without dating legacy events', () => {
    const input = tracker([timedEvent(), 'A legacy beat.', { id: 'old', name: 'Old', description: 'Before timestamps.' }]);
    const after = sanitizeTrackerData(input);
    assert.deepEqual(after.worldState.events[0], timedEvent());
    assert.deepEqual(getWorldEventTiming(after.worldState.events[1]), {});
    assert.deepEqual(getWorldEventTiming(after.worldState.events[2]), {});
    assert.equal(after.worldState.events[2].desc, 'Before timestamps.');
    delete after.worldState.events[0].endTime;
    assert.equal(sanitizeTrackerData(after).worldState.events[0].endTime, undefined, 'A manual clear stays cleared');
});

test('an ongoing beat preserves its start and extends only explicitly supplied end components', () => {
    const before = tracker([timedEvent()]);
    const after = applyLLMPatch(before, { World: { events: [{ name: 'Discovery', desc: 'The clue leads outside.',
        startDate: '2026-01-01', startTime: '20:00', endTime: '12:45 PM' }] } });
    assert.deepEqual(after.worldState.events, [{ ...timedEvent(), desc: 'The clue leads outside.', endTime: '12:45 PM' }]);
    assert.deepEqual(before.worldState.events, [timedEvent()], 'Applying a patch must not mutate its input');
    assert.equal(applyLLMPatch(after, { World: { events: [{ name: 'Discovery', desc: 'Details corrected.' }] } })
        .worldState.events[0].endTime, '12:45 PM');
});

test('a timestamp-only event patch preserves its logged description and accepts explicit description edits', () => {
    const before = tracker([timedEvent()]);
    const patch = parseMessageScanPatch(JSON.stringify({ World: { events: [{ name: 'Discovery', endTime: '12:45 PM' }] } }), before);
    const after = applyLLMPatch(before, patch);
    assert.deepEqual(after.worldState.events, [{ ...timedEvent(), endTime: '12:45 PM' }]);
    const updated = applyLLMPatch(after, { World: { events: [{ name: 'Discovery', desc: 'More details.' }] } });
    assert.equal(updated.worldState.events[0].desc, 'More details.');
    assert.equal(applyLLMPatch(updated, { World: { events: [{ name: 'Discovery', desc: '' }] } }).worldState.events[0].desc, '');
});

test('partial story timing can fill unknown components and cross midnight without calendar coercion', () => {
    const before = tracker([{ id: 'event_Vigil', name: 'Vigil', desc: 'Waiting.', startDate: 'Frostfall 30, Year 8' }]);
    const after = applyLLMPatch(before, { World: { events: [{ name: 'Vigil', desc: 'Waiting until dawn.',
        startTime: 'Late evening', endDate: 'Frostfall 31, Year 8', endTime: 'Dawn' }] } });
    assert.deepEqual(getWorldEventTiming(after.worldState.events[0]), {
        startDate: 'Frostfall 30, Year 8', startTime: 'Late evening', endDate: 'Frostfall 31, Year 8', endTime: 'Dawn',
    });
});

test('blank, unknown, placeholder and malformed model timestamps cannot erase known timing', () => {
    const before = tracker([timedEvent()]);
    for (const invalid of ['', ' ', 'unknown', 'N/A', '<new_value (optional date)>', null, 123, true, [], {}]) {
        const after = applyLLMPatch(before, { World: { events: [{ name: 'Discovery', desc: 'A new clue.',
            startDate: invalid, startTime: invalid, endDate: invalid, endTime: invalid }] } });
        assert.deepEqual(getWorldEventTiming(after.worldState.events[0]), getWorldEventTiming(timedEvent()));
    }
});

test('advancing World date and time never stamps old or newly undated events', () => {
    const before = tracker([{ id: 'event_Old', name: 'Old', desc: 'Past.' }, timedEvent()]);
    const after = applyLLMPatch(before, { World: { date: '2030-01-01', time: '23:59', events: [
        { name: 'Old', desc: 'Past details.' }, { name: 'New', desc: 'Undated.' },
    ] } });
    assert.equal(after.worldState.date, '2030-01-01');
    assert.deepEqual(getWorldEventTiming(after.worldState.events[0]), {});
    assert.deepEqual(after.worldState.events[1], timedEvent());
    assert.deepEqual(getWorldEventTiming(after.worldState.events[2]), {});
});

test('update and readonly prompt references retain event time independently from current World time', () => {
    const data = tracker([timedEvent(), { id: 'old', name: 'Old', desc: 'No time known.' }]);
    for (const build of [buildDynamicValuesPrompt, buildCleanStatusPrompt]) {
        const world = promptJson(build(data)).World;
        assert.equal(world.date, '2026-01-01');
        assert.deepEqual(world.events[0], { name: 'Discovery', desc: 'A new clue.', ...getWorldEventTiming(timedEvent()) });
        assert.deepEqual(world.events[1], { name: 'Old', desc: 'No time known.' });
    }
    data.guidePrompts = [{ id: 'world_events', enabled: false, prompt: 'Disabled' }];
    assert.equal(promptJson(buildCleanStatusPrompt(data)).World.events, undefined);
});

test('runtime timing instructions reach existing custom guides and every update schema', () => {
    const data = tracker([]);
    data.guidePrompts = [{ id: 'world_events', enabled: true, prompt: 'Keep my custom event guide.' }];
    const schemaEvent = promptJson(getDynamicSchemaExample(data)).World.events[0];
    for (const key of ['startDate', 'startTime', 'endDate', 'endTime']) assert(key in schemaEvent);
    for (const build of [buildGuidePromptsSection, buildUpdatePromptWrapper, buildDefinitionPromptWrapper]) {
        const prompt = build(data);
        assert.match(prompt, /Keep my custom event guide/);
        assert.match(prompt, /IN THE STORY/);
        assert.match(prompt, /Never use the real-world clock/);
        assert.match(prompt, /omit unknown components/);
    }
    data.guidePrompts[0].enabled = false;
    assert(!buildGuidePromptsSection(data).includes('World event timestamps'));
});

test('selected-reply scan accepts partial event timestamps and carries explicit source restrictions', () => {
    const data = tracker([timedEvent()]);
    const patch = parseMessageScanPatch(JSON.stringify({ World: { events: [{ name: 'Crossing', desc: 'At the gate.',
        StartDate: '2025-12-18', startTime: '01:30', endDate: null, endTime: 'unknown' }] } }), data);
    assert.deepEqual(patch.World.events, [{ name: 'Crossing', desc: 'At the gate.', startDate: '2025-12-18', startTime: '01:30' }]);
    const after = applyLLMPatch(data, patch);
    assert.equal(after.worldState.events[1].startDate, '2025-12-18');
    const prompt = buildMessageScanPrompt('At 01:30 on 2025-12-18 they reached the gate.', data);
    assert.match(prompt, /timestamp evidence must come from selected_reply, not tracker_reference/);
    assert.match(prompt, /endDate and endTime/);
    assert.match(prompt, /2025-12-17/);
});

test('accepted delta replay, timeline restoration and manual snapshots retain event timing', () => {
    const before = tracker([timedEvent()]);
    const after = applyLLMPatch(before, { World: { events: [{ name: 'Discovery', desc: 'Continued next day.',
        endDate: '2025-12-18', endTime: '09:00' }] } });
    const delta = getAppliedDelta(before, after);
    assert.equal(delta.World.events[0].startTime, '10:02 AM');
    assert.deepEqual(applyLLMPatch(before, delta), after);
    const chat = [{ mes: 'Story beat', swipe_id: 0 }];
    backupToMessage(chat, 0, after);
    assert.deepEqual(rehydrateFromHistory(chat).worldState.events, after.worldState.events);
    const snapshot = buildSnapshotPayload(after, { world: { selected: true, events: true }, chars: {} });
    assert.deepEqual(snapshot.world.events, after.worldState.events);
});
