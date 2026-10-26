const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

let createMessageScanVerifier;
test.before(async () => {
    ({ createMessageScanVerifier } = await loadEsm('src/core/MessageScanVerifier.js'));
});
const copy = value => JSON.parse(JSON.stringify(value));

function fixture({ group = false, header = true } = {}) {
    const record = { version: 1, sourceText: 'Ada is tall.', delta: { Ada: { profile: { Height: '190 cm' } } }, scannedAt: '2026-10-25T00:00:00.000Z' };
    const snapshot = { characters: [{ id: 'ada', name: 'Ada', profile: { Height: '190 cm' } }] };
    const source = { mes: 'Ada is tall.', swipe_info: [{ extra: {} }, { extra: { rpgTrackerScan: record } }] };
    const tail = { mes: 'Latest.', swipe_info: [{ extra: { rpgTrackerData: snapshot } }] };
    const chat = [source, { is_user: true, mes: 'Continue.' }, tail];
    const data = header ? [{ chat_metadata: { preserved: true } }, ...chat] : chat;
    const target = {
        storage: { chatId: 'captured-chat', groupId: group ? 'group-owner' : null, avatar: group ? undefined : 'captured-avatar.png' },
        index: 0, swipeId: 1, length: 3, tailSwipeId: 0,
    };
    const calls = [];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture' };
    const create = overrides => createMessageScanVerifier({
        getRequestHeaders: () => headers,
        fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => data }; },
        ...overrides,
    });
    return { args: { target, record, snapshot }, target, record, snapshot, data, chat, calls, headers, create };
}

test('normal-chat verification reads captured filename and avatar with authenticated no-cache request', async () => {
    const f = fixture();
    await f.create()(f.args);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, '/api/chats/get');
    assert.equal(f.calls[0].options.method, 'POST');
    assert.equal(f.calls[0].options.cache, 'no-store');
    assert.equal(f.calls[0].options.headers, f.headers);
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { file_name: 'captured-chat', avatar_url: 'captured-avatar.png' });
});

test('group verification uses the captured chat file ID, not the group owner ID', async () => {
    const f = fixture({ group: true, header: false });
    await f.create()(f.args);
    assert.equal(f.calls[0].url, '/api/chats/group/get');
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { id: 'captured-chat' });
});

test('both headered group files and headerless normal files resolve the message indices correctly', async () => {
    const group = fixture({ group: true, header: true });
    const normal = fixture({ group: false, header: false });
    await group.create()(group.args);
    await normal.create()(normal.args);
    assert.equal(group.calls.length, 1);
    assert.equal(normal.calls.length, 1);
});

test('missing captured storage identity rejects before sending any request', async () => {
    for (const storage of [undefined, {}, { chatId: 'A' }, { chatId: '', groupId: 'group' }]) {
        const f = fixture();
        f.target.storage = storage;
        await assert.rejects(f.create()(f.args), /Could not confirm/);
        assert.equal(f.calls.length, 0);
    }
});

test('HTTP errors, network failures and malformed saved documents cannot count as confirmation', async () => {
    const f = fixture();
    await assert.rejects(f.create({ fetchImpl: async () => ({ ok: false }) })(f.args), /Could not confirm/);
    await assert.rejects(f.create({ fetchImpl: async () => { throw new Error('Network offline'); } })(f.args), /Network offline/);
    for (const data of [null, {}, 'not an array']) {
        await assert.rejects(f.create({ fetchImpl: async () => ({ ok: true, json: async () => data }) })(f.args), /did not return a saved chat/);
    }
});

test('a missing or different source scan record prevents confirmation even if the tail snapshot matches', async () => {
    for (const mutate of [
        source => { delete source.swipe_info[1].extra.rpgTrackerScan; },
        source => { source.swipe_info[1].extra.rpgTrackerScan.sourceText = 'Different reply'; },
        source => { source.swipe_info[1].extra.rpgTrackerScan.delta = {}; },
        source => { source.swipe_info[0].extra.rpgTrackerScan = source.swipe_info[1].extra.rpgTrackerScan; delete source.swipe_info[1].extra.rpgTrackerScan; },
    ]) {
        const f = fixture();
        const saved = copy(f.data);
        mutate(saved[1]);
        await assert.rejects(f.create({ fetchImpl: async () => ({ ok: true, json: async () => saved }) })(f.args), /could not be confirmed/);
    }
});

test('a missing or changed tail snapshot prevents confirmation even if the scan marker was saved', async () => {
    for (const mutate of [
        tail => { delete tail.swipe_info[0].extra.rpgTrackerData; },
        tail => { tail.swipe_info[0].extra.rpgTrackerData.characters[0].profile.Height = '180 cm'; },
    ]) {
        const f = fixture();
        const saved = copy(f.data);
        mutate(saved[3]);
        await assert.rejects(f.create({ fetchImpl: async () => ({ ok: true, json: async () => saved }) })(f.args), /could not be confirmed/);
    }
});
