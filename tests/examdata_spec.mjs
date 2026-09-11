// tests/examdata_spec.mjs — execution-spec §79 (5)-(8) offline conformance.
//
// This suite exercises the canonical ExamData ingestion modules WITHOUT any
// network or PDF.js dependency (pdf.js text extraction is browser-reliable;
// real-network + real-PDF acceptance lives in tests/examdata_live.mjs gated by
// LIVE=1). Coverage:
//   (1) the verified official Pearson catalogue is internally consistent and
//       exact-match discoverable;
//   (2) discovery classifies series identity from the TITLE, never a filename;
//   (3) content validation (magic bytes / content-type) is authoritative —
//       a HTTP-200 HTML page named *.pdf is rejected (2406-lesson);
//   (4) parse truly reads the official numbers from a faithful aligned layout;
//   (5) validation.how strong: wrong-year / wrong-series / tier / code / label /
//       monotonicity / maxmark guards;
//   (6) acquirePearson end-to-end over injected seams: persist (+doc-mates),
//       conflict-gate (never auto-pick), wrongyear/wrongdocument/tier/course
//       structured unknowns, and nothing persisted on failure;
//   (7) getForSitting gates conflicting/failed provenance into unknown.
import {
  VERIFIED_CATALOGUE,
  catalogueForRequest,
  discover,
  isPdfBuffer,
  fetchSource,
  validateParsedBoundary,
  normalizeParsedRow,
  provenanceOf,
  VERIFY,
  verificationLabel,
  isPresentableOfficial,
  provenanceLabel,
  qualGradeScale,
  qualGradeScope,
  isDoubleAwardGrades,
  seriesId,
  paperRecordId,
  sourceRecordId,
  courseKeyFromRow,
  UNKNOWN_REASONS,
  acquirePearson,
  getForSitting
} from "../src/tools/examData/index.js";
import { buildExamIndex } from "../src/tools/examData/migrate.js";
import { openExamRepository } from "../src/tools/examData/repository.js";
import { loadSnapshot, saveSnapshot, clearAllStores, clearSnapshotCache } from "../src/tools/examData/storage.js";
import { parsePearsonBoundaries } from "../src/tools/examData/sources/PearsonSectionParser.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// ---- (1) verified catalogue integrity -------------------------------------
check("catalogue: non-empty", VERIFIED_CATALOGUE.length >= 6, `len=${VERIFIED_CATALOGUE.length}`);
for (const r of VERIFIED_CATALOGUE) {
  check(`catalogue ${r.month}-${r.year} url on pearson`, r.url.startsWith("https://qualifications.pearson.com/"), r.url);
  check(`catalogue ${r.month}-${r.year} has sha256`, /^[0-9a-f]{64}$/.test(r.contentHash), r.contentHash);
  check(`catalogue ${r.month}-${r.year} qual+gcs series set`, r.qual === "gcse" && !!r.month && Number.isFinite(Number(r.year)));
}
eq("catalogue: exact-match JUN 2022 gcse", catalogueForRequest({ qual: "gcse", series: { month: "JUN", year: 2022 } }).map((r) => r.year), [2022]);
eq("catalogue: no alevel match", catalogueForRequest({ qual: "alevel", series: { month: "JUN", year: 2022 } }), []);
eq("catalogue: no NOV 2022 match", catalogueForRequest({ qual: "gcse", series: { month: "NOV", year: 2022 } }), []);

// ---- (2) discovery: identity from the TITLE --------------------------------
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fake");
const LANDING = "https://qualifications.pearson.com/en/support/support-topics/results-certification/grade-boundaries.html";
const C2022 = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf";
const C2024 = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2024-gcse.pdf";

