const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let buildMessageScanPrompt, parseMessageScanPatch, extractEmbeddedScanPatch, stripMessageScanMarkup;
let applyLLMPatch, generateSnapshotTag;
test.before(async () => {
    ({ buildMessageScanPrompt, parseMessageScanPatch, extractEmbeddedScanPatch, stripMessageScanMarkup } = await loadEsm('src/core/MessageScanInput.js'));
    ({ applyLLMPatch } = await loadEsm('src/core/JSONTracker_Patcher.js'));
    ({ generateSnapshotTag } = await loadEsm('src/messagetracker/SnapshotCore.js'));
});
const tracker = () => ({
    characters: [{ id: 'persisted-id', name: 'Ada Vale', activePlayer: true,
        statusSchema: [{ id: 'HP', name: 'HP', type: 'integer', min: 0, max: 100, isLocked: true }],
        status: { HP: 80 }, profile: { Race: 'Human' }, profileLocks: { Race: true },
        inventory: {}, quests: {}, relations: {},
    }], worldState: {},
});

function parse(value, data = tracker(), options) {
    return parseMessageScanPatch(JSON.stringify(value), data, options);
}

test('scan prompt contains selected text and identity reference but strips manual snapshots and recaps', () => {
    const text = 'Mira is an elf. <rpgmt>{"manual-only":"HP 999"}</rpgmt> <!--RPG_DELTA:{"prior":"Race Goblin"}-->';
    const prompt = buildMessageScanPrompt(text, tracker());
    assert(prompt.includes('Mira is an elf.'));
    assert(prompt.includes('persisted-id'));
    assert(!prompt.includes('manual-only'));
    assert(!prompt.includes('HP 999'));
    assert(!prompt.includes('Race Goblin'));
    const input = JSON.parse(prompt.slice(prompt.indexOf('Input JSON:\n') + 'Input JSON:\n'.length));
    assert.equal(input.selected_reply, 'Mira is an elf.');
    assert.deepEqual(Object.keys(input), ['tracker_reference', 'selected_reply']);
    assert.match(prompt, /ONLY from selected_reply/);
    assert.match(prompt, /absolute resulting values/);
});

test('encoded, repeated and unfinished manual snapshots cannot become extraction source', () => {
    const text = 'A &lt;rpgmt&gt;hidden one&lt;/rpgmt&gt; B <RPGMT>hidden two</RPGMT> C <rpgmt>hidden tail';
    assert.equal(stripMessageScanMarkup(text), 'A  B  C');
    assert.throws(() => buildMessageScanPrompt('<rpgmt>{"HP":99}</rpgmt>', tracker()), /no text to scan/);
});

test('native manual snapshot edits and legacy wrappers cannot change the scan fingerprint', () => {
    const reply = 'Mira is an elf.';
    const before = `${reply} <rpgmt>{"note":"first"}</rpgmt>`;
    const edited = reply + generateSnapshotTag({ note: 'edited', chars: { Mira: { profile: { Race: 'Human' } } } });
    assert.equal(stripMessageScanMarkup(before), reply);
    assert.equal(stripMessageScanMarkup(edited), reply);
    assert.equal(stripMessageScanMarkup(generateSnapshotTag({ note: 'manual-only' })), '');
    assert.equal(stripMessageScanMarkup(`${reply} <!-- <div class="rpgmt-data">{"note":"legacy"}</div> -->`), reply);
    assert.equal(stripMessageScanMarkup(`${reply} <div class='rpgmt-data'>{"note":"legacy"}</div>`), reply);
    assert.equal(stripMessageScanMarkup(`${reply} &lt;!-- &lt;rpgmt&gt;{"note":"encoded"}&lt;/rpgmt&gt; --&gt;`), reply);
    assert.equal(extractEmbeddedScanPatch('<div class="rpgmt-data"><!--RPG_TRACKER {"Mira":{"profile":{"Race":"Elf"}}}--></div>', tracker()), null);
});

