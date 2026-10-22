// boundaries.js — the one scraper. Given (board, qual, code, tier, year, series)
// return the EXACT official boundary table, or null. Never fabricates.
//
// Boundaries are immutable: once published they never change. So a fetched
// table is cached permanently and never re-validated. The only thing that
// changes over time is discovery (new specs / new series), which is the
// subject-finder's job, not this file's.
//
// Zero-fabrication contract:
//   - every returned table came from an official board publication
//   - a request that cannot be satisfied exactly returns null
//   - no cross-year, cross-series, cross-tier or cross-board fallback exists
//     anywhere in this file, by construction

import { diag } from "./diag.js";

const CACHE_KEY = "neuronet:boundaries";
// Bump whenever boundary identity/parser semantics change. Old cached tables
// must not be allowed to masquerade as newly verified values.
// Version 4 drops tables written by the earlier mock-backed ExamEngine path.
// A reusable cache row must now include a successfully fetched official PDF URL.
const CACHE_VERSION = 4;

const FETCH_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

export function boardId(board) {
  const s = String(board || "").toLowerCase();
  if (s.includes("aqa")) return "aqa";
  if (s.includes("pearson") || s.includes("edexcel")) return "pearson";
  if (s.includes("ocr")) return "ocr";
  return null;
}

export function qualId(qual) {
  const s = String(qual || "").toLowerCase().trim();
  if (!s) return null;
  // Order matters and the patterns are anchored: "as" must not be matched as a
  // substring, or "was"/"has"/"class" would all read as an AS qualification.
  if (/^(a[\s-]?level|alevel|a levels?)$/.test(s)) return "alevel";
  if (/^(as|as level|a levels?)$/.test(s)) return "as";
  if (/^(gcse|general certificate of secondary education)$/.test(s)) return "gcse";
  // Fall back to a contains-check only for longer descriptive strings.
  if (s.includes("a level") || s.includes("a-level")) return "alevel";
  if (s.includes("gcse")) return "gcse";
  return null;
}

export function tierId(tier) {
  const s = String(tier || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "h" || s === "higher") return "H";
  if (s === "f" || s === "foundation") return "F";
  return null;
}

// AQA publishes the tier inside the specification code ("8461H"); callers and
// persisted records may pass either that or the bare code plus a tier field.
// Both conventions must address the exact same official table, so normalize
// here, at the one boundary identity.
function splitCodeTier(code, tier) {
  const raw = String(code || "").trim().toUpperCase();
  const suffixed = /^([0-9A-Z]{3,6})([HF])$/.exec(raw);
  return {
    code: suffixed ? suffixed[1] : raw,
    tier: tierId(tier) || (suffixed ? suffixed[2] : null)
  };
}

export function monthId(series) {
  const raw = series && typeof series === "object" ? series.month : series;
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const map = {
    jan: "JAN", january: "JAN",
    feb: "FEB", march: "MAR", mar: "MAR",
    apr: "APR", may: "MAY", jun: "JUN", june: "JUN",
    jul: "JUL", aug: "AUG", sep: "SEP", sept: "SEP", september: "SEP",
    oct: "OCT", nov: "NOV", november: "NOV", dec: "DEC"
  };
  return map[s] || null;
}

// A composite identity. Two requests share a key only if they ask for the
// exact same official table. This is what makes cross-year borrowing
// structurally impossible rather than merely discouraged.
export function boundaryKey({ board, qual, code, tier, year, series }) {
  const b = boardId(board);
  const q = qualId(qual);
  const m = monthId(series);
  const { code: c, tier: t } = splitCodeTier(code, tier);
  let y = null;
  if (year != null) y = Number(year);
  else if (series && typeof series === "object" && series.year != null) y = Number(series.year);
  if (!b || !q || !c || !m || !Number.isInteger(y)) return null;
  return `${b}|${q}|${c}|${t || "_"}|${m}|${y}`;
}

// ---------------------------------------------------------------------------
// storage (guards so this module is importable in Node for tests)
// ---------------------------------------------------------------------------

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readCache() {
  const s = storage();
  if (!s) return { version: CACHE_VERSION, tables: {} };
  try {
    const raw = s.getItem(CACHE_KEY);
    if (!raw) return { version: CACHE_VERSION, tables: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.tables) {
      return { version: CACHE_VERSION, tables: {} };
    }
    return parsed;
  } catch {
    return { version: CACHE_VERSION, tables: {} };
  }
}

function writeCache(cache) {
  const s = storage();
  if (!s) return;
  try { s.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota / private mode */ }
}

export function cachedBoundary(key) {
  if (!key) return null;
  const cache = readCache();
  return cache.tables[key] || null;
}

function storeBoundary(key, table) {
  const cache = readCache();
  cache.tables[key] = table;
  writeCache(cache);
}

// ---------------------------------------------------------------------------
// pdf text extraction
// ---------------------------------------------------------------------------

