# FRONTIER #26 HANDOFF — EXAM-DATA BRAIN, BOARD-AGNOSTIC ACQUISITION + TRACKER CONSUMPTION

**Repo root (git):** `/home/aigsniper/Documents/website/neuronet/frontend`
**Runtime:** plain Node `>= 20` (v24.18.1 used here). No dev dependencies. Do NOT add any.
**This file is read and executed by you (the frontier/agent).** Implement everything below. Do not stop earlyches; reach Definition of Done (#41).

---

## 0. TRUTH BOUNDARIES (read first — do not violate)

1. **Never invent test numbers.** The previous subagent *fabricated* a "green" test suite that does not exist anywhere in this repo. If a suite/command fails to run, say so plainly. A fabricated pass is a failure of the frontier.
2. **Only modify:** `src/tools/trackerTool.js`, `src/tools/examData/*` (the whole subsystem), plus NEW `tests/` files. Do NOT touch `src/tools/gradeBoundaries.js` (legacy, kept for scraperTool/pdfBoundaries), `src/tools/scraperTool.js`, `src/tools/pdfBoundaries.js`, or any `legacy/` dir.
3. **The tracker must import ONLY the facade**: `import { Exam } from "./examData/app.js"` plus `planRequirements/REQUIREMENT_TYPES/JOB_PRIORITIES` from `./examData/scheduler.js` and schema helpers from `./examData/schema.js`. Zero imports from `gradeBoundaries.js`. There is already a committed guard: `src/tools/examData_tracker_surface_guard.mjs` (run it: `node src/tools/examData_tracker_surface_guard.mjs`). Keep it passing.
4. **Paper/boundary/series identity must stay exact.** Never resolve "2022" when asked for "2024". Never fall back to "nearest" series. Missing exact data → structured `UNKNOWN` with a reason string, never a fake `null`-blob, never `Grade 9` by default.
5. **Current repo state (verified, already committed & pushed to `main`):**
   - `trackerTool.js` (`~2000 lines`) — frictionless seam established; imports only facade + scheduler + schema. `node --check` passes. ESM graph loads.
   - Face facade `src/tools/examData/app.js` exports: `init, status, onStatus, onChanged, decisionFor, getForSittingFor, ensureForSitting, ensureRequirement, courseList, resolveCourse, listCourseCandidates, reconcile, gradeLabels, boundarySeries, papersFor, boundaryFor, scoreToGrade, findGradeMark, normalizeTable, canonicalGradeKey, boardLabel, qualLabel, monthOf, tierFromName, normalizeTitle, courseKey, seriesId, recentlyAttempted, rememberAttempt, retryWindowMs`.
   - `schema.js`, `identity.js`, `scheduler.js` (REQUIREMENT_TYPES: BOUNDARY/PAPERS; JOB_*), `ensure.js` (A numeric ENSURE_STATUS), `ingest.js` (acquirePearson, getForSitting, UNKNOWN_REASONS), `repository.js`, `storage.js` (putCourse/putSeries/putSeries/putBoundary/putSource/putJob/putPaper ALL EXIST + STORES + clearAllStores + saveSnapshot), `papers.js`, `adapters.js`, `sources/PearsonSource.js` (PearsonSource.discover/parseSource, isPdfBuffer), `sources/officialEngine.js`.
   - `adapters.js` STILL has AQA/OCR as **interface-only stubs** (`implemented:false`), and `ensure.js:15` still imports `acquirePearson` directly (hardwired Pearson, not board dispatch).

---

## 1. FIRST: BUILD THE REAL TEST HARNESS (tiny, zero-dep)

This is priority #1 and it comes first for a reason: every later fix is proven on it. Create:

```text
tests/
  examdata/
    identity.mjs
    boundaries.mjs
    discovery.mjs
    acquisition.mjs
    courses.mjs
    tracker-view-model.mjs
  run.mjs
```

Harness contract:
- Plain Node ESM (`node tests/run.mjs`). No Playwright, no browser, no framework.
- Must import REAL modules from `src/tools/examData/*` and `src/tools/trackerTool.js` (both are importable in Node today).
- Produces real assertion counts and a non-zero exit on failure.

Minimum initial tests (from the original frontier spec — with the REAL values below):

1. **Biology 8461 June 2025** — exact AQA source resolves; do not fabricate 8464.
2. **Maths 1MA1 Higher June 2024** — official boundary; grade 7 → threshold 137; grade 9 → 197; 9+7 both shown.
3. **Maths 1MA1 Higher June 2025** — 7 → 156, 9 → 217.
4. **Older Maths exact-series lookup** — 2022 June must NOT resolve "2024". `UNKNOWN` (with reason `NO_EXACT_SOURCE`) is a PASSING result.
5. **AQA course discovery** — returns canonical Board-agnostic courses including a full course catalogue list (`AQA 8461 Biology Higher/Foundation`, …).
6. **Pearson course discovery** — 1MA1 Higher/Foundation, 1GB0, 1CP2.
7. **Custom grade selection** — selected `["7"]` shows only the 7 threshold; `["9","7"]` shows both; clear → default is ONLY the table's top grade (gradesInOrder[0], NOT hardcoded 9).
8. **No exact source** → `state:"unknown", reason:"NO_EXACT_SOURCE"`, renderer shows `Boundary: —` (never "Grade 9").
9. **Wrong tier** and **wrong series** → structured UNKNOWN/IDENTITY_CONFLICT, never silent fallback.
10. **Subject auto-matching** — `Maths Pearson GCSE 1MA1 Higher` → exactly `Pearson 1MA1 Higher`; `Maths` alone → multiple candidates (Pearson 1MA1 H/F + AQA 8300 H/F + OCR J560) → `AMBIGUOUS`.

---

## 2. FIX THE BOARD-DISPATCH BUG (frontier "ensure must be board-agnostic")

Current: `ensure.js:15` imports `acquirePearson` from `ingest.js` and every sitting acquisition calls Pearson. So "AQA 8461 June 2025" is silently handed to the Pearson engine.

**Required rework:**

```js
export async function nextState() // (from scheduler) stays

// New: single acquisition entry point, board-dispatching.
export async function ensureExamData(request)   // ingress
```

```text
request.board
    ↓
adapterFor(board)
    ↓
adapter.acquire(...)
```

Implement `adapterFor`, `listAdapters`, `nativeQualification`, `defaultSeriesWindow` in `adapters.js` so they actually dispatch:

```text
ExamData facade
   ├── PearsonSource (implemented — discover/parse real)
   ├── AqaSource     (implement this frontier)
   └── OcrSource     (interface-only, leave)
```

`ensureForSitting` must call the board adapter, not `acquirePearson` directly. Note: `ExamData` never invents "Pearson for AQA".

---

## 3. AQA: FIRST REAL NON-PEARSON ADAPTER (🏆 front-door of this frontier)

For:

```text
AQA GCSE 8461 Biology   June 2025
```

The acquisition pipeline (all steps observable through a new debug trace, #33):

```text
discover exact AQA series
  → discover exact official boundary resource
  → prefer official XLSX
  → PDF fallback
  → parse
  → validate
  → persist (incremental: putCourse/putSeries/putPaper/putBoundary/putSource/putJob)
```

**The result must reflect the exact requested tier:**

```text
AQA 8461 Foundation → grades 5,4,3,2,1
AQA 8461 Higher     → grades 9,8,7,6,5,4,3
```

**Explicitly forbidden:**
- Injecting `8464 Combined Science` for a `8461` request.
- Using AQA 2026 data for a 2025 request.
- Using Pearson for any AQA request.

---

## 4. AQA SOURCE DISCOVERY (must be discovery, not hardcode)

Do NOT `hardcode "8461 June 2025 = URL"`. Instead:

```text
series → official resource  (from official AQA grade-boundary index/archive)
```

Prefer structured XLSX when available; PDF is the fallback. Discovery must go through the official archive.

---

## 5. COURSE CATALOGUE IS SEPARATE FROM BOUNDARY ACQUISITION (#6–#10 from spec)

**The linker bug the user sees — "only ONE subject shown" — is because `Exam.courseList()`/`listCachedCourses` only returns what's already cached in the repository.** That is wrong. Build:

```js
discoverCourseCatalogue()   // → canonical Course[] from official board data
```

- Catalogue built from official course/catalogue discovery sources, NOT by scraping every historical boundary PDF.
- Extract `Course[]`:

```text
Pearson: 1MA1 Higher, 1MA1 Foundation, 1GB0 Geography B, 1CP2 Computer Science, …
AQA: 8461 Biology Higher, 8461 Biology Foundation, 8462 Chemistry H/F, …
```

**Key architectural split (#6–#10):** a *course* exists independently of any boundary. Storage must be:

```text
examCourses   (course catalogue — populated by discovery)
examSeries
examBoundaries
examPapers
examSources
examJobs
```

The linker should:
```text
load local canonical course catalogue
   → show ALL known courses immediately
   → (re)validate/merge discovery in background
   → rerender
```

Never show one cached subject as "the" listate. Never leave `Fetching…` forever without starting acquisition.

**Subject linker separation (#10):**
- *Discovery* = build catalogue (above).
- *Auto-matching* = separate job: `resolveSubject("Maths")` → list candidates via `Exam.listCourseCandidates`. If evidence insufficient → `AMBIGUOUS` (do not silently pick one).
- Exact rule for: `Maths, examBoard=Pearson, qual=GCSE, code=1MA1, tier=Higher` → return exactly `Pearson 1MA1 Higher`.

---

## 6. BOUNDARY DISPLAY MODEL — ONE TRUTH (#12–#16)

**Bug the user sees: Maths shows default grade 9 and the customize picker has no effect.**

Root cause: the linker and row renderer each independently re-derive/fallback the boundary. That stops.

Create a single pure function:

```js
// facade
getBoundaryDisplayModel({ courseId, seriesId })
```

Returns exactly one of:

```js
{ state: "official", table, source, provenance, selectedGrades }
{ state: "legacy",  table, provenance }
{ state: "unknown", reason: "NO_EXACT_SOURCE" }   // etc.
```

- **Renderer consumes this ONE model.** No renderer-side boundary guess. Remove `resolveBoundaryTable/effectiveTable/aimTable` independent decision paths (they must not independently decide the displayed number). Keep only the canonical: `sitting → ExamData decision → BoundaryDisplayModel → renderer`.
- **Custom picker is NOT exam data (#14):** aim selection = `aimGrades[subject] = ["7"]` (which grade thresholds to SHOW), never a stored boundary scalar. Picker must never mutate the official source table.
- **Unknown must be visibly unknown (#16):** exact boundary missing → row shows `Boundary: —` with reason text (`Exact June 2022 boundary unavailable` / `Course identity ambiguous`). NOT "Grade 9".
- **Default top grade comes from the table (#22):** `defaultGrade = table.gradesInOrder[0]`; AQA Biology Foundation defaults to 5, Higher to 9. Never hardcoded `9`.
- **Picker grade options (#21):** union of legal grades across available courses; AQA Bio Foundation `5..1`, Higher `9..3`. Never fabricate `2`,`1` as valid Higher grades.
- **Picker tests (#15) with real values:**
  - `1MA1 Higher June 2024`: 9→197, 7→137.
  - `1MA1 Higher June 2025`: 9→217, 7→156.
  - `[]` → 2024→197, 2025→217.
  - Must NEVER be "always 9".

---

## 7. NO 2022→2024 FALLBACK (#18), EXACT SERIES IDENTITY (#19)

- `getBoundaryDisplayModel({courseId:"pearson:gcse:1MA1:H", seriesId:"2022-JUN"})` must ask for **exactly 2022 June** — never nearest/newest/top-cached. `UNKNOWN(reason)` is the only legit non-match.
- Display model includes `{courseId, seriesId, table, source}` so a debugger can prove `Maths June 2022 1MA1 Higher` is `exact June 2022`, not a sneaked 2024 value.
- If a file/year can't be obtained: `UNKNOWN` (passes). Never a fabricated number.

---

## 8. TRACKER FIXES (frontier stuff, row/render level)

- **Aiming/stats (#20):** `aimTable(subject)` must derive picker options from all *exact* course tables (option discovery) but resolve the row's *displayed* threshold from that exact row's series (row resolution). Two separate concerns, never conflated.
- **Legacy scalar rule (#17):** a scalar `gradeBoundary: 217` may NEVER construct/display a full boundary table. A stored snapshot is usable only when `series exact match + course exact match + provenance known`. Otherwise `UNKNOWN`.
- **#32:`unknown` visible + reason string** — tracker displays `Boundary: —` + a human reason, instead of fabricating a value.
- **#33 debug trace** — for every failed exact request, log:
  `request → course resolution → series resolution → adapter selected → discovery sources → candidate resources → selected resource → fetch result → document → parse → validate → persist → final decision`.
  Example for a correct AQA future path:
  `AQA/GCSE/8461/Biology/H/JUN/2025 → AqaSource → archive found → XLSX found → fetched 200 → parsed 8461 H → validated → persisted → tracker official`.

---

## 9. SOURCE PROVENANCE (#34–#35)

Boundary/store rows must carry provenance:

```js
{ sourceIds: [...] }   // on boundary
// canonical source entity:
{ id, url, publisher, title, contentHash, accessedAt, publishedAt }
```

Never just `"PearsonSource"`. This lets papers/mark-schemes reuse the same model later.

---

## 10. STORAGE DISCIPLINE (#36–#37)

- **Incremental only:** add via `putCourse/putSeries/putPaper/putBoundary/putSource/putJob` — never `clearAllStores()` on an acquisition.
- **Legacy migration non-destructive:** first boot does `legacy → canonical` (once). After that, canonical exact data wins; stale legacy localStorage must not overwrite it. Legacy becomes compatibility-only eventually.

---

## 11. SINGLE ENGINES (#38), PAPERS FIRST-CLASS (#25–#27)

- One official ingestion path: `ExamData → adapter → source`. After AQA dispatches correctly, `rg` the repo for `gradeBoundaries.*fetch|acquirePearson|gradeBoundaries` and remove every duplicate acquisition path outside the facade (leave scraper/pdfBoundaries as legacy compatibility only).
- `papers` become first-class:

```js
discoverPapers(course, series)
// → [{ paperNumber, paperCode, maxMark, documents:{ questionPaper, markScheme, examinerReport } }]
```

Store paper under `paperId/paperCode` independent of boundaries. This phase: discovery/storage of URLs only — no question extraction.
- `ensureExamData(course, series)` must return `{ status: complete|partial|unknown, missing: [papers,boundary,source] }`. Papers must NOT be gated on boundary success.

---

## 12. SCHEDULER PRIORITY (#28–#29)

Keep `P0 exact request > P1 actual sitting > P2 linked history > P3 recent series > P4 maintenance > P5 archive`. P0 AQA Biology 2025 must not be delayed by a huge archive sweep. Opening the linker must never trigger a full archive sweep — only cheap catalogue discovery/refresh.

---

## 13. LIVE-BUG ACCEPTANCE TESTS (#39–#40) — MUST PASS

**Bug A:** `AQA 8461 Biology June 2025 → official`
**Bug B:** after catalogue discovery, `courseList()` shows ALL discovered courses (not just one).
**Bug C:** `Maths 1MA1 Higher June 2024 choice 7 → 137`; `June 2025 choice 7 → 156`; `no choice → 197/217`. Never always-9. Errors show structured reason, never bare `null`.

`tracker subject → subject metadata → course resolution → series resolution → ensureExamData → repository → BoundaryDisplayModel → custom grade selection → render values` — test ALL of it, in Node, via the harness.

---

## 14. DEFINITION OF DONE (#41) — DO NOT CLAIM SUCCESS UNTIL ALL TRUE

```text
□ AQA Biology 8461 June 2025 resolves (official)
□ subject linker displays all discovered supported courses (not one)
□ Maths selected grade 7 shows grade-7 threshold (137 for 2024; 156 for 2025)
□ Maths different years show their own exact thresholds
□ missing historical source shows "—" + reason
□ NO fallback year exists in any path
□ course identity stays exact
□ AQA/Pearson/OCR dispatch through adapters (Pearson implemented, AQA implemented, OCR interface-only)
□ real Node harness exists and reports real pass/fail counts
□ no fabricated test results anywhere in this handoff/turn
```

---

## 15. AFTER DONE — DO NOT SKIP AHEAD (#42)

Next order (future frontiers, do not implement now):

```text
Pearson historical completeness → AQA historical completeness → OCR adapter
→ full paper catalogue → mark-scheme discovery → question extraction
```

Do NOT jump to flashcards/AI study intelligence. The goal now: ExamData trustworthy enough that everything built above it can safely believe its data.

---

## 16. HANDOFF PROCEDURE

When you finish:
1. Run `node tests/run.mjs` and `node src/tools/examData_tracker_surface_guard.mjs` — paste the REAL output verbatim.
2. `git add` only your in-scope files; commit with a clear message like `frontier #26: board-agnostic ExamData + AQA adapter + display model`; push to `main`.
3. Write a short handback report back to the main agent (this is fed back into the frontier loop): what's implemented, what the harness actually ran + numbers, and any residual gaps you chose NOT to fake.
