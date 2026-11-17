// Story timestamps are optional calendar text, never the device/server clock.
export const WORLD_EVENT_TIME_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'];

export const WORLD_EVENT_TIME_INSTRUCTION = 'World event timestamps describe when that event happened IN THE STORY. Events may include optional startDate, startTime, endDate and endTime text fields. Use only dates/times established by the narrative for that event, including an explicit scene timestamp; omit unknown components rather than inventing precise times. Never use the real-world clock or stamp past events with the current World date/time. Preserve an ongoing event\'s known start and update its end only when the narrative establishes further progress. Keep the event name consistent. A single known moment needs only startDate/startTime; a range may span different dates.';

export const WORLD_EVENT_TIME_EXAMPLE = {
    startDate: '<new_value (optional: in-story start date, only if established)>',
    startTime: '<new_value (optional: in-story start time, only if established)>',
    endDate: '<new_value (optional: in-story end date for a known range)>',
    endTime: '<new_value (optional: in-story end time for a known range)>',
};

export function getWorldEventTiming(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return {};
    const entries = new Map(Object.entries(event).map(([key, value]) => [key.toLowerCase(), value]));
    const timing = {};
    for (const key of WORLD_EVENT_TIME_KEYS) {
        const value = entries.get(key.toLowerCase());
        if (typeof value !== 'string') continue;
        const text = value.trim();
        if (!text || /<new_value/i.test(text) || /^(?:unknown|unspecified|n\/?a|none|null|undefined|\?)$/i.test(text)) continue;
        timing[key] = text;
    }
    return timing;
}

export function mergeWorldEventTiming(previous, incoming) {
    const known = getWorldEventTiming(previous);
    const next = { ...known, ...getWorldEventTiming(incoming) };
    // AI updates may extend a story beat but cannot move an established start.
    // Manual editing saves the full tracker directly and can correct either end.
    if (known.startDate) next.startDate = known.startDate;
    if (known.startTime) next.startTime = known.startTime;
    return next;
}

export function worldEventPromptRecord(event) {
    return typeof event === 'string'
        ? { name: '', desc: event }
        : { name: event?.name || '', desc: event?.desc || '', ...getWorldEventTiming(event) };
}
