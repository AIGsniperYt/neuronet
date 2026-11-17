/**
 * studyItem.js — the read model for everything the app can study.
 *
 * Stores keep their own shape on purpose: a card owns a prompt/answer pair, a
 * quote owns verbatim text tied to a source range, an analysis owns a document.
 * Those meanings are different, so the fields are different. This module is the
 * one place that translates them into a single shape for display, and the one
 * place that derives importance, recall and accuracy from whatever state an
 * item actually has.
 *
 * Nothing here writes, schedules or mutates. It is presentation-only, and it
 * must stay importable without a DOM so the tests can exercise it directly.
 */

// Importance is always a 1–5 user judgement. It is never derived from SRS.
export const IMPORTANCE_COLORS = {
  1: "#9aa4ad",
  2: "#4ba3ff",
  3: "#3fd07d",
  4: "#ff9b39",
  5: "#ff4d4d"
};

// Both recall and accuracy use the same five-step binning scale so the two
// numbers stay directly comparable when rendered side by side.
export const SCORE_BINS = [
  { min: 0, max: 0.2, color: "#ff4d4d", label: "0–20%" },
  { min: 0.2, max: 0.4, color: "#ff8a3d", label: "20–40%" },
  { min: 0.4, max: 0.6, color: "#ffa500", label: "40–60%" },
  { min: 0.6, max: 0.8, color: "#a8d95f", label: "60–80%" },
  { min: 0.8, max: 1, color: "#3fd07d", label: "80–100%" }
];

export const UNKNOWN_SCORE_COLOR = "#33443d";

export const GRADE_SCORES = { easy: 1, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };
export const RECALL_GRADE_SCORES = { easy: 0.9, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };

const STUDY_TYPES = new Set(["card", "quote", "cue", "analysis", "source", "pastpaper"]);

// What the review flow can actually schedule. Cards are the canonical review
// unit; quotes and analyses can currently be reviewed directly too, which is
// why they keep their own meta.nextReview until that flow is migrated.
const REVIEWABLE_TYPES = new Set(["card", "quote", "analysis"]);

export function clamp01(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Accepts 0–1 or 0–100 and returns 0–1, or null when there is no value. */
export function normalizeAccuracy(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const ratio = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, ratio));
}

