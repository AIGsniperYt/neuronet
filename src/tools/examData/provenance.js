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

export function provenanceOf({ kind, url, publishedAt, parsedAt, verification, contentHash, sourceName } = {}) {
  const k = String(kind || "").toLowerCase();
  if (!["official", "manual", "inferred"].includes(k)) return { kind: "manual", reason: "unverifiable" };
  const out = { kind: k };
  if (url) out.url = url;
  if (publishedAt) out.publishedAt = publishedAt;
  if (parsedAt) out.parsedAt = parsedAt;
  if (contentHash) out.contentHash = contentHash;
  if (sourceName) out.sourceName = sourceName;
  // Official data without a traceable source url cannot claim to be verified:
  // default an official row with no url to "uncertain" — never "verified".
  const v = String(verification || "").toLowerCase();
  out.verification =
    ["verified", "uncertain", "conflicting", "failed"].includes(v)
      ? v
      : (k === "official" && url ? VERIFY.VERIFIED : VERIFY.UNCERTAIN);
  return out;
}

export function verificationLabel(v) {
  return {
    verified: "Verified",
    uncertain: "Uncertain",
    conflicting: "Conflicting",
    failed: "Failed"
  }[String(v || "")] || "Unverified";
}

// True only for provenance that may present as "official" without a manual
// override. Conflicting sources and parser failures never do.
export function isPresentableOfficial(p) {
  if (!p || p.kind !== "official") return false;
  const v = p.verification;
  return v === VERIFY.VERIFIED || v === VERIFY.UNCERTAIN;
}

export function provenanceLabel(p) {
  const k = p && p.kind;
  if (k === "official") return "Official";
  if (k === "manual") return "Stored (manual)";
  if (k === "inferred") return "Inferred";
  return "Unknown";
}

// Richer label carrying the verification state ("Official (Verified)") — used
// only in diagnostics/detail surfaces, never in the stable label contract.
export function provenanceLabelDetailed(p) {
  const k = p && p.kind;
  if (k === "official") return `Official (${verificationLabel(p && p.verification)})`;
  return provenanceLabel(p);
}

export function provenanceDetail(p) {
  if (!p) return "no provenance recorded";
  const bits = [provenanceLabelDetailed(p)];
  if (p.url) bits.push(p.url);
  if (p.publishedAt) bits.push(`published ${new Date(p.publishedAt).toISOString().slice(0, 10)}`);
  if (p.parsedAt) bits.push(`parsed ${new Date(p.parsedAt).toISOString().slice(0, 10)}`);
  if (p.contentHash) bits.push(`sha256:${p.contentHash.slice(0, 12)}…`);
  return bits.join(" · ");
}

// A value copied into a tracker sitting (gradeBoundary / gradeBoundaries) can
// never prove its own origin — unless it carries provenance tags. Never assume.
export function sittingProvenance(sitting) {
  return provenanceOf((sitting && sitting._provenance) || { kind: "manual", reason: "stored-with-sitting" });
}