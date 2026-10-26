const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

const loaded = Promise.all([
    loadEsm('src/core/MessageScanner.js'),
    loadEsm('src/core/MessageScanState.js'),
    loadEsm('src/core/TrackerLocks.js'),
]);
const copy = value => JSON.parse(JSON.stringify(value));
const patchText = patch => `<!--RPG_TRACKER ${JSON.stringify(patch)} -->`;
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function reply(text) {
    return { is_user: false, is_system: false, mes: text, swipe_id: 0,
        swipes: [text], swipe_info: [{ extra: {} }] };
}

function initialTracker() {
    return {
        worldState: { weather: 'Clear', location: 'Town', events: [] },
        worldStateLocks: { weather: true, location: false },
        characters: [{
            id: 'aster-stable-id', name: 'Aster', activePlayer: true, activeInjection: true,
            statusSchema: [
                { id: 'health-stable-id', name: 'HP', type: 'integer', min: 0, max: 100, isLocked: true },
                { id: 'mana-stable-id', name: 'MP', type: 'integer', min: 0, max: 100, isLocked: false },
            ],
            status: { 'health-stable-id': 80, 'mana-stable-id': 30 },
            profile: { Height: '200 cm', Race: 'Human' },
            profileLocks: { Height: true, Race: false }, profileInjects: {}, relations: {},
            inventory: { equipment: {}, storage: {} }, quests: { main: {}, sides: [] },
        }],
    };
}

async function setup(source = 'Aster has MP 45. Bela is an elf with HP 60.') {
    const [{ createMessageScanner }, { MESSAGE_SCAN_KEY }, { captureLocks, applyLocks }] = await loaded;
    const state = {
        context: {
            chatId: 'chat-A', characterId: 1, groupId: null, chatMetadata: {},
            chat: [{ is_user: true, mes: 'BEFORE_ONLY_SENTINEL' }, reply(source), reply('AFTER_ONLY_SENTINEL')],
        },
        output: patchText({ Aster: { status: { MP: 45 } } }),
        prompts: [], commits: [], generating: false, flushes: 0,
    };
    const bridge = {
        latestSettings: { enabled: true }, historyRevision: 0, scanRevision: 0,
        currentTrackerData: initialTracker(),
        flushSave() { state.flushes += 1; },
        applyChatLocks: tracker => applyLocks(tracker, state.locks),
    };
    state.locks = captureLocks(bridge.currentTrackerData);
    state.generate = async prompt => {
        state.prompts.push(prompt);
        return typeof state.output === 'function' ? state.output(prompt) : state.output;
    };
    state.commit = async transaction => {
        assert.equal(transaction.stillCurrent(), true, 'Only a current selection can reach persistence');
        const { target, updated, record } = transaction;
        target.message.swipe_info ??= [];
        target.message.swipe_info[target.swipeId] ??= { extra: {} };
        target.message.swipe_info[target.swipeId].extra ??= {};
        target.message.swipe_info[target.swipeId].extra[MESSAGE_SCAN_KEY] = copy(record);
        bridge.currentTrackerData = updated;
        state.commits.push(transaction);
    };
    const createScanner = () => createMessageScanner({
        getContext: () => state.context,
        getBridge: () => bridge,
        generate: prompt => state.generate(prompt),
        commit: transaction => state.commit(transaction),
        isGenerating: () => state.generating,
    });
    return { state, bridge, scanner: createScanner(), createScanner, captureLocks };
}