/** Accepts 1–5 (or a numeric string) and returns an integer, or null. */
export function normalizePriority(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function getGradeScore(grade, scale = GRADE_SCORES) {
  return scale[String(grade || "").toLowerCase()];
}

export function recallFromScore(score, derived = false, source = "observed") {
  const value = clamp01(score);
  if (value === null) {
    return { level: "unknown", label: "No recall data", score: null, derived, source };
  }
  if (value >= 0.8) return { level: "strong", label: "Strong", score: value, derived, source };
  if (value >= 0.5) return { level: "medium", label: "Partial", score: value, derived, source };
  return { level: "weak", label: "Weak", score: value, derived, source };
}

export function scoreBin(score) {
  const normalized = normalizeAccuracy(score);
  if (normalized === null) {
    return { index: -1, color: UNKNOWN_SCORE_COLOR, label: "No data" };
  }
  const index = Math.min(SCORE_BINS.length - 1, Math.floor(normalized / 0.2));
  return { index, ...SCORE_BINS[index] };
}

/** Tags are a first-class field on every study record. */
export function itemTags(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function bestAttemptPct(result) {
  const attempts = result?.attempts || [];
  if (attempts.length === 0) return null;
  let best = 0;
  for (const attempt of attempts) {
    const pct = attempt.maxMarks ? Math.round((attempt.score / attempt.maxMarks) * 100) : 0;
    if (pct > best) best = pct;
  }
  return best;
}

// A signal context supplies the lookups derivation needs. Mindmap passes its
// own graph index; other tools can pass IndexedDB-backed lookups.
function context(ctx = {}) {
  return {
    findById: typeof ctx.findById === "function" ? ctx.findById : () => undefined,
    quotesForSource: typeof ctx.quotesForSource === "function" ? ctx.quotesForSource : () => []
  };
}

/**
 * Recall is "how retrievable is this right now?". Grades win, then learning
 * phase, then stability/uncertainty, then recent grade history, then links, then
 * the creation prior. `null` means genuinely no data — never zero.
 */
export function itemRecall(item, ctx, depth = 0) {
  const resolve = context(ctx);
  const meta = item?.meta || {};

  const lastGrade = String(meta.lastGrade || "").toLowerCase();
  const directGradeScore = getGradeScore(lastGrade, RECALL_GRADE_SCORES);
  if (directGradeScore !== undefined) return recallFromScore(directGradeScore);

  const phase = String(meta.L_phase || "").toLowerCase();
  if (phase === "new") {
    const confidence = normalizeAccuracy(meta.confidence);
    return recallFromScore(confidence ?? 0.8, false, confidence !== null ? "prior" : "observed");
  }
  const phaseScores = {
    mastered: 0.95,
    stable: 0.85,
    stabilising: 0.65,
    warming: 0.55
  };
  if (phaseScores[phase] !== undefined) return recallFromScore(phaseScores[phase]);

  const rawS = meta.S;
  const rawU = meta.U;
  const hasS = rawS !== undefined && rawS !== null && rawS !== "" && Number.isFinite(Number(rawS));
  const hasU = rawU !== undefined && rawU !== null && rawU !== "" && Number.isFinite(Number(rawU));
  const stability = hasS ? Number(rawS) : 0;
  const uncertainty = hasU ? Number(rawU) : 0;

  if (hasS && hasU) {
    const stabilityScore = clamp01(stability / 1.5) ?? 0;
    const certaintyScore = clamp01(1 - uncertainty) ?? 0;
    const score = clamp01(stabilityScore * 0.55 + certaintyScore * 0.45);
    return recallFromScore(score);
  }
  if (hasU) return recallFromScore(clamp01(1 - uncertainty));
  if (hasS) return recallFromScore(clamp01(stability / 1.5));

  if (Array.isArray(meta.recentGrades) && meta.recentGrades.length) {
    const scores = meta.recentGrades.map((grade) => getGradeScore(grade)).filter((score) => score !== undefined);
    if (scores.length) {
      return recallFromScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }
  }

  // An analysis has no study state of its own unless it is reviewed directly.
  // Until then it inherits the weakest linked quote: you do not know the
  // analysis if you cannot recall its evidence.
  if (depth < 4 && item?.type === "analysis") {
    const refs = Array.isArray(item.quoteRefs) ? item.quoteRefs : [];
    const linked = refs
      .map((ref) => (ref?.quoteId ? resolve.findById(ref.quoteId) : null))
      .filter(Boolean)
      .map((quote) => itemRecall(quote, ctx, depth + 1))
      .filter((recall) => recall.level !== "unknown");
    if (linked.length) {
      const weakest = linked.reduce((worst, recall) =>
        (recall.score ?? 0) < (worst.score ?? 0) ? recall : worst
      );
      return { ...weakest, derived: true };
    }
  }

  if (depth < 4 && item?.type === "cue") {
    const candidates = [
      item.quoteId ? resolve.findById(item.quoteId) : null,
      item.analysisId ? resolve.findById(item.analysisId) : null
    ].filter(Boolean);
    for (const linkedItem of candidates) {
      const recall = itemRecall(linkedItem, ctx, depth + 1);
      if (recall.level !== "unknown") return { ...recall, derived: true };
    }
  }

  // Creating a card is itself a revision pass, so a card with no reviews yet
  // still gets a legitimate prior. Bulk imports can set a lower prior.
  const confidence = normalizeAccuracy(meta.confidence);
  if (confidence !== null) {
    return { ...recallFromScore(confidence, false, "prior"), label: "Prior" };
  }

  return { level: "unknown", label: "No recall data", score: null, derived: false, source: "none" };
}

/**
 * Accuracy is "when you are tested, how often are you right?". Observed grades
 * beat the creation prior, otherwise every new card reads as 80% forever.
 */
export function itemAccuracy(item) {
  const meta = item?.meta || {};

  if (Array.isArray(meta.recentGrades) && meta.recentGrades.length) {
    const scores = meta.recentGrades.map((grade) => getGradeScore(grade)).filter((score) => score !== undefined);
    if (scores.length) {
      return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }
  }

  const accuracy = normalizeAccuracy(meta.accuracy);
  if (accuracy !== null) return accuracy;

  const lastGradeScore = getGradeScore(meta.lastGrade);
  if (lastGradeScore !== undefined) return lastGradeScore;

  // The 0.8 prior is intentional: making a card is revision. Bulk imports can
  // lower this initial value, and real grades replace it over time.
  const confidence = normalizeAccuracy(meta.confidence);
  if (confidence !== null) return confidence;

  if (item?.type === "pastpaper") {
    const percentages = (item.results || []).map(bestAttemptPct).filter((pct) => pct !== null);
    if (percentages.length) {
      return percentages.reduce((sum, pct) => sum + pct, 0) / percentages.length / 100;
    }
  }

  return null;
}

/**
 * Importance is "how much does this matter to me?". An explicit value always
 * wins. Otherwise an analysis takes the strongest linked quote, a cue takes its
 * linked quote or analysis, and a source takes its strongest quote.
 */
export function importanceOf(item, ctx, depth = 0) {
  if (!item || depth > 4) return { value: null, source: "none" };
  const resolve = context(ctx);

  const direct = normalizePriority(item.priority ?? item.meta?.priority);
  if (direct) return { value: direct, source: "user" };

  if (item.type === "analysis") {
    const refs = Array.isArray(item.quoteRefs) ? item.quoteRefs : [];
    const refPriorities = refs
      .map((ref) => normalizePriority(ref?.priority))
      .filter(Boolean);
    if (refPriorities.length) return { value: Math.max(...refPriorities), source: "linked" };

    const linkedPriorities = refs
      .map((ref) => (ref?.quoteId ? resolve.findById(ref.quoteId) : null))
      .filter(Boolean)
      .map((quote) => importanceOf(quote, ctx, depth + 1).value)
      .filter(Boolean);
    if (linkedPriorities.length) return { value: Math.max(...linkedPriorities), source: "linked" };
    return { value: null, source: "none" };
  }

  if (item.type === "cue") {
    if (item.quoteId) {
      const quote = resolve.findById(item.quoteId);
      const value = quote ? importanceOf(quote, ctx, depth + 1).value : null;
      if (value) return { value, source: "linked" };
    }
    if (item.analysisId) {
      const analysis = resolve.findById(item.analysisId);
      const value = analysis ? importanceOf(analysis, ctx, depth + 1).value : null;
      if (value) return { value, source: "linked" };
    }
    return { value: null, source: "none" };
  }

  if (item.type === "source") {
    const values = (resolve.quotesForSource(item.id) || [])
      .map((quote) => normalizePriority(quote?.priority ?? quote?.meta?.priority))
      .filter(Boolean);
    if (values.length) return { value: Math.max(...values), source: "source" };
  }

  return { value: null, source: "none" };
}

/** Numeric convenience for callers that only need the star count. */
export function importanceValue(item, ctx, depth = 0) {
  return importanceOf(item, ctx, depth).value;
}

/** The single call every reader surface should use. */
export function getStudySignals(item, ctx) {
  return {
    importance: importanceOf(item, ctx),
    recall: itemRecall(item, ctx),
    accuracy: itemAccuracy(item)
  };
}

/**
 * Roll a list of items into counts a summary line can print. Thresholds are
 * arguments so a surface can tune "weak" without redefining the scale.
 */
export function summarizeSignals(items, ctx, options = {}) {
  const weakBelow = Number.isFinite(Number(options.weakBelow)) ? Number(options.weakBelow) : 0.5;
  const strongAtOrAbove = Number.isFinite(Number(options.strongAtOrAbove)) ? Number(options.strongAtOrAbove) : 0.8;
  const importantAtOrAbove = Number.isFinite(Number(options.importantAtOrAbove))
    ? Number(options.importantAtOrAbove)
    : 4;

  const summary = {
    total: 0,
    weak: 0,
    strong: 0,
    important: 0,
    weakImportant: 0,
    noRecallData: 0
  };

  for (const item of items || []) {
    if (!item) continue;
    summary.total += 1;
    const signals = getStudySignals(item, ctx);
    const score = signals.recall.score;
    if (score === null || score === undefined) summary.noRecallData += 1;
    else if (score < weakBelow) summary.weak += 1;
    else if (score >= strongAtOrAbove) summary.strong += 1;

    if ((signals.importance.value ?? 0) >= importantAtOrAbove) {
      summary.important += 1;
      if (score !== null && score !== undefined && score < weakBelow) summary.weakImportant += 1;
    }
  }

  return summary;
}

function studyType(record) {
  const type = String(record?.type || "").trim().toLowerCase();
  if (STUDY_TYPES.has(type)) return type;
  // A record without a known type is only a card if it carries a card's own
  // fields. Guessing "card" for everything would mislabel subjects and tags.
  if (record?.front !== undefined || record?.back !== undefined) return "card";
  return type || "unknown";
}

/**
 * Translate any stored record into the canonical read shape. This is a rename,
 * not a merge: `title` is the text the item is known by, `body` is supporting
 * text, and neither pretends a quote is a question or an answer.
 */
export function toStudyItem(record = {}) {
  const type = studyType(record);
  const meta = record.meta && typeof record.meta === "object" ? record.meta : {};
  const item = {
    id: record.id || null,
    type,
    reviewable: REVIEWABLE_TYPES.has(type),
    title: "",
    body: "",
    subject: String(record.subject || record.deck || "").trim(),
    tags: itemTags(record),
    links: {},
    meta,
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0
  };

  switch (type) {
    case "card":
      item.title = String(record.front || "").trim();
      item.body = String(record.back || "").trim();
      item.deck = String(record.deck || "").trim();
      item.deckPath = Array.isArray(record.deckPath) ? record.deckPath.slice() : [];
      item.links = { ...(record.links && typeof record.links === "object" ? record.links : {}) };
      break;
    case "quote":
      item.title = String(record.quote || "").trim();
      item.links = { sourceId: record.link?.sourceId || null };
      break;
    case "cue":
      item.title = String(record.cue || "").trim();
      item.links = { quoteId: record.quoteId || null, analysisId: record.analysisId || null };
      break;
    case "analysis":
      item.title = String(record.title || "").trim();
      item.body = String(record.content || record.analysis || "").trim();
      item.links = {
        quoteRefs: Array.isArray(record.quoteRefs) ? record.quoteRefs.slice() : [],
        sourceId: record.link?.sourceId || null
      };
      break;
    case "source":
      item.title = String(record.title || record.name || "").trim();
      item.body = String(record.description || "").trim();
      break;
    case "pastpaper":
      item.title = String(record.title || record.name || "").trim();
      break;
  }

  if (!item.title && item.body) item.title = item.body.split("\n")[0].slice(0, 120);
  return item;
}