// Reconstruct layout lines: cluster text items by baseline y, sort each line by
// x. Without this every row collapses into one enormous line and per-row
// parsing is impossible.
function buildLayoutLines(pageResults) {
  const items = [];
  for (const { page, content } of pageResults) {
    for (const it of content.items || []) {
      const str = (it.str || "").trim();
      if (!str) continue;
      items.push({ page, x: it.transform[4], y: it.transform[5], str });
    }
  }
  items.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const lines = [];
  const TOL = 2.5;
  let current = null;
  for (const it of items) {
    if (current && Math.abs(current.y - it.y) <= TOL && current.page === it.page) {
      current.items.push(it);
    } else {
      if (current) lines.push(current);
      current = { page: it.page, y: it.y, items: [it] };
    }
  }
  if (current) lines.push(current);

  return lines.map((l) => l.items.map((i) => i.str).join(" "));
}

async function pdfTextFromBytes(bytes) {
  const pdfjs = await import("../vendor/pdfjs/index.js");
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL("../vendor/pdfjs/pdf.legacy.worker.min.mjs", import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push({ page: n, content });
    if (typeof page.cleanup === "function") page.cleanup();
  }
  if (typeof doc.destroy === "function") await doc.destroy();
  return buildLayoutLines(pages);
}

// ---------------------------------------------------------------------------
// board sources
// ---------------------------------------------------------------------------

// Pearson Edexcel publishes one PDF per series containing every GCSE subject
// (Maths and English are split into their own PDF for November). Filenames
// changed over the years, so every series below is pinned to a document that
// was fetched live and whose cover was parsed. A year with no entry is not
// guessed: it was either cancelled (June 2020/2021) or is not on this list yet.
const PEARSON_GCSE_9_1 = {
  JUN: {
    2026: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2026-gcse.pdf",
    2025: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2025-gcse.pdf",
    2024: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2024-gcse.pdf",
    2023: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2306-gcse-9-1-subject-grade-boundaries.pdf",
    2022: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf",
    2019: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1906-gcse-9-1-subject-grade-boundaries.pdf",
    2018: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1806-GCSE-9-1-Subject-Grade-Boundaries.pdf",
    2017: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1706-gcse-9-1-grade-boundaries-v1.pdf"
  },
  NOV: {
    2025: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-november-2025-gcse.pdf",
    2024: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-november-2024-gcse.pdf",
    2023: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2311-gcse-9-1-subject-grade-boundaries.pdf",
    2022: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2211-gcse-9-1-subject-grade-boundaries-v1.pdf",
    2021: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2111_GCSE_9-1_Maths_and_Eng_Subject_Grade_Boundaries.pdf",
    2020: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-nov-2020-gcse-9-1-maths-eng.pdf",
    2019: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1911-gcse-9-1-subject-grade-boundaries.pdf",
    2018: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1811-GCSE-9-1-Subject-Grade-Boundaries.pdf",
    2017: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/1711-gcse-9-1-grade-boundaries.pdf"
  }
};

export function pearsonSeriesUrl(year, month) {
  const y = Number(year);
  const byYear = month === "JUN" ? PEARSON_GCSE_9_1.JUN
    : month === "NOV" ? PEARSON_GCSE_9_1.NOV
    : null;
  if (!byYear) return null;
  // Pinned entries are authoritative. Do not construct a URL for an unseen
  // year: Pearson used at least four filename shapes and a guess is a silent
  // 404 presented to the user as "unavailable".
  return byYear[y] || null;
}

// AQA publications sit behind hashed CDN paths that cannot be constructed from
// a series name, so AQA has to be found by reading the board's own pages. That
// discovery lives HERE, next to the code that needs it, rather than in a sibling
// module: when it lived elsewhere it had to be injected at runtime, and any
// consumer that forgot to inject it silently got zero AQA rows and no error.
const AQA_BOUNDARIES_PAGES = [
  "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries",
  "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries/archive"
];

const MONTH_WORDS = {
  JAN: "january", FEB: "february", MAR: "march", APR: "april", MAY: "may", JUN: "june",
  JUL: "july", AUG: "august", SEP: "september", OCT: "october", NOV: "november", DEC: "december"
};

// Does this text name the requested series? Handles both "June 2025" and the
// archive's academic-year heading "2024/25 exams".
function aqaSeriesMatches(text, year, series) {
  const month = MONTH_WORDS[series] || String(series || "").toLowerCase();
  if (!month || !year) return false;
  const stem = month.slice(0, 4);
  if (new RegExp(`${stem}[^0-9]{0,12}${year}`, "i").test(text)) return true;
  return new RegExp(`\\b${String(year).slice(0, 4)}/${String(year).slice(2)}\\s+exams`, "i").test(text) &&
    new RegExp(stem, "i").test(text);
}

/**
 * Every AQA grade-boundary PDF that could hold the requested series.
 *
 * The archive nests an academic-year heading, a series heading, then one card
 * per qualification; the current page has no headings and labels each card
 * instead. Both shapes are handled, and a series is only collected from within
 * its own section so a neighbouring series can never be picked up.
 *
 * @returns {Promise<Array<{url:string,title:string}>>}
 */
const aqaDiscoveryMemo = new Map();

