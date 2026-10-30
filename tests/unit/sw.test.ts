import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildServiceWorker } from "../../scripts/build-sw.mjs";

function fakeDist(extra = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "sl-dist-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html></html>");
  writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1)" + extra);
  writeFileSync(join(dir, "manifest.webmanifest"), "{}");
  return dir;
}

describe("buildServiceWorker", () => {
  it("lists every built file and names the cache after their content", () => {
    const dir = fakeDist();
    const a = buildServiceWorker(dir);
    expect(a.files).toEqual(["./", "./assets/app-abc.js", "./index.html", "./manifest.webmanifest"]);
    const source = readFileSync(join(dir, "sw.js"), "utf8");
    expect(source).toContain(a.cache);
    expect(source).toContain('"./assets/app-abc.js"');
    // running again does not precache the worker itself and gives the same name
    expect(buildServiceWorker(dir).cache).toBe(a.cache);
    expect(buildServiceWorker(fakeDist("changed")).cache).not.toBe(a.cache);
  });
  it("refuses a folder with no index.html", () => {
    expect(() => buildServiceWorker(mkdtempSync(join(tmpdir(), "sl-empty-")))).toThrow(/index\.html/);
  });
});
