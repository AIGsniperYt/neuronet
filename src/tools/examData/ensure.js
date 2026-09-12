// examData/ensure.js — the core "is exam data ready for this course+series?"
// public API (frontier #17). The tracker should talk to this (and getForSitting),
// never to adapters.
//
//   await ensureExamData({ courseId, seriesId })
//     → { status: "complete" | "partial" | "unknown", ... }
//
// Internally: course exists? → series exists? → boundary exists? → sources
// valid?  Anything missing is listed and returned; when `acquire` is true the
// acquisition pipeline runs immediately, otherwise a P0 job is queued so the
// scheduler knows what to acquire next. Nothing here fabricates a value.

import * as storage from "./storage.js";
import { openExamRepository } from "./repository.js";
import { acquirePearson, getForSitting, UNKNOWN_REASONS } from "./ingest.js";
import { createJob, REQUIREMENT_TYPES, JOB_PRIORITIES } from "./scheduler.js";
import { courseKey, parseCourseKey, seriesId, monthFromWord, qualId, boardId, baseCode } from "./schema.js";

export const ENSURE_STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNKNOWN: "unknown"
});

// Deterministic reasons for the "cannot ensure yet" states (frontier #19/#21).
// The reason is a string the tracker can surface without inventing a value.
export const IDENTITY_CONFLICT = "IDENTITY_CONFLICT";
export const UNMAPPED_SERIES = "UNMAPPED_SERIES";

function indexFromSnapshot(snap) {
  return {
    courses: new Map((snap.examCourses || []).map((r) => [r.id, { ...r }])),
    series: new Map((snap.examSeries || []).map((r) => [r.id, { ...r }])),
    boundaries: new Map((snap.examBoundaries || []).map((r) => [r.id, { ...r }])),
    papers: new Map((snap.examPapers || []).map((r) => [r.id, { ...r }])),
    sources: new Map((snap.examSources || []).map((r) => [r.id, { ...r }]))
  };
}

// A boundary's provenance is valid when it resolves to at least one canonical
// Source record (the id link from #14) and is not in a failed/conflicting
// state. A source-less boundary built by legacy migration is valid only if its
// stored provenance is not failed/conflicting — never upgraded, never assumed.
function sourcesValidFor(boundary, snap) {
  if (!boundary) return false;
  const v = boundary.provenance && boundary.provenance.verification;
  if (v === "failed" || v === "conflicting") return false;
  const ids = Array.isArray(boundary.sourceIds) ? boundary.sourceIds : [];
  if (ids.length) {
    return ids.some((sid) => {
      const src = (snap.examSources || []).find((s) => s && s.id === sid);
      return Boolean(src && src.url);
    });
  }
  return true;
}

export async function ensureExamData({
  courseId,
  seriesId,
  board,
  qual,
  acquire = false,
  fetchImpl,
  proxyFn,
  onProgress,
  parse,
  priority = JOB_PRIORITIES.P0_EXACT_REQUEST
} = {}) {
  const reason = "courseId/seriesId";
  if (!courseId || !seriesId) {
    return {
      status: ENSURE_STATUS.UNKNOWN,
      courseId, seriesId, course: null, series: null,
      boundary: null, sourcesValid: false,
      missing: ["identity"],
      queue: [],
      reason
    };
  }
  const snap = await storage.loadSnapshot();
  const repo = openExamRepository(indexFromSnapshot(snap));
  const boundaryKey = `${String(courseId)}|${String(seriesId)}`;
  const course = (repo && [...repo.index.courses.values()].find((c) => c.id === courseId)) || null;
  const seriesRecord = (snap.examSeries || []).find((s) => s && s.id === seriesId) || null;
  const boundary = (repo && repo.index.boundaries.get(boundaryKey)) || null;
  const sourcesValid = sourcesValidFor(boundary, snap);

  const result = {
    status: ENSURE_STATUS.UNKNOWN,
    courseId, seriesId,
    course, series: seriesRecord,
    boundary, sourcesValid,
    papers: { supported: false, count: 0 },
    missing: [],
    queue: [],
    reason
  };

  if (!course) {
    result.missing.push("course");
    return result; // identity itself unknown — no acquisition target exists
  }
  if (!seriesRecord) result.missing.push("series");
  if (!boundary) result.missing.push("boundary");
  else if (!sourcesValid) result.missing.push("sources");

  if (boundary && sourcesValid) {
    result.status = ENSURE_STATUS.COMPLETE;
    return result;
  }
  result.status = ENSURE_STATUS.PARTIAL;

  if (acquire) {
    // Acquisition needs the series identity (month+year). When the series
    // record itself is missing there is nothing to acquire yet — stay partial.
    if (seriesRecord) {
      const env = await acquirePearson({
        board: board || course.board,
        qual: qual || course.qual,
        courseKey: courseId,
        series: { month: seriesRecord.month, year: seriesRecord.year, label: seriesRecord.label }
      }, { fetchImpl, proxyFn, onProgress, parse });
      const snap2 = await storage.loadSnapshot();
      const boundary2 = (snap2.examBoundaries || []).find((b) => b.id === boundaryKey) || null;
      result.boundary = boundary2;
      result.sourcesValid = sourcesValidFor(boundary2, snap2);
      result.acquired = env;
      if (boundary2 && result.sourcesValid) result.status = ENSURE_STATUS.COMPLETE;
    }
  } else {
    result.queue = [
      createJob({
        type: REQUIREMENT_TYPES.BOUNDARY,
        courseKey: courseId,
        series: seriesRecord ? { month: seriesRecord.month, year: seriesRecord.year } : { year: null },
        seriesId
      }, { priority, reason: `ensure ${courseId}|${seriesId}` })
    ];
  }
  return result;
}

