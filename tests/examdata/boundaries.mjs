// tests/examdata/boundaries.mjs — Boundary resolution tests.
import assert from "node:assert";
import { Exam, sync } from "../../src/tools/examData/app.js";
import * as storage from "../../src/tools/examData/storage.js";
import { boundaryKey, pearsonSeriesUrl, parsePearsonGcseRow } from "../../src/tools/boundaries.js";

async function seedBoundary(board, code, tier, year, grades, gradesInOrder) {
  const courseKey = `${board}:gcse:${code}${tier ? `:${tier}` : ""}`;
  const seriesId = `JUN-${year}`;
  const sourceId = `fixture:${board}:${year}`;
  const contentHash = "a".repeat(64);
  const url = board === "pearson"
    ? "https://qualifications.pearson.com/fixture.pdf"
    : "https://filestore.aqa.org.uk/fixture.pdf";
  await storage.putCourse({ id: courseKey, board, qual: "gcse", code, tier: tier || null });
  await storage.putSeries({ id: seriesId, board, qual: "gcse", month: "JUN", year });
  await storage.putSource({ id: sourceId, url, publisher: board, verification: "verified", contentHash });
  await storage.putBoundary({
    id: `${courseKey}|${seriesId}`,
    courseKey,
    seriesId,
    series: { month: "JUN", year },
    grades,
    gradesInOrder,
    maxMark: 240,
    sourceIds: [sourceId],
    provenance: { kind: "official", verification: "verified", url, contentHash, sourceName: "official-pdf-row-parser" }
  });
}

