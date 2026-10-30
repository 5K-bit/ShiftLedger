import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  asSettings,
  asShift,
  checkShiftInput,
  findOverlaps,
  newId,
  type Shift,
} from "../../src/core/model";

const ok = {
  employer: "  Corner Cafe ",
  start: "2026-10-30T09:00",
  end: "2026-10-30T17:00",
  breakMinutes: 30,
  rateCents: 1850,
  note: " opening ",
};

describe("checkShiftInput", () => {
  it("accepts and trims a good shift", () => {
    const r = checkShiftInput(ok);
    expect(r).toEqual({
      ok: true,
      value: { ...ok, employer: "Corner Cafe", note: "opening" },
    });
  });

  it("reports every problem at once", () => {
    const r = checkShiftInput({ employer: "", start: "x", end: "y", breakMinutes: -1, rateCents: 1.5, note: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["breakMinutes", "employer", "end", "rateCents", "start"]);
  });

  it.each([
    [{ ...ok, employer: "x".repeat(LIMITS.employer + 1) }, "employer"],
    [{ ...ok, end: "2026-10-30T09:00" }, "end"],
    [{ ...ok, end: "2026-10-30T08:00" }, "end"],
    [{ ...ok, end: "2026-10-31T09:01" }, "end"],
    [{ ...ok, breakMinutes: 480 }, "breakMinutes"],
    [{ ...ok, breakMinutes: 1.5 }, "breakMinutes"],
    [{ ...ok, breakMinutes: "30" }, "breakMinutes"],
    [{ ...ok, rateCents: -1 }, "rateCents"],
    [{ ...ok, rateCents: LIMITS.maxRateCents + 1 }, "rateCents"],
    [{ ...ok, rateCents: "1850" }, "rateCents"],
    [{ ...ok, note: "x".repeat(LIMITS.note + 1) }, "note"],
  ])("rejects %j", (input, field) => {
    const r = checkShiftInput(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty(field);
  });

  it("allows exactly 24 hours and a missing note", () => {
    const { note: _note, ...rest } = ok;
    void _note;
    expect(checkShiftInput({ ...rest, end: "2026-10-31T09:00", breakMinutes: 0 }).ok).toBe(true);
  });
});

describe("asShift and asSettings", () => {
  it("accepts a stored shift and refuses damaged ones", () => {
    expect(asShift({ id: "a", ...ok })?.employer).toBe("Corner Cafe");
    expect(asShift(null)).toBeNull();
    expect(asShift("x")).toBeNull();
    expect(asShift({ ...ok })).toBeNull(); // no id
    expect(asShift({ id: "", ...ok })).toBeNull();
    expect(asShift({ id: "x".repeat(65), ...ok })).toBeNull();
    expect(asShift({ id: "a", ...ok, rateCents: "x" })).toBeNull();
  });

  it("validates settings", () => {
    expect(asSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(asSettings({ ...DEFAULT_SETTINGS, weekStartsOn: 0, currency: "EUR" })?.currency).toBe("EUR");
    for (const bad of [
      null,
      "x",
      { ...DEFAULT_SETTINGS, weekStartsOn: 2 },
      { ...DEFAULT_SETTINGS, overtimeAfterMinutes: -1 },
      { ...DEFAULT_SETTINGS, overtimeAfterMinutes: 1.5 },
      { ...DEFAULT_SETTINGS, overtimeAfterMinutes: 99999 },
      { ...DEFAULT_SETTINGS, overtimePercent: 99 },
      { ...DEFAULT_SETTINGS, overtimePercent: 401 },
      { ...DEFAULT_SETTINGS, currency: "usd" },
      { ...DEFAULT_SETTINGS, currency: "US" },
      { ...DEFAULT_SETTINGS, currency: "ZZZ9" },
      { ...DEFAULT_SETTINGS, currency: "A1A" },
    ]) {
      expect(asSettings(bad)).toBeNull();
    }
  });
});

describe("findOverlaps", () => {
  const mk = (id: string, start: string, end: string): Shift => ({ id, ...ok, start, end, breakMinutes: 0 });
  it("finds shifts that overlap and ignores ones that merely touch", () => {
    const shifts = [
      mk("a", "2026-10-30T09:00", "2026-10-30T12:00"),
      mk("b", "2026-10-30T11:00", "2026-10-30T14:00"),
      mk("c", "2026-10-30T14:00", "2026-10-30T16:00"),
    ];
    expect(findOverlaps(shifts)).toEqual([["a", "b"]]);
    expect(findOverlaps([])).toEqual([]);
  });
});

describe("newId", () => {
  it("makes distinct ids", () => {
    expect(newId()).not.toBe(newId());
    expect(newId().length).toBeGreaterThan(8);
  });
  it("falls back when randomUUID is missing", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newId()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
