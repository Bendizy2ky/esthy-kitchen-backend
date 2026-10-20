export function createReadyAt(readyTime, now = new Date()) {
  const match = readyTime.match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const parts = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
  const utcTimestamp = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour - 1,
    minute
  );

  return new Date(utcTimestamp).toISOString();
}
