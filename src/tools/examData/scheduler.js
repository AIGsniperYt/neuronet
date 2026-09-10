// examData/scheduler.js — dependency-acquisition planner.
//
// Replaces the "warm flight" mental model: instead of "go fetch everything a
// recent sweep decided", the scheduler derives work from what the tracker
// actually needs — for each dated sitting, the paper catalogue and the
// boundary table of its exact course+series. It is a pure planner; execution
// is injected (the browser layer owns fetch, status, retry windows).

import { qualId, monthFromWord, seriesId, courseKey } from "./schema.js";

export const REQUIREMENT_TYPES = {
  BOUNDARY: "boundary",
  PAPERS: "papers"
};

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