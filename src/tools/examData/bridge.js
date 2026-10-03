// examDataBridge.js — the seam between the clean engine and the tracker.
//
// The tracker already renders from ONE decision surface (Exam.decisionFor),
// and that surface reads the canonical store. Rather than teach the tracker
// about PDFs, URLs or parsers, this module puts tables produced by
// src/tools/boundaries.js into the canonical shape the repository expects, so
// every existing consumer sees them with no change.
//
// Identity is preserved end to end: a row fetched for
//   aqa / gcse / 8461 / Higher / JUN / 2025
// is stored under the canonical courseKey "aqa:gcse:8461:H" and seriesId
// "JUN-2025", which is exactly what the repository looks up. Nothing is
// renamed, re-keyed or approximated in between.

import * as boundaries from "../boundaries.js";

import * as storage from "./storage.js";
import { sync } from "./app.js";
import * as schema from "./schema.js";

/**
 * Convert one engine table into the canonical boundary record.
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
  table.grades.forEach((g, i) => {
    const mark = table.marks[i];
    if (!Number.isFinite(mark)) return;
    grades[g] = mark;
    gradesInOrder.push(g);
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
    series: { month: table.month, year: table.year, label: schema.seriesLabel({ month: table.month, year: table.year }) },
    grades,
    gradesInOrder,
    maxMark: table.maxMark ?? null,
    papers: Array.isArray(table.papers) ? table.papers : [],
    provenance: {
      kind: "official",
      parsedAt: Date.now(),
      publisher: table.source ? table.source.publisher : null,
      url: table.source ? table.source.url : null,
      verifiedOn: table.source ? table.source.verifiedOn : null
    }
  };
}

/**
 * Fetch one exact table and persist it in canonical form.
 * @returns {Promise<{ok:boolean, id?:string, reason?:string}>}
 */
export async function acquireBoundary({ board, qual, code, tier, year, series }) {
  const key = boundaries.boundaryKey({ board, qual, code, tier, year, series });
  if (!key) return { ok: false, reason: "INCOMPLETE_REQUEST" };

  const table = await boundaries.getBoundaries({ board, qual, code, tier, year, series });
  if (!table) return { ok: false, reason: "NO_EXACT_SOURCE" };

  const record = toCanonicalBoundary(table);
  if (!record) return { ok: false, reason: "UNKEYABLE_ROW" };

  try {
    await storage.putCourse({
      id: record.courseKey,
      board: record.board,
      qual: record.qual,
      code: record.code,
      tier: record.tier
    });
    await storage.putSeries({ id: record.seriesId, month: table.month, year: table.year });
    await storage.putBoundary(record);
  } catch (err) {
    return { ok: false, reason: "PERSIST_FAILED", error: String((err && err.message) || err) };
  }
  // Pull the new row into the in-memory read model. Without this the record is
  // stored but the renderer keeps reading the pre-fetch snapshot and shows
  // "Boundary: —" for a boundary it actually has.
  try { await sync(); } catch (err) { /* non-fatal: next read re-syncs */ }
  return { ok: true, id: record.id };
}




export { boundaries };