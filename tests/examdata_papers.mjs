// tests/examdata_papers.mjs — canonical paper records + planner interaction.
import {
  buildExamIndex,
  openExamRepository,
  paperRecords,
  listPaperRecords,
  planRequirements,
  REQUIREMENT_TYPES,
  seriesId
} from "../src/tools/examData/index.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, got, want) =>
  check(name, got === want, `(got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const cache = {
  entries: {
    "pearson:JUN-2024:gcse": {
      board: "pearson", qual: "gcse",
      series: { month: "JUN", year: 2024, label: "June 2024" },
      fetchedAt: Date.now(),
      subjects: [
        { code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
          grades: { 9: 197, 8: 186, 7: 169 }, gradesInOrder: ["9", "8", "7"],
          papers: [
            { label: "Paper 1", maxMark: 80 },
            { label: "Paper 2", code: "1MA1/2H", maxMark: 80 },
            { label: "Paper 3", maxMark: 80, component: "with calculator" }
          ] },
        { code: "1MA1", title: "Mathematics", tier: "F", maxMark: 240,
          grades: { 5: 137, 4: 112 }, gradesInOrder: ["5", "4"], papers: [] }
      ]
    },
    "pearson:JUN-2025:gcse": {
      board: "pearson", qual: "gcse",
      series: { month: "JUN", year: 2025, label: "June 2025" },
      fetchedAt: Date.now(),
      subjects: [
        { code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
          grades: { 9: 217, 8: 205, 7: 188 }, gradesInOrder: ["9", "8", "7"],
          papers: [
            { label: "Paper 1", maxMark: 80 },
            { label: "Paper 3", maxMark: 80, component: "with calculator" }
          ] }
      ]
    }
  }
};

const repo = openExamRepository(buildExamIndex(cache));

// ---- canonical records -----------------------------------------------------
const recs = paperRecords(cache.entries["pearson:JUN-2024:gcse"].subjects[0].papers);
eq("paperRecords → 3 papers", recs.length, 3);
eq("paper id falls back to label slug when no code", recs[0].id, "paper-1");
eq("paper id uses code when present", recs[1].id, "1MA1/2H");
eq("paper maxMark typed", recs[0].maxMark, 80);
eq("component preserved", recs[2].component, "with calculator");

const all2024 = repo.papersFor({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, { month: "JUN", year: 2024 });
eq("repository papersFor returns stored papers", all2024.length, 3);

const across = listPaperRecords(repo, { board: "pearson", qual: "gcse", code: "1MA1", tier: "H" });
eq("listPaperRecords dedupes across 2024+2025", across.length, 3, JSON.stringify(across.map((p) => p.id)));
check("listPaperRecords keeps Paper 2 (only in 2024)", across.some((p) => p.id === "1MA1/2H"));
check("listPaperRecords keeps Paper 3 component across years", across.some((p) => p.id === "paper-3" && p.component));

// ---- planner: papers are a first-class requirement, satisfied post-fetch ----
// Scenario 1: nothing fetched yet (empty cache) → both outputs are required.
const preFetchCache = { entries: {} };
const sittings = [
  { subject: "Maths", year: 2024, series: "June" }
];
const enrollment = () => ({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" });
const isSatisfied = (type, ck, sid, base) => {
  if (type === REQUIREMENT_TYPES.BOUNDARY) return false;
  // papers are satisfied once the entry carries paper metadata
  const entry = preFetchCache.entries[`${base.board}:${seriesId(base.series)}:${base.qual}`];
  return !!(entry && (entry.subjects || []).some((s) => (s.papers || []).length > 0));
};

const reqs = planRequirements(sittings, () => enrollment(), isSatisfied);
const types = reqs.map((r) => r.type).sort();
eq("planRequirement asks for both boundary and papers", types.join(","), "boundary,papers");
check("boundary listed before papers for same course+series",
  reqs[0].type === REQUIREMENT_TYPES.BOUNDARY && reqs[1].type === REQUIREMENT_TYPES.PAPERS);

// Scenario 2: a fetch delivered the entry with paper metadata → both satisfied.
const satisfiedCache = {
  entries: {
    "pearson:JUN-2024:gcse": JSON.parse(JSON.stringify(cache.entries["pearson:JUN-2024:gcse"]))
  }
};
const isSat2 = (type, ck, sid, base) => {
  const entry = satisfiedCache.entries[`${base.board}:${seriesId(base.series)}:${base.qual}`];
  if (type === REQUIREMENT_TYPES.BOUNDARY) return !!entry;
  return !!(entry && (entry.subjects || []).some((s) => (s.papers || []).length > 0));
};
const reqs2 = planRequirements(sittings, () => enrollment(), isSat2);
eq("post-fetch cache → no boundary requirement left", reqs2.filter((r) => r.type === REQUIREMENT_TYPES.BOUNDARY).length, 0);
eq("post-fetch cache → no papers requirement left", reqs2.filter((r) => r.type === REQUIREMENT_TYPES.PAPERS).length, 0);

console.log(`\npapers: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);