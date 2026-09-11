// examData/validation.js — strong structural + identity validation (spec #56).
//
// Weak legacy validation only checked existence and monotonicity. This module
// validates a parsed boundary record against the whole identity contract:
//   course identity (code), tier, qualification, year/month, maxMark,
//   grade-label legality for the qual's scale, strict monotonicity, and
//   qualification-level vs component-level tables. It never "repairs" a value —
//   it reports problems; the pipeline drops or marks records accordingly.

import {
  qualId,
  qualGradeScale,
  qualGradeScope,
  isDoubleAwardGrades,
  baseCode,
  singleCode,
  monthFromWord,
  canonicalGradeKey
} from "./schema.js";

// Problems list contract: each entry is a string in the form
// "AREA: description". Empty list == valid.
export function validateParsedBoundary(record, expected = {}) {
  const problems = [];
  const row = record && record.row ? record.row : record;
  if (!row || typeof row !== "object") return { ok: false, problems: ["record: missing row"] };

  const board = String(expected.board || row.board || "").toLowerCase();
  const qual = expected.qual || row.qual || null;
  const qid = qualId(qual);

  // ---- course identity (spec #52) -----------------------------------------
  const code = singleCode(row.code);
  if (!code) problems.push(`course: subject row has no code`);
  if (!qid) {
    problems.push(`course: qualification "${String(qual)}" unrecognised`);
  } else if (expected.code) {
    const wantBase = baseCode(singleCode(expected.code));
    const gotBase = baseCode(code);
    if (wantBase !== gotBase) {
      problems.push(`course: parsed code "${code}" != expected "${expected.code}"`);
    } else {
      const wantTier = String(expected.tier || "").toUpperCase();
      const gotTier = String(row.tier || "").toUpperCase();
      if (wantTier && gotTier && wantTier !== gotTier) {
        problems.push(`tier: parsed tier "${gotTier}" != expected tier "${wantTier}"`);
      }
    }
  }

  // ---- series identity (spec #53 wrong-year / #54 wrong-series) ------------
  if (expected.series) {
    const expYear = Number(expected.series.year);
    const gotYear = Number(row.series && row.series.year);
    if (Number.isFinite(expYear) && gotYear !== expYear) {
      problems.push(`series: row year ${gotYear} != expected ${expYear} (wrong-year guard)`);
    }
    if (expected.series.month) {
      const expMonth = String(expected.series.month).toUpperCase();
      const gotMonth = String((row.series && row.series.month) || "").toUpperCase();
      if (gotMonth && monthFromWord(expMonth) && gotMonth !== monthFromWord(expMonth)) {
        problems.push(`series: row month ${gotMonth} != expected ${expMonth} (wrong-series guard)`);
      }
    }
  }

  // ---- max mark (spec #18 component-vs-qualification / maxMark) -----------
  const maxMark = Number(row.maxMark);
  if (!Number.isFinite(maxMark) || maxMark <= 0) {
    problems.push(`maxmark: missing or not a positive number`);
  } else if (!Number.isInteger(maxMark)) {
    problems.push(`maxmark: not an integer (${maxMark})`);
  }

  // ---- grade table ---------------------------------------------------------
  const grades = row.grades;
  const gradesInOrder = Array.isArray(row.gradesInOrder) ? row.gradesInOrder : [];
  if (!grades || typeof grades !== "object" || gradesInOrder.length === 0) {
    return { ok: false, problems: [...problems, "grades: no table to validate"] };
  }

  if (isDoubleAwardGrades(grades)) {
    if (!expected.allowDoubleAward) {
      problems.push(`grades: double-award paired labels (9-9 …) reported as ordinary grades`);
    }
  } else if (qid) {
    const scale = qualGradeScale(qid);
    const scope = qualGradeScope(qid);
    for (const rawLabel of gradesInOrder) {
      const label = canonicalGradeKey(rawLabel);
      if (/^\d-\d$/.test(label) && expected.allowDoubleAward) continue;
      if (!scale.includes(label) && label !== "U") {
        problems.push(`grades: label "${rawLabel}" not legal for ${scope} scale`);
      }
    }
  }

  // ---- strict monotonicity (spec #17) -------------------------------------
  const values = gradesInOrder
    .map((g) => Number(grades[g]))
    .filter((v) => Number.isFinite(v));
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] >= values[i - 1]) {
      problems.push(`grades: marks not strictly descending ("${gradesInOrder[i]}" ${values[i]} >= "${gradesInOrder[i - 1]}" ${values[i - 1]})`);
      break;
    }
  }

  const evidence = {
    courseCodeEvidence: code || null,
    matchedexpectedCode: Boolean(expected.code) && baseCode(singleCode(expected.code)) === baseCode(code),
    parserConfidence: Number(row._parserConfidence) || (problems.length === 0 ? 1 : 0)
  };
  return { ok: problems.length === 0, problems, evidence };
}

// Normalize the parsed output of a board parser into a canonical row shape
// (grades keyed by canonical label, tier from title/code, series from source).
// Never edits parsed values — only re-keys/fields, preserving order.
export function normalizeParsedRow(row, series, board, qual) {
  if (!row) return null;
  const grades = {};
  for (const [k, v] of Object.entries(row.grades || {})) {
    grades[canonicalGradeKey(k)] = v;
  }
  const gradesInOrder = (row.gradesInOrder || []).map(canonicalGradeKey);
  return {
    code: singleCode(row.code) || null,
    title: String(row.title || "").trim() || null,
    tier: String(row.tier || "").toUpperCase() || null,
    maxMark: Number(row.maxMark) || null,
    grades,
    gradesInOrder,
    series: series ? { month: series.month, year: Number(series.year), label: series.label || null } : null,
    board: board || row.board || null,
    qual: qual || row.qual || null,
    _parserConfidence: Number(row._parserConfidence) || undefined
  };
}