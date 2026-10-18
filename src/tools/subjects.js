// subjects.js — the subject finder / link mechanism.
//
// The tracker lets a subject be informal ("Macbeth", "Maths", "Biology") —
// that is fine and always allowed. What this file provides is the ability to
// attach an informal subject to a real, official course, so boundaries can be
// fetched for it.
//
// Subjects are NOT hardcoded. They are read out of the same official board
// PDFs the boundaries come from, which means the catalogue is exactly as
// current and as complete as the board's own publication. A subject that stops
// being offered stops being listed; a new specification appears on its own.

import { pdfTextFromBytes, fetchBoardResource, boardId, qualId, parseAqaGcseRow, discoverAqaSeries } from "./boundaries.js";
import { diag } from "./diag.js";


const CACHE_KEY = "neuronet:subjectCatalogue";
const CACHE_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — catalogues move slowly

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function readCache() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (Date.now() - (parsed.fetchedAt || 0) > TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(boards) {
  const s = storage();
  if (!s) return;
  const existing = readCache();
  try {
    s.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      fetchedAt: Date.now(),
      boards: boards || (existing && existing.boards) || {}
    }));
  } catch { /* quota */ }
}

// ---------------------------------------------------------------------------
// board publication endpoints
// ---------------------------------------------------------------------------

const PEARSON_GCSE_PDF = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2025-gcse.pdf";

// ---------------------------------------------------------------------------
// row readers — pull the subject out of a boundary table row
// ---------------------------------------------------------------------------

