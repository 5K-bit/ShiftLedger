import { backupFileName, exportBackup, parseBackup, MAX_BACKUP_BYTES } from "../core/backup";
import { employerTotals, payById, summarizeWeeks } from "../core/calc";
import { shiftsFromCsv, toCsv } from "../core/csv";
import {
  DEFAULT_SETTINGS,
  asSettings,
  checkShiftInput,
  findOverlaps,
  newId,
  type Errors,
  type Settings,
  type Shift,
} from "../core/model";
import {
  centsToDecimal,
  decimalToCents,
  formatCents,
  formatLocal,
  formatMinutes,
  parseLocal,
} from "../core/time";
import { LedgerDB } from "../storage/db";
import { downloadText, h } from "./dom";

type Tab = "shifts" | "summary" | "settings" | "backup";
type Flash = { kind: "ok" | "bad" | "warn"; text: string } | null;

interface Draft {
  employer: string;
  start: string;
  end: string;
  breakMinutes: string;
  rate: string;
  note: string;
}

interface State {
  shifts: Shift[];
  settings: Settings;
  skipped: number;
  tab: Tab;
  editing: string | null;
  draft: Draft;
  errors: Errors;
  flash: Flash;
  confirm: string | null;
  pendingRestore: { shifts: Shift[]; settings: Settings } | null;
  persisted: boolean | null;
}

const MAX_FILE_BYTES = MAX_BACKUP_BYTES;

function emptyDraft(prev?: Shift): Draft {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const start = new Date(now);
  start.setHours(9);
  const end = new Date(now);
  end.setHours(17);
  return {
    employer: prev?.employer ?? "",
    start: formatLocal(start),
    end: formatLocal(end),
    breakMinutes: String(prev?.breakMinutes ?? 30),
    rate: prev ? centsToDecimal(prev.rateCents) : "",
    note: "",
  };
}

function draftFrom(s: Shift): Draft {
  return {
    employer: s.employer,
    start: s.start,
    end: s.end,
    breakMinutes: String(s.breakMinutes),
    rate: centsToDecimal(s.rateCents),
    note: s.note,
  };
}

const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });
const dayLabel = (local: string): string => {
  const d = parseLocal(local.length === 10 ? `${local}T12:00` : local);
  return d ? dayFmt.format(d) : local;
};
const timeRange = (s: Shift): string => `${s.start.slice(11)}–${s.end.slice(11)}`;

