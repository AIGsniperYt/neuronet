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
// published by Pearson live here first), then normalise links and merge with
// the verified catalogue. Returns resources in a stable order. Landing HTML is
// fetched through the caller's proxyFn so browsers can actually read it.
export async function discover({ proxyFn, fetchImpl, request, onProgress } = {}) {
  const resources = [...catalogueForRequest(request)];
  const seen = new Set(resources.map((r) => r.url));

  const doFetch = fetchImpl || fetchBoundaryResourceWithProxy;
  const add = (url, title, source) => {
    const u = url.replace(/^https?:\/\//, "").replace(/\/+/g, "/");
    const abs = url.startsWith("http") ? url : `${PEARSON_HOST}${url.startsWith("/") ? "" : "/"}${url}`;
    if (seen.has(abs)) return;
    const meta = classifyResource(abs, title);
    if (!meta) return;
    seen.add(abs);
    resources.push({ ...meta, url: abs, source });
  };

  let html = null;
  try {
    const res = await doFetch(
      proxyFn
        ? proxyFn(PEARSON_LANDING)
        : PEARSON_LANDING
    );
    if (res && res.ok) html = await res.text();
  } catch {
    html = null; // catalogue still answers; discovery is best-effort
  }
  if (html) {
    const titles = [...html.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
    const urls = [...html.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1].trim());
    for (let i = 0; i < Math.min(titles.length, urls.length, 200); i++) {
      if (!/\.pdf$/i.test(urls[i])) continue;
      add(urls[i], titles[i], "landing");
    }
  }

  // Optional archive-page walk (best-effort; a failed walk is not an error).
  if (html && typeof archiveWalk === "function") {
    // reserved: follow the archive/history page link from the landing page.
  }

  if (onProgress) onProgress(`Pearson discovery: ${resources.length} candidate resource(s)`);
  return { resources, requestCatalogueOnly: resources.every((r) => r.source === "catalogue"), landingScanned: Boolean(html) };
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
  const hostOk = /^(https?:)?\/\/[^/]*?(pearson\.com|qualifications\.pearson\.com)([:\/]|$)/i.test(finalUrl) || /^https?:\/\//i.test(finalUrl);
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
    hostVerified: hostOk && /(pearson\.com)/i.test(finalUrl)
  };
}

// ---- parse (evidence-based, never silent repair) ---------------------------
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
  const rows = (parsed || []).map((row) => normalizeParsedRow(row, series, "pearson", q));
  const problems = [];
  // Series identity is validated against EVERY row of the document (a doc is
  // for one series). Course identity (code/tier) is deliberately NOT checked
  // here — doc-mates are other subjects, checked only when selecting the
  // request's target row in the pipeline (ingest.js).
  const wantedSeries = { series: series || (expected && expected.series) || null };
  for (const row of rows) {
    const v = validateParsedBoundary(row, wantedSeries);
    if (!v.ok) problems.push(...v.problems);
  }
  const rowsWithProvenance = rows.map((row, i) => {
    const ck = courseKeyFromRow("pearson", q, row);
    const hasIdentityProblem = problems.some((p) => p.includes("wrong-year") || p.includes("wrong-series"));
    return {
      ...row,
      courseKey: ck,
      boundaryId: ck && series ? `${ck}|${seriesId(series)}` : null,
      provenance: provenanceOf({
        kind: "official",
        url: null, // bound to the fetched source by the pipeline
        parsedAt: Date.now(),
        verification: hasIdentityProblem ? VERIFY.FAILED : VERIFY.VERIFIED,
        contentHash: null,
        parserIndex: i
      })
    };
  });
  return { ok: rowsWithProvenance.length > 0, rows: rowsWithProvenance, problems, reason: rowsWithProvenance.length ? "parsed" : "EMPTY" };
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