export async function discoverAqaSeries(request = {}, options = {}) {
  const year = Number(request.year);
  const series = String(request.series || "").toUpperCase();
  if (!Number.isInteger(year) || year < 1900 || !MONTH_WORDS[series]) return [];
  const memoKey = `${year}|${series}`;
  diag("B? ", "discoverAqaSeries", { year: year, series: series });
  // The candidate list for a series cannot change within a session, and several
  // subjects from the same series ask for it in turn. Memoising keeps that to
  // one page read plus one PDF per verification instead of repeating both.
  if (!options.fetchImpl && aqaDiscoveryMemo.has(memoKey)) {
    const hit = aqaDiscoveryMemo.get(memoKey);
    diag("B? ", "discoverAqaSeries MEMO HIT", { year: year, series: series, count: (hit && hit.length) || 0 });
    return hit;
  }
  const promise = discoverAqaSeriesUncached({ year, series, options });
  if (!options.fetchImpl) aqaDiscoveryMemo.set(memoKey, promise);
  return promise;
}

// AQA publishes one PDF per qualification per series, and the visible cards
// are often labelled only by section. The archive page also carries the real
// filename ("AQA-GCSE-GDE-BDY-JUN-2025.PDF") in its embedded CMS data; pair
// that with the card anchors by file hash so the GCSE document is known before
// any download and the parser does not walk every A-level/AS/ELC candidate.
function aqaFileHash(value) {
  const m = /\/files\/(?:[^/]+\/)?([a-f0-9]{40,64})(?:\.pdf)?(?:[?#]|$)/i.exec(String(value || ""));
  return m ? m[1].toLowerCase() : "";
}

function aqaAnchorUrlsByHash(html) {
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>/gi)) {
    const href = m[1];
    const absolute = /^https?:/i.test(href)
      ? href
      : `https://www.aqa.org.uk${href.startsWith("/") ? "" : "/"}${href}`;
    const hash = aqaFileHash(absolute);
    if (hash && !out.has(hash)) out.set(hash, absolute);
  }
  return out;
}

