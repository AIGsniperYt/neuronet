// boundary_integration.mjs — deterministic canonical-record integration.
// Acquisition/network behavior is tested separately; this suite feeds verified
// published values through the legacy-table-to-canonical mapper and repository.
import { readFile } from "node:fs/promises";
import { toCanonicalBoundary } from "../src/tools/examData/bridge.js";
import { openExamRepository, deriveBoundaryDecision } from "../src/tools/examData/repository.js";

const golden = JSON.parse(await readFile(new URL("./golden_fixtures.json", import.meta.url), "utf8"));
let passed = 0;
let failed = 0;
const ok = (name) => { passed += 1; console.log(`ok   ${name}`); };
const bad = (name, details) => { failed += 1; console.log(`FAIL ${name} ${details || ""}`); };

const source = { publisher: "Official fixture", url: "https://qualifications.pearson.com/verified-fixture.pdf" };
const fixtures = [...golden.actualJune2025, ...golden.historicalPearson1MA1Higher, ...golden.tierRegression];
const records = [];
for (const fixture of fixtures) {
  const table = {
    board: fixture.board,
    qual: fixture.qualification,
    code: fixture.code,
    tier: fixture.tier,
    year: fixture.series.year,
    month: fixture.series.month,
    grades: Object.keys(fixture.grades),
    marks: Object.keys(fixture.grades).map((grade) => fixture.grades[grade]),
    maxMark: fixture.maxMark,
    papers: fixture.papers || [],
    source
  };
  const record = toCanonicalBoundary(table);
  if (!record) { bad(`${fixture.code} ${fixture.series.year} canonical conversion`, "no record"); continue; }
  const expectedId = `${fixture.board}:${fixture.qualification}:${fixture.code}:${fixture.tier || "_"}|${fixture.series.month}-${fixture.series.year}`;
  if (record.id !== expectedId) { bad(`${fixture.code} canonical identity`, `${record.id} != ${expectedId}`); continue; }
  const firstGrade = Object.keys(fixture.grades)[0];
  if (record.grades[firstGrade] !== fixture.grades[firstGrade]) { bad(`${fixture.code} top grade`, "marks changed during conversion"); continue; }
  records.push(record);
  ok(`${fixture.code}${fixture.tier ? `/${fixture.tier}` : ""} ${fixture.series.month}-${fixture.series.year} converted (${record.id})`);
}

const index = { courses: new Map(), series: new Map(), boundaries: new Map(), papers: new Map(), sources: new Map() };
for (const record of records) {
  index.boundaries.set(record.id, record);
  if (!index.courses.has(record.courseKey)) index.courses.set(record.courseKey, {
    board: record.board, qual: record.qual, code: record.code, tier: record.tier
  });
  index.series.set(record.seriesId, record.series);
}
const repo = openExamRepository(index);
for (const record of records) {
  const parsed = record.courseKey.split(":");
  const decision = deriveBoundaryDecision(repo, { board: parsed[0], qual: parsed[1], code: parsed[2], tier: parsed[3] === "_" ? null : parsed[3] }, record.series.year, record.series.month, {});
  const expectedTopGrade = Object.keys(record.grades)[0];
  if (decision.kind === "official" && decision.top === record.grades[expectedTopGrade]) {
    ok(`${record.id} resolves exact official decision`);
  } else {
    bad(`${record.id} resolves exact official decision`, `kind=${decision.kind} top=${decision.top}`);
  }
}

const absent = deriveBoundaryDecision(repo, { board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 1999, "June", {});
if (absent.kind === "unknown" && !absent.hasTable) ok("unrecorded historical year stays unknown");
else bad("unrecorded historical year stays unknown", `kind=${absent.kind}`);
const mock = deriveBoundaryDecision(repo, { board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, 2025, "Mock", {});
if (mock.kind === "unknown") ok("mock sitting stays unknown"); else bad("mock sitting stays unknown", `kind=${mock.kind}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
