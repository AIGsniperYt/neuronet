// Shared access to the isolated grade-boundary cache.
//
// The scraper tool writes fetched exam-board grade boundaries to a private
// localStorage key (neuronet:gradeBoundaries). This module is the single
// shared API for that cache so the tracker can link subjects to official
// courses and auto-fill grade boundary tables without re-fetching or manual
// typing, while the cache itself never enters the user's graph or JSON export.

import * as XLSX from "../vendor/xlsx/index.js";
import { extractPdfLayoutLines, parsePdfBoundaries } from "./pdfBoundaries.js";
import { buildExamIndex, openExamRepository, deriveBoundaryDecision } from "./examData/index.js";

export const BOUNDARY_CACHE_KEY = "neuronet:gradeBoundaries";
export const BOUNDARY_STATUS_KEY = "neuronet:boundaryStatus";
export const BOUNDARY_CACHE_VERSION = 2;

// How long a completed sweep stays "fresh" before we re-scan for new series
// (so the tracker's subject picker never fires a fetch set the first time it
// opens, but still picks up newly-released series every so often).
const SWEEP_FRESH_MS = 8 * 60 * 60 * 1000;
// Don't retry a series that just failed (dead legacy URLs) within this window —
// previously every open of the picker retried every dead series, stalling the
// modal on a full fetch pass each time.
const RETRY_WINDOW_MS = 60 * 60 * 1000;

const RESULTS_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days, results-day policy

// In-memory mirror of the persisted cache. The tracker/scraper query the cache
// on every render and write to it on every fetched series; parsing + re-
// stringifying the whole localStorage blob each time freezes the UI once the
// cache grows (opened picker animation stops). We therefore parse once and
// debounce persistence, only touching localStorage on the eventual write.
let memCache = null;
let persistTimer = null;

function freshCache() {
  return { version: BOUNDARY_CACHE_VERSION, entries: {} };
}

function persistNow() {
  const data = memCache || freshCache();
  try {
    localStorage.setItem(BOUNDARY_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* storage full/unavailable — degrade to memory-only */
  }
}

export function loadBoundaryCache() {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(BOUNDARY_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.version === BOUNDARY_CACHE_VERSION) {
        memCache = parsed;
        return memCache;
      }
    }
  } catch {
    /* corrupt/invalid — fall through to fresh */
  }
  memCache = freshCache();
  return memCache;
}

export function saveBoundaryCache(cache) {
  memCache = cache || memCache;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 300);
}

// Forces a synchronous persist (tool teardown / explicit sync points).
export function flushBoundaryCache() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

// Drop the in-memory mirror so the next read comes from localStorage — used by
// tools that learned (via the change bus below) that ANOTHER tab rewrote the
// cache. Never called from inside this module where the mirror is canonical.
export function reloadBoundaryCache() {
  memCache = null;
  return loadBoundaryCache();
}

// ---------- shared fetch status + cross-tool coordination ----------
// Every boundary fetch in the app funnels through this module, so there is ONE
// status blob every part of the app reads. The tracker's customise popover and
// subject picker subscribe and show "fetching… (waiting on the scraper)" live,
// instead of dead-ending with "no boundaries here — go use another tool".
// Status persists to localStorage and is broadcast to other tabs, so a fetch
// started in the scraper tab shows up in the tracker tab beside it.

let boundaryStatus = null;
let statusListeners = new Set();
let cacheListeners = new Set();
let statusChannel = null;
let cacheChannel = null;
let lastLocalStatusPost = 0;
let lastLocalCachePost = 0;

function defaultBoundaryStatus() {
  return {
    version: 1,
    phase: "idle", // idle | discovering | fetching | ready
    jobsTotal: 0,
    jobsDone: 0,
    jobsFailed: 0,
    current: null, // { board, qual, seriesLabel, message }
    sweepFinishedAt: null,
    attemptedFailed: {}, // sweep "key" -> last try ts (skip retries for RETRY_WINDOW)
    updatedAt: 0
  };
}

export function getBoundaryStatus() {
  if (boundaryStatus) {
    // Rehydrate if the stored copy changed since we last read it (another tab,
    // a devtools edit, a cache reset) — keeps this in-sync cache authoritative.
    try {
      const stored = localStorage.getItem(BOUNDARY_STATUS_KEY);
      if (stored !== null && stored !== JSON.stringify(boundaryStatus)) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.version === 1) boundaryStatus = parsed;
      }
    } catch {
      /* keep in-memory copy */
    }
    return boundaryStatus;
  }
  try {
    const raw = JSON.parse(localStorage.getItem(BOUNDARY_STATUS_KEY) || "null");
    if (raw && raw.version === 1) boundaryStatus = raw;
  } catch {
    /* none */
  }
  return boundaryStatus || defaultBoundaryStatus();
}

function publishBoundaryStatus(patch) {
  const prev = getBoundaryStatus();
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  // Skip when nothing the app actually reacts to changed (identical phase,
  // counters, current job, attempts) — otherwise a long sweep resprays
  // localStorage and re-fires every listener for every sub-message.
  try {
    const { updatedAt: a, ...prevRest } = prev;
    const { updatedAt: b, ...nextRest } = next;
    if (JSON.stringify(prevRest) === JSON.stringify(nextRest)) return;
  } catch {
    /* keep publishing on any doubt */
  }
  boundaryStatus = next;
  try {
    localStorage.setItem(BOUNDARY_STATUS_KEY, JSON.stringify(next));
  } catch {
    /* degrade to memory-only */
  }
  const postId = Date.now();
  lastLocalStatusPost = postId;
  for (const fn of statusListeners) {
    try { fn(next); } catch { /* listener fault */ }
  }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      if (!statusChannel) statusChannel = new BroadcastChannel("neuronet:boundaryStatus");
      statusChannel.postMessage({ ...next, _origin: postId });
    } catch { /* unavailable */ }
  }
}

// Subscribe to boundary status. The callback fires immediately with the current
// status and then on every change (local OR from another tab via BroadcastChannel /
// a storage event when the channel is unavailable). Returns an unsubscribe fn.
export function subscribeBoundaryStatus(fn) {
  statusListeners.add(fn);
  try { fn(getBoundaryStatus()); } catch { /* ignore */ }
  return () => statusListeners.delete(fn);
}

// Fired whenever a series is written into the cache (local or other tab) so
// UI that renders from the cache can refresh live. Same shape as the status bus.
function publishBoundaryCacheChanged() {
  const postId = Date.now();
  lastLocalCachePost = postId;
  for (const fn of cacheListeners) {
    try { fn(); } catch { /* listener fault */ }
  }
  const hasChannel = typeof BroadcastChannel !== "undefined";
  if (hasChannel) {
    try {
      if (!cacheChannel) cacheChannel = new BroadcastChannel("neuronet:boundaryCache");
      cacheChannel.postMessage({ at: postId, origin: postId });
    } catch {
      /* fall through to the storage tick below */
      localStorage.setItem(`${BOUNDARY_CACHE_KEY}_tick`, String(postId));
    }
  } else {
    localStorage.setItem(`${BOUNDARY_CACHE_KEY}_tick`, String(postId));
  }
}