// Landing HTML carrying two live links: June 2022 GCSE (normal filename) and a
// JUNE-2022-GCSE file whose NAME would imply the wrong month (title wins), plus
// an International GCSE (never binds to home-qual).
const landingHtml = `
<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries June 2022</span>
<span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf</span>
<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries December 2024</span>
<span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/DECEMBER-mislabelled-november-2024.pdf</span>
<span class="hiddenAssetTitle">International GCSE (9-1) grade boundaries June 2023</span>
<span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/iGCSE-june-2023.pdf</span>
`;
const fakeRes = (url, { status = 200, contentType = "application/pdf", body } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
  text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)),
  arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body).buffer : body.buffer)
});
const fetchFrom = (map) => async (url) => {
  const hit = map[url];
  if (!hit) return fakeRes(url, { status: 404, contentType: "text/html", body: "nope" });
  return fakeRes(url, hit);
};

const found = await discover({
  request: { qual: "gcse", series: { month: "JUN", year: 2022 } },
  skipLanding: false,
  proxyFn: null,
  fetchImpl: fetchFrom({ [LANDING]: { contentType: "text/html", body: landingHtml } })
});
const foundJun2022 = found.resources.find((r) => r.year === 2022 && r.month === "JUN" && r.qual === "gcse");
check("discover: June 2022 resolvable (landing or catalogue)", Boolean(foundJun2022));
const dec2024 = found.resources.find((r) => r.year === 2024 && r.month === "DEC");
check("discover: mislabelled filename loses to title", Boolean(dec2024), JSON.stringify(found.resources.map((r) => `${r.month}-${r.year}:${r.qual}`)));
check("discover: international gcse filtered", !found.resources.some((r) => /iGCSE/i.test(r.title)));
check("discover: catalogue fallback when landing unreachable", (await discover({ request: { qual: "gcse", series: { month: "JUN", year: 2022 } }, fetchImpl: async () => fakeRes(LANDING, { status: 503, contentType: "text/html", body: "down" }) })).resources.some((r) => r.url === C2022));

// ---- (3) content validation is authoritative -------------------------------
check("magic: %PDF- accepted", isPdfBuffer(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])));
check("magic: short buffer rejected", !isPdfBuffer(new Uint8Array([0x25, 0x50])));
check("magic: html rejected", !isPdfBuffer(new TextEncoder().encode("<html>not a pdf</html>").buffer));

const badHtml = await fetchSource({ url: C2024 }, { fetchImpl: fetchFrom({ [C2024]: { contentType: "text/html", body: "<html>error page</html>" } }) });
eq("fetch: html with pdf name -> CONTENT_TYPE", badHtml.reason, "CONTENT_TYPE");
check("fetch: 200 alone not enough", badHtml.ok === false && badHtml.status === 200);
const octetHtml = await fetchSource({ url: C2024 }, { fetchImpl: fetchFrom({ [C2024]: { contentType: "application/octet-stream", body: "<html>error page</html>" } }) });
eq("fetch: octet-stream html -> NOT_PDF", octetHtml.reason, "NOT_PDF");
const good = await fetchSource({ url: C2024 }, { fetchImpl: fetchFrom({ [C2024]: { contentType: "application/pdf", body: PDF_BYTES } }) });
check("fetch: real pdf accepted", good.ok && /^[0-9a-f]{64}$/.test(good.contentHash));
check("fetch: host verified", good.hostVerified === true);

