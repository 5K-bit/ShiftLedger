import { describe, expect, it } from "vitest";
import { CSV_HEADER, csvCell, parseCsv, shiftsFromCsv, toCsv } from "../../src/core/csv";
import { BACKUP_VERSION, MAX_BACKUP_BYTES, exportBackup, parseBackup } from "../../src/core/backup";
import { DEFAULT_SETTINGS, type Shift } from "../../src/core/model";

const base: Shift = {
  id: "a1",
  employer: "Corner Cafe",
  start: "2026-10-26T09:00",
  end: "2026-10-26T17:30",
  breakMinutes: 30,
  rateCents: 1850,
  note: "opening",
};

describe("csvCell", () => {
  it("quotes cells that need it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=x", "\r=x"])("neutralises a formula start: %j", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });
});

describe("toCsv", () => {
  it("writes a header, pay columns and CRLF rows", () => {
    const csv = toCsv([base], DEFAULT_SETTINGS);
    const [head, row] = csv.split("\r\n");
    expect(head).toBe(CSV_HEADER.join(","));
    expect(row).toBe("Corner Cafe,2026-10-26T09:00,2026-10-26T17:30,30,8.00,18.50,148.00,0.00,148.00,opening");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("sorts by start and guards hostile text", () => {
    const evil = { ...base, id: "a2", employer: '=HYPERLINK("http://x.test","y")', start: "2026-10-25T09:00", end: "2026-10-25T10:00", breakMinutes: 0 };
    const csv = toCsv([base, evil], DEFAULT_SETTINGS);
    const lines = csv.split("\r\n");
    expect(lines[1]?.startsWith(`"'=HYPERLINK(""http://x.test"",""y"")"`)).toBe(true);
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF, LF, blank lines and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\rc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
  it("refuses an unterminated quote", () => {
    expect(() => parseCsv('a,"b')).toThrow(RangeError);
  });
});

describe("shiftsFromCsv", () => {
  it("round-trips our own export, including a hostile employer name", () => {
    const evil: Shift = { ...base, id: "a2", employer: "=cmd|' /C calc'!A0", note: 'a "q", b\nc', start: "2026-10-27T09:00", end: "2026-10-27T11:00", breakMinutes: 0 };
    const csv = toCsv([base, evil], DEFAULT_SETTINGS);
    const back = shiftsFromCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.shifts.map((s) => ({ employer: s.employer, start: s.start, end: s.end, breakMinutes: s.breakMinutes, rateCents: s.rateCents, note: s.note }))).toEqual([
      { employer: "Corner Cafe", start: base.start, end: base.end, breakMinutes: 30, rateCents: 1850, note: "opening" },
      { employer: evil.employer, start: evil.start, end: evil.end, breakMinutes: 0, rateCents: 1850, note: evil.note },
    ]);
  });
  it("accepts a minimal file and reports bad rows by number", () => {
    const text = "employer,start,end,rate\nA,2026-10-26T09:00,2026-10-26T10:00,10\nB,nope,2026-10-26T10:00,10\nC,2026-10-26T09:00,2026-10-26T10:00,ten\n";
    const r = shiftsFromCsv(text);
    expect(r.shifts).toHaveLength(1);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
  });
  it("rejects a bad break, a missing column and too many rows", () => {
    expect(shiftsFromCsv("employer,start,end,rate,break_minutes\nA,2026-10-26T09:00,2026-10-26T10:00,10,x\n").errors).toHaveLength(1);
    expect(shiftsFromCsv("employer,start,end,rate,break_minutes\nA,2026-10-26T09:00,2026-10-26T10:00,10,\n").shifts).toHaveLength(1);
    expect(shiftsFromCsv("employer,start\nA,B\n").errors[0]?.message).toContain("end, rate");
    expect(shiftsFromCsv("").errors[0]?.row).toBe(1);
  });
});

describe("backup", () => {
  const settings = { ...DEFAULT_SETTINGS, weekStartsOn: 0 as const };
  it("round-trips", () => {
    const text = exportBackup([base], settings, new Date("2026-10-30T12:00:00Z"));
    expect(JSON.parse(text).exportedAt).toBe("2026-10-30T12:00:00.000Z");
    expect(parseBackup(text)).toEqual({ ok: true, shifts: [base], settings });
  });
  const good = (): Record<string, unknown> => ({ app: "shiftledger", version: BACKUP_VERSION, settings, shifts: [base] });
  it.each([
    ["not json", "{"],
    ["a number", "5"],
    ["null", "null"],
    ["another app", JSON.stringify({ ...good(), app: "other" })],
    ["a future version", JSON.stringify({ ...good(), version: 2 })],
    ["bad settings", JSON.stringify({ ...good(), settings: { currency: "x" } })],
    ["no shift list", JSON.stringify({ ...good(), shifts: {} })],
    ["a bad shift", JSON.stringify({ ...good(), shifts: [base, { ...base, id: "b", rateCents: -1 }] })],
    ["a repeated id", JSON.stringify({ ...good(), shifts: [base, base] })],
  ])("refuses %s", (_name, text) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
  });
  it("refuses an oversized file", () => {
    expect(parseBackup("x".repeat(MAX_BACKUP_BYTES + 1)).ok).toBe(false);
  });
  it("refuses too many shifts", () => {
    const many = Array.from({ length: 100_001 }, (_, i) => ({ ...base, id: `i${i}` }));
    const r = parseBackup(JSON.stringify({ ...good(), shifts: many }));
    expect(r).toEqual({ ok: false, error: "The backup has too many shifts." });
  });
});
