// tests/studyItem.mjs — canonical read model and derived study signals.
// Pure functions only: no IndexedDB, no DOM.
import {
  GRADE_SCORES,
  IMPORTANCE_COLORS,
  SCORE_BINS,
  UNKNOWN_SCORE_COLOR,
  clamp01,
  getGradeScore,
  getStudySignals,
  importanceOf,
  importanceValue,
  itemAccuracy,
  itemRecall,
  itemTags,
  normalizeAccuracy,
  normalizePriority,
  recallFromScore,
  scoreBin,
  summarizeSignals,
  toStudyItem
} from "../src/tools/studyItem.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const card = (meta = {}, extra = {}) => ({
  id: "card-1", type: "card", front: "Who kills Duncan?", back: "Macbeth",
  deck: "English", priority: 4, tags: ["Macbeth"], meta, ...extra
});
const quote = (id, priority, meta = {}, extra = {}) => ({
  id, type: "quote", quote: "Fair is foul", subject: "English", priority, meta,
  link: { sourceId: "src-1" }, ...extra
});
const analysis = (refs = [], extra = {}) => ({
  id: "an-1", type: "analysis", title: "Ambiguity", content: "The paradox…",
  subject: "English", quoteRefs: refs, meta: {}, ...extra
});
const cue = (quoteId = null, analysisId = null, extra = {}) => ({
  id: "cue-1", type: "cue", cue: "Explain the paradox", quoteId, analysisId,
  subject: "English", meta: {}, ...extra
});
const ctxOf = (items = []) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    findById: (id) => byId.get(id),
    quotesForSource: (id) => items.filter((item) => item.type === "quote" && item.link?.sourceId === id)
  };
};

