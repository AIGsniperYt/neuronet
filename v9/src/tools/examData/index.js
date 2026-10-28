// examData — canonical exam-data subsystem entry point.
//
// Kept dependency-free of the legacy gradeBoundaries module (that module wraps
// this one, never the reverse). Consumers should speak to this surface.

export * from "./schema.js";
export * from "./identity.js";
export * from "./provenance.js";
export * from "./migrate.js";
export * from "./repository.js";
export * from "./scheduler.js";
export * from "./adapters.js";
export * from "./papers.js";
export * from "./paperFetcher.js";
export * from "./ingest.js";
export * from "./ensure.js";
export * from "./storage.js";