// ---- (4) parse faithful to the official 2022 table -------------------------
// Reproduce the aligned layout items pdf.js yields for the verified 2206 doc
// (grade-label columns at x=400..580; row numerics aligned to those x).
const columnPairs = [["9", 400], ["8", 420], ["7", 440], ["6", 460], ["5", 480], ["4", 500], ["3", 520], ["2", 540], ["1", 560], ["U", 580]];
// The official 2206 file prints "Overall grade boundaries ... Max Mark 9 8 ... U"
// on ONE aligned line (pdf.js emits it as a single line of positioned items).
const sectionHeaderLine = { items: [{ str: "Overall", x: 20 }, { str: "grade", x: 90 }, { str: "boundaries", x: 160 }, { str: "Max Mark", x: 300 }, ...columnPairs.map(([label, x]) => ({ str: label === "U" ? "u" : label, x }))] };
const higherLine = {
  items: [
    { str: "1MA1", x: 10 }, { str: "Mathematics", x: 60 }, { str: "(Higher)", x: 210 }, { str: "Subject", x: 300 }, { str: "240", x: 310 },
    [194, 400], [165, 420], [137, 440], [104, 460], [71, 480], [38, 500], [21, 520], [0, 580]
  ].map((v) => (Array.isArray(v) ? { str: String(v[0]), x: v[1] } : v))
};
const foundationLine = {
  items: [
    { str: "1MA1", x: 10 }, { str: "Mathematics", x: 60 }, { str: "(Foundation)", x: 210 }, { str: "Subject", x: 300 }, { str: "240", x: 310 },
    [173, 480], [135, 500], [100, 520], [66, 540], [32, 560], [0, 580]
  ].map((v) => (Array.isArray(v) ? { str: String(v[0]), x: v[1] } : v))
};
const parsed22 = parsePearsonBoundaries([sectionHeaderLine, higherLine, foundationLine], "gcse");
const rowH = parsed22.find((r) => r.code === "1MA1" && r.tier === "H");
const rowF = parsed22.find((r) => r.code === "1MA1" && r.tier === "F");
check("parse: 1MA1 Higher present", Boolean(rowH));
eq("parse: 1MA1 H top = 194", rowH && rowH.grades["9"], 194);
eq("parse: 1MA1 H U = 0", rowH && rowH.grades["U"], 0);
eq("parse: 1MA1 H grade order", rowH && rowH.gradesInOrder, ["9", "8", "7", "6", "5", "4", "3", "U"]);
eq("parse: 1MA1 F top = 173 at 5", rowF && rowF.grades["5"], 173);
check("parse: 1MA1 F does not invent 9..6", rowF && rowF.grades["9"] === undefined);

