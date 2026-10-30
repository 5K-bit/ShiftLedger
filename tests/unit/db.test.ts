import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Shift } from "../../src/core/model";
import { LedgerDB, StorageError } from "../../src/storage/db";

const shift = (id: string, start: string, end: string): Shift => ({
  id,
  employer: "Cafe",
  start,
  end,
  breakMinutes: 0,
  rateCents: 1500,
  note: "",
});

let factory: IDBFactory;
let db: LedgerDB;

beforeEach(async () => {
  factory = new IDBFactory();
  db = await LedgerDB.open(factory);
});

describe("LedgerDB", () => {
  it("starts empty with default settings", async () => {
    expect(await db.list()).toEqual({ shifts: [], skipped: 0 });
    expect(await db.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await db.get("nope")).toBeNull();
  });

  it("stores, updates, reads and removes shifts, listed by start time", async () => {
    await db.put(shift("b", "2026-10-27T09:00", "2026-10-27T10:00"));
    await db.put(shift("a", "2026-10-26T09:00", "2026-10-26T10:00"));
    expect((await db.list()).shifts.map((s) => s.id)).toEqual(["a", "b"]);
    await db.put({ ...shift("a", "2026-10-26T09:00", "2026-10-26T11:00") });
    expect((await db.get("a"))?.end).toBe("2026-10-26T11:00");
    await db.remove("a");
    expect((await db.list()).shifts.map((s) => s.id)).toEqual(["b"]);
  });

  it("persists across closing and reopening", async () => {
    await db.put(shift("a", "2026-10-26T09:00", "2026-10-26T10:00"));
    await db.putSettings({ ...DEFAULT_SETTINGS, currency: "EUR" });
    db.close();
    const again = await LedgerDB.open(factory);
    expect((await again.list()).shifts).toHaveLength(1);
    expect((await again.getSettings()).currency).toBe("EUR");
  });

  it("hides records that no longer validate, and counts them", async () => {
    await db.put(shift("a", "2026-10-26T09:00", "2026-10-26T10:00"));
    // write a damaged record straight into the store, as another tool or an old version might
    const raw = factory.open("shiftledger", 1);
    await new Promise<void>((resolve) => {
      raw.onsuccess = () => {
        const tx = raw.result.transaction("shifts", "readwrite");
        tx.objectStore("shifts").put({ id: "bad", start: "2026-10-26T08:00", employer: 5 });
        tx.oncomplete = () => {
          raw.result.close();
          resolve();
        };
      };
    });
    const listing = await db.list();
    expect(listing.shifts.map((s) => s.id)).toEqual(["a"]);
    expect(listing.skipped).toBe(1);
  });

  it("falls back to defaults if stored settings are damaged", async () => {
    const raw = factory.open("shiftledger", 1);
    await new Promise<void>((resolve) => {
      raw.onsuccess = () => {
        const tx = raw.result.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ currency: 5 }, "settings");
        tx.oncomplete = () => {
          raw.result.close();
          resolve();
        };
      };
    });
    expect(await db.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("putMany saves everything or nothing", async () => {
    await db.putMany([shift("a", "2026-10-26T09:00", "2026-10-26T10:00"), shift("b", "2026-10-27T09:00", "2026-10-27T10:00")]);
    expect((await db.list()).shifts).toHaveLength(2);
    // an invalid key type aborts the whole transaction
    const bad = { ...shift("c", "2026-10-28T09:00", "2026-10-28T10:00"), id: { not: "a key" } as unknown as string };
    await expect(db.putMany([shift("d", "2026-10-29T09:00", "2026-10-29T10:00"), bad])).rejects.toThrow();
    expect((await db.list()).shifts.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("replaceAll swaps the whole ledger atomically; clear empties it", async () => {
    await db.put(shift("old", "2026-10-20T09:00", "2026-10-20T10:00"));
    const settings = { ...DEFAULT_SETTINGS, weekStartsOn: 0 as const };
    await db.replaceAll([shift("new", "2026-10-26T09:00", "2026-10-26T10:00")], settings);
    expect((await db.list()).shifts.map((s) => s.id)).toEqual(["new"]);
    expect((await db.getSettings()).weekStartsOn).toBe(0);
    await db.clear();
    expect((await db.list()).shifts).toEqual([]);
    expect(await db.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("replaceAll keeps the old ledger if the new one cannot be stored", async () => {
    await db.put(shift("keep", "2026-10-20T09:00", "2026-10-20T10:00"));
    const bad = { ...shift("x", "2026-10-26T09:00", "2026-10-26T10:00"), id: { no: 1 } as unknown as string };
    await expect(db.replaceAll([bad], DEFAULT_SETTINGS)).rejects.toBeInstanceOf(StorageError);
    expect((await db.list()).shifts.map((s) => s.id)).toEqual(["keep"]);
  });

  it("reports an upgrade conflict as a friendly error", async () => {
    const holder = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open("clash", 1);
      req.onsuccess = () => resolve(req.result);
    });
    holder.onversionchange = null; // an old tab that will not let go
    const higher = factory.open("clash", 2);
    await new Promise<void>((resolve) => {
      higher.onblocked = () => resolve();
    });
    // Opening our own database at a lower version than exists fails with a storage error.
    const f2 = new IDBFactory();
    await new Promise<void>((resolve) => {
      const r = f2.open("shiftledger", 5);
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
    await expect(LedgerDB.open(f2)).rejects.toBeInstanceOf(StorageError);
    holder.close();
  });
});
