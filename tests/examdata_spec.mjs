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
  getForSitting,
  extractDocumentSeries,
  PEARSON_ARCHIVE,
  PEARSON_ARCHIVE_INDEX,
  PEARSON_HOST_RE,
  DISCOVERY_INCOMPLETE,
  UNKNOWN_METADATA,
  documentIdentityOf,
  compareDocumentIdentity,
  resolveCourseIdentity
} from "../src/tools/examData/index.js";
import { resolveUrl, extractLinks, verifyOfficialHost, classifyCandidate, rankCandidates, crawlOfficialIndex } from "../src/tools/examData/sources/officialEngine.js";
import { buildExamIndex } from "../src/tools/examData/migrate.js";
import { openExamRepository, deriveBoundaryDecision } from "../src/tools/examData/repository.js";
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

// ---- (2b) archive walk: genuine history traversal ---------------------------
// The archive index links a January 2020 GCSE page; the walker must follow the
// sub-page and harvest it (this is the crawl the frontier review demanded, not
// a reserved placeholder).
const ARCH_JAN2020 = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/jan-2020-gcse-grade-boundaries.pdf";
const ARCH_SUB = "https://qualifications.pearson.com/en/support/support-topics/results-certification/grade-boundaries-january-2020.html";
const archiveHtml = `
<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries June 2019</span>
<span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1906-gcse-grade-boundaries.pdf</span>
<a href="${ARCH_SUB}">January 2020 grade boundaries</a>
<a href="https://www.evil-pearson.example/not-official.pdf">off-host resource</a>
`;
const archiveSubHtml = `
<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries January 2020</span>
<span class="hiddenAssetUrl">${ARCH_JAN2020}</span>
`;
const archiveWalked = await discover({
  request: { qual: "gcse", series: { month: "JAN", year: 2020 } },
  proxyFn: null,
  fetchImpl: fetchFrom({
    [LANDING]: { contentType: "text/html", body: "" },
    [PEARSON_ARCHIVE]: { contentType: "text/html", body: archiveHtml },
    [ARCH_SUB]: { contentType: "text/html", body: archiveSubHtml }
  })
});
check("archive: followed sub-page harvests JAN-2020", archiveWalked.resources.some((r) => r.url === ARCH_JAN2020 && r.month === "JAN" && r.year === 2020));
check("archive: same-page June 2019 harvested from index", archiveWalked.resources.some((r) => r.year === 2019));
check("archive: off-host link rejected", !archiveWalked.resources.some((r) => /evil-pearson/.test(r.url)));

