const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadModel(options = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/core/ModelManager.js'), 'utf8');
    const requests = [];
    const prompts = [];
    const rawCalls = [];
    const quietCalls = [];
    const settings = { enabled: true, ...options.settings };
    const originalFetch = async (...args) => { requests.push(args); return { ok: true }; };
    const originalAjax = (...args) => { requests.push(args); return {}; };
    const window = { RPGBridge: { latestSettings: settings, isQuietUpdating: false }, fetch: originalFetch };
    const jquery = Object.assign(() => {}, { ajax: originalAjax });
    const context = vm.createContext({ window, $: jquery, console });
    const host = options.missingRaw ? {} : {
        async generateRaw(params) {
            rawCalls.push(params);
            assert.equal(window.RPGBridge.isQuietUpdating, true);
            assert.equal(context.rpgTracker_isQuietUpdating, true);
            if (options.raw) return options.raw({ params, window, jquery });
            return '{}';
        },
    };
    const overrides = {
        getContext: () => host,
        extension_settings: { tracker: settings, extension_prompts: {} },
        generateQuietPrompt: async (...args) => { quietCalls.push(args); return 'quiet-result'; },
        setExtensionPrompt: (...args) => prompts.push(args),
        extension_prompt_types: { IN_PROMPT: 0, IN_CHAT: 1 },
        extension_prompt_roles: { SYSTEM: 0 },
    };
    const imported = new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)]
        .map(([, names, specifier]) => [specifier, names.split(',').map(name => name.trim())]));
    const entry = new vm.SourceTextModule(source, { context });
    await entry.link(specifier => {
        const names = imported.get(specifier);
        return new vm.SyntheticModule(names, function () {
            for (const name of names) this.setExport(name, overrides[name] ?? (() => ''));
        }, { context });
    });
    await entry.evaluate();
    return { api: entry.namespace, window, context, requests, prompts, rawCalls, quietCalls, originalFetch, originalAjax, jquery };
}

test('message scanning uses only the supplied raw prompt and leaves extension prompts untouched', async () => {
    const model = await loadModel();
    assert.equal(await model.api.executeMessageScanPrompt('tracker', 'one selected reply'), '{}');
    assert.equal(model.rawCalls.length, 1);
    assert.equal(model.rawCalls[0].prompt, 'one selected reply');
    assert.equal(model.rawCalls[0].trimNames, false);
    assert.equal(model.quietCalls.length, 0);
    assert.equal(model.prompts.length, 0);
    assert.equal(model.window.RPGBridge.isQuietUpdating, false);
    assert.equal(model.context.rpgTracker_isQuietUpdating, false);
});

test('message scanning honors the configured model and restores request hooks after success', async () => {
    const model = await loadModel({ settings: { useCustomModel: true, customModel: 'scan-model' }, raw: async ({window, jquery}) => {
        await window.fetch('/api/backends/chat-completions/generate', { body: JSON.stringify({ model: 'default', messages: [] }) });
        jquery.ajax({ url: '/generate', data: JSON.stringify({ model: 'default' }) });
        return '{}';
    } });
    await model.api.executeMessageScanPrompt('tracker', 'selected');
    assert.equal(JSON.parse(model.requests[0][1].body).model, 'scan-model');
    assert.equal(JSON.parse(model.requests[1][0].data).model, 'scan-model');
    assert.equal(model.window.fetch, model.originalFetch);
    assert.equal(model.jquery.ajax, model.originalAjax);
});

test('failed extraction restores model hooks and busy flags, allowing a later retry', async () => {
    let attempts = 0;
    const model = await loadModel({ settings: { useCustomModel: true, customModel: 'scan-model' }, raw: async () => {
        if (++attempts === 1) throw new Error('API unavailable');
        return '{}';
    } });
    await assert.rejects(model.api.executeMessageScanPrompt('tracker', 'selected'), /API unavailable/);
    assert.equal(model.window.fetch, model.originalFetch);
    assert.equal(model.jquery.ajax, model.originalAjax);
    assert.equal(model.window.RPGBridge.isQuietUpdating, false);
    assert.equal(model.context.rpgTracker_isQuietUpdating, false);
    assert.equal(await model.api.executeMessageScanPrompt('tracker', 'selected'), '{}');
});

test('missing API and another active tracker request fail before changing runtime state', async () => {
    const missing = await loadModel({ missingRaw: true });
    await assert.rejects(missing.api.executeMessageScanPrompt('tracker', 'selected'), /does not provide/);
    assert.equal(missing.window.RPGBridge.isQuietUpdating, false);
    const busy = await loadModel();
    busy.window.RPGBridge.isQuietUpdating = true;
    await assert.rejects(busy.api.executeMessageScanPrompt('tracker', 'selected'), /already running/);
    assert.equal(busy.window.RPGBridge.isQuietUpdating, true);
    assert.equal(busy.rawCalls.length, 0);
});

test('existing quiet generation retains its positional call and prompt cleanup behavior', async () => {
    const model = await loadModel();
    assert.equal(await model.api.executeQuietPromptWithModelOverride('tracker', 'quiet instruction', null, true, true), 'quiet-result');
    assert.deepEqual(model.quietCalls, [['quiet instruction', true, false, 'quiet']]);
    assert(model.prompts.some(args => args[0] === 'tracker_def' && args[1] === ''));
    assert.equal(model.rawCalls.length, 0);
});
