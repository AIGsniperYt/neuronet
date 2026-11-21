// Runtime-only Memory view of canonical question records. The adapter never
// writes prompt/answer copies; edits and scheduling are persisted on question.
export function questionToMemoryItem(question, answers, deck, tags = [], mediaById = new Map()) {
  const linked = new Set(question.answerIds || []);
  const entries = answers.filter((answer) => linked.has(answer.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!entries.length || question.status !== "confirmed") return null;
  const blockText = (blocks, regions = []) => {
    let imageIndex = 0;
    return (blocks || []).map((block) => {
      if (block.type === "image") {
        const page = block.page || regions[imageIndex++]?.page;
        const src = mediaById.get(block.mediaId);
        return src ? `![Captured region${page ? ` · page ${page}` : ""}](${src})` : `[Image region${page ? ` · page ${page}` : ""}]`;
      }
      return block.text || "";
    }).filter(Boolean).join("\n\n");
  };
  const prompt = blockText(question.prompt, question.promptRegions);
  const answer = entries.map((entry) => blockText(entry.blocks, entry.sourceRegions)).filter(Boolean).join("\n\n");
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