// ---- (5) validation guards -------------------------------------------------
const normH = normalizeParsedRow(
  { code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240, grades: { 9: 194, 8: 165, 7: 137, 6: 104, 5: 71, 4: 38, 3: 21, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"] },
  { month: "JUN", year: 2022, label: "June 2022" }, "pearson", "gcse"
);
const wantSeries = { series: { month: "JUN", year: 2022, label: "June 2022" } };
check("validate: official 2022 Higher ok", validateParsedBoundary(normH, wantSeries).ok);
check("validate: wrong-year guard", validateParsedBoundary(normH, { series: { month: "JUN", year: 2023 } }).problems.some((p) => p.includes("wrong-year")));
check("validate: wrong-series guard", validateParsedBoundary(normH, { series: { month: "NOV", year: 2022 } }).problems.some((p) => p.includes("wrong-series")));
check("validate: tier mismatch guard", validateParsedBoundary(normH, { series: { month: "JUN", year: 2022 }, code: "1MA1", tier: "F" }).problems.some((p) => p.includes("tier:")));
check("validate: code mismatch guard", validateParsedBoundary(normH, { series: { month: "JUN", year: 2022 }, code: "1MA2" }).problems.some((p) => p.includes("course:")));
const badLabel = normalizeParsedRow({ code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240, grades: { A: 194, B: 165 }, gradesInOrder: ["A", "B"] }, { month: "JUN", year: 2022 }, "pearson", "gcse");
check("validate: illegal gcse label guard", validateParsedBoundary(badLabel, wantSeries).problems.some((p) => p.includes("label")));
const flat = normalizeParsedRow({ code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240, grades: { 9: 194, 8: 194 }, gradesInOrder: ["9", "8"] }, { month: "JUN", year: 2022 }, "pearson", "gcse");
check("validate: monotonicity guard", validateParsedBoundary(flat, wantSeries).problems.some((p) => p.includes("strictly descending")));
const frac = { ...normH, maxMark: 240.5 };
check("validate: non-integer maxmark guard", validateParsedBoundary(frac, wantSeries).problems.some((p) => p.includes("maxmark")));
eq("scale: gcse", qualGradeScale("gcse"), ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"]);
eq("scope: gcse", qualGradeScope("gcse"), "9-1");
check("double-award: paired labels recognised", isDoubleAwardGrades({ "9-9": 276, "8-8": 254 }));

// ---- provenance defaults ---------------------------------------------------
eq("prov: official + url -> verified", provenanceOf({ kind: "official", url: C2024 }).verification, VERIFY.VERIFIED);
eq("prov: official no url -> uncertain (never silent verified)", provenanceOf({ kind: "official" }).verification, VERIFY.UNCERTAIN);
eq("prov: explicit conflicting preserved", provenanceOf({ kind: "official", url: C2024, verification: VERIFY.CONFLICTING }).verification, VERIFY.CONFLICTING);
check("prov: presentable official verified", isPresentableOfficial(provenanceOf({ kind: "official", url: C2024 })));
check("prov: uncertain still presentable (official-family)", isPresentableOfficial(provenanceOf({ kind: "official" })));
check("prov: conflicting NOT presentable", !isPresentableOfficial(provenanceOf({ kind: "official", url: C2024, verification: VERIFY.CONFLICTING })));
check("prov: failed NOT presentable", !isPresentableOfficial(provenanceOf({ kind: "official", url: C2024, verification: VERIFY.FAILED })));
eq("prov: label official", provenanceLabel(provenanceOf({ kind: "official", url: C2024 })), "Official");
eq("prov: label manual", provenanceLabel(provenanceOf({ kind: "manual" })), "Stored (manual)");

// ---- deterministic ids -----------------------------------------------------
eq("id: seriesId JUN-2022", seriesId({ month: "JUN", year: 2022 }), "JUN-2022");
eq("id: paperRecordId stable", paperRecordId("pearson:gcse:1MA1:H", "JUN-2022", { paper: "1H", title: "Paper 1" }), paperRecordId("pearson:gcse:1MA1:H", "JUN-2022", { paper: "1H", title: "Paper 1" }));
eq("id: sourceRecordId stable", sourceRecordId(C2022), sourceRecordId(C2022));
check("id: sourceRecordId distinct per url", sourceRecordId(C2022) !== sourceRecordId(C2024));

// ---- (6) acquirePearson end-to-end (injected seams, offline) ---------------
const resetStores = async () => { clearSnapshotCache(); await clearAllStores(); };
await resetStores();

// Parse-injection mirrors PearsonSource.parseSource exactly (same shaping),
// minus the PDF extraction step.
const makeParse = (rowSets) => async (bytes, { qual, series } = {}) => {
  let rows;
  if (Array.isArray(rowSets)) rows = rowSets;
  else {
    const len = bytes.byteLength;
    rows = len <= 120 ? rowSets.small : rowSets.large;
  }
  const rowsN = rows.map((r) => normalizeParsedRow(r, series, "pearson", qual));
  const problems = [];
  for (const r of rowsN) {
    const v = validateParsedBoundary(r, { series });
    if (!v.ok) problems.push(...v.problems);
  }
  const final = rowsN.map((r, i) => ({
    ...r,
    courseKey: courseKeyFromRow("pearson", qual, r),
    boundaryId: r.courseKey && series ? `${r.courseKey}|${seriesId(series)}` : null,
    provenance: provenanceOf({
      kind: "official", parsedAt: Date.now(),
      verification: problems.some((p) => p.includes("wrong-year") || p.includes("wrong-series")) ? VERIFY.FAILED : VERIFY.VERIFIED
    })
  }));
  return { ok: final.length > 0, rows: final, problems, reason: final.length ? "parsed" : "EMPTY" };
};

const higher22 = { code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240, grades: { 9: 194, 8: 165, 7: 137, 6: 104, 5: 71, 4: 38, 3: 21, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"] };
const foundation22 = { code: "1MA1", title: "Mathematics (Foundation)", tier: "F", maxMark: 240, grades: { 5: 173, 4: 135, 3: 100, 2: 66, 1: 32, U: 0 }, gradesInOrder: ["5", "4", "3", "2", "1", "U"] };
const docRows22 = [foundation22, higher22];
const series2022 = { month: "JUN", year: 2022, label: "June 2022" };
const req22 = { board: "pearson", qual: "gcse", series: series2022, expectedCourse: { code: "1MA1", tier: "H" } };

// happy path: catalogue supplies the exact source; doc-mates persist alongside
const happy = await acquirePearson(req22, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeParse(docRows22)
});
eq("acquire: happy kind", happy.kind, "official");
eq("acquire: happy top (1MA1 H 9)", happy.top, 194);
eq("acquire: happy verification", happy.verification, VERIFY.VERIFIED);
check("acquire: happy source url recorded", happy.sources[0].url === C2022);
let snap = await loadSnapshot();
const bidH = "pearson:gcse:1MA1:H|JUN-2022";
const bidF = "pearson:gcse:1MA1:F|JUN-2022";
const bH = snap.examBoundaries.find((b) => b.id === bidH);
const bF = snap.examBoundaries.find((b) => b.id === bidF);
check("persist: 1MA1 H boundary stored", Boolean(bH));
check("persist: doc-mate Foundation stored too", Boolean(bF));
eq("persist: H 9=194", bH && bH.grades["9"], 194);
check("persist: H provenance verified+url", bH && bH.provenance.kind === "official" && bH.provenance.verification === VERIFY.VERIFIED && bH.provenance.url === C2022);
check("persist: source record stored", snap.examSources.some((s) => s.url === C2022 && /^[0-9a-f]{64}$/.test(s.contentHash)));
check("persist: series record stored", snap.examSeries.some((s) => s.id === "JUN-2022" && s.qual === "gcse" && s.board === "pearson"));
check("persist: course record stored", snap.examCourses.some((c) => c.id === "pearson:gcse:1MA1:H"));

// wrong-document: HTTP 200 HTML named .pdf -> structured WRONG_DOCUMENT, no persist
await resetStores();
const wrongDoc = await acquirePearson(req22, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "text/html", body: "<html>2406-style error page</html>" } }),
  parse: makeParse(docRows22)
});
eq("acquire: html-as-pdf -> WRONG_DOCUMENT", wrongDoc.reason, UNKNOWN_REASONS.WRONG_DOCUMENT);
snap = await loadSnapshot();
check("acquire: nothing persisted on WRONG_DOCUMENT", !snap.examBoundaries.some((b) => b.id === bidH));

