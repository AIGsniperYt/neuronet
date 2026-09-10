import {
  resolveBoundaryDecision,
  findGradeMark,
  reconcileCourse
} from "/home/aigsniper/Documents/website/neuronet/frontend/src/tools/gradeBoundaries.js";

// ---------------------------------------------------------------------------
// ExamData conformance suite — derived-decision honesty contract.
// Grade fixtures: Pearson 1MA1 Higher June 2024 and June 2025 grades are the
// OFFICIAL tables extracted from Pearson's own published PDFs
// (grade-boundaries-june-2024-gcse.pdf, grade-boundaries-june-2025-gcse.pdf):
//   2024: 9=197 8=167 7=137 6=105 5=73 4=42 3=26 U=0  (no grades 2/1)
//   2025: 9=217 8=186 7=156 6=121 5=87 4=53 3=36 U=0  (no grades 2/1)
// All other fixtures are synthetic logic fixtures.
// ---------------------------------------------------------------------------

const MATHS = { board: "Pearson (Edexcel)", qual: "GCSE", title: "Mathematics (Higher)", code: "1MA1", tier: "H" };

const H_2024 = {
  code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
  grades: { "9": 197, "8": 167, "7": 137, "6": 105, "5": 73, "4": 42, "3": 26, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
  papers: [{ label: "Paper 1", maxMark: 80 }, { label: "Paper 2", maxMark: 80 }, { label: "Paper 3", maxMark: 80 }]
};
const H_2025 = {
  code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
  grades: { "9": 217, "8": 186, "7": 156, "6": 121, "5": 87, "4": 53, "3": 36, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
  papers: H_2024.papers
};

function monthName(m) {
  return { JAN: "January", JUN: "June", NOV: "November" }[m] || m;
}

function makeCache({ next2025FetchedBefore2024 = false } = {}) {
  const entries = {};
  const base = 1600000000000;
  const t24 = next2025FetchedBefore2024 ? base + 2 : base + 1;
  const t25 = next2025FetchedBefore2024 ? base + 1 : base + 2;
  entries["pearson:jun-2024:gcse"] = {
    board: "pearson", qual: "gcse",
    series: { month: "JUN", year: 2024, label: "June 2024" },
    fetchedAt: t24,
    subjects: [H_2024]
  };
  entries["pearson:jun-2025:gcse"] = {
    board: "pearson", qual: "gcse",
    series: { month: "JUN", year: 2025, label: "June 2025" },
    fetchedAt: t25,
    subjects: [H_2025]
  };
  return { entries };
}

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`ok   ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${extra}`);
  }
}
function eq(name, got, want) {
  check(name, got === want, `(got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

const cache = makeCache();

// 1. Dated 2024 → official, user-verified 197, provenance carries series.
const d24 = resolveBoundaryDecision(cache, MATHS, 2024, "June", {});
eq("2024 dated → kind official", d24.kind, "official");
eq("2024 dated → top 197", d24.top, 197);
eq("2024 dated → year 2024", d24.year, 2024);
check("2024 dated → source label cites June 2024", (d24.sourceLabel || "").includes("June 2024"), d24.sourceLabel);
eq("2024 dated → grade 8 via table = 167", findGradeMark(d24.table, "8"), 167);

// 2. Dated 2025 → official, user-verified 217.
const d25 = resolveBoundaryDecision(cache, MATHS, 2025, "June", {});
eq("2025 dated → kind official", d25.kind, "official");
eq("2025 dated → top 217", d25.top, 217);

// 3. Dated 2022 (not cached) → UNKNOWN, never borrowed/fabricated.
const d22 = resolveBoundaryDecision(cache, MATHS, 2022, "June", {});
eq("2022 dated → kind unknown", d22.kind, "unknown");
eq("2022 dated → reason series-not-fetched", d22.reason, "series-not-fetched");
eq("2022 dated → top null (no fabrication)", d22.top, null);

// 4. Undated → projection = NEWEST published (2025), labelled.
const du = resolveBoundaryDecision(cache, MATHS, null, "", {});
eq("undated → kind projected", du.kind, "projected");
eq("undated → top 217 (newest 2025)", du.top, 217);
eq("undated → year 2025", du.year, 2025);
check("undated → tip labels projection", (du.tip || "").startsWith("Projected (newest published)"), du.tip);

// 5. Undated, only 2024 cached → projection = 197 (only truth available).
const cache24 = makeCache();
delete cache24.entries["pearson:jun-2025:gcse"];
const du24 = resolveBoundaryDecision(cache24, MATHS, null, "", {});
eq("undated only-2024 → top 197", du24.top, 197);

// 6. Stale fetch order can never let 2024 beat 2025 for undated lookups.
const stale = resolveBoundaryDecision(makeCache({ next2025FetchedBefore2024: true }), MATHS, null, "June", {});
eq("undated stale-fetch → still 217 (newest exam year wins)", stale.top, 217);

// 7. Dated 2025 with only 2024 cached → UNKNOWN (no cross-year borrowing).
const d25nb = resolveBoundaryDecision(cache24, MATHS, 2025, "June", {});
eq("2025 dated with only 2024 cached → kind unknown", d25nb.kind, "unknown");
eq("2025 dated with only 2024 cached → top null", d25nb.top, null);

// 8. Stored snapshot → manual, labelled.
const manualSnap = resolveBoundaryDecision({ entries: {} }, MATHS, 2024, "June", {
  gradeBoundaries: { grades: { "9": 300 }, gradesInOrder: ["9"] }
});
eq("stored snapshot → kind manual", manualSnap.kind, "manual");
eq("stored snapshot → top 300", manualSnap.top, 300);
check("stored snapshot → source label says stored", (manualSnap.sourceLabel || "").includes("Stored"), manualSnap.sourceLabel);

// 9. Stored single top mark (no table) → manual, hasTable false.
const manualTop = resolveBoundaryDecision({ entries: {} }, MATHS, 2024, "June", { gradeBoundary: 210 });
eq("stored top only → kind manual", manualTop.kind, "manual");
eq("stored top only → top 210", manualTop.top, 210);
eq("stored top only → hasTable false", manualTop.hasTable, false);

// 10. Live official beats a stored snapshot for the same dated sitting.
const liveWins = resolveBoundaryDecision(cache, MATHS, 2024, "June", {
  gradeBoundaries: { grades: { "9": 300 }, gradesInOrder: ["9"] },
  gradeBoundary: 310
});
eq("dated: live official beats stored manual", liveWins.kind, "official");
eq("dated: live official top 197", liveWins.top, 197);

// 11. Mock/specimen → unknown, even with a full healthy cache.
const mock = resolveBoundaryDecision(cache, MATHS, 2024, "Mock", {});
eq("mock series → kind unknown", mock.kind, "unknown");
eq("mock series → reason mock-specimen", mock.reason, "mock-specimen");
eq("mock series → top null", mock.top, null);

// 12. No course / no data → unknown no-data.
const nada = resolveBoundaryDecision({ entries: {} }, null, null, "", {});
eq("no course no data → kind unknown", nada.kind, "unknown");
eq("no course no data → reason no-data", nada.reason, "no-data");

// 13. reconcileCourse honours a stored explicit tier (frontier acceptance: a
// confirmed Foundation link stays Foundation even when Higher is cached too).
const tierCache = { entries: {
  "pearson:jun-2024:gcse": { board: "pearson", qual: "gcse", series: { month: "JUN", year: 2024, label: "June 2024" }, fetchedAt: 1,
    subjects: [
      { code: "1MA1", title: "Mathematics", tier: "H", maxMark: 240, grades: { "9": 197, "8": 186 }, gradesInOrder: ["9", "8"], papers: [] },
      { code: "1MA1", title: "Mathematics", tier: "F", maxMark: 240, grades: { "5": 137, "4": 112 }, gradesInOrder: ["5", "4"], papers: [] }
    ] }
} };
const storedFoundation = { board: "pearson", code: "1MA1", title: "Mathematics (Foundation)", qual: "gcse" };
const healedF = reconcileCourse(tierCache, storedFoundation, null);
eq("stored explicit Foundation stays Foundation", healedF && healedF.tier, "F");
eq("stored Foundation resolves to F row", healedF && healedF.code, "1MA1");
const storedHigher = { board: "pearson", code: "1MA1", title: "Mathematics (Higher)", qual: "gcse" };
eq("stored explicit Higher stays Higher", reconcileCourse(tierCache, storedHigher, null) && reconcileCourse(tierCache, storedHigher, null).tier, "H");
const tierless = { board: "pearson", code: "1MA1", title: "Mathematics", qual: "gcse" };
eq("genuinely tier-less legacy link maps to 9-1 table", reconcileCourse(tierCache, tierless, null) && reconcileCourse(tierCache, tierless, null).tier, "H");
eq("subject-name tier still wins over stored tier", reconcileCourse(tierCache, storedFoundation, "H") && reconcileCourse(tierCache, storedFoundation, "H").tier, "H");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);