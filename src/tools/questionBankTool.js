import { extractPdfLayoutLinesFromBuffer } from "./pdfBoundaries.js";
import { generateAssessment, questionEvidence } from "./assessmentEngine.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initQuestionBankTool({ getQuestionRecords, replaceQuestionRecords, putQuestionRecords }) {
  const file = document.getElementById("questionPdf");
  const name = document.getElementById("questionBankName");
  const status = document.getElementById("questionStatus");
  const list = document.getElementById("questionItems");
  const extract = document.getElementById("questionImport");
  const commit = document.getElementById("questionCommit");
  const practice = document.getElementById("questionPractice");
  const generate = document.getElementById("questionGenerate");
  const test = document.getElementById("questionTest");
  const heatmapBtn = document.getElementById("questionHeatmap");
  const heatmap = document.getElementById("questionHeatmapView");
  const topicFilters = document.getElementById("questionTopicFilters");
  const captureRead = document.getElementById("captureRead");
  const captureSave = document.getElementById("captureSave");
  let activeSession = null;
  async function extractDocumentText(inputId) {
    const f = document.getElementById(inputId)?.files?.[0];
    if (!f) throw new Error("Select both PDFs first.");
    const lines = await extractPdfLayoutLinesFromBuffer(await f.arrayBuffer());
    return lines.map((line) => line.items.map((item) => item.str).join(" ").trim()).filter(Boolean).join("\n");
  }
  captureRead?.addEventListener("click", async () => {
    try {
      const [promptText, answerText] = await Promise.all([extractDocumentText("captureQuestionPdf"), extractDocumentText("captureAnswerPdf")]);
      document.getElementById("capturePrompt").value = promptText;
      document.getElementById("captureAnswer").value = answerText;
      status.textContent = "Extracted editable text from both PDFs. Review it before saving.";
    } catch (error) { status.textContent = error.message; }
  });
  captureSave?.addEventListener("click", async () => {
    const prompt = document.getElementById("capturePrompt").value.trim();
    const answer = document.getElementById("captureAnswer").value.trim();
    if (!prompt || !answer) { status.textContent = "Both question and answer text are required."; return; }
    const questions = await getQuestionRecords("questions");
    const answers = await getQuestionRecords("questionAnswers");
    const sources = await getQuestionRecords("questionSources");
    const sourceId = crypto.randomUUID();
    const questionId = crypto.randomUUID();
    const answerId = crypto.randomUUID();
    const answerFiles = ["captureQuestionPdf", "captureAnswerPdf"].map((id) => document.getElementById(id).files[0].name);
    await replaceQuestionRecords("questionAnswers", [...answers, { id: answerId, blocks: [{ type: "text", text: answer }], sourceId, sourceLabel: answerFiles[1], createdAt: Date.now(), status: "confirmed" }]);
    await replaceQuestionRecords("questions", [...questions, { id: questionId, kind: "question", prompt: [{ type: "text", text: prompt }], answerIds: [answerId], maxMarks: Number(document.getElementById("captureMarks").value) || null, tags: [], bankIds: [], sourceId, sourceLabel: answerFiles[0], status: "confirmed", revision: 1, createdAt: Date.now() }]);
    await replaceQuestionRecords("questionSources", [...sources, { id: sourceId, fileNames: answerFiles, importedAt: Date.now(), status: "committed", questionIds: [questionId], answerIds: [answerId] }]);
    status.textContent = "Saved the question and linked answer with one stable question ID.";
  });
  const renderHeatmap = async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) return;
    const questions = (await getQuestionRecords("questions")).filter((q) => (bank.questionIds || []).includes(q.id));
    const attempts = await getQuestionRecords("assessmentAttempts");
    const byTag = new Map();
    for (const q of questions) {
      const evidence = questionEvidence(q.id, attempts);
      const tags = q.tags?.length ? q.tags : ["Untagged"];
      for (const tag of tags) {
        const row = byTag.get(tag) || { total: 0, unseen: 0, weak: 0, full: 0, repeated: 0 };
        row.total++;
        if (evidence.state === "unseen") row.unseen++;
        else if (evidence.state === "weak") row.weak++;
        else { row.full++; if (evidence.state === "repeated-full") row.repeated++; }
        byTag.set(tag, row);
      }
    }
    heatmap.innerHTML = `<h3>Coverage · ${questions.length} questions</h3>` + [...byTag].map(([tag, row]) => `<p><strong>${esc(tag)}</strong>: ${row.unseen} unseen · ${row.weak} below full marks · ${row.full} full marks · ${row.repeated} repeated full</p>`).join("");
  };
  heatmapBtn?.addEventListener("click", renderHeatmap);
  let staged = [];
  let stagedSourceId = null;
  const renderStaged = () => {
    list.innerHTML = staged.map((q, i) => `<article class="question-item" data-index="${i}"><strong>${esc(q.label)} · page ${q.page}</strong><textarea aria-label="Question prompt">${esc(q.text)}</textarea><label>Topic tags (comma separated)<input value="${esc(q.tags || "")}" aria-label="Topic tags"></label></article>`).join("");
    commit.hidden = !staged.length;
  };
  document.getElementById("questionResume")?.addEventListener("click", async () => {
    const sources = (await getQuestionRecords("questionSources")).filter((source) => source.status === "staging").sort((a, b) => Number(b.importedAt) - Number(a.importedAt));
    const source = sources[0];
    if (!source) { status.textContent = "No saved import needs review."; return; }
    const questions = await getQuestionRecords("questions");
    staged = questions.filter((q) => source.questionIds.includes(q.id)).map((q) => ({ id: q.id, label: q.sourceQuestionLabel, page: q.sourcePage, text: q.prompt?.map((b) => b.text).join("\n") || "", tags: (q.tags || []).join(", "), order: q.sourceOrder }));
    stagedSourceId = source.id;
    name.value = source.bankName || "Practice questions";
    renderStaged();
    status.textContent = `Resumed ${staged.length} staged questions from ${source.fileName}.`;
  });
  extract?.addEventListener("click", async () => {
    if (!file?.files?.[0]) { status.textContent = "Choose a PDF first."; return; }
    extract.disabled = true; status.textContent = "Reading PDF text…";
    try {
      const pdf = file.files[0];
      const lines = await extractPdfLayoutLinesFromBuffer(await pdf.arrayBuffer(), (p, n) => { status.textContent = `Reading page ${p} of ${n}…`; });
      const buckets = [];
      // Conservative numbered-boundary proposal. The user edits every prompt
      // before commit; equations such as x = 4 do not look like boundaries.
      for (const line of lines) {
        const text = line.items.map((item) => item.str).join(" ").trim();
        if (!text) continue;
        const match = text.match(/^\s*((?:Question\s*)?\d{1,3}(?:\s*\([a-zivx]+\))*)[.)]?\s+(.+)$/i);
        if (match && (/question/i.test(match[1]) || /\d/.test(match[1]))) {
          buckets.push({ label: match[1].replace(/^Question\s*/i, "Q"), page: line.page, text: match[2] });
        } else if (buckets.length) buckets.at(-1).text += `\n${text}`;
      }
      stagedSourceId = crypto.randomUUID();
      staged = buckets.map((q, i) => ({ ...q, id: crypto.randomUUID(), order: i + 1, tags: "" }));
      const priorQuestions = await getQuestionRecords("questions");
      const priorSources = await getQuestionRecords("questionSources");
      const drafts = staged.map((q) => ({ id: q.id, kind: "question", prompt: [{ type: "text", text: q.text }], answerIds: [], maxMarks: null, tags: [], bankIds: [], sourceId: stagedSourceId, sourceLabel: pdf.name, sourcePage: q.page, sourceQuestionLabel: q.label, sourceOrder: q.order, status: "draft", revision: 1, createdAt: Date.now() }));
      await replaceQuestionRecords("questions", [...priorQuestions, ...drafts]);
      await replaceQuestionRecords("questionSources", [...priorSources, { id: stagedSourceId, fileName: pdf.name, bankName: name.value, importedAt: Date.now(), status: "staging", questionIds: staged.map((q) => q.id) }]);
      renderStaged();
      status.textContent = staged.length ? `Found ${staged.length} possible question boundaries. Review and correct them before saving.` : "No numbered question boundaries found. This PDF may need manual capture or OCR.";
    } catch (error) { status.textContent = `Could not read this PDF: ${error.message}`; }
    finally { extract.disabled = false; }
  });
  commit?.addEventListener("click", async () => {
    const items = [...list.querySelectorAll(".question-item")];
    const bankId = crypto.randomUUID();
    const sourceId = stagedSourceId || crypto.randomUUID();
    const questions = await getQuestionRecords("questions");
    const banks = await getQuestionRecords("questionBanks");
    const sources = await getQuestionRecords("questionSources");
    const imported = items.map((el, i) => {
      const q = staged[Number(el.dataset.index)];
      const existing = questions.find((row) => row.id === q.id) || {};
      return { ...existing, id: q.id, kind: "question", prompt: [{ type: "text", text: el.querySelector("textarea").value }], answerIds: [], maxMarks: existing.maxMarks ?? null, tags: el.querySelector("input").value.split(",").map((x) => x.trim()).filter(Boolean), bankIds: [...new Set([...(existing.bankIds || []), bankId])], sourceId, sourceLabel: existing.sourceLabel || file.files[0]?.name, sourcePage: q.page, sourceQuestionLabel: q.label, sourceOrder: i + 1, status: "confirmed", createdAt: existing.createdAt || Date.now(), revision: existing.revision || 1 };
    });
    const batch = [...questions, ...imported];
    await replaceQuestionRecords("questions", batch);
    await replaceQuestionRecords("questionSources", sources.map((source) => source.id === sourceId ? { ...source, status: "committed", questionIds: imported.map((q) => q.id), bankName: name.value } : source));
    await replaceQuestionRecords("questionBanks", [...banks, { id: bankId, name: name.value.trim() || "Practice questions", questionIds: imported.map((q) => q.id), createdAt: Date.now() }]);
    status.textContent = `Saved ${imported.length} questions to “${name.value.trim() || "Practice questions"}”.`;
    commit.hidden = true;
    practice.hidden = false;
    const allTags = [...new Set(imported.flatMap((q) => q.tags))].sort((a, b) => a.localeCompare(b));
    topicFilters.innerHTML = allTags.map((tag, i) => `<label><input type="checkbox" value="${esc(tag)}"> ${esc(tag)}</label>`).join("") || "No topics have been tagged in this bank yet.";
  });
  generate?.addEventListener("click", async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) { status.textContent = "Import a bank first."; return; }
    const questions = (await getQuestionRecords("questions")).filter((q) => (q.bankIds || []).includes(bank.id));
    const answers = await getQuestionRecords("questionAnswers");
    const attempts = await getQuestionRecords("assessmentAttempts");
    const selectedTags = [...topicFilters.querySelectorAll("input:checked")].map((el) => el.value);
    const selection = generateAssessment({ questions: questions.map((q) => ({ ...q, tagIds: q.tags || [] })), attempts, tagIds: selectedTags, count: Number(document.getElementById("questionCount").value) || 8 });
    activeSession = { id: crypto.randomUUID(), bankId: bank.id, status: "in-progress", createdAt: Date.now(), seed: selection.seed, policyVersion: selection.policyVersion, items: selection.items.map((item) => ({ ...item, revision: questions.find((q) => q.id === item.questionId)?.revision || 1 })) };
    const sessions = await getQuestionRecords("assessmentSessions");
    await replaceQuestionRecords("assessmentSessions", [...sessions, activeSession]);
    const byId = new Map(questions.map((q) => [q.id, q]));
    test.innerHTML = selection.items.map((item, i) => {
      const q = byId.get(item.questionId);
      const linkedAnswers = answers.filter((a) => (q?.answerIds || []).includes(a.id));
      const answerContent = linkedAnswers.length ? linkedAnswers.map((a) => (a.blocks || []).map((b) => b.text || "").join("\n")).join("\n\n") : "No answer is linked to this question yet.";
      return `<article class="question-item" data-id="${esc(item.questionId)}"><strong>${i + 1}. ${esc(q?.sourceQuestionLabel || "Question")} · ${esc(item.evidenceState)}</strong><p>${esc(q?.prompt?.map((b) => b.text).join("\n") || "")}</p><details><summary>Reveal answer / mark scheme</summary><p>${esc(answerContent)}</p></details><label>Awarded marks <input class="earned" type="number" min="0" max="${item.maxMarks ?? ""}"></label><label>Maximum marks <input class="maximum" type="number" min="1" value="${item.maxMarks ?? ""}"></label></article>`;
    }).join("") + '<button id="questionMark" type="button">Save marked questions</button>';
    document.getElementById("questionMark").addEventListener("click", async () => {
      const events = [...test.querySelectorAll(".question-item")].flatMap((el) => {
        const earned = el.querySelector(".earned").value;
        const maximum = Number(el.querySelector(".maximum").value);
        if (earned === "" || !Number.isFinite(maximum) || maximum <= 0) return [];
        const marks = Number(earned);
        if (marks < 0 || marks > maximum) return [];
        return [{ id: crypto.randomUUID(), sessionId: activeSession.id, questionId: el.dataset.id, awardedMarks: marks, maxMarks: maximum, createdAt: Date.now(), status: "scored", mode: "practice", markingSource: "manual" }];
      });
      await putQuestionRecords("assessmentAttempts", events);
      activeSession.status = events.length === activeSession.items.length ? "completed" : "in-progress";
      const allSessions = await getQuestionRecords("assessmentSessions");
      await replaceQuestionRecords("assessmentSessions", allSessions.map((s) => s.id === activeSession.id ? activeSession : s));
      status.textContent = `Saved ${events.length} marked responses. Unmarked questions remain unscored.`;
      await renderHeatmap();
    });
  });
}
