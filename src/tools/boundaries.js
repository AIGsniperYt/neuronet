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
  const s = String(qual || "").toLowerCase();
  if (!s) return null;
  if (s.includes("a level") || s === "alevel" || s === "a-level") return "alevel";
  if (s.includes("as ")) return "as";
  if (s.includes("gcse")) return "gcse";
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

// AQA publications live behind hashed CDN paths that cannot be constructed
// from a series name, so AQA requires catalogue discovery from the official
// archive. `discoverAqaSeries` is defined in subjects.js; it is injected here
// to keep the PDF-reading half of this module dependency-free.
let aqaDiscovery = null;

/** @param {(o:{year:number,series:string}) => Promise<Array<{url:string}>>} fn */
export function registerAqaDiscovery(fn) { aqaDiscovery = fn; }

async function aqaSeriesUrls(year, month) {
  if (typeof aqaDiscovery !== "function") return [];
  try {
    const found = await aqaDiscovery({ year, series: month });
    return (found || []).map((f) => f.url).filter(Boolean);
  } catch {
    return [];
  }
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

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function fetchBytes(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
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

// AQA's catalogue lists several PDFs per series. A genuine GCSE grade-boundary
// publication is recognised by its own contents: a "Subject grade boundaries"
// heading, or a dense set of four-digit specification codes each followed by a
// maximum mark. A maths-studies or ELC document has neither.
export function isGcseBoundaryDocument(lines) {
  const text = lines.join("\n");
  if (/Subject grade boundaries/i.test(text)) return true;
  let codes = 0;
  for (const line of lines) {
    if (/^\s*[0-9]{4}[HF]?\s+[A-Z][A-Z &'()-]{3,40}\s{2,}\d{2,4}\s+[\d\-\s]+$/.test(line)) codes++;
  }
  return codes >= 20;
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
  if (!key) return null;

  const cached = cachedBoundary(key);
  if (cached) return cached;

  const b = boardId(board);
  const month = monthId(series);
  const y = Number(year);
  const c = String(code).trim().toUpperCase();
  const t = tierId(tier);

  const bytes = await acquireSourceBytes(b, y, month, c, t);
  if (!bytes) return null;

  const lines = await pdfTextFromBytes(bytes);
  const parsed = b === "pearson"
    ? parsePearsonGcseRow(lines, c, t)
    : parseAqaGcseRow(lines, c, t);
  if (!parsed) return null;

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
    source: { publisher: b === "pearson" ? "Pearson Edexcel" : "AQA", verifiedAt: new Date().toISOString().slice(0, 10) }
  };

  storeBoundary(key, table);
  return table;
}

async function acquireSourceBytes(boardId_, year, month, code, tier) {
  if (boardId_ === "pearson") {
    const url = pearsonSeriesUrl(year, month);
    return url ? fetchBytes(url) : null;
  }
  if (boardId_ === "aqa") {
    // AQA's archive lists several PDFs per series (GCSE, Mathematical Studies,
    // ELC, AS, A-level) whose labels are easy to confuse, so the document that
    // is actually used is the one that yields the requested course. No
    // candidate is trusted on its filename or its card label.
    for (const url of await aqaSeriesUrls(year, month)) {
      const bytes = await fetchBytes(url);
      if (!bytes) continue;
      let lines;
      try { lines = await pdfTextFromBytes(bytes); } catch { continue; }
      if (!isGcseBoundaryDocument(lines)) continue;
      const probe = parseAqaGcseRow(lines, String(code).trim().toUpperCase(), tierId(tier));
      if (probe) return bytes;
    }
    return null;
  }
  return null;
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