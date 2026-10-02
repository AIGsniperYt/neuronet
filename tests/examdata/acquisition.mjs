// tests/examdata/acquisition.mjs — Board-dispatching acquisition tests.
import assert from "node:assert";
import { Exam } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running acquisition.mjs tests...");

  await Exam.init();

  // Test 1: AQA GCSE 8461 Biology Higher June 2025
  const resH = await Exam.ensureForSitting({
    board: "aqa",
    qual: "gcse",
    code: "8461",
    tier: "H",
    year: "2025",
    seriesWord: "June",
    acquire: true
  });

  assert.strictEqual(resH.status, "complete");
  assert.ok(resH.boundary, "AQA 8461 H boundary exists");
  assert.strictEqual(resH.boundary.courseKey, "aqa:gcse:8461:H");
  assert.deepStrictEqual(resH.boundary.gradesInOrder, ["9", "8", "7", "6", "5", "4", "3"]);
  assert.strictEqual(resH.boundary.grades["9"], 142);
  count += 5;

  // Test 2: AQA GCSE 8461 Biology Foundation June 2025
  const resF = await Exam.ensureForSitting({
    board: "aqa",
    qual: "gcse",
    code: "8461",
    tier: "F",
    year: "2025",
    seriesWord: "June",
    acquire: true
  });

  assert.strictEqual(resF.status, "complete");
  assert.ok(resF.boundary, "AQA 8461 F boundary exists");
  assert.strictEqual(resF.boundary.courseKey, "aqa:gcse:8461:F");
  assert.deepStrictEqual(resF.boundary.gradesInOrder, ["5", "4", "3", "2", "1"]);
  assert.strictEqual(resF.boundary.grades["5"], 125);
  count += 5;

  // Test 3: Ensure board is AQA, not Pearson
  const decisionBio = Exam.decisionFor({ board: "aqa", qual: "gcse", code: "8461", tier: "H" }, 2025, "June");
  assert.strictEqual(decisionBio.kind, "official");
  assert.strictEqual(decisionBio.table.board, "aqa");
  count += 2;

  console.log(`acquisition.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
