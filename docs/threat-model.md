# Threat model

**Assets:** the user's shift and pay records. **Actors:** a malicious file the user imports; a malicious string typed or pasted into a field; another site trying to read the data; a network observer.

| Threat | Mitigation | Check |
|---|---|---|
| Script injection through employer or note | DOM built with `textContent`-style APIs; HTML-assignment lint rules; CSP `default-src 'self'` with no inline script | e2e: hostile text |
| Spreadsheet formula injection from exported CSV | Leading apostrophe on `= + - @ tab` cells | e2e and unit CSV tests |
| Crafted CSV or backup (huge, malformed, wrong types) | Size and row caps, strict field validation, refuse whole file | `csv-backup.test.ts` |
| Half-applied restore or import | Single IndexedDB transaction, aborted on error | `db.test.ts` |
| Data exfiltration | `connect-src 'none'`, `form-action 'none'`, no third-party scripts or fonts | e2e: no foreign requests |
| Other origins reading the data | IndexedDB is per-origin; host on its own origin | browser model |
| Local attacker with the browser profile | Not defended; no encryption | [SECURITY.md](../SECURITY.md) |
| Silent data loss when the browser clears storage | Persistence request, visible banner, backups | README limitation |
