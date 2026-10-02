// tests/examdata/discovery.mjs — Course catalogue discovery tests.
import assert from "node:assert";
import { Exam, discoverCourseCatalogue } from "../../src/tools/examData/app.js";

export async function run() {
  let count = 0;
  console.log("Running discovery.mjs tests...");

  await Exam.init();

  const catalogue = discoverCourseCatalogue();
  assert.ok(Array.isArray(catalogue));
  assert.ok(catalogue.length >= 10);
  count += 2;

  // Check Pearson courses present in catalogue
  const pearsonMathsH = catalogue.find(c => c.id === "pearson:gcse:1MA1:H");
  const pearsonMathsF = catalogue.find(c => c.id === "pearson:gcse:1MA1:F");
  const pearsonGeog = catalogue.find(c => c.id === "pearson:gcse:1GB0");
  const pearsonCS = catalogue.find(c => c.id === "pearson:gcse:1CP2");
  assert.ok(pearsonMathsH, "Pearson 1MA1 Higher course present");
  assert.ok(pearsonMathsF, "Pearson 1MA1 Foundation course present");
  assert.ok(pearsonGeog, "Pearson 1GB0 course present");
  assert.ok(pearsonCS, "Pearson 1CP2 course present");
  count += 4;

  // Check AQA courses present in catalogue
  const aqaBioH = catalogue.find(c => c.id === "aqa:gcse:8461:H");
  const aqaBioF = catalogue.find(c => c.id === "aqa:gcse:8461:F");
  const aqaChemH = catalogue.find(c => c.id === "aqa:gcse:8462:H");
  assert.ok(aqaBioH, "AQA 8461 Biology Higher course present");
  assert.ok(aqaBioF, "AQA 8461 Biology Foundation course present");
  assert.ok(aqaChemH, "AQA 8462 Chemistry Higher course present");
  count += 3;

  // courseList() returns all discovered supported courses
  const list = Exam.courseList();
  assert.ok(list.length >= catalogue.length, "courseList() returns full catalogue");
  count++;

  console.log(`discovery.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
