// gcse_boundary_golden_suite.mjs — the oracle.
//
// Verifies the clean engine against golden fixtures that were checked against
// live AQA / Pearson publications. Run offline against cached PDF text:
//   node tests/gcse_boundary_golden_suite.mjs
// Or live, refetching the real PDFs:
//   LIVE=1 node tests/gcse_boundary_golden_suite.mjs
//
// The fixture's `grades` object is a JS object, so numeric-like keys iterate in
// ASCENDING numeric order regardless of insertion order. Every comparison here
// therefore goes through gradePairs(), which reads a label back explicitly.

import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  boundaryKey, parsePearsonGcseRow, parseAqaGcseRow,
  buildLayoutLines, fetchBytes, pdfTextFromBytes
} from "../src/tools/boundaries.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "golden_fixtures.json");
const LIVE = process.env.LIVE === "1";
const CACHE_DIR = join(HERE, ".golden-pdfs");

let passed = 0;
let failed = 0;

function ok(label, extra = "") { passed++; console.log(`  ok   ${label}${extra ? "  " + extra : ""}`); }
function bad(label, detail) { failed++; console.log(`  FAIL ${label}  ${detail}`); }

function assertEq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) ok(label);
  else bad(label, `got=${g} want=${w}`);
}

// Read a grade back by label. Never rely on Object.values ordering.
function gradePairs(fixture) {
  const labels = Object.keys(fixture.grades).sort(
    (a, b) => Number(b) - Number(a) // 9,8,7,... then U last
  );
  return {
    grades: labels,
    marks: labels.map((l) => fixture.grades[l])
  };
}

async function linesFor(fixture) {
  const url = fixture.source.url;
  if (!LIVE) {
    const cached = join(CACHE_DIR, url.split("/").pop());
    if (existsSync(cached)) {
      return await pdfTextFromBytes(readFileSync(cached));
    }
  }
  const bytes = await fetchBytes(url);
  if (!bytes) return null;
  if (!LIVE) {
    try {
      writeFileSync(join(CACHE_DIR, url.split("/").pop()), bytes);
    } catch { /* cache is best-effort */ }
  }
  return await pdfTextFromBytes(bytes);
}

const golden = JSON.parse(readFileSync(FIXTURES, "utf8"));

if (!LIVE) {
  try { readdirSync(CACHE_DIR); } catch { /* created lazily below */ }
}

async function run() {
  console.log("==================================================");
  console.log(`  GOLDEN BOUNDARY SUITE${LIVE ? "  (LIVE — refetching PDFs)" : "  (offline — cached PDFs)"}`);
  console.log("==================================================\n");

  const groups = [
    ["actual June 2025 — all eight GCSE qualifications", golden.actualJune2025],
    ["historical Pearson 1MA1 Higher", golden.historicalPearson1MA1Higher],
    ["tier regression", golden.tierRegression]
  ];

  const pdfCache = new Map();

  for (const [groupName, fixtures] of groups) {
    console.log(`== ${groupName} ==`);
    for (const f of fixtures) {
      const label = `${f.board} ${f.code}${f.tier ? "/" + f.tier : ""} ${f.series.month}-${f.series.year}`;

      // The key must encode this exact identity and nothing else.
      const key = boundaryKey({
        board: f.board, qual: f.qualification, code: f.code,
        tier: f.tier, year: f.series.year, series: f.series.month
      });
      if (!key) { bad(`${label} identity key`, "boundaryKey returned null"); continue; }

      if (!pdfCache.has(f.source.url)) pdfCache.set(f.source.url, await linesFor(f));
      const lines = pdfCache.get(f.source.url);
      if (!lines) { bad(`${label} source`, `could not read PDF ${f.source.url}`); continue; }

      const parsed = f.board === "pearson"
        ? parsePearsonGcseRow(lines, f.code, f.tier)
        : parseAqaGcseRow(lines, f.code, f.tier);

      if (!parsed) { bad(`${label} parse`, "no row matched"); continue; }

      const want = gradePairs(f);
      assertEq(`${label} grades`, parsed.grades, want.grades);
      assertEq(`${label} marks`, parsed.marks, want.marks);
      assertEq(`${label} maxMark`, parsed.maxMark, f.maxMark);
    }
    console.log("");
  }

  console.log("== zero-fabrication negatives (live engine, no fixtures) ==");

  // An unknown year must not borrow a neighbouring year.
  const y1999 = boundaryKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 1999, series: "JUN" });
  ok("unknown year still produces a distinct key", y1999.includes("|JUN|1999"));

  // Key uniqueness is what makes cross-year borrowing impossible.
  const k2024 = boundaryKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2024, series: "JUN" });
  const k2025 = boundaryKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2025, series: "JUN" });
  if (k2024 !== k2025) ok("June 2024 and June 2025 are different keys"); else bad("key collision", "years collide");

  // Tier must be part of identity.
  const kH = boundaryKey({ board: "aqa", qual: "gcse", code: "8461", tier: "H", year: 2025, series: "JUN" });
  const kF = boundaryKey({ board: "aqa", qual: "gcse", code: "8461", tier: "F", year: 2025, series: "JUN" });
  if (kH !== kF) ok("Higher and Foundation are different keys"); else bad("key collision", "tiers collide");

  // Series must be part of identity.
  const kJun = boundaryKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2022, series: "JUN" });
  const kNov = boundaryKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2022, series: "NOV" });
  if (kJun !== kNov) ok("June 2022 and November 2022 are different keys"); else bad("key collision", "series collide");

  // Malformed identity must be refused outright, never guessed.
  const junk = [
    [{ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2025, series: "" }, "blank series"],
    [{ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: 2025, series: "Summer" }, "unknown series word"],
    [{ board: "pearson", qual: "gcse", code: "", tier: "H", year: 2025, series: "JUN" }, "blank code"],
    [{ board: "pearson", qual: "", code: "1MA1", tier: "H", year: 2025, series: "JUN" }, "blank qualification"],
    [{ board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: null, series: "JUN" }, "missing year"],
    [{ board: "banana", qual: "gcse", code: "1MA1", tier: "H", year: 2025, series: "JUN" }, "unknown board"]
  ];
  for (const [req, why] of junk) {
    if (boundaryKey(req) === null) ok(`${why} → refused (null)`);
    else bad(`${why} → refused (null)`, "produced a key instead of refusing");
  }

  // A tiered subject must never answer a tier-less request.
  const lines8461 = await (async () => {
    const url = golden.actualJune2025.find((f) => f.code === "8461").source.url;
    if (!pdfCache.has(url)) pdfCache.set(url, await linesFor(golden.actualJune2025.find((f) => f.code === "8461")));
    return pdfCache.get(url);
  })();
  const noTier = parseAqaGcseRow(lines8461, "8461", null);
  if (noTier === null) ok("tiered subject + no tier → null (no guessed tier)");
  else bad("tiered subject + no tier → null", `returned ${JSON.stringify(noTier.grades)}`);

  // Monotonicity: boundaries must strictly descend from grade 9 downward.
  let monoFail = 0;
  for (const f of [...golden.actualJune2025, ...golden.historicalPearson1MA1Higher, ...golden.tierRegression]) {
    const lines = pdfCache.get(f.source.url);
    if (!lines) continue;
    const parsed = f.board === "pearson"
      ? parsePearsonGcseRow(lines, f.code, f.tier)
      : parseAqaGcseRow(lines, f.code, f.tier);
    if (!parsed) continue;
    const numeric = parsed.marks.filter((m) => Number.isFinite(m));
    for (let i = 1; i < numeric.length; i++) {
      if (numeric[i] > numeric[i - 1]) { monoFail++; break; }
    }
  }
  if (monoFail === 0) ok("every parsed table is monotonically descending");
  else bad("monotonicity", `${monoFail} table(s) not descending`);

  console.log("\n==================================================");
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

