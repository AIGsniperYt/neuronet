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

import { pdfTextFromBytes, fetchBytes, boardId, qualId, registerAqaDiscovery, isGcseBoundaryDocument, parseAqaGcseRow } from "./boundaries.js";

// subjects.js owns AQA series discovery, so boundaries.js can resolve the same
// PDF. Wiring it here keeps one discovery path rather than two.
registerAqaDiscovery(discoverAqaSeries);

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

export function clearSubjectCache() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// board publication endpoints
// ---------------------------------------------------------------------------

const PEARSON_GCSE_PDF = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries/GCSE/grade-boundaries-june-2025-gcse.pdf";

// AQA serves each series from hashed CDN paths that cannot be constructed, so
// AQA is reached by reading its grade-boundary pages. Two shapes are handled:
//
//   current page — each card is an <a href="....pdf" aria-label="GCSE - Grade
//                  boundaries June 2026">; the label names the series directly.
//   archive page — the series lives in a heading ("2024/25 exams", "June 2025
//                  exams") above cards whose own label is only "GCSE (164 KB)",
//                  so the nearest preceding text supplies the context.
//
// Nothing is hardcoded, and a series the board no longer publishes is simply
// not found rather than guessed at.
const AQA_BOUNDARIES_PAGES = [
  "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries",
  "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries/archive"
];

const MONTH_WORD = { JAN: "january", FEB: "february", MAR: "march", APR: "april", MAY: "may", JUN: "june", JUL: "july", AUG: "august", SEP: "september", OCT: "october", NOV: "november", DEC: "december" };

// Does this text identify the requested series? Handles both "June 2025" and
// the archive's academic-year heading "2024/25 exams".
function seriesMatches(text, year, series) {
  const month = MONTH_WORD[series] || String(series || "").toLowerCase();
  if (!month || !year) return false;
  const stem = month.slice(0, 4);
  if (new RegExp(`${stem}[^0-9]{0,12}${year}`, "i").test(text)) return true;
  const two = String(year).slice(2);
  return new RegExp(`\\b${String(year).slice(0, 4)}/${two}\\s+exams`, "i").test(text) &&
    new RegExp(stem, "i").test(text);
}

function qualFromLabel(label) {
  if (/Mathematical Studies|GCSE/i.test(label)) return "gcse";
  if (/A-level/i.test(label)) return "alevel";
  if (/(^|\s)AS(\s|$)/i.test(label)) return "as";
  if (/Functional Skills/i.test(label)) return "functional";
  return null;
}

/**
 * Every AQA grade-boundary PDF that could hold the requested series.
 *
 * The archive page nests three levels: an academic-year heading
 * ("2024/25 exams"), a series heading inside it ("June 2025 exams"), then one
 * card per qualification. A series is only collected from within its own
 * section, so a card from a neighbouring series can never be picked up. The
 * qualification is not guessed from the card label — the caller verifies the
 * document by parsing it, because a single series lists GCSE alongside
 * Mathematical Studies, ELC and AS, whose labels are easy to confuse.
 *
 * @returns {Promise<Array<{url,title,qual}>>}
 */
