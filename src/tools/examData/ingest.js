// examData/ingest.js — exact official-source acquisition and canonical persistence.

import {
  courseKey,
  seriesId,
  qualId,
  boardId,
  parseCourseKey,
  singleCode,
  monthFromWord,
  sourceRecordId,
  seriesLabel as fmtSeriesLabel
} from "./schema.js";
import { provenanceOf, VERIFY } from "./provenance.js";
import * as storage from "./storage.js";
import { getBoundaries } from "../boundaries.js";

export const UNKNOWN_REASONS = Object.freeze({
  COURSE_UNRESOLVED: "COURSE_UNRESOLVED",
  AMBIGUOUS: "AMBIGUOUS",
  NO_EXACT_SOURCE: "NO_EXACT_SOURCE",
  DISCOVERY_INCOMPLETE: "DISCOVERY_INCOMPLETE",
  UNKNOWN_METADATA: "UNKNOWN_METADATA",
  TIER_MISMATCH: "TIER_MISMATCH",
  CONFLICTING_SOURCES: "CONFLICTING_SOURCES",
  PARSER_FAILED: "PARSER_FAILED",
  WRONG_YEAR: "WRONG_YEAR",
  WRONG_SERIES: "WRONG_SERIES",
  WRONG_DOCUMENT: "WRONG_DOCUMENT",
  WRONG_QUALIFICATION: "WRONG_QUALIFICATION",
  COMPONENT_BOUNDARY: "COMPONENT_BOUNDARY",
  FETCH_FAILED: "FETCH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND"
});

function unknown(reason, extra = {}) {
  return { kind: "unknown", reason, table: null, top: null, hasTable: false, ...extra };
}

async function persistBoundaryTable(table, request) {
  const now = Date.now();
  const seriesInfo = request.series;
  const sid = seriesId(seriesInfo);
  const ck = courseKey({
    board: request.board,
    qual: request.qual,
    code: request.code,
    tier: request.tier
  });
  const url = table.source && table.source.url;
  if (!sid || !ck || !url) throw new Error("VERIFIED_SOURCE_REQUIRED");

  await storage.putCourse({
    id: ck,
    board: boardId(request.board),
    qual: qualId(request.qual),
    code: singleCode(request.code),
    tier: request.tier || null
  });
  await storage.putSeries({
    id: sid,
    month: seriesInfo.month,
    year: Number(seriesInfo.year),
    label: fmtSeriesLabel(seriesInfo),
    qual: qualId(request.qual),
    board: boardId(request.board)
  });
  const sourceId = sourceRecordId(url);
  await storage.putSource({
    id: sourceId,
    url,
    contentHash: table.source.contentHash || null,
    status: 200,
    title: table.source.title || `${boardId(request.board)} ${fmtSeriesLabel(seriesInfo)} grade boundaries`,
    publisher: table.source.publisher,
    accessedAt: now,
    verifiedAt: now,
    verification: VERIFY.VERIFIED
  });

  const grades = Object.fromEntries(table.grades.map((grade, i) => [grade, table.marks[i]]));
  await storage.putBoundary({
    id: `${ck}|${sid}`,
    courseKey: ck,
    seriesId: sid,
    series: { month: seriesInfo.month, year: Number(seriesInfo.year), label: fmtSeriesLabel(seriesInfo) },
    grades,
    gradesInOrder: table.grades.slice(),
    maxMark: table.maxMark,
    tier: request.tier || null,
    sourceIds: [sourceId],
    provenance: provenanceOf({
      kind: "official",
      url,
      parsedAt: now,
      contentHash: table.source.contentHash || null,
      verification: VERIFY.VERIFIED,
      sourceName: "official-pdf-row-parser",
      publisher: table.source.publisher,
      sourceTitle: table.source.title || null,
      parserVersion: "2.0.0"
    })
  });
}