export async function run() {
  let count = 0;
  console.log("Running boundaries.mjs tests...");

  // Test 0: the acquisition path supplies `series` as { month, year }, while
  // direct callers supply a word plus a year. Both must key identically; the
  // object form previously stringified to "[object Object]" and failed closed.
  const objectKey = boundaryKey({ board: "aqa", qual: "gcse", code: "8461", tier: "H", series: { month: "JUN", year: 2025 } });
  const wordKey = boundaryKey({ board: "aqa", qual: "gcse", code: "8461", tier: "H", year: 2025, series: "June" });
  assert.strictEqual(objectKey, "aqa|gcse|8461|H|JUN|2025");
  assert.strictEqual(wordKey, objectKey);
  count += 2;

  // Test 0b: Pearson's legacy series URLs are pinned official documents, not
  // filename guesses. June 2020/2021 were cancelled and must stay null.
  assert.ok(pearsonSeriesUrl(2017, "JUN").includes("1706-gcse-9-1-grade-boundaries-v1.pdf"));
  assert.ok(pearsonSeriesUrl(2017, "NOV").includes("1711-gcse-9-1-grade-boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2018, "JUN").includes("1806-GCSE-9-1-Subject-Grade-Boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2018, "NOV").includes("1811-GCSE-9-1-Subject-Grade-Boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2019, "JUN").includes("1906-gcse-9-1-subject-grade-boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2019, "NOV").includes("1911-gcse-9-1-subject-grade-boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2020, "NOV").includes("grade-boundaries-nov-2020-gcse-9-1-maths-eng.pdf"));
  assert.ok(pearsonSeriesUrl(2021, "NOV").includes("2111_GCSE_9-1_Maths_and_Eng_Subject_Grade_Boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2023, "NOV").includes("2311-gcse-9-1-subject-grade-boundaries.pdf"));
  assert.ok(pearsonSeriesUrl(2026, "JUN").includes("grade-boundaries-june-2026-gcse.pdf"));
  assert.strictEqual(pearsonSeriesUrl(2020, "JUN"), null);
  assert.strictEqual(pearsonSeriesUrl(2021, "JUN"), null);
  // Unlisted years must fail closed, not get a constructed fake filename.
  assert.strictEqual(pearsonSeriesUrl(2026, "NOV"), null);
  assert.strictEqual(pearsonSeriesUrl(2027, "JUN"), null);
  count += 13;

  // Test 0c: the 2017 rows print "Higher"/"Foundation" without parentheses;
  // both shapes must yield the exact official table.
  const legacyH = parsePearsonGcseRow(
    ["1MA1 Mathematics Higher Raw 240 190 157 124 96 68 41 27 0"], "1MA1", "H");
  assert.deepStrictEqual(legacyH.grades, ["9", "8", "7", "6", "5", "4", "3", "U"]);
  assert.deepStrictEqual(legacyH.marks, [190, 157, 124, 96, 68, 41, 27, 0]);
  const legacyF = parsePearsonGcseRow(
    ["1MA1 Mathematics Foundation Raw 240 158 122 90 58 26 0"], "1MA1", "F");
  assert.deepStrictEqual(legacyF.grades, ["5", "4", "3", "2", "1", "U"]);
  assert.deepStrictEqual(legacyF.marks, [158, 122, 90, 58, 26, 0]);
  const modernH = parsePearsonGcseRow(
    ["Mathematics (Higher) 1MA1 Subject 240 202 170 139 109 79 50 35 0"], "1MA1", "H");
  assert.strictEqual(modernH.marks[0], 202);
  count += 4;

  await storage.clearSnapshotCache();
  await storage.clearAllStores();
  await Exam.init();
  // Pure repository/display tests use explicit cache fixtures. Acquisition is
  // tested separately with offline failures, never a synthetic official fetch.
  await seedBoundary("pearson", "1MA1", "H", 2024,
    { "9": 197, "8": 167, "7": 137, "6": 105, "5": 73, "4": 42, "3": 26, U: 0 },
    ["9", "8", "7", "6", "5", "4", "3", "U"]);
  await seedBoundary("pearson", "1MA1", "H", 2025,
    { "9": 217, "8": 186, "7": 156, "6": 121, "5": 87, "4": 53, "3": 36, U: 0 },
    ["9", "8", "7", "6", "5", "4", "3", "U"]);
  await seedBoundary("aqa", "8462", "H", 2024,
    { "9": 149, "8": 130, "7": 112, "6": 90, "5": 68, "4": 46, "3": 35 },
    ["9", "8", "7", "6", "5", "4", "3"]);
  await seedBoundary("aqa", "8462", "F", 2025,
    { "5": 132, "4": 109, "3": 80, "2": 52, "1": 24 },
    ["5", "4", "3", "2", "1"]);
  await sync();

  // Test 1: Maths 1MA1 Higher June 2024 thresholds
  const m2024 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2024",
    seriesWord: "June"
  });
  console.log("m2024 state:", m2024.state, "reason:", m2024.reason);
  assert.strictEqual(m2024.state, "official");
  assert.strictEqual(Exam.findGradeMark(m2024.table, "9"), 197);
  assert.strictEqual(Exam.findGradeMark(m2024.table, "7"), 137);
  count += 3;

  // Test 2: Maths 1MA1 Higher June 2025 thresholds
  const m2025 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2025",
    seriesWord: "June"
  });
  assert.strictEqual(m2025.state, "official");
  assert.strictEqual(Exam.findGradeMark(m2025.table, "9"), 217);
  assert.strictEqual(Exam.findGradeMark(m2025.table, "7"), 156);
  count += 3;

  // Test 3: AQA Chemistry uses the official 8462 subject tables, including
  // the corrected historical values and Foundation scale.
  const chemH = Exam.getBoundaryDisplayModel({ courseId: "aqa:gcse:8462:H", year: "2024", seriesWord: "June" });
  assert.strictEqual(Exam.findGradeMark(chemH.table, "9"), 149);
  assert.strictEqual(Exam.findGradeMark(chemH.table, "4"), 46);
  const chemF = Exam.getBoundaryDisplayModel({ courseId: "aqa:gcse:8462:F", year: "2025", seriesWord: "June" });
  assert.strictEqual(Exam.findGradeMark(chemF.table, "5"), 132);
  assert.strictEqual(Exam.findGradeMark(chemF.table, "1"), 24);
  count += 4;

  // Test 4: Summer 2020/2021 science exams were cancelled, so the UI should
  // explain the absence instead of showing a generic blank.
  const covid = Exam.getBoundaryDisplayModel({
    courseId: "aqa:gcse:8462:H", year: "2020", seriesWord: "June"
  });
  assert.strictEqual(covid.state, "unknown");
  assert.strictEqual(covid.reason, "NO_BOUNDARIES_PUBLISHED");
  assert.match(covid.tip, /2020/);
  const covid21 = Exam.getBoundaryDisplayModel({
    courseId: "aqa:gcse:8462:H", year: "2021", seriesWord: "June"
  });
  assert.strictEqual(covid21.reason, "NO_BOUNDARIES_PUBLISHED");
  assert.match(covid21.tip, /2021/);
  count += 4;

  // Test 5: Exact series lookup — asking for a year/series with no exact source returns UNKNOWN
  const m1999 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "1999",
    seriesWord: "June"
  });
  assert.strictEqual(m1999.state, "unknown");
  assert.strictEqual(m1999.reason, "NO_EXACT_SOURCE");
  assert.strictEqual(m1999.table, null);
  count += 3;

  console.log(`boundaries.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
