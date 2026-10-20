const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalizedName = value => String(value || '').trim().toLowerCase();

function same(left, right, ignoreIds = false) {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = value => Object.keys(value).filter(key => !ignoreIds || key !== 'id').sort();
    const leftKeys = keys(left);
    const rightKeys = keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && same(left[key], right[key], ignoreIds));
}

function changedFields(before = {}, after = {}, keys = Object.keys(after)) {
    const changes = {};
    for (const key of keys) {
        if (has(after, key) && !same(before?.[key], after[key])) changes[key] = clone(after[key]);
    }
    return changes;
}

function matchingEntry(items, entry) {
    return (items || []).find(item => entry.id && item.id === entry.id)
        || (items || []).find(item => normalizedName(item.name) === normalizedName(entry.name));
}

function typedValue(value, schema) {
    if (!schema?.type) return clone(value);
    const limits = ['min', 'max'].filter(key => typeof schema[key] === 'number')
        .map(key => `, ${key}: ${schema[key]}`).join('');
    return `${String(value ?? '')} (type: ${schema.type}${limits})`;
}

function statusDelta(before, after) {
    const changes = {};
    for (const schema of after.statusSchema || []) {
        if (!has(after.status, schema.id)) continue;
        const previousSchema = (before?.statusSchema || []).find(item => item.id === schema.id);
        const value = after.status[schema.id];
        if (previousSchema && same(before.status?.[schema.id], value)) continue;
        // New schemas need their type/limits during timeline replay. Existing
        // schemas use the actual value, including any clamp applied by the patcher.
        changes[schema.name || schema.id] = previousSchema ? clone(value) : typedValue(value, schema);
    }
    return changes;
}

function inventoryDelta(before = {}, after = {}) {
    const changes = {};
    for (const section of ['equipment', 'storage']) {
        const fields = {};
        for (const [key, value] of Object.entries(after[section] || {})) {
            // Item IDs are generated while parsing and are not a visible change.
            if (!same(before[section]?.[key], value, true)) fields[key] = clone(value);
        }
        if (Object.keys(fields).length) changes[section] = fields;
    }
    return changes;
}

function questData(quest = {}) {
    return {
        name: quest.name || '',
        desc: quest.desc || '',
        isCompleted: Boolean(quest.isCompleted),
    };
}

function questsDelta(before = {}, after = {}) {
    const changes = {};
    if (after.main && !same(questData(before.main), questData(after.main))) {
        changes.main = questData(after.main);
    }
    const sideQuests = (after.sides || []).filter(quest => {
        const previous = matchingEntry(before.sides, quest);
        return !previous || !same(questData(previous), questData(quest));
    }).map(questData);
    if (sideQuests.length) changes.sideQuests = sideQuests;
    return changes;
}

function metricDelta(before = {}, after = {}) {
    const changes = {};
    for (const [name, metric] of Object.entries(after)) {
        const value = metric && typeof metric === 'object' ? metric.value : metric;
        const previous = before[name];
        const previousValue = previous && typeof previous === 'object' ? previous.value : previous;
        if (has(before, name) && same(previousValue, value)) continue;
        changes[name] = has(before, name) ? clone(value) : typedValue(value, metric);
    }
    return changes;
}

function relationsDelta(before = {}, after = {}) {
    const changes = {};
    for (const [target, relation] of Object.entries(after)) {
        const previous = before[target] || {};
        const fields = {};
        if (has(relation, 'text') && relation.text !== previous.text) fields.description = relation.text;
        if (has(relation, 'targetText') && relation.targetText !== previous.targetText) fields.targetDescription = relation.targetText;
        const metrics = metricDelta(previous.values, relation.values);
        const targetMetrics = metricDelta(previous.targetValues, relation.targetValues);
        if (Object.keys(metrics).length) fields.metrics = metrics;
        if (Object.keys(targetMetrics).length) fields.targetMetrics = targetMetrics;
        if (Object.keys(fields).length) changes[target] = fields;
    }
    return changes;
}

/**
 * Build the recap/replay patch from accepted tracker changes, never from the
 * model's untrusted proposed values. This follows the runtime's additive patch
 * format; explicit editor resets/replacements are saved as full snapshots.
 */
export function getAppliedDelta(before, after, _requestedNormalizedPatch = null) {
    if (!after || typeof after !== 'object') return {};
    const delta = {};
    const beforeWorld = before?.worldState || {};
    const afterWorld = after.worldState || {};
    const world = changedFields(beforeWorld, afterWorld, ['date', 'time', 'weather', 'location']);
    const events = (afterWorld.events || []).filter(event => {
        const previous = matchingEntry(beforeWorld.events, event);
        return !previous || !same(previous, event, true);
    }).map(clone);
    if (events.length) world.events = events;
    if (Object.keys(world).length) delta.World = world;

    for (const character of after.characters || []) {
        const previous = (before?.characters || []).find(item => item.id === character.id)
            || (before?.characters || []).find(item => normalizedName(item.name) === normalizedName(character.name));
        const changes = {};
        const sections = {
            status: statusDelta(previous, character),
            profile: changedFields(previous?.profile, character.profile || {}),
            inventory: inventoryDelta(previous?.inventory, character.inventory),
            quests: questsDelta(previous?.quests, character.quests),
            relations: relationsDelta(previous?.relations, character.relations),
        };
        for (const [section, fields] of Object.entries(sections)) {
            if (Object.keys(fields).length) changes[section] = fields;
        }
        if (previous?.activePlayer !== character.activePlayer && typeof character.activePlayer === 'boolean') {
            changes.activePlayer = character.activePlayer;
            // Keep the patcher's legacy flat-status fallback from interpreting
            // this character property as a new status field.
            if (!Object.keys(sections).some(section => has(changes, section))) changes.status = {};
        }
        if (character.name && Object.keys(changes).length) delta[character.name] = changes;
    }
    return delta;
}