export async function start(root: HTMLElement, db: LedgerDB): Promise<void> {
  const { shifts, settings, skipped } = { ...(await db.list()), settings: await db.getSettings() };
  const state: State = {
    shifts,
    settings,
    skipped,
    tab: "shifts",
    editing: null,
    draft: emptyDraft(shifts.at(-1)),
    errors: {},
    flash: skipped > 0 ? { kind: "warn", text: `${skipped} stored record(s) are damaged and hidden. They were not deleted.` } : null,
    confirm: null,
    pendingRestore: null,
    persisted: null,
  };
  if (navigator.storage?.persisted) state.persisted = await navigator.storage.persisted();

  const reload = async (): Promise<void> => {
    const listing = await db.list();
    state.shifts = listing.shifts;
    state.skipped = listing.skipped;
    state.settings = await db.getSettings();
  };

  const say = (kind: "ok" | "bad" | "warn", text: string): void => {
    state.flash = { kind, text };
  };

  const run = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      say("bad", error instanceof Error ? error.message : "Something went wrong.");
    }
    render();
  };

  // ---- Shifts -------------------------------------------------------------------------------

  const saveShift = (): Promise<void> =>
    run(async () => {
      const d = state.draft;
      const rate = decimalToCents(d.rate);
      const brk = /^\d+$/.test(d.breakMinutes.trim()) ? Number(d.breakMinutes) : -1;
      const checked = checkShiftInput({
        employer: d.employer,
        start: d.start,
        end: d.end,
        breakMinutes: brk,
        rateCents: rate ?? -1,
        note: d.note,
      });
      if (!checked.ok) {
        state.errors = checked.errors;
        say("bad", "Fix the highlighted fields.");
        return;
      }
      state.errors = {};
      const shift: Shift = { id: state.editing ?? newId(), ...checked.value };
      await db.put(shift);
      await reload();
      state.draft = emptyDraft(shift);
      state.editing = null;
      say("ok", "Shift saved.");
    });

  const field = (
    name: keyof Draft,
    label: string,
    attrs: Record<string, string | number | boolean> = {},
    list?: HTMLElement,
  ): HTMLElement => {
    const errKey = name === "rate" ? "rateCents" : name === "breakMinutes" ? "breakMinutes" : name;
    const err = state.errors[errKey as keyof Errors];
    const id = `f-${name}`;
    const input = h("input", {
      id,
      name,
      value: state.draft[name],
      "aria-invalid": err ? "true" : null,
      "aria-describedby": err ? `${id}-err` : null,
      oninput: (e: Event) => {
        state.draft[name] = (e.target as HTMLInputElement).value;
      },
      ...attrs,
    });
    return h(
      "div",
      { class: `field${name === "note" ? " wide" : ""}` },
      h("label", { for: id }, label),
      input,
      list,
      err ? h("p", { class: "err", id: `${id}-err`, role: "alert" }, err) : null,
    );
  };

  const shiftsView = (): HTMLElement => {
    const weeks = summarizeWeeks(state.shifts, state.settings);
    const pay = payById(weeks);
    const employers = [...new Set(state.shifts.map((s) => s.employer))].sort();
    const datalist = h("datalist", { id: "employers" }, ...employers.map((e) => h("option", { value: e })));
    const form = h(
      "form",
      {
        class: "grid",
        novalidate: true,
        "aria-label": state.editing ? "Edit shift" : "Add shift",
        onsubmit: (e: Event) => {
          e.preventDefault();
          void saveShift();
        },
      },
      field("employer", "Employer or place", { autocomplete: "off", list: "employers", maxlength: 80 }, datalist),
      field("start", "Start", { type: "datetime-local" }),
      field("end", "End", { type: "datetime-local" }),
      field("breakMinutes", "Unpaid break (minutes)", { inputmode: "numeric" }),
      field("rate", "Hourly rate", { inputmode: "decimal", placeholder: "18.50" }),
      field("note", "Note (optional)", { maxlength: 500 }),
      h(
        "div",
        { class: "field wide actions" },
        h("button", { class: "btn", type: "submit" }, state.editing ? "Save changes" : "Add shift"),
        state.editing
          ? h(
              "button",
              {
                class: "btn ghost",
                type: "button",
                onclick: () => {
                  state.editing = null;
                  state.errors = {};
                  state.draft = emptyDraft(state.shifts.at(-1));
                  render();
                },
              },
              "Cancel",
            )
          : null,
      ),
    );

    const overlaps = findOverlaps(state.shifts);
    const rows = [...state.shifts].reverse().map((s) => {
      const p = pay.get(s.id);
      const asking = state.confirm === s.id;
      return h(
        "tr",
        { "data-shift": s.id },
        h("td", {}, dayLabel(s.start)),
        h("td", {}, s.employer, s.note ? h("div", { class: "mute" }, s.note) : null),
        h("td", {}, timeRange(s)),
        h(
          "td",
          { class: "num" },
          formatMinutes(p?.paidMinutes ?? 0),
          p && p.overtimeMinutes > 0 ? h("div", {}, h("span", { class: "tag" }, `OT ${formatMinutes(p.overtimeMinutes)}`)) : null,
        ),
        h("td", { class: "num" }, formatCents(p?.totalCents ?? 0, state.settings.currency)),
        h(
          "td",
          { class: "actions" },
          asking
            ? [
                h("button", { class: "btn danger", type: "button", onclick: () => void run(async () => {
                  await db.remove(s.id);
                  await reload();
                  state.confirm = null;
                  say("ok", "Shift deleted.");
                }) }, "Delete"),
                h("button", { class: "btn ghost", type: "button", onclick: () => { state.confirm = null; render(); } }, "Keep"),
              ]
            : [
                h("button", { class: "btn ghost", type: "button", "aria-label": `Edit ${s.employer} on ${dayLabel(s.start)}`, onclick: () => {
                  state.editing = s.id;
                  state.draft = draftFrom(s);
                  state.errors = {};
                  render();
                  window.scrollTo({ top: 0 });
                } }, "Edit"),
                h("button", { class: "btn ghost", type: "button", "aria-label": `Delete ${s.employer} on ${dayLabel(s.start)}`, onclick: () => { state.confirm = s.id; render(); } }, "Delete"),
              ],
        ),
      );
    });

    return h(
      "section",
      {},
      h("div", { class: "card" }, h("h2", {}, state.editing ? "Edit shift" : "Add a shift"), form),
      overlaps.length > 0
        ? h("p", { class: "flash warn", role: "status" }, `${overlaps.length} pair(s) of shifts overlap. Both are counted in full.`)
        : null,
      state.shifts.length === 0
        ? h("p", { class: "empty" }, "No shifts yet. Add your first one above. Everything is stored in this browser only.")
        : h(
            "table",
            {},
            h("thead", {}, h("tr", {}, ...["Day", "Employer", "Time"].map((t) => h("th", {}, t)), h("th", { class: "num" }, "Paid"), h("th", { class: "num" }, "Pay"), h("th", {}, h("span", { class: "sr" }, "Actions")))),
            h("tbody", {}, ...rows),
          ),
    );
  };

  // ---- Summary ------------------------------------------------------------------------------

  const summaryView = (): HTMLElement => {
    const weeks = summarizeWeeks(state.shifts, state.settings);
    if (weeks.length === 0) return h("p", { class: "empty" }, "Add shifts to see weekly totals.");
    const money = (c: number): string => formatCents(c, state.settings.currency);
    const grand = weeks.reduce((n, w) => n + w.totalCents, 0);
    const grandMinutes = weeks.reduce((n, w) => n + w.paidMinutes, 0);
    const cards = [...weeks].reverse().map((w) =>
      h(
        "div",
        { class: "card week", "data-week": w.weekStart },
        h(
          "div",
          { class: "row" },
          h("h3", {}, `Week of ${dayLabel(w.weekStart)}`),
          h("span", { class: "big" }, money(w.totalCents)),
        ),
        h(
          "p",
          { class: "mute" },
          `${formatMinutes(w.paidMinutes)} paid · ${w.shifts.length} shift(s)`,
          w.overtimeMinutes > 0 ? ` · ` : "",
          w.overtimeMinutes > 0 ? h("span", { class: "tag" }, `OT ${formatMinutes(w.overtimeMinutes)}`) : null,
        ),
      ),
    );
    const totals = employerTotals(state.shifts, weeks);
    return h(
      "section",
      {},
      h("div", { class: "card" }, h("div", { class: "row week" }, h("h3", {}, "All time"), h("span", { class: "big", id: "grand-total" }, money(grand))), h("p", { class: "mute" }, `${formatMinutes(grandMinutes)} paid across ${state.shifts.length} shift(s)`)),
      h("h2", {}, "Weeks"),
      ...cards,
      h("h2", {}, "By employer"),
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "Employer"), h("th", { class: "num" }, "Shifts"), h("th", { class: "num" }, "Paid"), h("th", { class: "num" }, "Pay"))),
        h("tbody", {}, ...totals.map((t) => h("tr", {}, h("td", {}, t.employer), h("td", { class: "num" }, String(t.shifts)), h("td", { class: "num" }, formatMinutes(t.paidMinutes)), h("td", { class: "num" }, money(t.totalCents))))),
      ),
      h("p", { class: "mute" }, "A shift counts in the week it starts. Pay is an estimate from the rates you entered; it is not a payslip."),
    );
  };

  // ---- Settings -----------------------------------------------------------------------------

  const settingsView = (): HTMLElement => {
    const s = state.settings;
    const week = h("select", { id: "s-week" }, h("option", { value: "1", selected: s.weekStartsOn === 1 }, "Monday"), h("option", { value: "0", selected: s.weekStartsOn === 0 }, "Sunday"));
    const hours = h("input", { id: "s-ot", inputmode: "decimal", value: String(s.overtimeAfterMinutes / 60) });
    const pct = h("input", { id: "s-pct", inputmode: "numeric", value: String(s.overtimePercent) });
    const cur = h("input", { id: "s-cur", maxlength: 3, value: s.currency, autocomplete: "off" });
    return h(
      "section",
      { class: "card" },
      h("h2", {}, "Settings"),
      h(
        "form",
        {
          class: "grid",
          onsubmit: (e: Event) => {
            e.preventDefault();
            void run(async () => {
              const hoursNum = Number(hours.value);
              const candidate = {
                weekStartsOn: Number(week.value),
                overtimeAfterMinutes: Number.isFinite(hoursNum) ? Math.round(hoursNum * 60) : -1,
                overtimePercent: Number(pct.value),
                currency: cur.value.trim().toUpperCase(),
              };
              const valid = asSettings(candidate);
              if (!valid) {
                say("bad", "Check the settings: hours 0–168, overtime 100–400%, and a three-letter currency code such as USD.");
                return;
              }
              await db.putSettings(valid);
              await reload();
              say("ok", "Settings saved.");
            });
          },
        },
        h("div", { class: "field" }, h("label", { for: "s-week" }, "Week starts on"), week),
        h("div", { class: "field" }, h("label", { for: "s-ot" }, "Overtime after (hours per week, 0 = off)"), hours),
        h("div", { class: "field" }, h("label", { for: "s-pct" }, "Overtime pays (% of normal rate)"), pct),
        h("div", { class: "field" }, h("label", { for: "s-cur" }, "Currency code"), cur),
        h("div", { class: "field wide actions" }, h("button", { class: "btn", type: "submit" }, "Save settings"), h("button", { class: "btn ghost", type: "button", onclick: () => void run(async () => {
          await db.putSettings({ ...DEFAULT_SETTINGS });
          await reload();
          say("ok", "Settings reset to the defaults.");
        }) }, "Reset to defaults")),
      ),
    );
  };

  // ---- Backup -------------------------------------------------------------------------------

  const readFile = async (input: HTMLInputElement): Promise<string | null> => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      say("bad", "That file is too large.");
      return null;
    }
    return file.text();
  };

  const backupView = (): HTMLElement => {
    const jsonInput = h("input", { id: "restore-file", type: "file", accept: ".json,application/json", class: "sr", onchange: () => void run(async () => {
      const text = await readFile(jsonInput);
      if (text === null) return;
      const result = parseBackup(text);
      if (!result.ok) {
        say("bad", result.error);
        return;
      }
      state.pendingRestore = { shifts: result.shifts, settings: result.settings };
    }) });
    const csvInput = h("input", { id: "csv-file", type: "file", accept: ".csv,text/csv", class: "sr", onchange: () => void run(async () => {
      const text = await readFile(csvInput);
      if (text === null) return;
      let parsed;
      try {
        parsed = shiftsFromCsv(text);
      } catch (error) {
        say("bad", error instanceof Error ? error.message : "That file could not be read.");
        return;
      }
      if (parsed.shifts.length > 0) {
        await db.putMany(parsed.shifts);
        await reload();
      }
      const bad = parsed.errors.length;
      say(bad > 0 ? "warn" : "ok", `Imported ${parsed.shifts.length} shift(s)${bad > 0 ? `; skipped ${bad} row(s) (first problem: row ${parsed.errors[0]?.row}).` : "."}`);
    }) });

    const pending = state.pendingRestore;
    return h(
      "section",
      {},
      h("div", { class: "card" },
        h("h2", {}, "Back up"),
        h("p", { class: "mute" }, "Your shifts live only in this browser. A backup file is your safety copy: keep one somewhere else."),
        h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", id: "export-json", onclick: () => {
            downloadText(backupFileName(new Date()), "application/json", exportBackup(state.shifts, state.settings, new Date()));
            say("ok", "Backup downloaded.");
            render();
          } }, "Download backup (JSON)"),
          h("button", { class: "btn ghost", type: "button", id: "export-csv", onclick: () => {
            downloadText("shiftledger-shifts.csv", "text/csv", toCsv(state.shifts, state.settings));
            say("ok", "CSV downloaded.");
            render();
          } }, "Export CSV"),
        ),
      ),
      h("div", { class: "card" },
        h("h2", {}, "Restore or import"),
        h("div", { class: "actions" },
          h("label", { class: "btn ghost", for: "restore-file", role: "button", tabindex: 0 }, "Restore from backup…"),
          jsonInput,
          h("label", { class: "btn ghost", for: "csv-file", role: "button", tabindex: 0 }, "Import CSV (adds shifts)…"),
          csvInput,
        ),
        pending
          ? h("div", { class: "flash warn", role: "alert", id: "restore-confirm" },
              h("p", {}, `This backup has ${pending.shifts.length} shift(s). Restoring replaces everything now stored here (${state.shifts.length} shift(s)).`),
              h("div", { class: "actions" },
                h("button", { class: "btn danger", type: "button", id: "restore-yes", onclick: () => void run(async () => {
                  await db.replaceAll(pending.shifts, pending.settings);
                  state.pendingRestore = null;
                  await reload();
                  say("ok", `Restored ${pending.shifts.length} shift(s).`);
                }) }, "Replace with backup"),
                h("button", { class: "btn ghost", type: "button", onclick: () => { state.pendingRestore = null; render(); } }, "Cancel"),
              ),
            )
          : null,
        h("p", { class: "mute" }, "CSV import adds rows and never removes anything. Columns: employer, start, end, rate, and optionally break_minutes and note."),
      ),
      h("div", { class: "card" },
        h("h2", {}, "Storage"),
        h("p", {}, `Persistent storage: ${state.persisted === null ? "not supported by this browser" : state.persisted ? "granted" : "not granted"}.`),
        h("p", { class: "mute" }, "Browsers may clear site data when space is short unless storage is persistent. A backup file is the only guarantee."),
        state.persisted === false && navigator.storage?.persist
          ? h("button", { class: "btn ghost", type: "button", onclick: () => void run(async () => {
              state.persisted = await navigator.storage.persist();
              say(state.persisted ? "ok" : "warn", state.persisted ? "Storage is now persistent." : "The browser declined. Keep backups.");
            }) }, "Ask the browser to keep my data")
          : null,
      ),
      h("div", { class: "card" },
        h("h2", {}, "Delete everything"),
        state.confirm === "all"
          ? h("div", { class: "actions" },
              h("span", {}, "Delete all shifts and settings from this browser?"),
              h("button", { class: "btn danger", type: "button", id: "wipe-yes", onclick: () => void run(async () => {
                await db.clear();
                await reload();
                state.confirm = null;
                say("ok", "Everything was deleted.");
              }) }, "Yes, delete"),
              h("button", { class: "btn ghost", type: "button", onclick: () => { state.confirm = null; render(); } }, "Keep"),
            )
          : h("button", { class: "btn ghost", type: "button", id: "wipe", onclick: () => { state.confirm = "all"; render(); } }, "Delete all data…"),
      ),
    );
  };

  // ---- Frame --------------------------------------------------------------------------------

  const tabs: [Tab, string][] = [["shifts", "Shifts"], ["summary", "Summary"], ["settings", "Settings"], ["backup", "Backup"]];

  function render(): void {
    const view = { shifts: shiftsView, summary: summaryView, settings: settingsView, backup: backupView }[state.tab]();
    const flash = state.flash;
    root.replaceChildren(
      h("main", {},
        h("header", { class: "top" }, h("h1", {}, "ShiftLedger"), h("span", { class: "by" }, "by OBEOS"), h("span", { class: "mute" }, "Stored only in this browser")),
        h("nav", { "aria-label": "Sections" }, ...tabs.map(([id, label]) => h("button", { type: "button", "data-tab": id, "aria-current": state.tab === id ? "page" : null, onclick: () => { state.tab = id; state.confirm = null; state.flash = null; render(); } }, label))),
        flash ? h("div", { class: `flash ${flash.kind}`, role: "status" }, flash.text) : null,
        view,
      ),
    );
  }

  render();
}
