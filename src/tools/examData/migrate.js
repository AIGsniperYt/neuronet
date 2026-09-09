// examData/migrate.js — turn the legacy `neuronet:gradeBoundaries` blob into
// the canonical exam-data index without losing or inventing anything.
//
//   legacy entry:     { series:{month,year,label}, qual, board, fetchedAt,
//                       subjects:[ {title, code, tier, grades, gradesInOrder,
//                                    maxMark, papers, ...}, ... ] }
//   canonical index:
//     courses:    Map courseKey => { board, qual, code, tier, title }
//     series:     Map serieId  => { month, year, label }
//     boundaries: Map courseKey + "|" + seriesId => { courseKey, seriesId,
//                     grades, gradesInOrder, maxMark, papers,
//                     provenance: { kind:"official", parsedAt } }
//     sources:    List of { url?, kind } contributed while scanning

import {
  courseKeyFromRow,
  qualId,
  seriesId,
  seriesLabel,
  tierOf,
  singleCode,
  normalizeTitle
} from "./schema.js";
import { provenanceOf } from "./provenance.js";

// keys of a legacy cache entry (board:MONTH-YEAR:qual; month may be any case)
function entryKeyParts(key) {
  const m = /^([a-z]+):([a-z]+)-(\d{4}):(.*)$/i.exec(String(key || ""));
  if (!m) return null;
  const month = m[2].toUpperCase();
  const year = Number(m[3]);
  return {
    board: m[1].toLowerCase(),
    series: { month, year, label: seriesLabel({ month, year }) },
    qualRaw: m[4]
  };
}

export function buildExamIndex(cache) {
  const courses = new Map();
  const series = new Map();
  const boundaries = new Map();
  const sources = [];
  let legacyEntries = 0;
  let unkeyableRows = 0;

  const entries = (cache && cache.entries) || {};
  for (const [key, entry] of Object.entries(entries)) {
    const parts = entryKeyParts(key);
    if (!parts) continue;
    legacyEntries += 1;
    const qid = qualId(entry.qual || parts.qualRaw);
    const sid = seriesId(parts.series);
    if (!sid) continue;
    series.set(`${qid}|${sid}`, { ...parts.series, qual: qid, board: parts.board });
    const parsedAt = entry.fetchedAt ? Number(entry.fetchedAt) : Date.now();

    for (const row of entry.subjects || []) {
      const ck = courseKeyFromRow(parts.board, qid, row);
      if (!ck) {
        unkeyableRows += 1;
        continue;
      }
      if (!courses.has(ck)) {
        courses.set(ck, {
          board: parts.board,
          qual: qid,
          code: singleCode(row.code) || null,
          tier: tierOf(row) || null,
          title: normalizeTitle(row.title || ""),
          sourceLabel: `${seriesLabel(parts.series)}`
        });
      }
      const boundaryKey = `${ck}|${sid}`;
      boundaries.set(boundaryKey, {
        courseKey: ck,
        seriesId: sid,
        series: { ...parts.series },
        grades: row.grades || {},
        gradesInOrder: Array.isArray(row.gradesInOrder) ? row.gradesInOrder : [],
        maxMark: row.maxMark || null,
        tier: tierOf(row),
        papers: Array.isArray(row.papers) && row.papers.length ? row.papers.slice() : [],
        provenance: provenanceOf({ kind: "official", parsedAt })
      });
    }

    // The legacy cache is populated exclusively by official-source parsers
    // (fetchBoundarySubjects/ensureBoundarySeries), so an entry itself is a
    // source-of-record signal — but URL provenance was never stored before.
    if (entry.subjects && entry.subjects.length) {
      sources.push({ board: parts.board, qual: qid, series: parts.series, kind: "official", parsedAt, url: null });
    }
  }

  return {
    courses,
    series,
    boundaries,
    sources,
    stats: { legacyEntries, unkeyableRows, courseCount: courses.size, seriesCount: series.size, boundaryCount: boundaries.size }
  };
}

// Migrate a tracker sitting's boundary fields: any value it carries is "manual"
// this repo can't prove (matches the legacy reality: sittings stored plain
// numbers/tables, never provenance). Returns the sitting's boundary provenance.
export function migrateSitting(sitting) {
  const hasTable = !!(sitting && sitting.gradeBoundaries);
  const hasTop = !!(sitting && (sitting.gradeBoundary == null ? false : String(sitting.gradeBoundary) !== ""));
  if (hasTable || hasTop) {
    return provenanceOf({ kind: "manual", reason: "stored-with-sitting" });
  }
  return provenanceOf({ kind: null });
}