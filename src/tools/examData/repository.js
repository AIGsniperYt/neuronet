// examData/repository.js — the canonical repository over the exam-data index.
//
// This is the ONE resolution path for display. Renderers never decide a
// boundary value; they call `deriveBoundaryDecision(...)` on a repository and
// render the envelope verbatim. The legacy gradeBoundaries module wraps this.
//
// The comparator here is the smallest faithful port of the legacy lookup so
// behaviour is byte-for-byte compatible for cached data while the subsystem
// becomes self-contained (no import cycle with gradeBoundaries.js).

import {
  courseKey,
  parseCourseKey,
  normalizeTitle,
  monthFromWord,
  seriesLabel,
  qualName,
  boardName
} from "./schema.js";

export function numberEq(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seriesProximity(series, year, monthAbbr) {
  const y = numberEq(year);
  if (y === null || !series || series.year == null) return { d: 0, exactYear: false, exactMonth: false };
  const d = Math.abs(Number(series.year) - y);
  const sameMonth = monthAbbr ? String(series.month || "").trim().toUpperCase() === monthAbbr : true;
  return { d, exactYear: d === 0, exactMonth: sameMonth };
}

function boundsTooltipText(boundary) {
  const series = boundary && boundary.series;
  const lines = (boundary.gradesInOrder || []).filter((g) => Number.isFinite(Number(boundary.grades[g]))).map((g) => `${g}: ${Number(boundary.grades[g])}`);
  return `${seriesLabel(series) || "Grade boundaries"}` + (lines.length ? " · " + lines.join(", ") : "");
}

function topGradeOfTable(boundary) {
  const top = Array.isArray(boundary.gradesInOrder) && boundary.gradesInOrder.length ? boundary.gradesInOrder[0] : null;
  if (top == null || !boundary.grades || boundary.grades[top] == null) return null;
  const mark = Number(boundary.grades[top]);
  return Number.isFinite(mark) ? mark : null;
}

function findGradeMarkIn(boundary, label) {
  if (!boundary || !boundary.grades) return null;
  const wanted = String(label || "").replace(/\s+/g, "").toUpperCase();
  const ordered = Array.isArray(boundary.gradesInOrder) ? boundary.gradesInOrder : Object.keys(boundary.grades);
  for (const candidate of ordered) {
    if (String(candidate).replace(/\s+/g, "").toUpperCase() === wanted) return Number(boundary.grades[candidate]);
  }
  return null;
}

const FRESH_MS = 60 * 24 * 60 * 60 * 1000;

export function openExamRepository(index) {
  if (!index) return null;
  return {
    index,
    courses() { return [...index.courses.values()]; },
    courseFor(enrollment) {
      if (!enrollment) return null;
      const ck = courseKey(enrollment);
      if (ck && index.courses.has(ck)) return index.courses.get(ck);
      // title fallback (rows historically stored without codes)
      const title = normalizeTitle(enrollment && enrollment.title);
      if (!title) return null;
      const board = (enrollment && enrollment.board) || "";
      const qual = (enrollment && enrollment.qual) || "";
      let best = null;
      for (const course of index.courses.values()) {
        if (String(course.board).toLowerCase() !== String(board).toLowerCase()) continue;
        if (String(course.qual).toLowerCase() !== String(qual).toLowerCase()) continue;
        if (course.title !== title) continue;
        if (!best) best = course;
        if (best.tier !== (enrollment && enrollment.tier) && course.tier === (enrollment && enrollment.tier)) best = course;
      }
      return best;
    },
    seriesOf(course) {
      const out = [];
      for (const b of index.boundaries.values()) {
        if (b.courseKey !== courseKey(course)) continue;
        out.push(b.series);
      }
      return out;
    },
    // Paper catalogue for a course+series (legacy stored papers on the subject
    // row; canonical keeps them on the boundary record until phase D moves
    // papers to their own records).
    papersFor(course, series) {
      const ck = courseKey(course);
      const sid = series && series.id ? series.id : series && seriesKey(series);
      for (const b of index.boundaries.values()) {
        if (b.courseKey !== ck) continue;
        if (sid && sid !== b.seriesId) continue;
        if (Array.isArray(b.papers) && b.papers.length) return b.papers;
      }
      return null;
    },
    latestBoundary(course) {
      const ck = courseKey(course);
      if (!ck) return null;
      let best = null;
      for (const b of index.boundaries.values()) {
        if (b.courseKey !== ck) continue;
        if (!best) { best = b; continue; }
        if (Number(b.series.year) > Number(best.series.year)) best = b;
      }
      return best;
    },
    pickBoundary(course, year, seriesWord) {
      const requestedYear = numberEq(year === "" ? null : year);
      const monthAbbr = monthFromWord(seriesWord);
      let candidates = [];
      for (const b of index.boundaries.values()) {
        if (b.courseKey !== courseKey(course)) continue;
        const p = seriesProximity(b.series, requestedYear, monthAbbr);
        if (requestedYear !== null && !p.exactYear) continue;
        candidates.push({ b, p });
      }
      if (!candidates.length) return null;
      if (requestedYear !== null && monthAbbr) {
        // Exact month is a rule, not a preference: a "June 2024" request must
        // never resolve to a November 2024 table. No exact-match row -> no hit.
        const exact = candidates.filter((c) => c.p.exactMonth);
        if (!exact.length) return null;
        candidates = exact;
      } else if (requestedYear !== null && !monthAbbr) {
        // Month-less dated sitting: the year must resolve to exactly one
        // series. Two series in the same year is ambiguous — never silently
        // prefer one month over another.
        const distinct = new Set(candidates.map((c) => c.b.seriesId || ""));
        if (distinct.size > 1) return null;
      }
      const sorted = candidates.slice().sort((a, b) => {
        if (requestedYear === null) {
          const ya = Number(a.b.series && a.b.series.year) || 0;
          const yb = Number(b.b.series && b.b.series.year) || 0;
          if (ya !== yb) return yb - ya;
        }
        const aMain = !monthAbbr && String(a.b.series && a.b.series.month || "").toUpperCase() === "JUN";
        const bMain = !monthAbbr && String(b.b.series && b.b.series.month || "").toUpperCase() === "JUN";
        if (aMain !== bMain) return aMain ? -1 : 1;
        const ap = Number(a.b.provenance && a.b.provenance.parsedAt) || 0;
        const bp = Number(b.b.provenance && b.b.provenance.parsedAt) || 0;
        return bp - ap;
      });
      const chosen = sorted[0];
      return {
        boundary: chosen.b,
        fresh: Date.now() - (Number(chosen.b.provenance && chosen.b.provenance.parsedAt) || 0) <= FRESH_MS
      };
    }
  };
}

function seriesKey(series) {
  if (!series) return null;
  const m = String(series.month || "").trim().toUpperCase();
  const y = Number(series.year);
  return m && Number.isFinite(y) ? `${m}-${y}` : series.id || null;
}

// THE single derived decision. Contract is fixed; renderers consume verbatim.
//
//   kind: official | projected | manual | unknown
export function deriveBoundaryDecision(repo, enrollment, year, seriesWord, sitting = {}) {
  const yearNum = numberEq(year === "" ? null : year);
  const sourceLabel = (b) => {
    const ck = parseCourseKey(b.courseKey);
    return [ck ? boardName(ck.board) : null, ck ? qualName(ck.qual) : null, seriesLabel(b.series)].filter(Boolean).join(" · ") || "Official";
  };

  if (/^(mock|specimen)$/i.test(String(seriesWord || "").trim())) {
    return {
      kind: "unknown",
      reason: "mock-specimen",
      table: null,
      top: null,
      year: yearNum,
      seriesLabel: "Mock/specimen",
      sourceLabel: null,
      tip: "Mock and specimen papers carry no official grade boundaries.",
      hasTable: false
    };
  }

  const course = repo ? repo.courseFor(enrollment) : null;
  const hit = course ? repo.pickBoundary(course, yearNum, seriesWord) : null;
  if (hit) {
    const b = hit.boundary;
    const table = {
      grades: b.grades || {},
      gradesInOrder: Array.isArray(b.gradesInOrder) ? b.gradesInOrder : [],
      maxMark: b.maxMark || null,
      papers: Array.isArray(b.papers) && b.papers.length ? b.papers.slice() : [],
      board: b.courseKey.split(":")[0],
      qual: b.courseKey.split(":")[1],
      seriesLabel: seriesLabel(b.series),
      seriesKey: b.seriesId,
      fresh: hit.fresh
    };
    const baseTip = boundsTooltipText(b);
    const series = b.series || {};
    return {
      kind: yearNum != null ? "official" : "projected",
      reason: yearNum != null ? "exact-year-official" : "newest-published",
      table,
      top: topGradeOfTable(b),
      year: yearNum != null ? yearNum : (series.year != null ? Number(series.year) : null),
      seriesLabel: seriesLabel(series),
      sourceLabel: sourceLabel(b),
      tip: yearNum != null ? baseTip : "Projected (newest published) · " + baseTip,
      hasTable: true
    };
  }

  const snapshot = sitting && sitting.gradeBoundaries;
  const snapRows = snapshot && Array.isArray(snapshot.gradesInOrder) && snapshot.gradesInOrder.length;
  if (snapshot && snapRows) {
    return {
      kind: "manual",
      reason: "stored-snapshot",
      table: snapshot,
      top: topGradeOfTable(snapshot),
      year: yearNum,
      seriesLabel: snapshot.seriesLabel || null,
      sourceLabel: "Stored with this sitting",
      tip: "Stored with this sitting (manual) · " + boundsTooltipText(snapshot),
      hasTable: true
    };
  }

  const storedTop = numberEq(sitting && sitting.gradeBoundary);
  if (storedTop !== null) {
    return {
      kind: "manual",
      reason: "stored-top",
      table: null,
      top: storedTop,
      year: yearNum,
      seriesLabel: seriesWord ? seriesWord : null,
      sourceLabel: "Stored with this sitting",
      tip: `Stored value ${storedTop} — no full table on record.`,
      hasTable: false
    };
  }

  return {
    kind: "unknown",
    reason: yearNum != null ? "series-not-fetched" : "no-data",
    table: null,
    top: null,
    year: yearNum,
    seriesLabel: seriesWord ? seriesWord : null,
    sourceLabel: null,
    tip: yearNum != null
      ? `No ${yearNum} grade boundaries fetched for this course yet. The tracker deliberately does not guess — the series will appear when it is fetched.`
      : "No fetched boundary data for this course yet.",
    hasTable: false
  };
}

// Convenience: a ready envelope for a grade label against a decision table
// (returns null when the label is not carried by that year's table — not a
// substituted value from another year).
export function markForDecisionGrade(decision, label) {
  if (!decision || !decision.hasTable) return null;
  return findGradeMarkIn(decision.table, label);
}