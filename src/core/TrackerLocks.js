// Chat-owned lock rules are stored independently of swipe snapshots. This module
// only captures/applies them; the bridge decides which chat owns a given record.
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const WORLD_FIELDS = ['date', 'time', 'weather', 'location'];

function flagsFor(values = {}, flags = {}) {
    values ||= {};
    flags ||= {};
    return Object.fromEntries([...new Set([...Object.keys(values), ...Object.keys(flags)])]
        .map(key => [key, flags[key] === true]));
}

function lockedValues(values = {}, flags = {}) {
    values ||= {};
    flags ||= {};
    return Object.fromEntries(Object.keys(flags)
        .filter(key => flags[key] && own(values, key))
        .map(key => [key, clone(values[key])]));
}

function hasProtection(record) {
    return Object.values(record.status).some(field => field.locked)
        || Object.values(record.profile.flags).some(Boolean)
        || record.inventory.equipIsLocked
        || record.inventory.storageIsLocked
        || Object.values(record.inventory.equipmentLocks).some(Boolean)
        || Object.values(record.inventory.storageLocks).some(Boolean)
        || record.quests.main.locked
        || record.quests.sides.some(quest => quest.locked)
        || Object.values(record.relations).some(relation => relation.locked);
}

export function captureLocks(tracker = {}) {
    tracker ||= {};
    const worldFlags = Object.fromEntries(
        [...new Set([...WORLD_FIELDS, ...Object.keys(tracker.worldStateLocks || {})])]
            .map(key => [key, tracker.worldStateLocks?.[key] === true]),
    );
    const characters = Object.create(null);
    for (const char of tracker.characters || []) {
        if (!char?.id) continue;
        const profileFlags = flagsFor(char.profile, char.profileLocks);
        const inventory = char.inventory || {};
        const equipmentLocks = flagsFor(inventory.equipment, inventory.equipmentLocks);
        const storageLocks = flagsFor(inventory.storage, inventory.storageLocks);
        const status = Object.create(null);
        for (const schema of char.statusSchema || []) {
            if (!schema.id) continue;
            status[schema.id] = { locked: schema.isLocked === true };
            if (schema.isLocked) {
                status[schema.id].schema = clone(schema);
                if (own(char.status, schema.id)) status[schema.id].value = clone(char.status[schema.id]);
            }
        }
        characters[char.id] = {
            identity: Object.fromEntries(
                ['id', 'name', 'activePlayer', 'activeInjection', 'syncedCardType', 'syncedCardAvatar']
                    .filter(key => own(char, key)).map(key => [key, clone(char[key])]),
            ),
            status,
            profile: {
                flags: profileFlags,
                values: lockedValues(char.profile, profileFlags),
                injects: lockedValues(char.profileInjects, profileFlags),
            },
            inventory: {
                equipIsLocked: inventory.equipIsLocked === true,
                storageIsLocked: inventory.storageIsLocked === true,
                equipmentLocks,
                storageLocks,
                equipment: inventory.equipIsLocked ? clone(inventory.equipment || {})
                    : lockedValues(inventory.equipment, equipmentLocks),
                storage: inventory.storageIsLocked ? clone(inventory.storage || {})
                    : lockedValues(inventory.storage, storageLocks),
            },
            quests: {
                main: {
                    locked: char.quests?.main?.isLocked === true,
                    ...(char.quests?.main?.isLocked ? { value: clone(char.quests.main) } : {}),
                },
                sides: (char.quests?.sides || []).map(quest => ({
                    id: quest.id, name: quest.name, locked: quest.isLocked === true,
                    ...(quest.isLocked ? { value: clone(quest) } : {}),
                })),
            },
            relations: Object.fromEntries(Object.entries(char.relations || {}).map(([name, relation]) => [
                name, { locked: relation?.isLocked === true, ...(relation?.isLocked ? { value: clone(relation) } : {}) },
            ])),
        };
    }
    return {
        version: 1,
        world: { flags: worldFlags, values: lockedValues(tracker.worldState, worldFlags) },
        characters,
    };
}