// ---- (2c) Phase 2A: reusable official-source engine primitives ---------------
eq("engine: resolveUrl absolute kept", resolveUrl("https://q.pearson.com/a.pdf", LANDING), "https://q.pearson.com/a.pdf");
eq("engine: resolveUrl relative against base", resolveUrl("/content/dam/x.pdf", LANDING), "https://qualifications.pearson.com/content/dam/x.pdf");
eq("engine: resolveUrl protocol-relative", resolveUrl("//qualifications.pearson.com/x.pdf", LANDING), "https://qualifications.pearson.com/x.pdf");
check("engine: resolveUrl strips hash", resolveUrl("https://q.pearson.com/x.pdf#frag", LANDING) === "https://q.pearson.com/x.pdf");
check("engine: resolveUrl rejects non-http link", resolveUrl("mailto:a@b.c") === null);
check("engine: verifyOfficialHost accepts official host", verifyOfficialHost("https://qualifications.pearson.com/x", PEARSON_HOST_RE));
check("engine: verifyOfficialHost anchors host (no lookalike)", !verifyOfficialHost("https://pearson.com.evil.example/x", PEARSON_HOST_RE));
const engineLinks = extractLinks(`
  <a href="/maths-june-2022.pdf">GCSE (9-1) Mathematics June 2022</a>
  <span class="hiddenAssetTitle">GCSE (9-1) grade boundaries January 2020</span>
  <span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/jan-2020.pdf</span>
  <a href="https://evil.example/official.pdf">off host</a>
`, { base: LANDING, hostRe: PEARSON_HOST_RE });
check("engine: extractLinks anchors + hiddenAsset pairs, off-host filtered", engineLinks.length === 2, JSON.stringify(engineLinks));
check("engine: extractLinks resolves + filters off-host", engineLinks.every((l) => l.url.startsWith("https://qualifications.pearson.com/")));
eq("engine: classifyCandidate reads series from title", classifyCandidate("x.pdf", "GCSE (9-1) grade boundaries June 2022"), { month: "JUN", year: 2022, qual: "gcse", documentType: "grade-boundaries", international: false });
check("engine: classifyCandidate undated title -> null (kept as UNKNOWN_METADATA)", classifyCandidate("x.pdf", "GCSE (9-1) grade boundaries") === null);
check("engine: classifyCandidate notional flagged", classifyCandidate("x.pdf", "Notional Component GCSE (9-1) grade boundaries June 2021").documentType === "notional-component");
check("engine: classifyCandidate international flagged", classifyCandidate("x.pdf", "International GCSE (9-1) grade boundaries June 2023").international === true);
const engineRanked = rankCandidates([
  { url: "a.pdf", month: "DEC", year: 2024, qual: "gcse" },
  { url: "b.pdf", month: "JUN", year: 2022, qual: "gcse" },
  { url: "c.pdf", month: null, year: null, qual: null, unknownMetadata: true }
], { qual: "gcse", series: { month: "JUN", year: 2022 } });
check("engine: rankCandidates orders best first and sinks unknown", engineRanked[0].url === "b.pdf" && engineRanked[2].url === "c.pdf", JSON.stringify(engineRanked.map((r) => r.url)));
const incompleteCrawl = await crawlOfficialIndex({
  doFetch: fetchFrom({ [PEARSON_ARCHIVE]: { contentType: "text/html", body: archiveHtml }, [ARCH_SUB]: { contentType: "text/html", body: archiveSubHtml } }),
  startUrls: [PEARSON_ARCHIVE],
  hostRe: PEARSON_HOST_RE,
  isRelevantPage: () => true,
  maxPages: 1
});
check("engine: crawl safety cap -> incomplete (DISCOVERY_INCOMPLETE not NO_EXACT_SOURCE)", incompleteCrawl.incomplete === true && incompleteCrawl.capped === "pages");

