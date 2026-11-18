// tests/journal.mjs — Journal model helpers.
// STUB context: journals persist in IndexedDB today; the PC/file-system storage
// migration should replace the db layer, not these entry semantics.

import {
  JOURNAL_PROMPTS,
  createJournalEntry,
  filterJournals,
  formatJournalMonthLabel,
  groupJournalsByMonth,
  journalDisplayTitle,
  journalSnippet,
  journalWordCount,
  matchesJournalSearch,
  normalizeJournalEntry,
  pickJournalPrompt,
  sortJournals,
  touchJournalEntry
} from "../src/tools/journalModel.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

export async function run() {
  const base = 1_700_000_000_000;

  const created = createJournalEntry({ title: "  A thought  ", body: "Hello" }, base);
  eq("create trims title", created.title, "A thought");
  eq("create preserves body", created.body, "Hello");
  eq("create stamps times", [created.createdAt, created.updatedAt], [base, base]);
  check("create sets journal type", created.type === "journal" && typeof created.id === "string" && created.id.length > 0);

  const normalized = normalizeJournalEntry({ id: "j1", content: "legacy body", createdAt: base, insight: "yes" }, base + 1);
  eq("normalize accepts legacy content", normalized.body, "legacy body");
  eq("normalize defaults insight to false", normalized.insight, false);
  eq("normalize keeps createdAt", normalized.createdAt, base);
  check("normalize derives a date key", /^\d{4}-\d{2}-\d{2}$/.test(normalized.dateKey));

  const touched = touchJournalEntry(created, { body: "Hello world", insight: true }, base + 5000);
  eq("touch updates body", touched.body, "Hello world");
  eq("touch marks insight", touched.insight, true);
  eq("touch advances updatedAt", touched.updatedAt, base + 5000);
  eq("touch keeps identity", [touched.id, touched.createdAt, touched.dateKey], [created.id, created.createdAt, created.dateKey]);

  eq("word count counts words", journalWordCount({ title: "Two words", body: "and three more" }), 5);
  eq("word count ignores markdown syntax", journalWordCount({ body: "# Heading\n- **bold** and `code`\n[link](x)" }), 4);
  eq("word count is zero for empty", journalWordCount({ title: "", body: "   " }), 0);

  check("snippet falls back", journalSnippet({ body: "" }) === "No words yet.");
  check("snippet truncates long text", journalSnippet({ body: "a".repeat(200) }, 20).endsWith("…"));
  eq("display title prefers explicit title", journalDisplayTitle({ title: "Mine", body: "body" }), "Mine");
  check("display title falls back to snippet/body", journalDisplayTitle({ body: "A quiet realisation" }).length > 0);
  eq("display title for empty", journalDisplayTitle({}), "Untitled reflection");

  const entries = [
    normalizeJournalEntry({ id: "a", title: "Old", body: "patience", createdAt: base - 10_000 }, base),
    normalizeJournalEntry({ id: "b", title: "New", body: "focus", createdAt: base, insight: true }, base),
    normalizeJournalEntry({ id: "c", title: "Middle", body: "Focus and rest", createdAt: base - 5_000 }, base)
  ];
  eq("sort newest first", sortJournals(entries).map((e) => e.id), ["b", "c", "a"]);

  check("search matches title/body case-insensitively", matchesJournalSearch(entries[1], "FOCUS"));
  check("search rejects misses", !matchesJournalSearch(entries[0], "focus"));
  eq("filter by query", filterJournals(entries, { query: "focus" }).map((e) => e.id), ["b", "c"]);
  eq("filter insights only", filterJournals(entries, { insightOnly: true }).map((e) => e.id), ["b"]);
  eq("filter combines query and insight", filterJournals(entries, { query: "focus", insightOnly: true }).map((e) => e.id), ["b"]);

  const grouped = groupJournalsByMonth([
    normalizeJournalEntry({ id: "m1", createdAt: Date.parse("2026-11-10T12:00:00Z") }),
    normalizeJournalEntry({ id: "m2", createdAt: Date.parse("2026-11-02T12:00:00Z") }),
    normalizeJournalEntry({ id: "m3", createdAt: Date.parse("2026-10-28T12:00:00Z") })
  ]);
  eq("groups by month in order", grouped.map((g) => g.monthKey), ["2026-11", "2026-10"]);
  eq("group counts", grouped.map((g) => g.entries.length), [2, 1]);
  check("month label is human-readable", /2026/.test(formatJournalMonthLabel("2026-11-10")));

  check("prompt pool is non-empty", JOURNAL_PROMPTS.length >= 5);
  check("prompt selection is stable for a seed", pickJournalPrompt(42) === pickJournalPrompt(42));
  check("prompt selection stays in pool", JOURNAL_PROMPTS.includes(pickJournalPrompt(123)));

  return { passed, failed };
}
