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
const CACHE_VERSION = 2;

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

export function monthId(series) {
  const s = String(series || "").trim().toLowerCase();
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
  const c = String(code || "").trim().toUpperCase();
  const y = year == null ? null : Number(year);
  const t = tierId(tier);
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

export function clearBoundaryCache() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(CACHE_KEY); } catch { /* ignore */ }
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

// Pearson Edexcel publishes one PDF per series containing every GCSE subject.
// The filename convention is stable enough to construct for June from 2023
// onward; earlier years are reached through the archive catalogue below.
const PEARSON_GCSE_9_1 = {
  JUN: (y) => `https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/${y}06-gcse-9-1-subject-grade-boundaries.pdf`,
  JUN_LEGACY: {
    2025: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2025-gcse.pdf",
    2024: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2024-gcse.pdf",
    2023: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2306-gcse-9-1-subject-grade-boundaries.pdf",
    2022: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2206-gcse-9-1-subject-grade-boundaries.pdf",
    NOV: {
      2022: "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/2211-gcse-9-1-subject-grade-boundaries-v1.pdf"
    }
  }
};

export function pearsonSeriesUrl(year, month) {
  const y = Number(year);
  if (month === "JUN") {
    const legacy = PEARSON_GCSE_9_1.JUN_LEGACY[y];
    if (legacy && typeof legacy === "string") return legacy;
    if (y >= 2023) return PEARSON_GCSE_9_1.JUN(y);
  }
  if (month === "NOV") {
    const nov = PEARSON_GCSE_9_1.JUN_LEGACY.NOV[y];
    if (nov) return nov;
    if (y >= 2023) return PEARSON_GCSE_9_1.JUN(y).replace("06-", "11-");
  }
  return null;
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

export async function discoverAqaSeries(request = {}) {
  const year = request.year == null ? 2025 : Number(request.year);
  const series = request.series || "JUN";
  const memoKey = `${year}|${series}`;
  diag("B? ", "discoverAqaSeries", { year: year, series: series });
  // The candidate list for a series cannot change within a session, and several
  // subjects from the same series ask for it in turn. Memoising keeps that to
  // one page read plus one PDF per verification instead of repeating both.
  if (aqaDiscoveryMemo.has(memoKey)) {
    const hit = aqaDiscoveryMemo.get(memoKey);
    diag("B? ", "discoverAqaSeries MEMO HIT", { year: year, series: series, count: (hit && hit.length) || 0 });
    return hit;
  }
  const promise = discoverAqaSeriesUncached({ year, series });
  aqaDiscoveryMemo.set(memoKey, promise);
  return promise;
}

/** Drop the memoised AQA catalogue lookups (used by tests and force-refresh). */
export function clearAqaDiscoveryCache() { aqaDiscoveryMemo.clear(); }

async function discoverAqaSeriesUncached({ year, series }) {
  const out = [];
  const seen = new Set();

  for (const page of AQA_BOUNDARIES_PAGES) {
    // Through the CORS proxy, not direct: aqa.org.uk sends no CORS headers, so a
    // direct browser fetch cannot succeed and only logs a CORS error.
    const html = await fetchTextResource(page);
    if (!html) continue;
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
  diag("B? ", "discoverAqaSeries result", { year: year, series: series, candidates: out.length, urls: out.map(function (f) { return f.url.slice(0, 80); }) });
  return out;
}

async function aqaSeriesUrls(year, month) {
  const found = await discoverAqaSeries({ year, series: month });
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
    const isFoundation = /\(Foundation\)/i.test(line);
    const isHigher = /\(Higher\)/i.test(line);
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

async function fetchBytes(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
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
export async function fetchTracked(url, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
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
      const bytes = await fetchBytes(url, timeoutMs);
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
export async function fetchBoardResource(url) {
  const base = proxyBase();
  diag("B? ", "fetchBoardResource", { url: url.slice(0, 120), proxyBase: base || "(none)" });
  if (base) {
    const bytes = await fetchTracked(proxyUrl(url, base), { timeoutMs: FETCH_TIMEOUT_MS });
    if (bytes) return bytes;
    diag("B? ", "proxy fetch returned nothing, will try direct", { url: url.slice(0, 120) });
  }
  // The proxy was unreachable or refused. Only now is a direct attempt worth
  // making, because a board occasionally does send CORS headers.
  if (!url.includes("/api/proxy?")) return fetchTracked(url, { timeoutMs: FETCH_TIMEOUT_MS });
  return null;
}

/** Plain text fetch through the same CORS path (used for catalogue pages). */
export async function fetchTextResource(url) {
  const base = proxyBase();
  const tryOne = async (target) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(target, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  };
  if (base) {
    const text = await tryOne(proxyUrl(url, base));
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

// AQA publishes several PDFs per series — GCSE, A-level, AS, Mathematical
// Studies, ELC — and they are indistinguishable by heading: A-level and AS
// documents use the same "Subject grade boundaries" wording. Row density is also
// not a reliable test (the GCSE document was only just the densest).
//
// So the document is not classified at all. Instead a candidate is accepted only
// if parsing it yields the course that was actually asked for, which is the
// same standard used everywhere else here: a document counts as the GCSE
// publication if and only if it contains this course's row.
export function isGcseBoundaryDocument(lines, code, tier) {
  if (!code) return false;
  return Boolean(parseAqaGcseRow(lines, code, tier));
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

export function getProgress() { return { ...progress }; }

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

/** Reset between scopes so a reopened tracker does not show stale totals. */
export function resetProgress() {
  emitProgress({ active: 0, done: 0, failed: 0, phase: "idle", detail: "" });
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
export async function getBoundaries({ board, qual, code, tier, year, series } = {}) {
  const key = boundaryKey({ board, qual, code, tier, year, series });
  diag("B? ", "getBoundaries called", { board: board, qual: qual, code: code, tier: tier, year: year, series: series, key: key });
  if (!key) { diag("B? ", "NULL: boundaryKey rejected the request", { board: board, qual: qual, code: code, tier: tier, year: year, series: series }); return null; }

  const cached = cachedBoundary(key);
  if (cached) { diag("B? ", "cache HIT", { key: key, grades: cached.grades, marks: cached.marks }); return cached; }

  const b = boardId(board);
  const month = monthId(series);
  const y = Number(year);
  const c = String(code).trim().toUpperCase();
  const t = tierId(tier);
  diag("B? ", "cache MISS - will fetch", { board: b, code: c, tier: t, year: y, month: month });

  // From here on this is real network work, so report it. A cache hit above
  // returns silently, which is what keeps the UI from flickering on every row.
  beginWork(`${b} ${c}${t ? "/" + t : ""} ${month} ${y}`);
  let ok = false;
  try {
    const bytes = await acquireSourceBytes(b, y, month, c, t);
    if (!bytes) { diag("B? ", "NULL: acquireSourceBytes returned nothing", { board: b, code: c, tier: t, year: y, month: month }); return null; }
    diag("B? ", "bytes acquired", { board: b, code: c, tier: t, bytes: bytes.length });

    const lines = await pdfTextFromBytes(bytes);
    diag("B? ", "pdf text extracted", { lines: lines.length });
    const parsed = b === "pearson"
      ? parsePearsonGcseRow(lines, c, t)
      : parseAqaGcseRow(lines, c, t);
    if (!parsed) { diag("B? ", "NULL: parser found no matching row", { board: b, code: c, tier: t, lineCount: lines.length }); return null; }
    diag("B? ", "parsed OK", { board: b, code: c, tier: t, grades: parsed.grades, marks: parsed.marks });

    const table = {
      key,
      board: b,
      qual: qualId(qual),
      code: c,
      tier: t,
      year: y,
      month,
      grades: parsed.grades,
      marks: parsed.marks,
      maxMark: parsed.maxMark,
      papers: [],
      source: {
        publisher: b === "pearson" ? "Pearson Edexcel" : "AQA",
        verifiedAt: new Date().toISOString().slice(0, 10)
      }
    };

    storeBoundary(key, table);
    diag("B? ", "stored in cache", { key: key });
    ok = true;
    return table;
  } catch (err) {
    diag("B? ", "THREW: " + (err && err.message ? err.message : String(err)));
    throw err;
  } finally {
    // Exactly one endWork per beginWork, on every path including a throw, so
    // the active count cannot get stuck above zero and strand the UI on
    // "fetching".
    endWork(ok);
  }
}

// The GCSE publication for a series, found once and then reused. Resolving it
// means fetching and parsing candidate PDFs until one actually contains the
// requested course, so without this every subject from the same series repeated
// the whole search.
const seriesDocumentCache = new Map();

/** Drop cached series documents (tests, force-refresh). */
export function clearSeriesDocumentCache() { seriesDocumentCache.clear(); }

async function loadSeriesDocument(board, year, month, code, tier) {
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
      return url ? await fetchBoardResource(url) : null;
    }
    if (board === "aqa") {
      // AQA's archive lists several PDFs per series (GCSE, Mathematical Studies,
      // ELC, AS, A-level) whose labels are easy to confuse, so the document is
      // chosen by parsing it, never by its filename or card label. The GCSE
      // publication is recognised by its own contents.
      const urls = await aqaSeriesUrls(year, month);
      diag("B? ", "AQA candidate URLs", { count: urls.length, urls: urls.map(function (u) { return u.slice(0, 80); }) });
      for (const url of urls) {
        const bytes = await fetchBoardResource(url);
        if (!bytes) { diag("B? ", "AQA candidate fetch failed", { url: url.slice(0, 80) }); continue; }
        let lines;
        try { lines = await pdfTextFromBytes(bytes); } catch (e) { diag("B? ", "AQA candidate parse threw", { url: url.slice(0, 80), error: String(e && e.message) }); continue; }
        const codeUp = String(code).trim().toUpperCase();
        const tierNorm = tierId(tier);
        const match = parseAqaGcseRow(lines, codeUp, tierNorm);
        diag("B? ", "AQA candidate check", { url: url.slice(0, 80), code: codeUp, tier: tierNorm, match: !!match });
        // Accept the candidate only if it really contains the requested
        // course. This is what keeps A-level and AS documents from being
        // mistaken for the GCSE one.
        if (match) return bytes;
      }
      diag("B? ", "AQA: no candidate document matched", { code: code, tier: tier });
      return null;
    }
    return null;
  })();
  seriesDocumentCache.set(key, promise);
  return promise;
}

async function acquireSourceBytes(boardId_, year, month, code, tier) {
  const bytes = await loadSeriesDocument(boardId_, year, month, code, tier);
  if (!bytes) { diag("B? ", "acquireSourceBytes: no document bytes", { board: boardId_, code: code, tier: tier }); return null; }
  // A cached document may be the wrong publication for this course (an
  // un-tiered AQA paper requested from a document that only lists tiered ones),
  // so the requested row is still checked before the document is accepted.
  if (boardId_ !== "aqa") return bytes;
  let lines;
  try { lines = await pdfTextFromBytes(bytes); } catch (e) { diag("B? ", "acquireSourceBytes: AQA re-parse threw", { error: String(e && e.message) }); return null; }
  const ok = parseAqaGcseRow(lines, String(code).trim().toUpperCase(), tierId(tier));
  diag("B? ", "acquireSourceBytes: AQA row re-check", { code: code, tier: tier, ok: !!ok });
  return ok ? bytes : null;
}

/**
 * Every cached exact table for a course. Cheap, offline, and the basis of the
 * "fill every year I've done" behaviour — no refetch needed because official
 * boundaries never change.
 */
export function cachedBoundariesForCourse({ board, qual, code, tier } = {}) {
  const b = boardId(board);
  const q = qualId(qual);
  const c = String(code || "").trim().toUpperCase();
  const t = tierId(tier);
  if (!b || !q || !c) return [];
  const prefix = `${b}|${q}|${c}|${t || "_"}|`;
  const cache = readCache();
  return Object.entries(cache.tables)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .sort((a, b2) => (a.year - b2.year) || (a.month < b2.month ? -1 : a.month > b2.month ? 1 : 0));
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
