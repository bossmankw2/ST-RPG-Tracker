const months = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthNumber(name) {
  return months.findIndex(month => month === name || month.slice(0, 3) === name || (month === 'september' && name === 'sept')) + 1;
}

// Only compare calendar dates whose year, month and day are unambiguous.
function calendarDay(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase()
    .replace(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+/, '')
    .replace(/\s*\((?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\)$/, '')
    .replace(/\s+(?:ad|ce)$/, '');
  let year, month, day;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else {
    const monthFirst = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
    const dayFirst = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/.exec(text);
    if (!monthFirst && !dayFirst) return null;
    const parts = monthFirst || dayFirst;
    month = monthNumber(parts[monthFirst ? 1 : 2]);
    day = Number(parts[monthFirst ? 2 : 1]);
    year = Number(parts[3]);
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  return year * 10000 + month * 100 + day;
}

function clockSeconds(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*(am|pm)?$/i.exec(value.trim());
  if (!match || (!match[2] && !match[4])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const second = Number(match[3] || 0);
  if (minute > 59 || second > 59) return null;
  if (match[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[4].toLowerCase() === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 3600 + minute * 60 + second;
}

function sortCalendarEntries(result, entries) {
  // A date alone can order different days, but cannot locate a beat among
  // timed events on the same day. Keep those entries in their original slots.
  const daysWithTimes = new Set(entries.filter(entry => entry.time !== null).map(entry => entry.day));
  const movable = entries.filter(({ day, time }) => time !== null || !daysWithTimes.has(day));
  const sorted = [...movable].sort((a, b) => a.day - b.day || a.time - b.time);
  movable.forEach(({ index }, i) => { result[index] = sorted[i].event; });
}

export function sortWorldEventsByTime(events) {
  const calendarDates = [];
  const numberedDays = [];
  events.forEach((event, index) => {
    if (typeof event?.startDate !== 'string') return;
    // The tracker's "Day 1, Day 2..." calendar has no mapping to Gregorian dates.
    const ordinal = /^day\s+(\d+)$/i.exec(event.startDate.trim());
    const day = ordinal ? Number(ordinal[1]) : calendarDay(event.startDate);
    if (!Number.isSafeInteger(day)) return;
    const time = clockSeconds(event.startTime);
    if (time === null && event.startTime != null &&
        (typeof event.startTime !== 'string' || event.startTime.trim() !== '')) return;
    const entries = ordinal ? numberedDays : calendarDates;
    entries.push({ event, index, day, time });
  });

  const result = [...events];
  sortCalendarEntries(result, calendarDates);
  sortCalendarEntries(result, numberedDays);
  return result.every((event, index) => event === events[index]) ? events : result;
}
