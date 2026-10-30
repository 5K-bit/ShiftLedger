import "./styles.css";
import { LedgerDB } from "./storage/db";
import { h } from "./ui/dom";
import { start } from "./ui/app";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  try {
    const db = await LedgerDB.open();
    await start(root, db);
  } catch (error) {
    root.replaceChildren(
      h(
        "main",
        {},
        h("h1", {}, "ShiftLedger"),
        h("p", { class: "flash bad", role: "alert" }, error instanceof Error ? error.message : "Storage is not available."),
        h("p", { class: "mute" }, "ShiftLedger keeps your shifts in this browser's IndexedDB. Private windows and some privacy settings turn it off."),
      ),
    );
  }
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}

void main();
