const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsm } = require('./helpers/load-esm.cjs');

const loaded = loadEsm('src/core/FieldDefinitionSuggestion.js');
const field = { category: 'profile', id: 'Appearance', name: 'Appearance', definition: '' };
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function inputOf(prompt) {
    return JSON.parse(prompt.slice(prompt.indexOf('Input JSON:\n') + 'Input JSON:\n'.length));
}

async function setup() {
    const { createFieldDefinitionSuggester } = await loaded;
    const state = {
        context: { chatId: 'chat-a', characterId: 1, groupId: null, chat: [{ mes: 'PRIVATE_CHAT_SENTINEL' }] },
        bridge: { latestSettings: { enabled: true }, currentTrackerData: { privateData: 'PRIVATE_TRACKER_SENTINEL' } },
        generating: false, calls: [], output: 'Describe visible physical traits and distinguishing features concisely.',
    };
    const api = createFieldDefinitionSuggester({
        getContext: () => state.context,
        getBridge: () => state.bridge,
        isGenerating: () => state.generating,
        generate: async prompt => {
            state.calls.push(prompt);
            return typeof state.output === 'function' ? state.output() : state.output;
        },
    });
    return { api, state };
}

test('guideline prompt uses selected field metadata and existing draft, never arbitrary supplied data', async () => {
    const { buildFieldDefinitionPrompt } = await loaded;
    const prompt = buildFieldDefinitionPrompt({ ...field, definition: 'Jelaskan ciri fisik.',
        min: 0, max: 100, value: 'SECRET_VALUE', characters: ['SECRET_CHARACTER'], chat: ['SECRET_CHAT'] });
    assert.deepEqual(inputOf(prompt), { category: 'profile', name: 'Appearance', current_guideline: 'Jelaskan ciri fisik.' });
    assert(!prompt.includes('SECRET'));
    assert.match(prompt, /preserving its intended meaning and language/);
    assert.match(prompt, /otherwise write in English/);
    assert.match(prompt, /one or two short sentences, at most 50 words/);
    assert.match(prompt, /not the field's current value/);
});

test('numeric fields include only supplied valid type and limits, and unsupported fields fail before generation', async () => {
    const { buildFieldDefinitionPrompt } = await loaded;
    assert.deepEqual(inputOf(buildFieldDefinitionPrompt({ category: 'status', id: 'Mana', type: 'consumable', min: 0, max: 60 })),
        { category: 'status', name: 'Mana', type: 'consumable', min: 0, max: 60 });
    assert.deepEqual(inputOf(buildFieldDefinitionPrompt({ category: 'relation', name: 'Trust', min: -100, max: 100 })),
        { category: 'relation', name: 'Trust', min: -100, max: 100 });
    assert.deepEqual(inputOf(buildFieldDefinitionPrompt({ category: 'status', name: 'Unknown', type: 'unsupported', min: NaN, max: Infinity })),
        { category: 'status', name: 'Unknown' });
    const { api, state } = await setup();
    await assert.rejects(api.suggestFieldDefinition({ category: 'inventory', name: 'Bag' }), /Choose a named/);
    await assert.rejects(api.suggestFieldDefinition({ category: 'profile', name: ' ' }), /Choose a named/);
    assert.equal(state.calls.length, 0);
    assert.equal(api.isFieldDefinitionSuggesting(), false);
});

test('plain suggestion normalization removes harmless wrappers and never silently truncates long responses', async () => {
    const { normalizeFieldDefinitionSuggestion: normalize } = await loaded;
    assert.equal(normalize('  Describe physical traits.\nKeep it brief.  '), 'Describe physical traits. Keep it brief.');
    assert.equal(normalize('<think>Private reasoning.</think>\n"Describe physical traits."'), 'Describe physical traits.');
    assert.equal(normalize('```text\nDescribe physical traits.\n```'), 'Describe physical traits.');
    for (const output of ['', '   ', null, {}, '{"suggestion":"Text"}', '<think>unfinished', '<p>Text</p>', '- One\n- Two']) {
        assert.throws(() => normalize(output), /did not return/);
    }
    assert.throws(() => normalize('a'.repeat(601)), /too long/);
    assert.throws(() => normalize('word '.repeat(81)), /too long/);
});

test('request returns an editable string without reading story content or changing tracker, field or context', async () => {
    const { api, state } = await setup();
    const before = JSON.stringify({ context: state.context, bridge: state.bridge, field });
    assert.equal(await api.suggestFieldDefinition(field), state.output);
    assert.equal(state.calls.length, 1);
    assert(!state.calls[0].includes('PRIVATE_CHAT_SENTINEL'));
    assert(!state.calls[0].includes('PRIVATE_TRACKER_SENTINEL'));
    assert.equal(JSON.stringify({ context: state.context, bridge: state.bridge, field }), before);
    assert.equal(api.isFieldDefinitionSuggesting(), false);
});

test('a pending suggestion prevents duplicate requests and becomes retryable after completion', async () => {
    const { api, state } = await setup();
    const pending = deferred();
    state.output = () => pending.promise;
    const result = api.suggestFieldDefinition(field);
    assert.equal(api.isFieldDefinitionSuggesting(), true);
    await assert.rejects(api.suggestFieldDefinition(field), /Wait for the current generation/);
    assert.equal(state.calls.length, 1);
    pending.resolve('Describe physical traits.');
    assert.equal(await result, 'Describe physical traits.');
    assert.equal(api.isFieldDefinitionSuggesting(), false);
    state.output = 'Describe distinguishing features.';
    assert.equal(await api.suggestFieldDefinition(field), state.output);
});

test('host generation, tracker updates, scans and disabled tracker prevent a suggestion request', async () => {
    for (const mode of ['host', 'quiet', 'scan', 'disabled']) {
        const { api, state } = await setup();
        if (mode === 'host') state.generating = true;
        if (mode === 'quiet') state.bridge.isQuietUpdating = true;
        if (mode === 'scan') state.bridge.isMessageScanBusy = () => true;
        if (mode === 'disabled') state.bridge.latestSettings.enabled = false;
        await assert.rejects(api.suggestFieldDefinition(field), /Wait for|Enable RPG Tracker/);
        assert.equal(state.calls.length, 0);
        assert.equal(api.isFieldDefinitionSuggesting(), false);
    }
});

test('failed provider and malformed responses release busy state and leave existing data untouched', async () => {
    const { api, state } = await setup();
    const before = JSON.stringify(state.bridge);
    state.output = () => { throw new Error('Provider offline'); };
    await assert.rejects(api.suggestFieldDefinition(field), /Provider offline/);
    assert.equal(api.isFieldDefinitionSuggesting(), false);
    state.output = '';
    await assert.rejects(api.suggestFieldDefinition(field), /did not return/);
    assert.equal(api.isFieldDefinitionSuggesting(), false);
    assert.equal(JSON.stringify(state.bridge), before);
    state.output = 'Describe physical traits.';
    assert.equal(await api.suggestFieldDefinition(field), state.output);
});

test('a result from another chat or a disabled tracker is rejected rather than applied', async () => {
    for (const change of ['chat', 'chat-reference', 'disabled']) {
        const { api, state } = await setup();
        const pending = deferred();
        state.output = () => pending.promise;
        const result = api.suggestFieldDefinition(field);
        if (change === 'chat') state.context = { ...state.context, chatId: 'chat-b' };
        if (change === 'chat-reference') state.context = { ...state.context, chat: [] };
        if (change === 'disabled') state.bridge.latestSettings.enabled = false;
        pending.resolve('Describe physical traits.');
        await assert.rejects(result, /chat changed or RPG Tracker was disabled/);
        assert.equal(api.isFieldDefinitionSuggesting(), false);
        assert.deepEqual(state.bridge.currentTrackerData, { privateData: 'PRIVATE_TRACKER_SENTINEL' });
    }
});
