// Reusable AI guidelines live in the authenticated SillyTavern account settings.
// These records never contain characters, field schemas, or current field values.
export const DEFINITION_PRESET_VERSION = 1;

const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedName = value => value.trim().toLocaleLowerCase();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeFieldKey = key => /^(status|profile|relation)_[\s\S]+$/.test(key)
    && key.slice(key.indexOf('_') + 1).trim().length > 0;
const recordKeys = new Set(['id', 'name', 'type', 'storageVersion', 'updatedAt', 'definitions']);

export function validateDefinitionGuidelines(definitions) {
    if (!isObject(definitions)) throw new Error('Field definitions must be a guideline dictionary.');
    for (const [key, value] of Object.entries(definitions)) {
        if (!safeFieldKey(key) || typeof value !== 'string') {
            throw new Error('Field definitions may contain only status, profile, or relationship guideline text.');
        }
    }
    return clone(definitions);
}

function validateLibrary(presets) {
    if (!Array.isArray(presets)) throw new Error('The server field definition library is invalid.');
    const ids = new Set();
    const names = new Set();
    for (const preset of presets) {
        if (!isObject(preset) || typeof preset.id !== 'string' || !preset.id.trim()
            || typeof preset.name !== 'string' || !preset.name.trim()
            || preset.type !== 'account' || preset.storageVersion !== DEFINITION_PRESET_VERSION
            || typeof preset.updatedAt !== 'string'
            || Object.keys(preset).some(key => !recordKeys.has(key))) {
            throw new Error('The server field definition library is invalid or uses an unsupported version. Refresh before saving.');
        }
        validateDefinitionGuidelines(preset.definitions);
        if (ids.has(preset.id) || names.has(normalizedName(preset.name))) {
            throw new Error('The server field definition library contains duplicate presets. Existing data has not been replaced.');
        }
        ids.add(preset.id);
        names.add(normalizedName(preset.name));
    }
    return clone(presets);
}

// Only match the current chat's exact field keys. Unmatched guides stay in the
// server preset so the same preset can be reused with a different field schema.
export function previewDefinitionPreset(definitions, currentDefinitions, availableKeys) {
    const incoming = validateDefinitionGuidelines(definitions);
    const merged = validateDefinitionGuidelines(currentDefinitions);
    const available = new Set(availableKeys.filter(key => typeof key === 'string' && safeFieldKey(key)));
    let matchedCount = 0;
    let changedCount = 0;
    let overwriteCount = 0;
    let skippedCount = 0;
    for (const [key, value] of Object.entries(incoming)) {
        if (!available.has(key)) {
            skippedCount++;
            continue;
        }
        matchedCount++;
        if (merged[key] !== value) {
            changedCount++;
            if (merged[key]?.trim()) overwriteCount++;
        }
        merged[key] = value;
    }
    return { definitions: merged, matchedCount, changedCount, overwriteCount, skippedCount };
}

export function createDefinitionPresetStorage({
    bridge,
    idFactory = () => `definitions_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
    now = () => new Date().toISOString(),
}) {
    const getBridge = () => {
        const current = typeof bridge === 'function' ? bridge() : bridge;
        if (typeof current?.readFieldDefinitionPresets !== 'function'
            || typeof current?.persistFieldDefinitionPresets !== 'function') {
            throw new Error('Field definition storage is not connected to SillyTavern. Reload the page and try again.');
        }
        return current;
    };
    const read = async () => validateLibrary(await getBridge().readFieldDefinitionPresets());
    const persist = async (next, expected) => {
        const saved = validateLibrary(await getBridge().persistFieldDefinitionPresets(clone(next), clone(expected)));
        if (!equal(saved, next)) {
            throw new Error('The server did not confirm the field definition presets. Refresh the library before retrying.');
        }
        return saved;
    };

    async function refresh() {
        return { presets: await read() };
    }

    async function save({ id, name, definitions, expectedPreset = null }) {
        if (typeof name !== 'string' || !name.trim()) throw new Error('Enter a preset name before saving.');
        const guides = validateDefinitionGuidelines(definitions);
        if (!Object.values(guides).some(value => value.trim())) {
            throw new Error('Add at least one field guideline before saving a preset.');
        }
        const presets = await read();
        const existing = presets.find(preset => preset.id === id);
        if (existing && (!expectedPreset || !equal(existing, expectedPreset))) {
            throw new Error('This preset changed on another device. Refresh the library and review it before overwriting.');
        }
        if (!existing && (expectedPreset || id)) {
            throw new Error('This preset was removed on another device. Refresh the library before saving a new copy.');
        }
        if (presets.some(preset => normalizedName(preset.name) === normalizedName(name) && preset.id !== existing?.id)) {
            throw new Error('A preset with this name already exists. Select it to overwrite it, or use another name.');
        }
        const preset = {
            id: existing?.id || idFactory(),
            name: name.trim(),
            type: 'account',
            storageVersion: DEFINITION_PRESET_VERSION,
            updatedAt: now(),
            definitions: guides,
        };
        if (!existing && presets.some(item => item.id === preset.id)) {
            throw new Error('Could not allocate a unique preset ID. Please try again.');
        }
        const next = existing ? presets.map(item => item.id === preset.id ? preset : item) : [...presets, preset];
        validateLibrary(next);
        return { preset: clone(preset), presets: await persist(next, presets) };
    }

    async function load(id) {
        const presets = await read();
        const preset = presets.find(item => item.id === id);
        if (!preset) throw new Error('This preset no longer exists on the server. Refresh the library.');
        return { preset: clone(preset), definitions: clone(preset.definitions), presets };
    }

    async function remove(id, expectedPreset) {
        const presets = await read();
        const existing = presets.find(preset => preset.id === id);
        if (!existing || !equal(existing, expectedPreset)) {
            throw new Error('This preset changed on another device. Refresh the library before deleting it.');
        }
        return persist(presets.filter(preset => preset.id !== id), presets);
    }

    return { refresh, save, load, remove };
}
