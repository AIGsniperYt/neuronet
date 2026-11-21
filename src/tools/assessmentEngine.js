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

function seeded(seed) {
  let s = Number(seed) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export function generateAssessment({ questions = [], attempts = [], tagIds = [], count = 10, seed = Date.now() } = {}) {
  const tags = new Set(tagIds);
  const candidates = questions.filter((q) => q.status !== "archived" && (!tags.size || (q.tagIds || []).some((id) => tags.has(id))));
  const random = seeded(seed);
  const info = candidates.map((q) => ({ question: q, evidence: questionEvidence(q.id, attempts), random: random() }));
  const topicCounts = new Map();
  const chosen = [];
  while (chosen.length < Math.min(count, info.length)) {
    const remaining = info.filter((row) => !chosen.includes(row));
    remaining.sort((a, b) => {
      const topicA = (a.question.tagIds || []).reduce((n, t) => n + (topicCounts.get(t) || 0), 0);
      const topicB = (b.question.tagIds || []).reduce((n, t) => n + (topicCounts.get(t) || 0), 0);
      const rank = (e) => e.state === "unseen" ? 0 : e.state === "weak" ? 1 : e.state === "provisional-full" ? 2 : 3;
      return topicA - topicB || rank(a.evidence) - rank(b.evidence) || a.random - b.random;
    });
    const row = remaining[0]; chosen.push(row);
    for (const t of row.question.tagIds || []) topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
  }
  return { seed, policyVersion: 1, items: chosen.map(({ question, evidence }) => ({ questionId: question.id, maxMarks: question.maxMarks ?? null, sourceOrder: question.sourceOrder ?? null, evidenceState: evidence.state })) };
}
