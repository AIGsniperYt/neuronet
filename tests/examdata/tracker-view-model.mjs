// tests/examdata/tracker-view-model.mjs — Tracker view model and grade selection tests.
import assert from "node:assert";
import { Exam } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running tracker-view-model.mjs tests...");

  await Exam.init();

  // Ensure June 2024 and June 2025 Maths 1MA1 Higher data exist
  await Exam.ensureForSitting({
    board: "pearson",
    qual: "gcse",
    code: "1MA1",
    tier: "H",
    year: "2024",
    seriesWord: "June",
    acquire: true
  });

  await Exam.ensureForSitting({
    board: "pearson",
    qual: "gcse",
    code: "1MA1",
    tier: "H",
    year: "2025",
    seriesWord: "June",
    acquire: true
  });

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
  await Exam.ensureForSitting({
    board: "aqa",
    qual: "gcse",
    code: "8461",
    tier: "F",
    year: "2025",
    seriesWord: "June",
    acquire: true
  });

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