test('embedded extraction accepts only an explicit tracker block, preserving ordinary JSON and manual editor payloads', () => {
    assert.equal(extractEmbeddedScanPatch('```json\n{"Ada Vale":{"profile":{"Race":"Elf"}}}\n```', tracker()), null);
    assert.equal(extractEmbeddedScanPatch('<rpgmt><!--RPG_TRACKER {"Ada Vale":{"profile":{"Race":"Elf"}}}--></rpgmt>', tracker()), null);
    const result = extractEmbeddedScanPatch('Story. <!--RPG_TRACKER\n```json\n{"Ada Vale":{"profile":{"Height":"180 cm"}}}\n```\n-->', tracker());
    assert.deepEqual(result, { 'Ada Vale': { profile: { Height: '180 cm' } } });
});

test('model output must contain complete JSON and meaningful tracker categories', () => {
    for (const value of ['{"Ada Vale":{"status":{"HP":20}', 'Not JSON', '[{"name":"Ada Vale"}]', '{"metadata":{"foo":"bar"}}', '{"Ada Vale":{"status":"HP 20"}}']) {
        assert.throws(() => parseMessageScanPatch(value, tracker()), /Could not read tracker data/);
    }
    assert.deepEqual(parseMessageScanPatch('```json\n{}\n```', tracker()), {});
    assert.deepEqual(parse({ characters: [] }), {});
    assert.throws(() => parse({}, tracker(), { allowEmpty: false }), /No supported/);
});

test('exact IDs and normalized names resolve to existing characters without renaming or changing role', () => {
    assert.deepEqual(parse({ characters: [{ id: 'persisted-id', name: 'A renamed identity', activePlayer: false, profile: { Height: '180 cm' } }] }),
        { 'Ada Vale': { profile: { Height: '180 cm' } } });
    assert.deepEqual(parse({ ' ADA   VALE ': { stats: { HP: 30 } } }), { 'Ada Vale': { status: { HP: 30 } } });
    assert.deepEqual(parse({ 'persisted-id': { profile: { Height: '180 cm' } } }), { 'Ada Vale': { profile: { Height: '180 cm' } } });
    assert.throws(() => parse({ 'Ada Vale': { profile: { Race: 'Elf' } } }, { characters: [{ id: 'a', name: 'Ada Vale' }, { id: 'b', name: 'ada vale' }] }), /ambiguous/);
    assert.throws(() => parse({ characters: [{ id: 'persisted-id', name: 'Ada', profile: { A: 'x' } }, { name: 'Ada Vale', profile: { B: 'y' } }] }), /duplicate/);
});

test('prototype and control metadata are discarded while supported nested values remain', () => {
    const text = '{"__proto__":{"polluted":true},"Ada Vale":{"id":"persisted-id","activePlayer":false,"profileLocks":{"Race":false},"statusSchema":[],"delete":true,"profile":{"constructor":"bad","Race":"Elf"},"relations":{"Mira":{"isLocked":false,"description":"Friend","metrics":{"Trust":3,"__proto__":9}}}}}';
    const result = parseMessageScanPatch(text, tracker());
    assert.deepEqual(result, { 'Ada Vale': { profile: { Race: 'Elf' }, relations: { Mira: { description: 'Friend', metrics: { Trust: 3 } } } } });
    assert.equal({}.polluted, undefined);
});

