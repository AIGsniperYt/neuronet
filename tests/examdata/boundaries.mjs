// tests/examdata/boundaries.mjs — Boundary resolution tests.
import assert from "node:assert";
import { Exam } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running boundaries.mjs tests...");

  await Exam.init();

  // Ensure June 2024 and June 2025 Pearson Maths 1MA1 Higher data are present
  const ens = await Exam.ensureForSitting({
    board: "pearson",
    qual: "gcse",
    code: "1MA1",
    tier: "H",
    year: "2024",
    seriesWord: "June",
    acquire: true
  });
  console.log("ensureForSitting status:", ens.status, "acquired:", ens.acquired);

  await Exam.ensureForSitting({
    board: "pearson",
    qual: "gcse",
    code: "1MA1",
    tier: "H",
    year: "2025",
    seriesWord: "June",
    acquire: true
  });

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

  // Test 3: Exact series lookup — asking for a year/series with no exact source returns UNKNOWN
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
