# ADR 0001: Local-first, IndexedDB, no server

Pay records are private and the app is useful without a connection. Data lives in IndexedDB in the user's browser; there is no account and no sync. **Consequence:** the browser can delete the data, so backups are a first-class feature and the README says so plainly.
