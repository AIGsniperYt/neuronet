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

// ---- Phase 2B: DocumentIdentity from the real file --------------------------
// The identity is what the PDF itself declares (text), never what was asked.
check("live: docIdentity qualification gcse", p.docIdentity && p.docIdentity.qualification === "gcse", JSON.stringify(p.docIdentity));
check("live: docIdentity type grade-boundaries", p.docIdentity && p.docIdentity.documentType === "grade-boundaries");
check("live: docIdentity publisher Pearson Edexcel", p.docIdentity && p.docIdentity.publisher === "Pearson Edexcel");
eq("live: docIdentity series from text", p.docIdentity && p.docIdentity.series && p.docIdentity.series.month, "JUN");
eq("live: docIdentity series year", p.docIdentity && p.docIdentity.series && p.docIdentity.series.year, 2022);
eq("live: documentLevel ok for exact request", p.documentLevel && p.documentLevel.ok, true);
check("live: docIdentity courses include 1MA1 H", (p.docIdentity.courses || []).some((c) => c.code === "1MA1" && c.tier === "H" && c.maxMark === 240));

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

// ---- Phase 2A: discovery proven from the traversal, catalogue EXCLUDED -------
// includeCatalogue:false must resolve Jun-2022 from the official archive graph
// (the /content/dam/grade-boundaries.json index), never from the cache.
const noCat = await discover({ request: jun2022Req, includeCatalogue: false });
check("live: includeCatalogue:false finds Jun-2022 via archive traversal", noCat.resources.some((r) => r.year === 2022 && r.month === "JUN" && r.qual === "gcse" && r.source === "archive"));
check("live: includeCatalogue:false returns no catalogue entries", !noCat.resources.some((r) => r.source === "catalogue"));
check("live: archive index scanned during traversal", noCat.archiveScanned === true);
check("live: traversal complete (no safety cap)", noCat.incomplete === false, `incomplete=${noCat.incomplete} capped=${noCat.graph && noCat.graph.capped}`);

// ---- Phase 2A: out-of-catalogue historical year (Nov 2019, archive-only) -----
// June 2020/2021 GCSE exams were cancelled (COVID), and November 2019 is not in
// VERIFIED_CATALOGUE — the archive index is its ONLY official source. This is
// the "arbitrary historical years" proof, from traversal to a persisted table.
const nov2019Req = { qual: "gcse", series: { month: "NOV", year: 2019 } };
clearSnapshotCache();
await clearAllStores();
const a2019 = await acquirePearson({ board: "pearson", qual: "gcse", series: nov2019Req.series, expectedCourse: { code: "1MA1", tier: "H" } }, { includeCatalogue: false });
eq("live: out-of-catalogue Nov-2019 acquired from archive", a2019.kind, "official");
eq("live: Nov-2019 1MA1 H top = 197", a2019.top, 197);
check("live: Nov-2019 source title recorded from traversal", a2019.sources.length > 0 && /Grade Boundaries/.test(a2019.sources[0].title || ""), JSON.stringify(a2019.sources.map((s) => s.url)));
const snap2019 = await loadSnapshot();
check("live: Nov-2019 boundary persisted", snap2019.examBoundaries.some((b) => b.id === "pearson:gcse:1MA1:H|NOV-2019"));

// ---- Phase 2A: recent year not in the curated catalogue (June 2026) ----------
const jun2026Req = { qual: "gcse", series: { month: "JUN", year: 2026 } };
const d2026 = await discover({ request: jun2026Req, includeCatalogue: false });
const jun2026 = d2026.resources.find((r) => r.year === 2026 && r.month === "JUN" && r.qual === "gcse");
check("live: out-of-catalogue Jun-2026 discovered", Boolean(jun2026));
if (jun2026) {
  const f26 = await fetchSource(jun2026);
  check("live: Jun-2026 source fetched", f26.ok, `reason=${f26.reason}`);
  const p26 = await parseSource(f26.bytes, { qual: "gcse", series: jun2026Req.series });
  const h26 = p26.rows && p26.rows.find((r) => r.code === "1MA1" && r.tier === "H");
  check("live: Jun-2026 1MA1 H present+valid", Boolean(h26) && h26._validation.ok && h26.maxMark === 240);
  eq("live: Jun-2026 1MA1 H top = 208", h26 && h26.grades["9"], 208);
}

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