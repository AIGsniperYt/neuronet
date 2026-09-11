// examData/adapters.js — declarative per-board adapters.
//
// The legacy fetch is board-specific already (AQA xlsx via filestore, Pearson
// + OCR PDF via pdf.js + page crawls). This registry names each adapter and its
// contract so the scheduler and the Scraper debug surface share one vocabulary.
// Actual fetch/parse execution stays in gradeBoundaries (Phase C wiring) —
// adapters here are the schema for that wiring.

import { boardId, qualId, currentExamYear } from "./schema.js";
import * as PearsonSource from "./sources/PearsonSource.js";

export const EXAM_BOARDS = [
  {
    id: "aqa",
    name: "AQA",
    qualifications: ["gcse", "alevel", "as"],
    source: "filestore.aqa.org.uk (xlsx/pdf series catalogue)",
    discovery: "hardcoded series calendar + optional archive scan",
    parsing: "xlsx → subject rows (code includes tier, e.g. 8300H/8300F)",
    note: "AQA stores one row per tier under a shared base code."
  },
  {
    id: "ocr",
    name: "OCR",
    qualifications: ["gcse", "alevel", "as"],
    source: "ocr.org.uk grade-boundary pages + PDF archive",
    discovery: "page crawl for current series, datasheet links",
    parsing: "pdf.js layout lines → subject rows (tier explicit)",
    note: "OCR separates qualification-level grades from notional component rows."
  },
  {
    id: "pearson",
    name: "Edexcel (Pearson)",
    qualifications: ["gcse", "alevel"],
    source: "qualifications.pearson.com publications + DAM archive",
    discovery: "publications page crawl + DAM asset crawl",
    parsing: "pdf.js layout lines → subject rows (tier explicit)",
    note: "GCSE only (AS/A2 via separate qualification ids)."
  }
];

export function adapterFor(board) {
  const id = boardId(board);
  if (!id) return null;
  return EXAM_BOARDS.find((b) => b.id === id) || null;
}

export function listAdapters() {
  return EXAM_BOARDS.slice();
}

export function nativeQualification(board, qual) {
  const a = adapterFor(board);
  if (!a || !qual) return null;
  const qid = qualId(qual);
  return a.qualifications.includes(qid) ? qid : null;
}

export function defaultSeriesWindow(board, now = Date.now()) {
  const y = currentExamYear(now);
  return [
    { month: "JUN", year: y },
    { month: "NOV", year: y - (board && boardId(board) === "pearson" ? 0 : 1) }
  ];
}

// ---- executable source adapters (execution-spec #54) -----------------------
// `sourceFor(board)` returns an object implementing the adapter contract:
//   { name, discover(opts), fetch?(resource, opts), parse?(bytes, opts), notes }
// Pearson is fully implemented. AQA/OCR adapters exist as interface-only stubs
// (marked `implemented:false`); requesting sync/async acquisition from a stub
// resolves to the structured "NO_EXACT_SOURCE - adapter not yet implemented"
// reason so the tracker surface fails closed, never invents.
export function sourceFor(board) {
  const id = boardId(board);
  if (!id) return null;
  if (id === "pearson") {
    return {
      name: "PearsonSource",
      implemented: true,
      discover: (opts) => PearsonSource.discover(opts),
      parse: (bytes, opts) => PearsonSource.parseSource(bytes, opts),
      notes: "landing-page discovery + verified catalogue; content-hash validated; never filename-guesses"
    };
  }
  if (id === "aqa") {
    return {
      name: "AQASource",
      implemented: false,
      discover: async () => ({ resources: [] }),
      parse: async () => ({ ok: false, reason: "NO_EXACT_SOURCE", rows: [] }),
      notes: "interface-only — AQA archive/XLSX-first adapter is a future step"
    };
  }
  if (id === "ocr") {
    return {
      name: "OCRSiteSource",
      implemented: false,
      discover: async () => ({ resources: [] }),
      parse: async () => ({ ok: false, reason: "NO_EXACT_SOURCE", rows: [] }),
      notes: "interface-only — OCR datasheet crawl is a future step"
    };
  }
  return null;
}

export function adaptersImplemented() {
  return { pearson: true, aqa: false, ocr: false };
}