test('scan uses only the selected reply, preserves IDs/locks, and creates a supplied new character', async () => {
    const { scanner, state, bridge } = await setup();
    state.output = patchText({
        Aster: { status: { HP: 5, MP: 45 }, profile: { Height: '160 cm', Race: 'Elf' } },
        Bela: { status: { HP: '60 (type: integer, min: 0, max: 100)' }, profile: { Race: 'Elf' } },
        World: { weather: 'Rain', location: 'Forest' },
    });
    const result = await scanner.scanMessage(1);
    assert.equal(result.status, 'updated');
    assert.equal(state.prompts.length, 1);
    assert(state.prompts[0].includes(state.context.chat[1].mes));
    assert(!state.prompts[0].includes('BEFORE_ONLY_SENTINEL'));
    assert(!state.prompts[0].includes('AFTER_ONLY_SENTINEL'));
    assert.equal(state.flushes, 1);
    const aster = bridge.currentTrackerData.characters.find(char => char.name === 'Aster');
    assert.equal(aster.id, 'aster-stable-id');
    assert.deepEqual(copy(aster.status), { 'health-stable-id': 80, 'mana-stable-id': 45 });
    assert.equal(aster.statusSchema.find(field => field.name === 'MP').id, 'mana-stable-id');
    assert.equal(aster.profile.Height, '200 cm');
    assert.equal(aster.profileLocks.Height, true);
    assert.equal(aster.profile.Race, 'Elf');
    assert.equal(bridge.currentTrackerData.worldState.weather, 'Clear');
    assert.equal(bridge.currentTrackerData.worldState.location, 'Forest');
    const bela = bridge.currentTrackerData.characters.find(char => char.name === 'Bela');
    assert.equal(bela.profile.Race, 'Elf');
    assert.equal(bela.status[bela.statusSchema.find(field => field.name === 'HP').id], 60);
    const delta = state.commits[0].record.delta;
    assert.equal(delta.Aster.status.MP, 45);
    assert.equal(delta.Aster.status.HP, undefined, 'Rejected locked fields do not appear in the scan recap');
    assert.equal(delta.Aster.profile.Height, undefined);
});

test('an embedded tracker block updates directly without a model request', async () => {
    const text = `Aster is an elf. ${patchText({ Aster: { profile: { Race: 'Elf' } } })}`;
    const { scanner, state, bridge } = await setup(text);
    const result = await scanner.scanMessage(1);
    assert.equal(result.status, 'updated');
    assert.equal(state.prompts.length, 0);
    assert.equal(bridge.currentTrackerData.characters[0].profile.Race, 'Elf');
    assert.equal(state.context.chat[1].mes, text, 'The message and manual editing source remain unchanged');
});

test('manual snapshot and prior recap markup are excluded from scan input', async () => {
    const { scanner, state } = await setup('Aster is an elf. <rpgmt>{"SNAPSHOT_ONLY_SENTINEL":123}</rpgmt> <!--RPG_DELTA:{"RECAP_ONLY_SENTINEL":456}-->');
    state.output = '{}';
    const result = await scanner.scanMessage(1);
    assert.equal(result.status, 'no-changes');
    assert(!state.prompts[0].includes('SNAPSHOT_ONLY_SENTINEL'));
    assert(!state.prompts[0].includes('RECAP_ONLY_SENTINEL'));
    assert.equal(state.commits[0].record.sourceText, 'Aster is an elf.');
});

test('invalid or failed model responses remain retryable and cannot mark a reply scanned', async () => {
    const { scanner, state } = await setup();
    state.output = 'Not a valid tracker response';
    await assert.rejects(scanner.scanMessage(1), /complete, valid JSON/i);
    assert.equal(scanner.isMessageScanBusy(), false);
    assert.equal(state.commits.length, 0);
    state.output = () => { throw new Error('Provider unavailable'); };
    await assert.rejects(scanner.scanMessage(1), /Provider unavailable/);
    assert.equal(scanner.isMessageScanBusy(), false);
    assert.equal(state.commits.length, 0);
    state.output = patchText({ Aster: { status: { MP: 42 } } });
    assert.equal((await scanner.scanMessage(1)).status, 'updated');
    assert.equal(state.commits.length, 1);
    assert.equal(state.prompts.length, 3);
});

test('confirmed scan metadata prevents repeat application after a fresh scanner and persisted chat reload', async () => {
    const { scanner, createScanner, state, bridge } = await setup();
    await scanner.scanMessage(1);
    const savedTracker = copy(bridge.currentTrackerData);
    state.context = copy(state.context);
    bridge.currentTrackerData = copy(savedTracker);
    const reloaded = createScanner();
    assert.equal((await reloaded.scanMessage(1)).status, 'already-scanned');
    assert.equal(state.prompts.length, 1);
    assert.equal(state.commits.length, 1);
    assert.deepEqual(copy(bridge.currentTrackerData), savedTracker);
    state.context.chat[1].mes = 'Edited reply: Aster has MP 47.';
    state.context.chat[1].swipes[0] = state.context.chat[1].mes;
    state.output = patchText({ Aster: { status: { MP: 47 } } });
    assert.equal((await reloaded.scanMessage(1)).status, 'updated');
    assert.equal(state.prompts.length, 2, 'Changing reply content makes it eligible for a fresh scan');
});

