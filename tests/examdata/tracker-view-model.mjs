// tests/examdata/tracker-view-model.mjs — Tracker view model and grade selection tests.
import assert from "node:assert";
import { Exam, sync } from "../../src/tools/examData/app.js";
import * as storage from "../../src/tools/examData/storage.js";

async function seedBoundary(board, code, tier, year, grades, gradesInOrder) {
  const courseKey = `${board}:gcse:${code}:${tier}`;
  const seriesId = `JUN-${year}`;
  const sourceId = `fixture:${board}:${year}`;
  const contentHash = "b".repeat(64);
  const url = board === "pearson"
    ? "https://qualifications.pearson.com/fixture.pdf"
    : "https://filestore.aqa.org.uk/fixture.pdf";
  await storage.putCourse({ id: courseKey, board, qual: "gcse", code, tier });
  await storage.putSeries({ id: seriesId, board, qual: "gcse", month: "JUN", year });
  await storage.putSource({ id: sourceId, url, publisher: board, verification: "verified", contentHash });
  await storage.putBoundary({
    id: `${courseKey}|${seriesId}`, courseKey, seriesId,
    series: { month: "JUN", year }, grades, gradesInOrder,
    maxMark: 240, sourceIds: [sourceId],
    provenance: { kind: "official", verification: "verified", url, contentHash, sourceName: "official-pdf-row-parser" }
  });
}

export async function run() {
  let count = 0;
  console.log("Running tracker-view-model.mjs tests...");

  await storage.clearSnapshotCache();
  await storage.clearAllStores();
  await Exam.init();
  await seedBoundary("pearson", "1MA1", "H", 2024,
    { "9": 197, "8": 167, "7": 137, "6": 105, "5": 73, "4": 42, "3": 26, U: 0 },
    ["9", "8", "7", "6", "5", "4", "3", "U"]);
  await seedBoundary("pearson", "1MA1", "H", 2025,
    { "9": 217, "8": 186, "7": 156, "6": 121, "5": 87, "4": 53, "3": 36, U: 0 },
    ["9", "8", "7", "6", "5", "4", "3", "U"]);
  await seedBoundary("aqa", "8461", "F", 2025,
    { "5": 140, "4": 125, "3": 94, "2": 63, "1": 32 },
    ["5", "4", "3", "2", "1"]);
  await sync();

  // Test 1: Selected grade ["7"] for June 2024 -> threshold 137
  const m2024_7 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2024",
    seriesWord: "June",
    selectedGrades: ["7"]
  });
  assert.strictEqual(m2024_7.state, "official");
  assert.deepStrictEqual(m2024_7.selectedGrades, ["7"]);
  assert.strictEqual(Exam.findGradeMark(m2024_7.table, "7"), 137);
  count += 3;

  // Test 2: Selected grade ["7"] for June 2025 -> threshold 156
  const m2025_7 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2025",
    seriesWord: "June",
    selectedGrades: ["7"]
  });
  assert.strictEqual(m2025_7.state, "official");
  assert.deepStrictEqual(m2025_7.selectedGrades, ["7"]);
  assert.strictEqual(Exam.findGradeMark(m2025_7.table, "7"), 156);
  count += 3;

  // Test 3: Selected grades ["9", "7"] -> both thresholds present
  const m2024_97 = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2024",
    seriesWord: "June",
    selectedGrades: ["9", "7"]
  });
  assert.strictEqual(Exam.findGradeMark(m2024_97.table, "9"), 197);
  assert.strictEqual(Exam.findGradeMark(m2024_97.table, "7"), 137);
  count += 2;

  // Test 4: Clear selection -> default grade is table's top grade (gradesInOrder[0])
  const m2024_default = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2024",
    seriesWord: "June",
    selectedGrades: []
  });
  assert.strictEqual(m2024_default.defaultGrade, "9");
  count++;

  // Test 5: AQA Foundation default grade is 5
  const aqaF = Exam.getBoundaryDisplayModel({
    courseId: "aqa:gcse:8461:F",
    year: "2025",
    seriesWord: "June",
    selectedGrades: []
  });
  assert.strictEqual(aqaF.state, "official");
  assert.strictEqual(aqaF.defaultGrade, "5", "Foundation defaults to 5, not hardcoded 9");
  count += 2;

  // Test 6: Missing exact source -> state: unknown, reason: NO_EXACT_SOURCE
  const missing = Exam.getBoundaryDisplayModel({
    courseId: "pearson:gcse:1MA1:H",
    year: "2010",
    seriesWord: "June"
  });
  assert.strictEqual(missing.state, "unknown");
  assert.strictEqual(missing.reason, "NO_EXACT_SOURCE");
  count += 2;

  console.log(`tracker-view-model.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
