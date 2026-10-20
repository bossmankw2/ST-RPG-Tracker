// Account presets use SillyTavern's existing settings storage. Local copies are
// kept as recovery backups when migrating older browser-only presets.
export const PRESET_STORAGE_VERSION = 1;

const clone = value => JSON.parse(JSON.stringify(value));
const sameRecord = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedName = name => String(name || '').trim().toLocaleLowerCase();
const localKey = id => `rpg_tracker_preset_${id}`;

export function createPresetId() {
  return `preset_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function validatePresetCharacters(data) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('A preset must contain at least one character.');
  }
  const ids = new Set();
  const names = new Set();
  for (const character of data) {
    if (!character || typeof character !== 'object' || Array.isArray(character)
      || typeof character.id !== 'string' || !character.id.trim()
      || typeof character.name !== 'string' || !character.name.trim()) {
      throw new Error('Each preset character needs a name and a unique ID.');
    }
    if (ids.has(character.id) || names.has(normalizedName(character.name))) {
      throw new Error('Character names and IDs must be unique within a preset.');
    }
    ids.add(character.id);
    names.add(normalizedName(character.name));
  }
  return clone(data);
}

export function isPackagedPreset(preset) {
  return !Array.isArray(preset?.data) && (preset?.type === 'file' || preset?.type === 'server' || Boolean(preset?.file));
}

function readLocalPreset(preset, storage) {
  let stored;
  try {
    stored = storage?.getItem(localKey(preset.id));
  } catch {
    throw new Error('Browser storage is unavailable. Use the original browser or import an exported preset.');
  }
  if (!stored) {
    throw new Error('This preset is only on its original browser and address. Open it there to move it to the server, or import an exported preset.');
  }
  try {
    return validatePresetCharacters(JSON.parse(stored));
  } catch {
    throw new Error('The browser copy of this preset is damaged or invalid. Import an exported backup to recover it.');
  }
}

export function getPresetLocation(preset, storage) {
  if (Array.isArray(preset?.data)) return 'Server';
  if (isPackagedPreset(preset)) return 'Built-in';
  try {
    return storage?.getItem(localKey(preset.id)) ? 'This browser' : 'Original browser';
  } catch {
    return 'Original browser';
  }
}

function accountRecord(preset, data, now) {
  return {
    id: preset.id,
    name: preset.name.trim(),
    type: 'account',
    storageVersion: PRESET_STORAGE_VERSION,
    updatedAt: now(),
    data: validatePresetCharacters(data),
  };
}

export function createPresetStorage({
  bridge,
  storage,
  idFactory = createPresetId,
  now = () => new Date().toISOString(),
}) {
  const getBridge = () => {
    const current = typeof bridge === 'function' ? bridge() : bridge;
    if (typeof current?.readPresetSettings !== 'function' || typeof current?.persistPresetSettings !== 'function') {
      throw new Error('Preset storage is not connected to SillyTavern. Reload the page and try again.');
    }
    return current;
  };

  async function read() {
    const presets = await getBridge().readPresetSettings();
    if (!Array.isArray(presets) || presets.some(preset => !preset || typeof preset !== 'object'
      || typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string')) {
      throw new Error('The server returned an invalid preset library. Existing data has not been replaced.');
    }
    return clone(presets);
  }

  async function persist(next, expected) {
    const saved = await getBridge().persistPresetSettings(clone(next), clone(expected));
    if (!Array.isArray(saved) || !sameRecord(saved, next)) {
      throw new Error('The server did not confirm the preset changes. Refresh the library before retrying.');
    }
    return clone(saved);
  }

  async function refresh({ migrate = true } = {}) {
    const presets = await read();
    if (!migrate) return { presets, migratedCount: 0, issues: [] };
    const issues = [];
    let migratedCount = 0;
    const next = presets.map(preset => {
      if (!preset || !preset.id || !preset.name || isPackagedPreset(preset)
        || (preset.type === 'account' && preset.storageVersion === PRESET_STORAGE_VERSION && Array.isArray(preset.data))) {
        return preset;
      }
      try {
        const data = Array.isArray(preset.data) ? preset.data : readLocalPreset(preset, storage);
        const migrated = accountRecord(preset, data, now);
        migratedCount++;
        return migrated;
      } catch (error) {
        issues.push({ id: preset.id, name: preset.name, message: error.message });
        return preset;
      }
    });
    if (!migratedCount) return { presets, migratedCount: 0, issues };
    try {
      return { presets: await persist(next, presets), migratedCount, issues };
    } catch (error) {
      return { presets, migratedCount: 0, issues, migrationError: error.message };
    }
  }

  async function save({ id, name, data, expectedPreset = null }) {
    if (!String(name || '').trim()) throw new Error('Enter a preset name before saving.');
    const characters = validatePresetCharacters(data);
    const presets = await read();
    const existing = presets.find(preset => preset.id === id);
    const nameDuplicate = presets.find(preset => normalizedName(preset.name) === normalizedName(name)
      && preset.id !== existing?.id);
    if (nameDuplicate) {
      throw new Error('A preset with this name already exists. Select it to overwrite it, or use another name.');
    }
    if (existing && (!expectedPreset || !sameRecord(existing, expectedPreset))) {
      throw new Error('This preset changed on another device. Refresh the library and review it before overwriting.');
    }
    if (!existing && expectedPreset) {
      throw new Error('This preset was removed on another device. Refresh the library before saving a new copy.');
    }
    const record = accountRecord({ id: existing?.id || idFactory(), name }, characters, now);
    if (!existing && presets.some(preset => preset.id === record.id)) {
      throw new Error('Could not allocate a unique preset ID. Please try again.');
    }
    const next = existing
      ? presets.map(preset => preset.id === record.id ? record : preset)
      : [...presets, record];
    return { preset: record, presets: await persist(next, presets) };
  }

  async function remove(id, expectedPreset) {
    const presets = await read();
    const existing = presets.find(preset => preset.id === id);
    if (!existing || !sameRecord(existing, expectedPreset)) {
      throw new Error('This preset changed on another device. Refresh the library before deleting it.');
    }
    const saved = await persist(presets.filter(preset => preset.id !== id), presets);
    // Only remove the legacy browser backup after the server confirms deletion.
    try { storage?.removeItem(localKey(id)); } catch { /* Server deletion succeeded. */ }
    return saved;
  }

  async function load(id) {
    const presets = await read();
    const preset = presets.find(item => item.id === id);
    if (!preset) throw new Error('This preset no longer exists on the server. Refresh the library.');
    const data = Array.isArray(preset.data)
      ? validatePresetCharacters(preset.data)
      : readLocalPreset(preset, storage);
    return { preset, data, presets };
  }

  return { refresh, save, remove, load };
}
