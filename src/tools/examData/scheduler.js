// examData/scheduler.js — dependency-acquisition planner + job engine.
//
// The planner derives work from what the tracker actually needs — for each
// dated sitting, the paper catalogue and the boundary table of its exact
// course+series (pure; execution injected by the browser layer).
//
// The job engine (frontier #16) is the real scheduler: a job record moves
//   queued → running → succeeded | retryable | permanent-failure | uncertain
// with fixed priorities (P0 exact user request … P5 archive sweep). The brain
// therefore knows WHAT it should acquire next, not merely how to fetch.

import { qualId, monthFromWord, seriesId, courseKey, jobRecordId } from "./schema.js";

export const REQUIREMENT_TYPES = {
  BOUNDARY: "boundary",
  PAPERS: "papers"
};

// ---- job state machine ------------------------------------------------------
export const JOB_STATES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  RETRYABLE: "retryable",
  PERMANENT_FAILURE: "permanent-failure",
  UNCERTAIN: "uncertain"
});

export const JOB_PRIORITIES = Object.freeze({
  P0_EXACT_REQUEST: "P0-exact-request",
  P1_SITTING: "P1-sitting",
  P2_LINKED_HISTORY: "P2-linked-history",
  P3_RECENT_SERIES: "P3-recent-series",
  P4_MAINTENANCE: "P4-maintenance",
  P5_ARCHIVE_SWEEP: "P5-archive-sweep"
});

// Create a runnable job record from a requirement. Priority is fixed by the
// caller (or derived by priorityFor); a job is idempotent on its deterministic
// key so re-planning never duplicates work.
export function createJob(requirement, { priority = JOB_PRIORITIES.P1_SITTING, now = Date.now(), reason } = {}) {
  const r = requirement || {};
  const ck = r.courseKey || null;
  const sid = r.seriesId || seriesId(r.series) || null;
  return {
    id: jobRecordId(r.type || REQUIREMENT_TYPES.BOUNDARY, ck, sid),
    type: r.type || REQUIREMENT_TYPES.BOUNDARY,
    courseKey: ck,
    seriesId: sid,
    priority,
    state: JOB_STATES.QUEUED,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    runAt: now,
    reason: reason || r.key || null,
    lastError: null,
    retryAt: null
  };
}

// Priority decision (order-only heuristic; the caller can also override):
//   P0 exact user request (explicitly asked for this course+series now)
//   P1 a dated sitting an enrolled course actually takes
//   P2 linked history (same course, another series)
//   P3 recent series within the current exam-year window
//   P4 maintenance (revalidation)
//   P5 archive sweep
export function priorityFor({ exactRequest = false, fromSitting = false, linkedHistory = false, recent = false, maintenance = false, scan = false, now = Date.now(), year } = {}) {
  if (exactRequest) return JOB_PRIORITIES.P0_EXACT_REQUEST;
  if (fromSitting) return JOB_PRIORITIES.P1_SITTING;
  if (maintenance) return JOB_PRIORITIES.P4_MAINTENANCE;
  if (scan) return JOB_PRIORITIES.P5_ARCHIVE_SWEEP;
  if (linkedHistory) return JOB_PRIORITIES.P2_LINKED_HISTORY;
  if (recent || (year != null && Math.abs(year - new Date(now).getFullYear()) <= 1)) {
    return JOB_PRIORITIES.P3_RECENT_SERIES;
  }
  return JOB_PRIORITIES.P5_ARCHIVE_SWEEP;
}

export function mockOrSpecimen(seriesWord) {
  return /^(mock|specimen)$/i.test(String(seriesWord || "").trim());
}

// Map a sitting to a requirement skeleton, or null when nothing is needed yet
// (no year, mock/specimen, unknown course).
export function sittingRequirement(sitting, resolveEnrollment) {
  if (!sitting || !sitting.subject) return null;
  if (mockOrSpecimen(sitting.series)) return null;
  if (sitting.year == null || String(sitting.year).trim() === "") return null;
  const year = Number(sitting.year);
  if (!Number.isFinite(year) || year <= 0) return null;
  const enrollment = resolveEnrollment ? resolveEnrollment(sitting) : null;
  if (!enrollment) return null;
  const explicitMonth = monthFromWord(sitting.series);
  // A year-only sitting is not enough evidence to choose June vs November.
  // Preserve the unknown month; the UI may display a board-specific default,
  // but acquisition must not turn that presentation choice into source identity.
  const series = { month: explicitMonth || null, year };
  const ck = courseKey(enrollment);
  if (!ck) return null;
  const board = ck.split(":")[0];
  const qual = qualId(ck.split(":")[1]);
  const sid = seriesId(series);
  return {
    type: "blob", // set below per requirement kind
    board,
    qual,
    courseKey: ck,
    series,
    seriesId: sid,
    key: null // fully bound per kind
  };
}

// Deduplicated requirement set for a list of sittings. Papers and boundaries
// are two outputs of the same system, so both are required for every dated
// sitting; a requirement that is already satisfied by the repository is
// filtered out via the `isSatisfied` predicate the caller supplies.
export function planRequirements(sittings, resolveEnrollment, isSatisfied) {
  const out = new Map();
  const add = (type, base) => {
    const sid = base.seriesId || `Y${base.series.year}`; // keep months-unknown years distinct
    const key = `${type}|${base.courseKey}|${sid}`;
    if (out.has(key)) return;
    if (isSatisfied && isSatisfied(type, base.courseKey, base.seriesId, base)) return;
    out.set(key, { ...base, type, key });
  };
  for (const sitting of sittings || []) {
    const base = sittingRequirement(sitting, resolveEnrollment);
    if (!base) continue;
    add(REQUIREMENT_TYPES.BOUNDARY, base);
    add(REQUIREMENT_TYPES.PAPERS, base);
  }
  // Deterministic execution order: newest year first so the visible/current
  // sitting is fetched before the historical archive; boundary before papers
  // for the same course+series.
  const list = [...out.values()];
  list.sort((a, b) => {
    const y = Number(b.series.year) - Number(a.series.year);
    if (y !== 0) return y;
    const k = String(a.courseKey).localeCompare(String(b.courseKey));
    if (k !== 0) return k;
    return a.type === REQUIREMENT_TYPES.BOUNDARY ? -1 : 1;
  });
  return list;
}

export function summarize(requirements) {
  const types = { boundary: 0, papers: 0 };
  for (const r of requirements || []) types[r.type] += 1;
  return { total: requirements.length, ...types };
}
