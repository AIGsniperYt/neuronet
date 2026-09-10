import {
  buildExamIndex,
  openExamRepository,
  deriveBoundaryDecision,
  markForDecisionGrade,
  migrateSitting,
  seriesLabel,
  courseKey,
  parseCourseKey,
  validateBoundaryRow,
  planRequirements,
  sittingRequirement,
  summarize,
  provenanceOf,
  provenanceLabel
} from "/home/aigsniper/Documents/website/neuronet/frontend/src/tools/examData/index.js";
import {
  qualId,
  canonicalGradeKey
} from "/home/aigsniper/Documents/website/neuronet/frontend/src/tools/examData/schema.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, got, want) =>
  check(name, got === want, `(got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ---- realistic legacy blob ------------------------------------------------
const L = {
  entries: {
    "pearson:jun-2024:gcse": {
      board: "pearson", qual: "gcse",
      series: { month: "JUN", year: 2024, label: "June 2024" },
      fetchedAt: 1700000000000,
      subjects: [
        { code: "1MA1", title: "Mathematics", tier: "H", maxMark: 240,
          grades: { 9: 197, 8: 167, 7: 137, 6: 105, 5: 73, 4: 42, 3: 26, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
          papers: [{ label: "Paper 1", maxMark: 80 }, { label: "Paper 2", maxMark: 80 }, { label: "Paper 3", maxMark: 80 }] },
        { code: "1MA1", title: "Mathematics", tier: "F", maxMark: 240,
          grades: { 5: 175, 4: 142, 3: 103, 2: 65, 1: 27, U: 0 }, gradesInOrder: ["5", "4", "3", "2", "1", "U"], papers: [] }
      ]
    },
    // lowercase month — legacy tools wrote mixed case
    "pearson:jun-2025:gcse": {
      board: "pearson", qual: "gcse",
      series: { month: "JUN", year: 2025, label: "June 2025" },
      fetchedAt: 1710000000000,
      subjects: [
        { code: "1MA1", title: "Mathematics", tier: "H", maxMark: 240,
          grades: { 9: 217, 8: 186, 7: 156, 6: 121, 5: 87, 4: 53, 3: 36, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"], papers: [] }
      ]
    },
    // AQA: shared base code, tier in the code
    "aqa:jun-2024:gcse": {
      board: "aqa", qual: "gcse",
      series: { month: "JUN", year: 2024, label: "June 2024" },
      fetchedAt: 1700000000000,
      subjects: [
        { code: "8300H", title: "Mathematics", grades: { 9: 208, 8: 187, 7: 166 }, gradesInOrder: ["9", "8", "7"], maxMark: 240, papers: [] },
        { code: "8300F", title: "Mathematics", grades: { 5: 138, 4: 115, 3: 92 }, gradesInOrder: ["5", "4", "3"], maxMark: 240, papers: [] }
      ]
    }
  }
};

// ---- Phase B: migration ----------------------------------------------------
const index = buildExamIndex(L);
eq("index → course count (1MA1 H/F + 8300 H/F)", index.stats.courseCount, 4);
eq("index → unique series count (exam seasons, board-agnostic)", index.stats.seriesCount, 2);
eq("index → boundary count", index.stats.boundaryCount, 5);

const key204 = courseKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" });
const keyF = courseKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "F" });
eq("courseKey H", key204, "pearson:gcse:1MA1:H");
eq("courseKey F separate from H", keyF, "pearson:gcse:1MA1:F");
check("parseCourseKey round-trips", parseCourseKey(key204).code === "1MA1" && parseCourseKey(key204).tier === "H");

// Provenance from cache rows is "official". Unverifiable stored values are manual.
const b2024 = openExamRepository(index).pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2024, "june");
check("official provenance from cache rows", b2024.boundary.provenance.kind === "official", JSON.stringify(b2024.boundary.provenance));
eq("official provenance has parsedAt", b2024.boundary.provenance.parsedAt, 1700000000000);
check("boundary papers migrated", Array.isArray(b2024.boundary.papers) && b2024.boundary.papers.length === 3);
eq("migrateSitting: plain sitting is manual", migrateSitting({ gradeBoundary: 217 }).kind, "manual");

// AQA tier lives on the code
const aqaH = courseKey({ board: "aqa", qual: "gcse", code: "8300H", tier: "H" });
eq("AQA tier-from-code key", aqaH, "aqa:gcse:8300H:H");
const aqaRep = openExamRepository(index);
const aqaHit = aqaRep.pickBoundary({ board: "aqa", qual: "gcse", code: "8300H" }, 2024, "june");
eq("AQA 8300H resolves to H row (not F)", aqaHit && aqaHit.boundary.grades["9"], 208);

// latestBoundary picks 2025 for 1MA1 H
const latest = aqaRep.latestBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" });
eq("latestBoundary is 2025", latest && latest.series.year, 2025);

// title fallback for rows without codes
const lite = buildExamIndex({ entries: {
  "ocr:jun-2024:gcse": { board: "ocr", qual: "gcse", series: { month: "JUN", year: 2024, label: "June 2024" }, fetchedAt: 1,
    subjects: [{ title: "Computer Science", tier: "H", grades: { 9: 180, 8: 160 }, gradesInOrder: ["9", "8"] }] }
} });
const ocrCourse = openExamRepository(lite).courseFor({ board: "ocr", qual: "gcse", title: "Computer Science" });
check("title-fallback courseFor works", ocrCourse && ocrCourse.code === null && ocrCourse.tier === "H");

// validateBoundaryRow: sane row ok, non-monotonic row flagged
eq("valid row → no problems", validateBoundaryRow({ grades: { 9: 200, 8: 180 }, gradesInOrder: ["9", "8"] }).length, 0);
check("non-monotonic row flagged", validateBoundaryRow({ grades: { 9: 180, 8: 200 }, gradesInOrder: ["9", "8"] }).length > 0);

// provenance label
eq("provenance label official", provenanceLabel(provenanceOf({ kind: "official" })), "Official");
eq("provenance label manual", provenanceLabel(provenanceOf({ kind: null })), "Stored (manual)");

// ---- decision parity over the canonical repository -------------------------
const repo = openExamRepository(index);
const d2024 = deriveBoundaryDecision(repo, { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "H" }, 2024, "june", {});
eq("repo decision 2024 → official 197", d2024.kind + "|" + d2024.top, "official|197");
const d2025 = deriveBoundaryDecision(repo, { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "H" }, 2025, "", {});
eq("repo decision 2025 → official 217", d2025.top, 217);
const fund = deriveBoundaryDecision(repo, { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "F" }, 2024, "", {});
eq("Foundation never offers 9", fund.hasTable && fund.table.grades["9"] == null, true);
eq("Foundation offers its real top", fund.top, 175);
eq("markForDecisionGrade missing label → null (no substitution)", markForDecisionGrade(d2024, "2"), null);
eq("markForDecisionGrade present label → mark", markForDecisionGrade(d2024, "7"), 137);
const undated = deriveBoundaryDecision(repo, { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "H" }, null, "", {});
eq("undated repo decision → projected 217", undated.kind + "|" + undated.top, "projected|217");

// ---- Phase C: requirement scheduler -----------------------------------------
const sittings = [
  { subject: "Maths (Higher)", year: 2024, series: "June" },
  { subject: "Maths (Higher)", year: 2025, series: "June" },
  { subject: "Maths (Higher)", year: 2024, series: "June" }, // duplicate
  { subject: "Maths (Higher)", year: null, series: "" },      // in-progress: skip
  { subject: "Maths (Higher)", year: 2024, series: "Mock" },  // mock: skip
  { subject: "Unknown Subject", year: 2024, series: "June" }  // unresolvable: skip
];
const resolveEnrollment = (s) => {
  if (s.subject === "Maths (Higher)") return { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "H" };
  return null;
};
const isSatisfied = (type, ck, sid) =>
  type === "boundary" && ck === "pearson:gcse:1MA1:H" && sid === "JUN-2024";

const reqs = planRequirements(sittings, resolveEnrollment, isSatisfied);
eq("scheduler total (2024 boundary satisfied, rest required)", reqs.length, 3);
check("papers required for 2024", reqs.some((r) => r.type === "papers" && r.series.year === 2024));
check("boundary 2024 satisfied → filtered", !reqs.some((r) => r.type === "boundary" && r.series.year === 2024));
check("boundary 2025 required", reqs.some((r) => r.type === "boundary" && r.series.year === 2025));
check("no undated/mock/unresolvable requirements", reqs.every((r) => r.series.year === 2024 || r.series.year === 2025));
check("summary sums", summarize(reqs).total === 3);

// deterministic ordering with NO filtering: asc year, boundary first
const zero = planRequirements(sittings.slice(0, 2), resolveEnrollment, () => false);
eq("ordered asc year + boundary-first prefix", zero[0].type + "|" + zero[0].series.year + "," + zero[1].type + "|" + zero[1].series.year + "," + zero[2].type + "|" + zero[2].series.year, "boundary|2024,papers|2024,boundary|2025");
eq("sittingRequirement returns null for mock", sittingRequirement({ subject: "M", year: 2024, series: "Mock" }, resolveEnrollment), null);
eq("sittingRequirement returns null when no year", sittingRequirement({ subject: "M", year: "", series: "" }, resolveEnrollment), null);

// ---- Honour fixes (frontier audit): absence stays absent --------------------
eq("qualId: blank qual stays null (never GCSE)", qualId(""), null);
eq("qualId: unknown qual stays null", qualId("BTEC"), null);
eq("qualId: GCSE maps", qualId("GCSE"), "gcse");
eq("qualId: A-Level maps", qualId("A-Level"), "alevel");
eq("courseKey: unknown qual not keyable (no silent gcse)", courseKey({ board: "pearson", qual: "", code: "1MA1", tier: "H" }), null);
eq("canonicalGradeKey: plain A stays A (A-level)", canonicalGradeKey("A"), "A");
eq("canonicalGradeKey: A* stays A*", canonicalGradeKey("A*"), "A*");
eq("canonicalGradeKey: B stays B", canonicalGradeKey("B"), "B");
eq("canonicalGradeKey: 9 stays 9", canonicalGradeKey("9"), "9");

// pickBoundary exactness: a specified month must match exactly, never fall to
// another month of the same year.
const novrej = openExamRepository(index)
  .pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2024, "November");
eq("June-2024 request with only June cached still resolves (2024, june)", (openExamRepository(index).pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2024, "june") || {}).boundary && 1, 1);
eq("month-mismatch: request June when only November exists -> null", novrej, null);

// year-only, two series in the same year -> ambiguous (must not silently pick);
// year-only, exactly one series -> resolves.
const twoSeries = buildExamIndex({ entries: {
  "pearson:jun-2020:gcse": { board: "pearson", qual: "gcse", series: { month: "JUN", year: 2020, label: "June 2020" }, fetchedAt: 1,
    subjects: [{ code: "1MA1", title: "Mathematics", tier: "H", grades: { 9: 200, 8: 190 }, gradesInOrder: ["9", "8"] }] },
  "pearson:nov-2020:gcse": { board: "pearson", qual: "gcse", series: { month: "NOV", year: 2020, label: "November 2020" }, fetchedAt: 1,
    subjects: [{ code: "1MA1", title: "Mathematics", tier: "H", grades: { 9: 192, 8: 181 }, gradesInOrder: ["9", "8"] }] },
  "pearson:nov-2021:gcse": { board: "pearson", qual: "gcse", series: { month: "NOV", year: 2021, label: "November 2021" }, fetchedAt: 1,
    subjects: [{ code: "1MA1", title: "Mathematics", tier: "H", grades: { 9: 188, 8: 177 }, gradesInOrder: ["9", "8"] }] }
} });
const twoRepo = openExamRepository(twoSeries);
eq("year-only ambiguity (JUN+NOV 2020) -> null, no silent pick", twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2020, ""), null);
eq("year-only ambiguous decision -> unknown", deriveBoundaryDecision(twoRepo, { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", tier: "H" }, 2020, "", {}).kind, "unknown");
eq("year-only single series (2021 only NOV) -> resolves to Nov", (twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2021, "") || {}).boundary && (((twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2021, "") || {}).boundary.series.month)), "NOV");
eq("specified-month exact match (2021, november) -> Nov", (twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2021, "November") || {}).boundary && ((twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2021, "November") || {}).boundary.series.month), "NOV");
eq("specified-month mismatch (2021, june) -> null", twoRepo.pickBoundary({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2021, "June"), null);

// blank series stays monthless in the planner (never invented as June)
const blank = sittingRequirement({ subject: "Maths (Higher)", year: 2024, series: "" }, resolveEnrollment);
eq("blank series requirement: month stays null", blank && blank.series.month, null);
eq("blank series requirement: seriesId null", blank && blank.seriesId, null);
const blankDated = planRequirements([{ subject: "Maths (Higher)", year: 2024, series: "" }], resolveEnrollment, () => false);
eq("blank series plan keeps year-distinct keys (no JUN collision)", blankDated.length, 2);
eq("blank series boundary req has no fabricated month", (blankDated.find((r) => r.type === "boundary") || {}).series && blankDated.find((r) => r.type === "boundary").series.month, null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);