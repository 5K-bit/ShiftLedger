import { LIMITS, asSettings, asShift, type Settings, type Shift } from "./model";

export const BACKUP_APP = "shiftledger";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function backupFileName(now: Date): string {
  return `shiftledger-backup-${now.toISOString().slice(0, 10)}.json`;
}

export function exportBackup(shifts: readonly Shift[], settings: Settings, now: Date): string {
  const doc = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings,
    shifts: [...shifts].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

export type BackupResult =
  | { ok: true; shifts: Shift[]; settings: Settings }
  | { ok: false; error: string };

/** Read a backup file strictly: every shift must pass the same checks as one typed in by hand. */
export function parseBackup(text: string): BackupResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "That file is too large to be a ShiftLedger backup." };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (typeof doc !== "object" || doc === null) return { ok: false, error: "That file is not a ShiftLedger backup." };
  const rec = doc as Record<string, unknown>;
  if (rec["app"] !== BACKUP_APP) return { ok: false, error: "That file is not a ShiftLedger backup." };
  if (rec["version"] !== BACKUP_VERSION) {
    return { ok: false, error: `Unsupported backup version: ${String(rec["version"])}.` };
  }
  const settings = asSettings(rec["settings"]);
  if (!settings) return { ok: false, error: "The backup's settings are not valid." };
  const list = rec["shifts"];
  if (!Array.isArray(list)) return { ok: false, error: "The backup has no list of shifts." };
  if (list.length > LIMITS.maxShifts) return { ok: false, error: "The backup has too many shifts." };
  const shifts: Shift[] = [];
  const seen = new Set<string>();
  for (const [i, item] of list.entries()) {
    const shift = asShift(item);
    if (!shift) return { ok: false, error: `Shift number ${i + 1} is not valid, so nothing was imported.` };
    if (seen.has(shift.id)) return { ok: false, error: `Shift number ${i + 1} repeats an id, so nothing was imported.` };
    seen.add(shift.id);
    shifts.push(shift);
  }
  return { ok: true, shifts, settings };
}
