// tests/examdata/boundaries.mjs — Boundary resolution tests.
import assert from "node:assert";
import { Exam, sync } from "../../src/tools/examData/app.js";
import * as storage from "../../src/tools/examData/storage.js";

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
