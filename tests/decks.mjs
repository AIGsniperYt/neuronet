// tests/decks.mjs — pure deck-tree helpers. No IndexedDB needed.
import {
  sortDecksByCreated,
  buildDeckForest,
  flattenDeckTree,
  getDeckDescendantIds,
  groupDecksBySubject,
  getDeckPath,
  describeDeckDeletion
} from "../src/db.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

export async function run() {
const decks = [
  { id: "root-old", name: "Old", subject: "Biology", parentId: null, createdAt: 100 },
  { id: "root-new", name: "New", subject: "Biology", parentId: null, createdAt: 400 },
  { id: "child-a", name: "Child A", subject: "Biology", parentId: "root-old", createdAt: 200 },
  { id: "child-b", name: "Child B", subject: "Biology", parentId: "root-old", createdAt: 300 },
  { id: "grand", name: "Grand", subject: "Biology", parentId: "child-a", createdAt: 250 },
  { id: "orphan", name: "Orphan", subject: "Biology", parentId: "missing", createdAt: 50 },
  { id: "cycle-a", name: "Cycle A", subject: "Biology", parentId: "cycle-b", createdAt: 10 },
  { id: "cycle-b", name: "Cycle B", subject: "Biology", parentId: "cycle-a", createdAt: 20 },
  { id: "macbeth", name: "Quotes", subject: "Macbeth", parentId: null, createdAt: 150 }
];

// ---- Date ordering ---------------------------------------------------------
eq("sort desc puts newest first", sortDecksByCreated(decks, "desc").map((d) => d.id)[0], "root-new");
eq("sort asc puts oldest first", sortDecksByCreated(decks, "asc").map((d) => d.id)[0], "cycle-a");
eq("sort does not mutate input", decks[0].id, "root-old");

// ---- Forest ----------------------------------------------------------------
const forest = buildDeckForest(decks);
eq("forest roots are newest-first", forest.map((d) => d.id), ["root-new", "macbeth", "root-old", "orphan", "cycle-b"]);
const oldRoot = forest.find((d) => d.id === "root-old");
eq("children are newest-first", oldRoot.children.map((d) => d.id), ["child-b", "child-a"]);
eq("grandchild depth is preserved", oldRoot.children.find((d) => d.id === "child-a").children[0].id, "grand");
check("missing parent becomes a root", forest.some((d) => d.id === "orphan"));
check(
  "cycle is broken instead of swallowing decks",
  forest.some((d) => d.id === "cycle-b")
    && forest.find((d) => d.id === "cycle-b").children.some((d) => d.id === "cycle-a")
);
eq("asc forest roots", buildDeckForest(decks, { direction: "asc" }).map((d) => d.id), ["cycle-a", "orphan", "root-old", "macbeth", "root-new"]);

// ---- Flatten ---------------------------------------------------------------
const flat = flattenDeckTree(buildDeckForest(decks));
eq("flatten starts at root depth 0", flat.find((d) => d.id === "root-new").depth, 0);
eq("flatten records grandchild depth 2", flat.find((d) => d.id === "grand").depth, 2);
check("flatten includes every deck exactly once", flat.length === decks.length && new Set(flat.map((d) => d.id)).size === decks.length);

// ---- Descendants -----------------------------------------------------------
const descendants = getDeckDescendantIds(decks, "root-old").sort();
eq("descendants include the subtree", descendants, ["child-a", "child-b", "grand", "root-old"]);
eq("cycle descendants terminate", getDeckDescendantIds(decks, "cycle-a").sort(), ["cycle-a", "cycle-b"]);
eq("missing deck has no descendants", getDeckDescendantIds(decks, "missing"), []);
eq("empty id has no descendants", getDeckDescendantIds(decks, ""), []);

// ---- Subject grouping ------------------------------------------------------
const groups = groupDecksBySubject(decks);
eq("groups are sorted by subject", groups.map((g) => g.subject), ["Biology", "Macbeth"]);
eq("subject keeps one forest", groups[0].decks.map((d) => d.id), ["root-new", "root-old", "orphan", "cycle-b"]);
eq("macbeth group root", groups[1].decks.map((d) => d.id), ["macbeth"]);

// ---- Paths and deletion planning -------------------------------------------
eq("path walks to the root", getDeckPath(decks, "grand"), ["Old", "Child A", "Grand"]);
eq("path for a root is itself", getDeckPath(decks, "root-old"), ["Old"]);
eq("path for a missing deck is empty", getDeckPath(decks, "missing"), []);

const deletionCards = [
  { id: "c1", deckId: "root-old" },
  { id: "c2", deckId: "child-a" },
  { id: "c3", deckId: "grand" },
  { id: "c4", deckId: "root-new" }
];
const plan = describeDeckDeletion(decks, deletionCards, "root-old");
eq("deletion plan keeps one deck", plan.counts.decks, 4);
eq("deletion plan counts subtree cards", plan.counts.subtreeCards, 3);
eq("deletion plan counts direct cards", plan.counts.directCards, 1);
eq("deletion plan counts direct subdecks", plan.counts.childDecks, 2);
eq("deletion plan has no parent for a root", plan.parent, null);
check("deletion plan for a missing deck is null", describeDeckDeletion(decks, deletionCards, "missing") === null);

return { passed, failed };
}
