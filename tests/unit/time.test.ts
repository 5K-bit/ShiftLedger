import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  decimalHours,
  decimalToCents,
  elapsedMinutes,
  formatCents,
  formatDate,
  formatLocal,
  formatMinutes,
  isLocalDateTime,
  parseLocal,
  weekStart,
} from "../../src/core/time";

describe("parseLocal", () => {
  it("accepts real wall-clock times", () => {
    expect(parseLocal("2026-10-30T09:30")?.getHours()).toBe(9);
    expect(isLocalDateTime("2026-02-28T23:59")).toBe(true);
  });
  it.each([
    "2026-02-30T10:00", // not a date
    "2026-13-01T10:00",
    "2026-10-30T24:00",
    "2026-10-30T10:60",
    "2026-10-30 10:00",
    "2026-10-30T10:00:00",
    "20261030T1000",
    "",
    "tomorrow",
  ])("rejects %s", (text) => {
    expect(parseLocal(text)).toBeNull();
  });
  it("rejects a time that does not exist because clocks jump forward", () => {
    expect(parseLocal("2026-03-08T02:30")).toBeNull(); // New York, spring forward
  });
  it("is not fooled by non-strings", () => {
    expect(isLocalDateTime(5)).toBe(false);
    expect(isLocalDateTime(null)).toBe(false);
  });
});

describe("elapsedMinutes", () => {
  it("counts a plain and an overnight shift", () => {
    expect(elapsedMinutes("2026-10-30T09:00", "2026-10-30T17:30")).toBe(510);
    expect(elapsedMinutes("2026-10-30T22:00", "2026-10-31T06:00")).toBe(480);
  });
  it("measures real time across daylight saving changes", () => {
    expect(elapsedMinutes("2026-03-07T22:00", "2026-03-08T06:00")).toBe(420); // an hour is skipped
    expect(elapsedMinutes("2026-10-31T22:00", "2026-11-01T06:00")).toBe(540); // an hour repeats
  });
  it("is null for invalid input and negative for reversed times", () => {
    expect(elapsedMinutes("bad", "2026-10-30T10:00")).toBeNull();
    expect(elapsedMinutes("2026-10-30T10:00", "bad")).toBeNull();
    expect(elapsedMinutes("2026-10-30T10:00", "2026-10-30T09:00")).toBe(-60);
  });
});

describe("weekStart", () => {
  it("finds Monday and Sunday starts", () => {
    expect(weekStart("2026-10-30T09:00", 1)).toBe("2026-10-26"); // Friday
    expect(weekStart("2026-10-30", 0)).toBe("2026-10-25");
    expect(weekStart("2026-10-26", 1)).toBe("2026-10-26"); // a Monday is its own week start
    expect(weekStart("2026-10-25", 1)).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(weekStart("2026-10-25", 0)).toBe("2026-10-25");
  });
  it("crosses month and year boundaries and daylight saving changes", () => {
    expect(weekStart("2027-01-01", 1)).toBe("2026-12-28");
    expect(weekStart("2026-11-01", 1)).toBe("2026-10-26"); // the fall-back Sunday
    expect(weekStart("2026-03-09", 0)).toBe("2026-03-08");
  });
  it("throws on a non-date", () => {
    expect(() => weekStart("nope", 1)).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("formats durations, hours, dates and money", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(5)).toBe("0h 05m");
    expect(formatMinutes(-90)).toBe("-1h 30m");
    expect(decimalHours(450)).toBe("7.50");
    expect(decimalHours(20)).toBe("0.33");
    expect(formatCents(123456, "USD")).toBe("$1,234.56");
    expect(centsToDecimal(1850)).toBe("18.50");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(formatDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatLocal(new Date(2026, 9, 30, 7, 5))).toBe("2026-10-30T07:05");
  });
  it("parses plain amounts into cents", () => {
    expect(decimalToCents("18.5")).toBe(1850);
    expect(decimalToCents(" 18.50 ")).toBe(1850);
    expect(decimalToCents("18")).toBe(1800);
    expect(decimalToCents("0.05")).toBe(5);
    for (const bad of ["", "-1", "1.234", "1,5", "$5", "1e3", "abc", "12345678"]) {
      expect(decimalToCents(bad)).toBeNull();
    }
  });
});
