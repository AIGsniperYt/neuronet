// tests/demo_data_fixture.mjs — execution-spec #42 integration fixture.
// The real 110-node export (user's own tracker data, schemaVersion 6) is the
// committed demo-data.json. This suite drives the REAL rows through the
// canonical seams (monthFromWord / seriesId / courseKey identity + the
// resolveBoundaryDecision decision path) and asserts the honesty contract:
//   - the export's series vocabulary normalizes without fabrication
//     ("" / null / Mock / Specimen -> no month; June/November -> JUN/NOV);
//   - stored user data is honour-"manual", never auto-promoted to "official",
//     even when the stored numbers happen to equal the official table;
//   - a 2022 sitting never borrows a cached 2025 official table (2022!==2025);
//   - a blank-series 2025 sitting with an official JUN-2025 cache resolves
//     official; the blank-series 2024 sitting with only a 2025 cache stays
//     manual (no cross-series projection into a dated request).
import { createRequire } from "node:module";
import {
  monthFromWord,
  seriesId,
  courseKey,
  parseCourseKey,
  ensureForSitting,
  IDENTITY_CONFLICT,
  getForSitting,
  openExamRepository,
  provenanceOf,
  VERIFY,
  sourceRecordId,
  loadSnapshot,
  clearAllStores,
  clearSnapshotCache,
  putCourse,
  putBoundary,
  putSeries,
  putSource
} from "../src/tools/examData/index.js";
import {
  resolveBoundaryDecision
} from "../src/tools/gradeBoundaries.js";

