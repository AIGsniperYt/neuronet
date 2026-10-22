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
import { acquireExamData, getForSitting, UNKNOWN_REASONS } from "./ingest.js";
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

import { discoverCourseCatalogue } from "./app.js";

function indexFromSnapshot(snap) {
  const courses = new Map(discoverCourseCatalogue().map((c) => [c.id, { ...c }]));
  for (const r of (snap && snap.examCourses) || []) {
    if (r && r.id) courses.set(r.id, { ...r });
  }
  const sources = new Map((snap.examSources || []).map((r) => [r.id, { ...r }]));
  const boundaries = new Map();
  for (const boundary of snap.examBoundaries || []) {
    if (boundary && boundary.id && sourcesValidFor(boundary, { ...snap, _sourceMap: sources })) {
      boundaries.set(boundary.id, { ...boundary });
    }
  }
  return {
    courses,
    series: new Map((snap.examSeries || []).map((r) => [r.id, { ...r }])),
    boundaries,
    papers: new Map((snap.examPapers || []).map((r) => [r.id, { ...r }])),
    sources
  };
}

// A boundary's provenance is valid when it resolves to at least one canonical
// Source record (the id link from #14) and is not in a failed/conflicting
// state. A source-less boundary built by legacy migration is valid only if its
// stored provenance is not failed/conflicting — never upgraded, never assumed.
function sourcesValidFor(boundary, snap) {
  if (!boundary) return false;
  const provenance = boundary.provenance || {};
  if (provenance.kind !== "official" || provenance.verification !== "verified"
    || provenance.sourceName !== "official-pdf-row-parser") return false;
  const ids = Array.isArray(boundary.sourceIds) ? boundary.sourceIds : [];
  if (!ids.length) return false;
  const sources = snap._sourceMap || new Map((snap.examSources || []).map((s) => [s.id, s]));
  const courseBoard = String(boundary.courseKey || "").split(":")[0];
  return ids.some((sid) => {
    const source = sources.get(sid);
    const contentHash = String(source && source.contentHash || "");
    if (!source || source.verification !== "verified" || !/^[a-f0-9]{64}$/i.test(contentHash)
      || provenance.contentHash !== contentHash) return false;
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") return false;
      const host = url.hostname.toLowerCase();
      if (courseBoard === "aqa") {
        if (host === "aqa.org.uk" || host.endsWith(".aqa.org.uk")) return true;
        // AQA publishes recent series from its own Sanity project; accept that
        // project only, never Sanity at large.
        return host === "cdn.sanity.io" && url.pathname.startsWith("/files/p28bar15/green/");
      }
      if (courseBoard === "pearson") return host === "pearson.com" || host.endsWith(".pearson.com");
      return false;
    } catch {
      return false;
    }
  });
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
    const sInfo = seriesRecord
      ? { month: seriesRecord.month, year: seriesRecord.year, label: seriesRecord.label }
      : (() => {
          const parts = String(seriesId || "").split("-");
          const month = parts[0] || "JUN";
          const year = Number(parts[1]) || 2025;
          return { month, year, label: `${month} ${year}` };
        })();
    const env = await acquireExamData({
      board: board || (course && course.board),
      qual: qual || (course && course.qual),
      courseKey: courseId,
      series: sInfo
    }, { fetchImpl, proxyFn, onProgress });
    const snap2 = await storage.loadSnapshot();
    const boundary2 = (snap2.examBoundaries || []).find((b) => b.id === boundaryKey) || null;
    result.boundary = boundary2;
    result.sourcesValid = sourcesValidFor(boundary2, snap2);
    result.acquired = env;
    if (boundary2 && result.sourcesValid) {
      result.status = ENSURE_STATUS.COMPLETE;
      result.reason = "acquired";
    } else {
      // The acquisition outcome is the authoritative reason a read model has no
      // table. Do not keep the request-shaped placeholder: it hides the real
      // fetch/parse failure from the tracker and from diagnostics.
      result.reason = (env && env.reason) || UNKNOWN_REASONS.NO_EXACT_SOURCE;
      result.missing = ["boundary"];
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
  fetchImpl, proxyFn, onProgress,
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
  const explicitlyPersisted = (snap.examCourses || []).some((course) => course && course.id === ck);

  if (!explicitlyPersisted && !confirm) {
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

  if (!explicitlyPersisted) {
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
    board, qual, acquire, fetchImpl, proxyFn, onProgress, priority
  });
  const snapFinal = await storage.loadSnapshot();
  const repoFinal = openExamRepository(indexFromSnapshot(snapFinal));
  const decision = await getForSitting(repoFinal, enrollment, String(yearN), seriesWord, {});
  return { ...ensured, confirmationRequired: false, conflict: null, decision };
}

function tierOf(course) {
  const t = String(course && course.tier || "").toUpperCase();
  return t === "H" || t === "F" ? t : null;
}