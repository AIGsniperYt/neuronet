// Runtime-only Memory view of canonical question records. The adapter never
// writes prompt/answer copies; edits and scheduling are persisted on question.
export function questionToMemoryItem(question, answers, deck, tags = []) {
  const linked = new Set(question.answerIds || []);
  const entries = answers.filter((answer) => linked.has(answer.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!entries.length || question.status !== "confirmed") return null;
  const prompt = (question.prompt || []).map((block) => block.text || "").join("\n\n");
  const answer = entries.flatMap((entry) => entry.blocks || []).map((block) => block.text || "").join("\n\n");
  if (!prompt.trim() || !answer.trim()) return null;
  return {
    id: question.id,
    questionId: question.id,
    type: "question",
    front: prompt,
    back: answer,
    deck: deck?.subject || "Question Bank",
    deckId: question.memoryDeckId || deck?.id || null,
    deckPath: deck ? [deck.name] : [],
    tags: (question.tagIds || []).map((id) => tags.find((tag) => tag.id === id)?.title).filter(Boolean),
    order: question.sourceOrder || question.createdAt || 0,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    origin: "canonical-question-adapter",
    meta: question.memoryState || {},
    memoryState: question.memoryState || {},
    _question: question
  };
}
