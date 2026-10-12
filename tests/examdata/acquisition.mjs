// acquisition.mjs — offline acquisition must fail closed when no official
// document is returned. Test fixtures for display/resolution live in
// boundaries.mjs; this suite never calls live board endpoints.
import assert from "node:assert";
import { Exam, sync } from "../../src/tools/examData/app.js";
import * as storage from "../../src/tools/examData/storage.js";

export async function run() {
  let count = 0;
  console.log("Running acquisition.mjs tests...");
  await Exam.init();

  const fetchImpl = async () => new Response("not found", { status: 404 });
  const requests = [
    { board: "aqa", qual: "gcse", code: "8461", tier: "H", year: "2025", seriesWord: "June" },
    { board: "pearson", qual: "gcse", code: "1MA1", tier: "H", year: "2026", seriesWord: "June" },
    { board: "ocr", qual: "gcse", code: "J560", tier: "H", year: "2025", seriesWord: "June" }
  ];

  for (const request of requests) {
    const result = await Exam.ensureForSitting({ ...request, acquire: true, fetchImpl });
    assert.ok(["partial", "unknown"].includes(result.status));
    assert.strictEqual(result.decision.kind, "unknown");
    assert.strictEqual(result.decision.hasTable, false);
    assert.ok(["NO_EXACT_SOURCE", "FETCH_FAILED"].includes(result.acquired && result.acquired.reason || result.reason)
      || ["NO_EXACT_SOURCE", "FETCH_FAILED"].includes(result.decision.reason));
    count += 4;
  }

  // Persisted official-shaped data without trustworthy source provenance must
  // not become an official display decision.
  const courseKey = "aqa:gcse:8461:H";
  const seriesId = "JUN-2031";
  const sourceId = "unverified:source";
  await storage.putCourse({ id: courseKey, board: "aqa", qual: "gcse", code: "8461", tier: "H" });
  await storage.putSeries({ id: seriesId, board: "aqa", qual: "gcse", month: "JUN", year: 2031 });
  await storage.putSource({ id: sourceId, url: "https://filestore.aqa.org.uk/fake.pdf", verification: "verified", contentHash: "fake" });
  await storage.putBoundary({
    id: `${courseKey}|${seriesId}`, courseKey, seriesId,
    series: { month: "JUN", year: 2031 },
    grades: { "9": 199 }, gradesInOrder: ["9"], maxMark: 200,
    sourceIds: [sourceId],
    provenance: { kind: "official", verification: "verified", url: "https://filestore.aqa.org.uk/fake.pdf", contentHash: "fake", sourceName: "uk-exam-engine" }
  });
  await sync();
  const rejected = Exam.getBoundaryDisplayModel({ courseId: courseKey, year: 2031, seriesWord: "June" });
  assert.strictEqual(rejected.state, "unknown");
  assert.strictEqual(rejected.table, null);
  assert.notStrictEqual(rejected.defaultGrade, "9");
  count += 3;

  console.log(`acquisition.mjs: ${count} assertions passed.`);
  return { passed: count, failed: 0 };
}
