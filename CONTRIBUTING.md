# Contributing

Thanks for your interest in ShiftLedger.

## Ways to help

- Report a total, overtime split or week boundary that was wrong, with made-up shifts and the settings you used.
- Improve accessibility, wording or the docs.

## Development

```bash
npm ci
npm run lint && npm run typecheck
npm test              # unit tests; must keep the coverage floor
npx playwright install chromium
npm run e2e           # builds and runs the browser tests
```

## Guidelines

- No runtime dependencies, no network calls, and keep the CSP in `index.html` strict.
- Never assign HTML strings; build DOM with `h()` in `src/ui/dom.ts`.
- Money is integer cents. Any change to pay, overtime or time handling needs a test with an exact expected value, including a daylight-saving case where relevant.
- Changing the demo output on purpose? Run `UPDATE_GOLDEN=1 npm test`, review the diff to `docs/evidence/demo-week.txt`.
- Demo content must be made up. Never commit real pay records.
- Do not add claims to the README that a test does not back up.
