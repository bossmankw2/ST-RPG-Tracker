const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let createMessageScanCommit, getChatKey, getDeltaLog, setDeltaLog, getMessageScanRecord, stripMessageScanMarkup;
let rehydrateFromHistory, rehydrateFromHistoryAsync;
test.before(async () => {
    ({ createMessageScanCommit } = await loadEsm('src/core/MessageScanCommit.js'));
    ({ getChatKey } = await loadEsm('src/core/ChatLockStore.js'));
    ({ getDeltaLog, setDeltaLog } = await loadEsm('src/tracker/DeltaLogRenderer.js'));
    ({ rehydrateFromHistory, rehydrateFromHistoryAsync } = await loadEsm('src/core/JSONTracker_Timeline.js'));
    ({ getMessageScanRecord } = await loadEsm('src/core/MessageScanState.js'));
    ({ stripMessageScanMarkup } = await loadEsm('src/core/MessageScanInput.js'));
});
const copy = value => JSON.parse(JSON.stringify(value));
const tracker = height => ({ characters: [{ id: 'ada', name: 'Ada', statusSchema: [], status: {}, profile: { Height: height } }] });

function fixture() {
    const before = tracker('180 cm');
    const updated = tracker('190 cm');
    const historical = tracker('160 cm');
    const text = 'Ada is 190 cm tall. <rpgmt>{"manual":"leave untouched"}</rpgmt>';
    const originalDelta = { Ada: { status: { HP: 80 }, profile: { Race: 'Human' } } };
    const source = {
        is_user: false, mes: text, swipe_id: 0, swipes: [text, 'Other response'],
        extra: { custom: 'message metadata', rpgTrackerDelta: copy(originalDelta) },
        swipe_info: [
            { extra: { rpgTrackerData: historical, rpgTrackerDelta: copy(originalDelta), unrelated: 'keep' } },
            { extra: { rpgTrackerDelta: { Ada: { status: { HP: 60 } } } } },
        ],
    };
    const tail = {
        is_user: false, mes: 'Latest response', swipe_id: 1,
        swipes: ['Old tail response', 'Latest response'],
        swipe_info: [
            { extra: { rpgTrackerData: tracker('170 cm'), custom: 'other swipe' } },
            { extra: { rpgTrackerData: copy(before), rpgTrackerDelta: { Ada: { status: { HP: 70 } } } } },
        ],
    };
    const chat = [source, { is_user: true, mes: 'Continue.' }, tail];
    const context = { chatId: 'chat-A', characterId: 0, groupId: null, chat };
    const state = { context, saves: 0, refreshes: 0, verified: 0, synced: [] };
    const bridge = {
        currentTrackerData: before,
        syncChatData(data) { this.currentTrackerData = data; state.synced.push(data); },
    };
    const target = {
        chatKey: getChatKey(context), chat, message: source, index: 0, swipeId: 0,
        length: chat.length, tail, tailSwipeId: 1,
    };
    const record = { version: 1, sourceText: stripMessageScanMarkup(text), delta: { Ada: { profile: { Height: '190 cm' } } }, scannedAt: '2026-10-25T00:00:00.000Z' };
    const args = { target, before, updated, record, stillCurrent: () => true };
    const commit = overrides => createMessageScanCommit({
        getContext: () => state.context,
        getBridge: () => bridge,
        saveChat: async () => { state.saves += 1; },
        verifySaved: async () => { state.verified += 1; },
        refresh: () => { state.refreshes += 1; },
        ...overrides,
    });
    return { before, updated, historical, source, tail, state, bridge, target, record, args, commit, originalDelta };
}

