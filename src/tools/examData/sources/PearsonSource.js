// examData/sources/PearsonSource.js — the Pearson/Edexcel acquisition adapter.
//
// Implements the execution-spec discovery contract for Pearson History:
//
//   DISCOVER → FETCH → PARSE → NORMALIZE → VALIDATE → PERSIST
//   (the pipeline lives in ../ingest.js; this module owns the source-specific
//   discovery, content validation and parsing).
//
// Discovery NEVER guesses filenames. It walks BOTH of these, in order:
//   1. the official grade-boundaries landing/archive pages (live resource
//      links; the only source that can mint a NEW series), and
//   2. a curated VERIFIED_CATALOGUE — every URL in it has been downloaded,
//      confirmed to be a real %PDF with the matching content-type, and its
//      sha-256 recorded. New series are discovered, never inferred by naming
//      convention: 2406-gcse-9-1-subject-grade-boundaries.pdf returns HTTP 200
//      but is an HTML error page, which is exactly what content validation
//      rejects.
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

export const PEARSON_HOST = "https://qualifications.pearson.com";
export const PEARSON_LANDING = `${PEARSON_HOST}/en/support/support-topics/results-certification/grade-boundaries.html`;
export const PEARSON_ARCHIVE = `${PEARSON_HOST}/en/support/support-topics/results-certification/grade-boundaries-archive.html`;
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
// Walk the official landing page for live resource links (new/seasonal series
// published by Pearson live here first), then walk the grade-boundaries
// ARCHIVE (genuine history traversal — not a reserved stub), then normalise
// links and merge with the verified catalogue. Returns resources in a stable
// order. Landing/archive HTML is fetched through the caller's proxyFn so
// browsers can actually read it.
export async function discover({ proxyFn, fetchImpl, request, onProgress } = {}) {
  const resources = [...catalogueForRequest(request)];
  const seen = new Set(resources.map((r) => r.url));

  const doFetch = fetchImpl || fetchBoundaryResourceWithProxy;
  const add = (url, title, source) => {
    const abs = url.startsWith("http")
      ? url
      : `${PEARSON_HOST}${url.startsWith("/") ? "" : "/"}${url}`;
    if (!PEARSON_HOST_RE.test(abs)) return false; // only the official host feeds discovery
    if (seen.has(abs)) return false;
    const meta = classifyResource(abs, title);
    if (!meta) return false;
    seen.add(abs);
    resources.push({ ...meta, url: abs, source });
    return true;
  };

  const landingScanned = Boolean(
    await fetchPageResources({
      doFetch,
      proxyFn,
      url: PEARSON_LANDING,
      add,
      source: "landing"
    })
  );

  // Historical series live on the archive index (and its linked year pages);
  // walk it as a crawl, never a reserved placeholder.
  await archiveWalk({ doFetch, proxyFn, add, onProgress });

  if (onProgress) onProgress(`Pearson discovery: ${resources.length} candidate resource(s)`);
  return { resources, requestCatalogueOnly: resources.every((r) => r.source === "catalogue"), landingScanned };
}

// Fetch one page and harvest its (title, url) resource links. Returns the raw
// HTML on success (landing scan detects it), null otherwise. Best-effort: an
// unreachable page is not an error — the catalogue still answers.
async function fetchPageResources({ doFetch, proxyFn, url, add, source }) {
  let html = null;
  try {
    const res = await doFetch(proxyFn ? proxyFn(url) : url);
    if (res && res.ok) html = await res.text();
  } catch {
    html = null; // best-effort discovery
  }
  if (!html) return null;
  const titles = [...html.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
  const urls = [...html.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1].trim());
  for (let i = 0; i < Math.min(titles.length, urls.length, 200); i++) {
    if (!/\.pdf$/i.test(urls[i])) continue;
    add(urls[i], titles[i], source);
  }
  return html;
}

// Genuine traversal of the Pearson grade-boundaries archive. The archive index
// lists per-season resource links (hiddenAsset spans) and further archive
// sub-pages (anchors to other grade-boundaries pages). We crawl a bounded
// frontier of those pages, harvesting every classified resource. Discovery
// stays best-effort end to end: a dead or partial archive never fails the
// request, but when it answers we actually capture its history.
const ARCHIVE_MAX_PAGES = 8;
const ARCHIVE_MAX_RESOURCES = 400;

