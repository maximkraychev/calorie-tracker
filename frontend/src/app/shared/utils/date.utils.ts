// Date-only helpers. Diary days are keyed by local ISO date ("2026-07-13") — never
// UTC, so a late-night entry lands on the day the user is actually living.

/** Local midnight today, offset by `days` (e.g. -1 = yesterday). */
export function startOfDay(offsetDays = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/** Local date as "YYYY-MM-DD" (not `toISOString`, which would shift by timezone). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ISO date for today offset by `days`. */
export function isoDateForOffset(offsetDays: number): string {
  return toIsoDate(startOfDay(offsetDays));
}
