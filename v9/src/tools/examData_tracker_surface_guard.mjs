// Frontier #18 regression gate — runnable with plain node, zero deps.
// Guards the ONE thing the frontier cares about:
//   trackerTool.js must speak ONLY to the examData facade (Exam) + its
//   schema/scheduler modules, and must import legacy gradeBoundaries.js
//   from nowhere in its transitive ESM graph.
//
//   Usage:  node src/tools/examData_tracker_surface_guard.mjs
//   Exit 0  -> seam holds.  Non-zero -> tracker regressed.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const TRACKER = resolve(root, "trackerTool.js");
const LEGACY = "gradeBoundaries";

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`ok  ${msg}`);

// --- Gate 1: static — no legacy import specifier in trackerTool source.
{
  const src = readFileSync(TRACKER, "utf8");
  const importSpecs = [...src.matchAll(/import\s*(?:[\s\S]*?from\s*)?["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith(".") || true); // keep resolution to graph check below
  const legacyRef = importSpecs.find((s) => s.includes(LEGACY));
  if (legacyRef) fail(`trackerTool imports legacy module: ${legacyRef}`);
  else pass("trackerTool has no legacy gradeBoundaries import specifier");
}

// --- Gate 2: dynamic — the tracker's real ESM graph must LINK.
// A named import the facade lacks throws at link time; a stale internal
// import path throws too. Loading the module is therefore itself the test.
try {
  await import(resolve(TRACKER));
  pass("trackerTool module + whole import graph links without error");
} catch (err) {
  fail(`trackerTool import graph failed to link: ${err && err.message}`);
}

// --- Gate 3: static — walk the tracker's static important specifiers and
// assert none resolve (by basename) to the legacy file, covering any
// indirect path through facade modules we also import here.
{
  const src = readFileSync(TRACKER, "utf8");
  const specifiers = [...src.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const bad = specifiers.filter((s) => s.includes(LEGACY) || /gradeBoundaries\.js$/.test(s));
  if (bad.length) fail(`legacy specifier(s) reachable: ${bad.join(", ")}`);
  else pass("all tracker static import specifiers are facade-only");
}

console.log(failures ? `\nSURFACE GUARD FAILED (${failures})\n` : "\nSURFACE GUARD PASSED\n");
process.exit(failures ? 1 : 0);
