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

// Legal transitions only. A job can never jump to arbitrary states — the
// machine enforces intent (retryable re-queues; a failed job never becomes
// succeeded; a succeeded job is terminal unless revalidated).
const TRANSITIONS = Object.freeze({
  [JOB_STATES.QUEUED]: [JOB_STATES.RUNNING],
  [JOB_STATES.RUNNING]: [JOB_STATES.SUCCEEDED, JOB_STATES.RETRYABLE, JOB_STATES.PERMANENT_FAILURE, JOB_STATES.UNCERTAIN],
  [JOB_STATES.RETRYABLE]: [JOB_STATES.QUEUED, JOB_STATES.RUNNING],
  [JOB_STATES.SUCCEEDED]: [],
  [JOB_STATES.PERMANENT_FAILURE]: [],
  [JOB_STATES.UNCERTAIN]: []
});

export function transitionJob(job, next, { error, now = Date.now(), retryAt } = {}) {
  if (!job || !job.id) return { ok: false, job: null, error: "no job" };
  const cur = String(job.state || "").toLowerCase();
  if (cur === next) return { ok: true, job };
  const allowed = TRANSITIONS[cur] || [];
  if (!allowed.includes(next)) {
    return { ok: false, job, error: `illegal transition ${cur} -> ${next}` };
  }
  return {
    ok: true,
    job: {
      ...job,
      state: next,
      attempts: (Number(job.attempts) || 0) + 1,
      updatedAt: now,
      lastError: error || job.lastError || null,
      retryAt: retryAt || null
    }
  };
}

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

// Map acquisition outcome to the machine state (deterministic per reason).
// Transient/network-ish reasons retry; deterministic rejections are permanent
// (the data does not exist as requested); anything else is uncertain.
const RETRYABLE_REASONS = new Set([
  "FETCH_FAILED", "RATE_LIMITED", "DISCOVERY_INCOMPLETE", "NO_EXACT_SOURCE", "UNKNOWN_METADATA"
]);
export function outcomeToState(reason) {
  return RETRYABLE_REASONS.has(reason)
    ? JOB_STATES.RETRYABLE
    : JOB_STATES.PERMANENT_FAILURE;
}

// The next job to run: runnable (queued, or retryable past its backoff) sorted
// by priority (lower = sooner), then oldest first. Returns null when idle.
export function nextDueJob(jobs, now = Date.now()) {
  const runnable = (jobs || []).filter((j) => {
    if (!j) return false;
    const s = String(j.state || "").toLowerCase();
    if (s === JOB_STATES.QUEUED) return true;
    if (s === JOB_STATES.RETRYABLE) return !j.retryAt || Number(j.retryAt) <= now;
    return false;
  });
  if (!runnable.length) return null;
  runnable.sort((a, b) => {
    const pa = rankOfPriority(a.priority);
    const pb = rankOfPriority(b.priority);
    if (pa !== pb) return pa - pb;
    return Number(a.createdAt) - Number(b.createdAt);
  });
  return runnable[0];
}

function rankOfPriority(p) {
  const n = Number(String(p || "").match(/\d/)?.[0] || 5);
  return Number.isFinite(n) ? n : 5;
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
  const month = monthFromWord(sitting.series);
  // A blank/unmapped series word stays UNKNOWN — never invent "JUN". The
  // repository resolves a month-less sitting only when exactly one series for
  // that year exists; everything else surfaces as unknown/ambiguous.
  const series = { month: month || null, year };
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
  // Deterministic execution order: ascending year first (2024 before 2025),
  // boundary before papers for the same course+series.
  const list = [...out.values()];
  list.sort((a, b) => {
    const y = Number(a.series.year) - Number(b.series.year);
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