// wrong-year: the parsed document is 2023 -> structured WRONG_YEAR, no persist
const wrongYearParse = async (bytes, { qual } = {}) => {
  const rowsN = [higher22].map((r) => normalizeParsedRow(r, { month: "JUN", year: 2023, label: "June 2023" }, "pearson", qual));
  const problems = [];
  for (const r of rowsN) {
    const v = validateParsedBoundary(r, { series: series2022 });
    if (!v.ok) problems.push(...v.problems);
  }
  const final = rowsN.map((r, i) => ({
    ...r,
    courseKey: courseKeyFromRow("pearson", qual, r),
    boundaryId: `${r.courseKey}|JUN-2023`,
    provenance: provenanceOf({ kind: "official", parsedAt: Date.now(), verification: VERIFY.FAILED })
  }));
  return { ok: true, rows: final, problems, reason: "parsed" };
};
await resetStores();
const wrongYear = await acquirePearson({ ...req22, qual: "gcse", series: series2022 }, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: wrongYearParse
});
eq("acquire: year mismatch -> WRONG_YEAR", wrongYear.reason, UNKNOWN_REASONS.WRONG_YEAR);
snap = await loadSnapshot();
check("acquire: nothing persisted on WRONG_YEAR", !snap.examBoundaries.some((b) => b.id === bidH));

