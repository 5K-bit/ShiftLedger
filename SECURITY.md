# Security Policy

## Intended use

ShiftLedger is a single-user, offline web app. It keeps your data in your own browser (IndexedDB) and sends nothing anywhere. The page's Content Security Policy (`connect-src 'none'`) forbids network requests.

## What it protects, and what it does not

- **Hostile text is inert.** The interface is built with DOM APIs only (lint rules forbid assigning HTML strings), so an employer name or note like `<img onerror=…>` is shown as text. A browser test checks this.
- **Imports are hostile input.** CSV and JSON backups are size-capped and validated field by field; a bad file is refused whole and changes nothing.
- **CSV export is formula-safe.** Cells starting with `=`, `+`, `-`, `@` or a tab are prefixed with an apostrophe, so a spreadsheet will not run them. Import undoes the prefix.
- **Bulk writes are atomic.** A failed restore or import leaves the previous data intact.
- **It does not encrypt.** Anyone with access to your browser profile can read the data. Backups are plain JSON; keep them as private as your pay records.
- **It cannot guarantee storage.** The browser may clear site data. Keep backups.
- **Offline updates.** The service worker precaches the built files and is replaced when a new build is deployed; serve the site over HTTPS.

The full analysis is in [docs/threat-model.md](docs/threat-model.md).

## Reporting a vulnerability

If you find a way to run script from imported data, read or alter data from another origin, make a crafted backup or CSV crash or corrupt the ledger, or make the app contact the network, please report it privately through GitHub's **Security → Report a vulnerability** on this repository rather than a public issue.

Include the browser and version, and the smallest file or steps that reproduce it. Use made-up content only. Expect an initial response within a few days.