export async function acquireExamData(request, opts = {}) {
  const parsedCourse = request && request.courseKey ? parseCourseKey(request.courseKey) : null;
  const reqBoard = boardId(request && (request.board || (parsedCourse && parsedCourse.board)));
  const reqQual = qualId(request && (request.qual || (parsedCourse && parsedCourse.qual)));
  let reqCode = request && request.code;
  let reqTier = request && request.tier;
  if (!reqCode && request && request.courseKey) {
    reqCode = parsedCourse && parsedCourse.code;
    reqTier = parsedCourse && parsedCourse.tier;
  }
  reqCode = singleCode(reqCode);
  const reqMonth = monthFromWord(request && request.series && request.series.month);
  const reqYear = Number(request && request.series && request.series.year);
  if (!reqBoard || !reqQual || !reqCode || !Number.isInteger(reqYear) || !reqMonth) {
    return unknown(UNKNOWN_REASONS.UNKNOWN_METADATA, { stage: "request-validation" });
  }
  const seriesInfo = { month: reqMonth, year: reqYear };
  const exactRequest = { board: reqBoard, qual: reqQual, code: reqCode, tier: reqTier, series: seriesInfo };

  try {
    const acquired = await getBoundaries(exactRequest, opts);
    if (!acquired) return unknown(UNKNOWN_REASONS.NO_EXACT_SOURCE, { stage: "official-source" });
    if (reqTier && acquired.tier !== reqTier) return unknown(UNKNOWN_REASONS.TIER_MISMATCH, { stage: "row-identity" });
    if (!acquired.source || !acquired.source.url) return unknown(UNKNOWN_REASONS.WRONG_DOCUMENT, { stage: "source-verification" });

    const grades = Object.fromEntries(acquired.grades.map((grade, i) => [grade, acquired.marks[i]]));
    const gradesInOrder = acquired.grades.slice();
    const topVal = gradesInOrder.length ? Number(grades[gradesInOrder[0]]) : null;
    const sourceHash = acquired.source.contentHash || null;

    await persistBoundaryTable(acquired, { ...exactRequest, series: seriesInfo });

    const table = {
      grades,
      gradesInOrder,
      maxMark: acquired.maxMark,
      board: reqBoard,
      qual: reqQual,
      seriesLabel: fmtSeriesLabel(seriesInfo),
      seriesKey: seriesId(seriesInfo),
      source: acquired.source
    };

    return {
      kind: "official",
      reason: "acquired",
      table,
      top: Number.isFinite(topVal) ? topVal : null,
      year: seriesInfo.year,
      seriesLabel: fmtSeriesLabel(seriesInfo),
      sourceLabel: acquired.source.url,
      hasTable: true,
      verification: VERIFY.VERIFIED,
      sources: [{
        id: sourceRecordId(acquired.source.url),
        url: acquired.source.url,
        publisher: acquired.source.publisher,
        sha256: sourceHash,
        verification: VERIFY.VERIFIED
      }]
    };
  } catch (err) {
    return unknown(UNKNOWN_REASONS.FETCH_FAILED, { stage: "source-error", error: err.message });
  }
}

export function gateDecisionForVerification(repo, enrollment, year, seriesWord, decision) {
  const hit = decision.kind === "official" || decision.kind === "projected";
  if (!hit || !decision.table || decision.table.fresh === undefined) return decision;
  const boundary = (() => {
    const course = repo && repo.courseFor(enrollment);
    const ck = course && courseKey(course);
    const sid = seriesId({ month: monthFromWord(seriesWord), year: Number(year) });
    if (!ck || !sid) return null;
    const key = `${ck}|${sid}`;
    return (repo && repo.index && repo.index.boundaries && repo.index.boundaries.get(key)) || null;
  })();
  const verification = boundary && boundary.provenance && boundary.provenance.verification;
  if (verification === VERIFY.FAILED) {
    return { ...decision, kind: "unknown", reason: UNKNOWN_REASONS.WRONG_DOCUMENT, verification };
  }
  if (verification === VERIFY.CONFLICTING) {
    return { ...decision, kind: "unknown", reason: UNKNOWN_REASONS.CONFLICTING_SOURCES, verification };
  }
  return decision;
}

export async function getForSitting(repo, enrollment, year, seriesWord, sitting = {}) {
  const { deriveBoundaryDecision } = await import("./repository.js");
  const decision = deriveBoundaryDecision(repo, enrollment, year, seriesWord, sitting);
  return gateDecisionForVerification(repo, enrollment, year, seriesWord, decision);
}