// conflicting sources: landing adds a second official June-2022 doc that
// disagrees -> CONFLICTING_SOURCES, never auto-picked, nothing persisted
await resetStores();
const C2022B = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-2nd-source-grade-boundaries.pdf";
const conflictHtml = `<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries June 2022</span>
<span class="hiddenAssetUrl">${C2022B}</span>`;
const bytesA = new Uint8Array(120).fill(7); bytesA[0] = 0x25; bytesA[1] = 0x50; bytesA[2] = 0x44; bytesA[3] = 0x46; bytesA[4] = 0x2d;
const bytesB = new Uint8Array(360).fill(9); bytesB[0] = 0x25; bytesB[1] = 0x50; bytesB[2] = 0x44; bytesB[3] = 0x46; bytesB[4] = 0x2d;
const conflict = await acquirePearson(req22, {
  fetchImpl: fetchFrom({
    [LANDING]: { contentType: "text/html", body: conflictHtml },
    [C2022]: { contentType: "application/pdf", body: bytesA },
    [C2022B]: { contentType: "application/pdf", body: bytesB }
  }),
  parse: makeParse({ small: docRows22, large: [{ ...higher22, grades: { 9: 195, 8: 165, 7: 137, 6: 104, 5: 71, 4: 38, 3: 21, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"] }] })
});
eq("acquire: disagreeing official sources -> CONFLICTING_SOURCES", conflict.reason, UNKNOWN_REASONS.CONFLICTING_SOURCES);
snap = await loadSnapshot();
check("acquire: nothing persisted on CONFLICTING_SOURCES", !snap.examBoundaries.some((b) => b.id === bidH));

// tier mismatch: request Foundation but doc only Higher -> structured TIER_MISMATCH
await resetStores();
const tierMiss = await acquirePearson({ ...req22, expectedCourse: { code: "1MA1", tier: "F" } }, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeParse([higher22])
});
eq("acquire: wrong tier requested -> TIER_MISMATCH", tierMiss.reason, UNKNOWN_REASONS.TIER_MISMATCH);

// course unresolved: request a course not in the document -> COURSE_UNRESOLVED
await resetStores();
const noCourse = await acquirePearson({ ...req22, expectedCourse: { code: "2F01", tier: "H" } }, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeParse([higher22])
});
eq("acquire: course absent from doc -> COURSE_UNRESOLVED", noCourse.reason, UNKNOWN_REASONS.COURSE_UNRESOLVED);

// no exact official resource for a requested series -> NO_EXACT_SOURCE
await resetStores();
const noSource = await acquirePearson({ board: "pearson", qual: "alevel", series: { month: "JUN", year: 2022 }, expectedCourse: { code: "9MA0", tier: null } }, {
  fetchImpl: fetchFrom({}),
  parse: makeParse([])
});
eq("acquire: nothing discovered -> NO_EXACT_SOURCE", noSource.reason, UNKNOWN_REASONS.NO_EXACT_SOURCE);

// ---- (7) getForSitting gates conflicting/failed provenance ----------------
const cache2025 = {
  entries: {
    "pearson:JUN-2025:gcse": {
      fetchedAt: Date.now(), qual: "gcse",
      subjects: [{ code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240, grades: { 9: 217, 8: 186, 7: 156, 6: 121, 5: 87, 4: 53, 3: 36, U: 0 }, gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"], papers: [] }]
    }
  }
};
const indexOk = buildExamIndex(cache2025);
const repoOk = openExamRepository(indexOk);
const dOk = await getForSitting(repoOk, { code: "1MA1", tier: "H" }, "2025", "June", {});
eq("getForSitting: verified official renders", dOk.kind, "official");
eq("getForSitting: 2025 top = 217", dOk.top, 217);

const indexConflict = buildExamIndex(cache2025);
indexConflict.boundaries.get("pearson:gcse:1MA1:H|JUN-2025").provenance = provenanceOf({ kind: "official", url: C2022, verification: VERIFY.CONFLICTING, parsedAt: Date.now() });
const dConflict = await getForSitting(openExamRepository(indexConflict), { code: "1MA1", tier: "H" }, "2025", "June", {});
eq("getForSitting: conflicting provenance -> unknown", dConflict.kind, "unknown");
eq("getForSitting: conflicting reason", dConflict.reason, UNKNOWN_REASONS.CONFLICTING_SOURCES);

const indexFailed = buildExamIndex(cache2025);
indexFailed.boundaries.get("pearson:gcse:1MA1:H|JUN-2025").provenance = provenanceOf({ kind: "official", url: C2022, verification: VERIFY.FAILED, parsedAt: Date.now() });
const dFailed = await getForSitting(openExamRepository(indexFailed), { code: "1MA1", tier: "H" }, "2025", "June", {});
eq("getForSitting: failed provenance -> unknown", dFailed.kind, "unknown");
eq("getForSitting: failed reason", dFailed.reason, UNKNOWN_REASONS.WRONG_DOCUMENT);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);