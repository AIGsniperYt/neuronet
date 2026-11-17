// tests/tags.mjs — storage normalisation for study tags.
// Pure helper only: no IndexedDB, no DOM.
import { promoteTags } from "../src/db.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

export async function run() {
  const legacy = promoteTags({
    id: "q1",
    meta: { tags: ["ambition", " guilt ", "ambition"], hierarchyPath: ["Macbeth"] }
  });
  eq("legacy meta tags move to top level", legacy.tags, ["ambition", "guilt"]);
  check("legacy meta tags are removed", !("tags" in legacy.meta));
  eq("other metadata survives", legacy.meta.hierarchyPath, ["Macbeth"]);

  const both = promoteTags({ id: "a1", tags: ["power"], meta: { tags: ["guilt", "power"] } });
  eq("existing and legacy tags merge without duplicates", both.tags, ["power", "guilt"]);
  check("merged record loses meta tags", !("tags" in both.meta));

  const empty = promoteTags({ id: "c1", meta: { tags: [] } });
  check("empty legacy tags leave no top-level array", !("tags" in empty));
  check("empty legacy tags are removed", !("tags" in empty.meta));

  const blank = promoteTags({ id: "q2", tags: [" ", ""], meta: { tags: ["real"] } });
  eq("blank tags are dropped", blank.tags, ["real"]);

  const none = promoteTags({ id: "n1", subject: "Macbeth" });
  check("records without tags are unchanged", !("tags" in none) && !("meta" in none));

  const noMeta = promoteTags({ id: "q3", tags: ["already"] });
  eq("top-level tags are preserved", noMeta.tags, ["already"]);
  check("no meta object is invented", !("meta" in noMeta));

  check("null input is ignored", promoteTags(null) === null);

  return { passed, failed };
}