async function archiveWalk({ doFetch, proxyFn, add, onProgress }) {
  const visited = new Set();
  const queue = [
    proxyFn ? proxyFn(PEARSON_ARCHIVE) : PEARSON_ARCHIVE
  ];
  let harvested = 0;

  while (queue.length && visited.size < ARCHIVE_MAX_PAGES && harvested < ARCHIVE_MAX_RESOURCES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    let html = null;
    try {
      const res = await doFetch(url);
      if (res && res.ok) html = await res.text();
    } catch {
      html = null;
    }
    if (!html) continue;

    // 1) harvest resource links exactly like the landing page does
    const titles = [...html.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
    const urls = [...html.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1].trim());
    const before = harvested;
    for (let i = 0; i < Math.min(titles.length, urls.length, 200); i++) {
      if (!/\.pdf$/i.test(urls[i])) continue;
      if (harvested >= ARCHIVE_MAX_RESOURCES) break;
      if (add(urls[i], titles[i], "archive")) harvested += 1;
    }
    // 2) anchors: some archive pages use plain <a> lists for older series
    if (harvested < ARCHIVE_MAX_RESOURCES) {
      const anchors = [...html.matchAll(/href="([^"]+\.pdf)"[^>]*>\s*([^<]*)</gi)];
      for (const [, href, text] of anchors) {
        if (harvested >= ARCHIVE_MAX_RESOURCES) break;
        if (add(href, (text || "").trim() || href, "archive")) harvested += 1;
      }
    }
    // 3) follow links to further archive sub-pages on the same official host
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (visited.size >= ARCHIVE_MAX_PAGES) break;
      let abs = href.startsWith("http") ? href : `${PEARSON_HOST}${href.startsWith("/") ? "" : "/"}${href}`;
      abs = abs.split("#")[0];
      if (!/\.pdf$/i.test(abs)) {
        const norm = abs.replace(/\/+$/, "");
        if (/grade-boundaries/i.test(norm) && /pearson\.com([:\/]|$)/i.test(norm) && !visited.has(norm) && !queue.includes(norm)) {
          queue.push(norm);
        }
      }
    }
    if (harvested > before && onProgress) onProgress(`Pearson archive walk: ${harvested} resource(s) harvested`);
  }
}

// Classify a discovered URL+title into { month, year, qual, title } or null.
// Series identity comes from the TITLE (jan 2022, november 2024, ...), never
// from the filename. Qualification from title words (GCSE (9-1) / GCE / AS).
function classifyResource(url, title) {
  const t = String(title || "");
  let year = null;
  let month = null;
  const mSeries = t.match(/(January|February|March|April|May|June|July|August|September|October|November|December)[a-z]*? (\d{4})/i);
  if (mSeries) {
    month = monthFromWord(mSeries[1]);
    year = Number(mSeries[2]);
  } else {
    return null; // no series identity in the title -> cannot safely bind
  }
  let qual = null;
  const norm = t.toLowerCase();
  if (/gcse/.test(norm) && !/international|grade-boundaries-archive/i.test(norm)) qual = "gcse";
  else if (/a-level|gce\b|as\s+and/.test(norm) && !/international/i.test(norm)) qual = "alevel";
  else if (/^as\b/.test(norm)) qual = "as";
  if (!qual) return null;
  const aLevel = qual === "alevel";
  return { month, year, qual, title: t, baseUrl: aLevel ? `${PEARSON_DAM}/A-level` : `${PEARSON_DAM}/GCSE` };
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
// The document's OWN series identity is read from the PDF's extracted text
// (e.g. a title/header line "…June 2022…"); it is NEVER copied from the
// request. Rows carry that document-derived series, then each row is validated
// against the REQUEST's series — so a wrong-year/wrong-series document fails
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
  const rows = (parsed || []).map((row) => normalizeParsedRow(row, docSeries, "pearson", q));
  // Series identity is validated against EVERY row of the document (a doc is
  // for one series), against the REQUEST's series. Course identity (code/tier)
  // is deliberately NOT checked here — doc-mates are other subjects, checked
  // only when selecting the request's target row in the pipeline (ingest.js).
  const wantedSeries = { series: series || (expected && expected.series) || null };
  const rowsWithProvenance = rows.map((row, i) => {
    const validation = validateParsedBoundary(row, wantedSeries);
    const ck = courseKeyFromRow("pearson", q, row);
    const hasIdentityProblem = validation.problems.some((p) => p.includes("wrong-year") || p.includes("wrong-series"));
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
  const hasIdentityProblem = problems.some((p) => p.includes("wrong-year") || p.includes("wrong-series"));
  return {
    ok: rowsWithProvenance.length > 0,
    rows: hasIdentityProblem ? rowsWithProvenance.map((r) => ({ ...r, provenance: { ...r.provenance, verification: VERIFY.FAILED } })) : rowsWithProvenance,
    problems,
    docSeries: docSeries || null,
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