test('new scan names cannot update a different character through a generated ID collision', () => {
    const current = tracker();
    current.characters[0].id = 'char_A_B';
    current.characters[0].name = 'A B';
    assert.throws(() => parse({ 'A-B': { profile: { Race: 'Elf' } } }, current), /conflicts with another character's saved ID/);
    assert.equal(current.characters[0].profile.Race, 'Human');
    assert.equal(current.characters.length, 1);
});

test('an exact name or ID cannot bypass a conflicting legacy patcher identity', () => {
    const current = { characters: [
        { id: 'char_Ada_Vale', name: 'Mira' },
        { id: 'ada-persisted-id', name: 'Ada Vale' },
    ] };
    for (const name of ['Ada Vale', 'ada-persisted-id']) {
        assert.throws(() => parse({ [name]: { profile: { Race: 'Elf' } } }, current), /conflicts with another character's saved ID/);
    }
    assert.throws(() => parse({ 'first-id': { profile: { Race: 'Elf' } } }, { characters: [
        { id: 'first-id', name: 'Ada Vale' }, { id: 'second-id', name: 'ADA VALE' },
    ] }), /ambiguous/);
});

test('multiple additions cannot collide with each other or normalize to the same new name', () => {
    assert.throws(() => parse({ 'A-B': { profile: { Race: 'Elf' } }, 'A B': { profile: { Race: 'Human' } } }), /conflicts with another character's saved ID/);
    assert.throws(() => parse({ Mira: { profile: { Race: 'Elf' } }, MIRA: { profile: { Race: 'Human' } } }), /duplicate/);
    const current = tracker();
    const patch = parse({ 'New Mira': { profile: { Race: 'Elf' } }, Bela: { profile: { Race: 'Human' } } }, current);
    const updated = applyLLMPatch(current, patch);
    assert.deepEqual(updated.characters.map(char => char.name), ['Ada Vale', 'New Mira', 'Bela']);
    assert.equal(updated.characters[0].id, 'persisted-id');
});

test('validated additions use existing patcher with typed stats and locks still enforced', () => {
    const current = tracker();
    const patch = parse({
        'Ada Vale': { status: { HP: 10 }, profile: { Race: 'Elf', Height: '180 cm' } },
        Mira: { status: { Mana: '25 (type: consumable, min: 0, max: 50)' }, profile: { Race: 'Elf' } },
    });
    const updated = applyLLMPatch(current, patch);
    assert.equal(updated.characters.length, 2);
    assert.equal(updated.characters[0].id, 'persisted-id');
    assert.equal(updated.characters[0].activePlayer, true);
    assert.equal(updated.characters[0].status.HP, 80);
    assert.equal(updated.characters[0].profile.Race, 'Human');
    assert.equal(updated.characters[0].profile.Height, '180 cm');
    const added = updated.characters[1];
    assert.equal(added.name, 'Mira');
    assert.equal(added.profile.Race, 'Elf');
    const mana = added.statusSchema.find(field => field.name === 'Mana');
    assert.equal(mana.type, 'consumable');
    assert.equal(mana.max, 50);
    assert.equal(added.status[mana.id], 25);
});

test('structured inventory, quests, relations and world data retain supported fields only', () => {
    const patch = parse({
        'Ada Vale': {
            inventory: { equipIsLocked: false, equipment: { Hand: { id: 'rogue-id', name: 'Sword', quantity: 1 } }, storage: { Bag: ['Potion'] } },
            quests: { main: { name: 'Guard', isLocked: false, status: 'ACTIVE' }, sideQuests: [{ name: 'Rescue', isCompleted: true }] },
            relations: { Mira: { text: 'Friend', targetText: 'Trusts Ada', values: { Trust: 4 } } },
        },
        World: { weather: 'Rain', events: [{ name: 'Storm', description: 'Rain begins', id: 'ignored' }] },
    });
    assert.deepEqual(patch['Ada Vale'].inventory.equipment.Hand, { name: 'Sword', quantity: 1 });
    assert.deepEqual(patch['Ada Vale'].quests.main, { name: 'Guard', status: 'ACTIVE' });
    assert.equal(patch['Ada Vale'].relations.Mira.targetDescription, 'Trusts Ada');
    assert.deepEqual(patch.World.events, [{ name: 'Storm', desc: 'Rain begins' }]);
    assert.throws(() => parse({ Ada: { inventory: { storage: { Bag: 'unknown' } } } }), /item list/);
    assert.throws(() => parse({ Ada: { status: { HP: { add: 3 } } } }), /not nested data/);
});