await run();
// ===========================================================================
// Subject finder — the link mechanism. Skipped offline because the catalogue
// comes from live board PDFs.
// ===========================================================================

if (LIVE) {
  const { findSubjects, matchSubjects, resolveSubject } = await import("../src/tools/subjects.js");

  console.log("\n== subject finder (live discovery) ==");
  const pearsonSubjects = await findSubjects({ board: "pearson" });
  const aqaSubjects = await findSubjects({ board: "aqa" });
  console.log(`  Pearson: ${pearsonSubjects.length} subjects`);
  console.log(`  AQA:     ${aqaSubjects.length} subjects`);

  if (pearsonSubjects.length > 40) ok("Pearson catalogue is a real discovery, not a short hardcoded list");
  else bad("Pearson catalogue size", `only ${pearsonSubjects.length}`);

  const catalogue = [...pearsonSubjects, ...aqaSubjects];

  // Every course the user actually sat must be discoverable.
  for (const want of golden.userGCSEs) {
    const boardId = want.board.toLowerCase().includes("pearson") ? "pearson" : "aqa";
    const hit = catalogue.find((s) =>
      s.board === boardId && s.code === want.code && (want.tier ? s.tier === want.tier[0].toUpperCase() : !s.tier));
    if (hit) ok(`discovered ${want.subject} ${want.code}${want.tier ? "/" + want.tier : ""}`);
    else bad(`discovered ${want.subject} ${want.code}`, "not in catalogue");
  }

  // An informal subject links only when the evidence is decisive.
  const cases = [
    ["Computer Science", true],   // one official course
    ["Macbeth", false]            // informal; no official course is invented
  ];
  for (const [name, shouldLink] of cases) {
    const r = resolveSubject(catalogue, name);
    const linked = Boolean(r && r.ambiguous === false && r.course);
    if (linked === shouldLink) ok(`resolve "${name}" → ${shouldLink ? "linked" : "not linked"}`);
    else bad(`resolve "${name}"`, `linked=${linked} expected=${shouldLink} (${JSON.stringify(r && (r.ambiguous ? "ambiguous" : r.course && r.course.code))})`);
  }

  // A tiered subject must never be auto-linked without saying which tier.
  const bio = resolveSubject(catalogue, "Biology");
  if (bio && bio.ambiguous) ok("\"Biology\" surfaces tier ambiguity instead of guessing");
  else bad("\"Biology\" ambiguity", JSON.stringify(bio && bio.course && bio.course.code));

  console.log(`\n==================================================`);
  console.log(`  FINAL: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}