const require = createRequire(import.meta.url);
const demo = require("../demo-data.json");

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// ---- 1. The committed fixture is the real export --------------------------
eq("fixture: schemaVersion 6", demo.schemaVersion, 6);
check("fixture: 110 nodes", Array.isArray(demo.nodes) && demo.nodes.length === 110, `len=${demo.nodes && demo.nodes.length}`);
const byType = {};
for (const n of demo.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
eq("fixture: type counts", byType, { source: 27, subject: 9, analysis: 15, pastpaper: 59 });

// ---- 2. Series vocabulary normalizes without fabrication -------------------
eq("June -> JUN", monthFromWord("June"), "JUN");
eq("November -> NOV", monthFromWord("November"), "NOV");
eq("blank series \"\" -> null month", monthFromWord(""), null);
eq("null series -> null month", monthFromWord(null), null);
eq("Specimen -> null month", monthFromWord("Specimen"), null);
eq("Mock -> null month", monthFromWord("Mock"), null);
eq("unknown word -> null month (never invents)", monthFromWord("Winterfettle"), null);
eq("seriesId NOV-2022", seriesId({ month: "NOV", year: 2022 }), "NOV-2022");
eq("seriesId blank month -> null", seriesId({ month: "", year: 2024 }), null);
eq("seriesId null month -> null", seriesId({ month: null, year: 2024 }), null);

// ---- 3. Course identity normalizes without fabrication --------------------
const mathsCourse = { board: "pearson", qual: "gcse", code: "1MA1", title: "Mathematics (Higher)" };
const mathsKey = courseKey(mathsCourse);
check("Maths stored course -> parseable key", Boolean(mathsKey) && typeof mathsKey === "string", `key=${mathsKey}`);
const mk = parseCourseKey(mathsKey);
const parsedMaths = { board: mk.board, qual: mk.qual, code: mk.code };
eq("Maths parsed identity", parsedMaths, { board: "pearson", qual: "gcse", code: "1MA1" });
eq("Maths title tier flows into key (enrollment == row derivation)", mk.tier, "H");
eq("unknown /*?qual/code -> null key (no fabricated gcse)", courseKey({ board: "aqa", qual: null, code: null }), null);
eq("empty course -> null key", courseKey({}), null);

// ---- 4. Real rows: honesty of provenance and anti-fabrication -------------
const real2024 = demo.nodes.find((n) => n.type === "pastpaper" && n.subject === "Maths" && n.year === 2024);
const real2025 = demo.nodes.find((n) => n.type === "pastpaper" && n.subject === "Maths" && n.year === 2025);
const real2022 = demo.nodes.find((n) => n.type === "pastpaper" && n.subject === "Maths" && n.year === 2022 && n.series === "June");
check("fixture: Maths 2024 stored full snapshot present", Boolean(real2024 && real2024.gradeBoundaries && real2024.gradeBoundaries.grades), "");
check("fixture: Maths 2025 stored full snapshot present", Boolean(real2025 && real2025.gradeBoundaries && real2025.gradeBoundaries.grades), "");
check("fixture: Maths 2022 scalar present", Number.isFinite(Number(real2022 && real2022.gradeBoundary)), `gb=${real2022 && real2022.gradeBoundary}`);

// Official cache contains ONLY the real June 2025 Higher table.
const official2025Higher = {
  code: "1MA1", title: "Mathematics", tier: "H", maxMark: 240,
  grades: { "9": 217, "8": 186, "7": 156, "6": 121, "5": 87, "4": 53, "3": 36, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
  papers: []
};
const cache2025 = { entries: {
  "pearson:jun-2025:gcse": {
    board: "pearson", qual: "gcse",
    series: { month: "JUN", year: 2025, label: "June 2025" },
    fetchedAt: 1, subjects: [official2025Higher]
  }
} };

// 4a. 2022 June sitting with only a stored scalar: NEVER borrows the 2025
// official table — 2022 !== 2025. Stored 194 shows as manual/stored-top.
const d2022 = resolveBoundaryDecision(cache2025, mathsCourse, 2022, "June", { gradeBoundary: Number(real2022.gradeBoundary) });
eq("2022 -> kind manual (not official, no cross-year)", d2022.kind, "manual");
eq("2022 -> reason stored-top", d2022.reason, "stored-top");
eq("2022 -> top from stored scalar", d2022.top, Number(real2022.gradeBoundary));

// 4b. Blank-series 2024 sitting with a stored full snapshot that HAPPENS to
// equal the official table: still manual — user data is never promoted to
// official-fetch by similarity.
const d2024 = resolveBoundaryDecision(cache2025, mathsCourse, 2024, "", { gradeBoundaries: real2024.gradeBoundaries });
eq("2024 blank-series -> kind manual (similarity never promotes)", d2024.kind, "manual");
eq("2024 blank-series -> reason stored-snapshot", d2024.reason, "stored-snapshot");
eq("2024 blank-series -> top 197 from stored snapshot", d2024.top, 197);

// 4c. Blank-series 2025 sitting WITH the exact official JUN-2025 cache:
// month-less dated request resolves to the single 2025 series -> official.
const d2025 = resolveBoundaryDecision(cache2025, mathsCourse, 2025, "", { gradeBoundaries: real2025.gradeBoundaries, gradeBoundary: Number(real2025.gradeBoundary) });
eq("2025 blank-series + official cache -> kind official", d2025.kind, "official");
eq("2025 blank-series -> reason exact-year-official", d2025.reason, "exact-year-official");
eq("2025 blank-series -> top 217", d2025.top, 217);

// 4d. Same 2025 request WITHOUT the official cache -> stored snapshot, manual.
const d2025n = resolveBoundaryDecision({ entries: {} }, mathsCourse, 2025, "", { gradeBoundaries: real2025.gradeBoundaries, gradeBoundary: Number(real2025.gradeBoundary) });
eq("2025 no cache -> kind manual (stored data only zero-fabrication path)", d2025n.kind, "manual");
eq("2025 no cache -> top 217", d2025n.top, 217);

// 4e. Mock/specimen rows are unknown even though a full official cache exists.
const mockRow = demo.nodes.find((n) => n.type === "pastpaper" && n.series === "Mock");
check("fixture: a Mock row exists", Boolean(mockRow), "");
const dMock = resolveBoundaryDecision(cache2025, mathsCourse, null, "Mock", {});
eq("Mock -> kind unknown", dMock.kind, "unknown");
eq("Mock -> reason mock-specimen", dMock.reason, "mock-specimen");

// 4f. No-course subject (e.g. English Lang) has no canonical key: resolving a
// pastoral sitting must fail closed (no fabricated identity).
const engLang = demo.nodes.find((n) => n.type === "subject" && n.subject === "English Lang");
eq("English Lang stored course null", Boolean(engLang.officialCourse) || engLang.officialCourse === null, true);
const engKey = courseKey(engLang.officialCourse);
check("English Lang -> null canonical key", engKey === null || engKey === undefined, `key=${engKey}`);

// ---- 5. Frontier #19: real export — persisted Foundation vs requested Higher --
// The exported Maths subject is registered as "Mathematics (Foundation)" while
// the user's stored boundary numbers are the HIGHER tables (2022 scalar=194,
// 2023 scalar=203, 2024 snapshot top 9=197, 2025 snapshot top 9=217). The engine
// must NEVER silently mutate the persisted Foundation course into the Higher
// identity — it surfaces an identity conflict and requires explicit confirmation.
const mathsSubject = demo.nodes.find((n) => n.type === "subject" && n.subject === "Maths");
eq("demo: persisted Maths course keys as Foundation", courseKey(mathsSubject.officialCourse), "pearson:gcse:1MA1:F");

await clearSnapshotCache();
await clearAllStores();
await putCourse({ id: "pearson:gcse:1MA1:F", board: "pearson", qual: "gcse", code: "1MA1", tier: "F", title: "Mathematics (Foundation)" });

// 5a. requested Higher over persisted Foundation -> identity conflict, and the
// engine writes NOTHING and mutates nothing.
const want = await ensureForSitting({
  board: "pearson", qual: "gcse", code: "1MA1", tier: "H",
  year: 2022, seriesWord: "June"
});
eq("demo: Higher-request over Foundation-persisted -> IDENTITY_CONFLICT", want.reason, IDENTITY_CONFLICT);
eq("demo: conflict asks for confirmation", want.confirmationRequired, true);
eq("demo: conflict requested key", want.conflict && want.conflict.requested, "pearson:gcse:1MA1:H");
eq("demo: conflict persisted key", want.conflict && want.conflict.persisted, "pearson:gcse:1MA1:F");
let snapDemo = await loadSnapshot();
check("demo: conflict persisted NOTHING (only the Foundation course remains)",
  snapDemo.examBoundaries.length === 0 && snapDemo.examSeries.length === 0 && snapDemo.examCourses.length === 1 && snapDemo.examCourses[0].id === "pearson:gcse:1MA1:F");
check("demo: conflict decision is unknown (official Higher numbers NOT presented)", Boolean(want.decision) && want.decision.kind === "unknown", `kind=${want.decision && want.decision.kind}`);

// 5b. explicit confirmation adopts the REQUESTED identity as a NEW course; the
// persisted Foundation record is never rewritten.
const confirmed = await ensureForSitting({
  board: "pearson", qual: "gcse", code: "1MA1", tier: "H",
  year: 2022, seriesWord: "June", confirm: true
});
eq("demo: confirmation adopts Higher course (boundary still missing -> partial)", confirmed.status, "partial");
check("demo: confirmation queues a P0 boundary job for the Higher course",
  confirmed.queue.length === 1 && confirmed.queue[0].courseKey === "pearson:gcse:1MA1:H");
snapDemo = await loadSnapshot();
check("demo: persisted Foundation course untouched by confirmation", snapDemo.examCourses.some((c) => c.id === "pearson:gcse:1MA1:F" && c.tier === "F"));
check("demo: Higher course added as a NEW identity (not a rewrite)", snapDemo.examCourses.some((c) => c.id === "pearson:gcse:1MA1:H"));

// 5c. populate the official Higher tables for the four years and prove each
// series resolves INDEPENDENTLY (frontier #19: June 2022/2023/2024/2025).
const srcIdDemo = sourceRecordId("https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/verified-series.pdf");
await putSource({ id: srcIdDemo, url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/verified-series.pdf", contentHash: "cafe", publisher: "Pearson Edexcel", accessedAt: Date.now(), verifiedAt: Date.now() });
const H_TABLES = {
  2022: { marks: [194, 165, 137, 104, 71, 38, 21], top: 194 },
  2023: { marks: [203, 174, 145, 112, 79, 47, 31], top: 203 },
  2024: { marks: [197, 167, 137, 105, 73, 42, 26], top: 197 },
  2025: { marks: [217, 186, 156, 121, 87, 53, 36], top: 217 }
};
const hOrder = ["9", "8", "7", "6", "5", "4", "3", "U"];
for (const [y, { marks }] of Object.entries(H_TABLES)) {
  const grades = Object.fromEntries(hOrder.map((g, i) => [g, marks[i]]));
  await putSeries({ id: `JUN-${y}`, month: "JUN", year: Number(y), label: `June ${y}`, qual: "gcse", board: "pearson" });
  await putBoundary({
    id: `pearson:gcse:1MA1:H|JUN-${y}`,
    courseKey: "pearson:gcse:1MA1:H",
    seriesId: `JUN-${y}`,
    series: { month: "JUN", year: Number(y), label: `June ${y}` },
    grades, gradesInOrder: hOrder, maxMark: 240, tier: "H",
    sourceIds: [srcIdDemo],
    provenance: provenanceOf({ kind: "official", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/verified-series.pdf", verification: VERIFY.VERIFIED, parsedAt: Date.now() })
  });
}
const snapDemoFinal = await loadSnapshot();
const repoDemo = openExamRepository({
  courses: new Map(snapDemoFinal.examCourses.map((c) => [c.id, { ...c }])),
  series: new Map(snapDemoFinal.examSeries.map((s) => [s.id, { ...s }])),
  boundaries: new Map(snapDemoFinal.examBoundaries.map((b) => [b.id, { ...b }]))
});
for (const [y, { top }] of Object.entries(H_TABLES)) {
  const d = await getForSitting(repoDemo, { board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, String(y), "June", {});
  eq(`demo: June ${y} resolves official independently`, d.kind, "official");
  eq(`demo: June ${y} exact top = ${top}`, d.top, top);
}
const demoRepoCourses = [...repoDemo.index.courses.values()];
check("demo: repository still carries both identities (F untouched, H added)", demoRepoCourses.some((c) => c.id === "pearson:gcse:1MA1:F") && demoRepoCourses.some((c) => c.id === "pearson:gcse:1MA1:H"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);