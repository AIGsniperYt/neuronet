// tests/examdata/identity.mjs — Identity and resolution tests.
import assert from "node:assert";
import { parseCourseKey, courseKey, seriesId, monthFromWord } from "../../src/tools/examData/schema.js";
import { Exam } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running identity.mjs tests...");

  // 1. parseCourseKey and courseKey
  const ck = courseKey({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" });
  assert.strictEqual(ck, "pearson:gcse:1MA1:H");
  count++;

  const parsed = parseCourseKey("aqa:gcse:8461:H");
  assert.deepStrictEqual(parsed, { board: "aqa", qual: "gcse", code: "8461", tier: "H" });
  count++;

  // 2. seriesId
  const sid = seriesId({ month: "JUN", year: 2025 });
  assert.strictEqual(sid, "JUN-2025");
  count++;

  assert.strictEqual(monthFromWord("June"), "JUN");
  assert.strictEqual(monthFromWord("November"), "NOV");
  count++;

  console.log(`identity.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
