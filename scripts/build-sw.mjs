// @ts-check
// Writes dist/sw.js: a service worker that precaches every built file, so the app opens offline.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const WORKER = `
const CACHE = "shiftledger-__HASH__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      if (request.mode === "navigate") return caches.match("./index.html");
      return fetch(request);
    }),
  );
});
`;

/**
 * @param {string} distDir
 * @returns {{ cache: string; files: string[] }}
 */
export function buildServiceWorker(distDir) {
  const files = listFiles(distDir)
    .map((f) => relative(distDir, f).split(sep).join("/"))
    .filter((f) => f !== "sw.js")
    .sort();
  if (!files.includes("index.html")) throw new Error(`no index.html in ${distDir}; run the build first`);
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(join(distDir, f)));
  }
  const id = hash.digest("hex").slice(0, 12);
  const urls = ["./", ...files.map((f) => `./${f}`)];
  const source = WORKER.replace("__HASH__", id).replace("__FILES__", JSON.stringify(urls, null, 2));
  writeFileSync(join(distDir, "sw.js"), source.trimStart());
  return { cache: `shiftledger-${id}`, files: urls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  const result = buildServiceWorker(dir);
  console.log(`service worker: ${result.cache}, ${result.files.length} files precached`);
}
