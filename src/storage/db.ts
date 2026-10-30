import { DEFAULT_SETTINGS, asSettings, asShift, type Settings, type Shift } from "../core/model";

export const DB_NAME = "shiftledger";
export const DB_VERSION = 1;
const SHIFTS = "shifts";
const SETTINGS = "settings";
const SETTINGS_KEY = "settings";

export class StorageError extends Error {}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError(request.error?.message ?? "Storage request failed."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new StorageError(tx.error?.message ?? "Storage transaction failed."));
    tx.onabort = () => reject(new StorageError(tx.error?.message ?? "Storage transaction was cancelled."));
  });
}

export interface Listing {
  shifts: Shift[];
  /** Records that were in the database but no longer pass validation (never deleted, just hidden). */
  skipped: number;
}

/** Everything lives in this browser's IndexedDB. Nothing is sent anywhere. */
export class LedgerDB {
  private constructor(private readonly db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }

  static open(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<LedgerDB> {
    return new Promise((resolve, reject) => {
      const request = factory.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SHIFTS)) {
          const store = db.createObjectStore(SHIFTS, { keyPath: "id" });
          store.createIndex("start", "start");
        }
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      };
      request.onsuccess = () => resolve(new LedgerDB(request.result));
      request.onerror = () => reject(new StorageError(request.error?.message ?? "Could not open the database."));
      request.onblocked = () =>
        reject(new StorageError("Close the other ShiftLedger tabs, then try again."));
    });
  }

  close(): void {
    this.db.close();
  }

  async put(shift: Shift): Promise<void> {
    const tx = this.db.transaction(SHIFTS, "readwrite");
    tx.objectStore(SHIFTS).put(shift);
    await done(tx);
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(SHIFTS, "readwrite");
    tx.objectStore(SHIFTS).delete(id);
    await done(tx);
  }

  async get(id: string): Promise<Shift | null> {
    const raw: unknown = await wrap(this.db.transaction(SHIFTS).objectStore(SHIFTS).get(id));
    return asShift(raw);
  }

  async list(): Promise<Listing> {
    const raw: unknown[] = await wrap(this.db.transaction(SHIFTS).objectStore(SHIFTS).index("start").getAll());
    const shifts: Shift[] = [];
    let skipped = 0;
    for (const item of raw) {
      const shift = asShift(item);
      if (shift) shifts.push(shift);
      else skipped += 1;
    }
    return { shifts, skipped };
  }

  async getSettings(): Promise<Settings> {
    const raw: unknown = await wrap(this.db.transaction(SETTINGS).objectStore(SETTINGS).get(SETTINGS_KEY));
    return asSettings(raw) ?? { ...DEFAULT_SETTINGS };
  }

  async putSettings(settings: Settings): Promise<void> {
    const tx = this.db.transaction(SETTINGS, "readwrite");
    tx.objectStore(SETTINGS).put(settings, SETTINGS_KEY);
    await done(tx);
  }

  /** Add or overwrite many shifts in one transaction: all of them are saved, or none. */
  async putMany(shifts: readonly Shift[]): Promise<void> {
    const tx = this.db.transaction(SHIFTS, "readwrite");
    const finished = done(tx);
    const store = tx.objectStore(SHIFTS);
    try {
      for (const s of shifts) store.put(s);
    } catch (error) {
      tx.abort(); // a put can throw at once (bad key); undo the ones already queued
      await finished.catch(() => undefined);
      throw new StorageError(error instanceof Error ? error.message : "Could not save the shifts.");
    }
    await finished;
  }

  /** Replace everything (used when restoring a backup), atomically. */
  async replaceAll(shifts: readonly Shift[], settings: Settings): Promise<void> {
    const tx = this.db.transaction([SHIFTS, SETTINGS], "readwrite");
    const finished = done(tx);
    try {
      const store = tx.objectStore(SHIFTS);
      store.clear();
      for (const s of shifts) store.put(s);
      tx.objectStore(SETTINGS).put(settings, SETTINGS_KEY);
    } catch (error) {
      tx.abort(); // keep the old ledger intact if anything in the new one cannot be stored
      await finished.catch(() => undefined);
      throw new StorageError(error instanceof Error ? error.message : "Could not restore the backup.");
    }
    await finished;
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([SHIFTS, SETTINGS], "readwrite");
    tx.objectStore(SHIFTS).clear();
    tx.objectStore(SETTINGS).clear();
    await done(tx);
  }
}