test('scan commit preserves old manual snapshot and automatic delta while updating only the current tail snapshot', async () => {
    const f = fixture();
    const text = f.source.mes;
    const swipes = copy(f.source.swipes);
    const messageExtra = copy(f.source.extra);
    const otherTail = copy(f.tail.swipe_info[0]);
    let verified;
    await f.commit({ verifySaved: async value => { verified = value; } })(f.args);
    assert.equal(f.source.mes, text);
    assert.deepEqual(f.source.swipes, swipes);
    assert.deepEqual(f.source.extra, messageExtra);
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerData, f.historical);
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerDelta, f.originalDelta);
    assert.deepEqual(f.tail.swipe_info[0], otherTail);
    assert.deepEqual(f.tail.swipe_info[1].extra.rpgTrackerData, f.updated);
    assert.deepEqual(f.tail.swipe_info[1].extra.rpgTrackerDelta, { Ada: { status: { HP: 70 } } });
    assert.deepEqual(getMessageScanRecord(f.source), f.record);
    assert.equal(f.bridge.currentTrackerData, f.updated);
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.refreshes, 1);
    assert.equal(verified.target, f.target);
    assert.deepEqual(verified.record, f.record);
    assert.deepEqual(verified.snapshot, f.updated);
});

test('scan recap merges accepted changes without mutating the original automatic recap', async () => {
    const f = fixture();
    f.record.delta.Ada.status = { HP: 75 };
    await f.commit()(f.args);
    assert.deepEqual(getDeltaLog(f.source), {
        Ada: { status: { HP: 75 }, profile: { Race: 'Human', Height: '190 cm' } },
    });
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerDelta, f.originalDelta);
    f.source.swipe_id = 1;
    f.source.mes = f.source.swipes[1];
    assert.equal(getMessageScanRecord(f.source), null);
    assert.deepEqual(getDeltaLog(f.source), { Ada: { status: { HP: 60 } } });
    f.source.swipe_id = 0;
    f.source.mes = `${f.source.swipes[0]} Edited reply.`;
    assert.equal(getMessageScanRecord(f.source), null);
    assert.deepEqual(getDeltaLog(f.source), f.originalDelta);
});

test('a stale selection is rejected before any snapshot or state mutation', async () => {
    const f = fixture();
    const source = copy(f.source);
    const tail = copy(f.tail);
    await assert.rejects(f.commit()({ ...f.args, stillCurrent: () => false }), /changed/);
    assert.deepEqual(f.source, source);
    assert.deepEqual(f.tail, tail);
    assert.equal(f.bridge.currentTrackerData, f.before);
    assert.equal(f.state.saves, 0);
    assert.equal(f.state.verified, 0);
});

test('thrown persistence rolls back scanner metadata, snapshot and tracker state', async () => {
    const f = fixture();
    const source = copy(f.source);
    const tail = copy(f.tail);
    await assert.rejects(f.commit({ saveChat: async () => { throw new Error('Save failed'); } })(f.args), /Save failed/);
    assert.deepEqual(f.source, source);
    assert.deepEqual(f.tail, tail);
    assert.equal(f.bridge.currentTrackerData, f.before);
    assert.equal(f.state.verified, 0);
    assert.equal(f.state.refreshes, 1);
});

test('failed read-back verification does not claim success when native save resolves silently', async () => {
    const f = fixture();
    await assert.rejects(f.commit({ verifySaved: async () => { throw new Error('Save was not confirmed'); } })(f.args), /not confirmed/);
    assert.equal(f.state.saves, 1);
    assert.equal(getMessageScanRecord(f.source), null);
    assert.deepEqual(f.tail.swipe_info[1].extra.rpgTrackerData, f.before);
    assert.equal(f.bridge.currentTrackerData, f.before);
});

