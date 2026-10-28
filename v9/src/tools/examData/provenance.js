// examData/provenance.js — provenance model for boundary values.
//
// The zero-fabrication contract lives on every value: a boundary is either
// traceable to an official published source, or it is explicitly manual, or it
// was inferred. Nothing renders as "official" on guesswork.
//
// Verification states (execution-spec #15): every official-valued boundary
// carries a verification state — `verified` (parser evidence + source
// content-hash), `uncertain` (official-family but not provable), `conflicting`
// (multiple official sources disagree — never auto-pick), `failed` (source was
// rejected by content validation). Legacy cache rows migrated without a source
// URL are `uncertain`, not silently upgraded.

export const ORDER = ["official", "manual", "inferred"];
export const VERIFY = Object.freeze({
  VERIFIED: "verified",
  UNCERTAIN: "uncertain",
  CONFLICTING: "conflicting",
  FAILED: "failed"
});

export function provenanceOf({ kind, url, publishedAt, accessedAt, parsedAt, verification, contentHash, sourceName, publisher, sourceTitle, parserVersion } = {}) {
  const k = String(kind || "").toLowerCase();
  if (!["official", "manual", "inferred"].includes(k)) return { kind: "manual", reason: "unverifiable" };
  const out = { kind: k };
  if (url) out.url = url;
  if (publishedAt) out.publishedAt = publishedAt;
  if (accessedAt) out.accessedAt = accessedAt;
  if (parsedAt) out.parsedAt = parsedAt;
  if (contentHash) out.contentHash = contentHash;
  if (sourceName) out.sourceName = sourceName;
  if (publisher) out.publisher = publisher;
  if (sourceTitle) out.sourceTitle = sourceTitle;
  if (parserVersion) out.parserVersion = parserVersion;
  // Official data without a traceable source url cannot claim to be verified:
  // default an official row with no url to "uncertain" — never "verified".
  const v = String(verification || "").toLowerCase();
  out.verification =
    ["verified", "uncertain", "conflicting", "failed"].includes(v)
      ? v
      : (k === "official" && url ? VERIFY.VERIFIED : VERIFY.UNCERTAIN);
  return out;
}

export function provenanceLabel(p) {
  const k = p && p.kind;
  if (k === "official") return "Official";
  if (k === "manual") return "Stored (manual)";
  if (k === "inferred") return "Inferred";
  return "Unknown";
}