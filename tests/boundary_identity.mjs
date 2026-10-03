// boundary_identity.mjs — the normalisation layer, tested directly.
//
// These functions decide what a request MEANS. When one of them guesses, the
// engine fetches the wrong paper or answers with the wrong qualification, and
// the failure looks like "the data is wrong" rather than "the request was
// misunderstood". So they are pinned here, including the near-misses.

import { qualId, boardId, tierId, monthId, boundaryKey } from "../src/tools/boundaries.js";

let passed = 0, failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ok   ${label} = ${g}`); }
  else { failed++; console.log(`  FAIL ${label} = ${g}, want ${w}`); }
};

console.log("== qualId ==");
eq("GCSE", qualId("GCSE"), "gcse");
eq("gcse lowercase", qualId("gcse"), "gcse");
eq("A level", qualId("A level"), "alevel");
eq("A-Level", qualId("A-Level"), "alevel");
eq("A level Maths", qualId("A level Maths"), "alevel");
eq("AS", qualId("AS"), "as");
eq("AS Level", qualId("AS Level"), "as");
eq("blank", qualId(""), null);
eq("null", qualId(null), null);
eq("undefined", qualId(undefined), null);
eq("'was' is not AS", qualId("was"), null);
eq("'has' is not AS", qualId("has"), null);
eq("'Class' is not AS", qualId("Class"), null);
eq("'Biology' is not a qualification", qualId("Biology"), null);

console.log("\n== boardId ==");
eq("Pearson Edexcel", boardId("Pearson (Edexcel)"), "pearson");
eq("pearson", boardId("pearson"), "pearson");
eq("AQA", boardId("AQA"), "aqa");
eq("OCR", boardId("OCR"), "ocr");
eq("WJEC is not supported", boardId("WJEC"), null);
eq("blank board", boardId(""), null);

console.log("\n== tierId ==");
eq("H", tierId("H"), "H");
eq("Higher", tierId("Higher"), "H");
eq("F", tierId("F"), "F");
eq("Foundation", tierId("Foundation"), "F");
eq("un-tiered", tierId(""), null);
eq("unknown tier word", tierId("Standard"), null);

console.log("\n== monthId ==");
eq("June", monthId("June"), "JUN");
eq("jun", monthId("jun"), "JUN");
eq("November", monthId("November"), "NOV");
eq("blank stays blank", monthId(""), null);
eq("Summer is not a series", monthId("Summer"), null);
eq("Mock is not a series", monthId("Mock"), null);

console.log("\n== boundaryKey: exact identity only ==");
const base = { board: "aqa", qual: "gcse", code: "8461", tier: "H", year: 2025, series: "June" };
eq("complete request is keyed", boundaryKey(base), "aqa|gcse|8461|H|JUN|2025");

for (const [field, why] of [["series", "blank series"], ["year", "missing year"], ["code", "blank code"], ["qual", "blank qualification"]]) {
  const bad = { ...base, [field]: field === "year" ? null : "" };
  eq(`${why} is refused`, boundaryKey(bad), null);
}
eq("unknown board is refused", boundaryKey({ ...base, board: "WJEC" }), null);
eq("unknown series word is refused", boundaryKey({ ...base, series: "Summer" }), null);

// Every identity component must change the key, or two different requests would
// share one cache slot and one would silently read the other's numbers.
eq("year changes the key", boundaryKey({ ...base, year: 2024 }) === boundaryKey(base), false);
eq("tier changes the key", boundaryKey({ ...base, tier: "F" }) === boundaryKey(base), false);
eq("series changes the key", boundaryKey({ ...base, series: "November" }) === boundaryKey(base), false);
eq("code changes the key", boundaryKey({ ...base, code: "8462" }) === boundaryKey(base), false);
eq("board changes the key", boundaryKey({ ...base, board: "pearson" }) === boundaryKey(base), false);
eq("qual changes the key", boundaryKey({ ...base, qual: "alevel" }) === boundaryKey(base), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
