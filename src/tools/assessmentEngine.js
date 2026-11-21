// Deterministic question selection. Sessions store the returned ordered IDs
// and seed so selection can be audited and replayed.
export function questionEvidence(questionId, attempts = []) {
  const rows = attempts.filter((a) => a.questionId === questionId && a.status !== "unscored" && Number.isFinite(a.awardedMarks) && Number.isFinite(a.maxMarks) && a.maxMarks > 0);
  if (!rows.length) return { state: "unseen", attempts: 0, fullMarks: 0, lastAt: 0, lastPercent: null };
  const ordered = rows.slice().sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const last = ordered.at(-1);
  const perfect = ordered.filter((a) => a.awardedMarks === a.maxMarks);
  const fullMarks = perfect.length;
  const perfectDays = new Set(perfect.map((a) => new Date(Number(a.createdAt) || 0).toDateString()));
  return { state: last.awardedMarks < last.maxMarks ? "weak" : perfectDays.size >= 2 ? "repeated-full" : "provisional-full", attempts: rows.length, fullMarks, lastAt: Number(last.createdAt) || 0, lastPercent: last.awardedMarks / last.maxMarks * 100 };
}

export function questionPerformance(questionId, { attempts = [], memoryReviews = [] } = {}) {
  const assessment = questionEvidence(questionId, attempts);
  const reviews = memoryReviews.filter((event) => event.questionId === questionId)
    .slice().sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const lastMemoryReview = reviews.at(-1) || null;
  return {
    questionId,
    assessment,
    memory: {
      count: reviews.length,
      lastAt: Number(lastMemoryReview?.createdAt) || 0,
      lastRating: lastMemoryReview?.rating || null,
      nextReview: lastMemoryReview?.schedule?.nextReview ?? null
    },
    lastActivityAt: Math.max(assessment.lastAt || 0, Number(lastMemoryReview?.createdAt) || 0)
  };
}

function seeded(seed) {
  let s = Number(seed) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export function generateAssessment({ questions = [], attempts = [], memoryReviews = [], tagIds = [], count = 10, seed = Date.now(), asOf = Date.now() } = {}) {
  const tags = new Set(tagIds);
  const candidates = questions.filter((q) => q.status !== "archived" && (!tags.size || (q.tagIds || []).some((id) => tags.has(id))));
  const random = seeded(seed);
  const info = candidates.map((q) => ({ question: q, performance: questionPerformance(q.id, { attempts, memoryReviews }), random: random() }));
  const orders = info.map((row) => Number(row.question.sourceOrder)).filter(Number.isFinite);
  const minOrder = orders.length ? Math.min(...orders) : 0;
  const maxOrder = orders.length ? Math.max(...orders) : 0;
  const progressionBucket = (row) => maxOrder === minOrder ? 0 : Math.min(3, Math.floor(((Number(row.question.sourceOrder) - minOrder) / (maxOrder - minOrder)) * 4));
  const topicCounts = new Map();
  const progressionCounts = new Map();
  const chosen = [];
  while (chosen.length < Math.min(count, info.length)) {
    const remaining = info.filter((row) => !chosen.includes(row));
    remaining.sort((a, b) => {
      const topicA = (a.question.tagIds || []).reduce((n, t) => n + (topicCounts.get(t) || 0), 0);
      const topicB = (b.question.tagIds || []).reduce((n, t) => n + (topicCounts.get(t) || 0), 0);
      const rank = (e) => e.state === "unseen" ? 0 : e.state === "weak" ? 1 : e.state === "provisional-full" ? 2 : 3;
      const recentPenalty = (e) => e.lastAt && asOf - e.lastAt < 7 * 86400000 ? 1 : 0;
      const dueMemory = (row) => row.performance.memory.nextReview != null && Number(row.performance.memory.nextReview) <= asOf ? 0 : 1;
      const aEvidence = a.performance.assessment;
      const bEvidence = b.performance.assessment;
      return topicA - topicB
        || rank(aEvidence) + recentPenalty(aEvidence) - rank(bEvidence) - recentPenalty(bEvidence)
        || dueMemory(a) - dueMemory(b)
        || (progressionCounts.get(progressionBucket(a)) || 0) - (progressionCounts.get(progressionBucket(b)) || 0)
        || a.random - b.random;
    });
    const row = remaining[0]; chosen.push(row);
    for (const t of row.question.tagIds || []) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    const bucket = progressionBucket(row);
    progressionCounts.set(bucket, (progressionCounts.get(bucket) || 0) + 1);
  }
  return { seed, asOf, policyVersion: 3, items: chosen.map(({ question, performance }) => ({ questionId: question.id, maxMarks: question.maxMarks ?? null, sourceOrder: question.sourceOrder ?? null, evidenceState: performance.assessment.state, revision: question.revision || 1 })) };
}
