const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let getAppliedDelta, applyLLMPatch, getInitialTrackerData, getDeltaLog, setDeltaLog, buildDeltaLogHtml;
test.before(async () => {
    ({ getAppliedDelta } = await loadEsm('src/core/AppliedDelta.js'));
    ({ applyLLMPatch } = await loadEsm('src/core/JSONTracker_Patcher.js'));
    ({ getInitialTrackerData } = await loadEsm('src/core/PromptSchema.js'));
    ({ getDeltaLog, setDeltaLog, buildDeltaLogHtml } = await loadEsm('src/tracker/DeltaLogRenderer.js'));
});

function fixture() {
    const tracker = getInitialTrackerData();
    const character = tracker.characters[0];
    character.id = 'audit-character';
    character.name = 'Audit';
    character.status.HP = 70;
    character.profile.Height = '200 cm';
    character.profileLocks.Height = true;
    character.relations = {};
    tracker.worldState.weather = 'Clear';
    tracker.worldStateLocks.weather = true;
    return tracker;
}

test('recap excludes rejected and unchanged updates and reports the clamped value', () => {
    const before = fixture();
    const proposed = {
        Audit: { Status: { HP: 999 }, Profile: { Height: '180 cm' } },
        World: { Weather: 'Rain' },
    };
    const after = applyLLMPatch(before, proposed);
    const delta = getAppliedDelta(before, after, proposed);
    assert.deepEqual(delta, { Audit: { status: { HP: 100 } } });
    const replayed = applyLLMPatch(before, delta);
    assert.equal(replayed.characters[0].status.HP, 100);
    assert.equal(replayed.characters[0].profile.Height, '200 cm');
    assert.equal(replayed.worldState.weather, 'Clear');
    assert.deepEqual(getAppliedDelta(after, after, proposed), {});
});

test('new status fields retain their schema type and limits during delta replay', () => {
    const before = fixture();
    const after = applyLLMPatch(before, {
        Audit: { status: { Mana: '25 (type: consumable, min: 0, max: 50)' } },
    });
    const delta = getAppliedDelta(before, after);
    const replayed = applyLLMPatch(before, delta);
    const schema = replayed.characters[0].statusSchema.find(item => item.name === 'Mana');
    assert.equal(schema.type, 'consumable');
    assert.equal(schema.max, 50);
    assert.equal(replayed.characters[0].status[schema.id], 25);
});

test('inventory recap includes accepted empty slots and container replacements only', () => {
    const before = fixture();
    const inventory = before.characters[0].inventory;
    inventory.equipment['Right Hand'] = { id: 'sword', name: 'Sword', type: 'general', desc: '', quantity: 1 };
    inventory.equipment['Left Hand'] = { id: 'shield', name: 'Shield', type: 'general', desc: '', quantity: 1 };
    inventory.equipmentLocks['Right Hand'] = true;
    inventory.storage.Backpack = [{ id: 'potion', name: 'Potion', type: 'general', desc: '', quantity: 2 }];
    const after = applyLLMPatch(before, {
        Audit: { inventory: { equipment: { 'Right Hand': 'Axe', 'Left Hand': 'Empty' }, storage: { Backpack: [] } } },
    });
    const delta = getAppliedDelta(before, after);
    assert.deepEqual(delta.Audit.inventory, { equipment: { 'Left Hand': null }, storage: { Backpack: [] } });
    assert.deepEqual(applyLLMPatch(before, delta).characters[0].inventory, after.characters[0].inventory);
});

test('quest and relation recaps omit locked entries and replay actual metric limits', () => {
    const before = fixture();
    const character = before.characters[0];
    character.quests.main = { name: 'Guard', desc: 'Keep watch', isLocked: true, isCompleted: false };
    character.quests.sides = [
        { id: 'quest_Locked', name: 'Locked', desc: 'Keep', isLocked: true, isCompleted: false },
        { id: 'quest_Open', name: 'Open', desc: 'Begin', isLocked: false, isCompleted: false },
    ];
    character.relations = {
        Ally: { text: 'Friend', isLocked: false, values: { Trust: { value: 2, type: 'integer', min: 0, max: 10 } } },
        Rival: { text: 'Fixed', isLocked: true, values: {} },
    };
    const after = applyLLMPatch(before, {
        Audit: {
            quests: { main: { name: 'Changed' }, sideQuests: [
                { name: 'Locked', description: 'Overwritten', status: 'COMPLETED' },
                { name: 'Open', description: 'Finished', status: 'COMPLETED' },
            ] },
            relations: { Ally: { metrics: { Trust: 900 } }, Rival: { description: 'Changed' } },
        },
    });
    const delta = getAppliedDelta(before, after);
    assert.equal(delta.Audit.quests.main, undefined);
    assert.deepEqual(delta.Audit.quests.sideQuests, [{ name: 'Open', desc: 'Finished', isCompleted: true }]);
    assert.deepEqual(delta.Audit.relations, { Ally: { metrics: { Trust: 10 } } });
    const replayed = applyLLMPatch(before, delta);
    assert.deepEqual(replayed.characters[0].quests, after.characters[0].quests);
    assert.deepEqual(replayed.characters[0].relations, after.characters[0].relations);
});

test('world recap reports only changed events and supports clearing a field', () => {
    const before = fixture();
    before.worldState.location = 'Town';
    before.worldState.events = [{ id: 'event_Festival', name: 'Festival', desc: 'Starts' }];
    const after = applyLLMPatch(before, { World: { location: '', events: [{ name: 'Festival', desc: 'Ends' }] } });
    const delta = getAppliedDelta(before, after);
    assert.deepEqual(delta.World, { location: '', events: [{ id: 'event_Festival', name: 'Festival', desc: 'Ends' }] });
    assert.deepEqual(applyLLMPatch(before, delta).worldState, after.worldState);
    assert.match(buildDeltaLogHtml(delta), /Location:/);
});

test('an empty accepted delta overrides old inline and message-level recaps', () => {
    const rejected = { Audit: { profile: { Height: '180 cm' } } };
    const msg = { mes: `response <!--RPG_DELTA:${JSON.stringify(rejected)}-->`, extra: { rpgTrackerDelta: rejected } };
    setDeltaLog(msg, {});
    assert.deepEqual(getDeltaLog(msg), {});
    assert.deepEqual(msg.swipe_info[0].extra.rpgTrackerDelta, {});
});

test('a selected swipe never borrows the previous swipe recap', () => {
    const delta = { Audit: { status: { HP: 20 } } };
    const msg = {
        mes: 'new', swipes: ['old', 'new'], swipe_id: 1,
        swipe_info: [{ extra: { rpgTrackerDelta: delta } }, { extra: {} }],
        extra: { rpgTrackerDelta: delta },
    };
    assert.equal(getDeltaLog(msg), null);
    setDeltaLog(msg, {});
    assert.deepEqual(getDeltaLog(msg), {});
    msg.mes = 'old';
    msg.swipe_id = 0;
    assert.deepEqual(getDeltaLog(msg), delta);
});

test('a new character role replays without creating a bogus activePlayer stat', () => {
    const before = fixture();
    const after = applyLLMPatch(before, { Visitor: { activePlayer: false, status: {} } });
    const delta = getAppliedDelta(before, after);
    const replayed = applyLLMPatch(before, delta);
    const visitor = replayed.characters.find(character => character.name === 'Visitor');
    assert(visitor);
    assert.equal(visitor.activePlayer, false);
    assert.equal(visitor.statusSchema.some(schema => schema.name === 'activePlayer'), false);
});
