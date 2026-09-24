// examData/app.js — the browser-facing facade the TRACKER speaks to (frontier #18).
//
// The tracker must know nothing about Pearson URLs/PDFs/filenames/archives, the
// sweeper, or any scraper. It imports ONLY this module:
//
//   Exam.init()                    — one-time legacy→canonical boot migration + buses
//   Exam.decisionFor(course,y,s,w) — sync render envelope (same gate as getForSitting)
//   Exam.ensureForSitting(opts)    — acquisition (warm path), with retry bookkeeping
//   Exam.courseList() / resolveCourse / reconcile        — course identity + picker
//   Exam.gradeLabels / boundarySeries / papersFor / ...  — table surface
//   Exam.status()/onStatus/onChanged                     — fetch progress + cache bus
//   Exam.recentlyAttempted(key)                          — retry window
//
// Dependency rule (see ../examData/index.js): facilitated modules MUST NOT import
// the legacy gradeBoundaries module. The facade reads the legacy cache/status
// blobs by localStorage KEY (never by import) so an existing localStorage blob
// written by the old tracker or the Scraper tool keeps working across the
// migration, and it mirrors the legacy status/cache BroadcastChannels so tabs
// stay in sync. The canonical IndexedDB snapshot is overlaid on top of the
// legacy migration — canonical wins on boundary collisions, legacy freshness is
// preserved for anything canonical has not re-acquired.

import * as storage from "./storage.js";
import { buildExamIndex } from "./migrate.js";
import { openExamRepository, deriveBoundaryDecision } from "./repository.js";
import { gateDecisionForVerification, getForSitting } from "./ingest.js";
import { ensureForSitting as ensureForSittingImpl } from "./ensure.js";
import * as schema from "./schema.js";

// ---- legacy blob / channel keys (strings only — no import, no cycle) ----
const LEGACY_CACHE_KEY = "neuronet:gradeBoundaries";
const LEGACY_STATUS_KEY = "neuronet:boundaryStatus";
const LEGACY_CACHE_TICK = `${LEGACY_CACHE_KEY}_tick`;
const STATUS_CHANNEL = "neuronet:boundaryStatus";
const CACHE_CHANNEL = "neuronet:boundaryCache";
const MIGRATED_KEY = "neuronet:examDataMigrated";
const RETRY_WINDOW_MS = 60 * 60 * 1000;

const BOARD_IDS = { aqa: "AQA", ocr: "OCR", pearson: "Pearson (Edexcel)" };
const QUAL_IDS = { gcse: "GCSE", alevel: "A-Level", as: "AS" };

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
}

function readLegacyCache() {
  return readJson(LEGACY_CACHE_KEY, { version: 2, entries: {} });
}

function readLegacyStatus() {
  return readJson(LEGACY_STATUS_KEY, null);
}

// ---- merged read model: canonical snapshot wins, legacy blob stays fresh ----
let currentSnap = null;
let mergedDirty = true;
let mergedRepo = null;

function emptySnap() {
  return { examCourses: [], examSeries: [], examBoundaries: [], examPapers: [], examSources: [], examJobs: [], updatedAt: 0 };
}

export function mergedIndex(snap) {
  const legacy = buildExamIndex(readLegacyCache());
  const courses = new Map();
  for (const [k, c] of legacy.courses) courses.set(k, { ...c });
  for (const c of (snap && snap.examCourses) || []) {
    if (c && c.id && !courses.has(c.id)) courses.set(c.id, { ...c });
  }
  const boundaries = new Map();
  for (const b of (snap && snap.examBoundaries) || []) {
    if (b && b.id) boundaries.set(b.id, { ...b });
  }
  for (const [k, b] of legacy.boundaries) {
    if (!boundaries.has(k)) boundaries.set(k, b);
  }
  const series = new Map();
  for (const s of (snap && snap.examSeries) || []) {
    if (s && s.id) series.set(s.id, { ...s });
  }
  for (const [k, s2] of legacy.series) {
    if (!series.has(k)) series.set(k, s2);
  }
  const papers = new Map();
  for (const p of (snap && snap.examPapers) || []) {
    if (p && p.id) papers.set(p.id, { ...p });
  }
  const sources = new Map();
  for (const s3 of (snap && snap.examSources) || []) {
    if (s3 && s3.id) sources.set(s3.id, { ...s3 });
  }
  return { courses, series, boundaries, papers, sources };
}

