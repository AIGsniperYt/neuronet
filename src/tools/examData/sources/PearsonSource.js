// examData/sources/PearsonSource.js — the Pearson/Edexcel acquisition adapter.
//
// Implements the execution-spec discovery contract for Pearson History:
//
//   DISCOVER → FETCH → PARSE → NORMALIZE → VALIDATE → PERSIST
//   (the pipeline lives in ../ingest.js; this module owns the source-specific
//   discovery, content validation and parsing).
//
// Discovery runs on the reusable official-source ENGINE (officialEngine.js) and
// NEVER guesses filenames. Candidate discovery is mechanically separate from
// classification (frontier Phase 2A #1/#2):
//   1. every official link is first a CANDIDATE — evidence that is never
//      dropped because a title is unhelpful;
//   2. classification reads cheap series metadata from the TITLE (never a
//      filename), and a candidate whose title carries no series identity is
//      surfaced as metaKnown:false → the pipeline reports UNKNOWN_METADATA
//      instead of pretending the archive is empty;
//   3. the official archive graph is walked for real: the landing page, the
//      grade-boundaries archive HTML pages, and the /content/dam/
//      grade-boundaries.json index that powers the live "find all grade
//      boundaries" widget (722 records, 2009–2026). Safety limits exist to
//      protect the browser, but hitting one reports DISCOVERY_INCOMPLETE,
//      never NO_EXACT_SOURCE;
//   4. a curated VERIFIED_CATALOGUE joins discovery as the known-source cache
//      (includeCatalogue:true default) — every URL in it was downloaded,
//      confirmed a real %PDF, and its sha-256 recorded. Discovery tests prove
//      themselves with includeCatalogue:false: a series must resolve from the
//      traversal, not from the catalogue.
//
// The request (`{ qual, series, board, expectedCourse }`) propagates unchanged
// through the pipeline; the adapter never silently repairs it.

import {
  qualId,
  boardId,
  monthFromWord,
  seriesLabel,
  seriesId,
  courseKeyFromRow,
  tierOf,
  singleCode,
  normalizeTitle
} from "../schema.js";
import { extractPdfLayoutLinesFromBuffer } from "../../pdfBoundaries.js";
import { provenanceOf, VERIFY } from "../provenance.js";
import { normalizeParsedRow, validateParsedBoundary } from "../validation.js";
import { crawlOfficialIndex, classifyCandidate as engineClassifyCandidate, extractLinks, rankCandidates } from "./officialEngine.js";
import { documentIdentityOf, compareDocumentIdentity } from "../identity.js";

export const PEARSON_HOST = "https://qualifications.pearson.com";
export const PEARSON_LANDING = `${PEARSON_HOST}/en/support/support-topics/results-certification/grade-boundaries.html`;
export const PEARSON_ARCHIVE = `${PEARSON_HOST}/en/support/support-topics/results-certification/grade-boundaries-archive.html`;
// The JSON archive index that powers the live landing page's "Find all grade
// boundaries" widget: 722 records back to 2009, each { title, url, category }.
// The legacy grade-boundaries-archive.html page itself is gone from the live
// site, so this index IS the official history graph.
export const PEARSON_ARCHIVE_INDEX = `${PEARSON_HOST}/content/dam/grade-boundaries.json`;
export const PEARSON_DAM = `${PEARSON_HOST}/content/dam/pdf/Support/Grade-boundaries`;
export const PEARSON_PARSER_VERSION = "1.1";

// Only the official host (pearson.com or a subdomain) may act as a boundary
// source. `evilpearson.com` must NOT pass: the pattern anchors the host.
export const PEARSON_HOST_RE = /^(https?:)?\/\/(?:[a-z0-9-]+\.)*pearson\.com([:\/]|$)/i;