// ---- (2d) Phase 2A: JSON archive index is the official archive graph ---------
// The live landing widget loads /content/dam/grade-boundaries.json (722 records,
// 2009-2026). Discovery must treat it as the history graph and prove resolution
// with the catalogue EXCLUDED (includeCatalogue:false).
const INDEX_JSON = JSON.stringify({
  searchResults: {
    algoliaRecords: [
      { title: "Grade Boundaries - June 2022 - GCSE (9-1)", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf", category: "Pearson-UK:Qualification-Family/GCSE" },
      { title: "Grade Boundaries - November 2020 - GCSE (9-1)", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-november-2020-gcse-9-1.pdf" },
      { title: "Grade Boundaries - June 2019 - Edexcel GCSE (9-1)", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1906-gcse-9-1-subject-grade-boundaries.pdf" },
      { title: "Notional Component Grade Boundaries - June 2022 - GCSE (9-1)", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-notional-component-grade-boundaries.pdf" },
      { title: "International GCSE (9-1) grade boundaries June 2023", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/iGCSE-june-2023.pdf" },
      { title: "GCSE (9-1) grade boundaries", url: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/undated-grade-boundaries.pdf" }
    ]
  }
});
const fromIndex = await discover({
  request: { qual: "gcse", series: { month: "JUN", year: 2022 } },
  includeCatalogue: false,
  fetchImpl: fetchFrom({ [PEARSON_ARCHIVE_INDEX]: { contentType: "application/json", body: INDEX_JSON } })
});
const fromIndexJun22 = fromIndex.resources.find((r) => r.year === 2022 && r.month === "JUN" && r.qual === "gcse");
check("archive: JSON index yields Jun-2022 gcse", Boolean(fromIndexJun22));
check("archive: Jun-2022 source is archive (traversal, not catalogue)", fromIndexJun22 && fromIndexJun22.source === "archive");
check("archive: JSON index scanned flag", fromIndex.archiveScanned === true);
check("archive: historical Nov-2020 from index", Boolean(fromIndex.resources.find((r) => r.year === 2020 && r.month === "NOV")));
check("archive: notional components excluded from resources", !fromIndex.resources.some((r) => /notional/i.test(r.title)));
check("archive: international excluded from resources", !fromIndex.resources.some((r) => /international|iglobal/i.test(r.title)));
check("archive: undated candidate kept as metaKnown:false", fromIndex.resources.some((r) => r.metaKnown === false && r.unknownMetadata === true));
check("archive: undated candidate counted as UNKNOWN_METADATA", fromIndex.metadataUnknown === 1);
check("archive: includeCatalogue:false leaks no catalogue entries", !fromIndex.resources.some((r) => r.source === "catalogue") && fromIndex.requestCatalogueOnly === false);
const withCat = await discover({
  request: { qual: "gcse", series: { month: "JUN", year: 2022 } },
  fetchImpl: fetchFrom({})
});
check("archive: includeCatalogue:true (default) still resolves from verified catalogue", Boolean(withCat.resources.find((r) => r.year === 2022 && r.month === "JUN")));
const noTraversal = await discover({ request: { qual: "gcse", series: { month: "JUN", year: 2022 } }, includeCatalogue: false, fetchImpl: fetchFrom({}) });
check("archive: includeCatalogue:false with no traversal finds nothing", noTraversal.resources.length === 0);

// ---- (2e) Phase 2A: candidate≠evidence yield the new unknown reasons ---------
// No fetch/parse is ever reached in this block (no matching resource), so the
// parse seam is an unreachable stub.
const neverParse = async () => ({ ok: false, rows: [], problems: [] });
const undatedHtml = `<span class="hiddenAssetTitle">GCSE (9-1) grade boundaries</span><span class="hiddenAssetUrl">https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/undated-grade-boundaries.pdf</span>`;
const undisclosed = await acquirePearson({ board: "pearson", qual: "gcse", series: { month: "JUN", year: 2023 }, expectedCourse: { code: "1MA1", tier: "H" } }, {
  includeCatalogue: false,
  fetchImpl: fetchFrom({ [LANDING]: { contentType: "text/html", body: undatedHtml } }),
  parse: neverParse
});
eq("acquire: candidates without series identity -> UNKNOWN_METADATA", undisclosed.reason, UNKNOWN_REASONS.UNKNOWN_METADATA);
clearSnapshotCache();
await clearAllStores();
const limited = await acquirePearson({ board: "pearson", qual: "gcse", series: { month: "JUN", year: 2022 }, expectedCourse: { code: "1MA1", tier: "H" } }, {
  includeCatalogue: false,
  maxPages: 1,
  fetchImpl: fetchFrom({
    [LANDING]: { contentType: "text/html", body: "" },
    [PEARSON_ARCHIVE]: { contentType: "text/html", body: archiveHtml },
    [ARCH_SUB]: { contentType: "text/html", body: archiveSubHtml },
    [PEARSON_ARCHIVE_INDEX]: { contentType: "application/json", body: INDEX_JSON }
  }),
  parse: neverParse
});
eq("acquire: safety-limited crawl -> DISCOVERY_INCOMPLETE", limited.reason, UNKNOWN_REASONS.DISCOVERY_INCOMPLETE);
eq("acquire: DISCOVERY_INCOMPLETE also in REASONS surface", UNKNOWN_REASONS.DISCOVERY_INCOMPLETE, DISCOVERY_INCOMPLETE);
eq("acquire: UNKNOWN_METADATA also in REASONS surface", UNKNOWN_REASONS.UNKNOWN_METADATA, UNKNOWN_METADATA);

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

// redirect to a non-pearson host -> hard HOST_UNVERIFIED, not silently trusted
const evilRedirect = await fetchSource({ url: C2024 }, {
  fetchImpl: async () => fakeRes("https://evil.example.com/grade-boundaries.pdf", {
    contentType: "application/pdf",
    body: PDF_BYTES
  })
});
eq("fetch: redirect to off-host pdf -> HOST_UNVERIFIED", evilRedirect.reason, "HOST_UNVERIFIED");
check("fetch: off-host not accepted even with pdf magic", evilRedirect.ok === false);

// lookalike/host-spoofing host -> HOST_UNVERIFIED (no https wildcard escape)
const spoof = await fetchSource({ url: C2024 }, {
  fetchImpl: async () => fakeRes("https://pearson.com.evil.example/x.pdf", {
    contentType: "application/pdf",
    body: PDF_BYTES
  })
});
eq("fetch: lookalike host rejected", spoof.reason, "HOST_UNVERIFIED");

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

// ---- (5b) document-series identity is extracted from the DOCUMENT -----------
// The wrong-year/wrong-series guard must rest on the document's own series,
// never on the series the request claims (frontier review, must-fix #2).
const docLines = [
  { page: 1, items: [{ x: 10, str: "GCSE" }, { x: 40, str: "(9-1)" }, { x: 80, str: "Grade" }, { x: 130, str: "Boundaries" }] },
  { page: 1, items: [{ x: 10, str: "June" }, { x: 60, str: "2022" }] },
  { page: 2, items: [{ x: 10, str: "1MA1" }, { x: 60, str: "Mathematics" }, { x: 210, str: "(Higher)" }] }
];
eq("docseries: extracted from document title text", extractDocumentSeries(docLines), { month: "JUN", year: 2022, label: "June 2022" });
const noSeriesLines = [{ page: 1, items: [{ x: 10, str: "Some" }, { x: 60, str: "Cover" }] }];
eq("docseries: absent -> null (no request fallback)", extractDocumentSeries(noSeriesLines), null);
const laterSeries = [...docLines.slice(0, 1), { page: 1, items: [{ x: 10, str: "November" }, { x: 60, str: "2024" }] }];
eq("docseries: later line on same page wins over earlier non-series", extractDocumentSeries(laterSeries), { month: "NOV", year: 2024, label: "November 2024" });
eq("scale: gcse", qualGradeScale("gcse"), ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"]);
eq("scope: gcse", qualGradeScope("gcse"), "9-1");
check("double-award: paired labels recognised", isDoubleAwardGrades({ "9-9": 276, "8-8": 254 }));

// ---- provenance defaults ---------------------------------------------------
eq("prov: official + url -> verified", provenanceOf({ kind: "official", url: C2024 }).verification, VERIFY.VERIFIED);
eq("prov: official no url -> uncertain (never silent verified)", provenanceOf({ kind: "official" }).verification, VERIFY.UNCERTAIN);
eq("prov: explicit conflicting preserved", provenanceOf({ kind: "official", url: C2024, verification: VERIFY.CONFLICTING }).verification, VERIFY.CONFLICTING);
check("prov: presentable official verified", isPresentableOfficial(provenanceOf({ kind: "official", url: C2024 })));
check("prov: uncertain is NOT presentable as official", !isPresentableOfficial(provenanceOf({ kind: "official" })));
check("prov: uncertain-with-url also NOT presentable", !isPresentableOfficial(provenanceOf({ kind: "official", url: C2024, verification: VERIFY.UNCERTAIN })));
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

// Parse-injection mirrors PearsonSource.parseSource exactly (same shaping,
// same per-row _validation from validateParsedBoundary), minus PDF extraction.
const makeParse = (rowSets) => async (bytes, { qual, series } = {}) => {
  let rows;
  if (Array.isArray(rowSets)) rows = rowSets;
  else {
    const len = bytes.byteLength;
    rows = len <= 120 ? rowSets.small : rowSets.large;
  }
  // The injected parse stamps the DOCUMENT's own series (mirroring the real
  // parser, which reads series from the PDF text — never from the request).
  const rowsN = rows.map((r) => normalizeParsedRow(r, series, "pearson", qual));
  const validated = rowsN.map((r) => ({ row: r, v: validateParsedBoundary(r, { series }) }));
  const problems = validated.flatMap(({ v }) => (v.ok ? [] : v.problems));
  const final = validated.map(({ row: r, v }, i) => ({
    ...r,
    _validation: v,
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
  const validated = rowsN.map((r) => ({ row: r, v: validateParsedBoundary(r, { series: series2022 }) }));
  const problems = validated.flatMap(({ v }) => (v.ok ? [] : v.problems));
  const final = validated.map(({ row: r, v }, i) => ({
    ...r,
    _validation: v,
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

// ambiguous identity: document has BOTH tiers of 1MA1 and the request gives no
// tier hint — no deterministic first-row preference (frontier review, #3)
await resetStores();
const ambiguous = await acquirePearson({ ...req22, expectedCourse: { code: "1MA1", tier: null } }, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeParse(docRows22)
});
eq("acquire: ambiguous candidates (no tier hint) -> AMBIGUOUS", ambiguous.reason, UNKNOWN_REASONS.AMBIGUOUS);
snap = await loadSnapshot();
check("acquire: nothing persisted on AMBIGUOUS", !snap.examBoundaries.some((b) => b.id === bidH));

// ambiguous identity: tier hint matches BOTH returned candidates
await resetStores();
const ambiguousBoth = await acquirePearson(req22, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeParse([{ ...higher22, code: "1MA1" }, { ...higher22, code: "1MA1", title: "Mathematics (Higher) (12MA1)" }])
});
eq("acquire: two rows claim same code+tier -> AMBIGUOUS", ambiguousBoth.reason, UNKNOWN_REASONS.AMBIGUOUS);

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

// ---- (8) Phase 2B: DocumentIdentity (what the FILE is, not what was asked) --
const DOC_GCSE = [
  { items: [{ str: "GCSE (9-1) Grade Boundaries" }] },
  { items: [{ str: "June 2022" }] },
  { items: [{ str: "Pearson Edexcel" }] }
];
const ident = documentIdentityOf({ board: "pearson", lines: DOC_GCSE, rows: [higher22] });
eq("identity: document declares gcse", ident.qualification, "gcse");
eq("identity: document declares grade-boundaries type", ident.documentType, "grade-boundaries");
eq("identity: document declares publisher", ident.publisher, "Pearson Edexcel");
eq("identity: single-course scope", ident.scope, "single-course");
eq("identity: courses from doc rows", ident.courses, [{ code: "1MA1", tier: "H", maxMark: 240 }]);

const identOk = compareDocumentIdentity(documentIdentityOf({ board: "pearson", lines: DOC_GCSE, rows: [higher22], series: { month: "JUN", year: 2022 } }), { qual: "gcse", series: { month: "JUN", year: 2022 } });
eq("identity: request matches document", identOk.ok, true);
const identWrong = compareDocumentIdentity(documentIdentityOf({ board: "pearson", lines: DOC_GCSE, rows: [higher22], series: { month: "JUN", year: 2022 } }), { qual: "alevel", series: { month: "NOV", year: 2019 } });
check("identity: wrong-qual problem surfaced", identWrong.problems.some((p) => p.startsWith("qualification:")));
check("identity: wrong-year problem surfaced", identWrong.problems.some((p) => p.includes("wrong-year guard")));

const identNotional = documentIdentityOf({ board: "pearson", lines: [{ items: [{ str: "GCSE (9-1) Notional Component Grade Boundaries June 2022" }] }], rows: [higher22] });
eq("identity: notional document type", identNotional.documentType, "notional-component");
eq("identity: notional scope is component", identNotional.scope, "component");
const identComp = compareDocumentIdentity(identNotional, { qual: "gcse", series: { month: "JUN", year: 2022 } });
check("identity: component problem surfaced", identComp.problems.includes("component: document is a component-level boundary table"));

// validation carries document-level identity evidence (frontier #6/#7)
const vQ = validateParsedBoundary(normalizeParsedRow(higher22, { month: "JUN", year: 2022 }, "pearson", "gcse"), { qual: "gcse", series: { month: "JUN", year: 2022 }, documentQualification: "alevel" });
check("validation: document qual mismatch flagged", vQ.problems.some((p) => p.startsWith("qualification:")));
const vT = validateParsedBoundary(normalizeParsedRow(higher22, { month: "JUN", year: 2022 }, "pearson", "gcse"), { qual: "gcse", series: { month: "JUN", year: 2022 }, documentType: "notional-component" });
check("validation: component table flagged", vT.problems.includes("component: document is a component-level boundary table"));

// acquire: a fetched doc that DECLARES the wrong qualification -> deterministic
// WRONG_QUALIFICATION (nothing persisted); a notional component doc -> COMPONENT_BOUNDARY.
const makeDocLevelParse = (prefix) => async (bytes, { qual, series } = {}) => {
  const rowsN = [higher22].map((r) => normalizeParsedRow(r, series, "pearson", qual));
  const problems = [`${prefix}: injected document identity failure`];
  const final = rowsN.map((r) => ({
    ...r,
    _validation: { ok: false, problems },
    courseKey: courseKeyFromRow("pearson", qual, r),
    boundaryId: null,
    provenance: provenanceOf({ kind: "official", parsedAt: Date.now(), verification: VERIFY.FAILED })
  }));
  return { ok: true, rows: final, problems, reason: "parsed" };
};
await resetStores();
const wrongQual = await acquirePearson(req22, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeDocLevelParse("qualification: document declares ALEVEL != requested GCSE")
});
eq("acquire: doc declares other qual -> WRONG_QUALIFICATION", wrongQual.reason, UNKNOWN_REASONS.WRONG_QUALIFICATION);
snap = await loadSnapshot();
check("acquire: nothing persisted on WRONG_QUALIFICATION", !snap.examBoundaries.some((b) => b.id === bidH));

await resetStores();
const componentDoc = await acquirePearson(req22, {
  fetchImpl: fetchFrom({ [C2022]: { contentType: "application/pdf", body: PDF_BYTES } }),
  parse: makeDocLevelParse("component: document is a component-level boundary table")
});
eq("acquire: notional component doc -> COMPONENT_BOUNDARY", componentDoc.reason, UNKNOWN_REASONS.COMPONENT_BOUNDARY);
eq("acquire: COMPONENT_BOUNDARY in REASONS surface", UNKNOWN_REASONS.COMPONENT_BOUNDARY, "COMPONENT_BOUNDARY");
eq("acquire: WRONG_QUALIFICATION in REASONS surface", UNKNOWN_REASONS.WRONG_QUALIFICATION, "WRONG_QUALIFICATION");

// ---- (9) Phase 2B: resolveCourseIdentity (evidence scoring, never "best") ---
const courseH = { id: "pearson:gcse:1MA1:H", board: "pearson", qual: "gcse", code: "1MA1", tier: "H" };
const courseF = { id: "pearson:gcse:1MA1:F", board: "pearson", qual: "gcse", code: "1MA1", tier: "F" };
const resExact = resolveCourseIdentity({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, [courseH]);
eq("resolve: exact code+tier -> resolved", resExact.state, "resolved");
eq("resolve: resolved course", resExact.course && resExact.course.id, "pearson:gcse:1MA1:H");
eq("resolve: no tier hint -> ambiguous", resolveCourseIdentity({ board: "pearson", qual: "gcse", code: "1MA1" }, [courseH, courseF]).state, "ambiguous");
eq("resolve: tier pins the H course -> resolved", resolveCourseIdentity({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }, [courseH, courseF]).state, "resolved");
eq("resolve: no code/title evidence -> unresolved", resolveCourseIdentity({ board: "pearson", qual: "gcse", code: "1MA1" }, [{ id: "pearson:gcse:2F01:H", board: "pearson", qual: "gcse", code: "2F01", tier: "H" }]).state, "unresolved");
eq("resolve: title tie pinned by tier -> resolved", resolveCourseIdentity({ board: "pearson", qual: "gcse", title: "Mathematics (Higher)", tier: "H" }, [
  { ...courseH, title: "Mathematics (Higher)" },
  { ...courseF, title: "Mathematics (Higher)" }
]).state, "resolved");

// repository courseFor delegates to the resolver: ambiguity is surfaced as
// null (decision -> unknown), never silently-picked (frontier #9/#10).
const rawRepo = openExamRepository({
  courses: new Map([
    ["pearson:gcse:1MA1:H", courseH],
    ["pearson:gcse:1MA1:F", courseF]
  ]),
  boundaries: new Map()
});
eq("repo: courseFor exact key resolves", rawRepo.courseFor({ board: "pearson", qual: "gcse", code: "1MA1", tier: "H" }).id, "pearson:gcse:1MA1:H");
eq("repo: courseFor ambiguous -> null", rawRepo.courseFor({ board: "pearson", qual: "gcse", code: "1MA1" }), null);
const dAmb = deriveBoundaryDecision(rawRepo, { board: "pearson", qual: "gcse", code: "1MA1" }, "2022", "June", {});
eq("repo: ambiguous course -> unknown decision", dAmb.kind, "unknown");
eq("repo: unresolved course -> unknown decision", deriveBoundaryDecision(rawRepo, { board: "pearson", qual: "gcse", code: "9MA0" }, "2022", "June", {}).kind, "unknown");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);