export function repoNow() {
  if (mergedDirty || !mergedRepo) {
    mergedRepo = openExamRepository(mergedIndex(currentSnap));
    mergedDirty = false;
  }
  return mergedRepo;
}

function invalidateIndex() {
  mergedDirty = true;
}

async function refreshIndex() {
  try {
    currentSnap = await storage.loadSnapshot();
  } catch {
    currentSnap = emptySnap();
  }
  mergedDirty = true;
}

// ---- one-time boot migration: legacy cache → canonical stores ---------------
// Runs at most once per browser (flag-gated) so a stale legacy blob can never
// clobber canonical acquisitions on later boots. upsert-only: existing
// canonical records (same ids) are left untouched; future acquirePearson
// writes overwrite the migrated rows with verified data.
async function migrateLegacyOnce() {
  const legacy = buildExamIndex(readLegacyCache());
  const seenCourses = new Set();
  for (const c of legacy.courses.values()) {
    const ck = schema.courseKey(c);
    if (!ck || seenCourses.has(ck)) continue;
    seenCourses.add(ck);
    try { await storage.putCourse({ id: ck, board: c.board, qual: c.qual, code: c.code, tier: c.tier }); } catch { /* non-fatal */ }
  }
  for (const [k, s] of legacy.series) {
    try { await storage.putSeries({ id: k, ...s }); } catch { /* non-fatal */ }
  }
  for (const [k, b] of legacy.boundaries) {
    try { await storage.putBoundary({ id: k, ...b }); } catch { /* non-fatal */ }
  }
}

// ---- status + changed buses (mirror the legacy pub/sub protocol) ------------
let localFetching = 0;
const statusListeners = new Set();
const changeListeners = new Set();
let lastStatusPost = 0;
let lastCachePost = 0;
let statusChannel = null;
let cacheChannel = null;
let busesWired = false;

export function status() {
  const base = readLegacyStatus() || {};
  let phase = base.phase || "idle";
  if (localFetching > 0) phase = "fetching";
  return {
    version: 1,
    phase,
    jobsTotal: Number(base.jobsTotal) || 0,
    jobsDone: Number(base.jobsDone) || 0,
    jobsFailed: Number(base.jobsFailed) || 0,
    current: base.current || null,
    sweepFinishedAt: base.sweepFinishedAt || null,
    attemptedFailed: base.attemptedFailed || {},
    localFetching,
    updatedAt: Date.now()
  };
}

function fireStatus() {
  const s = status();
  const postId = Date.now();
  lastStatusPost = postId;
  for (const fn of statusListeners) { try { fn(s); } catch { /* listener fault */ } }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      if (!statusChannel) statusChannel = new BroadcastChannel(STATUS_CHANNEL);
      statusChannel.postMessage({ ...s, _origin: postId });
    } catch { /* degrade to storage */ }
  }
  try { localStorage.setItem(LEGACY_STATUS_KEY, JSON.stringify(s)); } catch { /* memory-only */ }
}

function fireChanged() {
  const postId = Date.now();
  lastCachePost = postId;
  for (const fn of changeListeners) { try { fn(); } catch { /* listener fault */ } }
  const hasChannel = typeof BroadcastChannel !== "undefined";
  if (hasChannel) {
    try {
      if (!cacheChannel) cacheChannel = new BroadcastChannel(CACHE_CHANNEL);
      cacheChannel.postMessage({ at: postId, origin: postId });
    } catch {
      try { localStorage.setItem(LEGACY_CACHE_TICK, String(postId)); } catch { /* non-fatal */ }
    }
  } else {
    try { localStorage.setItem(LEGACY_CACHE_TICK, String(postId)); } catch { /* non-fatal */ }
  }
}

