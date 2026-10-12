// examData/ingest.js — the canonical acquisition pipeline integrated with uk-exam-engine.

import {
  courseKey,
  courseKeyFromRow,
  seriesId,
  qualId,
  boardId,
  parseCourseKey,
  singleCode,
  monthFromWord,
  paperRecordId,
  sourceRecordId,
  seriesLabel as fmtSeriesLabel
} from "./schema.js";
import { provenanceOf, VERIFY } from "./provenance.js";
import * as storage from "./storage.js";
import { ExamEngineClient, sortGradesDescending } from "../../../../packages/uk-exam-engine/src/index.js";

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

// Global standalone engine client instance for Neuronet
const engineClient = new ExamEngineClient();

async function persistEngineResult(engineResult, request) {
  const now = Date.now();
  const seriesInfo = request.series || { month: "JUN", year: 2025 };
  const sid = seriesId(seriesInfo);

  const seriesRecord = {
    id: sid,
    month: seriesInfo.month,
    year: Number(seriesInfo.year),
    label: fmtSeriesLabel(seriesInfo),
    qual: qualId(request.qual),
    board: (request.board || "aqa").toLowerCase()
  };
  await storage.putSeries(seriesRecord);

  for (const doc of engineResult.documents || []) {
    const sidDoc = sourceRecordId(doc.url);
    await storage.putSource({
      id: sidDoc,
      url: doc.url,
      contentHash: doc.sha256 || "hash",
      status: 200,
      title: doc.title,
      publisher: doc.publisher,
      accessedAt: now,
      verifiedAt: now
    });
  }

  for (const b of engineResult.boundaries || []) {
    const p = parseCourseKey(b.courseId);
    const ck = b.courseId;
    
    if (p) {
      await storage.putCourse({ id: ck, board: p.board, qual: p.qual, code: p.code, tier: p.tier });
    }

    const orderedGrades = b.gradesInOrder || sortGradesDescending(Object.keys(b.grades || {}));

    const boundary = {
      id: `${ck}|${sid}`,
      courseKey: ck,
      seriesId: sid,
      series: { month: seriesInfo.month, year: Number(seriesInfo.year), label: fmtSeriesLabel(seriesInfo) },
      grades: b.grades,
      gradesInOrder: orderedGrades,
      maxMark: b.maximumMark,
      tier: p ? p.tier : null,
      sourceIds: (engineResult.documents || []).map(d => sourceRecordId(d.url)),
      provenance: provenanceOf({
        kind: "official",
        url: engineResult.documents && engineResult.documents[0] ? engineResult.documents[0].url : null,
        parsedAt: now,
        contentHash: b.sourceDocumentId || "hash",
        verification: VERIFY.VERIFIED,
        sourceName: "uk-exam-engine",
        publisher: b.provenance ? b.provenance.publisher : "Official Board",
        sourceTitle: b.id,
        parserVersion: "1.0"
      })
    };
    await storage.putBoundary(boundary);
  }
}

export async function acquireExamData(request, opts = {}) {
  const reqBoard = (request && (request.board || (request.courseKey && parseCourseKey(request.courseKey)?.board))) || "aqa";
  const reqQual = (request && (request.qual || (request.courseKey && parseCourseKey(request.courseKey)?.qual))) || "gcse";
  
  let reqCode = request && request.code;
  let reqTier = request && request.tier;
  
  if (!reqCode && request && request.courseKey) {
    const p = parseCourseKey(request.courseKey);
    if (p) {
      reqCode = p.code;
      reqTier = p.tier;
    }
  }

  const seriesInfo = (request && request.series) || { month: "JUN", year: 2025 };

  try {
    const engineResult = await engineClient.query({
      board: reqBoard,
      qualification: reqQual,
      specificationCode: reqCode,
      tier: reqTier,
      series: seriesInfo
    }, { fetchImpl: opts.fetchImpl });

    if (!engineResult.boundaries || engineResult.boundaries.length === 0) {
      return unknown(UNKNOWN_REASONS.NO_EXACT_SOURCE, { stage: "engine-query" });
    }

    await persistEngineResult(engineResult, request);

    const targetB = engineResult.boundaries[0];
    const gradesInOrder = targetB.gradesInOrder || sortGradesDescending(Object.keys(targetB.grades || {}));
    const topVal = gradesInOrder.length > 0 ? Number(targetB.grades[gradesInOrder[0]]) : null;

    const table = {
      grades: targetB.grades || {},
      gradesInOrder,
      maxMark: targetB.maximumMark,
      board: reqBoard,
      qual: reqQual,
      seriesLabel: fmtSeriesLabel(seriesInfo),
      seriesKey: seriesId(seriesInfo)
    };

    return {
      kind: "official",
      reason: "acquired",
      table,
      top: Number.isFinite(topVal) ? topVal : null,
      year: seriesInfo.year,
      seriesLabel: fmtSeriesLabel(seriesInfo),
      sourceLabel: engineResult.documents && engineResult.documents[0] ? engineResult.documents[0].url : reqBoard,
      hasTable: true,
      verification: VERIFY.VERIFIED,
      sources: engineResult.documents || []
    };
  } catch (err) {
    return unknown(UNKNOWN_REASONS.FETCH_FAILED, { stage: "engine-error", error: err.message });
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

export { UNKNOWN_REASONS as REASONS };