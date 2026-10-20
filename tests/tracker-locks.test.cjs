const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

const loaded = Promise.all([
    loadEsm('src/core/TrackerLocks.js'),
    loadEsm('src/core/JSONTracker_Patcher.js'),
    loadEsm('src/core/JSONTracker_Migrator.js'),
]);
const copy = value => JSON.parse(JSON.stringify(value));

function fixture() {
    return {
        worldState: { weather: 'Clear', location: 'Town', events: [] },
        worldStateLocks: { weather: true, location: false },
        characters: [{
            id: 'stable-player', name: 'Player', activeInjection: true,
            statusSchema: [
                { id: 'hp-id', name: 'HP', type: 'integer', min: 0, max: 100, isLocked: true, color: '#123456' },
                { id: 'condition-id', name: 'Condition', type: 'text', isLocked: true },
                { id: 'mp-id', name: 'MP', type: 'integer', min: 0, max: 100, isLocked: false },
            ],
            status: { 'hp-id': 80, 'condition-id': 'Healthy', 'mp-id': 30 },
            profile: { Height: '200 cm', Race: 'Human' },
            profileLocks: { Height: true, Race: false },
            profileInjects: { Height: false },
            inventory: {
                equipIsLocked: false, storageIsLocked: false,
                equipmentLocks: { Hand: true }, storageLocks: { Backpack: true },
                equipment: { Hand: { name: 'Sword' }, Head: { name: 'Hat' } },
                storage: { Backpack: [{ name: 'Potion', quantity: 3 }], Pouch: [] },
            },
            quests: {
                main: { name: 'Rescue', isCompleted: false, isLocked: true },
                sides: [
                    { id: 'quest-1', name: 'Gather', desc: 'Keep this', isLocked: true },
                    { id: 'quest-2', name: 'Explore', isLocked: false },
                ],
            },
            relations: {
                Friend: { text: 'Trusted', targetText: 'Loyal', values: { Trust: 10 }, targetValues: { Trust: 8 }, isLocked: true },
            },
        }],
    };
}

test('swipe restoration preserves protected values but allows unlocked history values', async () => {
    const [{ captureLocks, applyLocks }] = await loaded;
    const current = fixture();
    const historical = fixture();
    historical.worldState = { weather: 'Rain', location: 'Forest' };
    const char = historical.characters[0];
    char.status = { 'hp-id': 5, 'condition-id': 'Injured', 'mp-id': 15 };
    char.profile = { Height: '180 cm', Race: 'Elf' };
    char.inventory.equipment = { Hand: null, Head: { name: 'Crown' } };
    char.inventory.storage = { Backpack: [], Pouch: [{ name: 'Coin' }] };
    char.quests.main = { name: 'Old quest', isLocked: false };
    char.quests.sides = [{ id: 'quest-2', name: 'Older explore', isLocked: true }];
    char.relations.Friend = { text: 'Hostile', targetText: 'Enemy', isLocked: false };
    const originalHistorical = copy(historical);
    const state = captureLocks(current);
    const originalState = copy(state);
    const restored = applyLocks(historical, state);
    const result = restored.characters[0];
    assert.equal(restored.worldState.weather, 'Clear');
    assert.equal(restored.worldState.location, 'Forest');
    assert.deepEqual(result.status, { 'hp-id': 80, 'condition-id': 'Healthy', 'mp-id': 15 });
    assert.deepEqual(result.profile, { Height: '200 cm', Race: 'Elf' });
    assert.equal(result.profileLocks.Height, true);
    assert.equal(result.inventory.equipment.Hand.name, 'Sword');
    assert.equal(result.inventory.equipment.Head.name, 'Crown');
    assert.equal(result.inventory.storage.Backpack[0].quantity, 3);
    assert.equal(result.inventory.storage.Pouch[0].name, 'Coin');
    assert.equal(result.quests.main.name, 'Rescue');
    assert.equal(result.quests.sides.find(q => q.id === 'quest-1').desc, 'Keep this');
    assert.equal(result.quests.sides.find(q => q.id === 'quest-2').name, 'Older explore');
    assert.equal(result.quests.sides.find(q => q.id === 'quest-2').isLocked, false);
    assert.deepEqual(result.relations.Friend, current.characters[0].relations.Friend);
    assert.deepEqual(historical, originalHistorical);
    assert.deepEqual(copy(state), originalState);
});

test('explicit unlocks survive old locked snapshots and capture stores no unlocked values', async () => {
    const [{ captureLocks, applyLocks }] = await loaded;
    const current = fixture();
    current.worldStateLocks.weather = false;
    current.characters[0].profileLocks.Height = false;
    current.characters[0].statusSchema[0].isLocked = false;
    const state = captureLocks(current);
    assert.equal(Object.hasOwn(state.world.values, 'weather'), false);
    assert.equal(Object.hasOwn(state.characters['stable-player'].profile.values, 'Height'), false);
    assert.equal(Object.hasOwn(state.characters['stable-player'].status['hp-id'], 'value'), false);
    const restored = applyLocks(fixture(), state);
    assert.equal(restored.worldStateLocks.weather, false);
    assert.equal(restored.characters[0].profileLocks.Height, false);
    assert.equal(restored.characters[0].statusSchema[0].isLocked, false);
});

