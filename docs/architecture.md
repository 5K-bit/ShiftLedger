# Architecture

## Layers

- `src/core/` is pure and has no browser APIs: `time` (local date-times, elapsed minutes, week starts, formatting), `model` (types, validation, overlap detection), `calc` (overtime and pay), `csv`, `backup`.
- `src/storage/db.ts` wraps IndexedDB (`shifts` store with a `start` index, and `settings`). It takes an `IDBFactory`, so tests run it against `fake-indexeddb`.
- `src/ui/` builds the DOM with `h()` and renders four tabs from one state object. No framework.
- `scripts/build-sw.mjs` runs after `vite build` and writes `dist/sw.js` listing every built file; the cache name is a hash of their contents, so each build replaces the old cache.

## Time and money

Times are local `YYYY-MM-DDTHH:mm` strings. A shift's length is real elapsed time, so a shift across a daylight-saving change is an hour longer or shorter. Money is integer cents; each rounding is "nearest, halves up" in one helper.

## Overtime

Shifts are grouped by the week in which they start (Monday or Sunday start). Within a week they are taken in start order; once paid minutes pass the threshold, the excess is paid at the overtime percent, splitting a shift that crosses the threshold. A threshold of 0 turns overtime off.

## Offline

The service worker answers navigations and assets from its cache (ignoring `Vary` and query strings), falls back to `index.html` for navigations, and never touches cross-origin requests.
