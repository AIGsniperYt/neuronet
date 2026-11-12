/**
 * schema.js — the current NeuroNet dataset contract.
 *
 * Markdown-first is the canonical format. The app no longer rewrites old
 * exports on import: a backup must be current. Keeping this guard tiny is
 * deliberate — the JSON is user-owned data, so the app validates the shape and
 * loads it exactly as written.
 */

export const SCHEMA_VERSION = 9;

const COLLECTIONS = ["nodes", "quotes", "cues", "cards", "heaps", "decks", "subjects", "tasks", "commitments"];

export function assertCurrentDataset(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid NeuroNet export: expected a JSON object.");
  }

  const version = Number(payload.schemaVersion);
  if (!Number.isFinite(version)) {
    throw new Error("Invalid NeuroNet export: missing schemaVersion.");
  }
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `This export uses schema ${version}, but this build expects schema ${SCHEMA_VERSION}. ` +
      "Re-export it from an up-to-date NeuroNet build."
    );
  }

  const dataset = { ...payload };
  for (const key of COLLECTIONS) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new Error(`Invalid NeuroNet export: "${key}" must be an array.`);
    }
    dataset[key] = payload[key] || [];
  }
  return dataset;
}