test('missing historical character restores only protected data, and reorder uses IDs', async () => {
    const [{ captureLocks, applyLocks }] = await loaded;
    const current = fixture();
    const state = captureLocks(current);
    const candidate = { characters: [{ id: 'other-player', name: 'Other', profile: { Race: 'Orc' } }] };
    const restored = applyLocks(candidate, state);
    assert.equal(restored.characters[0].profile.Race, 'Orc');
    const char = restored.characters[1];
    assert.equal(char.id, 'stable-player');
    assert.equal(char.profile.Height, '200 cm');
    assert.equal(char.profile.Race, undefined);
    assert.equal(char.status['mp-id'], undefined);
    assert.equal(char.inventory.equipment.Head, undefined);
    assert.equal(char.quests.sides.length, 1);
    assert.equal(char.quests.sides[0].id, 'quest-1');
});

test('whole inventory locks prevent additions and retain empty locked containers', async () => {
    const [{ captureLocks, applyLocks }] = await loaded;
    const current = fixture();
    current.characters[0].inventory.equipIsLocked = true;
    current.characters[0].inventory.storageIsLocked = true;
    current.characters[0].inventory.storage = {};
    const historical = fixture();
    historical.characters[0].inventory.equipment.Feet = { name: 'Boots' };
    const result = applyLocks(historical, captureLocks(current)).characters[0];
    assert.deepEqual(result.inventory.equipment, current.characters[0].inventory.equipment);
    assert.deepEqual(result.inventory.storage, {});
});

test('AI patches respect numeric and text locks while applying unlocked values', async () => {
    const [, { applyLLMPatch }] = await loaded;
    const current = fixture();
    const result = applyLLMPatch(current, {
        Player: { Status: { HP: 1, Condition: 'Poisoned', MP: 10 }, Profile: { Height: '175 cm', Race: 'Elf' } },
        World: { Weather: 'Rain', Location: 'Forest' },
    });
    assert.equal(result.characters[0].id, 'stable-player');
    assert.deepEqual(result.characters[0].status, { 'hp-id': 80, 'condition-id': 'Healthy', 'mp-id': 10 });
    assert.equal(result.characters[0].profile.Height, '200 cm');
    assert.equal(result.characters[0].profile.Race, 'Elf');
    assert.equal(result.worldState.weather, 'Clear');
    assert.equal(result.worldState.location, 'Forest');
    assert.equal(current.characters[0].status['mp-id'], 30);
});

test('replacement patches retain omitted locked status fields and their schema', async () => {
    const [, { applyLLMPatch }] = await loaded;
    const current = fixture();
    const result = applyLLMPatch(current, { Player: { Status: { HP: 1, MP: 12 } } }, false, 'replace');
    assert.equal(result.characters[0].status['hp-id'], 80);
    assert.equal(result.characters[0].status['condition-id'], 'Healthy');
    assert.equal(result.characters[0].status['mp-id'], 12);
    assert.deepEqual(result.characters[0].statusSchema.find(s => s.id === 'hp-id'), current.characters[0].statusSchema[0]);
});

test('AI inventory and quest updates preserve locked entries and update unlocked neighbors', async () => {
    const [, { applyLLMPatch }] = await loaded;
    const current = fixture();
    const result = applyLLMPatch(current, {
        Player: {
            Inventory: {
                Equipment: { Hand: 'Empty', Head: { Name: 'Helmet' } },
                Storage: { Backpack: [], Pouch: [{ Name: 'Coin', Quantity: 2 }] },
            },
            Quests: {
                Main: { Name: 'Changed', Status: 'COMPLETED' },
                Sides: [
                    { Name: 'Gather', Description: 'Changed', Status: 'COMPLETED' },
                    { Name: 'Explore', Description: 'New destination', Status: 'COMPLETED' },
                ],
            },
        },
    });
    const char = result.characters[0];
    assert.deepEqual(char.inventory.equipment.Hand, current.characters[0].inventory.equipment.Hand);
    assert.equal(char.inventory.equipment.Head.name, 'Helmet');
    assert.deepEqual(char.inventory.storage.Backpack, current.characters[0].inventory.storage.Backpack);
    assert.equal(char.inventory.storage.Pouch[0].quantity, 2);
    assert.deepEqual(char.quests.main, current.characters[0].quests.main);
    assert.deepEqual(char.quests.sides[0], current.characters[0].quests.sides[0]);
    assert.equal(char.quests.sides[1].desc, 'New destination');
    assert.equal(char.quests.sides[1].isCompleted, true);
});

test('reciprocal relation updates do not overwrite a locked receiving relation', async () => {
    const [, { applyLLMPatch }] = await loaded;
    const current = fixture();
    current.characters.push({
        id: 'friend-id', name: 'Friend', statusSchema: [], status: {},
        relations: { Player: { text: 'New feeling', values: { Trust: 99 }, isLocked: false } },
    });
    const result = applyLLMPatch(current, { Friend: { Relations: { Player: { Description: 'Changed' } } } });
    assert.deepEqual(result.characters[0].relations.Friend, current.characters[0].relations.Friend);
    assert.equal(result.characters[1].relations.Player.text, 'Changed');
});

test('sanitizing renamed characters/fields keeps stable IDs and legacy status mappings', async () => {
    const [, , { sanitizeTrackerData }] = await loaded;
    const current = fixture();
    current.characters[0].name = 'Renamed Player';
    current.characters[0].statusSchema[0].name = 'Health Points';
    current.characters[0].status = { 'stat_health points': 88, 'condition-id': 'Healthy', 'mp-id': 2 };
    current.globalDefinitions = { 'stat_Health_Points': 'Health guide' };
    const result = sanitizeTrackerData(current);
    assert.equal(result.characters[0].id, 'stable-player');
    assert.equal(result.characters[0].statusSchema[0].id, 'hp-id');
    assert.equal(result.characters[0].status['hp-id'], 88);
    assert.equal(result.globalDefinitions['status_hp-id'], 'Health guide');
});
