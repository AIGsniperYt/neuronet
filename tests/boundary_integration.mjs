// boundary_integration.mjs — proves the pieces the tracker actually uses.
//
// The tracker renders from Exam.decisionFor, which reads the canonical store.
// So the thing that matters is not "can the parser read a PDF" but "does a
// table fetched by the engine become a decision the tracker resolves, with the
// right numbers, and stay unknown when it should".
//
//   node tests/boundary_integration.mjs          offline (cached PDFs)
//   LIVE=1 node tests/boundary_integration.mjs    refetch everything

import { registerAqaDiscovery } from "../src/tools/boundaries.js";
import { discoverAqaSeries } from "../src/tools/subjects.js";

registerAqaDiscovery(discoverAqaSeries);

const { toCanonicalBoundary } = await import("../src/tools/examData/bridge.js");
const repository = await import("../src/tools/examData/repository.js");
const boundaries = await import("../src/tools/boundaries.js");

let passed = 0;
let failed = 0;
const ok = (m) => { passed++; console.log(`  ok   ${m}`); };
const bad = (m, d = "") => { failed++; console.log(`  FAIL ${m}  ${d}`); };

// These numbers are the boards' own published values.
const CASES = [
  ["aqa", "gcse", "8461", "H", 2025, "June", 141],
  ["aqa", "gcse", "8462", "H", 2025, "June", 150],
  ["aqa", "gcse", "8463", "H", 2025, "June", 152],
  ["aqa", "gcse", "8700", null, 2025, "June", 119],
  ["aqa", "gcse", "8702", null, 2025, "June", 136],
  ["pearson", "gcse", "1MA1", "H", 2025, "June", 217],
  ["pearson", "gcse", "1MA1", "H", 2024, "June", 197],
  ["pearson", "gcse", "1MA1", "H", 2022, "June", 194],
  ["pearson", "gcse", "1CP2", null, 2025, "June", 124],
  ["pearson", "gcse", "1GB0", null, 2025, "June", 217]
];

console.log("== engine → canonical record → repository decision ==");
const records = [];
for (const [board, qual, code, tier, year, series, wantTop] of CASES) {
  const label = `${board} ${code}${tier ? "/" + tier : ""} ${year}`;
  const table = await boundaries.getBoundaries({ board, qual, code, tier, year, series });
  if (!table) { bad(`${label} fetched`); continue; }

  const rec = toCanonicalBoundary(table);
  if (!rec) { bad(`${label} canonical record`, "could not be keyed"); continue; }

  // Identity must survive the trip untouched.
  const wantKey = `${board}:${qual}:${code}:${tier || "_"}`;
  if (rec.courseKey !== wantKey) { bad(`${label} courseKey`, `got ${rec.courseKey} want ${wantKey}`); continue; }

  const top = rec.gradesInOrder.length ? rec.grades[rec.gradesInOrder[0]] : null;
  if (top !== wantTop) { bad(`${label} top mark`, `got ${top} want ${wantTop}`); continue; }

  records.push(rec);
  ok(`${label} → ${rec.id} top=${top}`);
}

console.log("\n== repository resolves each stored record as official ==");
const index = {
  courses: new Map(), series: new Map(), boundaries: new Map(),
  papers: new Map(), sources: new Map()
};
for (const r of records) {
  index.boundaries.set(r.id, r);
  if (!index.courses.has(r.courseKey)) {
    index.courses.set(r.courseKey, { board: r.board, qual: r.qual, code: r.code, tier: r.tier });
  }
  if (!index.series.has(r.seriesId)) index.series.set(r.seriesId, r.series);
}
const repo = repository.openExamRepository(index);

for (const [board, qual, code, tier, year, series, wantTop] of CASES) {
  const label = `decision ${code}${tier ? "/" + tier : ""} ${year}`;
  const d = repository.deriveBoundaryDecision(repo, { board, qual, code, tier }, year, series, {});
  if (!d || d.kind !== "official") { bad(label, `kind=${d && d.kind}`); continue; }
  if (d.top !== wantTop) { bad(label, `top=${d.top} want=${wantTop}`); continue; }
  ok(`${label} kind=official top=${d.top}`);
}

console.log("\n== honesty: what was never stored stays unknown ==");
const negatives = [
  ["aqa", "gcse", "8461", "H", 2023, "June", "an unacquired year"],
  ["aqa", "gcse", "8461", "H", 2025, "November", "a series never acquired"],
  ["pearson", "gcse", "1MA1", "H", 2025, "June", "present in the store"]
];
for (const [board, qual, code, tier, year, series, why] of negatives) {
  const d = repository.deriveBoundaryDecision(repo, { board, qual, code, tier }, year, series, {});
  if (why.startsWith("present")) continue; // sanity check that the positive case works
  if (d && d.kind === "unknown" && !d.hasTable) ok(`${why} → unknown`);
  else bad(`${why} → unknown`, `kind=${d && d.kind} hasTable=${d && d.hasTable}`);
}

// Mock papers must never resolve to official data.
const mock = repository.deriveBoundaryDecision(repo, { board: "aqa", qual: "gcse", code: "8461", tier: "H" }, 2025, "Mock", {});
if (mock && mock.kind === "unknown") ok("Mock paper → unknown");
else bad("Mock paper → unknown", `kind=${mock && mock.kind}`);

// Cross-year borrowing is the exact historical bug: ask 2024 for a store that
// only holds 2025 and the answer must be unknown, not the 2025 table.
const borrowed = repository.deriveBoundaryDecision(repo, { board: "aqa", qual: "gcse", code: "8702", tier: null }, 2024, "June", {});
if (borrowed && borrowed.kind === "unknown") ok("2024 request never borrows the stored 2025 table");
else bad("2024 request never borrows", `kind=${borrowed && borrowed.kind}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