function aqaArchiveCandidatesFromJson(html, year, series, anchors) {
  const out = [];
  const pairRe = /originalFilename\\?"\s*:\s*\\?"(AQA-[^"\\]+?\.(?:PDF|XLSX|XLS))\\?"[\s\S]{0,4000}?url\\?"\s*:\s*\\?"(https:\/\/cdn\.sanity\.io\/files\/[^"\\]+)\\?"/gi;
  let m;
  while ((m = pairRe.exec(html)) !== null) {
    const file = m[1];
    if (!/\.pdf$/i.test(file)) continue; // this engine parses PDFs only
    const parsed = /^AQA-(.+?)-GDE-BDY-([A-Z]{3,9})-(\d{4})\.PDF$/i.exec(file);
    if (!parsed) continue;
    if (Number(parsed[3]) !== year) continue;
    if (parsed[2].slice(0, 3).toUpperCase() !== series) continue;
    const hash = aqaFileHash(m[2]);
    const url = (hash && anchors.get(hash)) || m[2];
    out.push({ url, title: `${parsed[1]} - Grade boundaries ${series} ${year}`, hash });
  }
  return out;
}

function aqaCandidateRank(candidate) {
  const t = String((candidate && candidate.title) || "").toLowerCase();
  if (t.includes("gcse")) return 0;
  if (t.includes("a-level") || t.includes("a level")) return 3;
  if (/\bas\b/.test(t)) return 4;
  if (t.includes("elc") || t.includes("fcse")) return 2;
  return 1;
}

async function discoverAqaSeriesUncached({ year, series, options = {} }) {
  const out = [];
  const seen = new Set();

  for (const page of AQA_BOUNDARIES_PAGES) {
    // Through the CORS proxy, not direct: aqa.org.uk sends no CORS headers, so a
    // direct browser fetch cannot succeed and only logs a CORS error.
    const html = await fetchTextResource(page, options);
    if (!html) continue;
    const anchors = aqaAnchorUrlsByHash(html);
    const named = aqaArchiveCandidatesFromJson(html, year, series, anchors);
    for (const candidate of named) {
      if (!candidate.url || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      out.push(candidate);
    }
    // Inline SVG carries no useful text and would drown the card labels.
    const clean = html.replace(/<svg[\s\S]*?<\/svg>/g, " ");

    // Walk the document in order, tracking the two most recent headings.
    const tokens = [];
    const headingRe = /\d{4}\/\d{2}\s+exams|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+exams/gi;
    for (const m of clean.matchAll(headingRe)) {
      tokens.push({ at: m.index, heading: m[0].replace(/\s+/g, " ").trim() });
    }
    for (const m of clean.matchAll(/<a\b([^>]*\.pdf[^>]*)>/gi)) {
      tokens.push({ at: m.index, attrs: m[1] });
    }
    tokens.sort((a, b) => a.at - b.at);

    let seriesHeading = "";
    for (const t of tokens) {
      if (t.heading !== undefined) {
        if (!/^\d{4}\/\d{2}\s+exams$/i.test(t.heading)) seriesHeading = t.heading;
        continue;
      }
      const href = /href=["']([^"']+\.pdf)["']/i.exec(t.attrs);
      if (!href) continue;
      if (seen.has(href[1])) continue;
      const aria = /aria-label=["']([^"']+)["']/i.exec(t.attrs);
      const label = aria ? aria[1].replace(/\s+/g, " ").trim() : "";

      // A card qualifies on its own label (current page) or its section heading
      // (archive). The qualification is deliberately NOT guessed here: one
      // series lists GCSE alongside Mathematical Studies, ELC and AS, and the
      // caller verifies the document by parsing it.
      // Archive cards are commonly labelled only "GCSE"; the year/series is
      // carried by the surrounding heading (for example "June 2022 exams").
      // A link label is useful when it contains the full date, but it must not
      // override a matching section heading just because it is non-empty.
      const labelMatches = label && aqaSeriesMatches(label, year, series);
      const sectionMatches = seriesHeading && aqaSeriesMatches(seriesHeading, year, series);
      if (!labelMatches && !sectionMatches) continue;

      seen.add(href[1]);
      out.push({
        url: href[1].startsWith("http") ? href[1] : `https://www.aqa.org.uk${href[1]}`,
        title: label || `${series}-${year} candidate`
      });
    }
    if (out.length) break; // the live page wins; the archive is the fallback
  }
  // The GCSE publication is the one this engine parses. Put it first so a
  // series costs one PDF download, not one per A-level/AS/ELC publication.
  out.sort((a, b) => aqaCandidateRank(a) - aqaCandidateRank(b));
  diag("B? ", "discoverAqaSeries result", {
    year: year,
    series: series,
    candidates: out.length,
    urls: out.map(function (f) { return f.url.slice(0, 80); }),
    titles: out.map(function (f) { return f.title; })
  });
  return out;
}

async function aqaSeriesUrls(year, month, options) {
  const found = await discoverAqaSeries({ year, series: month }, options);
  return (found || []).map((f) => f.url).filter(Boolean);
}

// ---------------------------------------------------------------------------
// row parsers — these are the only places a number becomes a boundary
// ---------------------------------------------------------------------------

const NINE_ONE_H = ["9", "8", "7", "6", "5", "4", "3"];
const NINE_ONE_F = ["5", "4", "3", "2", "1"];

// Pearson GCSE 9-1 rows look like:
//   1MA1  Mathematics (Higher)  Subject  240  217  186  156  121  87  53  36  0
// Foundation has no 9-8-7-6 and carries U:
//   1MA1  Mathematics (Foundation)  Subject  240  175  144  105  67  29  0
//
// Numbers are taken from the WHOLE line, not from a slice anchored on the
// code. Pearson's older PDFs place the code in a different column, so pdf.js
// can emit the row as "Subject 240 194 ... 0 1MA1 Mathematics (Higher)" —
// slicing at the code would discard every mark on the row.
export function parsePearsonGcseRow(lines, code, tier) {
  for (const line of lines) {
    if (!line.includes(code)) continue;
    // Older Pearson PDFs print "Mathematics Higher" rather than
    // "Mathematics (Higher)"; both are the same tier row.
    const isFoundation = /\(Foundation\)/i.test(line) || /\bFoundation\b/i.test(line);
    const isHigher = /\(Higher\)/i.test(line) || /\bHigher\b/i.test(line);
    if (isFoundation && tier !== "F") continue;
    if (isHigher && tier !== "H") continue;
    if (tier === "F" && !isFoundation) continue;
    if (tier === "H" && !isHigher) continue;

    // The specification code itself contains digits ("1MA1" -> 1), so strip it
    // out before reading numbers, otherwise maxMark picks up the "1" and the
    // grade count is off by one.
    const withoutCode = line.split(code).join(" ");
    const nums = (withoutCode.match(/\d+/g) || []).map(Number);
    if (nums.length < 2) continue;
    const maxMark = nums[0];
    const marks = nums.slice(1);

    let grades;
    if (isFoundation) {
      // Foundation: 5,4,3,2,1[,U]
      const hasU = marks.length === NINE_ONE_F.length + 1;
      grades = hasU ? [...NINE_ONE_F, "U"] : [...NINE_ONE_F];
      if (marks.length !== grades.length) continue;
    } else if (isHigher) {
      // Higher: 9..3[,U]
      const hasU = marks.length === NINE_ONE_H.length + 1;
      grades = hasU ? [...NINE_ONE_H, "U"] : [...NINE_ONE_H];
      if (marks.length !== grades.length) continue;
    } else {
      // Un-tiered Pearson subject (1CP2, 1GB0): full 9..1
      grades = [...NINE_ONE_H, "2", "1", "U"];
      if (marks.length !== grades.length) continue;
    }
    return { grades, marks, maxMark };
  }
  return null;
}

// AQA GCSE rows look like:
//   8461H  BIOLOGY TIER H  200  141  127  113  94  75  56  46  -  -
// where trailing dashes are non-classified marks. Subjects with no tier run
// the full 9..1 range.
export function parseAqaGcseRow(lines, code, tier) {
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    if (!line.includes(code)) continue;
    const codeUpper = code.toUpperCase();
    const isTiered = new RegExp(`${codeUpper}[HF]\\b`).test(line.toUpperCase());
    if (isTiered) {
      if (tier === "H" && !new RegExp(`${codeUpper}H\\b`).test(line.toUpperCase())) continue;
      if (tier === "F" && !new RegExp(`${codeUpper}F\\b`).test(line.toUpperCase())) continue;
      if (!tier) continue; // a tiered subject cannot answer a tier-less request
    }

    // The code contains digits ("8700" -> 8700), so remove it before tokenising.
    const withoutCode = line.split(code).join(" ");
    const marks = [];
    for (const tok of withoutCode.split(/\s+/)) {
      if (/^\d+$/.test(tok)) marks.push(Number(tok));
      else if (tok === "-") marks.push(null);
    }
    if (marks.length < 2) continue;
    const maxMark = marks[0];
    // A dash means "this grade is not classified in this tier", not missing
    // data. Foundation rows lead with four dashes (grades 9..6), Higher rows
    // trail with two (U and any unclassified tail). Drop them so what remains
    // is exactly this tier's grades, in descending order.
    const body = marks.slice(1).filter((m) => m !== null);

    const grades = isTiered
      ? (tier === "H" ? [...NINE_ONE_H] : [...NINE_ONE_F])
      : [...NINE_ONE_H, "2", "1"];
    if (body.length !== grades.length) continue;
    return { grades, marks: body, maxMark };
  }
  return null;
}

async function fetchBytes(url, timeoutMs = FETCH_TIMEOUT_MS, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, cache: "no-store", redirect: "error" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// fetch + CORS
// ---------------------------------------------------------------------------

// Exam boards publish PDFs without CORS headers, so a direct browser fetch of
// aqa.org.uk / qualifications.pearson.com can never succeed. The deployment
// proxy answers those requests. Proxy-first is deliberate: a proxy that
// ANSWERS is authoritative including its status, so firing a doomed direct
// request afterwards only adds noise. Direct is still tried when the proxy
// itself is unreachable (a cold deployment), which is the only case where a
// board might allow cross-origin reads.
export function proxyBase() {
  const w = typeof window !== "undefined" ? window : null;
  const meta = typeof document !== "undefined"
    ? document.querySelector('meta[name="neuronet-proxy"]')?.getAttribute("content")
    : null;
  const base = (w && w.__NEURONET_PROXY_BASE) || meta || "https://neuronet-backend.onrender.com";
  return String(base || "").replace(/\/+$/, "");
}

export function proxyUrl(real, base = proxyBase()) {
  const sep = base.endsWith("/") ? "" : "/";
  return `${base}${sep}api/proxy?url=${encodeURIComponent(real)}`;
}

// ---- fetch log: one line per network attempt, for the dev toast -------------

const inflight = new Map();
const FETCH_LOG = [];
const FETCH_LOG_MAX = 200;
const fetchLogListeners = new Set();

export function onFetchLog(fn) {
  if (typeof fn === "function") fetchLogListeners.add(fn);
  return () => fetchLogListeners.delete(fn);
}

function logFetch(entry) {
  FETCH_LOG.push(entry);
  if (FETCH_LOG.length > FETCH_LOG_MAX) FETCH_LOG.shift();
  for (const fn of fetchLogListeners) { try { fn(entry); } catch { /* listener fault */ } }
}

export function fetchLog() { return FETCH_LOG.slice(); }

export function clearFetchLog() { FETCH_LOG.length = 0; }

const LABEL_BY_URL = [
  [/qualifications\.pearson\.com/, "Pearson"],
  [/\baqa\.org\.uk\b/, "AQA"],
  [/\bocr\.org\.uk\b/, "OCR"],
  [/neuronet-backend/, "proxy"]
];

function labelFor(url, via) {
  for (const [re, name] of LABEL_BY_URL) if (re.test(url)) return `${name} (${via})`;
  return `${via}`;
}

/**
 * Fetch a resource, reporting every attempt on the fetch log.
 * @returns {Promise<Uint8Array|null>} bytes, or null when unreachable.
 */
export async function fetchTracked(url, { timeoutMs = FETCH_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const via = url.includes("/api/proxy?") ? "proxy" : "direct";
  const at = Date.now();
  diag("B? ", "fetch start", { url: url.slice(0, 120), via: via });
  // One in-flight request per URL. The tracker resolves several subjects before
  // rendering, and they share the same series PDF, so without this the identical
  // document was downloaded four times over on every load.
  const existing = inflight.get(url);
  if (existing) {
    diag("B? ", "fetch DEDUP (shared in-flight)", { url: url.slice(0, 120) });
    logFetch({ at, url, host: labelFor(url, via), ok: null, shared: true, ms: 0 });
    return existing;
  }
  const run = (async () => {
    try {
      const bytes = await fetchBytes(url, timeoutMs, fetchImpl);
      if (bytes) {
        diag("B? ", "fetch OK", { url: url.slice(0, 120), bytes: bytes.length, ms: Date.now() - at });
        logFetch({ at, url, host: labelFor(url, via), ok: true, bytes: bytes.length, ms: Date.now() - at });
        return bytes;
      }
      diag("B? ", "fetch FAILED (no bytes)", { url: url.slice(0, 120), ms: Date.now() - at });
      logFetch({ at, url, host: labelFor(url, via), ok: false, error: "HTTP error", ms: Date.now() - at });
      return null;
    } catch (err) {
      diag("B? ", "fetch THREW", { url: url.slice(0, 120), error: String((err && err.name) || err), ms: Date.now() - at });
      logFetch({
        at, url, host: labelFor(url, via), ok: false,
        error: String((err && err.name) || err), ms: Date.now() - at
      });
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, run);
  return run;
}

/**
 * Fetch a board PDF. Proxy first, direct only as a fallback.
 * @returns {Promise<Uint8Array|null>}
 */
export async function fetchBoardResource(url, options = {}) {
  const base = options.proxyBase || proxyBase();
  const fetchImpl = options.fetchImpl || fetch;
  diag("B? ", "fetchBoardResource", { url: url.slice(0, 120), proxyBase: base || "(none)" });
  const proxyTarget = options.proxyFn ? options.proxyFn(url) : (base ? proxyUrl(url, base) : null);
  if (proxyTarget) {
    const bytes = await fetchTracked(proxyTarget, { timeoutMs: FETCH_TIMEOUT_MS, fetchImpl });
    if (bytes) return bytes;
    diag("B? ", "proxy fetch returned nothing, will try direct", { url: url.slice(0, 120) });
  }
  // The proxy was unreachable or refused. Only now is a direct attempt worth
  // making, because a board occasionally does send CORS headers.
  if (!url.includes("/api/proxy?")) return fetchTracked(url, { timeoutMs: FETCH_TIMEOUT_MS, fetchImpl });
  return null;
}

/** Plain text fetch through the same CORS path (used for catalogue pages). */
export async function fetchTextResource(url, options = {}) {
  const base = options.proxyBase || proxyBase();
  const fetchImpl = options.fetchImpl || fetch;
  const tryOne = async (target) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetchImpl(target, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  };
  const proxyTarget = options.proxyFn ? options.proxyFn(url) : (base ? proxyUrl(url, base) : null);
  if (proxyTarget) {
    const text = await tryOne(proxyTarget);
    if (text) {
      logFetch({ at: Date.now(), url, host: labelFor(url, "proxy"), ok: true, bytes: text.length, kind: "text" });
      return text;
    }
  }
  if (url.includes("/api/proxy?")) return null;
  const text = await tryOne(url);
  logFetch({
    at: Date.now(), url, host: labelFor(url, "direct"), ok: Boolean(text),
    kind: "text", ...(text ? { bytes: text.length } : { error: "unreachable" })
  });
  return text;
}

// ---------------------------------------------------------------------------
// progress — what the UI needs to show that work is happening
// ---------------------------------------------------------------------------

// The tracker used to say "Fetching grade boundaries…" from the scraper's own
// sweep status, which only knew about the legacy engine. These counters belong
// to the verified engine, so its progress is visible too: without them the UI
// showed a finished-looking list while this engine was still downloading, which
// reads exactly like "it worked but gave me nothing".
const progress = { active: 0, done: 0, failed: 0, phase: "idle", detail: "" };
const progressListeners = new Set();

export function onProgress(fn) {
  if (typeof fn === "function") progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function emitProgress(patch) {
  Object.assign(progress, patch);
  for (const fn of progressListeners) { try { fn({ ...progress }); } catch { /* listener fault */ } }
}

/** Begin reporting acquisition work. Idempotent-safe: each call pairs with end(). */
export function beginWork(detail = "") {
  emitProgress({ active: progress.active + 1, phase: "fetching", detail });
}

/** Record one finished acquisition attempt. */
export function endWork(ok = true) {
  emitProgress({
    active: Math.max(0, progress.active - 1),
    done: progress.done + (ok ? 1 : 0),
    failed: progress.failed + (ok ? 0 : 1),
    phase: Math.max(0, progress.active - 1) > 0 ? "fetching" : "ready",
    detail: ""
  });
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Exact official grade boundaries for one course + one series.
 *
 * @returns {Promise<{key,board,qual,code,tier,year,month,grades,marks,maxMark,papers,source}|null>}
 *   the published table, or null when it cannot be satisfied exactly.
 */
export async function getBoundaries({ board, qual, code, tier, year, series } = {}, options = {}) {
  // The engine's acquisition request carries `series` as { month, year },
  // while direct callers pass a series word plus a separate year. Both address
  // the same publication; normalize before identity so an object can never be
  // stringified into "[object Object]" and silently fail closed.
  const seriesValue = series && typeof series === "object" ? series.month : series;
  const yearValue = (year == null && series && typeof series === "object") ? series.year : year;
  const key = boundaryKey({ board, qual, code, tier, year: yearValue, series: seriesValue });
  diag("B? ", "getBoundaries called", { board: board, qual: qual, code: code, tier: tier, year: yearValue, series: seriesValue, key: key });
  if (!key) { diag("B? ", "NULL: boundaryKey rejected the request", { board: board, qual: qual, code: code, tier: tier, year: yearValue, series: seriesValue }); return null; }

  const cached = cachedBoundary(key);
  if (cached && isOfficialSourceUrl(cached.source && cached.source.url, boardId(board))
    && Array.isArray(cached.grades) && Array.isArray(cached.marks)
    && cached.grades.length > 0 && cached.grades.length === cached.marks.length
    && /^[a-f0-9]{64}$/i.test(String(cached.source.contentHash || ""))
    && Number.isFinite(Number(cached.maxMark)) && Number(cached.maxMark) > 0
    && cached.marks.every((mark) => Number.isFinite(Number(mark)) && Number(mark) >= 0 && Number(mark) <= Number(cached.maxMark))) {
    diag("B? ", "verified source cache HIT", { key: key, grades: cached.grades, marks: cached.marks });
    return cached;
  }

  const b = boardId(board);
  const month = monthId(seriesValue);
  const y = Number(yearValue);
  const { code: c, tier: t } = splitCodeTier(code, tier);

  // Until a parser for a board/qualification is verified, fail closed rather
  // than allow the former mock-backed engine to manufacture an official row.
  if (!((b === "aqa" || b === "pearson") && qualId(qual) === "gcse")) {
    diag("B? ", "unsupported exact source/parser", { board: b, qual: qual, code: c });
    return null;
  }

  beginWork(`${b} ${c}${t ? "/" + t : ""} ${month} ${y}`);
  let ok = false;
  try {
    const resource = await acquireSourceBytes(b, y, month, c, t, options);
    if (!resource) return null;
    const lines = await pdfTextFromBytes(resource.bytes);
    const parsed = b === "aqa"
      ? parseAqaGcseRow(lines, c, t)
      : parsePearsonGcseRow(lines, c, t);
    if (!parsed || !Array.isArray(parsed.grades) || !Array.isArray(parsed.marks)
      || parsed.grades.length === 0 || parsed.grades.length !== parsed.marks.length
      || !parsed.marks.every((mark) => Number.isFinite(Number(mark)))) return null;

    const contentHash = await sha256Digest(resource.bytes);
    if (!contentHash) {
      diag("B? ", "cannot verify source without SHA-256", { board: b, url: resource.url });
      return null;
    }
    const table = {
      key,
      board: b,
      qual: qualId(qual),
      code: c,
      tier: t,
      year: y,
      month,
      grades: parsed.grades.map(String),
      gradesInOrder: parsed.grades.map(String),
      marks: parsed.marks.map(Number),
      maxMark: Number(parsed.maxMark),
      papers: [],
      source: {
        publisher: b === "pearson" ? "Pearson Edexcel" : b === "ocr" ? "OCR" : "AQA",
        url: resource.url,
        title: `${b === "pearson" ? "Pearson Edexcel" : "AQA"} GCSE grade boundaries ${month} ${y}`,
        contentHash,
        verifiedAt: new Date().toISOString().slice(0, 10)
      }
    };

    if (!Number.isFinite(table.maxMark) || !isOfficialSourceUrl(table.source.url, b)
      || !/^[a-f0-9]{64}$/i.test(table.source.contentHash)
      || table.marks.some((mark) => mark < 0 || mark > table.maxMark)
      || table.marks.some((mark, i) => i > 0 && mark > table.marks[i - 1])) return null;
    storeBoundary(key, table);
    ok = true;
    return table;
  } catch (err) {
    diag("B? ", "THREW: " + (err && err.message ? err.message : String(err)));
    return null;
  } finally {
    endWork(ok);
  }
}

function isOfficialSourceUrl(value, board) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (board === "aqa") {
      if (host === "aqa.org.uk" || host.endsWith(".aqa.org.uk")) return true;
      // AQA's CMS serves the same published files from its own Sanity project;
      // accept that project only, never Sanity at large.
      return host === "cdn.sanity.io" && url.pathname.startsWith("/files/p28bar15/green/");
    }
    if (board === "pearson") return host === "pearson.com" || host.endsWith(".pearson.com");
    return false;
  } catch {
    return false;
  }
}

async function sha256Digest(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== "function") return null;
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Verified AQA GCSE publications, parsed and row-checked. Recent series are
// served from AQA's own Sanity project; these content-addressed URLs are
// stable. Discovery below still covers every other series and acts as a
// fallback if a pinned file ever disappears.
const AQA_VERIFIED_GCSE = {
  "JUN-2024": "https://cdn.sanity.io/files/p28bar15/green/fc6e25026a0ec5cc438923039fd8b0bae581c285.pdf",
  "JUN-2025": "https://cdn.sanity.io/files/p28bar15/green/ae1e25e87bcd136c90d5db0577ff92ffce552c7b.pdf"
};

async function tryAqaDocument(url, year, month, codeUp, tierNorm, options) {
  const bytes = await fetchBoardResource(url, options);
  if (!bytes) { diag("B? ", "AQA candidate fetch failed", { url: url.slice(0, 80) }); return null; }
  if (!isPdfBytes(bytes)) { diag("B? ", "AQA candidate is not a PDF", { url: url.slice(0, 80) }); return null; }
  let lines;
  try {
    lines = await pdfTextFromBytes(bytes);
  } catch (e) {
    diag("B? ", "AQA candidate parse threw", { url: url.slice(0, 80), error: String(e && e.message) });
    return null;
  }
  if (!documentDeclaresSeries(lines, year, month)) {
    diag("B? ", "AQA candidate series mismatch", { url: url.slice(0, 80), year, month });
    return null;
  }
  const match = parseAqaGcseRow(lines, codeUp, tierNorm);
  diag("B? ", "AQA candidate check", { url: url.slice(0, 80), code: codeUp, tier: tierNorm, match: !!match });
  return match ? { bytes, url } : null;
}

// The GCSE publication for a series, found once and then reused. Resolving it
// means fetching and parsing candidate PDFs until one actually contains the
// requested course, so without this every subject from the same series repeated
// the whole search.
const seriesDocumentCache = new Map();

async function loadSeriesDocument(board, year, month, code, tier, options = {}) {
  // AQA's document choice depends on which course was asked for, so the cache
  // is keyed per course as well as per series. Pearson's publication holds every
  // subject in one PDF, so its key stays coarse.
  const key = board === "aqa"
    ? `${board}|${month}|${year}|${String(code).toUpperCase()}|${tier || "_"}`
    : `${board}|${month}|${year}`;
  if (seriesDocumentCache.has(key)) {
    diag("B? ", "seriesDocumentCache HIT", { key: key });
    return seriesDocumentCache.get(key);
  }
  diag("B? ", "seriesDocumentCache MISS", { key: key, board: board, code: code, tier: tier });
  const promise = (async () => {
    if (board === "pearson") {
      const url = pearsonSeriesUrl(year, month);
      diag("B? ", "pearson series URL", { url: url });
      const bytes = url ? await fetchBoardResource(url, options) : null;
      if (!bytes || !isPdfBytes(bytes)) return null;
      const lines = await pdfTextFromBytes(bytes);
      return documentDeclaresSeries(lines, year, month) ? { bytes, url } : null;
    }
    if (board === "aqa") {
      const codeUp = String(code).trim().toUpperCase();
      const tierNorm = tierId(tier);
      const verified = AQA_VERIFIED_GCSE[`${month}-${Number(year)}`];
      if (verified) {
        diag("B? ", "AQA verified series URL", { url: verified.slice(0, 80) });
        const hit = await tryAqaDocument(verified, year, month, codeUp, tierNorm, options);
        if (hit) return hit;
        diag("B? ", "AQA verified URL rejected; falling back to discovery", { code: codeUp, tier: tierNorm });
      }
      // AQA's archive lists several PDFs per series (GCSE, Mathematical Studies,
      // ELC, AS, A-level) whose labels are easy to confuse, so the document is
      // chosen by parsing it, never by its filename or card label. The GCSE
      // publication is recognised by its own contents.
      const urls = await aqaSeriesUrls(year, month, options);
      diag("B? ", "AQA candidate URLs", { count: urls.length, urls: urls.map(function (u) { return u.slice(0, 80); }) });
      for (const url of urls) {
        if (url === verified) continue;
        const hit = await tryAqaDocument(url, year, month, codeUp, tierNorm, options);
        // Accept the candidate only if it really contains the requested
        // course. This is what keeps A-level and AS documents from being
        // mistaken for the GCSE one.
        if (hit) return hit;
      }
      diag("B? ", "AQA: no candidate document matched", { code: code, tier: tier });
      return null;
    }
    return null;
  })();
  seriesDocumentCache.set(key, promise);
  return promise;
}

async function acquireSourceBytes(boardId_, year, month, code, tier, options = {}) {
  const resource = await loadSeriesDocument(boardId_, year, month, code, tier, options);
  if (!resource || !resource.bytes) { diag("B? ", "acquireSourceBytes: no document bytes", { board: boardId_, code: code, tier: tier }); return null; }
  const { bytes, url } = resource;
  if (!isPdfBytes(bytes)) { diag("B? ", "acquireSourceBytes: invalid PDF signature", { board: boardId_, url }); return null; }
  // A cached document may be the wrong publication for this course (an
  // un-tiered AQA paper requested from a document that only lists tiered ones),
  // so the requested row is still checked before the document is accepted.
  if (boardId_ !== "aqa") return { bytes, url };
  let lines;
  try { lines = await pdfTextFromBytes(bytes); } catch (e) { diag("B? ", "acquireSourceBytes: AQA re-parse threw", { error: String(e && e.message) }); return null; }
  const ok = parseAqaGcseRow(lines, String(code).trim().toUpperCase(), tierId(tier));
  diag("B? ", "acquireSourceBytes: AQA row re-check", { code: code, tier: tier, ok: !!ok });
  return ok ? { bytes, url } : null;
}

function isPdfBytes(bytes) {
  return Boolean(bytes && bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d);
}

function documentDeclaresSeries(lines, year, month) {
  const text = (lines || []).join(" ").replace(/\s+/g, " ");
  const monthWord = MONTH_WORDS[month];
  if (!monthWord || !Number.isInteger(Number(year))) return false;
  // pdf.js sometimes emits a year with a gap inside it ("June 202 3") when the
  // PDF uses tighter kerning. Allow whitespace between the digits so the
  // document's own cover still proves its series without loosening the match
  // into a cross-year one.
  const yearPattern = String(Number(year)).split("").join("\\s*");
  const aliases = [monthWord, monthWord.slice(0, 3)];
  return aliases.some((word) => new RegExp(`\\b${word}\\.?[\\s-]+${yearPattern}\\b`, "i").test(text));
}

/**
 * Exact mark for one grade of one exact table. Returns null rather than a
 * default when anything is missing — the caller decides how to render that.
 */
export function markForGrade(key, grade) {
  const table = cachedBoundary(key);
  if (!table) return null;
  const i = table.grades.indexOf(String(grade));
  return i === -1 ? null : table.marks[i];
}

export { pdfTextFromBytes, buildLayoutLines, fetchBytes };
