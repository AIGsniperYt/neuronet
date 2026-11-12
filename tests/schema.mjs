// tests/schema.mjs — dataset contract for the current schema.
// No IndexedDB needed; this only exercises the import guard.
import { SCHEMA_VERSION, assertCurrentDataset } from "../src/schema.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const throws = (name, fn) => {
  try {
    fn();
    check(name, false, "\n      expected a throw");
  } catch {
    check(name, true);
  }
};

export async function run() {
  eq("schema version is 9", SCHEMA_VERSION, 9);

  const minimal = assertCurrentDataset({ schemaVersion: 9 });
  check("missing collections default to arrays", ["nodes", "quotes", "cues", "cards", "heaps", "decks", "subjects", "tasks", "commitments"].every((key) => Array.isArray(minimal[key])));
  eq("commitments defaults to empty", minimal.commitments, []);

  const withCommitments = assertCurrentDataset({
    schemaVersion: 9,
    commitments: [{ id: "c1", type: "commitment", title: "Biology recall" }]
  });
  eq("commitments are preserved", withCommitments.commitments.length, 1);

  throws("old schema 8 export is rejected", () => assertCurrentDataset({ schemaVersion: 8 }));
  throws("missing schema version is rejected", () => assertCurrentDataset({ nodes: [] }));
  throws("non-array commitments are rejected", () => assertCurrentDataset({ schemaVersion: 9, commitments: {} }));
  throws("non-object payload is rejected", () => assertCurrentDataset([]));

  return { passed, failed };
}
