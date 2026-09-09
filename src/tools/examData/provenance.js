// examData/provenance.js — provenance model for boundary values.
//
// The zero-fabrication contract lives on every value: a boundary is either
// traceable to an official published source, or it is explicitly manual, or it
// was inferred. Nothing renders as "official" on guesswork.

export const ORDER = ["official", "manual", "inferred"];

export function provenanceOf({ kind, url, publishedAt, parsedAt } = {}) {
  const k = String(kind || "").toLowerCase();
  if (!["official", "manual", "inferred"].includes(k)) return { kind: "manual", reason: "unverifiable" };
  const out = { kind: k };
  if (url) out.url = url;
  if (publishedAt) out.publishedAt = publishedAt;
  if (parsedAt) out.parsedAt = parsedAt;
  return out;
}

export function provenanceLabel(p) {
  const k = p && p.kind;
  if (k === "official") return "Official";
  if (k === "manual") return "Stored (manual)";
  if (k === "inferred") return "Inferred";
  return "Unknown";
}

export function provenanceDetail(p) {
  if (!p) return "no provenance recorded";
  const bits = [provenanceLabel(p)];
  if (p.url) bits.push(p.url);
  if (p.publishedAt) bits.push(`published ${new Date(p.publishedAt).toISOString().slice(0, 10)}`);
  if (p.parsedAt) bits.push(`parsed ${new Date(p.parsedAt).toISOString().slice(0, 10)}`);
  return bits.join(" · ");
}

// A value copied into a tracker sitting (gradeBoundary / gradeBoundaries) can
// never prove its own origin — unless it carries provenance tags. Never assume.
export function sittingProvenance(sitting) {
  return provenanceOf((sitting && sitting._provenance) || { kind: "manual", reason: "stored-with-sitting" });
}