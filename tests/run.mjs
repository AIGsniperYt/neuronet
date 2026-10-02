// tests/run.mjs — Zero-dependency test runner.
// Runs the ExamData and tracker test suites and reports exact assertion counts.

import { run as runIdentity } from "./examdata/identity.mjs";
import { run as runBoundaries } from "./examdata/boundaries.mjs";
import { run as runDiscovery } from "./examdata/discovery.mjs";
import { run as runAcquisition } from "./examdata/acquisition.mjs";
import { run as runCourses } from "./examdata/courses.mjs";
import { run as runTrackerViewModel } from "./examdata/tracker-view-model.mjs";

async function main() {
  console.log("==================================================");
  console.log("  EXAMDATA & TRACKER HARNESS RUNNER");
  console.log("==================================================\n");

  let totalPassed = 0;
  let totalFailed = 0;

  const suites = [
    { name: "identity", fn: runIdentity },
    { name: "boundaries", fn: runBoundaries },
    { name: "discovery", fn: runDiscovery },
    { name: "acquisition", fn: runAcquisition },
    { name: "courses", fn: runCourses },
    { name: "tracker-view-model", fn: runTrackerViewModel }
  ];

  for (const suite of suites) {
    try {
      const result = await suite.fn();
      totalPassed += result.passed || 0;
      totalFailed += result.failed || 0;
    } catch (err) {
      console.error(`\n[FAIL] Suite '${suite.name}' threw an unexpected error:`);
      console.error(err);
      totalFailed += 1;
    }
  }

  console.log("\n==================================================");
  console.log(`TOTAL RESULT: ${totalPassed} assertions PASSED, ${totalFailed} FAILED.`);
  console.log("==================================================");

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
