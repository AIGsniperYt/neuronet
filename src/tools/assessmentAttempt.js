export function createAssessmentAttemptEvents({ sessionId, entries = [], existingAttempts = [], now = Date.now(), mode = "practice" }) {
  const seen = new Set(existingAttempts.filter((event) => event.sessionId === sessionId && event.status === "scored").map((event) => event.questionId));
  const events = [];
  for (const entry of entries) {
    if (seen.has(entry.questionId)) continue;
    if (entry.awardedMarks === "" || entry.awardedMarks == null) continue;
    const awardedMarks = Number(entry.awardedMarks);
    const maxMarks = Number(entry.maxMarks);
    if (!Number.isFinite(awardedMarks) || !Number.isFinite(maxMarks) || maxMarks <= 0 || awardedMarks < 0 || awardedMarks > maxMarks) continue;
    events.push({
      id: crypto.randomUUID(), sessionId, questionId: entry.questionId,
      awardedMarks, maxMarks, createdAt: now, status: "scored", mode,
      markingSource: "manual", elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null
    });
    seen.add(entry.questionId);
  }
  return events;
}
