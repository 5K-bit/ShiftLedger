import type { Settings, Shift } from "./model";
import { elapsedMinutes, weekStart } from "./time";

export interface ShiftPay {
  id: string;
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  regularCents: number;
  overtimeCents: number;
  totalCents: number;
}

export interface WeekSummary {
  /** First day of the week, YYYY-MM-DD. A shift belongs to the week in which it starts. */
  weekStart: string;
  shifts: ShiftPay[];
  paidMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  totalCents: number;
}

export interface EmployerTotal {
  employer: string;
  shifts: number;
  paidMinutes: number;
  totalCents: number;
}

/** Integer division rounded to nearest, halves up. Money stays in whole cents. */
function divRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function paidMinutes(shift: Shift): number {
  const total = elapsedMinutes(shift.start, shift.end) ?? 0;
  return Math.max(0, total - shift.breakMinutes);
}

/**
 * Group shifts by week and work out pay. Within a week, shifts are taken in time order; the
 * minutes that pass the weekly threshold are overtime and are paid at the overtime percentage.
 */
export function summarizeWeeks(shifts: readonly Shift[], settings: Settings): WeekSummary[] {
  const byWeek = new Map<string, Shift[]>();
  for (const s of shifts) {
    const key = weekStart(s.start, settings.weekStartsOn);
    const list = byWeek.get(key);
    if (list) list.push(s);
    else byWeek.set(key, [s]);
  }
  const weeks: WeekSummary[] = [];
  for (const key of [...byWeek.keys()].sort()) {
    const inWeek = (byWeek.get(key) ?? []).sort(
      (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
    );
    let worked = 0;
    const pays: ShiftPay[] = [];
    for (const s of inWeek) {
      const paid = paidMinutes(s);
      let regular = paid;
      let overtime = 0;
      if (settings.overtimeAfterMinutes > 0) {
        const room = Math.max(0, settings.overtimeAfterMinutes - worked);
        regular = Math.min(paid, room);
        overtime = paid - regular;
      }
      worked += paid;
      const regularCents = divRound(regular * s.rateCents, 60);
      const overtimeCents = divRound(overtime * s.rateCents * settings.overtimePercent, 6000);
      pays.push({
        id: s.id,
        paidMinutes: paid,
        regularMinutes: regular,
        overtimeMinutes: overtime,
        regularCents,
        overtimeCents,
        totalCents: regularCents + overtimeCents,
      });
    }
    weeks.push({
      weekStart: key,
      shifts: pays,
      paidMinutes: pays.reduce((n, p) => n + p.paidMinutes, 0),
      regularMinutes: pays.reduce((n, p) => n + p.regularMinutes, 0),
      overtimeMinutes: pays.reduce((n, p) => n + p.overtimeMinutes, 0),
      totalCents: pays.reduce((n, p) => n + p.totalCents, 0),
    });
  }
  return weeks;
}

export function payById(weeks: readonly WeekSummary[]): Map<string, ShiftPay> {
  const map = new Map<string, ShiftPay>();
  for (const w of weeks) for (const p of w.shifts) map.set(p.id, p);
  return map;
}

export function employerTotals(shifts: readonly Shift[], weeks: readonly WeekSummary[]): EmployerTotal[] {
  const pay = payById(weeks);
  const totals = new Map<string, EmployerTotal>();
  for (const s of shifts) {
    const p = pay.get(s.id);
    const cur = totals.get(s.employer) ?? { employer: s.employer, shifts: 0, paidMinutes: 0, totalCents: 0 };
    cur.shifts += 1;
    cur.paidMinutes += p?.paidMinutes ?? 0;
    cur.totalCents += p?.totalCents ?? 0;
    totals.set(s.employer, cur);
  }
  return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents || a.employer.localeCompare(b.employer));
}
