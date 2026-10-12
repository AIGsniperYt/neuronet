// examData/bridge.js — legacy table-shape conversion helper.
//
// Runtime acquisition now goes through Exam.ensureForSitting → ingest.js.
// This pure adapter remains for older integrations/tests that need to convert
// a board-table record into the canonical repository shape.
//
// Identity is preserved end to end: a row fetched for
//   aqa / gcse / 8461 / Higher / JUN / 2025
// is stored under the canonical courseKey "aqa:gcse:8461:H" and seriesId
// "JUN-2025", which is exactly what the repository looks up. Nothing is
// renamed, re-keyed or approximated in between.

import * as schema from "./schema.js";

/**
 * Convert one legacy exact-table shape into a canonical boundary record.
 * Returns null when the row cannot be keyed exactly — an unkeyable row is
 * dropped rather than stored under an approximate identity.
 */
export function toCanonicalBoundary(table) {
  if (!table) return null;
  const ck = schema.courseKey({
    board: table.board,
    qual: table.qual,
    code: table.code,
    tier: table.tier
  });
  const sid = schema.seriesId({ month: table.month, year: table.year });
  if (!ck || !sid) return null;

  const grades = {};
  const gradesInOrder = [];
  table.grades.forEach((grade, index) => {
    const mark = table.marks[index];
    if (!Number.isFinite(mark)) return;
    grades[grade] = mark;
    gradesInOrder.push(grade);
  });
  if (!gradesInOrder.length) return null;

  return {
    id: `${ck}|${sid}`,
    courseKey: ck,
    seriesId: sid,
    board: table.board,
    qual: table.qual,
    code: table.code,
    tier: table.tier || null,
    title: table.title || null,
    series: {
      month: table.month,
      year: table.year,
      label: schema.seriesLabel({ month: table.month, year: table.year })
    },
    grades,
    gradesInOrder,
    maxMark: table.maxMark ?? null,
    papers: Array.isArray(table.papers) ? table.papers : [],
    provenance: {
      kind: "official",
      parsedAt: Date.now(),
      publisher: table.source ? table.source.publisher : null,
      url: table.source ? table.source.url : null,
      verifiedOn: table.source ? table.source.verifiedOn : null,
      verification: "uncertain",
      sourceName: "legacy-table-adapter"
    }
  };
}