// ---- VERIFIED_CATALOGUE ----------------------------------------------------
// Every entry: URL confirmed HTTP 200 + application/pdf + %PDF magic bytes +
// content sha-256, and the 1MA1 Higher table it carries (verified separately).
// `verifiedAt` is the date of that verification. Nothing here is a guess.
export const VERIFIED_CATALOGUE = Object.freeze([
  {
    month: "JUN", year: 2022, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2022",
    url: `${PEARSON_DAM}/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "acc74f63d54bccf000a2298d33300cfdae50d1989f42a3918cd95c6c7dc1defa",
    note: "1MA1 H 194/165/137/104/71/38/21 U=0 · F 173/135/100/66/32"
  },
  {
    month: "JUN", year: 2023, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2023",
    url: `${PEARSON_DAM}/GCSE/2306-gcse-9-1-subject-grade-boundaries.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "e771cfc307bfa8ac399fe9ff83a1fe4984a255d3624a9ba6e9fb1b5970eb90c4",
    note: "1MA1 H 203/174/145/112/79/47/31 U=0 · F 182/147/109/71/33"
  },
  {
    month: "JUN", year: 2024, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2024",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-june-2024-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "403eff5e8824aab3fae3d22142955fcf9f110cc4aafb907e27115d40e933412a",
    note: "1MA1 H 197/167/137/105/73/42/26 U=0 · F 175/142/103/65/27"
  },
  {
    month: "NOV", year: 2024, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2024",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-november-2024-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "fda6336bedcee5bc51a6604875ac989a5ab65c64084a9859a05818d293bb62f1",
    note: "confirmed real PDF"
  },
  {
    month: "JUN", year: 2025, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries June 2025",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-june-2025-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "68230dc99d8a9f839c2978606c1f38eb35552b3c163c84562a5095cfceebd91c",
    note: "1MA1 H 217/186/156/121/87/53/36 U=0"
  },
  {
    month: "NOV", year: 2025, qual: "gcse", kind: "catalogue",
    title: "GCSE (9-1) grade boundaries November 2025",
    url: `${PEARSON_DAM}/GCSE/grade-boundaries-november-2025-gcse.pdf`,
    verifiedAt: "2026-09-10",
    contentHash: "324174e2cc1489b630ac29785ceea8b811b50a53352e7a7f5927a66531414ea7",
    note: "confirmed real PDF"
  }
]);

export function catalogueForRequest(request) {
  const q = qualId(request && request.qual);
  const wantSeries = request && request.series;
  if (!q || !wantSeries) return [];
  const wantMonth = String(wantSeries.month || "").toUpperCase();
  const wantYear = Number(wantSeries.year);
  return VERIFIED_CATALOGUE.filter((r) =>
    r.qual === q && r.month === wantMonth && Number(r.year) === wantYear
  );
}

// ---- discovery -------------------------------------------------------------
// Candidate discovery is mechanically separate from classification. Every
// official link is first a candidate; classification reads cheap series
// metadata from the TITLE (never a filename); a candidate that carries no
// series identity in its title is never discarded — it is surfaced as
// metaKnown:false so the pipeline can report UNKNOWN_METADATA.