function restoreValues(target, values, flags) {
    for (const [key, locked] of Object.entries(flags)) {
        if (!locked) continue;
        if (own(values, key)) Object.defineProperty(target, key, {
            value: clone(values[key]), enumerable: true, configurable: true, writable: true,
        });
        else delete target[key];
    }
}

function applyCharacterLocks(char, record) {
    char.statusSchema = (char.statusSchema || []).map(schema => ({
        ...schema, isLocked: record.status[schema.id]?.locked === true,
    }));
    char.status = char.status || {};
    for (const [id, field] of Object.entries(record.status)) {
        if (!field.locked) continue;
        const index = char.statusSchema.findIndex(schema => schema.id === id);
        if (index === -1) char.statusSchema.push(clone(field.schema));
        else char.statusSchema[index] = clone(field.schema);
        if (own(field, 'value')) char.status[id] = clone(field.value);
        else delete char.status[id];
    }

    char.profile = char.profile || {};
    char.profileLocks = clone(record.profile.flags);
    restoreValues(char.profile, record.profile.values, record.profile.flags);
    char.profileInjects = { ...(char.profileInjects || {}), ...clone(record.profile.injects) };

    char.inventory = char.inventory || {};
    const inventory = record.inventory;
    char.inventory.equipIsLocked = inventory.equipIsLocked;
    char.inventory.storageIsLocked = inventory.storageIsLocked;
    char.inventory.equipmentLocks = clone(inventory.equipmentLocks);
    char.inventory.storageLocks = clone(inventory.storageLocks);
    char.inventory.equipment = inventory.equipIsLocked ? clone(inventory.equipment)
        : (char.inventory.equipment || {});
    char.inventory.storage = inventory.storageIsLocked ? clone(inventory.storage)
        : (char.inventory.storage || {});
    if (!inventory.equipIsLocked) restoreValues(char.inventory.equipment, inventory.equipment, inventory.equipmentLocks);
    if (!inventory.storageIsLocked) restoreValues(char.inventory.storage, inventory.storage, inventory.storageLocks);

    char.quests = char.quests || {};
    char.quests.main = record.quests.main.locked ? clone(record.quests.main.value)
        : { ...(char.quests.main || {}), isLocked: false };
    const matchesQuest = (a, b) => a.id && b.id ? a.id === b.id : a.name === b.name;
    char.quests.sides = (char.quests.sides || []).map(quest => {
        const saved = record.quests.sides.find(item => matchesQuest(item, quest));
        return saved?.locked ? clone(saved.value) : { ...quest, isLocked: false };
    });
    for (const quest of record.quests.sides) {
        if (quest.locked && !char.quests.sides.some(item => matchesQuest(item, quest))) {
            char.quests.sides.push(clone(quest.value));
        }
    }

    char.relations = Object.fromEntries(Object.entries(char.relations || {}).map(([name, relation]) => [
        name, { ...relation, isLocked: false },
    ]));
    for (const [name, relation] of Object.entries(record.relations)) {
        if (relation.locked) char.relations[name] = clone(relation.value);
    }
}

export function applyLocks(candidate, lockState) {
    const result = clone(candidate || {});
    if (lockState?.version !== 1 || !lockState.world || !lockState.characters) return result;
    result.worldState = result.worldState || {};
    result.worldStateLocks = clone(lockState.world.flags);
    restoreValues(result.worldState, lockState.world.values, lockState.world.flags);
    result.characters = result.characters || [];
    for (const [id, record] of Object.entries(lockState.characters)) {
        let char = result.characters.find(item => item.id === id);
        if (!char) {
            if (!hasProtection(record)) continue;
            char = clone(record.identity);
            result.characters.push(char);
        }
        applyCharacterLocks(char, record);
    }
    return result;
}
