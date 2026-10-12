// examData/adapters.js — board/qualification capabilities and source adapters.
// EXAM_BOARDS also supplies the legacy Scraper's vocabulary; it is not proof
// that every board adapter can acquire data. Tracker acquisition currently
// uses the real exact-PDF path in ../boundaries.js. The AQA source module below
// intentionally reports unsupported until its standalone parser is real.

import { boardId, qualId, currentExamYear } from "./schema.js";
import * as PearsonSource from "./sources/PearsonSource.js";
import * as AqaSource from "./sources/AqaSource.js";

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
export function sourceFor(board) {
  const id = boardId(board);
  if (!id) return null;
  if (id === "pearson") {
    return {
      name: "PearsonSource",
      implemented: true,
      discover: (opts) => PearsonSource.discover(opts),
      parse: (bytes, opts) => PearsonSource.parseSource(bytes, opts),
      notes: "official archive discovery and real PDF parsing; fetch/parser failures return unknown"
    };
  }
  if (id === "aqa") {
    return {
      name: "AQASource",
      implemented: false,
      discover: (opts) => AqaSource.discover(opts),
      parse: (bytes, opts) => AqaSource.parseSource(bytes, opts),
      notes: "standalone AQA adapter is not implemented; tracker currently uses its separate verified PDF-row path"
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