// Harvest the links an official payload carries. The archive index endpoint is
// a JSON record list; the HTML pages are parsed for anchors + hiddenAsset
// pairs. Extraction is generic; relevance filtering happens downstream.
function harvestPearsonLinks(text, url) {
  if (!text) return [];
  const trimmed = String(text).trim();
  if (/^\s*[\[{]/.test(trimmed)) {
    try {
      const j = JSON.parse(trimmed);
      const records = (j && j.searchResults && j.searchResults.algoliaRecords) || (Array.isArray(j) ? j : []);
      return records.filter((r) => r && r.url).map((r) => ({ url: r.url, text: r.title || r.url }));
    } catch {
      return [];
    }
  }
  return extractLinks(text, { base: url, hostRe: PEARSON_HOST_RE });
}

// One crawl of a Pearson history entry point (landing, HTML archive, JSON
// index). Returns CONFIRMED candidates: classified resources (series identity
// known) plus metaKnown:false candidates (title carries no series identity —
// UNKNOWN_METADATA evidence, never discarded). Integers GC/A-level/iGCSE are
// classified, not unknown; Notional Component and International documents are
// out of home-qualification scope and excluded from subject-level resources.
async function crawlSeries({ doFetch, startUrls, source, onProgress, maxPages, maxResources }) {
  const crawl = await crawlOfficialIndex({
    doFetch,
    hostRe: PEARSON_HOST_RE,
    startUrls,
    harvest: harvestPearsonLinks,
    isResourceUrl: (abs) => /\.pdf$/i.test(abs),
    isRelevantPage: (abs) => /grade-boundaries/i.test(abs) && !/\.pdf$/i.test(abs),
    classify: (abs, title) => engineClassifyCandidate(abs, title),
    maxPages,
    maxResources,
    onProgress
  });
  const resources = [];
  let metadataUnknown = 0;
  for (const c of crawl.resources) {
    const meta = c.meta;
    if (meta && meta.month && meta.year) {
      if (meta.international || meta.documentType === "notional-component") continue;
      resources.push({
        month: meta.month,
        year: meta.year,
        qual: meta.qual || null,
        title: c.title,
        url: c.url,
        source,
        metaKnown: true,
        documentType: meta.documentType || "grade-boundaries"
      });
    } else {
      metadataUnknown += 1;
      resources.push({
        month: null, year: null, qual: null,
        title: c.title, url: c.url, source,
        metaKnown: false, unknownMetadata: true
      });
    }
  }
  return { resources, metadataUnknown, incomplete: crawl.incomplete, pages: crawl.visited, capped: crawl.capped };
}

// Genuine archive-graph traversal (frontier must-fix #1). Walks the landing
// page, the grade-boundaries archive HTML pages and the JSON archive index as a
// real crawl; follows every relevant same-host archive link; harvests every
// candidate. Safety limits (maxPages/maxResources) exist to protect the
// browser — hitting one sets `incomplete: true` (DISCOVERY_INCOMPLETE), it is
// NOT the definition of a complete archive. The catalogue is NOT consulted
// here: this is discovery only.
export async function discoverSeries({ skipLanding = false, proxyFn, fetchImpl, onProgress, maxPages, maxResources } = {}) {
  const doFetch = fetchImpl || fetchBoundaryResourceWithProxy;
  const landingStart = skipLanding ? [] : [proxyFn ? proxyFn(PEARSON_LANDING) : PEARSON_LANDING];
  const archiveStart = [
    proxyFn ? proxyFn(PEARSON_ARCHIVE) : PEARSON_ARCHIVE,
    proxyFn ? proxyFn(PEARSON_ARCHIVE_INDEX) : PEARSON_ARCHIVE_INDEX
  ];
  const [landing, archive] = await Promise.all([
    crawlSeries({ doFetch, startUrls: landingStart, source: "landing", onProgress, maxPages, maxResources }),
    crawlSeries({ doFetch, startUrls: archiveStart, source: "archive", onProgress, maxPages, maxResources })
  ]);
  const seen = new Set();
  const resources = [];
  for (const r of [...landing.resources, ...archive.resources]) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    resources.push(r);
  }
  return {
    resources,
    metadataUnknown: landing.metadataUnknown + archive.metadataUnknown,
    incomplete: landing.incomplete || archive.incomplete,
    landingScanned: resources.some((r) => r.source === "landing"),
    archiveScanned: resources.some((r) => r.source === "archive"),
    graph: { pages: [...landing.pages, ...archive.pages], capped: landing.capped || archive.capped }
  };
}

// Full discovery envelope: series traversal + optional curated catalogue merge,
// then evidence-scored ordering (order only — discovery never picks on its
// own). `includeCatalogue:false` proves a series resolves from the traversal;
// with the default true, the verified catalogue answers for known series.
export async function discoverResources({ skipLanding, proxyFn, fetchImpl, request, onProgress, includeCatalogue = true, maxPages, maxResources } = {}) {
  const series = await discoverSeries({ skipLanding, proxyFn, fetchImpl, onProgress, maxPages, maxResources });
  const seen = new Set(series.resources.map((r) => r.url));
  const resources = [...series.resources];
  if (includeCatalogue) {
    for (const r of catalogueForRequest(request)) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      resources.push({ ...r, source: "catalogue" });
    }
  }
  const ranked = rankCandidates(resources, request);
  if (onProgress) onProgress(`Pearson discovery: ${ranked.length} candidate resource(s)`);
  return {
    resources: ranked,
    requestCatalogueOnly: resources.every((r) => r.source === "catalogue"),
    landingScanned: series.landingScanned,
    archiveScanned: series.archiveScanned,
    incomplete: series.incomplete,
    metadataUnknown: series.metadataUnknown,
    graph: series.graph
  };
}

