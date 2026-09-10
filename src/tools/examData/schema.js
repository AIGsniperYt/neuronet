// examData/schema.js — canonical identity model for the exam-data subsystem.
//
// Everything in the subsystem speaks in these records:
//   Course   (board, qualification, code, tier)
//   Series   (month, year)
//   Boundary (per course+series: grade marks, papers, provenance)
//   Paper    (component of a Boundary for a course+series)
//   Source   (provenance: official url / manual / inferred)
//
// This module is deliberately dependency-free so the core never imports the
// legacy gradeBoundaries module (there must be no cycle: gradeBoundaries wraps
// examData, never the other way).

export const BOARD_IDS = ["aqa", "ocr", "pearson"];
export const QUALIFICATION_IDS = ["gcse", "alevel", "as"];

// id from a board token; null when unrecognised.
export function boardId(board) {
  const b = String(board || "").trim().toLowerCase();
  if (b.includes("aqa")) return "aqa";
  if (b.includes("ocr")) return "ocr";
  if (b.includes("pearson") || b.includes("edexcel")) return "pearson";
  return null;
}

export function boardName(id) {
  return { aqa: "AQA", ocr: "OCR", pearson: "Edexcel" }[id] || String(id || "");
}

// Qualification id from a token; null when the qual is unrecognised or absent.
// Absence stays absent: a blank/unmapped qual must never silently become GCSE.
export function qualId(qual) {
  const q = String(qual || "").trim().toLowerCase();
  if (q.includes("gcse")) return "gcse";
  if (q.includes("a level") || q === "a-level" || q === "alevel") return "alevel";
  if (q === "as") return "as";
  return null;
}

export function qualName(id) {
  return { gcse: "GCSE", alevel: "A-Level", as: "AS" }[id] || String(id || "");
}

export function normalizeTitle(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function singleCode(code) {
  return String(code || "").replace(/\s+/g, "").toUpperCase();
}

export function baseCode(code) {
  return singleCode(code).replace(/[HF]$/, "");
}

// Tier of a course or boundary row. Authority order: explicit tier field, then
// title words, then a trailing H/F on the code (AQA stores "8300H"/"8300F").
export function tierOf(item) {
  if (!item) return null;
  const parsed = String(item.tier || "").trim().toUpperCase();
  if (parsed === "H" || parsed === "F") return parsed;
  const title = normalizeTitle(item.title || "");
  if (/\bhigher\b/.test(title)) return "H";
  if (/\bfoundation\b/.test(title)) return "F";
  const codeTier = /[HF]$/.test(singleCode(item.code || ""));
  if (codeTier) return singleCode(item.code).slice(-1);
  return null;
}

// Canonical course key: board:qual:code:tier (tier '_' when unknown).
// Tier derivation is title-aware on BOTH sides of identity: an enrollment
// named "Mathematics (Higher)" keys identically to a boundary row whose
// title/code carries the same tier — otherwise a stored sitting can never
// match its own fetched boundary table.
export function courseKey(course = {}) {
  const { board, qual, code } = course || {};
  const b = boardId(board);
  if (!b) return null;
  const q = qualId(qual);
  if (!q) return null; // a course without a known qualification cannot be keyed
  return `${b}:${q}:${singleCode(code)}:${tierOf(course) || "_"}`;
}

export function courseKeyFromRow(board, qual, row) {
  const b = boardId(board);
  if (!b) return null;
  const q = qualId(qual);
  if (!q) return null;
  return `${b}:${q}:${singleCode(row && row.code)}:${tierOf(row) || "_"}`;
}

export function parseCourseKey(key) {
  const m = /^([a-z]+):(gcse|alevel|as):([^:]*):([HF_])$/.exec(String(key || ""));
  if (!m) return null;
  return { board: m[1], qual: m[2], code: m[3] || null, tier: m[4] === "_" ? null : m[4] };
}

// Canonical series key used within the subsystem (storage-compatible with the
// legacy cache key suffix "MONTH-YEAR").
export function seriesId({ month, year } = {}) {
  const m = String(month || "").trim().toUpperCase();
  const y = Number(year);
  if (!m || !Number.isFinite(y)) return null;
  return `${m}-${y}`;
}

export function seriesKeyOf(board, qualId, series) {
  const id = seriesId(series);
  if (!id) return null;
  return `${board}:${id}:${qualId}`;
}

// Friendly label from a series word ("June 2025", "JUN-2025", "2025") or null.
const MONTH_WORDS = { JAN: "January", FEB: "February", MAR: "March", APR: "April", MAY: "May", JUN: "June", JUL: "July", AUG: "August", SEP: "September", OCT: "October", NOV: "November", DEC: "December" };
const MONTH_TO_ABBR = Object.freeze(Object.fromEntries(
  Object.entries(MONTH_WORDS).map(([abbr, name]) => [name.toLowerCase(), abbr])
));
const MONTH_TOKEN = /(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/;

export function monthFromWord(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  if (MONTH_TO_ABBR[w]) return MONTH_TO_ABBR[w];
  const token = w.match(MONTH_TOKEN);
  if (token) {
    const t = token[0];
    return MONTH_TO_ABBR[t] || t.slice(0, 3).toUpperCase();
  }
  return null;
}

export function seriesLabel(series) {
  if (!series) return null;
  if (series.label) return series.label;
  const m = MONTH_WORDS[String(series.month || "").toUpperCase()] || series.month;
  return series.year ? `${m} ${series.year}` : m;
}

// Current "now" for exam-year thinking: the year whose June series a student is
// most likely to be preparing for today's academic year (Sept→Aug). Used only
// for default candidate ordering, never for data correctness.
export function currentExamYear(now = Date.now()) {
  const d = new Date(now);
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

// Grade normalization: 9..1, U/u, A*..E, a*..e. Alphanumeric only.
export function canonicalGradeKey(value) {
  const s = String(value == null ? "" : value).replace(/\s+/g, "").toUpperCase();
  if (/^[9U]$/.test(s)) return s;
  if (/^[A-E]$/.test(s)) return s;
  if (/^\*?[A-E]$/.test(s)) return s.replace(/^\*/, "");
  if (/^A\*$/.test(s)) return "A*";
  return s;
}

// Validates a boundary row. Returns a list of problems (empty = valid).
export function validateBoundaryRow(row) {
  const problems = [];
  if (!row || typeof row.grades !== "object" || !Array.isArray(row.gradesInOrder)) {
    return ["missing grades or gradesInOrder"];
  }
  const values = [];
  for (const label of row.gradesInOrder) {
    const mark = Number(row.grades[label]);
    if (!Number.isFinite(mark)) {
      problems.push(`grade ${label}: mark not a number`);
      continue;
    }
    values.push(mark);
  }
  // GCSE numeric rows must be strictly descending 9→1.
  const numeric = row.gradesInOrder.filter((g) => /^[89]|[1-9]$/.test(String(g)));
  if (numeric.length >= 2) {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > values[i - 1]) problems.push(`marks not monotonic at ${row.gradesInOrder[i]}`);
    }
  }
  return problems;
}