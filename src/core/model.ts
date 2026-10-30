import { MAX_SHIFT_MINUTES, elapsedMinutes, isLocalDateTime, type LocalDateTime } from "./time";

export interface Shift {
  id: string;
  employer: string;
  start: LocalDateTime;
  end: LocalDateTime;
  breakMinutes: number;
  /** Hourly rate in cents (1850 = 18.50). Integers only, so money never picks up float error. */
  rateCents: number;
  note: string;
}

export interface Settings {
  weekStartsOn: 0 | 1;
  /** Paid minutes per week after which overtime applies. 0 turns overtime off. */
  overtimeAfterMinutes: number;
  /** Overtime pay as a percentage of the normal rate (150 = time and a half). */
  overtimePercent: number;
  /** ISO 4217 code, three capital letters. */
  currency: string;
}

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 1,
  overtimeAfterMinutes: 40 * 60,
  overtimePercent: 150,
  currency: "USD",
};

export const LIMITS = {
  employer: 80,
  note: 500,
  maxRateCents: 1_000_000,
  maxShifts: 100_000,
} as const;

export type ShiftInput = Omit<Shift, "id">;
export type Errors = Partial<Record<keyof ShiftInput | "settings", string>>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: Errors };

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Validate and normalise the fields of a shift. Never throws; reports every problem found. */
export function checkShiftInput(input: Record<string, unknown>): Checked<ShiftInput> {
  const errors: Errors = {};
  const employer = typeof input["employer"] === "string" ? input["employer"].trim() : "";
  if (employer.length === 0) errors.employer = "Enter an employer or place.";
  else if (employer.length > LIMITS.employer) errors.employer = `At most ${LIMITS.employer} characters.`;

  const start = input["start"];
  const end = input["end"];
  if (!isLocalDateTime(start)) errors.start = "Enter a valid start date and time.";
  if (!isLocalDateTime(end)) errors.end = "Enter a valid end date and time.";

  let minutes: number | null = null;
  if (isLocalDateTime(start) && isLocalDateTime(end)) {
    minutes = elapsedMinutes(start, end);
    if (minutes === null || minutes <= 0) errors.end = "The end must be after the start.";
    else if (minutes > MAX_SHIFT_MINUTES) errors.end = "A shift can be at most 24 hours.";
  }

  const brk = input["breakMinutes"];
  if (!isInt(brk) || brk < 0) errors.breakMinutes = "Enter whole minutes, 0 or more.";
  else if (minutes !== null && brk >= minutes) errors.breakMinutes = "The break must be shorter than the shift.";

  const rate = input["rateCents"];
  if (!isInt(rate) || rate < 0 || rate > LIMITS.maxRateCents) {
    errors.rateCents = "Enter an hourly rate from 0 to 10,000.";
  }

  const note = typeof input["note"] === "string" ? input["note"].trim() : "";
  if (note.length > LIMITS.note) errors.note = `At most ${LIMITS.note} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      employer,
      start: start as string,
      end: end as string,
      breakMinutes: brk as number,
      rateCents: rate as number,
      note,
    },
  };
}

/** A stored record is a Shift if every field passes the same checks (and it has an id). */
export function asShift(value: unknown): Shift | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const id = rec["id"];
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  const checked = checkShiftInput(rec);
  return checked.ok ? { id, ...checked.value } : null;
}

export function asSettings(value: unknown): Settings | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  const ok =
    (s["weekStartsOn"] === 0 || s["weekStartsOn"] === 1) &&
    isInt(s["overtimeAfterMinutes"]) &&
    s["overtimeAfterMinutes"] >= 0 &&
    s["overtimeAfterMinutes"] <= 7 * 24 * 60 &&
    isInt(s["overtimePercent"]) &&
    s["overtimePercent"] >= 100 &&
    s["overtimePercent"] <= 400 &&
    typeof s["currency"] === "string" &&
    /^[A-Z]{3}$/.test(s["currency"]) &&
    isSupportedCurrency(s["currency"]);
  if (!ok) return null;
  return {
    weekStartsOn: s["weekStartsOn"] as 0 | 1,
    overtimeAfterMinutes: s["overtimeAfterMinutes"] as number,
    overtimePercent: s["overtimePercent"] as number,
    currency: s["currency"] as string,
  };
}

function isSupportedCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Pairs of shifts that overlap in time. Reported as a warning, not an error. */
export function findOverlaps(shifts: readonly Shift[]): [string, string][] {
  const sorted = [...shifts].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const out: [string, string][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (!a) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (!b || b.start >= a.end) break;
      out.push([a.id, b.id]);
    }
  }
  return out;
}
