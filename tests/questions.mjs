import { generateAssessment, questionEvidence, questionPerformance } from "../src/tools/assessmentEngine.js";
import { questionToMemoryItem } from "../src/tools/memoryQuestionAdapter.js";
import { createSerializedWriter } from "../src/tools/serializedWriter.js";
import { decodeQuestionMedia, encodeQuestionMedia } from "../src/tools/questionMediaBackup.js";
import { createAssessmentAttemptEvents } from "../src/tools/assessmentAttempt.js";
import { rectsIntersect, textItemsInRegion } from "../src/tools/pdfRegionWorkbench.js";

let passed = 0;
let failed = 0;
const check = (name, value) => {
  if (value) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}`); }
};

export async function run() {
  const viewport = { convertToViewportPoint: (x, y) => [x * 2, y * 2] };
  const extractedRegion = textItemsInRegion([
    { str: "outside", transform: [0, 0, 0, 0, 1, 1], width: 2, height: 2 },
    { str: "second", transform: [0, 0, 0, 0, 20, 20], width: 5, height: 2 },
    { str: "first", transform: [0, 0, 0, 0, 5, 5], width: 5, height: 2 }
  ], viewport, { left: 8, top: 8, width: 40, height: 40 });
  check("region extraction selects intersecting PDF text in reading order", extractedRegion === "first second");
  check("region geometry excludes touching non-overlap", !rectsIntersect({ left: 0, top: 0, width: 4, height: 4 }, { left: 4, top: 0, width: 1, height: 4 }));

  const q = (id, tags = ["topic-a"], sourceOrder = 0) => ({ id, tagIds: tags, sourceOrder, maxMarks: 2, status: "confirmed", revision: 1 });
  const questions = [q("a1", ["a"], 1), q("a2", ["a"], 2), q("b1", ["b"], 30), q("b2", ["b"], 40), q("b3", ["b"], 50)];
  const attempt = (id, awardedMarks, createdAt) => ({ id: `event-${id}-${createdAt}`, questionId: id, awardedMarks, maxMarks: 2, status: "scored", createdAt });
  check("unattempted is unseen", questionEvidence("a1", []).state === "unseen");
  check("partial marks remain weak", questionEvidence("a1", [attempt("a1", 1, 10)]).state === "weak");
  check("one perfect result is provisional", questionEvidence("a1", [attempt("a1", 2, 10)]).state === "provisional-full");
  check("same day repeats are not spaced evidence", questionEvidence("a1", [attempt("a1", 2, 10), attempt("a1", 2, 20)]).state === "provisional-full");
  check("separate day full marks distinguish one-question repeat", questionEvidence("a1", [attempt("a1", 2, 1), attempt("a1", 2, 86400001)]).state === "repeated-full");

  const memories = [{ questionId: "a1", rating: "easy", createdAt: 30, schedule: { nextReview: 80 } }];
  const performance = questionPerformance("a1", { attempts: [attempt("a1", 1, 20)], memoryReviews: memories });
  check("assessment evidence and Memory evidence stay distinct", performance.assessment.state === "weak" && performance.memory.count === 1 && performance.memory.lastRating === "easy");

  const options = { questions, tagIds: ["a", "b"], count: 4, seed: 77, asOf: 1000 };
  const first = generateAssessment(options);
  const replay = generateAssessment(options);
  check("seed and as-of replay the exact selection", JSON.stringify(first) === JSON.stringify(replay));
  check("selected topics are sampled fairly", first.items.filter((item) => item.sourceOrder < 20).length === 2 && first.items.filter((item) => item.sourceOrder >= 20).length === 2);
  check("selection metadata pins the policy clock", Number.isFinite(first.asOf) && first.policyVersion >= 2);
  check("source progression is provenance, not numeric order", first.items.some((item, i, rows) => i > 0 && item.sourceOrder < rows[i - 1].sourceOrder));
  const dueMaintenance = generateAssessment({ questions: [q("due", ["topic"], 4), q("not-due", ["topic"], 5)], memoryReviews: [{ questionId: "due", schedule: { nextReview: 500 }, createdAt: 100 }], count: 1, seed: 2, asOf: 1000 });
  check("due Memory maintenance can break ties without becoming assessment marks", dueMaintenance.items[0]?.questionId === "due" && dueMaintenance.items[0]?.evidenceState === "unseen");

  const canonical = { id: "q", status: "confirmed", prompt: [{ type: "text", text: "Prompt" }], answerIds: ["a"], memoryDeckId: "deck", memoryState: { U: 0.2 } };
  const memoryItem = questionToMemoryItem(canonical, [{ id: "a", blocks: [{ type: "text", text: "Answer" }] }], { id: "deck", name: "Captured questions", subject: "Question Bank" }, []);
  check("Memory adapter retains the canonical ID and reads source content", memoryItem.id === canonical.id && memoryItem.questionId === canonical.id && memoryItem.front === "Prompt" && memoryItem.back === "Answer");
  canonical.prompt[0].text = "Edited source";
  check("Memory projection follows later canonical edits", questionToMemoryItem(canonical, [{ id: "a", blocks: [{ type: "text", text: "Answer" }] }], null, []).front === "Edited source");
  check("incomplete questions stay out of Q&A Memory", questionToMemoryItem({ ...canonical, answerIds: [] }, [], null) === null);
  const imageQuestion = { ...canonical, prompt: [{ type: "image", mediaId: "crop", page: 2 }], promptRegions: [{ page: 2 }], answerIds: ["image-answer"] };
  const imageMemory = questionToMemoryItem(imageQuestion, [{ id: "image-answer", blocks: [{ type: "image", mediaId: "answer-crop", page: 3 }] }], null, [], new Map([["crop", "blob:prompt"], ["answer-crop", "blob:answer"]]));
  check("Memory resolves canonical question and answer image references", imageMemory.front.includes("blob:prompt") && imageMemory.back.includes("blob:answer"));

  const encodedMedia = await encodeQuestionMedia([{ id: "image", blob: new Blob(["pixel bytes"], { type: "image/png" }) }]);
  const restoredMedia = decodeQuestionMedia(JSON.parse(JSON.stringify(encodedMedia)));
  check("backup encoding restores media bytes and MIME type", restoredMedia[0].blob.type === "image/png" && await restoredMedia[0].blob.text() === "pixel bytes");

  const submitted = createAssessmentAttemptEvents({ sessionId: "session", now: 900, entries: [{ questionId: "q1", awardedMarks: "1", maxMarks: "2" }, { questionId: "q2", awardedMarks: "3", maxMarks: "2" }] });
  const duplicateSubmit = createAssessmentAttemptEvents({ sessionId: "session", now: 901, entries: [{ questionId: "q1", awardedMarks: "2", maxMarks: "2" }], existingAttempts: submitted });
  check("raw marks are preserved and invalid totals rejected", submitted.length === 1 && submitted[0].awardedMarks === 1 && submitted[0].maxMarks === 2);
  check("duplicate scoring submissions for a session are ignored", duplicateSubmit.length === 0);

  const writer = createSerializedWriter();
  const gate = await new Promise((resolve) => { let release; const promise = new Promise((r) => { release = r; }); resolve({ promise, release }); });
  const order = [];
  const oldWrite = writer.enqueue(async () => { order.push("old-start"); await gate.promise; order.push("old-finish"); });
  const confirmedWrite = writer.enqueue(async () => { order.push("confirmed"); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("autosave queue starts the earlier write first", order[0] === "old-start");
  gate.release();
  await Promise.all([oldWrite, confirmedWrite, writer.flush()]);
  check("confirmed commit follows all earlier autosaves", order.join(",") === "old-start,old-finish,confirmed");

  return { passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(({ passed, failed }) => {
    console.log(`Question domain: ${passed} passed, ${failed} failed.`);
    if (failed) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
