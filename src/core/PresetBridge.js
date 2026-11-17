// Use the authenticated SillyTavern account settings API. Never write presets
// into the extension installation directory, which can be replaced by updates.
export function createPresetBridge({ extensionName, getRequestHeaders, syncPresets = () => {}, syncFieldDefinitionPresets = () => {}, fetchImpl = fetch }) {
    let pendingWrite = Promise.resolve();
    const clone = value => JSON.parse(JSON.stringify(value));
    const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

    async function readDocument() {
        const response = await fetchImpl('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: '{}',
            cache: 'no-store',
        });
        if (!response.ok) throw new Error('Could not read presets from the SillyTavern server.');
        const result = await response.json();
        const document = typeof result.settings === 'string' ? JSON.parse(result.settings) : result.settings;
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
            throw new Error('The server returned invalid settings.');
        }
        return document;
    }

    const libraryOf = (document, key) => {
        const library = document.extension_settings?.[extensionName]?.[key];
        if (library === undefined) return [];
        if (!Array.isArray(library)) throw new Error('The server preset library is invalid.');
        return library;
    };

    function syncOtherLibrary(document, key) {
        const otherKey = key === 'presets' ? 'fieldDefinitionPresets' : 'presets';
        const other = document.extension_settings?.[extensionName]?.[otherKey];
        // Keep live sibling settings fresh too: a later native settings save
        // must not put an older copy of the other account library back.
        if (other !== undefined && !Array.isArray(other)) return;
        const syncOther = otherKey === 'presets' ? syncPresets : syncFieldDefinitionPresets;
        syncOther(clone(other ?? []));
    }

    async function readLibrary(key, syncLibrary) {
        await pendingWrite;
        const document = await readDocument();
        const library = clone(libraryOf(document, key));
        syncLibrary(library);
        syncOtherLibrary(document, key);
        return library;
    }

    function persistLibrary(key, syncLibrary, nextPresets, expectedPresets) {
        const next = clone(nextPresets);
        const expected = clone(expectedPresets);
        const write = async () => {
            const document = await readDocument();
            if (!equal(libraryOf(document, key), expected)) {
                throw new Error('Presets changed on another device. Refresh the list before saving again.');
            }
            document.extension_settings ??= {};
            document.extension_settings[extensionName] ??= {};
            document.extension_settings[extensionName][key] = next;
            const response = await fetchImpl('/api/settings/save', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(document),
                cache: 'no-store',
            });
            if (!response.ok || (await response.json()).result !== 'ok') {
                throw new Error('Presets could not be saved. Your browser copy has been kept.');
            }
            // Also update the live settings object so a later native autosave
            // does not put this browser's older preset list back on the server.
            syncLibrary(clone(next));
            // The POST saved this fresh sibling too. Retain it in live settings
            // even if the verification read fails, so native autosave is safe.
            syncOtherLibrary(document, key);
            const confirmedDocument = await readDocument();
            const confirmed = libraryOf(confirmedDocument, key);
            syncOtherLibrary(confirmedDocument, key);
            if (!equal(confirmed, next)) {
                syncLibrary(clone(confirmed));
                throw new Error('The server save could not be confirmed. Refresh before trying again.');
            }
            return clone(confirmed);
        };
        const result = pendingWrite.then(write);
        pendingWrite = result.catch(() => {});
        return result;
    }

    return {
        readPresetSettings: () => readLibrary('presets', syncPresets),
        persistPresetSettings: (next, expected) => persistLibrary('presets', syncPresets, next, expected),
        readFieldDefinitionPresets: () => readLibrary('fieldDefinitionPresets', syncFieldDefinitionPresets),
        persistFieldDefinitionPresets: (next, expected) => persistLibrary('fieldDefinitionPresets', syncFieldDefinitionPresets, next, expected),
    };
}
