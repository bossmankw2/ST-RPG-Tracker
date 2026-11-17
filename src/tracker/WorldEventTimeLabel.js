// Story dates can use fictional calendars. Display the supplied text without
// interpreting it in the browser's calendar, timezone, or wall-clock time.
export function formatWorldEventTime(event) {
  const text = key => typeof event?.[key] === 'string' ? event[key].trim() : '';
  const startDate = text('startDate');
  const startTime = text('startTime');
  const endDate = text('endDate');
  const endTime = text('endTime');
  const start = [startDate, startTime].filter(Boolean).join(' · ');
  const end = [endDate, endTime].filter(Boolean).join(' · ');

  if (!start && !end) return '';
  if (startDate && startDate === endDate && startTime && endTime) {
    return `${startDate} · ${startTime}–${endTime}`;
  }
  if (start && end) return `Start: ${start} → End: ${end}`;
  return start ? `Start: ${start}` : `End: ${end}`;
}

// String renderers need escaped text; React escapes the plain formatter itself.
export function formatWorldEventTimeHtml(event) {
  const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return formatWorldEventTime(event).replace(/[&<>"']/g, char => escapes[char]);
}
