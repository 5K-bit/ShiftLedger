import { describe, expect, it } from "vitest";
import { employerTotals, paidMinutes, payById, summarizeWeeks } from "../../src/core/calc";
import { DEFAULT_SETTINGS, type Settings, type Shift } from "../../src/core/model";

let n = 0;
function shift(start: string, end: string, extra: Partial<Shift> = {}): Shift {
  n += 1;
  return { id: `s${String(n).padStart(3, "0")}`, employer: "Cafe", start, end, breakMinutes: 0, rateCents: 2000, note: "", ...extra };
}

describe("paidMinutes", () => {
  it("subtracts the break", () => {
    expect(paidMinutes(shift("2026-10-26T09:00", "2026-10-26T17:30", { breakMinutes: 30 }))).toBe(480);
  });
  it("is never negative", () => {
    expect(paidMinutes(shift("2026-10-26T09:00", "2026-10-26T10:00", { breakMinutes: 90 }))).toBe(0);
    expect(paidMinutes({ ...shift("x", "y") })).toBe(0);
  });
});

describe("summarizeWeeks", () => {
  it("pays straight time under the threshold, to the cent", () => {
    const w = summarizeWeeks([shift("2026-10-26T09:00", "2026-10-26T17:30", { rateCents: 1850 })], DEFAULT_SETTINGS);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ weekStart: "2026-10-26", paidMinutes: 510, overtimeMinutes: 0, totalCents: 15725 });
  });

  it("splits overtime inside a shift that crosses the weekly threshold", () => {
    // Mon-Thu four 10h shifts = 40h exactly, Friday 8h is all overtime.
    const shifts = [
      shift("2026-10-26T08:00", "2026-10-26T18:00"),
      shift("2026-10-27T08:00", "2026-10-27T18:00"),
      shift("2026-10-28T08:00", "2026-10-28T18:00"),
      shift("2026-10-29T08:00", "2026-10-29T18:00"),
      shift("2026-10-30T08:00", "2026-10-30T16:00"),
    ];
    const [week] = summarizeWeeks(shifts, DEFAULT_SETTINGS);
    expect(week).toMatchObject({ regularMinutes: 2400, overtimeMinutes: 480, paidMinutes: 2880 });
    // 40h x $20 + 8h x $30
    expect(week?.totalCents).toBe(80000 + 24000);

    const crossing = [...shifts.slice(0, 3), shift("2026-10-29T08:00", "2026-10-29T20:00")];
    const [w2] = summarizeWeeks(crossing, DEFAULT_SETTINGS);
    expect(w2?.shifts[3]).toMatchObject({ regularMinutes: 600, overtimeMinutes: 120 });
  });

  it("takes shifts in time order whatever order they were given", () => {
    const a = shift("2026-10-26T08:00", "2026-10-26T18:00");
    const b = shift("2026-10-27T08:00", "2026-10-27T20:00");
    const small: Settings = { ...DEFAULT_SETTINGS, overtimeAfterMinutes: 600 };
    const forward = summarizeWeeks([a, b], small)[0];
    const backward = summarizeWeeks([b, a], small)[0];
    expect(backward).toEqual(forward);
    expect(forward?.overtimeMinutes).toBe(720);
  });

  it("can switch overtime off, and uses the multiplier", () => {
    const long = [shift("2026-10-26T00:00", "2026-10-26T23:00", { rateCents: 1000 })];
    const off = summarizeWeeks(long, { ...DEFAULT_SETTINGS, overtimeAfterMinutes: 0 })[0];
    expect(off?.overtimeMinutes).toBe(0);
    expect(off?.totalCents).toBe(23000);
    const double = summarizeWeeks(long, { ...DEFAULT_SETTINGS, overtimeAfterMinutes: 1200, overtimePercent: 200 })[0];
    expect(double).toMatchObject({ regularMinutes: 1200, overtimeMinutes: 180 });
    expect(double?.totalCents).toBe(20000 + 6000);
  });

  it("starts weeks on Sunday when asked and keeps weeks separate and sorted", () => {
    const shifts = [shift("2026-11-02T09:00", "2026-11-02T10:00"), shift("2026-10-25T09:00", "2026-10-25T10:00")];
    expect(summarizeWeeks(shifts, DEFAULT_SETTINGS).map((w) => w.weekStart)).toEqual(["2026-10-19", "2026-11-02"]);
    expect(summarizeWeeks(shifts, { ...DEFAULT_SETTINGS, weekStartsOn: 0 }).map((w) => w.weekStart)).toEqual([
      "2026-10-25",
      "2026-11-01",
    ]);
  });

  it("rounds each portion to whole cents, halves up", () => {
    // 1 minute at $0.35/h is 0.583 cents -> 1; 1 minute at $0.30/h is 0.5 cents -> 1 (half up)
    expect(summarizeWeeks([shift("2026-10-26T09:00", "2026-10-26T09:01", { rateCents: 35 })], DEFAULT_SETTINGS)[0]?.totalCents).toBe(1);
    expect(summarizeWeeks([shift("2026-10-26T09:00", "2026-10-26T09:01", { rateCents: 30 })], DEFAULT_SETTINGS)[0]?.totalCents).toBe(1);
    expect(summarizeWeeks([shift("2026-10-26T09:00", "2026-10-26T09:01", { rateCents: 29 })], DEFAULT_SETTINGS)[0]?.totalCents).toBe(0);
  });

  it("handles an empty list and a night shift across daylight saving", () => {
    expect(summarizeWeeks([], DEFAULT_SETTINGS)).toEqual([]);
    const night = shift("2026-03-07T22:00", "2026-03-08T06:00", { rateCents: 3000 });
    expect(summarizeWeeks([night], DEFAULT_SETTINGS)[0]?.paidMinutes).toBe(420);
  });
});

describe("totals", () => {
  it("indexes pay by id and totals per employer, biggest first", () => {
    const shifts = [
      shift("2026-10-26T09:00", "2026-10-26T10:00", { employer: "Cafe", rateCents: 1000 }),
      shift("2026-10-27T09:00", "2026-10-27T13:00", { employer: "Depot", rateCents: 2000 }),
      shift("2026-10-28T09:00", "2026-10-28T10:00", { employer: "Cafe", rateCents: 1000 }),
    ];
    const weeks = summarizeWeeks(shifts, DEFAULT_SETTINGS);
    expect(payById(weeks).get(shifts[1]?.id ?? "")?.totalCents).toBe(8000);
    expect(employerTotals(shifts, weeks)).toEqual([
      { employer: "Depot", shifts: 1, paidMinutes: 240, totalCents: 8000 },
      { employer: "Cafe", shifts: 2, paidMinutes: 120, totalCents: 2000 },
    ]);
    // a shift missing from the weeks counts as zero rather than crashing
    expect(employerTotals(shifts, [])[0]?.totalCents).toBe(0);
  });
});