const TITLE_BLOCK = /\s{2,}([A-Z][A-Za-z&'’()\- ]{3,60}?)\s{2,}(?:Subject|Overall)/;

function tidyTitle(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\b(TIER\s+[HF])\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Reads Pearson's catalogue rows:
//   1MA1  Mathematics (Higher)  Subject  240  217 ...
//   1CP2  Computer Science      Subject  150  124 ...
export function parsePearsonSubjects(lines) {
  const out = new Map();
  for (const line of lines) {
    const m = /^([0-9A-Z]{4,6})\s+(.+?)\s+(?:Subject|Overall)\b/i.exec(line);
    if (!m) continue;
    const code = m[1].toUpperCase();
    if (!/^[0-9][0-9A-Z]{2,5}$/.test(code)) continue;
    let title = m[2];
    let tier = null;
    const tm = /\((Higher|Foundation)\)/i.exec(title);
    if (tm) { tier = tm[1].toLowerCase() === "higher" ? "H" : "F"; title = title.replace(tm[0], ""); }
    const clean = tidyTitle(title);
    if (!clean) continue;
    const id = `${code}|${tier || "_"}`;
    if (!out.has(id)) out.set(id, { board: "pearson", qual: "gcse", code, tier, title: clean });
  }
  return [...out.values()];
}

// Reads AQA's catalogue rows:
//   8461H  BIOLOGY TIER H  200  141 ...
//   8700   ENGLISH LANGUAGE  160  119 ...
export function parseAqaSubjects(lines) {
  const out = new Map();
  // pdf.js reconstructs each row as single-spaced tokens, so column padding is
  // not available. Identity is "4-digit code, optional tier suffix, a title in
  // caps, then the maximum mark followed by marks" — and component rows are
  // excluded because they carry a "8461/1H"-style paper code and the word PAPER.
  const row = /^\s*([0-9]{4})([HF])?\s+([A-Z][A-Z0-9 &'()\-]{2,60}?)(?:\s+TIER\s+[HF])?\s+\d{2,4}\s+(?=[\d\-])/;
  for (const line of lines) {
    if (/\/\d+[A-Z]?\b/.test(line)) continue;   // component / notional table
    if (/\bPAPER\b/i.test(line)) continue;
    const m = row.exec(line);
    if (!m) continue;
    const code = m[1];
    const tier = m[2] || null;
    const title = tidyTitle(m[3].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));
    if (!title || /\/(Paper|Component)\b/i.test(line)) continue;
    const id = `${code}|${tier || "_"}`;
    if (!out.has(id)) out.set(id, { board: "aqa", qual: "gcse", code, tier, title });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

async function subjectsForBoard(board, { year = 2025, series = "JUN" } = {}) {
  const cache = readCache();
  if (cache && cache.boards && cache.boards[board]) {
    diag("C? ", "subjectsForBoard cache HIT", { board: board, count: cache.boards[board].length });
    return cache.boards[board];
  }
  diag("C? ", "subjectsForBoard cache MISS", { board: board, year: year, series: series });

  let lines = null;

  if (board === "pearson") {
    const bytes = await fetchBoardResource(PEARSON_GCSE_PDF);
    if (bytes) lines = await pdfTextFromBytes(bytes);
  } else if (board === "aqa") {
    // A series lists several PDFs and they are not distinguishable by heading,
    // so the GCSE publication is recognised the only reliable way: by parsing
    // it. A probe course is tried across tiers (a tiered subject will not answer
    // a tier-less request) and the document that carries it is the GCSE one.
    const PROBES = [["8461", "H"], ["8461", "F"], ["8700", null], ["8462", "H"]];
    const candidates = await discoverAqaSeries({ year, series });
    diag("C? ", "AQA subject discovery", { candidates: candidates.length });
    for (const { url } of candidates) {
      const bytes = await fetchBoardResource(url);
      if (!bytes) { diag("C? ", "AQA subject candidate fetch failed", { url: url.slice(0, 80) }); continue; }
      let doc;
      try { doc = await pdfTextFromBytes(bytes); } catch (e) { diag("C? ", "AQA subject candidate parse threw", { url: url.slice(0, 80), error: String(e && e.message) }); continue; }
      const matched = PROBES.some(([c, t]) => parseAqaGcseRow(doc, c, t));
      diag("C? ", "AQA subject candidate check", { url: url.slice(0, 80), matched: matched });
      if (!matched) continue;
      lines = doc;
      break;
    }
  }

  if (!lines) { diag("C? ", "subjectsForBoard: no document found", { board: board }); return []; }
  const list = board === "pearson" ? parsePearsonSubjects(lines) : parseAqaSubjects(lines);
  diag("C? ", "subjectsForBoard result", { board: board, count: list.length });
  list.sort((a, b) => a.code.localeCompare(b.code) || String(a.tier).localeCompare(String(b.tier)));
  return list;
}

/**
 * Every official course the board published boundaries for.
 * @returns {Promise<Array<{board,qual,code,tier,title,id}>>}
 */
export async function findSubjects({ board, year = 2025, series = "JUN" } = {}) {
  const b = boardId(board) || (board ? String(board).toLowerCase() : null);
  if (!b) return [];
  const list = await subjectsForBoard(b, { year, series });
  // Do not cache a failed fetch. Empty means the board was unreachable, not
  // that the board has no subjects — caching the failure would poison every
  // subsequent visit until the TTL expires.
  if (list.length > 0) {
    const cache = readCache();
    writeCache({ ...(cache && cache.boards), [b]: list });
  }
  return list.map((s) => ({ ...s, id: `${s.board}|${s.qual}|${s.code}|${s.tier || "_"}` }));
}

// ---------------------------------------------------------------------------
// matching an informal tracker subject to official courses
// ---------------------------------------------------------------------------

const NOISE = new Set(["gcse", "aqa", "pearson", "edexcel", "ocr", "higher", "foundation", "h", "f"]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t));
}

// Words that should not decide a match on their own — they are shared by many
// qualifications ("science", "english", "maths" variants).
const AMBIGUOUS = new Set(["science", "english", "maths", "mathematics", "studies", "general"]);

/**
 * Rank official courses against an informal subject name.
 * A tie is returned as a tie — the caller asks the user, never guesses.
 *
 * @returns {Array<{...subject, score, ambiguous}>}
 */
export function matchSubjects(catalogue, subjectName, { board, qual } = {}) {
  const want = tokenize(subjectName);
  diag("C? ", "matchSubjects", { subjectName: subjectName, want: want, catalogueSize: catalogue.length, board: board || null, qual: qual || null });
  if (!want.length) { diag("C? ", "matchSubjects: empty token list", { subjectName: subjectName }); return []; }

  const pool = catalogue.filter((s) => {
    if (board && s.board !== boardId(board)) return false;
    if (qual && s.qual !== qualId(qual)) return false;
    return true;
  });
  diag("C? ", "matchSubjects pool", { poolSize: pool.length });

  const scored = pool.map((s) => {
    const have = tokenize(s.title);
    let score = 0;
    const decisive = [];

    for (const t of want) {
      if (t.length < 3) continue;
      if (have.some((h) => h === t)) { score += 3; decisive.push(t); continue; }
      if (have.some((h) => h.startsWith(t) || t.startsWith(h))) { score += 2; decisive.push(t); continue; }
      if (have.some((h) => h.includes(t) && t.length >= 4)) { score += 1; decisive.push(t); }
    }

    // A subject name made only of ambiguous words matches nothing confidently.
    if (decisive.length === 0) score = 0;

    return { ...s, score, evidence: decisive };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score || String(a.tier).localeCompare(String(b.tier)));

  const top = scored[0];
  if (!top) { diag("C? ", "matchSubjects: no match", { subjectName: subjectName }); return []; }
  const tied = scored.filter((s) => s.score === top.score);
  const result = scored.map((s) => ({ ...s, ambiguous: tied.length > 1 && s.score === top.score }));
  diag("C? ", "matchSubjects result", { subjectName: subjectName, topScore: top.score, tiedCount: tied.length, results: result.slice(0, 5).map(function (s) { return { code: s.code, tier: s.tier, score: s.score, ambiguous: s.ambiguous }; }) });
  return result;
}

/**
 * The single best official course, or null when the evidence is ambiguous.
 * The tracker links a subject automatically ONLY when this returns a course.
 */
export function resolveSubject(catalogue, subjectName, opts = {}) {
  const ranked = matchSubjects(catalogue, subjectName, opts);
  if (!ranked.length) { diag("C? ", "resolveSubject: NULL (no match)", { subjectName: subjectName }); return null; }
  const top = ranked.filter((s) => s.score === ranked[0].score);
  if (top.length !== 1) {
    diag("C? ", "resolveSubject: AMBIGUOUS", { subjectName: subjectName, candidates: top.map(function (s) { return { code: s.code, tier: s.tier, score: s.score }; }) });
    return { ambiguous: true, candidates: top };
  }
  diag("C? ", "resolveSubject: resolved", { subjectName: subjectName, code: top[0].code, tier: top[0].tier, board: top[0].board });
  return { ambiguous: false, course: top[0] };
}

// Re-exported so callers have one obvious place to import discovery from.
export { discoverAqaSeries };