export function subscribeBoundaryCacheChanged(fn) {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

// Wire the cross-tab channel when running in a browser.
if (typeof window !== "undefined") {
  if (typeof BroadcastChannel !== "undefined") {
    try {
      statusChannel = new BroadcastChannel("neuronet:boundaryStatus");
      statusChannel.onmessage = (ev) => {
        if (!ev.data) return;
        if (ev.data._origin && ev.data._origin === lastLocalStatusPost) return; // own echo
        boundaryStatus = { ...defaultBoundaryStatus(), ...ev.data };
        for (const fn of statusListeners) { try { fn(boundaryStatus); } catch { /* ignore */ } }
      };
      cacheChannel = new BroadcastChannel("neuronet:boundaryCache");
      cacheChannel.onmessage = (ev) => {
        if (!ev.data) return;
        if (ev.data.origin && ev.data.origin === lastLocalCachePost) return; // own echo
        for (const fn of cacheListeners) { try { fn(); } catch { /* ignore */ } }
      };
    } catch {
      /* channel unavailable — fall back to storage events below */
    }
  } else {
    window.addEventListener("storage", (e) => {
      if (e.key === BOUNDARY_STATUS_KEY && e.newValue) {
        try {
          boundaryStatus = JSON.parse(e.newValue);
          for (const fn of statusListeners) { try { fn(boundaryStatus); } catch { /* ignore */ } }
        } catch { /* ignore */ }
      }
      if (e.key === `${BOUNDARY_CACHE_KEY}_tick`) {
        try { localStorage.setItem(`${BOUNDARY_CACHE_KEY}_tick`, String(Date.now())); } catch { /* ignore */ }
        for (const fn of cacheListeners) { try { fn(); } catch { /* ignore */ } }
      }
    });
  }
}

// Mutable cache handle used by the scraper. Keeps the raw entry lookup + the
// results-day staleness policy in one place, shared with the tracker.
export function createBoundaryCacheStore() {
  let cache = loadBoundaryCache();
  const key = (board, qualId, series) =>
    `${String(board).toLowerCase()}:${series.month}-${series.year}:${qualId}`;
  return {
    reload() { cache = loadBoundaryCache(); },
    getEntry(board, qualId, series) {
      return cache.entries[key(board, qualId, series)] || null;
    },
    getCachedSubjects(board, qualId, series) {
      const entry = cache.entries[key(board, qualId, series)];
      if (!entry) return null;
      if (Date.now() - (entry.fetchedAt || 0) > RESULTS_WINDOW_MS) return null;
      return entry.subjects || null;
    },
    setCachedSubjects(board, qualId, series, subjects) {
      cache.entries[key(board, qualId, series)] = {
        series: { month: series.month, year: series.year, label: series.label },
        qual: qualId,
        board: String(board).toLowerCase(),
        fetchedAt: Date.now(),
        subjects
      };
      saveBoundaryCache(cache);
    }
  };
}

const BOARD_IDS = { aqa: "AQA", ocr: "OCR", pearson: "Pearson (Edexcel)" };
const QUAL_IDS = { gcse: "GCSE", alevel: "A-Level", as: "AS" };

export function boardToId(board) {
  const b = String(board || "").trim().toLowerCase();
  if (b.includes("aqa")) return "aqa";
  if (b.includes("ocr")) return "ocr";
  if (b.includes("pearson") || b.includes("edexcel")) return "pearson";
  return null;
}

export function boardIdToName(id) {
  return BOARD_IDS[String(id).toLowerCase()] || String(id);
}

export function qualToId(qual) {
  const q = String(qual || "").trim().toLowerCase();
  if (q.includes("gcse")) return "gcse";
  if (q.includes("a-level") || q.includes("a level") || q.includes("alevel")) return "alevel";
  if (q === "as" || q === "a/s") return "as";
  return null;
}

export function qualIdToName(id) {
  return QUAL_IDS[String(id).toLowerCase()] || String(id);
}

// Tracker series words -> exam-board month code (cache entries are stored by
// month-year, e.g. "JUN-2025"). Mock/Specimen/blank carry no month.
const SERIES_MONTHS = {
  june: "JUN", january: "JAN",
  november: "NOV", march: "MAR", may: "MAY", october: "OCT"
};

export function trackerSeriesToMonth(seriesWord) {
  if (!seriesWord) return null;
  return SERIES_MONTHS[String(seriesWord).trim().toLowerCase()] || null;
}

export function normalizeTitle(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function baseCourseCode(code) {
  return singleCode(code).toUpperCase().replace(/[FH]$/, "");
}

// Tier is the ONE place all tools learn a course's tier from. Order of
// authority: the explicit parsed `tier` field the board parsers emit
// (OCR/Pearson), then the title words, then a trailing H/F on the code
// (AQA xlsx stores "8300F"/"8300H"). Everything funnels through this.
function courseTierOf(item) {
  if (!item) return null;
  const parsed = String(item.tier || "").trim().toUpperCase();
  if (parsed === "H" || parsed === "F") return parsed;
  const t = String(item.title || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t)) return "F";
  const code = String(item.code || "").toUpperCase().trim();
  if (/H$/.test(code)) return "H";
  if (/F$/.test(code)) return "F";
  return null;
}

// Best-guess tier from a free-text subject name (e.g. "Maths (Higher)").
export function tierFromName(name) {
  const t = String(name || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t)) return "F";
  return null;
}

function findSubjectInEntry(entry, course) {
  const title = normalizeTitle(course.title);
  const code = singleCode(course.code).toUpperCase();
  const baseCode = baseCourseCode(course.code);
  const subjects = entry.subjects || [];
  // Exact-code match: when both tiers share a code (e.g. Pearson 1MA1, OCR
  // J560), keep the tier implied by the course title/code. A tier-unknown
  // course prefers the Higher row so a bare "1MA1" link maps to 9-1, never
  // silently to the alphabetically-first Foundation row.
  const codeMatches = subjects.filter((item) =>
    code && singleCode(item.code).toUpperCase() === code
  );
  if (codeMatches.length) {
    if (codeMatches.length > 1) {
      const want = courseTierOf(course);
      if (want) {
        const same = codeMatches.filter((item) => courseTierOf(item) === want);
        if (same.length === 1) return same[0];
        return null; // explicit tier the cache doesn't carry — don't guess
      }
      const higher = codeMatches.filter((item) => courseTierOf(item) === "H");
      if (higher.length === 1) return higher[0];
    }
    return codeMatches[0];
  }
  for (const item of subjects) {
    if (title && normalizeTitle(item.title) === title) return item;
  }
  if (code) {
    const tiered = subjects.filter((item) =>
      baseCourseCode(item.code) === baseCode ||
      (title && normalizeTitle(item.title).replace(/\s+tier\s+[fh]$/i, "") === title)
    );
    if (tiered.length) {
      // Prefer a tier that matches the course title/code, then Higher.
      const want = courseTierOf(course);
      if (want) {
        const same = tiered.filter((item) => courseTierOf(item) === want);
        if (same.length) return same[0];
      }
      tiered.sort((a, b) => {
        const aHigher = courseTierOf(a) === "H";
        const bHigher = courseTierOf(b) === "H";
        return Number(bHigher) - Number(aHigher);
      });
      return tiered[0];
    }
  }
  return null;
}