export async function run() {
  // ---- Importance normalisation -------------------------------------------
  eq("priority rounds to nearest star", normalizePriority(3.6), 4);
  eq("priority accepts a numeric string", normalizePriority("2"), 2);
  eq("priority clamps high", normalizePriority(9), 5);
  eq("priority rejects negatives", normalizePriority(-3), null);
  eq("a positive fraction still rounds to a star", normalizePriority(0.4), 1);
  eq("priority rejects zero", normalizePriority(0), null);
  eq("priority rejects junk", normalizePriority("abc"), null);
  eq("priority rejects empty string", normalizePriority(""), null);
  eq("priority rejects undefined", normalizePriority(undefined), null);

  // ---- Accuracy and score scales ------------------------------------------
  eq("clamp01 keeps a ratio", clamp01(0.42), 0.42);
  eq("clamp01 rejects text", clamp01("abc"), null);
  eq("percentage normalises to ratio", normalizeAccuracy(80), 0.8);
  eq("ratio passes through", normalizeAccuracy(0.35), 0.35);
  eq("over 100% clamps", normalizeAccuracy(140), 1);
  eq("negative percentage is no data", normalizeAccuracy(-5), null);
  eq("grade scale knows didnt_know", getGradeScore("didnt_know"), 0.2);
  eq("grade scale is case-insensitive", getGradeScore("EASY"), 1);
  eq("unknown grade has no score", getGradeScore("meh"), undefined);

  eq("recall 0.9 is strong", recallFromScore(0.9).level, "strong");
  eq("recall 0.5 is partial", recallFromScore(0.5).level, "medium");
  eq("recall 0.4 is weak", recallFromScore(0.4).level, "weak");
  eq("recall with no score is unknown", recallFromScore(null).level, "unknown");
  eq("unknown recall keeps a null score", recallFromScore(null).score, null);

  eq("score bin 0.1 is the lowest band", scoreBin(0.1).index, 0);
  eq("score bin 0.85 is the top band", scoreBin(0.85).index, 4);
  eq("score bin 80 parses as a ratio", scoreBin(80).index, 4);
  eq("no score maps to the unknown colour", scoreBin(null).color, UNKNOWN_SCORE_COLOR);
  eq("no score has index -1", scoreBin(null).index, -1);
  eq("five score bins exist", SCORE_BINS.length, 5);
  eq("five importance colours exist", Object.keys(IMPORTANCE_COLORS).length, 5);

  // ---- Recall derivation ---------------------------------------------------
  eq("last grade wins over everything", itemRecall({ meta: { lastGrade: "easy" } }).score, 0.9);
  eq("no metadata means no recall data", itemRecall({ meta: {} }).score, null);
  eq("no metadata has source none", itemRecall({ meta: {} }).source, "none");

  const newCard = itemRecall({ meta: { L_phase: "new" } });
  eq("a new item keeps an 80% prior", newCard.score, 0.8);
  eq("new item with confidence uses it", itemRecall({ meta: { L_phase: "new", confidence: 0.5 } }).score, 0.5);

  const creationPrior = itemRecall({ meta: { confidence: 0.5 } });
  eq("a bare creation confidence becomes the prior", creationPrior.score, 0.5);
  eq("the creation prior is labelled prior", creationPrior.source, "prior");
  eq("the creation prior is labelled in the tooltip", creationPrior.label, "Prior");

  eq("stable phase reads 0.85", itemRecall({ meta: { L_phase: "stable" } }).score, 0.85);
  eq("mastered phase reads 0.95", itemRecall({ meta: { L_phase: "mastered" } }).score, 0.95);

  const suBoth = itemRecall({ meta: { S: 1.5, U: 0 } });
  eq("stability + certainty combine to full recall", suBoth.score, 1);
  eq("uncertainty alone inverts", itemRecall({ meta: { U: 0.25 } }).score, 0.75);
  eq("stability alone scales against 1.5", itemRecall({ meta: { S: 0.75 } }).score, 0.5);

  eq(
    "recent grades average when nothing else is available",
    itemRecall({ meta: { recentGrades: ["easy", "didnt_know"] } }).score,
    0.6
  );

  // ---- Accuracy derivation -------------------------------------------------
  eq(
    "observed grades beat the creation prior",
    itemAccuracy({ meta: { recentGrades: ["easy", "kinda"], confidence: 0.8 } }),
    0.8
  );
  eq("explicit accuracy is used", itemAccuracy({ meta: { accuracy: 55 } }), 0.55);
  eq("a single last grade is used", itemAccuracy({ meta: { lastGrade: "didnt_know" } }), 0.2);
  eq("confidence becomes the prior", itemAccuracy({ meta: { confidence: 0.7 } }), 0.7);
  eq("no evidence means null accuracy", itemAccuracy({ meta: {} }), null);

  // ---- Importance derivation ----------------------------------------------
  eq("explicit priority is user-authored", importanceOf(card()).source, "user");
  eq("explicit priority is returned as a number", importanceValue(card()), 4);
  eq("priority in meta is still explicit", importanceValue({ type: "quote", meta: { priority: 2 } }), 2);

  const strongQuote = quote("q-strong", 5, {});
  const weakQuote = quote("q-weak", 2, {});
  eq(
    "an analysis inherits the strongest linked quote",
    importanceOf(analysis([{ quoteId: "q-strong" }, { quoteId: "q-weak" }]), ctxOf([strongQuote, weakQuote])),
    { value: 5, source: "linked" }
  );
  eq(
    "an explicit analysis priority beats its quotes",
    importanceValue(analysis([{ quoteId: "q-strong" }], { priority: 1 }), ctxOf([strongQuote])),
    1
  );
  eq(
    "a quoteRef snapshot priority is used without a lookup",
    importanceOf(analysis([{ priority: 3 }]), ctxOf([])),
    { value: 3, source: "linked" }
  );
  eq(
    "an analysis with no links has no importance",
    importanceOf(analysis([]), ctxOf([])),
    { value: null, source: "none" }
  );

  eq(
    "a cue inherits from its quote",
    importanceOf(cue("q-strong", null), ctxOf([strongQuote])),
    { value: 5, source: "linked" }
  );
  eq(
    "a cue falls back to its analysis",
    importanceValue(cue(null, "an-1"), ctxOf([analysis([{ quoteId: "q-weak" }]), weakQuote])),
    2
  );
  eq(
    "a cue prefers its quote over its analysis",
    importanceValue(cue("q-weak", "an-strong"), ctxOf([weakQuote, analysis([], { priority: 5 })])),
    2
  );
  eq("an orphan cue has no importance", importanceOf(cue("missing", null), ctxOf([])).source, "none");

  eq(
    "a source takes its strongest quote",
    importanceOf({ id: "src-1", type: "source" }, ctxOf([strongQuote, weakQuote])),
    { value: 5, source: "source" }
  );

  // ---- Recall inheritance --------------------------------------------------
  const gradedQuote = quote("q-1", 3, { lastGrade: "didnt_know" });
  const easyQuote = quote("q-2", 3, { lastGrade: "easy" });
  const sharedAnalysis = analysis([{ quoteId: "q-1" }, { quoteId: "q-2" }]);
  const inherited = itemRecall(sharedAnalysis, ctxOf([gradedQuote, easyQuote]));
  eq("an analysis inherits the weakest linked recall", inherited.score, 0.2);
  eq("inherited recall is marked derived", inherited.derived, true);
  eq("inherited recall keeps the source", inherited.source, "observed");

  const cueRecall = itemRecall(cue("q-2", null), ctxOf([easyQuote]));
  eq("a cue inherits its quote recall", cueRecall.score, 0.9);
  eq("cue inheritance is marked derived", cueRecall.derived, true);

  const ownStateCue = cue("q-1", null, { meta: { lastGrade: "easy" } });
  eq("a cue with its own grades keeps them", itemRecall(ownStateCue, ctxOf([gradedQuote])).score, 0.9);
  eq("own cue state is not marked derived", itemRecall(ownStateCue, ctxOf([gradedQuote])).derived, false);

  const cycle = { id: "an-loop", type: "analysis", quoteRefs: [{ quoteId: "an-loop" }], meta: {} };
  const cycleRecall = itemRecall(cycle, ctxOf([cycle]));
  eq("a self-referencing analysis terminates", cycleRecall.level, "unknown");

  // ---- Signals bundle ------------------------------------------------------
  const signals = getStudySignals(card({ lastGrade: "kinda" }));
  eq("signals expose all three keys", Object.keys(signals).sort(), ["accuracy", "importance", "recall"]);
  eq("signals importance is explicit", signals.importance, { value: 4, source: "user" });
  eq("signals recall is graded", signals.recall.score, 0.6);
  eq("signals accuracy is graded", signals.accuracy, 0.6);

  // ---- Tags ----------------------------------------------------------------
  eq("top-level tags are the source", itemTags({ tags: ["a"], meta: { tags: ["b"] } }), ["a"]);
  eq("legacy meta tags are ignored", itemTags({ tags: null, meta: { tags: ["b"] } }), []);
  eq("tags are trimmed", itemTags({ tags: [" x ", ""] }), ["x"]);
  eq("no tags means an empty list", itemTags({}), []);

  // ---- Canonical adapter ---------------------------------------------------
  const cardItem = toStudyItem(card({}, { createdAt: 10, updatedAt: 20 }));
  eq("card title is its prompt", cardItem.title, "Who kills Duncan?");
  eq("card body is its answer", cardItem.body, "Macbeth");
  eq("card subject is its deck", cardItem.subject, "English");
  eq("cards are reviewable", cardItem.reviewable, true);
  eq("timestamps are numbers", [cardItem.createdAt, cardItem.updatedAt], [10, 20]);

  const quoteItem = toStudyItem(strongQuote);
  eq("quote title is the extracted text", quoteItem.title, "Fair is foul");
  eq("quote keeps its source link", quoteItem.links.sourceId, "src-1");
  eq("quotes are reviewable today", quoteItem.reviewable, true);
  eq("quotes have no answer body", quoteItem.body, "");

  const cueItem = toStudyItem(cue("q-1", "an-1"));
  eq("cue title is the prompt", cueItem.title, "Explain the paradox");
  eq("cue links both parents", cueItem.links, { quoteId: "q-1", analysisId: "an-1" });
  eq("cues are not reviewed directly", cueItem.reviewable, false);

  const analysisItem = toStudyItem(analysis([{ quoteId: "q-1" }]));
  eq("analysis keeps its heading", analysisItem.title, "Ambiguity");
  eq("analysis body is its document", analysisItem.body, "The paradox…");
  eq("analysis links its quotes", analysisItem.links.quoteRefs, [{ quoteId: "q-1" }]);
  eq("analyses are reviewable today", analysisItem.reviewable, true);

  const untitled = toStudyItem({ id: "x", type: "analysis", title: "", content: "First line\nSecond line" });
  eq("an empty title falls back to the first line", untitled.title, "First line");

  eq("front/back records are cards even without a type", toStudyItem({ front: "Q", back: "A" }).type, "card");
  eq("a subject node is not mistaken for a card", toStudyItem({ id: "s1", type: "subject", title: "English" }).type, "subject");
  eq("an empty record stays safe", toStudyItem().type, "unknown");
  eq("an unknown record is not reviewable", toStudyItem({ type: "tag" }).reviewable, false);

  // ---- Signal summaries ----------------------------------------------------
  const summaryItems = [
    card({ lastGrade: "didnt_know" }, { id: "c-weak" }),                 // P4, weak
    card({ lastGrade: "easy" }, { id: "c-strong" }),                     // P4, strong
    card({ lastGrade: "kinda" }, { id: "c-mid", priority: 2 }),          // P2, partial
    card({}, { id: "c-nodata", priority: 5, meta: {} }),                 // P5, no data
    quote("q-weak", 5, { lastGrade: "didnt_know" }),                     // P5, weak
  ];
  const summary = summarizeSignals(summaryItems, ctxOf([]));
  eq("summary counts every item", summary.total, 5);
  eq("summary counts weak recall", summary.weak, 2);
  eq("summary counts strong recall", summary.strong, 1);
  eq("summary counts important items", summary.important, 4);
  eq("summary counts important and weak", summary.weakImportant, 2);
  eq("summary counts missing recall separately", summary.noRecallData, 1);
  eq("summary ignores empty entries", summarizeSignals([null, undefined]).total, 0);

  const strict = summarizeSignals(summaryItems, ctxOf([]), { importantAtOrAbove: 5 });
  eq("summary honours a stricter importance threshold", strict.important, 2);

  return { passed, failed };
}