export async function discoverAqaSeries({ year = 2025, series = "JUN" } = {}) {
  const out = [];
  const seen = new Set();

  for (const page of AQA_BOUNDARIES_PAGES) {
    let clean = "";
    try {
      const res = await fetch(page, { cache: "no-store" });
      if (!res.ok) continue;
      // Inline SVG carries no useful text and would drown the labels.
      clean = (await res.text()).replace(/<svg[\s\S]*?<\/svg>/g, " ");
    } catch { continue; }

    // Tag every heading and every PDF card with its position, then walk the
    // document in order keeping the two most recent headings as context.
    const tokens = [];
    const headingRe = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|(\d{4}\/\d{2}\s+exams)|((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+exams)/gi;
    for (const m of clean.matchAll(headingRe)) {
      const raw = (m[1] || m[2] || m[3] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (raw) tokens.push({ at: m.index, kind: "heading", text: raw });
    }
    const cardRe = /<a\b([^>]*\.pdf[^>]*)>/gi;
    for (const m of clean.matchAll(cardRe)) {
      tokens.push({ at: m.index, kind: "card", attrs: m[1] });
    }
    tokens.sort((a, b) => a.at - b.at);

    let yearHeading = "";
    let seriesHeading = "";
    for (const t of tokens) {
      if (t.kind === "heading") {
        if (/^\d{4}\/\d{2}\s+exams$/i.test(t.text)) { yearHeading = t.text; seriesHeading = ""; }
        else if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+exams$/i.test(t.text)) {
          seriesHeading = t.text;
        }
        continue;
      }

      const href = /href=["']([^"']+\.pdf)["']/i.exec(t.attrs);
      if (!href) continue;
      if (seen.has(href[1])) continue;
      const aria = /aria-label=["']([^"']+)["']/i.exec(t.attrs);
      const label = aria ? aria[1].replace(/\s+/g, " ").trim() : "";

      // Two page shapes. The current page has no headings at all: every card
      // labels itself "GCSE - Grade boundaries June 2026". The archive puts the
      // series in a heading above cards labelled only "GCSE (164 KB)". So a
      // card qualifies when either its own label or its section heading names
      // the requested series.
      const ownMatches = label ? seriesMatches(label, year, series) : false;
      const sectionMatches = seriesHeading ? seriesMatches(seriesHeading, year, series) : false;
      if (!ownMatches && !sectionMatches) continue;

      seen.add(href[1]);
      out.push({
        url: href[1].startsWith("http") ? href[1] : `https://www.aqa.org.uk${href[1]}`,
        title: aria ? aria[1].replace(/\s+/g, " ").trim() : `${seriesHeading} (${yearHeading})`,
        qual: null
      });
    }
    if (out.length) break; // the live page wins; the archive is the fallback
  }
  return out;
}

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
  if (cache && cache.boards && cache.boards[board]) return cache.boards[board];

  let lines = null;

  if (board === "pearson") {
    const bytes = await fetchBytes(PEARSON_GCSE_PDF);
    if (bytes) lines = await pdfTextFromBytes(bytes);
  } else if (board === "aqa") {
    // A series lists several PDFs; use the one that is actually the GCSE
    // publication. Identified by its contents, never by its filename.
    for (const { url } of await discoverAqaSeries({ year, series })) {
      const bytes = await fetchBytes(url);
      if (!bytes) continue;
      let doc;
      try { doc = await pdfTextFromBytes(bytes); } catch { continue; }
      if (!isGcseBoundaryDocument(doc)) continue;
      // A real GCSE document carries recognisable spec rows; a maths-studies
      // or ELC one does not. Probe across tiers because a tiered subject will
      // not answer a tier-less request.
      const looksLikeGcse = ["8700", "8461", "8462"].some((c) =>
        parseAqaGcseRow(doc, c, null) || parseAqaGcseRow(doc, c, "H") || parseAqaGcseRow(doc, c, "F"));
      if (!looksLikeGcse) continue;
      lines = doc;
      break;
    }
  }

  if (!lines) return [];
  const list = board === "pearson" ? parsePearsonSubjects(lines) : parseAqaSubjects(lines);
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
  const cache = readCache();
  writeCache({ ...(cache && cache.boards), [b]: list });
  return list.map((s) => ({ ...s, id: `${s.board}|${s.qual}|${s.code}|${s.tier || "_"}` }));
}

/**
 * Official courses across several boards, merged and de-duplicated.
 */
export async function findAllSubjects({ boards = ["pearson", "aqa"], year = 2025 } = {}) {
  const results = await Promise.all(boards.map((b) => findSubjects({ board: b, year })));
  const seen = new Map();
  for (const s of results.flat()) if (s.id) seen.set(s.id, s);
  return [...seen.values()];
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
  if (!want.length) return [];

  const pool = catalogue.filter((s) => {
    if (board && s.board !== boardId(board)) return false;
    if (qual && s.qual !== qualId(qual)) return false;
    return true;
  });

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
  if (!top) return [];
  const tied = scored.filter((s) => s.score === top.score);
  return scored.map((s) => ({ ...s, ambiguous: tied.length > 1 && s.score === top.score }));
}

/**
 * The single best official course, or null when the evidence is ambiguous.
 * The tracker links a subject automatically ONLY when this returns a course.
 */
export function resolveSubject(catalogue, subjectName, opts = {}) {
  const ranked = matchSubjects(catalogue, subjectName, opts);
  if (!ranked.length) return null;
  const top = ranked.filter((s) => s.score === ranked[0].score);
  if (top.length !== 1) return { ambiguous: true, candidates: top };
  return { ambiguous: false, course: top[0] };
}