export function listCachedCourses(cache) {
  const out = [];
  const seen = new Set();
  for (const entry of Object.values((cache && cache.entries) || {})) {
    const boardId = String(entry.board || "").toLowerCase();
    const qualId = String(entry.qual || "").toLowerCase();
    if (!BOARD_IDS[boardId]) continue;
    if (!QUAL_IDS[qualId]) continue;
    for (const item of entry.subjects || []) {
      const code = singleCode(item.code);
      const tier = courseTierOf(item) || "";
      const key = `${boardId}:${qualId}:${code}:${tier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        board: boardId,
        boardName: BOARD_IDS[boardId],
        qual: qualId,
        qualName: QUAL_IDS[qualId],
        code,
        tier,
        title: item.title,
        maxMark: item.maxMark,
        papers: Array.isArray(item.papers) && item.papers.length ? item.papers : null
      });
    }
  }
  return out.sort((a, b) =>
    a.boardName.localeCompare(b.boardName) ||
    a.qual.localeCompare(b.qual) ||
    (a.title || "").localeCompare(b.title || "")
  );
}

// High-confidence single match used to tentatively auto-link a subject node
// from its existing free-text exam board + qualification. Returns the course
// only when exactly one distinct cached course matches, else null.
export function matchOfficialCourse(cache, { board, qual, title, code } = {}) {
  const b = boardToId(board);
  const q = qualToId(qual);
  if (!b || !q) return null;
  const normTitle = normalizeTitle(title);
  const normCode = singleCode(code);
  const matches = listCachedCourses(cache).filter((c) => {
    if (c.board !== b || c.qual !== q) return false;
    if (normCode && singleCode(c.code) === normCode) return true;
    // Bare code (8300) must find its tier-suffixed cached rows (8300F/8300H).
    if (normCode && baseCourseCode(c.code) === baseCourseCode(normCode) && singleCode(c.code) !== normCode) return true;
    if (normTitle && c.title && normalizeTitle(c.title) === normTitle) return true;
    return false;
  });
  if (matches.length === 1) return matches[0];
  // Multiple same-code rows (e.g. Foundation + Higher): prefer the tier named
  // by the title; otherwise prefer the Higher row (9-1) instead of treating
  // the query as ambiguous — Foundation-only matches still survive below.
  if (matches.length > 1 && normTitle) {
    const tiered = matches.filter((c) => normalizeTitle(c.title) === normTitle);
    if (tiered.length === 1) return tiered[0];
  }
  if (matches.length > 1) {
    const higher = matches.filter((c) => courseTierOf(c) === "H");
    if (higher.length === 1) return higher[0];
  }
  return null;
}

// ---- Tolerant course resolution ---------------------------------------------
//
// Cached titles boards publish ("Mathematics (Higher)", "Geography B (incl.
// fieldwork)", "English Literature") rarely match the short subject names users
// type ("Maths", "Geography", "English Lit"), so exact-title matching silently
// returns null and the whole pipeline (auto-warm, chips, boundary badge) dead-
// ends. This resolver matches on normalized word tokens with subject aliases and
// prefix tolerance, narrows to the subject's known board/qual/code when present,
// and returns the single best cached course. Tier-unknown subjects prefer the
// Higher row so a bare "Maths"/"1MA1" resolves to 9-1, never to Foundation.
const SUBJECT_TITLE_ALIASES = {
  math: "mathematics", maths: "mathematics",
  bio: "biology", chem: "chemistry",
  geog: "geography",
  lang: "language", lit: "literature",
  psych: "psychology", stats: "statistics",
  phys: "physics", compsci: "computer science"
};
const COURSE_EXCLUDE = /\b(international|award|legacy|notional|bt|btec|functional skills|project|level 3|level2|certificate|extended certificate|mathematics in context|in context)\b/i;

export function titleTokens(text) {
  return String(text || "").toLowerCase()
    .normalize("NFKC")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0 && /^[a-z0-9]+$/.test(t));
}

function tokenAlias(token) {
  return SUBJECT_TITLE_ALIASES[token] || token;
}

function titleTokensMatch(subjectToken, courseToken) {
  if (subjectToken === courseToken) return true;
  const a = tokenAlias(subjectToken);
  const b = tokenAlias(courseToken);
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

// Tier preference rank for a candidate given the query. This is an IDENTITY
// preference (a "higher" in the typed name), never a cache-richness signal.
function tierPreference(c, wantTier) {
  if (wantTier) return (c.tier || null) === wantTier ? 0 : 1;
  if (!c.tier) return 2;
  return c.tier === "H" ? 0 : 1;
}

// Raw identity scoring of every cached course against a query. The comparator
// uses ONLY identity signals (title/code matching, requested tier) with a
// deterministic board tiebreak for DISPLAY ordering. Cache data volume,
// fetch recency, paper-list presence and title length NEVER participate in
// identity — so a richer cache can never make one candidate "more true".
export function scoreCourseCandidates(cache, { board, qual, title, code, tier } = {}) {
  if (!cache || !title) return [];
  const wantBoard = boardToId(board);
  const wantQual = qualToId(qual);
  const normCode = singleCode(code).trim().toUpperCase();
  const wantTier = tier === "H" || tier === "F" ? tier : null;
  const excludeMe = COURSE_EXCLUDE.test(String(title || ""));
  const subjectTokens = titleTokens(String(title));
  const tierRank = (t) => (t === "H" ? 0 : t === "F" ? 2 : 1);
  if (subjectTokens.length === 0) return [];

  const scored = [];
  for (const c of listCachedCourses(cache)) {
    if (wantBoard && c.board !== wantBoard) continue;
    if (wantQual && c.qual !== wantQual) continue;
    const cTitle = String(c.title || "");
    const cCode = singleCode(c.code).toUpperCase();
    if (normCode) {
      if (cCode !== normCode && baseCourseCode(c.code) !== baseCourseCode(normCode)) continue;
      scored.push({ c, score: 100, exact: true });
      continue;
    }
    if (!cTitle) continue;
    if (!excludeMe && COURSE_EXCLUDE.test(cTitle)) continue;
    if (wantQual === "gcse" && /\b(al[\s-]?level)\b/i.test(cTitle)) continue;
    const courseTokens = titleTokens(cTitle);
    if (courseTokens.length === 0) continue;
    const missing = subjectTokens.filter((st) => !courseTokens.some((ct) => titleTokensMatch(st, ct)));
    if (missing.length) continue; // every typed word must be accounted for
    const courseMatched = courseTokens.filter((ct) => subjectTokens.some((st) => titleTokensMatch(st, ct))).length;
    const exact = courseTokens.length === subjectTokens.length && missing.length === 0 && courseTokens.every((ct, i) => titleTokensMatch(subjectTokens[i], ct));
    const ratio = courseMatched / Math.max(subjectTokens.length, courseTokens.length);
    scored.push({ c, score: (exact ? 3 : 0) + ratio, exact });
  }

  return scored
    .map((s) => ({ ...s, tpref: tierPreference(s.c, wantTier), tierRank: tierRank(s.c.tier) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.tpref !== b.tpref) return a.tpref - b.tpref;
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      return String(a.c.board).localeCompare(String(b.c.board));
    });
}

// Full candidate list for a query, identity-ordered. This is what an
// ambiguous picker surfaces (board-grouped in the tracker); it is NOT a
// resolution.
export function listCourseCandidates(cache, query) {
  return scoreCourseCandidates(cache, query).map((s) => s.c);
}

export function resolveTrackedCourse(cache, query = {}) {
  const scored = scoreCourseCandidates(cache, query);
  if (scored.length === 0) return null;
  const top = scored[0];
  // The identity class = everything tied on identity score AND tier preference.
  // Any tie inside it is REAL ambiguity (e.g. "Geography" across boards).
  // Resolving by cache data at this point would violate the honesty rule, so
  // we never do; callers present the candidates instead.
  const group = scored.filter((s) => s.score === top.score && s.tpref === top.tpref);
  if (group.length > 1) {
    return { ambiguous: true, candidates: group.map((s) => s.c) };
  }
  return top.c;
}

// Reconcile a stored officialCourse (possibly stale / tier-less / pre-picker-fix)
// against the live cache so a linked subject always resolves to the exact row
// the cache actually carries for its board+qual+code.
//
// A stored explicit selection is authoritative: the user confirmed this course,
// so we must NOT silently flip its tier. Authority order is:
//   1. the subject's own tier (from its name, e.g. "Maths (Higher)"), then
//   2. the stored course's own explicit tier (a real Foundation link stays
//      Foundation — even when a Higher row is also cached for the shared code),
//   3. the Higher row ONLY when the stored link is genuinely tier-less (legacy
//      pre-picker links stored the alphabetically-first row, so a bare shared
//      code maps to the 9-1 table, never silently to Foundation),
//   4. the only cached row.
// A stored tier the cache cannot satisfy returns null (surface candidates)
// instead of guessing. Returns null only when the linked course can't be
// found anywhere in the cache.
export function reconcileCourse(cache, course, preferredTier) {
  if (!course || !cache) return null;
  const b = boardToId(course.board);
  const q = qualToId(course.qual);
  if (!b || !q) return null;
  const normCode = singleCode(course.code).toUpperCase();
  if (!normCode) return null;
  const normBase = baseCourseCode(course.code);
  const rows = [];
  for (const entry of Object.values((cache && cache.entries) || {})) {
    if (boardToId(entry.board) !== b) continue;
    if (qualToId(entry.qual) !== q) continue;
    for (const item of entry.subjects || []) {
      const code = String(item.code || "").toUpperCase();
      const base = baseCourseCode(item.code);
      // Match either the stored code exactly (8300F) or its tier-stripped base
      // (8300), so a suffix-carrying stored link finds both shared tiers.
      if (code === normCode || base === normBase || base === normCode || code === normBase) rows.push(item);
    }
  }
  if (rows.length === 0) return null;
  // Surface the tier on the chosen row; tags rows that are genuinely tiered
  // (vs tier-less series like legacy AQA) so downstream discrete maths works.
  const toCourse = (pick, tier) => ({
    board: b, qual: q, code: singleCode(pick.code), tier: tier || "",
    title: pick.title, maxMark: pick.maxMark,
    papers: Array.isArray(pick.papers) && pick.papers.length ? pick.papers : null
  });
  const uni = (rows.length === 1) || !rows.some((item) => courseTierOf(item));
  if (preferredTier) {
    const same = rows.filter((item) => courseTierOf(item) === preferredTier);
    if (same.length) return toCourse(same[0], preferredTier);
    if (!uni) return null; // asked for a tier this series doesn't carry
  } else {
    const storedTier = courseTierOf(course);
    if (storedTier) {
      const same = rows.filter((item) => courseTierOf(item) === storedTier);
      if (same.length) return toCourse(same[0], storedTier);
      if (!uni) return null; // stored tier the cache doesn't satisfy — surface
    } else if (!uni) {
      // genuinely tier-less stored link on a shared code: map to the 9-1 table
      const higher = rows.filter((item) => courseTierOf(item) === "H");
      if (higher.length) return toCourse(higher[0], "H");
    }
  }
  return toCourse(rows[0], courseTierOf(rows[0]));
}

function numberEq(v) {
  // null/undefined/empty are "no value", NOT 0 — Number(null) coerces to 0
  // which would turn an undated lookup into a phantom year-0 lookup that can
  // never match any cached series.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seriesProximity(series, year, monthAbbr) {
  const y = numberEq(year);
  if (y === null || series == null || series.year == null) return { d: 0, exactYear: false, exactMonth: false };
  const d = Math.abs(Number(series.year) - y);
  const sameMonth = monthAbbr ? String(series.month || "").trim().toUpperCase() === monthAbbr : true;
  return { d, exactYear: d === 0, exactMonth: sameMonth };
}

// Resolve the per-grade boundary table for a linked official course and a
// tracker sitting (year + series word). Dated sittings only use cached data
// from the same year; within that year, the requested month wins.
// Undated lookups may use the most recently fetched matching series.
// Returns { subject, series, boardId, qualId, fresh } or null.
export function findGradeTable(cache, course, year, seriesWord) {
  const boardId = boardToId(course && course.board);
  const qualId = qualToId(course && course.qual);
  if (!boardId || !qualId) return null;
  const monthAbbr = trackerSeriesToMonth(seriesWord);
  const requestedYear = numberEq(year);
  const candidates = [];
  for (const entry of Object.values((cache && cache.entries) || {})) {
    if (boardToId(entry.board) !== boardId) continue;
    if (qualToId(entry.qual) !== qualId) continue;
    const subject = findSubjectInEntry(entry, course);
    if (!subject) continue;
    const p = seriesProximity(entry.series, year, monthAbbr);
    if (requestedYear !== null && !p.exactYear) continue;
    candidates.push({
      subject,
      series: entry.series || null,
      fetchedAt: entry.fetchedAt || 0,
      prox: p
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  // Prefer the sitting's exact year+month, then another series in that year.
  candidates.sort((a, b) => {
    const ea = a.prox.exactYear && a.prox.exactMonth;
    const eb = b.prox.exactYear && b.prox.exactMonth;
    if (ea !== eb) return ea ? -1 : 1;
    if (a.prox.exactYear !== b.prox.exactYear) return a.prox.exactYear ? -1 : 1;
    if (a.prox.d !== b.prox.d) return a.prox.d - b.prox.d;
    if (a.prox.exactMonth !== b.prox.exactMonth) return a.prox.exactMonth ? -1 : 1;
    // Undated (subject-level / any-year) lookups: newest EXAM year first, so a
    // stale fetch order or equal timestamps can never make 2024 win over 2025.
    // Dated lookups are already year-exact and skip this.
    if (requestedYear === null) {
      const ya = Number(a.series && a.series.year) || 0;
      const yb = Number(b.series && b.series.year) || 0;
      if (ya !== yb) return yb - ya;
    }
    const aMain = !monthAbbr && String(a.series && a.series.month || "").toUpperCase() === "JUN";
    const bMain = !monthAbbr && String(b.series && b.series.month || "").toUpperCase() === "JUN";
    if (aMain !== bMain) return aMain ? -1 : 1;
    return b.fetchedAt - a.fetchedAt;
  });
  const best = candidates[0];
  return {
    subject: best.subject,
    series: best.series,
    boardId,
    qualId,
    fresh: Date.now() - best.fetchedAt <= RESULTS_WINDOW_MS
  };
}

export function singleCode(code) {
  return String(code || "").trim();
}

export function canonicalGradeKey(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const stripped = text.replace(/^grade\s+/i, "").trim();
  const compact = stripped.replace(/\s+/g, " ");
  const upper = compact.toUpperCase();
  return upper === "A*" ? "A*" : upper;
}

export function normalizeBoundaryTable(table) {
  if (!table || typeof table !== "object") return null;
  const rawGrades = table.grades && typeof table.grades === "object" ? table.grades : {};
  const rawOrder = Array.isArray(table.gradesInOrder) && table.gradesInOrder.length
    ? table.gradesInOrder
    : Object.keys(rawGrades);
  const grades = {};
  const gradesInOrder = [];
  const seen = new Set();

  const candidateValue = (label, fallbackKey) => {
    if (rawGrades[label] != null) return rawGrades[label];
    if (fallbackKey && rawGrades[fallbackKey] != null) return rawGrades[fallbackKey];
    const keys = Object.keys(rawGrades);
    for (const key of keys) {
      if (canonicalGradeKey(key) === canonicalGradeKey(label)) return rawGrades[key];
    }
    return undefined;
  };

  for (const rawLabel of rawOrder) {
    const normLabel = canonicalGradeKey(rawLabel);
    if (!normLabel || seen.has(normLabel)) continue;
    const mark = candidateValue(rawLabel, normLabel);
    const numeric = Number(mark);
    if (!Number.isFinite(numeric)) continue;
    seen.add(normLabel);
    grades[normLabel] = numeric;
    gradesInOrder.push(normLabel);
  }

  if (!gradesInOrder.length && Object.keys(rawGrades).length) {
    for (const [key, mark] of Object.entries(rawGrades)) {
      const normLabel = canonicalGradeKey(key);
      if (!normLabel || seen.has(normLabel)) continue;
      const numeric = Number(mark);
      if (!Number.isFinite(numeric)) continue;
      seen.add(normLabel);
      grades[normLabel] = numeric;
      gradesInOrder.push(normLabel);
    }
  }

  return { ...table, grades, gradesInOrder };
}

export function findGradeMark(table, label) {
  const normalized = normalizeBoundaryTable(table);
  if (!normalized || !normalized.grades || typeof normalized.grades !== "object") return null;
  const wanted = canonicalGradeKey(label);
  if (!wanted) return null;

  const ordered = Array.isArray(normalized.gradesInOrder) ? normalized.gradesInOrder : Object.keys(normalized.grades);
  for (const candidate of ordered) {
    if (canonicalGradeKey(candidate) === wanted) return Number(normalized.grades[candidate]);
  }

  for (const [key, value] of Object.entries(normalized.grades)) {
    if (canonicalGradeKey(key) === wanted) return Number(value);
  }

  return null;
}


// THE single derived decision for the tracker boundary column and the subject
// grade chip. A sitting never owns an official boundary; the canonical exam-data
// repository decides what is truthful here and renderers consume the envelope
// verbatim. This is the zero-fabrication contract — no other code path may
// decide a boundary value for display. The envelope is produced by
// examData/repository.js over the canonical index built from the legacy cache
// (see docs/EXAMDATA.md phase A/B); this export is the compatibility wrapper.
export function resolveBoundaryDecision(cache, course, year, seriesWord, sitting = {}) {
  const index = buildExamIndex(cache || {});
  const repo = openExamRepository(index);
  return deriveBoundaryDecision(repo, course, year, seriesWord, sitting || {});
}

// Union of canonical grade labels for a course across EVERY cached series for
// that board+qual — so the target-grade picker reflects all usable data, not
// just whichever series is "most recent". Only labels that actually carry a
// mark in the tier's row are included (AQA Foundation rows list 9..1 in the
// header but only hold 5..1 marks, so an F course must NOT offer 9-6 chips).
// Sorted numeric-desc, then letters.
export function courseGradeLabels(cache, course) {
  const boardId = boardToId(course && course.board);
  const qualId = qualToId(course && course.qual);
  if (!boardId || !qualId) return [];
  const labels = [];
  const seen = new Set();
  const push = (subject) => {
    const marks = subject.grades && typeof subject.grades === "object" ? subject.grades : {};
    const order = Array.isArray(subject.gradesInOrder) && subject.gradesInOrder.length
      ? subject.gradesInOrder
      : Object.keys(marks);
    for (const value of order) {
      const key = canonicalGradeKey(value);
      if (!key || key === "U" || seen.has(key)) continue;
      const present =
        marks[value] != null || marks[key] != null ||
        Object.keys(marks).some((k) => canonicalGradeKey(k) === key);
      if (!present) continue;
      seen.add(key);
      labels.push(key);
    }
  };
  for (const entry of Object.values((cache && cache.entries) || {})) {
    if (String(entry.board || "").toLowerCase() !== boardId) continue;
    if (String(entry.qual || "").toLowerCase() !== qualId) continue;
    const subject = findSubjectInEntry(entry, course);
    if (!subject) continue;
    push(subject);
  }
  labels.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return a.localeCompare(b);
  });
  return labels;
}

// Every cached series that actually resolves a row for this course, newest
// exam year first (then freshest fetch). The customise preview renders one
// threshold group per series through the SAME per-year lookups the rows use,
// so the numbers shown are faithful to the pack that year instead of one
// arbitrary any-year table repeated for all years.
export function courseBoundarySeries(cache, course) {
  const boardId = boardToId(course && course.board);
  const qualId = qualToId(course && course.qual);
  if (!boardId || !qualId) return [];
  const out = [];
  for (const entry of Object.values((cache && cache.entries) || {})) {
    if (boardToId(entry.board) !== boardId) continue;
    if (qualToId(entry.qual) !== qualId) continue;
    const subject = findSubjectInEntry(entry, course);
    if (!subject) continue;
    out.push({ series: entry.series || null, fetchedAt: Number(entry.fetchedAt) || 0, subject });
  }
  out.sort((a, b) => {
    const ya = Number(a.series && a.series.year) || 0;
    const yb = Number(b.series && b.series.year) || 0;
    if (ya !== yb) return yb - ya;
    if (a.fetchedAt !== b.fetchedAt) return b.fetchedAt - a.fetchedAt;
    const ma = String(a.series && a.series.month || "").toUpperCase();
    const mb = String(b.series && b.series.month || "").toUpperCase();
    return mb.localeCompare(ma);
  });
  return out;
}

// Convert a raw total score to a grade label with a boundary table, e.g.
// grades: { "9": 132, ... }, gradesInOrder: ["9","8",...,"U"].
export function scoreToGrade(grades, gradesInOrder, score) {
  const s = numberEq(score);
  const table = normalizeBoundaryTable({ grades: grades || {}, gradesInOrder: gradesInOrder || [] });
  if (s === null || !table || !table.gradesInOrder.length) return null;
  for (const g of table.gradesInOrder) {
    const mark = table.grades && table.grades[g];
    if (Number.isFinite(mark) && s >= mark) return g;
  }
  return table.gradesInOrder[table.gradesInOrder.length - 1];
}

// ============================================================================
// Boundary fetch engine (headless, DOM-free, shared by scraper + tracker).
// Given a board / qual / series it discovers the file URL, downloads + parses
// the workbook/PDF, and writes the subjects into the boundary cache under the
// canonical board:MONTH-YEAR:qual key. The tracker calls ensureBoundarySeries()
// for every dated row that has no cached table yet, so boundaries are always
// populated automatically — no manual "warming" required.
// ============================================================================

const AQA_SERIES = [
  { month: "JUN", year: 2018, label: "June 2018", format: "pdf" },
  { month: "NOV", year: 2018, label: "November 2018", format: "pdf" },
  { month: "JUN", year: 2019, label: "June 2019", format: "pdf" },
  { month: "NOV", year: 2019, label: "November 2019", format: "pdf" },
  { month: "NOV", year: 2020, label: "November 2020", format: "pdf" },
  { month: "NOV", year: 2021, label: "November 2021", format: "xlsx" },
  { month: "JUN", year: 2022, label: "June 2022", format: "xlsx" },
  { month: "NOV", year: 2022, label: "November 2022", format: "xlsx" },
  { month: "JUN", year: 2023, label: "June 2023", format: "xlsx" },
  { month: "NOV", year: 2023, label: "November 2023", format: "xlsx" },
  { month: "JUN", year: 2024, label: "June 2024", format: "xlsx" },
  { month: "NOV", year: 2024, label: "November 2024", format: "xlsx" },
  { month: "JUN", year: 2025, label: "June 2025", format: "xlsx" },
  { month: "NOV", year: 2025, label: "November 2025", format: "xlsx" },
  { month: "JUN", year: 2026, label: "June 2026", format: "xlsx" }
];

const AQA_FILE_BASE = "https://filestore.aqa.org.uk/over/stat_pdf";
const AQA_PAGE_BASE = "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries";
const AQA_PAGE_ARCHIVE = `${AQA_PAGE_BASE}/archive`;
const AQA_MONTHS = [
  ["January", "JAN"], ["February", "FEB"], ["March", "MAR"], ["April", "APR"],
  ["May", "MAY"], ["June", "JUN"], ["July", "JUL"], ["August", "AUG"],
  ["September", "SEP"], ["October", "OCT"], ["November", "NOV"], ["December", "DEC"]
];

const AQA_LEGACY_PREFIX = {
  "JUN-2018": { gcse: "AQA-GCSE-RF-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
  "NOV-2018": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" },
  "JUN-2019": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
  "NOV-2019": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" },
  "NOV-2020": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
  "NOV-2021": { gcse: "AQA-GCSE-2-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" }
};

const AQA_QUALIFICATIONS = {
  gcse: {
    id: "gcse", name: "GCSE",
    sheets: ["GCSE", "GCSE subject", "GCSE Subject"],
    grades: [9, 8, 7, 6, 5, 4, 3, 2, 1],
    filePrefix: "AQA-GCSE-GDE-BDY"
  },
  aLevel: {
    id: "aLevel", name: "A-level",
    sheets: ["A level subject"],
    grades: ["A*", "A", "B", "C", "D", "E"],
    filePrefix: "AQA-A-LEVEL-GDE-BDY"
  },
  as: {
    id: "as", name: "AS",
    sheets: ["AS subject"],
    grades: ["A", "B", "C", "D", "E"],
    filePrefix: "AQA-AS-GDE-BDY"
  }
};

const ENGINE_QR = {
  gcse: { id: "gcse", name: "GCSE" },
  aLevel: { id: "aLevel", name: "A-level" },
  as: { id: "as", name: "AS" }
};

const OCR_PAGE_BASE = "https://www.ocr.org.uk/administration/grade-boundaries/index.aspx";
const OCR_PAGE_ARCHIVE = "https://www.ocr.org.uk/administration/grade-boundaries/grade-boundaries-archive/grade-boundaries-archive.aspx";
const OCR_QUAL_PATTERNS = {
  gcse: /gcse-grade-boundaries-/,
  aLevel: /as-and-a-level-grade-boundaries-|a-level-grade-boundaries-/,
  as: /as-and-a-level-grade-boundaries-|a-level-grade-boundaries-/
};

const PEARSON_PAGE = "https://qualifications.pearson.com/en/support/support-topics/results-certification/grade-boundaries.html";
const PEARSON_DAM = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries";
const PEARSON_BASELINE = [
  { month: "JUN", year: 2023, label: "June 2023" },
  { month: "JUN", year: 2024, label: "June 2024" },
  { month: "NOV", year: 2024, label: "November 2024" },
  { month: "JUN", year: 2025, label: "June 2025" },
  { month: "NOV", year: 2025, label: "November 2025" }
];

const discovered = { aqa: new Map(), ocr: new Map(), pearson: new Map() };
let boundaryDiscoveryPromise = null;

function seriesKey(series) {
  return `${series.month}-${series.year}`;
}

function monthAbbrevToFull(abbrev) {
  const m = AQA_MONTHS.find(([, abb]) => abb === abbrev);
  return m ? m[0] : abbrev;
}

function monthAbbrevToSlug(abbrev) {
  return monthAbbrevToFull(abbrev).toLowerCase();
}

function monthIndex(abbrev) {
  const idx = AQA_MONTHS.findIndex(([, abb]) => abb === abbrev);
  return idx < 0 ? 0 : idx;
}

function engineQualKey(qid) {
  const id = qualToId(qid);
  if (id === "alevel") return "aLevel";
  return id === "as" ? "as" : "gcse";
}

export function boundaryQualification(board, qualId) {
  const bId = boardToId(board) || String(board || "").toLowerCase();
  const key = engineQualKey(qualId);
  if (bId === "aqa") return (AQA_QUALIFICATIONS[key] && { ...AQA_QUALIFICATIONS[key] }) || null;
  return (ENGINE_QR[key] && { ...ENGINE_QR[key] }) || null;
}

// Fetch a file through the permissive-CORS proxy, falling back to a direct
// request so a sleeping proxy never blocks boundary resolution.
function boundaryProxyUrl(real) {
  const base =
    (typeof window !== "undefined" && window.__NEURONET_PROXY_BASE) ||
    (typeof document !== "undefined"
      ? document.querySelector('meta[name="neuronet-proxy"]')?.getAttribute("content")
      : null) ||
    "https://neuronet-backend.onrender.com";
  const sep = base.endsWith("/") ? "" : "/";
  return `${base}${sep}api/proxy?url=${encodeURIComponent(real)}`;
}

async function fetchBoundaryResource(url) {
  // Try the permissive-CORS proxy first. A proxy that ANSWERS is authoritative,
  // status included: boards (filestore.aqa.org.uk etc.) send no CORS headers,
  // so a direct browser fetch can never succeed here — firing a second request
  // after a proxy 404/5xx is pure waste.
  let proxied;
  try {
    proxied = await fetch(boundaryProxyUrl(url));
    if (proxied.ok) return proxied;
    throw new Error(`HTTP ${proxied.status} via proxy for ${url}`);
  } catch (e) {
    // No answer from the proxy at all (deployment sleeping / down): fall
    // through to the direct request, which *might* work when the board allows
    // cross-origin reads. Otherwise rethrow the original proxy error.
    try {
      const direct = await fetch(url);
      if (direct.ok) return direct;
    } catch {
      /* direct fetch has no CORS access either */
    }
    throw e;
  }
}

function buildSeriesListFor(board, baseline, found) {
  const byKey = new Map();
  for (const s of baseline) byKey.set(seriesKey(s), { ...s });
  for (const key of found.keys()) {
    const sk = key.split(":")[0];
    const [mAbbrev, yearStr] = sk.split("-");
    const year = Number(yearStr);
    if (!byKey.has(sk)) {
      byKey.set(sk, { month: mAbbrev, year, label: `${monthAbbrevToFull(mAbbrev)} ${year}` });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.year - a.year || monthIndex(b.month) - monthIndex(a.month)
  );
}

export function boundarySeriesList(board) {
  const bId = boardToId(board) || String(board || "").toLowerCase();
  const baseline = bId === "aqa" ? AQA_SERIES : bId === "pearson" ? PEARSON_BASELINE : [];
  return buildSeriesListFor(bId, baseline, discovered[bId] || new Map());
}

// The series whose cached boundaries would resolve a dated tracker row: any
// cached series for the same year wins (the row's exact month first).
export function bestSeriesForYear(board, year, monthAbbr) {
  const y = numberEq(year);
  if (y === null) return null;
  const sameYear = boundarySeriesList(board).filter((s) => Number(s.year) === y);
  if (!sameYear.length) return null;
  if (monthAbbr) {
    const exact = sameYear.find((s) => String(s.month || "").toUpperCase() === monthAbbr);
    if (exact) return exact;
  }
  const jun = sameYear.find((s) => String(s.month || "").toUpperCase() === "JUN");
  if (jun) return jun;
  return [...sameYear].sort((a, b) => monthIndex(b.month) - monthIndex(a.month))[0];
}

function qualFromAqaFile(fileName) {
  if (/GCSE/.test(fileName)) return "gcse";
  if (/A-LEVEL/.test(fileName) || /A-LEVEL-UM/.test(fileName)) return "aLevel";
  if (/\bAS\b/.test(fileName)) return "as";
  return null;
}

function qualFromAqaLabel(label) {
  if (/^GCSE\b/.test(label)) return "gcse";
  if (/^A-level/.test(label)) return "aLevel";
  if (/^AS\b/.test(label)) return "as";
  return null;
}

function parseAqaSeriesFromFilename(fileName) {
  const m = fileName.match(/-((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:UARY|E|Y|EMBER)?)-(20\d\d)\./i);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  const map = {
    JANUARY: "JAN", FEBRUARY: "FEB", MARCH: "MAR", APRIL: "APR", MAY: "MAY",
    JUNE: "JUN", JULY: "JUL", AUGUST: "AUG", SEPTEMBER: "SEP",
    OCTOBER: "OCT", NOVEMBER: "NOV", DECEMBER: "DEC"
  };
  const month = map[raw] || raw.slice(0, 3);
  if (!["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].includes(month)) return null;
  const year = Number(m[2]);
  const fullMonth = { JAN: "January", FEB: "February", MAR: "March", APR: "April", MAY: "May", JUN: "June", JUL: "July", AUG: "August", SEP: "September", OCT: "October", NOV: "November", DEC: "December" }[month];
  return { month, year, label: `${fullMonth} ${year}`, format: "pdf" };
}

function extractGradeBoundaryPairs(html) {
  const escaped = /\\"url\\":\\"(https:\/\/cdn\.sanity\.io\/files\/[^\\"]+?\.xlsx)\\"[\s\S]*?\\"title\\":\\"([^\\"]+?)\\"/g;
  const plain = /"url":"(https:\/\/cdn\.sanity\.io\/files\/[^"]+?\.xlsx)"[\s\S]*?"title":"([^"]+?)"/g;
  const out = [];
  for (const re of [escaped, plain]) {
    let m;
    while ((m = re.exec(html)) !== null) out.push({ url: m[1], title: m[2] });
    if (out.length > 0) break;
  }
  return out;
}

function parseBoundaryTitle(title) {
  const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/);
  if (!m) return null;
  const month = AQA_MONTHS.find(([full]) => full === m[1]);
  const series = { month: month[1], year: Number(m[2]), label: `${m[1]} ${m[2]}` };
  let qualId = null;
  if (/\bGCSE\b/.test(title)) qualId = "gcse";
  else if (/A-level/.test(title)) qualId = "aLevel";
  else if (/\bAS\b/.test(title)) qualId = "as";
  return qualId ? { qualId, series } : null;
}

function legacyAqaSeriesUrl(qual, series) {
  const legacy = AQA_LEGACY_PREFIX[seriesKey(series)];
  const ext = series.format === "pdf" ? ".PDF" : ".XLSX";
  if (legacy && legacy[qual.id]) {
    return `${AQA_FILE_BASE}/${legacy[qual.id]}-${series.month}-${series.year}${ext}`;
  }
  const legacyExt = series.format === "pdf" ? ".XLS" : ".XLSX";
  return `${AQA_FILE_BASE}/${qual.filePrefix}-${series.month}-${series.year}${legacyExt}`;
}

function aqaSeriesFormat(qual, series) {
  return discovered.aqa.get(`${seriesKey(series)}:${qual.id}`)?.format || series.format || "xlsx";
}

function aqaSeriesUrl(qual, series) {
  return discovered.aqa.get(`${seriesKey(series)}:${qual.id}`)?.url || legacyAqaSeriesUrl(qual, series);
}

function pearsonSeriesUrl(qual, series) {
  const url = discovered.pearson.get(`${seriesKey(series)}:${qual.id}`);
  if (url) return url;
  const slug = monthAbbrevToSlug(series.month);
  if (qual.id === "gcse") {
    return `${PEARSON_DAM}/GCSE/grade-boundaries-${slug}-${series.year}-gcse.pdf`;
  }
  return `${PEARSON_DAM}/A-level/grade-boundaries-${slug}-${series.year}-gce.pdf`;
}

function parseAqaXlsx(wb, qual, fallbackGrades) {
  let sheet = null;
  for (const name of qual.sheets || []) {
    if (wb.Sheets[name]) { sheet = wb.Sheets[name]; break; }
  }
  if (!sheet) {
    let bestCount = -1;
    for (const name of Object.keys(wb.Sheets || {})) {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
      let count = 0;
      for (const row of r) {
        const code = row && row[0];
        if (code == null || String(code).trim() === "") continue;
        if (typeof code === "string" && !/^\d{3,6}[A-Z0-9]*$/.test(String(code).trim())) continue;
        count++;
      }
      if (count > bestCount) { bestCount = count; sheet = wb.Sheets[name]; }
    }
  }
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
  const subjects = [];
  let gradeLabels = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (String(r[0] || "").trim() === "Subject Code") {
      const gradeRow = rows[i + 1] || [];
      for (let g = 0; g < 9; g++) {
        const label = gradeRow[3 + g];
        if (label === undefined || label === null || String(label).trim() === "") break;
        gradeLabels.push(String(label).trim());
      }
      break;
    }
  }
  if (gradeLabels.length === 0) gradeLabels = fallbackGrades;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const code = r[0];
    const title = r[1];
    if (code == null || String(code).trim() === "") continue;
    if (typeof code === "string" && !/^\d{3,6}[A-Z0-9]*$/.test(String(code).trim())) continue;
    const maxMark = Number(r[2]);
    if (!Number.isFinite(maxMark)) continue;
    const grades = {};
    for (let g = 0; g < gradeLabels.length; g++) {
      const v = Number(r[3 + g]);
      if (Number.isFinite(v)) grades[gradeLabels[g]] = v;
    }
    subjects.push({
      code: String(code).trim(),
      title: String(title || "").trim(),
      maxMark,
      grades,
      gradesInOrder: gradeLabels
    });
  }
  return subjects;
}

function parseAqaArchiveAnchors(html) {
  const liRe = /<li[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
  let m;
  const anchors = [];
  while ((m = liRe.exec(html)) !== null) {
    anchors.push({ href: m[1], label: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  let kept = 0;
  for (const { href, label } of anchors) {
    const fileName = href.split("/").pop();
    const extMatch = fileName.match(/\.(PDF|XLSX|XLS)$/i);
    if (!extMatch) continue;
    const format = extMatch[1].toLowerCase() === "pdf" ? "pdf" : "xlsx";
    const series = parseAqaSeriesFromFilename(fileName);
    if (!series) continue;
    if (series.year < 2018) continue;
    const qualId = qualFromAqaFile(fileName) || qualFromAqaLabel(label);
    if (!qualId) continue;
    const key = `${seriesKey(series)}:${qualId}`;
    const existing = discovered.aqa.get(key);
    if (!existing) {
      discovered.aqa.set(key, { url: href, format });
      kept++;
    } else if (format === "xlsx" && existing.format === "pdf") {
      discovered.aqa.set(key, { url: href, format });
    } else if (format === "xlsx" && existing.format === "xlsx" && /GCSE-2/i.test(href) && !/GCSE-2/i.test(existing.url)) {
      discovered.aqa.set(key, { url: href, format });
    }
  }
  const seriesBlockRe = /<p[^>]*>\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\s+exams\s*<\/p>([\s\S]*?)(?=<p[^>]*>\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d\s+exams\s*<\/p>|$)/gi;
  while ((m = seriesBlockRe.exec(html)) !== null) {
    const month = AQA_MONTHS.find(([full]) => full.toLowerCase() === m[1].toLowerCase());
    if (!month) continue;
    const series = { month: month[1], year: Number(m[2]), label: `${m[1]} ${m[2]}` };
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let link;
    while ((link = linkRe.exec(m[3])) !== null) {
      const linkLabel = link[2].replace(/<[^>]+>/g, "").trim();
      const qualId = qualFromAqaLabel(linkLabel);
      if (!qualId) continue;
      const url = new URL(link[1], AQA_PAGE_BASE).href;
      const key = `${seriesKey(series)}:${qualId}`;
      const format = /\.(xlsx|xls)(?:$|\?)/i.test(url) ? "xlsx" : "pdf";
      const existing = discovered.aqa.get(key);
      if (!existing) {
        discovered.aqa.set(key, { url, format });
        kept++;
      } else if (format === "xlsx" && existing.format === "pdf") {
        discovered.aqa.set(key, { url, format });
      } else if (format === "xlsx" && existing.format === "xlsx" && /GCSE-2/i.test(url) && !/GCSE-2/i.test(existing.url)) {
        discovered.aqa.set(key, { url, format });
      }
    }
  }
  return { anchors: anchors.length, kept };
}

async function discoverAqaSeries(onProgress) {
  const found = [];
  const pages = [
    { url: AQA_PAGE_ARCHIVE, name: "archive page" },
    { url: AQA_PAGE_BASE, name: "current page" }
  ];
  for (const { url: page, name } of pages) {
    if (onProgress) onProgress(`Scanning AQA ${name}...`);
    let text;
    try {
      const res = await fetchBoundaryResource(page);
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }
    found.push(...extractGradeBoundaryPairs(text));
    parseAqaArchiveAnchors(text);
  }
  for (const { url, title } of found) {
    const parsed = parseBoundaryTitle(title);
    if (!parsed) continue;
    const key = `${seriesKey(parsed.series)}:${parsed.qualId}`;
    if (!discovered.aqa.has(key)) discovered.aqa.set(key, { url, format: "xlsx" });
  }
  return found.length;
}

function extractOcrPdfLinks(html) {
  const re = /<a\s+[^>]*href="(\/Images\/[^"]*?grade-boundaries[^"]*?\.pdf)"/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const fileName = m[1].split("/").pop();
    out.push({ url: `https://www.ocr.org.uk${m[1]}`, fileName });
  }
  return out;
}

async function discoverOcrSeries(onProgress) {
  const found = [];
  const pages = [
    { url: boundaryProxyUrl(OCR_PAGE_BASE), name: "index page" },
    { url: boundaryProxyUrl(OCR_PAGE_ARCHIVE), name: "archive page" }
  ];
  for (const { url: page, name } of pages) {
    if (onProgress) onProgress(`Scanning OCR ${name}...`);
    let text;
    try {
      const res = await fetch(page);
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }
    found.push(...extractOcrPdfLinks(text));
  }
  let kept = 0;
  for (const { url, fileName } of found) {
    const fullMatch = fileName.match(/-(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{4})\b/i);
    if (!fullMatch) continue;
    const full = fullMatch[1][0].toUpperCase() + fullMatch[1].slice(1).toLowerCase();
    const month = AQA_MONTHS.find(([f]) => f === full);
    const seriesObj = { month: month[1], year: Number(fullMatch[2]), label: `${full} ${fullMatch[2]}` };
    for (const [qualId, pattern] of Object.entries(OCR_QUAL_PATTERNS)) {
      if (!pattern.test(fileName)) continue;
      const key = `${seriesKey(seriesObj)}:${qualId}`;
      if (!discovered.ocr.has(key)) kept++;
      discovered.ocr.set(key, url);
    }
  }
  return { found: found.length, kept };
}

async function discoverPearsonSeries(onProgress) {
  let text;
  if (onProgress) onProgress("Scanning Pearson grade-boundaries page...");
  try {
    const res = await fetch(boundaryProxyUrl(PEARSON_PAGE));
    if (!res.ok) return { found: 0, kept: 0 };
    text = await res.text();
  } catch {
    return { found: 0, kept: 0 };
  }
  const titles = [...text.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
  const urls = [...text.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
  let kept = 0;
  for (let i = 0; i < Math.min(titles.length, urls.length); i++) {
    const title = titles[i];
    const urlPath = urls[i].trim();
    if (!urlPath.endsWith(".pdf")) continue;
    const url = `https://qualifications.pearson.com${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;
    const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i);
    if (!m) continue;
    const month = AQA_MONTHS.find(([f]) => f.toLowerCase() === m[1].toLowerCase());
    const series = { month: month[1], year: Number(m[2]), label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` };
    const norm = title.toLowerCase();
    if (/gcse \(9-1\)/.test(norm) && /notional/.test(norm)) continue;
    let quals = [];
    if (/gcse \(9-1\)/.test(norm) && !/international|\bproject\b|award|maths|\bmath\b|bt|level 3/i.test(norm)) quals.push("gcse");
    if (/ - gce\b/.test(norm) && !/international|\bproject\b|award|mathematics in context|level 3/i.test(norm)) quals.push("aLevel", "as");
    for (const q of quals) {
      const key = `${seriesKey(series)}:${q}`;
      if (!discovered.pearson.has(key)) kept++;
      discovered.pearson.set(key, url);
    }
  }
  return { found: titles.length, kept };
}

// Run discovery for every board once (idempotent). Resolves regardless of
// individual board failures so partial discovery never blocks boundary use.
export function discoverBoundarySeries(onProgress) {
  if (!boundaryDiscoveryPromise) {
    boundaryDiscoveryPromise = Promise.allSettled([
      discoverAqaSeries(onProgress),
      discoverOcrSeries(onProgress),
      discoverPearsonSeries(onProgress)
    ]);
  }
  return boundaryDiscoveryPromise;
}

// Download + parse the subjects for a board/qual/series. Throws on failure.
export async function fetchBoundarySubjects(board, qual, series, onProgress) {
  const bId = boardToId(board) || String(board || "").toLowerCase();
  if (!qual || !series) throw new Error("Missing qual or series");
  let url;
  let fileType;
  if (bId === "aqa") {
    url = aqaSeriesUrl(qual, series);
    fileType = aqaSeriesFormat(qual, series);
  } else if (bId === "ocr") {
    url = discovered.ocr.get(`${seriesKey(series)}:${qual.id}`);
    fileType = "pdf";
  } else if (bId === "pearson") {
    url = pearsonSeriesUrl(qual, series);
    fileType = "pdf";
  }
  if (!url) throw new Error(`No file URL known for ${bId} ${qual.id} ${series.label}`);
  if (fileType === "xlsx") {
    const res = await fetchBoundaryResource(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${bId} ${series.label}`);
    if (onProgress) onProgress(`Reading ${series.label} workbook...`);
    const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
    return parseAqaXlsx(wb, qual, qual.grades).map((s) => ({ ...s, board: bId, qual: qual.id }));
  }
  if (onProgress) onProgress(`Reading ${series.label} PDF...`);
  const lines = await extractPdfLayoutLines(url, boundaryProxyUrl, (p, total) => {
    if (onProgress) onProgress(`PDF page ${p}/${total}...`);
  });
  return parsePdfBoundaries(lines, bId, qual.id).map((s) => ({ ...s, board: bId, qual: qual.id }));
}

// Idempotently make sure a board/qual/series is cached under the canonical
// board:MONTH-YEAR:qual key. Skips if an entry already exists. Returns the
// cached subjects (or null if the fetch produced nothing). Concurrent callers
// (tracker picker, auto-warm, scraper) share ONE fetch via an in-flight map,
// and every write/attempt publishes to the shared status + cache buses.
export async function ensureBoundarySeries(board, qual, series, onProgress) {
  const bId = boardToId(board) || String(board || "").toLowerCase();
  const qualObj = boundaryQualification(bId, qual && (qual.id || qual));
  if (!qualObj || !series || !series.month || !series.year) return null;
  const key = `${bId}:${series.month}-${series.year}:${qualObj.id}`;
  const running = sweepInflight.get(key);
  if (running) return running;
  publishBoundaryStatus({
    phase: "fetching",
    current: { board: bId, qual: qualObj.id, seriesLabel: series.label }
  });
  const task = (async () => {
    const cache = loadBoundaryCache();
    const existing = cache.entries[key];
    if (existing && existing.subjects && existing.subjects.length) {
      return existing.subjects;
    }
    try {
      const subjects = await fetchBoundarySubjects(bId, qualObj, series, onProgress);
      if (!subjects || subjects.length === 0) {
        sweepMarkFailed(key);
        return null;
      }
      cache.entries[key] = {
        series: { month: series.month, year: series.year, label: series.label },
        qual: qualObj.id,
        board: bId,
        fetchedAt: Date.now(),
        subjects
      };
      saveBoundaryCache(cache);
      sweepClearFailed(key);
      publishBoundaryCacheChanged();
      return subjects;
    } catch (e) {
      sweepMarkFailed(key);
      throw e;
    }
  })();
  sweepInflight.set(key, task);
  try {
    return await task;
  } finally {
    if (sweepInflight.get(key) === task) sweepInflight.delete(key);
  }
}

// ---------- the one sweep runner ----------
// Fetches EVERY board × qual × series that isn't already cached (the union the
// subject picker shows and the per-row boundary tables resolve from). This is
// THE only place the app decides "what should we have fetched by now", so
// opening the link picker never re-fires a fetch set again: what's cached is
// served from cache, what failed is not retried within the retry window, and a
// recently-completed sweep is treated as fresh. Concurrent sweeps (picker +
// auto-warm) collapse into one run.
const sweepInflight = new Map(); // series fetch key -> in-flight promise
let sweepBusy = false;
let sweepQueued = false;

export function runBoundarySweep(opts = {}) {
  const { onStatus } = opts;
  if (sweepBusy) {
    sweepQueued = true;
    return Promise.resolve();
  }
  sweepBusy = true;
  const run = (async () => {
    const status = getBoundaryStatus();
    const now = Date.now();
    // A sweep completed recently (this tab or another) -> everything's already
    // cached/attempted; don't re-fire.
    if (status.sweepFinishedAt && now - status.sweepFinishedAt < SWEEP_FRESH_MS) {
      publishBoundaryStatus({ phase: "ready" });
      if (onStatus) onStatus(getBoundaryStatus());
      return;
    }
    publishBoundaryStatus({
      phase: "discovering",
      sweepFinishedAt: null,
      current: { message: "Scanning AQA, OCR and Pearson..." }
    });
    if (onStatus) onStatus(getBoundaryStatus());
    try {
      await discoverBoundarySeries((msg) =>
        publishBoundaryStatus({ current: { ...(getBoundaryStatus().current || {}), message: msg } })
      );
    } catch {
      /* deterministic fallback URLs still work */
    }
    const boards = ["aqa", "ocr", "pearson"];
    const quals = ["gcse", "aLevel", "as"];
    const jobs = [];
    const cache = loadBoundaryCache();
    for (const board of boards) {
      for (const series of boundarySeriesList(board)) {
        for (const qualId of quals) {
          const qualObj = boundaryQualification(board, qualId);
          if (!qualObj || !series || !series.month || !series.year) continue;
          const key = `${board}:${series.month}-${series.year}:${qualObj.id}`;
          const entry = cache.entries[key];
          if (entry && entry.subjects && entry.subjects.length) continue; // cached
          if (sweepReentryOld(key, now)) continue; // just failed
          jobs.push({ board, qual: qualObj, series, key });
        }
      }
    }
    const total = jobs.length;
    publishBoundaryStatus({ phase: "fetching", jobsTotal: total, jobsDone: 0, jobsFailed: 0, current: null, sweepFinishedAt: null });
    let done = 0;
    let failed = 0;
    for (const job of jobs) {
      publishBoundaryStatus({ current: { board: job.board, qual: job.qual.id, seriesLabel: job.series.label } });
      try {
        await ensureBoundarySeries(job.board, job.qual, job.series, (msg) =>
          publishBoundaryStatus({ current: { board: job.board, qual: job.qual.id, seriesLabel: job.series.label, message: msg } })
        );
        done++;
      } catch {
        failed++;
      }
      publishBoundaryStatus({ jobsDone: done, jobsFailed: failed });
      if (onStatus) onStatus(getBoundaryStatus());
      // Yield on the macrotask queue so spinners/scratch buffers actually paint
      // between sequential (synchronous-ish) parses.
      await new Promise((r) => setTimeout(r, 0));
    }
    publishBoundaryStatus({ phase: "ready", jobsTotal: total, jobsDone: done, jobsFailed: failed, current: null, sweepFinishedAt: Date.now() });
    if (onStatus) onStatus(getBoundaryStatus());
  })();
  return run
    .catch(() => {
      publishBoundaryStatus({ phase: "ready", current: null, sweepFinishedAt: Date.now() });
    })
    .finally(() => {
      sweepBusy = false;
      if (sweepQueued) {
        sweepQueued = false;
        runBoundarySweep();
      }
    });
}

// Failure bookkeeping: series key -> last try ts. Keys use the canonical
// "board:MONTH-YEAR:qual" form (same as cache entries). The sweep skips keys
// attempted within the retry window, so a dead legacy URL is not re-fetched
// every single time the subject picker opens.
function sweepMarkFailed(seriesKey) {
  const status = getBoundaryStatus();
  const attemptedFailed = { ...(status.attemptedFailed || {}) };
  attemptedFailed[seriesKey] = Date.now();
  publishBoundaryStatus({ attemptedFailed });
}

function sweepClearFailed(seriesKey) {
  const status = getBoundaryStatus();
  if (!status.attemptedFailed || !status.attemptedFailed[seriesKey]) return;
  const attemptedFailed = { ...status.attemptedFailed };
  delete attemptedFailed[seriesKey];
  publishBoundaryStatus({ attemptedFailed });
}

function sweepReentryOld(seriesKey, now) {
  const status = getBoundaryStatus();
  const ts = status.attemptedFailed && status.attemptedFailed[seriesKey];
  if (!ts) return false;
  return now - ts < RETRY_WINDOW_MS;
}

// Whether a canonical "board:MONTH-YEAR:qual" series key was recently attempted
// and failed (used by the tracker's targeted auto-warm so a dead series isn't
// re-fetched on every render — same policy the full sweep already applies).
export function seriesRecentlyAttempted(seriesKey) {
  return sweepReentryOld(seriesKey, Date.now());
}