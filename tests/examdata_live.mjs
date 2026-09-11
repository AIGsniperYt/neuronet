// tests/examdata_live.mjs — real-network + real-PDF acceptance suite (LIVE=1).
//
// The offline conformance suite (tests/examdata_spec.mjs) exercises canonical
// ingestion over injected seams. This suite proves the SAME pipeline against
// the live Pearson site and the ACTUAL bytes of the verified catalogue: live
// discovery (landing + archive walk), content-validated fetch of a verified
// PDF, document-series extraction from the real title text, faithful parse of
// the June 2022 table, and the end-to-end acquirePearson decision envelope.
//
//   LIVE=1 node tests/examdata_live.mjs
//
// Skipped (exit 0) unless LIVE=1. Requires network + the vendored pdf.js.

import {
  VERIFIED_CATALOGUE,
  discover,
  fetchSource,
  parseSource,
  extractDocumentSeries,
  acquirePearson,
  getForSitting,
  UNKNOWN_REASONS,
  VERIFY,
  isPresentableOfficial,
  provenanceOf
} from "../src/tools/examData/index.js";
import { openExamRepository } from "../src/tools/examData/repository.js";
import { loadSnapshot, clearAllStores, clearSnapshotCache } from "../src/tools/examData/storage.js";

if (process.env.LIVE !== "1") {
  console.log("live suite skipped (set LIVE=1 to run against the real Pearson site)");
  process.exit(0);
}

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// ---- live discovery: landing + genuine archive walk + catalogue -------------
const jun2022Req = { qual: "gcse", series: { month: "JUN", year: 2022 } };
const d = await discover({ request: jun2022Req });
check("live: discover ran", Array.isArray(d.resources) && d.resources.length > 0, `n=${d.resources && d.resources.length}`);
const jun2022 = d.resources.find((r) => r.year === 2022 && r.month === "JUN" && r.qual === "gcse");
check("live: June 2022 discovered (landing/archive/catalogue)", Boolean(jun2022));

// ---- content-validated fetch of the verified June 2022 PDF ------------------
const verified = VERIFIED_CATALOGUE.find((r) => r.month === "JUN" && r.year === 2022);
check("live: verified Jun-2022 in catalogue", Boolean(verified));
const f = await fetchSource(verified);
check("live: verified url fetched", f.ok, `reason=${f.reason} url=${f.url}`);
check("live: host verified on fetched url", f.hostVerified === true && /pearson\.com([:\/]|$)/i.test(f.url));
check("live: exact content hash", f.contentHash === verified.contentHash, `got ${f.contentHash}`);
check("live: %PDF magic accepted candidly", f.ok && f.byteLength > 50000, `len=${f.byteLength}`);

// ---- document-series from the PDF's own text --------------------------------
const p = await parseSource(f.bytes, { qual: "gcse", series: { month: "JUN", year: 2022 } });
check("live: parsed rows exist", p.ok && p.rows.length > 0, `n=${p.rows && p.rows.length}`);
eq("live: doc series extracted from real PDF text", p.docSeries && p.docSeries.month, "JUN");
eq("live: doc series year = 2022", p.docSeries && p.docSeries.year, 2022);
const rowH = p.rows.find((r) => r.code === "1MA1" && r.tier === "H");
check("live: 1MA1 Higher present", Boolean(rowH));
eq("live: 1MA1 H top (9) = 194", rowH && rowH.grades["9"], 194);
eq("live: 1MA1 H U = 0", rowH && rowH.grades["U"], 0);
check("live: rows carry per-row validation", p.rows.every((r) => r._validation && typeof r._validation.ok === "boolean"));

// ---- wrong-year proof against the live doc ----------------------------------
const wrong = await parseSource(f.bytes, { qual: "gcse", series: { month: "NOV", year: 2024 } });
check("live: real PDF rejects a different requested series", wrong.problems.some((x) => x.includes("wrong-year") || x.includes("wrong-series")), JSON.stringify((wrong.problems || []).slice(0, 3)));

// ---- end-to-end acquire over the real bytes ---------------------------------
clearSnapshotCache();
await clearAllStores();
const res = await acquirePearson({ board: "pearson", qual: "gcse", series: { month: "JUN", year: 2022 }, expectedCourse: { code: "1MA1", tier: "H" } });
eq("live: acquire kind official", res.kind, "official");
eq("live: acquire top (1MA1 H 9) = 194", res.top, 194);
check("live: acquired sources carry title+publisher+accessedAt", res.sources.length > 0 && res.sources[0].publisher === "Pearson Edexcel" && res.sources[0].title && res.sources[0].accessedAt);
const snap = await loadSnapshot();
const bH = snap.examBoundaries.find((b) => b.id === "pearson:gcse:1MA1:H|JUN-2022");
check("live: boundary persisted", Boolean(bH));
eq("live: persisted 9=194", bH && bH.grades["9"], 194);
check("live: persisted provenance carries parser version", Boolean(bH && bH.provenance.parserVersion));
check("live: persisted provenance presentable official", Boolean(bH && isPresentableOfficial(bH.provenance)));

// ---- getForSitting over the real snapshot -----------------------------------
const repo = openExamRepository({
  courses: new Map((snap.examCourses || []).map((r) => [r.id, { ...r }])),
  series: new Map((snap.examSeries || []).map((r) => [r.id, { ...r }])),
  boundaries: new Map((snap.examBoundaries || []).map((r) => [r.id, { ...r }]))
});
const envelope = await getForSitting(repo, { code: "1MA1", tier: "H" }, "2022", "June", {});
eq("live: getForSitting 1MA1 H Jun-2022 top", envelope.top, 194);
check("live: getForSitting verdict is official", envelope.kind === "official", `kind=${envelope.kind}`);
check("live: getForSitting reason carries exact-year", /exact-year/.test(envelope.reason), `reason=${envelope.reason}`);

check("live: catalogued-but-unacquired series stays unknown (no fabrication)",
  (await getForSitting(repo, { code: "1MA1", tier: "H" }, "2023", "June", {})).kind !== "official");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);