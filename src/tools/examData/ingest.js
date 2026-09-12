// examData/ingest.js — the canonical acquisition pipeline.
//
//   DISCOVER → FETCH → PARSE → NORMALIZE → VALIDATE → PERSIST
//
// This module orchestrates the board-specific adapter (PearsonSource / AQA stub
// / OCR stub) through that pipeline. Conflict detection: when two fetched
// sources disagree on a grade mark for the same course+series, the result is
// `{ kind:"unknown", reason:"CONFLICTING_SOURCES" }` — never auto-picked
// (execution-spec #15).  The pipeline returns a decision envelope ready for
// `deriveBoundaryDecision` consumers to consume, plus structured unknown-
// reasons that the tracker surface can surface without inventing values.

import {
  courseKey,
  courseKeyFromRow,
  seriesId,
  qualId,
  parseCourseKey,
  singleCode,
  monthFromWord,
  paperRecordId,
  sourceRecordId,
  seriesLabel as fmtSeriesLabel
} from "./schema.js";
import { provenanceOf, VERIFY } from "./provenance.js";
import * as storage from "./storage.js";
import * as PearsonSource from "./sources/PearsonSource.js";
import { DISCOVERY_INCOMPLETE, UNKNOWN_METADATA } from "./sources/officialEngine.js";