test('failed scan preserves unrelated metadata and other swipe edits made during persistence', async () => {
    const f = fixture();
    const otherSnapshot = tracker('175 cm');
    await assert.rejects(f.commit({ saveChat: async () => {
        f.source.swipe_info[0].extra.note = 'New manual note';
        f.source.swipe_info[1].extra.manual = 'Other source swipe edit';
        f.tail.swipe_info[0].extra.rpgTrackerData = otherSnapshot;
        f.tail.swipe_info[1].extra.note = 'New tail note';
        throw new Error('Save failed');
    } })(f.args), /Save failed/);
    assert.equal(getMessageScanRecord(f.source), null);
    assert.equal(f.source.swipe_info[0].extra.note, 'New manual note');
    assert.equal(f.source.swipe_info[1].extra.manual, 'Other source swipe edit');
    assert.equal(f.tail.swipe_info[0].extra.rpgTrackerData, otherSnapshot);
    assert.equal(f.tail.swipe_info[1].extra.note, 'New tail note');
    assert.deepEqual(f.tail.swipe_info[1].extra.rpgTrackerData, f.before);
});

test('failed scan never overwrites a newer tracker snapshot or newer in-memory state', async () => {
    const f = fixture();
    const newer = tracker('195 cm');
    await assert.rejects(f.commit({ saveChat: async () => {
        f.tail.swipe_info[1].extra.rpgTrackerData = newer;
        f.bridge.currentTrackerData = newer;
        throw new Error('Save failed');
    } })(f.args), /Save failed/);
    assert.equal(f.tail.swipe_info[1].extra.rpgTrackerData, newer);
    assert.equal(f.bridge.currentTrackerData, newer);
    assert.equal(getMessageScanRecord(f.source), null);
});

test('rollback from an old chat cannot overwrite the newly selected chat tracker', async () => {
    const f = fixture();
    const nextChat = tracker('150 cm');
    await assert.rejects(f.commit({ saveChat: async () => {
        f.state.context = { ...f.state.context, chatId: 'chat-B', chat: [] };
        f.bridge.currentTrackerData = nextChat;
        throw new Error('Save failed');
    } })(f.args), /Save failed/);
    assert.equal(f.bridge.currentTrackerData, nextChat);
    assert.equal(getMessageScanRecord(f.source), null);
});

test('scan commit supports a source that is itself the current tail', async () => {
    const f = fixture();
    f.target.chat.splice(1);
    f.target.tail = f.source;
    f.target.length = 1;
    f.target.tailSwipeId = 0;
    await f.commit()(f.args);
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerData, f.updated);
    assert.equal(getMessageScanRecord(f.source), f.record);
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerDelta, f.originalDelta);
    assert(f.source.mes.includes('<rpgmt>'));
});


test('identical-text swipes use the selected snapshot and selected automatic recap', async () => {
    const f = fixture();
    f.source.swipes = [f.source.mes, f.source.mes];
    f.source.swipe_id = 1;
    f.source.swipe_info[1].extra.rpgTrackerData = tracker('195 cm');
    f.source.swipe_info[1].extra.rpgTrackerScan = f.record;
    assert.equal(rehydrateFromHistory([f.source]).characters[0].profile.Height, '195 cm');
    assert.equal((await rehydrateFromHistoryAsync([f.source])).characters[0].profile.Height, '195 cm');
    assert.deepEqual(getDeltaLog(f.source), {
        Ada: { status: { HP: 60 }, profile: { Height: '190 cm' } },
    });
});

test('automatic regeneration clears only its selected swipe scan marker, even for identical response text', () => {
    const f = fixture();
    f.source.swipes = [f.source.mes, f.source.mes];
    f.source.swipe_id = 1;
    const firstRecord = copy(f.record);
    f.source.swipe_info[0].extra.rpgTrackerScan = firstRecord;
    f.source.swipe_info[1].extra.rpgTrackerScan = f.record;
    setDeltaLog(f.source, { Ada: { status: { HP: 55 } } });
    assert.equal(getMessageScanRecord(f.source), null);
    assert.equal(f.source.swipe_info[0].extra.rpgTrackerScan, firstRecord);
    assert.deepEqual(f.source.swipe_info[0].extra.rpgTrackerDelta, f.originalDelta);
    assert.deepEqual(getDeltaLog(f.source), { Ada: { status: { HP: 55 } } });
});
