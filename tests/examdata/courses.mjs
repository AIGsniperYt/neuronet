// tests/examdata/courses.mjs — Course resolution and auto-matching tests.
import assert from "node:assert";
import { Exam } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running courses.mjs tests...");

  await Exam.init();

  // Test 1: Full course catalogue list
  const courses = Exam.courseList();
  assert.ok(courses.length > 5, "courseList() returns canonical courses");
  const aqaBio = courses.find(c => c.board === "aqa" && c.code === "8461" && c.tier === "H");
  assert.ok(aqaBio, "AQA 8461 Biology Higher present");
  const pearsonMaths = courses.find(c => c.board === "pearson" && c.code === "1MA1" && c.tier === "H");
  assert.ok(pearsonMaths, "Pearson 1MA1 Higher present");
  count += 3;

  // Test 2: Subject auto-matching exact match
  const exact = Exam.listCourseCandidates({
    title: "Maths",
    board: "Pearson",
    qual: "GCSE",
    code: "1MA1",
    tier: "H"
  });
  assert.ok(exact.length > 0);
  assert.strictEqual(exact[0].code, "1MA1");
  assert.strictEqual(exact[0].tier, "H");
  count += 3;

  // Test 3: Ambiguous query — "Maths" alone has multiple candidates across boards/tiers
  const ambiguous = Exam.resolveCourse("Maths");
  // Ambiguous resolution returns null for course so UI prompts linker
  assert.strictEqual(ambiguous, null, "Ambiguous query returns null course without guessing");
  count++;

  console.log(`courses.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
