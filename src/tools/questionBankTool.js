import { extractPdfLayoutLinesFromBuffer } from "./pdfBoundaries.js";
import { generateAssessment, questionEvidence, questionPerformance } from "./assessmentEngine.js";
import { createSerializedWriter } from "./serializedWriter.js";
import { createAssessmentAttemptEvents } from "./assessmentAttempt.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initQuestionBankTool({ getQuestionRecords, replaceQuestionRecords, replaceQuestionCollections, putQuestionRecords, addDeck, getDecksForSubject, getAllTags, addTag }) {
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
  const bulkTag = document.getElementById("questionBulkTag");
  const captureRead = document.getElementById("captureRead");
  const captureSave = document.getElementById("captureSave");
  const linkedAnswerRead = document.getElementById("linkedAnswerRead");
  const linkedAnswerSave = document.getElementById("linkedAnswerSave");
  let activeSession = null;
  async function ensureMemoryDeck() {
    const decks = await getDecksForSubject("Question Bank");
    return decks.find((deck) => deck.name === "Captured questions")
      || addDeck({ name: "Captured questions", subject: "Question Bank" });
  }
  async function extractDocumentText(inputId) {
    const f = document.getElementById(inputId)?.files?.[0];
    if (!f) throw new Error("Select both PDFs first.");
    const lines = await extractPdfLayoutLinesFromBuffer(await f.arrayBuffer());
    return lines.map((line) => line.items.map((item) => item.str).join(" ").trim()).filter(Boolean).join("\n");
  }
  async function refreshAnswerQuestions() {
    const select = document.getElementById("answerQuestionSelect");
    const questions = await getQuestionRecords("questions");
    const eligible = questions.filter((question) => question.status === "confirmed" && (question.bankIds || []).length);
    select.innerHTML = eligible.map((question) => `<option value="${esc(question.id)}">${esc(question.sourceQuestionLabel || question.id)} · ${esc(question.prompt?.[0]?.text || "")}</option>`).join("");
    if (!eligible.length) select.innerHTML = '<option value="">No confirmed bank questions</option>';
  }
  linkedAnswerRead?.addEventListener("click", async () => {
    try {
      document.getElementById("linkedAnswerText").value = await extractDocumentText("linkedAnswerPdf");
      status.textContent = "Extracted editable answer text. Review it and link it to the selected question.";
    } catch (error) { status.textContent = error.message; }
  });
  linkedAnswerSave?.addEventListener("click", async () => {
    const questionId = document.getElementById("answerQuestionSelect").value;
    const text = document.getElementById("linkedAnswerText").value.trim();
    const pdf = document.getElementById("linkedAnswerPdf").files[0];
    if (!questionId || !text || !pdf) { status.textContent = "Choose a question and answer PDF, extract and review its text, then confirm."; return; }
    const questions = await getQuestionRecords("questions");
    const question = questions.find((row) => row.id === questionId);
    if (!question) { status.textContent = "The selected question no longer exists."; return; }
    const answers = await getQuestionRecords("questionAnswers");
    const sources = await getQuestionRecords("questionSources");
    const answerId = crypto.randomUUID();
    const memoryDeck = question.memoryDeckId ? null : await ensureMemoryDeck();
    const nextQuestion = { ...question, answerIds: [...new Set([...(question.answerIds || []), answerId])], memoryDeckId: question.memoryDeckId || memoryDeck.id, revision: (question.revision || 1) + 1, updatedAt: Date.now() };
    await replaceQuestionCollections({
      questions: questions.map((row) => row.id === questionId ? nextQuestion : row),
      questionAnswers: [...answers, { id: answerId, blocks: [{ type: "text", text }], sourceId: question.sourceId, sourceLabel: pdf.name, createdAt: Date.now(), status: "confirmed", questionIds: [questionId] }],
      questionSources: sources.map((source) => source.id === question.sourceId ? { ...source, answerIds: [...new Set([...(source.answerIds || []), answerId])] } : source)
    });
    status.textContent = `Linked the answer to ${question.sourceQuestionLabel || "the question"}. Memory now reads the canonical question and answer records.`;
    document.getElementById("linkedAnswerText").value = "";
    await refreshAnswerQuestions();
  });
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
    const memoryDeck = await ensureMemoryDeck();
    const answerFiles = ["captureQuestionPdf", "captureAnswerPdf"].map((id) => document.getElementById(id).files[0].name);
    await replaceQuestionCollections({
      questionAnswers: [...answers, { id: answerId, blocks: [{ type: "text", text: answer }], sourceId, sourceLabel: answerFiles[1], createdAt: Date.now(), status: "confirmed" }],
      questions: [...questions, { id: questionId, kind: "question", prompt: [{ type: "text", text: prompt }], answerIds: [answerId], maxMarks: Number(document.getElementById("captureMarks").value) || null, tagIds: [], bankIds: [], memoryDeckId: memoryDeck.id, sourceId, sourceLabel: answerFiles[0], status: "confirmed", revision: 1, createdAt: Date.now() }],
      questionSources: [...sources, { id: sourceId, fileNames: answerFiles, importedAt: Date.now(), status: "committed", questionIds: [questionId], answerIds: [answerId] }]
    });
    status.textContent = "Saved the question and linked answer with one stable question ID.";
  });
  const renderHeatmap = async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) return;
    const questions = (await getQuestionRecords("questions")).filter((q) => (bank.questionIds || []).includes(q.id));
    const attempts = await getQuestionRecords("assessmentAttempts");
    const memoryReviews = await getQuestionRecords("memoryReviews");
    const byTag = new Map();
    const tagRecords = await getAllTags();
    const tagNames = new Map(tagRecords.map((tag) => [tag.id, tag.title]));
    for (const q of questions) {
      const evidence = questionEvidence(q.id, attempts);
      const tags = q.tagIds?.length ? q.tagIds.map((id) => tagNames.get(id) || "Unknown topic") : ["Untagged"];
      for (const tag of tags) {
        const row = byTag.get(tag) || { total: 0, unseen: 0, weak: 0, full: 0, repeated: 0, memoryReviews: 0 };
        row.total++;
        if (evidence.state === "unseen") row.unseen++;
        else if (evidence.state === "weak") row.weak++;
        else { row.full++; if (evidence.state === "repeated-full") row.repeated++; }
        row.memoryReviews += questionPerformance(q.id, { attempts, memoryReviews }).memory.count;
        byTag.set(tag, row);
      }
    }
    heatmap.innerHTML = `<h3>Coverage · ${questions.length} questions</h3>` + [...byTag].map(([tag, row]) => `<p><strong>${esc(tag)}</strong>: ${row.unseen} unseen · ${row.weak} below full marks · ${row.full} full marks · ${row.repeated} repeated full on one question · ${row.memoryReviews} Memory reviews</p>`).join("");
  };
  heatmapBtn?.addEventListener("click", renderHeatmap);
  let staged = [];
  let stagedSourceId = null;
  const excludedDraftIds = new Set();
  const renderStaged = () => {
    list.innerHTML = staged.map((q, i) => `<article class="question-item" data-index="${i}"><label><input type="checkbox" class="select-question" aria-label="Select ${esc(q.label)}"></label><strong>${esc(q.label)} · page ${q.page}</strong><textarea aria-label="Question prompt">${esc(q.text)}</textarea><label>Topic tags (comma separated)<input value="${esc(q.tags || "")}" aria-label="Topic tags"></label><div><button type="button" data-action="split">Split at cursor</button>${i ? '<button type="button" data-action="merge">Merge with previous</button>' : ""}<button type="button" data-action="exclude">Exclude</button></div></article>`).join("");
    commit.hidden = !staged.length;
  };
  let draftSaveTimer = 0;
  const sourceWriter = createSerializedWriter();
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
  const enqueueDraftSave = () => {
    const write = sourceWriter.enqueue(persistDrafts);
    write.catch((error) => { status.textContent = `Draft save failed: ${error.message}`; });
    return write;
  };
  const flushDraftSave = async () => {
    clearTimeout(draftSaveTimer);
    await sourceWriter.flush();
    if (stagedSourceId) await enqueueDraftSave();
  };
  const scheduleDraftSave = () => { clearTimeout(draftSaveTimer); draftSaveTimer = setTimeout(() => { enqueueDraftSave().catch(() => {}); }, 300); };
  async function bulkTagSelected(remove = false) {
    const selected = [...list.querySelectorAll(".question-item")].filter((el) => el.querySelector(".select-question")?.checked);
    const title = String(bulkTag.value || "").trim();
    if (!selected.length || !title) { status.textContent = "Select questions and enter a topic tag."; return; }
    const tags = await getAllTags();
    let tag = tags.find((row) => row.title.trim().toLowerCase() === title.toLowerCase());
    if (!tag && !remove) tag = await addTag({ title, subject: "" });
    for (const el of selected) {
      const index = Number(el.dataset.index);
      const names = (staged[index].tags || "").split(",").map((x) => x.trim()).filter(Boolean);
      staged[index].tags = (remove ? names.filter((value) => value.toLowerCase() !== title.toLowerCase()) : [...new Set([...names, title])]).join(", ");
      el.querySelectorAll("input")[1].value = staged[index].tags;
    }
    if (!stagedSourceId) {
      const selectedIds = new Set(selected.map((el) => staged[Number(el.dataset.index)].id));
      const records = await getQuestionRecords("questions");
      const updated = records.map((question) => {
        if (!selectedIds.has(question.id)) return question;
        const ids = new Set(question.tagIds || []);
        if (remove) { if (tag) ids.delete(tag.id); }
        else if (tag) ids.add(tag.id);
        return { ...question, tagIds: [...ids], updatedAt: Date.now() };
      });
      await replaceQuestionRecords("questions", updated);
    } else {
      await flushDraftSave();
    }
    status.textContent = `${remove ? "Removed" : "Applied"} “${title}” ${remove ? "from" : "to"} ${selected.length} selected question${selected.length === 1 ? "" : "s"}.`;
  }
  document.getElementById("questionTagApply")?.addEventListener("click", () => bulkTagSelected(false));
  document.getElementById("questionTagRemove")?.addEventListener("click", () => bulkTagSelected(true));
  list.addEventListener("input", (event) => {
    const article = event.target.closest(".question-item");
    if (!article || event.target.matches(".select-question")) return;
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
    await refreshAnswerQuestions();
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
    commit.disabled = true;
    list.inert = true;
    try { await flushDraftSave(); }
    catch (error) { status.textContent = `Could not flush the saved import: ${error.message}`; commit.disabled = false; list.inert = false; return; }
    // Every edit autosave is now settled. Clearing the active source prevents
    // a late debounce from writing draft records over the confirmed batch.
    stagedSourceId = null;
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
    commit.disabled = false;
    list.inert = false;
    practice.hidden = false;
    const allTags = (await getAllTags()).filter((tag) => imported.some((q) => (q.tagIds || []).includes(tag.id))).sort((a, b) => a.title.localeCompare(b.title));
    topicFilters.innerHTML = allTags.map((tag) => `<label><input type="checkbox" value="${esc(tag.id)}"> ${esc(tag.title)}</label>`).join("") || "No topics have been tagged in this bank yet.";
    await refreshAnswerQuestions();
  });
  generate?.addEventListener("click", async () => {
    const banks = await getQuestionRecords("questionBanks");
    const bank = banks.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
    if (!bank) { status.textContent = "Import a bank first."; return; }
    const questions = (await getQuestionRecords("questions")).filter((q) => (q.bankIds || []).includes(bank.id));
    const answers = await getQuestionRecords("questionAnswers");
    const attempts = await getQuestionRecords("assessmentAttempts");
    const memoryReviews = await getQuestionRecords("memoryReviews");
    const selectedTags = [...topicFilters.querySelectorAll("input:checked")].map((el) => el.value);
    const selection = generateAssessment({ questions, attempts, memoryReviews, tagIds: selectedTags, count: Number(document.getElementById("questionCount").value) || 8 });
    activeSession = { id: crypto.randomUUID(), bankId: bank.id, status: "in-progress", createdAt: Date.now(), seed: selection.seed, asOf: selection.asOf, policyVersion: selection.policyVersion, tagIds: selectedTags, targetCount: Number(document.getElementById("questionCount").value) || 8, items: selection.items };
    const sessions = await getQuestionRecords("assessmentSessions");
    await replaceQuestionRecords("assessmentSessions", [...sessions, activeSession]);
    const byId = new Map(questions.map((q) => [q.id, q]));
    test.innerHTML = selection.items.map((item, i) => {
      const q = byId.get(item.questionId);
      const linkedAnswers = answers.filter((a) => (q?.answerIds || []).includes(a.id));
      const answerContent = linkedAnswers.length ? linkedAnswers.map((a) => (a.blocks || []).map((b) => b.text || "").join("\n")).join("\n\n") : "No answer is linked to this question yet.";
      return `<article class="question-item" data-id="${esc(item.questionId)}" data-shown-at="${Date.now()}"><strong>${i + 1}. ${esc(q?.sourceQuestionLabel || "Question")} · ${esc(item.evidenceState)}</strong><p>${esc(q?.prompt?.map((b) => b.text).join("\n") || "")}</p><details><summary>Reveal answer / mark scheme</summary><p>${esc(answerContent)}</p></details><label>Awarded marks <input class="earned" type="number" min="0" max="${item.maxMarks ?? ""}"></label><label>Maximum marks <input class="maximum" type="number" min="1" value="${item.maxMarks ?? ""}"></label></article>`;
    }).join("") + '<button id="questionMark" type="button">Save marked questions</button>';
    document.getElementById("questionMark").addEventListener("click", async () => {
      const existingAttempts = await getQuestionRecords("assessmentAttempts");
      const entries = [...test.querySelectorAll(".question-item")].map((el) => ({
        questionId: el.dataset.id,
        awardedMarks: el.querySelector(".earned").value,
        maxMarks: el.querySelector(".maximum").value,
        elapsedMs: Math.max(0, Date.now() - Number(el.dataset.shownAt || Date.now()))
      }));
      const alreadyScored = new Set(existingAttempts.filter((a) => a.sessionId === activeSession.id && a.status === "scored").map((a) => a.questionId));
      const events = createAssessmentAttemptEvents({ sessionId: activeSession.id, entries, existingAttempts, mode: "practice" });
      await putQuestionRecords("assessmentAttempts", events);
      for (const el of test.querySelectorAll(".question-item")) {
        if (events.some((event) => event.questionId === el.dataset.id) || alreadyScored.has(el.dataset.id)) {
          el.querySelector(".earned").disabled = true;
          el.querySelector(".maximum").disabled = true;
        }
      }
      activeSession.status = alreadyScored.size + events.length >= activeSession.items.length ? "completed" : "in-progress";
      const allSessions = await getQuestionRecords("assessmentSessions");
      await replaceQuestionRecords("assessmentSessions", allSessions.map((s) => s.id === activeSession.id ? activeSession : s));
      status.textContent = `Saved ${events.length} marked responses. Unmarked questions remain unscored.`;
      await renderHeatmap();
    });
  });
}