// An external writer (the Scraper tab, another tab's tracker) touched the
// legacy cache blob — invalidate the merged index so the next sync read picks
// up the new legacy data, then refresh the canonical snapshot in the
// background and only then ping our listeners.
function onExternalCacheChange() {
  invalidateIndex();
  refreshIndex().catch(() => { /* non-fatal */ });
  for (const fn of changeListeners) { try { fn(); } catch { /* listener fault */ } }
  const s = status();
  for (const fn of statusListeners) { try { fn(s); } catch { /* listener fault */ } }
}

function wireBuses() {
  if (busesWired || typeof window === "undefined") return;
  busesWired = true;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      statusChannel = new BroadcastChannel(STATUS_CHANNEL);
      statusChannel.onmessage = (ev) => {
        if (!ev.data) return;
        if (ev.data._origin && ev.data._origin === lastStatusPost) return; // own echo
        for (const fn of statusListeners) { try { fn(status()); } catch { /* ignore */ } }
      };
      cacheChannel = new BroadcastChannel(CACHE_CHANNEL);
      cacheChannel.onmessage = (ev) => {
        if (!ev.data) return;
        if (ev.data.origin && ev.data.origin === lastCachePost) return; // own echo
        onExternalCacheChange();
      };
      return;
    } catch { /* channel unavailable — storage fallback below */ }
  }
  window.addEventListener("storage", (e) => {
    if (e.key === LEGACY_STATUS_KEY && e.newValue) {
      for (const fn of statusListeners) { try { fn(status()); } catch { /* ignore */ } }
    }
    if (e.key === LEGACY_CACHE_TICK) {
      try { localStorage.setItem(LEGACY_CACHE_TICK, String(Date.now())); } catch { /* non-fatal */ }
      onExternalCacheChange();
    }
  });
}

// ---- public: boot ----
export async function init() {
  const run = async () => {
    wireBuses();
    if (typeof localStorage !== "undefined") {
      let already = false;
      try { already = localStorage.getItem(MIGRATED_KEY) === "1"; } catch { /* defaults to false */ }
      if (!already) {
        await migrateLegacyOnce();
        try { localStorage.setItem(MIGRATED_KEY, "1"); } catch { /* non-fatal */ }
      }
    }
    await refreshIndex();
    fireStatus();
  };
  if (!init._p) init._p = run();
  return init._p;
}

// ---- public: resolution ----
export function decisionFor(enrollment, year, seriesWord, sitting = {}) {
  const repo = repoNow();
  const raw = deriveBoundaryDecision(repo, enrollment, year, seriesWord, sitting || {});
  return gateDecisionForVerification(repo, enrollment, year == null || year === "" ? "" : String(year), seriesWord, raw);
}

export function getForSittingFor(enrollment, year, seriesWord, sitting = {}) {
  return getForSitting(repoNow(), enrollment, year, seriesWord, sitting || {});
}

export async function ensureForSitting(opts = {}, attemptKey) {
  const { board, qual, code, tier, title, year, seriesWord, confirm, acquire, fetchImpl, proxyFn, onProgress, parse, priority } = opts;
  localFetching += 1;
  fireStatus();
  let result;
  try {
    result = await ensureForSittingImpl({
      board, qual, code, tier, title, year, seriesWord,
      confirm: !!confirm, acquire: !!acquire,
      fetchImpl, proxyFn, onProgress, parse, priority
    });
  } catch (err) {
    result = { status: "unknown", reason: "FETCH_FAILED", error: String((err && err.message) || err) };
  } finally {
    localFetching -= 1;
  }
  await refreshIndex();
  if (attemptKey) {
    const done = result && (result.status === "complete" || (result.decision && result.decision.kind === "official"));
    if (done) attemptMap.delete(attemptKey);
    else attemptMap.set(attemptKey, Date.now());
  }
  fireChanged();
  fireStatus();
  return result;
}

