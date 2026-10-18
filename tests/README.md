# Frontend tests

## Maintained checks

- `node tests/run.mjs` — zero-dependency ExamData/tracker unit harness.
- `node tests/boundary_conformance.mjs` — resolution, exact-year, manual, projection, and tier behavior.
- `node tests/boundary_identity.mjs` — exact request identity and key validation.
- `node tests/boundary_integration.mjs` — deterministic published-value conversion to canonical records and repository decisions; no network calls.
- `node tests/demo_data_fixture.mjs` — integration against the committed tracker export.
- `node tests/examdata_phase_bc.mjs` — migration, scheduling, series ambiguity, and blank-series behavior.
- `node tests/examdata_papers.mjs` — paper record and planning behavior.
- `node tests/preview_test.mjs` — legacy boundary preview behavior.
- `node tests/gcse_boundary_golden_suite.mjs` — real-value parser golden fixtures and zero-fabrication identity checks; `LIVE=1` refetches the real board PDFs instead of cached text.
- `node tests/e2e_tracker.mjs` — real-browser Tracker + Scraper smoke test (offline; `LIVE=1` adds a live Pearson Jun 2024 refetch). Requires a Chrome/Chromium binary (`CHROME_PATH`, default `/usr/bin/google-chrome`) and `puppeteer-core`; the repo deliberately has no package.json, so run it on a machine that provides both.

The frontend has no production build, lint, or typecheck script; Pages publishes the static tree directly.

The maintained official-PDF acquisition path currently supports exact AQA and Pearson GCSE boundary rows. OCR, A-Level, and AS ingestion fail closed until a source/parser path is independently verified. The adjacent `uk-exam-engine` package is not imported by this frontend runtime.

## Retired suites

`examdata_spec.mjs` and `examdata_live.mjs` were removed on 2026-10-12. Both imported `acquirePearson` from the former ExamData facade, which is not part of the maintained API. The spec suite also injected arbitrary parsers and synthetic source bytes, so its former green results were not evidence of official-source acquisition. The current offline suite explicitly verifies fail-closed acquisition, and the golden/parser and E2E checks cover retained behaviors.

There is **not yet a maintained live-network acceptance suite** for real board acquisition. Add one only with explicit opt-in, isolated storage, source URL/hash assertions, and real PDF/XLSX parsing; never restore the old synthetic fallback behavior.
