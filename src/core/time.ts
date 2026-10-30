/**
 * Local date-times are written "YYYY-MM-DDTHH:mm" (the value of <input type="datetime-local">)
 * and mean wall-clock time where the person is. Durations come from real elapsed time, so a shift
 * that crosses a daylight-saving change is measured correctly.
 */

export type LocalDateTime = string;
export const MAX_SHIFT_MINUTES = 24 * 60;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a local date-time strictly. Returns null for anything that is not a real wall-clock time. */
export function parseLocal(value: string): Date | null {
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  const valid =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi;
  // A time skipped by a spring-forward change (02:30 on that day) does not exist and is refused.
  return valid ? date : null;
}

export function isLocalDateTime(value: unknown): value is LocalDateTime {
  return typeof value === "string" && parseLocal(value) !== null;
}

/** Whole minutes of real elapsed time from start to end, or null if either is invalid. */
export function elapsedMinutes(start: LocalDateTime, end: LocalDateTime): number | null {
  const a = parseLocal(start);
  const b = parseLocal(end);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function formatDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatLocal(d: Date): LocalDateTime {
  return `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The calendar date (YYYY-MM-DD) on which the week containing `value` starts. */
export function weekStart(value: LocalDateTime | string, weekStartsOn: 0 | 1): string {
  const datePart = value.slice(0, 10);
  const m = DATE_RE.exec(datePart);
  if (!m) throw new RangeError(`not a date: ${value}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(y, mo - 1, d, 12, 0, 0, 0); // noon avoids any daylight-saving edge
  const back = (day.getDay() - weekStartsOn + 7) % 7;
  day.setDate(day.getDate() - back);
  return formatDate(day);
}

export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** Decimal hours with two places, for spreadsheets (7.50). */
export function decimalHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Cents as a plain decimal string without a currency symbol (18.50). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
}

/** Parse "18.5" or "18.50" into cents; null if it is not a plain non-negative amount. */
export function decimalToCents(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}