export const UNKNOWN_REASONS = Object.freeze({
  COURSE_UNRESOLVED: "COURSE_UNRESOLVED",
  AMBIGUOUS: "AMBIGUOUS",
  NO_EXACT_SOURCE: "NO_EXACT_SOURCE",
  DISCOVERY_INCOMPLETE,
  UNKNOWN_METADATA,
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

// ---- select matching resources for a request -------------------------------
// Exact month+year+qual match only. Zero matches → structured unknown.
// One match → single fetch.  >1 match → fetch all, parse all, conflict gate.
function selectMatching(resources, request) {
  const qid = qualId(request.qual);
  const wantMonth = String((request.series && request.series.month) || "").toUpperCase();
  const wantYear = Number(request.series && request.series.year);
  if (!qid || !wantMonth || !Number.isFinite(wantYear)) return [];
  return resources.filter((r) => {
    const rq = qualId(r.qual);
    return rq === qid
      && String(r.month || "").toUpperCase() === wantMonth
      && Number(r.year) === wantYear;
  });
}

// ---- select the request's target row among a parsed document ---------------
// The document is validated as a whole for SERIES identity; course identity is
// checked only against the target course the request asked for. Doc-mates are
// other subjects in the same official PDF and persist alongside — they must
// not veto the document. Returns { target, identityProblems }.
function selectTargetRow(rows, request) {
  const expected = request.expectedCourse || request.courseKey;
  if (!expected) return { target: null, identityProblems: [] };
  const wantInfo = typeof expected === "string"
    ? parseCourseKey(expected)
    : { code: (expected && expected.code) || null, tier: (expected && expected.tier) || null };
  const wantCode = wantInfo && baseCodeOf(singleCode(wantInfo.code));
  const wantTier = String((wantInfo && wantInfo.tier) || "").toUpperCase();

  const candidates = wantCode
    ? rows.filter((r) => baseCodeOf(singleCode(r.code)) === wantCode)
    : rows;
  if (candidates.length === 1) {
    if (wantTier && String(candidates[0].tier || "").toUpperCase() !== wantTier) {
      return { target: null, identityProblems: [UNKNOWN_REASONS.TIER_MISMATCH] };
    }
    return { target: candidates[0], identityProblems: [] };
  }

  const problems = [];
  if (wantCode && !candidates.length) {
    problems.push("COURSE_UNRESOLVED");
    return { target: null, identityProblems: problems };
  }
  const byTier = candidates.filter((r) => wantTier && String(r.tier || "").toUpperCase() === wantTier);
  if (byTier.length === 1) return { target: byTier[0], identityProblems: [] };
  if (wantTier && !byTier.length && candidates.length) {
    problems.push(UNKNOWN_REASONS.TIER_MISMATCH);
    return { target: null, identityProblems: problems };
  }
  // Multiple candidates and the evidence cannot pick between them (e.g. no tier
  // hint, or both tiers present): report AMBIGUOUS rather than silently
  // preferring the first row. Deterministic first-row preference would
  // fabricate identity where the document does not resolve it.
  problems.push(UNKNOWN_REASONS.AMBIGUOUS);
  return { target: null, identityProblems: problems };
}

function baseCodeOf(code) {
  return String(code || "").trim().replace(/[HF]$/, "").toUpperCase();
}

// ---- compare two parsed course-sets for equality ---------------------------
function tablesMatch(rowsA, rowsB) {
  if (!rowsA || !rowsB) return false;
  const keyFn = (r) => `${r.courseKey}|${r.code}`;
  const mapFn = (rows) => new Map(rows.map((r) => [keyFn(r), r]));
  const mapA = mapFn(rowsA);
  const mapB = mapFn(rowsB);
  for (const [key, rowA] of mapA) {
    const rowB = mapB.get(key);
    if (!rowB) return false;
    const gradesA = rowA.grades || {};
    const gradesB = rowB.grades || {};
    for (const g of rowA.gradesInOrder || []) {
      if (Number(gradesA[g]) !== Number(gradesB[g])) return false;
    }
    if (Number(rowA.maxMark) !== Number(rowB.maxMark)) return false;
  }
  return mapA.size === mapB.size;
}

// ---- persist parsed rows into the snapshot ---------------------------------
// Incremental (frontier #13): every record is upserted into its own store via
// put*, never by clearing stores. Source becomes the canonical provenance
// entity (frontier #14): a boundary carries `sourceIds[]` (and a paper inherits
// the same ids); the source record holds the url/content-hash/title. Provenance
// stays on the boundary for display compatibility, but the id link is the
// graph relationship.
async function persistRows(rows, request, sources) {
  const now = Date.now();
  const seriesRecord = {
    id: seriesId(request.series) || null,
    month: request.series.month,
    year: Number(request.series.year),
    label: request.series.label || fmtSeriesLabel(request.series),
    qual: qualId(request.qual),
    board: (request.board || "pearson").toLowerCase()
  };
  await storage.putSeries(seriesRecord);

  const sourceIds = [];
  for (const source of sources) {
    const sid = sourceRecordId(source.url);
    if (!sourceIds.includes(sid)) sourceIds.push(sid);
    await storage.putSource({
      id: sid,
      url: source.url,
      contentHash: source.contentHash,
      status: source.status || null,
      title: source.title || null,
      publisher: source.publisher || "Pearson Edexcel",
      accessedAt: source.accessedAt || now,
      verifiedAt: now
    });
  }

  for (const row of rows) {
    const ck = row.courseKey;
    if (!ck) continue;
    const sid = seriesRecord.id;
    const src = sources[0] && sources[0].url ? sources[0] : null;
    const boundary = {
      id: `${ck}|${sid}`,
      courseKey: ck,
      seriesId: sid,
      series: { month: seriesRecord.month, year: seriesRecord.year, label: seriesRecord.label },
      grades: row.grades,
      gradesInOrder: row.gradesInOrder,
      maxMark: row.maxMark,
      tier: row.tier,
      sourceIds: sourceIds.slice(),
      provenance: provenanceOf({
        kind: "official",
        url: src && src.url || null,
        parsedAt: now,
        contentHash: src && src.contentHash || null,
        verification: VERIFY.VERIFIED,
        sourceName: "PearsonSource",
        publisher: src && src.publisher || "Pearson Edexcel",
        sourceTitle: src && src.title || null,
        parserVersion: row.provenance && row.provenance.parserVersion || null
      })
    };
    await storage.putBoundary(boundary);
    if (Array.isArray(row.papers)) {
      for (const p of row.papers) {
        const paper = { id: paperRecordId(ck, sid, p), courseKey: ck, seriesId: sid, ...p, sourceIds: sourceIds.slice() };
        await storage.putPaper(paper);
      }
    }
    const p = parseCourseKey(ck);
    if (p) await storage.putCourse({ id: ck, board: p.board, qual: p.qual, code: p.code, tier: p.tier });
  }
}

// ---- main pipeline entry (Pearson-specific for now) ------------------------
export async function acquirePearson(request, { fetchImpl, proxyFn, onProgress, parse, includeCatalogue = true, maxPages, maxResources } = {}) {
  const parseFn = parse || ((bytes, opts) => PearsonSource.parseSource(bytes, opts));
  const qid = qualId(request && request.qual);
  const month = String((request.series && request.series.month) || "").toUpperCase();
  const year = Number(request.series && request.series.year);
  if (!qid || !month || !Number.isFinite(year)) return unknown(UNKNOWN_REASONS.NO_EXACT_SOURCE, { stage: "validate-request" });
  if (request.courseKey || request.expectedCourse) {
    // expectedCourse is a row-side hint ({code, tier} possibly with title);
    // resolve it with the request's board+qual so it keys canonically.
    const ck = request.courseKey
      || (request.expectedCourse && courseKeyFromRow(request.board || "pearson", request.qual, request.expectedCourse));
    if (!ck) return unknown(UNKNOWN_REASONS.COURSE_UNRESOLVED, { stage: "course" });
  }

  if (onProgress) onProgress({ stage: "discover", message: `Discovering Pearson ${fmtSeriesLabel(request.series)} ${qid.toUpperCase()}...` });
  const discovered = await PearsonSource.discover({ request, fetchImpl, proxyFn, onProgress, includeCatalogue, maxPages, maxResources });
  const matching = selectMatching(discovered.resources, request);
  if (!matching.length) {
    // A safety-limited crawl cut history short: a matching source may exist but
    // was never fully scanned — that is DISCOVERY_INCOMPLETE, not NO_EXACT_SOURCE.
    if (discovered.incomplete) {
      return unknown(UNKNOWN_REASONS.DISCOVERY_INCOMPLETE, {
        stage: "discover",
        message: `History crawl hit a safety limit for Pearson ${fmtSeriesLabel(request.series)} ${qid.toUpperCase()}; a matching official source may exist but was not fully scanned.`,
        pages: discovered.graph && discovered.graph.pages
      });
    }
    // Candidates exist but none carries a verifiable series identity in its
    // title — report the evidence, never pretend the archive is empty.
    if (discovered.metadataUnknown > 0 || (discovered.resources || []).some((r) => r.unknownMetadata)) {
      return unknown(UNKNOWN_REASONS.UNKNOWN_METADATA, {
        stage: "discover",
        message: `Pearson candidates exist for ${qid.toUpperCase()} but none carries a verifiable series identity in its title; nothing was assumed.`,
        candidates: discovered.metadataUnknown
      });
    }
    return unknown(UNKNOWN_REASONS.NO_EXACT_SOURCE, { stage: "discover", message: `No official resource found for Pearson ${fmtSeriesLabel(request.series)} ${qid.toUpperCase()}.` });
  }

  const fetchResults = [];
  const fetchFailures = [];
  for (const resource of matching) {
    if (onProgress) onProgress({ stage: "fetch", message: `Fetching ${resource.url}...` });
    const result = await PearsonSource.fetchSource(resource, { fetchImpl });
    if (!result.ok) {
      if (result.reason === "NOT_PDF" || result.reason === "CONTENT_TYPE" || result.reason === "HOST_UNVERIFIED") {
        return unknown(UNKNOWN_REASONS.WRONG_DOCUMENT, { stage: "fetch", url: result.url, fetchReason: result.reason, contentType: result.contentType, status: result.status });
      }
      fetchFailures.push(result.reason);
      fetchResults.push(null);
      continue;
    }
    fetchResults.push({ resource, result });
  }

  const successful = fetchResults.filter(Boolean);
  if (!successful.length) {
    // Deterministic per-failure classification (frontier #21): a throttle
    // (HTTP 429) and a network drop are transient — retry. A dead official URL
    // (404/410) is a structural absence — that source is gone for good. Any
    // other fetch failure (500, odd status…) is a generic transient FETCH_FAILED.
    if (fetchFailures.includes("HTTP_429")) return unknown(UNKNOWN_REASONS.RATE_LIMITED, { stage: "fetch", reasons: fetchFailures });
    if (fetchFailures.includes("HTTP_404") || fetchFailures.includes("HTTP_410")) return unknown(UNKNOWN_REASONS.SOURCE_NOT_FOUND, { stage: "fetch", reasons: fetchFailures });
    return unknown(UNKNOWN_REASONS.FETCH_FAILED, { stage: "fetch", reasons: fetchFailures });
  }

  const allParsedRows = [];
  for (const { resource, result } of successful) {
    if (onProgress) onProgress({ stage: "parse", message: `Parsing ${resource.url}...` });
    const parsed = await parseFn(result.bytes, {
      qual: request.qual,
      series: request.series,
      expected: request.expectedCourse || request.courseKey
    });
    if (!parsed.ok) return unknown(UNKNOWN_REASONS.PARSER_FAILED, { stage: "parse", url: resource.url, error: parsed.error });
    for (const row of parsed.rows) row._sourceUrl = resource.url;
    allParsedRows.push({ resource, result, rows: parsed.rows, problems: parsed.problems });
  }

  if (allParsedRows.length > 1) {
    const [first, ...rest] = allParsedRows;
    const conflict = rest.some((other) => !tablesMatch(first.rows, other.rows));
    if (conflict) {
      return unknown(UNKNOWN_REASONS.CONFLICTING_SOURCES, {
        stage: "conflict",
        sources: allParsedRows.map((r) => ({ url: r.resource.url, contentHash: r.result.contentHash })),
        message: "Multiple official sources parsed different grade tables for the same series — no action taken."
      });
    }
  }

  // Series identity is judged against the whole document: a doc that is the
  // wrong year/month for the request never gets persisted, whatever else it
  // contains (spec #53/#54 wrong-year / wrong-series guards).
  const seriesProblems = allParsedRows[0].problems || [];
  const anyWrongYear = seriesProblems.some((p) => p.includes("wrong-year"));
  const anyWrongSeries = seriesProblems.some((p) => p.includes("wrong-series"));
  if (anyWrongYear) return unknown(UNKNOWN_REASONS.WRONG_YEAR, { stage: "validate-series", problems: seriesProblems });
  if (anyWrongSeries) return unknown(UNKNOWN_REASONS.WRONG_SERIES, { stage: "validate-series", problems: seriesProblems });

  // Document-identity is judged against what the FILE declares (frontier #6/#7):
  // a fetch-document that itself declares a different qualification, or that
  // declares itself a component-level (notional) table, can never establish the
  // requested identity — deterministic structured unknowns, nothing persisted.
  const anyWrongQualification = seriesProblems.some((p) => p.startsWith("qualification:"));
  const anyComponentBoundary = seriesProblems.some((p) => p.startsWith("component:"));
  if (anyWrongQualification) {
    return unknown(UNKNOWN_REASONS.WRONG_QUALIFICATION, { stage: "validate-document-identity", problems: seriesProblems });
  }
  if (anyComponentBoundary) {
    return unknown(UNKNOWN_REASONS.COMPONENT_BOUNDARY, { stage: "validate-document-identity", problems: seriesProblems });
  }

  // Persist ONLY rows whose own validation passed (validation.ok === true).
  // "Not provenance-FAILED" is not a licence to persist: a row that parsed with
  // invalid maxMark/labels/series must not land in the snapshot. Doc-mates
  // (subjects we did not request) persist only when they themselves validate.
  const validRows = allParsedRows[0].rows
    .filter((row) => row._validation && row._validation.ok === true)
    .filter((row) => !row.provenance || row.provenance.verification !== VERIFY.FAILED);
  if (!validRows.length) return unknown(UNKNOWN_REASONS.WRONG_DOCUMENT, { stage: "validate-series", problems: seriesProblems });

  // Course identity is checked ONLY against the request's target row; doc-mate
  // subjects are other courses and must not veto the document (they persist
  // alongside, as in the legacy whole-table load).
  const { target, identityProblems } = selectTargetRow(validRows, request);
  if (identityProblems.length) {
    return unknown(identityProblems.find((p) => p === UNKNOWN_REASONS.TIER_MISMATCH) || identityProblems[0], {
      stage: "validate-identity",
      problems: identityProblems
    });
  }
  if (request.courseKey || request.expectedCourse) {
    if (!target) return unknown(UNKNOWN_REASONS.COURSE_UNRESOLVED, { stage: "validate-identity", message: "Parsed document did not contain the requested course." });
  }

  const sources = allParsedRows.map((r) => ({
    url: r.resource.url,
    contentHash: r.result.contentHash,
    status: r.result.status,
    title: r.resource.title || null,
    publisher: "Pearson Edexcel",
    accessedAt: Date.now()
  }));
  await persistRows(validRows, request, sources);

  const tableLead = target || validRows[0];
  const table = (() => {
    if (!tableLead) return null;
    return {
      grades: tableLead.grades || {},
      gradesInOrder: tableLead.gradesInOrder || [],
      maxMark: tableLead.maxMark,
      board: "pearson",
      qual: qid,
      seriesLabel: fmtSeriesLabel(request.series),
      seriesKey: seriesId(request.series)
    };
  })();
  const topVal = table && Array.isArray(table.gradesInOrder) && table.gradesInOrder.length ? Number(table.grades[table.gradesInOrder[0]]) : null;

  return {
    kind: "official",
    reason: "acquired",
    table,
    top: Number.isFinite(topVal) ? topVal : null,
    year,
    seriesLabel: fmtSeriesLabel(request.series),
    sourceLabel: sources[0] ? sources[0].url : "Pearson",
    hasTable: Boolean(table),
    verification: VERIFY.VERIFIED,
    sources
  };
}

// ---- ExamData.getForSitting facade (execution-spec #39) --------------------
// The ONLY public API for resolving a boundary decision. Wraps
// deriveBoundaryDecision with provenance verification gating: rows whose
// provenance verification is "failed" or "conflicting" are surfaced as unknown
// (never presented). Whether a "verified"/"uncertain" official envelope is
// *presentable as official* is governed separately by isPresentableOfficial
// (provenance.js) — uncertain must not render its numbers as official.
export async function getForSitting(repo, enrollment, year, seriesWord, sitting = {}, { extraKnown = [], allowInferred = false } = {}) {
  // Import here to avoid circular dependency with repository.js
  const { deriveBoundaryDecision, markForDecisionGrade } = await import("./repository.js");
  const decision = deriveBoundaryDecision(repo, enrollment, year, seriesWord, sitting);
  const hit = decision.kind === "official" || decision.kind === "projected";
  if (hit && decision.table && decision.table.fresh !== undefined) {
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
  }
  return decision;
}

export { UNKNOWN_REASONS as REASONS };