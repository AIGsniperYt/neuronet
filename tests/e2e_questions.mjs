// Browser-backed question persistence tests. Requires Chrome + puppeteer-core.
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = normalize(join(new URL(import.meta.url).pathname, "..", ".."));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
const server = createServer(async (req, res) => {
  try {
    let path = normalize(join(ROOT, decodeURIComponent((req.url || "/").split("?")[0])));
    if ((req.url || "/").split("?")[0].endsWith("/")) path = join(path, "index.html");
    if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(await readFile(path));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let browser;
let failed = 0;
const check = (name, result) => { console.log(`${result ? "ok" : "FAIL"} ${name}`); if (!result) failed++; };
try {
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/tools/questions.html`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    window.DEMO_MODE = true;
    window.APP_VERSION = `questions-${Date.now()}`;
    const db = await import("/src/db.js");
    await db.initDB();
    await db.replaceQuestionCollections({
      questions: [{ id: "q-one", status: "confirmed", memoryState: { U: 0.8 } }, { id: "draft-one", status: "draft", sourceId: "batch-one" }],
      questionAnswers: [{ id: "ans-one", blocks: [{ type: "text", text: "Answer" }] }],
      questionBanks: [{ id: "bank-one", questionIds: ["q-one"] }],
      questionSources: [{ id: "batch-one", status: "staging", questionIds: ["draft-one"], fileName: "practice.pdf" }],
      questionMedia: [{ id: "media-one", blob: new Blob(["original media"], { type: "text/plain" }) }]
    });
    const before = await db.getQuestionRecords("questions");
    let badSaveRejected = false;
    try {
      await db.replaceQuestionCollections({ questions: [{ id: "bad", callback() {} }], questionAnswers: [] });
    } catch { badSaveRejected = true; }
    const after = await db.getQuestionRecords("questions");
    const atomicPreserved = after.length === 2 && after.some((q) => q.id === "q-one") && after.some((q) => q.id === "draft-one");
    const memoryEvent = { id: "review-one", questionId: "q-one", type: "memory-review", rating: "easy", createdAt: 123 };
    const canonical = before.find((question) => question.id === "q-one");
    await db.recordQuestionMemoryReview({ ...canonical, memoryState: { U: 0.1 } }, memoryEvent);
    const savedQuestion = await db.getQuestionRecords("questions");
    const reviews = await db.getQuestionRecords("memoryReviews");
    let duplicateRejected = false;
    try { await db.recordQuestionMemoryReview({ ...savedQuestion.find((q) => q.id === "q-one"), memoryState: { U: 0.9 } }, memoryEvent); } catch { duplicateRejected = true; }
    const afterDuplicate = await db.getQuestionRecords("questions");
    const stableOnDuplicate = afterDuplicate.find((q) => q.id === "q-one").memoryState.U === 0.1 && (await db.getQuestionRecords("memoryReviews")).length === 1;
    const collections = ["questions", "questionAnswers", "questionBanks", "questionSources", "assessmentSessions", "assessmentAttempts", "memoryReviews", "questionMedia"];
    const mediaBackup = await import("/src/tools/questionMediaBackup.js");
    const snapshot = Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await db.getQuestionRecords(name)])));
    snapshot.questionMedia = await mediaBackup.encodeQuestionMedia(snapshot.questionMedia);
    window.APP_VERSION = `${window.APP_VERSION}-restored`;
    await db.initDB();
    snapshot.questionMedia = mediaBackup.decodeQuestionMedia(snapshot.questionMedia);
    await db.replaceQuestionCollections(snapshot);
    const restoredQuestions = await db.getQuestionRecords("questions");
    const restoredAnswers = await db.getQuestionRecords("questionAnswers");
    const restoredSources = await db.getQuestionRecords("questionSources");
    const media = (await db.getQuestionRecords("questionMedia"))[0].blob;
    return {
      atomicPreserved: badSaveRejected && atomicPreserved,
      memoryEventAtomic: savedQuestion.find((q) => q.id === "q-one").memoryState.U === 0.1 && reviews.length === 1,
      duplicateAtomic: duplicateRejected && stableOnDuplicate,
      mediaRoundTrip: media instanceof Blob && await media.text() === "original media",
      freshRestoreReferences: restoredQuestions.some((q) => q.id === "q-one") && restoredQuestions.some((q) => q.id === "draft-one") && restoredAnswers[0]?.id === "ans-one" && restoredSources[0]?.status === "staging" && restoredSources[0]?.questionIds[0] === "draft-one"
    };
  });
  check("failed multi-store restore rolls back atomically", result.atomicPreserved);
  check("Memory review and canonical question schedule persist together", result.memoryEventAtomic);
  check("duplicate review event cannot overwrite question state", result.duplicateAtomic);
  check("IndexedDB preserves media Blob bytes", result.mediaRoundTrip);
  check("fresh database restore preserves canonical IDs and linked records", result.freshRestoreReferences);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
if (failed) process.exitCode = 1;