test('identical text in distinct swipes uses the selected swipe ID and separate scan records', async () => {
    const { scanner, state } = await setup('Same reply text in both swipes.');
    const message = state.context.chat[1];
    message.swipes = [message.mes, message.mes];
    message.swipe_info = [{ extra: {} }, { extra: {} }];
    message.swipe_id = 1;
    await scanner.scanMessage(1);
    assert.equal(state.commits[0].target.swipeId, 1);
    assert.equal(message.swipe_info[0].extra.rpgTrackerScan, undefined);
    assert.equal(message.swipe_info[1].extra.rpgTrackerScan.version, 1);
    message.swipe_id = 0;
    assert.equal((await scanner.scanMessage(1)).status, 'no-changes');
    assert.equal(state.commits[1].target.swipeId, 0);
    assert.equal(state.prompts.length, 2);
    message.swipe_id = 1;
    assert.equal((await scanner.scanMessage(1)).status, 'already-scanned');
    assert.equal(state.prompts.length, 2);
});

test('late results are discarded when the source or current chat history changes', async t => {
    const changes = {
        'chat switch': ({ state }) => { state.context = { ...state.context, chatId: 'chat-B' }; },
        'selected swipe': ({ state }) => {
            const message = state.context.chat[1];
            message.swipes.push('Another swipe'); message.swipe_id = 1; message.mes = 'Another swipe';
        },
        'reply edit': ({ state }) => { state.context.chat[1].mes += ' Edited'; },
        'history rollback': ({ bridge }) => { bridge.historyRevision += 1; },
        'new generation revision': ({ bridge }) => { bridge.scanRevision += 1; },
        'new message': ({ state }) => { state.context.chat.push(reply('A newer reply')); },
        'tail swipe': ({ state }) => {
            const tail = state.context.chat.at(-1);
            tail.swipes.push('New tail swipe'); tail.swipe_id = 1; tail.mes = 'New tail swipe';
        },
        'extension disabled': ({ bridge }) => { bridge.latestSettings.enabled = false; },
    };
    for (const [name, change] of Object.entries(changes)) {
        await t.test(name, async () => {
            const fixture = await setup();
            const { scanner, state, bridge } = fixture;
            const before = copy(bridge.currentTrackerData);
            const request = deferred(); state.output = () => request.promise;
            const scanning = scanner.scanMessage(1);
            assert.equal(scanner.isMessageScanBusy(), true);
            change(fixture);
            request.resolve(patchText({ Aster: { status: { MP: 1 } } }));
            assert.equal((await scanning).status, 'cancelled');
            assert.equal(state.commits.length, 0);
            assert.deepEqual(copy(bridge.currentTrackerData), before);
            assert.equal(scanner.isMessageScanBusy(), false);
        });
    }
});

test('concurrent scan attempts are rejected, and a failed request releases the guard', async () => {
    const { scanner, state } = await setup();
    const request = deferred(); state.output = () => request.promise;
    const scanning = scanner.scanMessage(1);
    assert.equal(scanner.canScanMessage(2), false);
    await assert.rejects(scanner.scanMessage(2), /already being scanned/);
    assert.equal(state.prompts.length, 1);
    request.reject(new Error('Connection failed'));
    await assert.rejects(scanning, /Connection failed/);
    assert.equal(scanner.isMessageScanBusy(), false);
    state.output = '{}';
    assert.equal((await scanner.scanMessage(2)).status, 'no-changes');
});

