import { asShift, newId, type Shift } from "./model";
import { summarizeWeeks, payById } from "./calc";
import type { Settings } from "./model";
import { centsToDecimal, decimalHours, decimalToCents } from "./time";

export const CSV_HEADER = [
  "employer",
  "start",
  "end",
  "break_minutes",
  "paid_hours",
  "rate",
  "regular_pay",
  "overtime_pay",
  "total_pay",
  "note",
] as const;

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Quote one cell. Cells that a spreadsheet would read as a formula get a leading apostrophe,
 * so "=HYPERLINK(...)" typed as an employer name cannot run when the file is opened.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(shifts: readonly Shift[], settings: Settings): string {
  const pay = payById(summarizeWeeks(shifts, settings));
  const rows = [...shifts]
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map((s) => {
      const p = pay.get(s.id);
      return [
        s.employer,
        s.start,
        s.end,
        String(s.breakMinutes),
        decimalHours(p?.paidMinutes ?? 0),
        centsToDecimal(s.rateCents),
        centsToDecimal(p?.regularCents ?? 0),
        centsToDecimal(p?.overtimeCents ?? 0),
        centsToDecimal(p?.totalCents ?? 0),
        s.note,
      ];
    });
  return [CSV_HEADER as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 parser: quoted cells, doubled quotes, CRLF or LF, blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const endRow = (): void => {
    row.push(cell);
    cell = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw new RangeError("The file ends inside a quoted cell.");
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

export interface CsvImport {
  shifts: Shift[];
  errors: { row: number; message: string }[];
}

export const MAX_CSV_ROWS = 100_000;

/** Undo csvCell's apostrophe, but only where it was put in front of a formula character. */
function unguard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/** Read shifts from a CSV (our own export, or any file with the same employer/start/end columns). */
export function shiftsFromCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string): number => header.indexOf(name);
  const need = ["employer", "start", "end", "rate"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length > 0) {
    return { shifts: [], errors: [{ row: 1, message: `Missing column(s): ${missing.join(", ")}.` }] };
  }
  if (rows.length - 1 > MAX_CSV_ROWS) {
    return { shifts: [], errors: [{ row: 1, message: `More than ${MAX_CSV_ROWS} rows.` }] };
  }
  const out: CsvImport = { shifts: [], errors: [] };
  const cell = (r: string[], name: string): string => unguard(r[col(name)] ?? "");
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const rate = decimalToCents(cell(r, "rate"));
    const breakText = col("break_minutes") >= 0 ? cell(r, "break_minutes").trim() : "0";
    const shift = asShift({
      id: newId(),
      employer: cell(r, "employer"),
      start: cell(r, "start").trim(),
      end: cell(r, "end").trim(),
      breakMinutes: breakText === "" ? 0 : /^\d+$/.test(breakText) ? Number(breakText) : -1,
      rateCents: rate ?? -1,
      note: col("note") >= 0 ? cell(r, "note") : "",
    });
    if (shift) out.shifts.push(shift);
    else out.errors.push({ row: rowNo, message: "Not a valid shift (check employer, times, break and rate)." });
  });
  return out;
}
