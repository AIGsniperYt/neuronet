import { extractPdfLayoutLinesFromBuffer } from "./pdfBoundaries.js";
import { generateAssessment, questionEvidence } from "./assessmentEngine.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initQuestionBankTool({ getQuestionRecords, replaceQuestionRecords, replaceQuestionCollections, putQuestionRecords, addCard, getAllTags, addTag }) {
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
    await replaceQuestionCollections({
      questionAnswers: [...answers, { id: answerId, blocks: [{ type: "text", text: answer }], sourceId, sourceLabel: answerFiles[1], createdAt: Date.now(), status: "confirmed" }],
      questions: [...questions, { id: questionId, kind: "question", prompt: [{ type: "text", text: prompt }], answerIds: [answerId], maxMarks: Number(document.getElementById("captureMarks").value) || null, tagIds: [], bankIds: [], sourceId, sourceLabel: answerFiles[0], status: "confirmed", revision: 1, createdAt: Date.now() }],
      questionSources: [...sources, { id: sourceId, fileNames: answerFiles, importedAt: Date.now(), status: "committed", questionIds: [questionId], answerIds: [answerId] }]
    });
    await addCard({ id: questionId, questionId, front: prompt, back: answer, deck: "Question Bank", tags: [], origin: "question-capture", links: { nodeId: questionId } });
    status.textContent = "Saved the question and linked answer with one stable question ID.";
  });
  const renderHeatmap = async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) return;
    const questions = (await getQuestionRecords("questions")).filter((q) => (bank.questionIds || []).includes(q.id));
    const attempts = await getQuestionRecords("assessmentAttempts");
    const byTag = new Map();
    const tagRecords = await getAllTags();
    const tagNames = new Map(tagRecords.map((tag) => [tag.id, tag.title]));
    for (const q of questions) {
      const evidence = questionEvidence(q.id, attempts);
      const tags = q.tagIds?.length ? q.tagIds.map((id) => tagNames.get(id) || "Unknown topic") : ["Untagged"];
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
  const excludedDraftIds = new Set();
  const renderStaged = () => {
    list.innerHTML = staged.map((q, i) => `<article class="question-item" data-index="${i}"><strong>${esc(q.label)} · page ${q.page}</strong><textarea aria-label="Question prompt">${esc(q.text)}</textarea><label>Topic tags (comma separated)<input value="${esc(q.tags || "")}" aria-label="Topic tags"></label><div><button type="button" data-action="split">Split at cursor</button>${i ? '<button type="button" data-action="merge">Merge with previous</button>' : ""}<button type="button" data-action="exclude">Exclude</button></div></article>`).join("");
    commit.hidden = !staged.length;
  };
  let draftSaveTimer = 0;
  const persistDrafts = async () => {
    if (!stagedSourceId) return;
    const sourceRows = await getQuestionRecords("questionSources");
    const sources = sourceRows.map((source) => source.id === stagedSourceId ? { ...source, questionIds: staged.map((q) => q.id), excludedQuestionIds: [...excludedDraftIds], bankName: name.value } : source);
    const allQuestions = await getQuestionRecords("questions");
    const ids = new Set(staged.map((q) => q.id));
    const drafts = staged.map((q) => ({ id: q.id, kind: "question", prompt: [{ type: "text", text: q.text }], answerIds: [], maxMarks: null, tags: (q.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean), bankIds: [], sourceId: stagedSourceId, sourcePage: q.page, sourceQuestionLabel: q.label, sourceOrder: q.order, status: "draft", revision: 1, createdAt: q.createdAt || Date.now() }));
    const retained = allQuestions.filter((q) => !ids.has(q.id)).map((q) => excludedDraftIds.has(q.id) ? { ...q, status: "excluded" } : q);
    await replaceQuestionCollections({ questions: [...retained, ...drafts], questionSources: sources });
  };
  const scheduleDraftSave = () => { clearTimeout(draftSaveTimer); draftSaveTimer = setTimeout(() => persistDrafts().catch((error) => { status.textContent = `Draft save failed: ${error.message}`; }), 300); };
  list.addEventListener("input", (event) => {
    const article = event.target.closest(".question-item");
    if (!article) return;
    const q = staged[Number(article.dataset.index)];
    if (event.target.matches("textarea")) q.text = event.target.value;
    else if (event.target.matches("input")) q.tags = event.target.value;
    scheduleDraftSave();
  });
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const article = button.closest(".question-item");
    const index = Number(article.dataset.index);
    const q = staged[index];
    if (button.dataset.action === "exclude") { excludedDraftIds.add(q.id); staged.splice(index, 1); }
    if (button.dataset.action === "merge" && index > 0) {
      staged[index - 1].text += `\n${q.text}`;
      staged[index - 1].tags = [...new Set(`${staged[index - 1].tags || ""},${q.tags || ""}`.split(",").map((t) => t.trim()).filter(Boolean))].join(", ");
      staged.splice(index, 1);
    }
    if (button.dataset.action === "split") {
      const area = article.querySelector("textarea");
      const cursor = area.selectionStart;
      if (cursor <= 0 || cursor >= area.value.length) { status.textContent = "Place the cursor inside the question text to split it."; return; }
      const first = area.value.slice(0, cursor).trim();
      const second = area.value.slice(cursor).trim();
      if (!first || !second) return;
      q.text = first;
      staged.splice(index + 1, 0, { id: crypto.randomUUID(), label: `${q.label} (continued)`, page: q.page, text: second, tags: q.tags, order: q.order + 0.5 });
    }
    staged.forEach((item, i) => { item.order = i + 1; });
    renderStaged();
    await persistDrafts();
  });
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
      await replaceQuestionCollections({
        questions: [...priorQuestions, ...drafts],
        questionSources: [...priorSources, { id: stagedSourceId, fileName: pdf.name, bankName: name.value, importedAt: Date.now(), status: "staging", questionIds: staged.map((q) => q.id) }]
      });
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
    const requestedNames = [...new Set(items.flatMap((el) => el.querySelector("input").value.split(",").map((x) => x.trim()).filter(Boolean)))];
    const tagRecords = await getAllTags();
    const tagIds = new Map(tagRecords.map((tag) => [tag.title.trim().toLowerCase(), tag.id]));
    for (const title of requestedNames) {
      const key = title.toLowerCase();
      if (!tagIds.has(key)) {
        const record = await addTag({ title, subject: "" });
        tagIds.set(key, record.id);
      }
    }
    const imported = items.map((el, i) => {
      const q = staged[Number(el.dataset.index)];
      const existing = questions.find((row) => row.id === q.id) || {};
      const itemTags = el.querySelector("input").value.split(",").map((x) => x.trim()).filter(Boolean).map((title) => tagIds.get(title.toLowerCase())).filter(Boolean);
      return { ...existing, id: q.id, kind: "question", prompt: [{ type: "text", text: el.querySelector("textarea").value }], answerIds: [], maxMarks: existing.maxMarks ?? null, tagIds: [...new Set([...(existing.tagIds || []), ...itemTags])], bankIds: [...new Set([...(existing.bankIds || []), bankId])], sourceId, sourceLabel: existing.sourceLabel || file.files[0]?.name, sourcePage: q.page, sourceQuestionLabel: q.label, sourceOrder: i + 1, status: "confirmed", createdAt: existing.createdAt || Date.now(), revision: existing.revision || 1 };
    });
    const batch = [...questions, ...imported];
    await replaceQuestionCollections({
      questions: batch,
      questionSources: sources.map((source) => source.id === sourceId ? { ...source, status: "committed", questionIds: imported.map((q) => q.id), bankName: name.value } : source),
      questionBanks: [...banks, { id: bankId, name: name.value.trim() || "Practice questions", questionIds: imported.map((q) => q.id), createdAt: Date.now() }]
    });
    status.textContent = `Saved ${imported.length} questions to “${name.value.trim() || "Practice questions"}”.`;
    commit.hidden = true;
    practice.hidden = false;
    const allTags = (await getAllTags()).filter((tag) => imported.some((q) => (q.tagIds || []).includes(tag.id))).sort((a, b) => a.title.localeCompare(b.title));
    topicFilters.innerHTML = allTags.map((tag) => `<label><input type="checkbox" value="${esc(tag.id)}"> ${esc(tag.title)}</label>`).join("") || "No topics have been tagged in this bank yet.";
  });
  generate?.addEventListener("click", async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) { status.textContent = "Import a bank first."; return; }
    const questions = (await getQuestionRecords("questions")).filter((q) => (q.bankIds || []).includes(bank.id));
    const answers = await getQuestionRecords("questionAnswers");
    const attempts = await getQuestionRecords("assessmentAttempts");
    const selectedTags = [...topicFilters.querySelectorAll("input:checked")].map((el) => el.value);
    const selection = generateAssessment({ questions, attempts, tagIds: selectedTags, count: Number(document.getElementById("questionCount").value) || 8 });
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