test('locks enabled while extraction is pending protect the latest saved field value', async () => {
    const { scanner, state, bridge, captureLocks } = await setup();
    const request = deferred(); state.output = () => request.promise;
    const scanning = scanner.scanMessage(1);
    const char = bridge.currentTrackerData.characters[0];
    char.status['mana-stable-id'] = 70;
    char.statusSchema.find(field => field.id === 'mana-stable-id').isLocked = true;
    state.locks = captureLocks(bridge.currentTrackerData);
    request.resolve(patchText({ Aster: { status: { MP: 1 }, profile: { Race: 'Elf' } } }));
    assert.equal((await scanning).status, 'updated');
    const updated = bridge.currentTrackerData.characters[0];
    assert.equal(updated.status['mana-stable-id'], 70);
    assert.equal(updated.statusSchema.find(field => field.id === 'mana-stable-id').isLocked, true);
    assert.equal(updated.profile.Race, 'Elf');
    assert.equal(state.commits[0].record.delta.Aster.status, undefined);
});

test('valid empty output records a no-change scan without adding empty characters', async () => {
    const { scanner, state, bridge } = await setup();
    const before = copy(bridge.currentTrackerData);
    state.output = '{}';
    assert.equal((await scanner.scanMessage(1)).status, 'no-changes');
    assert.equal(bridge.currentTrackerData.characters.length, before.characters.length);
    assert.deepEqual(copy(state.commits[0].record.delta), {});
    assert.equal((await scanner.scanMessage(1)).status, 'already-scanned');
});

test('persistence failure is surfaced and leaves the source eligible for retry', async () => {
    const { scanner, state } = await setup();
    const save = state.commit;
    state.commit = async () => { throw new Error('Chat save failed'); };
    await assert.rejects(scanner.scanMessage(1), /Chat save failed/);
    assert.equal(scanner.isMessageScanBusy(), false);
    assert.equal(state.commits.length, 0);
    assert.equal(state.context.chat[1].swipe_info[0].extra.rpgTrackerScan, undefined);
    state.commit = save;
    assert.equal((await scanner.scanMessage(1)).status, 'updated');
    assert.equal(state.commits.length, 1);
});

test('scan recap merges accepted fields without losing the original generation recap', async () => {
    const [, { mergeScanDelta }] = await loaded;
    const generated = { Aster: { status: { HP: 80, MP: 30 }, profile: { Race: 'Human' } }, World: { weather: 'Clear' } };
    const scanned = JSON.parse('{"Aster":{"status":{"MP":45},"profile":{"Role":"Mage"}},"Bela":{"profile":{"Race":"Elf"}},"__proto__":{"polluted":true}}');
    const before = copy(generated);
    const merged = mergeScanDelta(generated, scanned);
    assert.deepEqual(copy(merged), {
        Aster: { status: { HP: 80, MP: 45 }, profile: { Race: 'Human', Role: 'Mage' } },
        World: { weather: 'Clear' }, Bela: { profile: { Race: 'Elf' } },
    });
    assert.deepEqual(generated, before);
    assert.equal(Object.hasOwn(merged, '__proto__'), false);
    assert.equal({}.polluted, undefined);
});

test('unavailable, user, system, empty and snapshot-only replies cannot start a scan', async () => {
    const { scanner, state, bridge } = await setup();
    assert.equal(scanner.canScanMessage(0), false);
    assert.equal(scanner.canScanMessage(-1), false);
    assert.equal(scanner.canScanMessage(99), false);
    assert.equal(scanner.canScanMessage(1.5), false);
    state.context.chat[1].is_system = true;
    assert.equal(scanner.canScanMessage(1), false);
    state.context.chat[1].is_system = false;
    state.context.chat[1].mes = '<rpgmt>{"manual":"snapshot"}</rpgmt>';
    assert.equal(scanner.canScanMessage(1), false);
    state.context.chat[1].mes = '  ';
    assert.equal(scanner.canScanMessage(1), false);
    state.context.chat[1].mes = 'Some reply';
    state.generating = true;
    assert.equal(scanner.canScanMessage(1), false);
    state.generating = false; bridge.isQuietUpdating = true;
    assert.equal(scanner.canScanMessage(1), false);
    bridge.isQuietUpdating = false; bridge.isFieldDefinitionSuggesting = () => true;
    assert.equal(scanner.canScanMessage(1), false);
    await assert.rejects(scanner.scanMessage(1), /wait for generation/);
    bridge.isFieldDefinitionSuggesting = () => false; bridge.latestSettings.enabled = false;
    assert.equal(scanner.canScanMessage(1), false);
    await assert.rejects(scanner.scanMessage(1), /wait for generation/);
    assert.equal(state.prompts.length, 0);
});
