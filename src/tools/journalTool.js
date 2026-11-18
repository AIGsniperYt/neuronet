import { createEditor } from "../vendor/md-format/mdeditor.js";
import {
  createJournalEntry,
  filterJournals,
  formatJournalDayLabel,
  formatJournalTime,
  groupJournalsByMonth,
  journalDisplayTitle,
  journalSnippet,
  journalWordCount,
  pickJournalPrompt,
  toDateKey,
  touchJournalEntry
} from "./journalModel.js";

// STUB: this tool persists through the journal accessors in src/db.js
// (IndexedDB today). The planned storage overhaul moves personal reflections to
// the PC/file system — replace that persistence layer, keep this writing
// experience intact.

const EDITOR_TOOLBAR = [
  "bold", "italic", "strike", "code",
  "ul", "ol", "task", "quote", "link"
];

export async function initJournalTool(deps = {}, context = {}) {
  const { getAllJournals, getJournal, addJournal, deleteJournal, escapeHtml, dialog, toast } = deps;
  const $ = (id) => document.getElementById(id);
  const toolRoot = $("journalTool");
  if (!toolRoot) return;

  const el = {
    list: $("journalList"),
    listMeta: $("journalListMeta"),
    search: $("journalSearch"),
    insightFilter: $("journalInsightFilter"),
    newBtn: $("journalNewBtn"),
    title: $("journalTitle"),
    when: $("journalWhen"),
    stats: $("journalStats"),
    insightBtn: $("journalInsightBtn"),
    deleteBtn: $("journalDeleteBtn"),
    prompt: $("journalPrompt"),
    promptText: $("journalPromptText"),
    promptUse: $("journalPromptUse"),
    promptShuffle: $("journalPromptShuffle"),
    promptDismiss: $("journalPromptDismiss"),
    promptToggle: $("journalPromptToggle"),
    editorHost: $("journalEditorHost"),
    status: $("journalStatus")
  };

  let entries = [];
  let currentId = null;
  let editor = null;
  let saveTimer = null;
  let statusTimer = null;
  let disposed = false;
  let promptSeed = Date.now();
  let promptDismissed = false;
  let saving = false;
  let dirty = false;
  let insightOnly = false;
  let query = "";

  function esc(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value);
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, { sticky = false } = {}) {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    if (el.status) el.status.textContent = text || "";
    if (!sticky && text) {
      statusTimer = setTimeout(() => {
        if (el.status && el.status.textContent === text) el.status.textContent = "";
      }, 2200);
    }
  }

  function currentEntry() {
    return entries.find((entry) => entry.id === currentId) || null;
  }

  function sortLocal() {
    entries.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }

  function syncListMeta(filteredCount) {
    if (!el.listMeta) return;
    const total = entries.length;
    const insights = entries.filter((entry) => entry.insight).length;
    if (!total) {
      el.listMeta.textContent = "Nothing here yet.";
      return;
    }
    const parts = [`${total} ${total === 1 ? "entry" : "entries"}`];
    if (insights) parts.push(`${insights} ${insights === 1 ? "insight" : "insights"}`);
    if (query || insightOnly) parts.push(`${filteredCount} shown`);
    el.listMeta.textContent = parts.join(" · ");
  }

  function renderList() {
    if (!el.list) return;
    const filtered = filterJournals(entries, { query, insightOnly });
    syncListMeta(filtered.length);

    if (!filtered.length) {
      const msg = entries.length
        ? "No entries match what you're looking for."
        : "This is your space. Write anything — a realisation, a question, a thought you don't want to lose.";
      el.list.innerHTML = `<div class="journal-empty-list">${esc(msg)}</div>`;
      return;
    }

    const groups = groupJournalsByMonth(filtered);
    const today = toDateKey(Date.now());
    el.list.innerHTML = groups.map((group) => `
      <div class="journal-group">
        <div class="journal-month">${esc(group.label)}</div>
        ${group.entries.map((entry) => {
          const active = entry.id === currentId ? " active" : "";
          const day = formatJournalDayLabel(entry.dateKey, today);
          const time = formatJournalTime(entry.updatedAt || entry.createdAt);
          const meta = [day, time, `${journalWordCount(entry)} words`].filter(Boolean).join(" · ");
          return `
            <button type="button" class="journal-item${active}" data-entry-id="${esc(entry.id)}">
              <div class="journal-item-top">
                <span class="journal-item-title">${esc(journalDisplayTitle(entry))}</span>
                ${entry.insight ? '<span class="journal-item-star" title="Marked insight"><i class="fa-solid fa-star" aria-hidden="true"></i></span>' : ""}
              </div>
              <div class="journal-item-snippet">${esc(journalSnippet(entry))}</div>
              <div class="journal-item-meta">${esc(meta)}</div>
            </button>
          `;
        }).join("")}
      </div>
    `).join("");
  }

  function renderEditorMeta(entry) {
    if (!entry) return;
    const date = new Date(Number(entry.createdAt) || Date.now());
    const dayLabel = formatJournalDayLabel(entry.dateKey, toDateKey(Date.now()));
    const timeLabel = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (el.when) el.when.textContent = `${dayLabel} · ${timeLabel}`;
    const words = journalWordCount(entry);
    const updated = Number(entry.updatedAt) || Number(entry.createdAt) || 0;
    const savedLabel = updated ? ` · saved ${formatJournalTime(updated)}` : "";
    if (el.stats) el.stats.textContent = `${words} ${words === 1 ? "word" : "words"}${savedLabel}`;
    if (el.insightBtn) {
      const marked = entry.insight === true;
      el.insightBtn.setAttribute("aria-pressed", String(marked));
      el.insightBtn.classList.toggle("marked", marked);
      el.insightBtn.title = marked ? "Insight marked" : "Mark as an insight worth revisiting";
      // fa-regular webfont isn't vendored; render a solid star and style the
      // unmarked state as an outline via CSS so it works everywhere.
      el.insightBtn.innerHTML = `<i class="fa-solid fa-star" aria-hidden="true"></i>`;
    }
  }

  function renderPrompt(_entry) {
    // Prompts are opt-in: introspective writing doesn't need a nudge by default.
    if (!el.prompt) return;
    const show = !promptDismissed && el.prompt.dataset.open === "true";
    el.prompt.hidden = !show;
    if (show && el.promptText) {
      el.promptText.textContent = pickJournalPrompt(promptSeed);
    }
  }

  function loadEntryIntoEditor(entry) {
    if (!entry) return;
    if (el.title) el.title.value = entry.title || "";
    if (editor) {
      try { editor.setMarkdown(entry.body || ""); } catch { /* editor unavailable */ }
    }
    renderEditorMeta(entry);
    renderPrompt(entry);
  }

  async function selectEntry(id, { focusEditor = false } = {}) {
    if (!id || id === currentId) {
      if (focusEditor) editor?.focus?.();
      return;
    }
    await flushSave();
    currentId = id;
    const entry = currentEntry();
    if (!entry) return;
    promptDismissed = false;
    if (el.prompt) el.prompt.dataset.open = "false";
    loadEntryIntoEditor(entry);
    renderList();
    if (focusEditor) {
      requestAnimationFrame(() => {
        if (el.title && !String(entry.title || "").trim() && !String(entry.body || "").trim()) el.title.focus();
        else editor?.focus?.();
      });
    }
  }

  async function persistEntry(entry, { silent = false } = {}) {
    if (!entry) return;
    saving = true;
    try {
      const saved = await addJournal(entry);
      const idx = entries.findIndex((item) => item.id === saved.id);
      if (idx >= 0) entries[idx] = saved; else entries.unshift(saved);
      sortLocal();
      dirty = false;
      if (!silent) setStatus("Saved");
      if (currentId === saved.id) {
        renderEditorMeta(saved);
        renderPrompt(saved);
      }
      renderList();
      return saved;
    } catch (error) {
      console.error("Could not save journal entry", error);
      setStatus("Couldn't save — your words are still here.");
      throw error;
    } finally {
      saving = false;
    }
  }

  function readEditorState() {
    const entry = currentEntry();
    if (!entry) return null;
    const body = editor ? (typeof editor.getMarkdown === "function" ? editor.getMarkdown() : editor.flush?.() || "") : (entry.body || "");
    const title = el.title ? el.title.value : (entry.title || "");
    return touchJournalEntry(entry, { title, body }, Date.now());
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const next = readEditorState();
      if (next) persistEntry(next, { silent: true }).catch(() => {});
    }, 450);
  }

  async function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty) return;
    const next = readEditorState();
    if (next) await persistEntry(next, { silent: true }).catch(() => {});
  }

  async function createNewEntry({ focus = true } = {}) {
    await flushSave();
    let entry;
    try {
      entry = await persistEntry(createJournalEntry({}, Date.now()), { silent: true });
    } catch {
      entry = createJournalEntry({}, Date.now());
      entries = [entry, ...entries.filter((item) => item.id !== entry.id)];
      sortLocal();
      setStatus("Saved on this device once storage is ready (try closing other NeuroNet tabs and refreshing).", { sticky: true });
    }
    promptSeed = Date.now();
    promptDismissed = false;
    if (el.prompt) el.prompt.dataset.open = "false";
    currentId = entry.id;
    loadEntryIntoEditor(entry);
    renderList();
    if (focus) {
      requestAnimationFrame(() => el.title?.focus());
    }
    if (el.status?.textContent !== "Saved on this device once storage is ready (try closing other NeuroNet tabs and refreshing).") {
      setStatus("New page");
    }
    return entry;
  }

  async function deleteCurrentEntry() {
    const entry = currentEntry();
    if (!entry) return;
    const label = journalDisplayTitle(entry);
    const confirmed = dialog?.confirm
      ? await dialog.confirm(`Delete "${label}"? This can't be undone.`, "Delete", "danger")
      : window.confirm(`Delete "${label}"?`);
    if (!confirmed) return;
    await flushSave();
    try { await deleteJournal(entry.id); } catch { /* entry may be session-only if storage was unavailable */ }
    entries = entries.filter((item) => item.id !== entry.id);
    if (!entries.length) {
      await createNewEntry({ focus: true });
      return;
    }
    currentId = null;
    await selectEntry(entries[0].id, { focusEditor: false });
    setStatus("Entry deleted");
    if (typeof toast === "function") toast("Entry deleted.");
  }

  function applySearch() {
    query = el.search ? el.search.value : "";
    renderList();
  }

  function toggleInsightFilter() {
    insightOnly = !insightOnly;
    if (el.insightFilter) el.insightFilter.setAttribute("aria-pressed", String(insightOnly));
    renderList();
  }

  async function toggleInsightMark() {
    const entry = currentEntry();
    if (!entry) return;
    const next = touchJournalEntry(entry, { insight: !entry.insight }, Date.now());
    try {
      await persistEntry(next, { silent: true });
    } catch {
      // Status already set by persistEntry; keep local state in sync.
      const idx = entries.findIndex((item) => item.id === next.id);
      if (idx >= 0) entries[idx] = next; else entries.unshift(next);
      dirty = false;
      renderEditorMeta(next);
      renderList();
    }
  }

  function usePrompt() {
    const entry = currentEntry();
    if (!entry || !el.promptText) return;
    const prompt = el.promptText.textContent || "";
    if (!prompt) return;
    const body = editor ? (editor.getMarkdown?.() || "") : (entry.body || "");
    const prefix = body.trim() ? `${body.replace(/\s*$/, "")}\n\n` : "";
    const nextBody = `${prefix}${prompt}\n\n`;
    try { editor?.setMarkdown(nextBody); } catch { /* ignore */ }
    promptDismissed = true;
    renderPrompt(entry);
    scheduleSave();
    requestAnimationFrame(() => editor?.focus?.());
  }

  // ---------- wire up ----------

  editor = createEditor(el.editorHost, {
    value: "",
    // Default to source for full writing space; the vendored editor's taskbar
    // exposes source/split/preview so users can switch when they want to.
    view: "md",
    toolbar: EDITOR_TOOLBAR,
    taskbar: true,
    storage: "nn-journal-editor",
    softBreaks: true,
    placeholder: "Write what's on your mind."
  });
  editor.onChange(() => {
    scheduleSave();
    const entry = readEditorState();
    if (entry) {
      renderEditorMeta(entry);
      renderPrompt(entry);
    }
  });

  el.newBtn?.addEventListener("click", () => createNewEntry({ focus: true }));
  el.search?.addEventListener("input", applySearch);
  el.insightFilter?.addEventListener("click", toggleInsightFilter);
  el.insightBtn?.addEventListener("click", () => toggleInsightMark().catch(() => {}));
  el.deleteBtn?.addEventListener("click", () => deleteCurrentEntry().catch(() => {}));
  el.title?.addEventListener("input", () => {
    scheduleSave();
    const entry = readEditorState();
    if (entry) { renderEditorMeta(entry); renderPrompt(entry); renderList(); }
  });
  el.promptUse?.addEventListener("click", usePrompt);
  el.promptShuffle?.addEventListener("click", () => {
    promptSeed += 1;
    const entry = currentEntry();
    if (entry) renderPrompt(entry);
  });
  el.promptDismiss?.addEventListener("click", () => {
    if (el.prompt) el.prompt.dataset.open = "false";
    promptDismissed = true;
    renderPrompt(currentEntry());
  });
  el.promptToggle?.addEventListener("click", () => {
    promptDismissed = false;
    promptSeed += 1;
    if (el.prompt) el.prompt.dataset.open = el.prompt.dataset.open === "true" ? "false" : "true";
    renderPrompt(currentEntry());
  });
  el.list?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-entry-id]");
    if (!btn) return;
    selectEntry(btn.dataset.entryId).catch(() => {});
  });

  // ---------- boot ----------

  entries = (await (getAllJournals ? getAllJournals() : Promise.resolve([]))).map((entry) => ({ ...entry }));
  sortLocal();

  async function openFreshEntry() {
    const draft = createJournalEntry({}, Date.now());
    try {
      const fresh = await persistEntry(draft, { silent: true });
      if (!entries.some((entry) => entry.id === fresh.id)) entries.unshift(fresh);
      sortLocal();
      return fresh;
    } catch {
      // STUB storage can be unavailable (e.g. DB upgrade blocked or missing
      // store). Keep the writing surface usable for this session instead of
      // crashing; saving will be retried on edits.
      entries = [draft, ...entries.filter((entry) => entry.id !== draft.id)];
      sortLocal();
      setStatus("Saved on this device once storage is ready (try closing other NeuroNet tabs and refreshing).", { sticky: true });
      return draft;
    }
  }

  const requestedId = context && context.entryId;
  if (requestedId && entries.some((entry) => entry.id === requestedId)) {
    currentId = requestedId;
  } else if (context && context.fresh) {
    currentId = (await openFreshEntry()).id;
  } else if (entries.length) {
    currentId = entries[0].id;
  } else {
    currentId = (await openFreshEntry()).id;
  }

  loadEntryIntoEditor(currentEntry());
  renderList();

  // Exposed for cross-tool hooks and for the shell's cleanup on tool switch.
  function cleanup() {
    if (disposed) return;
    disposed = true;
    if (saveTimer) clearTimeout(saveTimer);
    if (statusTimer) clearTimeout(statusTimer);
    try {
      // Best-effort final save — fire and forget if async can't complete here.
      const next = readEditorState();
      if (next && dirty && typeof addJournal === "function") addJournal(next);
    } catch { /* ignore */ }
    try { editor?.destroy?.(); } catch { /* ignore */ }
    editor = null;
    if (window.__neuronetJournalCleanup === cleanup) delete window.__neuronetJournalCleanup;
  }
  window.__neuronetJournalCleanup = cleanup;
  toolRoot.dataset.journalReady = "true";
}
