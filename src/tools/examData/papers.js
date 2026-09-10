// examData/papers.js — canonical paper records.
//
// Papers are the second output of the same ingestion system that produces
// boundaries (one fetch, two outputs). A Paper record has a stable identity
// (`code` when the board publishes one, otherwise label) plus the component
// layout consumed by the tracker's score columns.
//
// Storage compatibility: the boundary cache carries papers on each subject row
// (`subjects[i].papers`) and the derived index already carries them on the
// boundary record (`b.papers`). This module is the ONE place that turns those
// stored payloads into canonical Paper records, so no renderer / import path
// reaches into the storage shape directly. A future ingest migration can move
// the payload out of the boundary entry without changing any consumer.

import { singleCode } from "./schema.js";

// Canonical record form:
//   { id, label, code, maxMark, component }
// id is stable across boards: code when present, else the label slug.
export function normalizePaper(paper, index = 0) {
  if (!paper || typeof paper !== "object") return null;
  const label = String(paper.label || paper.name || paper.title || "").trim();
  const code = singleCode(paper.code || paper.id || "");
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = code || slug || `paper-${index}`;
  const maxMark = Number(paper.maxMark ?? paper.maxMarks ?? paper.max ?? paper.rawMaxMark);
  return {
    id,
    label: label || id,
    code: code || null,
    maxMark: Number.isFinite(maxMark) ? maxMark : null,
    component: String(paper.component || "") || null,
    raw: paper.raw || null
  };
}

export function paperRecords(papers) {
  if (!papers) return [];
  return (Array.isArray(papers) ? papers : [papers])
    .map((p, i) => normalizePaper(p, i))
    .filter(Boolean);
}

// Deduplicated canonical papers for a course across every cached series.
export function listPaperRecords(repo, enrollment) {
  if (!repo) return [];
  const seen = new Map();
  for (const b of repo.index.boundaries.values()) {
    for (const p of paperRecords(b.papers)) {
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  return [...seen.values()];
}