// Warm-path convenience: resolves the requirement's course from the merged
// index and acquires exactly that course+series. Nothing is fabricated when
// the course cannot be resolved — it reports COURSE_UNRESOLVED instead.
export async function ensureRequirement(requirement = {}) {
  const ck = requirement.courseKey;
  const rec = ck ? repoNow().courses().find((c) => schema.courseKey(c) === ck) : null;
  if (!rec) {
    return { status: "unknown", courseKey: ck, reason: "COURSE_UNRESOLVED", missing: ["course"] };
  }
  const monthAbbr = String((requirement.series && requirement.series.month) || "").toUpperCase();
  const MONTH_WORDS = { JUN: "Jun", NOV: "Nov", JAN: "Jan", MAR: "Mar", MAY: "May", OCT: "Oct" };
  const seriesWord = monthAbbr ? MONTH_WORDS[monthAbbr] || monthAbbr : "";
  return ensureForSitting({
    board: rec.board,
    qual: rec.qual,
    code: rec.code,
    tier: String(rec.tier || "") || undefined,
    title: rec.title,
    year: String(requirement.series && requirement.series.year),
    seriesWord,
    acquire: true
  }, requirement.key);
}

// ---- public: course identity ------------------------------------------------
export function courseList() {
  const seen = new Set();
  const out = [];
  for (const course of repoNow().courses()) {
    const b = schema.boardId(course.board);
    const q = schema.qualId(course.qual);
    if (!BOARD_IDS[b] || !QUAL_IDS[q]) continue;
    const code = schema.singleCode(course.code);
    const tier = String(course.tier || "").toUpperCase();
    const key = `${b}:${q}:${code}:${tier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      board: b,
      boardName: BOARD_IDS[b],
      qual: q,
      qualName: QUAL_IDS[q],
      code,
      tier,
      title: course.title || null,
      maxMark: course.maxMark || null,
      papers: Array.isArray(course.papers) && course.papers.length ? course.papers : null
    });
  }
  return out.sort((a, b) =>
    a.boardName.localeCompare(b.boardName) ||
    a.qual.localeCompare(b.qual) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

// Tolerant course resolution (faithful port of the legacy resolver): code match
// first, else normalized word tokens with subject aliases + prefix tolerance;
// narrowed by board/qual when present. Tier-unknown subjects prefer the Higher
// row. Returns a course, { ambiguous, candidates }, or null — identity never
// resolves on cache richness; ties surface as ambiguity.
const SUBJECT_TITLE_ALIASES = {
  math: "mathematics", maths: "mathematics",
  bio: "biology", chem: "chemistry",
  geog: "geography",
  lang: "language", lit: "literature",
  psych: "psychology", stats: "statistics",
  phys: "physics", compsci: "computer science"
};
const COURSE_EXCLUDE = /\b(international|award|legacy|notional|bt|btec|functional skills|project|level 3|level2|certificate|extended certificate|mathematics in context|in context)\b/i;

function titleTokens(text) {
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

function tierPreference(c, wantTier) {
  if (wantTier) return (c.tier || null) === wantTier ? 0 : 1;
  if (!c.tier) return 2;
  return c.tier === "H" ? 0 : 1;
}

export function scoreCourseCandidates(query = {}) {
  const { board, qual, title, code, tier } = query;
  if (!title) return [];
  const wantBoard = schema.boardId(board);
  const wantQual = schema.qualId(qual);
  const normCode = schema.singleCode(code).trim().toUpperCase();
  const wantTier = tier === "H" || tier === "F" ? tier : null;
  const excludeMe = COURSE_EXCLUDE.test(String(title || ""));
  const subjectTokens = titleTokens(String(title));
  const tierRank = (t) => (t === "H" ? 0 : t === "F" ? 2 : 1);
  if (subjectTokens.length === 0) return [];

  const scored = [];
  for (const c of courseList()) {
    if (wantBoard && c.board !== wantBoard) continue;
    if (wantQual && c.qual !== wantQual) continue;
    const cTitle = String(c.title || "");
    const cCode = schema.singleCode(c.code).toUpperCase();
    if (normCode) {
      if (cCode !== normCode && baseCode(c.code) !== baseCode(normCode)) continue;
      scored.push({ c, score: 100, exact: true });
      continue;
    }
    if (!cTitle) continue;
    if (!excludeMe && COURSE_EXCLUDE.test(cTitle)) continue;
    if (wantQual === "gcse" && /\b(al[\s-]?level)\b/i.test(cTitle)) continue;
    const courseTokens = titleTokens(cTitle);
    if (courseTokens.length === 0) continue;
    const missing = subjectTokens.filter((st) => !courseTokens.some((ct) => titleTokensMatch(st, ct)));
    if (missing.length) continue;
    const courseMatched = courseTokens.filter((ct) => subjectTokens.some((st) => titleTokensMatch(st, ct))).length;
    const exact = courseTokens.length === subjectTokens.length && courseTokens.every((ct, i) => titleTokensMatch(subjectTokens[i], ct));
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

export function listCourseCandidates(query) {
  return scoreCourseCandidates(query).map((s) => s.c);
}

export function resolveCourse(query = {}) {
  const scored = scoreCourseCandidates(query);
  if (scored.length === 0) return null;
  const top = scored[0];
  const group = scored.filter((s) => s.score === top.score && s.tpref === top.tpref);
  if (group.length > 1) {
    return { ambiguous: true, candidates: group.map((s) => s.c) };
  }
  return top.c;
}

// Reconcile a stored officialCourse (possibly stale / tier-less) against the
// live index so a linked subject always resolves to the exact row the index
// carries for its board+qual+code. Same authority order as the legacy port:
// preferred tier → stored tier → Higher when genuinely tier-less → only row.
export function reconcile(linked, preferredTier) {
  if (!linked) return null;
  const b = schema.boardId(linked.board);
  const q = schema.qualId(linked.qual);
  if (!b || !q) return null;
  const normCode = schema.singleCode(linked.code).toUpperCase();
  if (!normCode) return null;
  const normBase = baseCode(normCode);
  const rows = courseList().filter((c) => {
    if (c.board !== b || c.qual !== q) return false;
    const code = String(c.code || "").toUpperCase();
    if (!code) return false;
    return code === normCode || baseCode(code) === normBase || baseCode(code) === normCode || code === normBase;
  });
  if (rows.length === 0) return null;
  const uni = rows.length === 1 || !rows.some((c) => tierOf(c));
  const toCourse = (pick, tier) => ({
    board: b, qual: q, code: String(pick.code || ""), tier: tier || "",
    title: pick.title, maxMark: pick.maxMark,
    papers: Array.isArray(pick.papers) && pick.papers.length ? pick.papers : null
  });
  if (preferredTier) {
    const same = rows.filter((c) => tierOf(c) === preferredTier);
    if (same.length) return toCourse(same[0], preferredTier);
    if (!uni) return null;
  } else {
    const storedTier = tierOf(linked);
    if (storedTier) {
      const same = rows.filter((c) => tierOf(c) === storedTier);
      if (same.length) return toCourse(same[0], storedTier);
      if (!uni) return null;
    } else if (!uni) {
      const higher = rows.filter((c) => tierOf(c) === "H");
      if (higher.length) return toCourse(higher[0], "H");
    }
  }
  return toCourse(rows[0], tierOf(rows[0]));
}

// ---- public: table surface --------------------------------------------------
// The course's cks that carry data, resolved with the same tier-aware rules as
// the legacy findSubjectInEntry so Higher never gleans markers from Foundation.
function matchCourseKeys(course) {
  if (!course) return [];
  const b = schema.boardId(course.board);
  const q = schema.qualId(course.qual);
  if (!b || !q) return [];
  const normCode = schema.singleCode(course.code).toUpperCase();
  const normTitle = schema.normalizeTitle(course.title);
  const rows = courseList().filter((c) => c.board === b && c.qual === q && (normCode || normTitle));
  const codeMatches = rows.filter((c) => normCode && schema.singleCode(c.code).toUpperCase() === normCode);
  if (codeMatches.length) {
    if (codeMatches.length > 1) {
      const want = tierOf(course);
      if (want) {
        const same = codeMatches.filter((c) => tierOf(c) === want);
        return same.length ? same.map((c) => schema.courseKey(c)) : [];
      }
      const higher = codeMatches.filter((c) => tierOf(c) === "H");
      return higher.length ? [schema.courseKey(higher[0])] : [schema.courseKey(codeMatches[0])];
    }
    return [schema.courseKey(codeMatches[0])].filter(Boolean);
  }
  if (normTitle) {
    const titles = rows.filter((c) => schema.normalizeTitle(c.title) === normTitle);
    if (titles.length) return titles.map((c) => schema.courseKey(c)).filter(Boolean);
  }
  if (normCode) {
    const tiered = rows.filter((c) =>
      baseCode(schema.singleCode(c.code)) === baseCode(normCode) ||
      schema.normalizeTitle(c.title).replace(/\s+tier\s+[fh]$/i, "") === normTitle);
    if (tiered.length) {
      const want = tierOf(course);
      if (want) {
        const same = tiered.filter((c) => tierOf(c) === want);
        if (same.length) return [schema.courseKey(same[0])].filter(Boolean);
      }
      const higher = tiered.filter((c) => tierOf(c) === "H");
      if (higher.length) return [schema.courseKey(higher[0])].filter(Boolean);
      return [schema.courseKey(tiered[0])].filter(Boolean);
    }
  }
  return [];
}

export function gradeLabels(course) {
  const labels = [];
  const seen = new Set();
  const cks = matchCourseKeys(course);
  for (const ck of cks) {
    for (const b of repoNow().index.boundaries.values()) {
      if (b.courseKey !== ck) continue;
      const marks = b.grades && typeof b.grades === "object" ? b.grades : {};
      const order = Array.isArray(b.gradesInOrder) && b.gradesInOrder.length ? b.gradesInOrder : Object.keys(marks);
      for (const value of order) {
        const key = canonicalGradeKey(value);
        if (!key || key === "U" || seen.has(key)) continue;
        const present = marks[value] != null || marks[key] != null ||
          Object.keys(marks).some((k) => canonicalGradeKey(k) === key);
        if (!present) continue;
        seen.add(key);
        labels.push(key);
      }
    }
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

// Every series that actually resolves a row for this course, newest exam year
// first (then freshest parse, then month). The customise preview renders one
// threshold group per series so the numbers shown are faithful to that year.
export function boundarySeries(course) {
  const cks = matchCourseKeys(course);
  const out = [];
  for (const ck of cks) {
    for (const b of repoNow().index.boundaries.values()) {
      if (b.courseKey !== ck) continue;
      out.push({ series: b.series || null, fetchedAt: Number(b.provenance && b.provenance.parsedAt) || 0, boundary: b });
    }
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

export function papersFor(course) {
  if (!course) return null;
  return repoNow().papersFor(course, null) || null;
}

export function boundaryFor(courseKey, seriesId) {
  const repo = repoNow();
  if (!repo || !repo.index || !repo.index.boundaries) return null;
  return repo.index.boundaries.get(`${courseKey}|${seriesId}`) || null;
}

// ---- public: naming / keys / tier / grade helpers (legacy-faithful ports) ----
export function boardLabel(id) {
  return BOARD_IDS[schema.boardId(id)] || schema.boardName(id) || String(id || "");
}

export function qualLabel(id) {
  return QUAL_IDS[schema.qualId(id)] || schema.qualName(id) || String(id || "");
}

export function monthOf(word) {
  return schema.monthFromWord(word);
}

export function tierFromName(name) {
  const t = String(name || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t)) return "F";
  return null;
}

export function canonicalGradeKey(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const stripped = text.replace(/^grade\s+/i, "").replace(/\s+/g, " ").trim().toUpperCase();
  return stripped === "A*" ? "A*" : stripped;
}

export function normalizeTable(table) {
  if (!table || typeof table !== "object") return null;
  const rawGrades = table.grades && typeof table.grades === "object" ? table.grades : {};
  const rawOrder = Array.isArray(table.gradesInOrder) && table.gradesInOrder.length
    ? table.gradesInOrder
    : Object.keys(rawGrades);
  const grades = {};
  const gradesInOrder = [];
  const seen = new Set();
  for (const rawLabel of rawOrder) {
    const normLabel = canonicalGradeKey(rawLabel);
    if (!normLabel || seen.has(normLabel)) continue;
    const mark = rawGrades[rawLabel] != null ? rawGrades[rawLabel]
      : rawGrades[normLabel] != null ? rawGrades[normLabel]
        : (Object.keys(rawGrades).find((k) => canonicalGradeKey(k) === normLabel) != null
          ? rawGrades[Object.keys(rawGrades).find((k) => canonicalGradeKey(k) === normLabel)] : undefined);
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
  const normalized = normalizeTable(table);
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

export function scoreToGrade(grades, gradesInOrder, score) {
  const s = numberEq(score);
  const table = normalizeTable({ grades: grades || {}, gradesInOrder: gradesInOrder || [] });
  if (s === null || !table || !table.gradesInOrder.length) return null;
  for (const g of table.gradesInOrder) {
    const mark = table.grades && table.grades[g];
    if (Number.isFinite(mark) && s >= mark) return g;
  }
  return table.gradesInOrder[table.gradesInOrder.length - 1];
}

// ---- public: retry window (per requirement key) ------------------------------
const attemptMap = new Map();

export function recentlyAttempted(key) {
  if (!key) return false;
  const ts = attemptMap.get(key);
  if (!ts) return false;
  return Date.now() - ts < RETRY_WINDOW_MS;
}

export function rememberAttempt(key) {
  if (key) attemptMap.set(key, Date.now());
}

export function retryWindowMs() {
  return RETRY_WINDOW_MS;
}

// ---- helpers (shared) --------------------------------------------------------
function baseCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[FH]$/, "");
}

// Tier is the ONE place tools learn a course's tier from: explicit tier field,
// then title words, then trailing H/F on the code.
function tierOf(course) {
  if (!course) return null;
  const parsed = String(course.tier || "").trim().toUpperCase();
  if (parsed === "H" || parsed === "F") return parsed;
  const t = String(course.title || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t)) return "F";
  const code = String(course.code || "").toUpperCase().trim();
  if (/H$/.test(code)) return "H";
  if (/F$/.test(code)) return "F";
  return null;
}

function numberEq(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function onStatus(fn) {
  statusListeners.add(fn);
  try { fn(status()); } catch { /* ignore */ }
  return () => statusListeners.delete(fn);
}

export function onChanged(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export const Exam = Object.freeze({
  init,
  status,
  onStatus,
  onChanged,

  decisionFor,
  getForSittingFor,
  ensureForSitting,
  ensureRequirement,

  courseList,
  resolveCourse,
  listCourseCandidates,
  reconcile,

  gradeLabels,
  boundarySeries,
  papersFor,
  boundaryFor,
  scoreToGrade,
  findGradeMark,
  normalizeTable,
  canonicalGradeKey,

  boardLabel,
  qualLabel,
  monthOf,
  tierFromName,
  courseKey: schema.courseKey,
  seriesId: schema.seriesId,
  normalizeTitle: schema.normalizeTitle,

  recentlyAttempted,
  rememberAttempt,
  retryWindowMs
});

export default Exam;