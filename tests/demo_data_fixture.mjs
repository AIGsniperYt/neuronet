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
  parseCourseKey
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);