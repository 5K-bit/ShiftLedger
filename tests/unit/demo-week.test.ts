import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { employerTotals, summarizeWeeks } from "../../src/core/calc";
import { shiftsFromCsv } from "../../src/core/csv";
import { DEFAULT_SETTINGS } from "../../src/core/model";
import { formatCents, formatMinutes } from "../../src/core/time";

const GOLDEN = "docs/evidence/demo-week.txt";

const DEMO_CSV = [
  "employer,start,end,break_minutes,rate,note",
  "Corner Cafe,2026-10-26T08:00,2026-10-26T18:00,0,20.00,",
  "Corner Cafe,2026-10-27T08:00,2026-10-27T18:00,0,20.00,",
  "Corner Cafe,2026-10-28T08:00,2026-10-28T18:00,0,20.00,",
  "Corner Cafe,2026-10-29T08:00,2026-10-29T18:00,0,20.00,",
  "Depot,2026-10-30T08:00,2026-10-30T16:00,0,20.00,Friday cover",
].join("\r\n");

function render(): string {
  const parsed = shiftsFromCsv(DEMO_CSV);
  const shifts = parsed.shifts;
  const weeks = summarizeWeeks(shifts, DEFAULT_SETTINGS);
  const lines = ["# ShiftLedger demo week (default settings: Monday start, overtime after 40h at 150%)", ""];
  for (const w of weeks) {
    lines.push(
      `week of ${w.weekStart}: paid ${formatMinutes(w.paidMinutes)}, regular ${formatMinutes(w.regularMinutes)}, overtime ${formatMinutes(w.overtimeMinutes)}, total ${formatCents(w.totalCents, "USD")}`,
    );
    for (const p of w.shifts) {
      lines.push(`  shift: regular ${formatMinutes(p.regularMinutes)} = ${formatCents(p.regularCents, "USD")}, overtime ${formatMinutes(p.overtimeMinutes)} = ${formatCents(p.overtimeCents, "USD")}`);
    }
  }
  lines.push("", "by employer:");
  for (const e of employerTotals(shifts, weeks)) {
    lines.push(`  ${e.employer}: ${e.shifts} shift(s), ${formatMinutes(e.paidMinutes)}, ${formatCents(e.totalCents, "USD")}`);
  }
  return lines.join("\n") + "\n";
}

describe("demo week golden", () => {
  it("matches the recorded evidence (UPDATE_GOLDEN=1 to re-record)", () => {
    const text = render();
    if (process.env["UPDATE_GOLDEN"] || !existsSync(GOLDEN)) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, text, "utf8");
    }
    expect(readFileSync(GOLDEN, "utf8").replace(/\r\n/g, "\n")).toBe(text);
    expect(text).toContain("total $1,040.00");
  });
});