// ---- ExamData.ensureForSitting (frontier #18/#19) ---------------------------
// The tracker-facing surface alongside getForSitting: given the DESIRED course
// identity (board/qual/code/tier) and a series word/year, make sure the exam
// data for exactly that course+series is ready — and, crucially, never let a
// persisted-but-contradictory identity silently win (frontier #19).
//
//   persisted course: 1MA1 Foundation   requested: 1MA1 Higher
//   → IDENTITY_CONFLICT, confirmationRequired:true, conflict:{requested,persisted}
//     (nothing is written, nothing is mutated)
//   pass { confirm:true } → the REQUESTED identity is adopted as a NEW course
//     record and ensured; the persisted Foundation record is never rewritten.
//
// The result always carries a `decision` envelope (via getForSitting) so the
// tracker renders exactly what the repository resolves — no separate read hop.
export async function ensureForSitting({
  board, qual, code, tier, title,
  year, seriesWord,
  confirm = false, acquire = false,
  fetchImpl, proxyFn, onProgress, parse,
  priority = JOB_PRIORITIES.P0_EXACT_REQUEST
} = {}) {
  const yearN = Number(year);
  const month = monthFromWord(seriesWord);
  const base = (courseId, seriesIdValue) => ({
    status: ENSURE_STATUS.UNKNOWN,
    courseId, seriesId: seriesIdValue,
    course: null, series: null, boundary: null, sourcesValid: false,
    missing: [], queue: [], confirmationRequired: false
  });

  if (!Number.isFinite(yearN) || yearN <= 0 || !month) {
    return { ...base(null, month ? seriesId({ month, year: yearN }) : null), reason: UNMAPPED_SERIES };
  }

  const enrollment = { board, qual, code, tier, title };
  const ck = courseKey(enrollment);
  const sid = seriesId({ month, year: yearN });
  if (!ck || !sid) {
    return { ...base(ck, sid), reason: !ck ? UNKNOWN_REASONS.COURSE_UNRESOLVED : UNMAPPED_SERIES };
  }

  let snap = await storage.loadSnapshot();
  let repo = openExamRepository(indexFromSnapshot(snap));
  const resolved = repo && repo.courseFor(enrollment);

  if (!resolved && !confirm) {
    // A persisted course shares the base identity at a DIFFERENT tier (e.g.
    // Foundation persisted, Higher requested — the real demo-data export). The
    // engine must not silently switch the persisted course to the desired one:
    // that is the frontier #19 contradiction, surfaced as a deterministic
    // identity conflict that requires explicit user confirmation.
    const persisted = (snap.examCourses || []).find((c) =>
      c && c.id !== ck
        && boardId(c.board) === boardId(enrollment.board)
        && qualId(c.qual) === qualId(enrollment.qual)
        && baseCode(c.code) === baseCode(enrollment.code)
        && tierOf(c) && tierOf(enrollment) && tierOf(c) !== tierOf(enrollment));
    if (persisted) {
      return {
        ...base(ck, sid),
        reason: IDENTITY_CONFLICT,
        confirmationRequired: true,
        conflict: { requested: ck, persisted: persisted.id },
        missing: ["identity-conflict"],
        decision: await getForSitting(repo, enrollment, String(yearN), seriesWord, {})
      };
    }
  }

  if (!resolved) {
    // Explicit confirmation (or no persisted contradiction at all): adopt the
    // REQUESTED identity as a NEW course record. This is the confirmation step
    // #19 demands — the persisted Foundation record above is never touched; a
    // separate Higher identity is created for the Desire that was confirmed.
    const p = parseCourseKey(ck);
    await storage.putCourse({ id: ck, board: p.board, qual: p.qual, code: p.code, tier: p.tier });
    snap = await storage.loadSnapshot();
    repo = openExamRepository(indexFromSnapshot(snap));
  }

  const ensured = await ensureExamData({
    courseId: ck, seriesId: sid,
    board, qual, acquire, fetchImpl, proxyFn, onProgress, parse, priority
  });
  const decision = await getForSitting(repo, enrollment, String(yearN), seriesWord, {});
  return { ...ensured, confirmationRequired: false, conflict: null, decision };
}

function tierOf(course) {
  const t = String(course && course.tier || "").toUpperCase();
  return t === "H" || t === "F" ? t : null;
}