// Use the authenticated SillyTavern account settings API. Never write presets
// into the extension installation directory, which can be replaced by updates.
export function createPresetBridge({ extensionName, getRequestHeaders, syncPresets, fetchImpl = fetch }) {
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

    const libraryOf = document => {
        const library = document.extension_settings?.[extensionName]?.presets ?? [];
        if (!Array.isArray(library)) throw new Error('The server preset library is invalid.');
        return library;
    };

    async function readPresetSettings() {
        await pendingWrite;
        const library = clone(libraryOf(await readDocument()));
        syncPresets(library);
        return library;
    }

    function persistPresetSettings(nextPresets, expectedPresets) {
        const next = clone(nextPresets);
        const expected = clone(expectedPresets);
        const write = async () => {
            const document = await readDocument();
            if (!equal(libraryOf(document), expected)) {
                throw new Error('Presets changed on another device. Refresh the list before saving again.');
            }
            document.extension_settings ??= {};
            document.extension_settings[extensionName] ??= {};
            document.extension_settings[extensionName].presets = next;
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
            syncPresets(clone(next));
            const confirmed = libraryOf(await readDocument());
            if (!equal(confirmed, next)) {
                syncPresets(clone(confirmed));
                throw new Error('The server save could not be confirmed. Refresh before trying again.');
            }
            return clone(confirmed);
        };
        const result = pendingWrite.then(write);
        pendingWrite = result.catch(() => {});
        return result;
    }

    return { readPresetSettings, persistPresetSettings };
}
