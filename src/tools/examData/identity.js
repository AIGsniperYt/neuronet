// examData/identity.js — document identity + course identity resolution.
//
// THE DOCUMENT IS WHAT THE FILE ACTUALLY IS; THE REQUEST IS WHAT WE ARE
// LOOKING FOR (frontier #6/#7). Validation lives on that comparison, so a file
// is never judged by what the request claimed it was.
//
//   DocumentIdentity
//     { publisher, qualification, series, documentType, scope, courses[] }
//
//   resolveCourseIdentity(enrollment, courses)
//     { state: "resolved" | "ambiguous" | "unresolved", course?, candidates }
//     — never "best". Scoring (evidence) only orders candidates for
//       inspection; automatic resolution requires deterministic evidence
//       (one exact code+tier winner). Ambiguity is surfaced, not picked.

import {
  qualId,
  singleCode,
  baseCode,
  tierOf,
  normalizeTitle
} from "./schema.js";

// ---- evidence scoring (order-only) ------------------------------------------
// Scoring NEVER picks a winner. It answers "inspect which candidate first?".
// Automatic resolution requires deterministic evidence — the resolver below
// returns "resolved" only when exactly one candidate carries the maximum
// exact-code, and no other candidate matches the same code+tier evidence.
export function scoreCourseCandidate(course, enrollment = {}) {
  const wantCode = singleCode(enrollment.code);
  const gotCode = singleCode(course && course.code);
  let score = 0;
  let disqualify = false;

  if (wantCode) {
    const sameBase = baseCode(gotCode) === baseCode(wantCode);
    if (!sameBase) return { course, score: -1000, evidence: [] };
    score += 4;
  } else if (!enrollment.title) {
    return { course, score: -1000, evidence: [] };
  }

  const evidence = [];
  if (wantCode) evidence.push("exact-code");
  if (wantCode && gotCode === wantCode) { score += 1; evidence.push("exact-code-full"); }

  const wantTier = String(enrollment.tier || "").toUpperCase();
  const gotTier = String(tierOf(course) || "").toUpperCase();
  if (wantTier) {
    if (gotTier === wantTier) { score += 3; evidence.push("exact-tier"); }
    else if (gotTier) { score -= 2; }
  }

  const wantQual = qualId(enrollment.qual);
  const gotQual = qualId(course && course.qual);
  if (wantQual && gotQual) {
    if (wantQual === gotQual) { score += 2; evidence.push("exact-qualification"); }
    else disqualify = true;
  }

  if (enrollment.title && normalizeTitle(course && course.title) === normalizeTitle(enrollment.title)) {
    score += 2;
    evidence.push("exact-title");
  }

  return { course, score: disqualify ? -1000 : score, evidence };
}

// Deterministic course identity resolution. Never returns a silent "best".
//   resolved   — exactly one candidate carries the exact-code evidence, and no
//                other candidate matches on code+tier; course is that one.
//   ambiguous  — more than one candidate shares the maximum deterministic
//                evidence (e.g. both tiers present with no tier hint, or two
//                courses claiming the same code+tier).
//   unresolved — no candidate carries exact-code/title evidence at all.
export function resolveCourseIdentity(enrollment, courses = []) {
  if (!enrollment) return { state: "unresolved", candidates: [] };
  const wantCode = singleCode(enrollment.code);
  const wantTitle = normalizeTitle(enrollment.title);

  let pool = courses;
  if (wantCode) {
    pool = pool.filter((c) => baseCode(singleCode(c && c.code)) === baseCode(wantCode));
  } else if (wantTitle) {
    pool = pool.filter((c) => normalizeTitle(c && c.title) === wantTitle);
  } else {
    return { state: "unresolved", candidates: [] };
  }

  const wantTier = String(enrollment.tier || "").toUpperCase();
  if (wantCode && wantTier) {
    pool = pool.filter((c) => String(tierOf(c) || "").toUpperCase() === wantTier);
  }

  if (!pool.length) return { state: "unresolved", candidates: [] };

  const scored = pool
    .map((c) => scoreCourseCandidate(c, enrollment))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { state: "unresolved", candidates: [] };
  const top = scored[0];
  const contenders = scored.filter((s) => s.score === top.score);
  // Two distinct courses sharing the top deterministic evidence = ambiguous.
  if (contenders.length === 1) {
    return { state: "resolved", course: top.course, candidates: scored, score: top.score };
  }
  // Title-matched ties (e.g. "Mathematics (Higher)" stored for both H and F)
  // resolve only when the enrollment's tier evidence pins exactly one.
  if (wantTier) {
    const tierPinned = contenders.filter((s) => String(tierOf(s.course) || "").toUpperCase() === wantTier);
    if (tierPinned.length === 1) {
      return { state: "resolved", course: tierPinned[0].course, candidates: scored, score: top.score };
    }
  }
  return { state: "ambiguous", candidates: scored, score: top.score };
}