export async function discover(opts = {}) {
  return discoverResources(opts);
}

// ---- content-validated fetch ----------------------------------------------
// HTTP 200 is NOT acceptance: boards return HTML error pages with a 200 and a
// .pdf name (confirmed: 2406-gcse-9-1-subject-grade-boundaries.pdf). We reject
// when the content-type is not a PDF-family and when the %PDF magic bytes are
// missing. A redirect is recorded but the final URL must stay on the official
// host.
export function isPdfBuffer(buf) {
  if (!buf || buf.byteLength < 5) return false;
  const b = new Uint8Array(buf, 0, 5);
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

async function sha256Hex(bytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (subtle && subtle.digest) {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  // deterministic fallback id — not a real sha-256 (explicitly labelled)
  let h = 2166136261;
  for (const byte of new Uint8Array(bytes)) { h ^= byte; h = Math.imul(h, 16777619); }
  return `faux-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

async function fetchBoundaryResourceWithProxy(url) {
  return fetch(url);
}

export async function fetchSource(resource, { fetchImpl } = {}) {
  const doFetch = fetchImpl || fetchBoundaryResourceWithProxy;
  let res;
  try {
    res = await doFetch(resource.url);
  } catch (e) {
    return { ok: false, url: resource.url, reason: "NETWORK", error: String(e && e.message || e) };
  }
  const finalUrl = res.url || resource.url;
  // A redirect may land anywhere; the FINAL url must still be on the official
  // host. Any off-host result is a hard failure — no https-wildcard escape.
  if (!PEARSON_HOST_RE.test(finalUrl)) {
    return { ok: false, url: finalUrl, status: res.status, reason: "HOST_UNVERIFIED" };
  }
  if (!res.ok) return { ok: false, url: finalUrl, status: res.status, reason: `HTTP_${res.status}` };
  const contentType = String(res.headers && res.headers.get && res.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (contentType && !/pdf|octet-stream/.test(contentType)) {
    return { ok: false, url: finalUrl, status: res.status, contentType, reason: "CONTENT_TYPE" };
  }
  if (!isPdfBuffer(bytes)) {
    return { ok: false, url: finalUrl, status: res.status, contentType, byteLength: bytes.byteLength, reason: "NOT_PDF" };
  }
  const contentHash = await sha256Hex(bytes);
  return {
    ok: true, url: finalUrl, status: res.status, contentType,
    bytes, byteLength: bytes.byteLength, contentHash,
    hostVerified: true
  };
}

// ---- parse (evidence-based, never silent repair) ---------------------------
// The document's OWN identity is read from the file, never copied from the
// request (frontier #6/#7):
//   · the pdf text declares qual / documentType / publisher → DocumentIdentity;
//   · the pdf text declares the series (title/header line "…June 2022…");
//   · rows are normalized WITH the document-derived series identity;
// then each row is validated against the REQUEST's series + the DOCUMENT's
// identity — so a wrong-year/wrong-series/other-qualification document fails
// its own identity, independent of whatever the request claimed.
export async function parseSource(bytes, { qual, series, expected } = {}) {
  const q = qualId(qual);
  if (!q) return { ok: false, reason: "QUAL_UNKNOWN", rows: [], problems: [] };
  let lines;
  try {
    lines = await extractPdfLayoutLinesFromBuffer(bytes);
  } catch (e) {
    return { ok: false, reason: "PARSE_FAILED", error: String(e && e.message || e), rows: [], problems: [] };
  }
  const parsed = parsePearsonRows(lines, q);
  const docSeries = extractDocumentSeries(lines);
  const docIdentity = documentIdentityOf({ board: "pearson", lines, rows: parsed || [], series: docSeries });
  const documentLevel = compareDocumentIdentity(docIdentity, { qual: q, series });
  const rows = (parsed || []).map((row) => normalizeParsedRow(row, docSeries, "pearson", q));
  // Series identity is validated against EVERY row of the document (a doc is
  // for one series), against the REQUEST's series; the document's own qual and
  // table type are validated the same way (WRONG_QUALIFICATION /
  // COMPONENT_BOUNDARY evidence). Course identity (code/tier) is deliberately
  // NOT checked here — doc-mates are other subjects, checked only when
  // selecting the request's target row in the pipeline (ingest.js).
  const wanted = {
    series: series || (expected && expected.series) || null,
    documentQualification: docIdentity.qualification,
    documentType: docIdentity.documentType
  };
  const isIdentityProblem = (p) =>
    p.includes("wrong-year") || p.includes("wrong-series")
    || p.startsWith("qualification:") || p.startsWith("component:");
  const rowsWithProvenance = rows.map((row, i) => {
    const validation = validateParsedBoundary(row, wanted);
    const ck = courseKeyFromRow("pearson", q, row);
    const hasIdentityProblem = validation.problems.some(isIdentityProblem);
    return {
      ...row,
      _validation: validation,
      courseKey: ck,
      boundaryId: ck && series ? `${ck}|${seriesId(series)}` : null,
      provenance: provenanceOf({
        kind: "official",
        url: null, // bound to the fetched source by the pipeline
        parsedAt: Date.now(),
        verification: hasIdentityProblem ? VERIFY.FAILED : VERIFY.VERIFIED,
        contentHash: null,
        publisher: "Pearson Edexcel",
        parserVersion: PEARSON_PARSER_VERSION,
        parserIndex: i
      })
    };
  });
  const problems = [];
  for (const row of rowsWithProvenance) {
    if (!row._validation || !row._validation.ok) problems.push(...(row._validation.problems || []));
  }
  const hasIdentityProblem = problems.some(isIdentityProblem);
  return {
    ok: rowsWithProvenance.length > 0,
    rows: hasIdentityProblem ? rowsWithProvenance.map((r) => ({ ...r, provenance: { ...r.provenance, verification: VERIFY.FAILED } })) : rowsWithProvenance,
    problems,
    docSeries: docSeries || null,
    docIdentity: docIdentity || null,
    documentLevel,
    reason: rowsWithProvenance.length ? "parsed" : "EMPTY"
  };
}

// Extract the document's own series identity from the extracted layout text.
// Scans every line (cover title and repeated page headers both carry it) and
// returns the FIRST month+year pair found, or null if the document declares
// no series in its text. Identity never falls back to the request.
export function extractDocumentSeries(lines) {
  const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\.?\s+(\d{4})/i;
  for (const line of lines || []) {
    const text = (line.items || []).map((it) => String(it.str || "")).join(" ");
    const m = text.match(re);
    if (!m) continue;
    const month = monthFromWord(m[1]);
    const year = Number(m[2]);
    if (month && Number.isFinite(year)) return { month, year, label: `${m[1]} ${m[2]}` };
  }
  return null;
}

// Pearson PDF sections -> subject rows. Uses the shared parser and only passes
// rows whose course identity is actually present (guard rows without a code).
function parsePearsonRows(lines, qual) {
  const all = parsePearsonBoundaries(lines, qual);
  return (all || []).filter((r) => {
    const code = singleCode(r && r.code);
    return Boolean(code);
  }).map((r) => ({
    ...r,
    code: singleCode(r.code),
    title: normalizeTitle(r.title || ""),
    tier: tierOf(r) || null
  }));
}

import { parsePearsonBoundaries } from "./PearsonSectionParser.js";