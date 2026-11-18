/** Everything on screen uses Philippine time in 12-hour AM/PM, never 24-hour. */
export const SCHOOL_TIME_ZONE = 'Asia/Manila';

/** "08:00" or "16:30" (how event times are stored) → "8:00 AM" or "4:30 PM". */
export function clock12(value: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? '').trim());
  if (!match) return value ?? '';
  const hours = Number(match[1]);
  if (hours > 23) return value ?? '';
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
}

/** A real moment in time (ISO text or Date) → "7:44 AM" in Philippine time. */
export function timeOfDay(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/** "Nov 18, 2026, 7:44 AM" style stamp in Philippine time. */
export function dateTimeLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SCHOOL_TIME_ZONE,
  });
}

/** Today's date (or the date of a given moment) in the Philippines, as YYYY-MM-DD. */
export function schoolDateKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: SCHOOL_TIME_ZONE });
}

/** An event date + time ("2026-11-20", "08:00") as a real moment, read as Philippine time. */
export function eventMoment(date: string, time: string): Date {
  return new Date(`${date}T${time || '00:00'}:00+08:00`);
}

/** A YYYY-MM-DD date moved by some days (plain calendar math, no timezone surprises). */
export function addDaysToKey(dateKey: string, days: number): string {
  const moved = new Date(`${dateKey}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}
