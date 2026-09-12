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
import { acquirePearson } from "./ingest.js";
import { createJob, REQUIREMENT_TYPES, JOB_PRIORITIES } from "./scheduler.js";

export const ENSURE_STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNKNOWN: "unknown"
});

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