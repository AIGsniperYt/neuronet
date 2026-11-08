import { initDB, addNode, addNodes, getAllNodes, getNode, deleteNode, addQuote, addQuotes, getAllQuotes, getQuote, deleteQuote, clearNodes, clearQuotes, clearCues, addCues, getQuotesForSubject, getAnalysisNodesForSubject, getDueQuotesForSubject, getDueAnalysisNodesForSubject, getQuotesReferencedByAnalysis, getAnalysesReferencingQuote, getPinnedTools, pinTool, unpinTool, getSubjects, addSubject, deleteSubject, renameSubject, addCue, getAllCues, getCue, deleteCue, getCuesForQuote, getCuesForAnalysis, getCuesForSubject, updateCueLinks, getAllTags, addTag, deleteTag, findExistingQuote, findExistingQuoteByText, linkAnalysisToQuote, unlinkAnalysisFromQuote, getFormattedQuote, resolveQuoteInSource, addCard, addCards, getAllCards, getCard, getCardsForDeck, getCardsForDeckId, getCardsForQuote, getDueCardsForDeck, deleteCard, deleteCardsForDeck, clearCards, clearTags, addDeck, addDecks, getAllDecks, getDeck, getDecksForSubject, deleteDeckRecord, deleteDeck, clearDecks, ensureDeckMembership, sortDecksByCreated, buildDeckForest, flattenDeckTree, getDeckDescendantIds, groupDecksBySubject, getDeckPath, describeDeckDeletion, UNSORTED_DECK_NAME, addHeap, addHeaps, getAllHeaps, getHeap, deleteHeap, clearHeaps } from "./db.js";
import { syncLocalWithCloud, syncToCloud, deleteCloudNode, deleteCloudQuote, deleteCloudCue, fetchCloudNodes, fetchCloudQuotes, fetchCloudCues } from "./sync.js";
import { initAnalysisToolV2 } from "./tools/analysisTool.js";
import { dialog } from "./tools/dialog.js";
import { initMemoryTool } from "./tools/memoryTool.js";
import { initMindmapTool } from "./tools/mindmapTool.js";
import { initTrackerTool } from "./tools/trackerTool.js";
import { install as installDiag } from "./tools/diag.js";
import { initScraperTool } from "./tools/scraperTool.js";
import { flushBoundaryCache } from "./tools/gradeBoundaries.js";
import { SCHEMA_VERSION, assertCurrentDataset } from "./schema.js";
import { initCanvas } from "./canvas.js";

initCanvas();

addEventListener("pagehide", () => flushBoundaryCache());

const canvasEl = window.__neuronetCanvas.getCanvas();
const ctx = window.__neuronetCanvas.getCtx();

const BACKEND = "https://neuronet-backend.onrender.com";
let DB_READY = false;
const DEMO_MODE = true;
window.APP_VERSION = "v10"; // change per branch
window.DEMO_MODE = DEMO_MODE; // true for old versions
const USE_BACKEND = !window.DEMO_MODE;
const DEFAULT_PROFILE = {
  name: "Offline Mode",
  email: "local@device",
  picture: "https://via.placeholder.com/40"
};

let syncInProgress = false;

let currentToolName = "";
let currentSubject = null;
let toolContainer;

const tools = {
  analysis: {
    file: "analysis.html",
    init: (context) => initAnalysisToolV2({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      getAllTags,
      getNode,
      addNode,
      addQuote,
      addCue,
      addTag,
      getQuote,
      getCue,
      getCuesForQuote,
      deleteQuote,
      deleteCue,
      removeCueEverywhere,
      backupLocalNodesToCloud,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      normalizeHierarchyPath,
      buildSection,
      parseTags,
      escapeHtml,
      getNodeTimestamp,
      isSourceNode,
      findExistingQuote,
      findExistingQuoteByText,
      linkAnalysisToQuote,
      unlinkAnalysisFromQuote,
      getFormattedQuote,
      resolveQuoteInSource,
      recordActivity: (details = {}) => logActivity(details.subject || currentSubject, "analysis", details),
      toast
    }, context)
  },

  memory: {
    file: "memory.html",
    init: (context) => initMemoryTool({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      addNode,
      addQuote,
      addCue,
      addSubject,
      getQuotesForSubject,
      getAnalysisNodesForSubject,
      getDueQuotesForSubject,
      getDueAnalysisNodesForSubject,
      getQuotesReferencedByAnalysis,
      getAnalysesReferencingQuote,
      getCuesForQuote,
      getCuesForSubject,
      deleteCue,
      deleteQuote,
      renameSubject,
      getNode,
      getNodeTimestamp,
      getCue,
      getQuote,
      getSubjects,
      getFormattedQuote,
      resolveQuoteInSource,
      escapeHtml,
      addCard,
      addCards,
      getAllCards,
      getCard,
      getCardsForDeck,
      getCardsForDeckId,
      getCardsForQuote,
      deleteCard,
      addDeck,
      getAllDecks,
      getDeck,
      getDecksForSubject,
      deleteDeckRecord,
      deleteDeck,
      sortDecksByCreated,
      buildDeckForest,
      flattenDeckTree,
      getDeckDescendantIds,
      groupDecksBySubject,
      getDeckPath,
      describeDeckDeletion,
      UNSORTED_DECK_NAME,
      addHeap,
      getAllHeaps,
      getHeap,
      deleteHeap
    }, context)
  },

  mindmap: {
    file: "mindmap.html",
    init: (context) => initMindmapTool({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      getAllCards,
      addNode,
      addQuote,
      addCue,
      deleteNode,
      deleteQuote,
      deleteCue,
      deleteCard,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      removeCueEverywhere,
      getAllTags,
      addTag,
      deleteTag,
      escapeHtml,
      linkAnalysisToQuote,
      unlinkAnalysisFromQuote,
      addHeap,
      getAllHeaps,
      getHeap,
      deleteHeap
    }, context)
  },
  tracker: {
    name: "Tracker",
    file: "tracker.html",
    init: (context) => initTrackerTool({
      getAllNodes,
      addNode,
      addNodes,
      deleteNode,
      getSubjects,
      escapeHtml,
      activityToast
    }, context)
  },
  scraper: {
    name: "Scraper",
    file: "scraper.html",
    init: (context) => initScraperTool({
      getAllNodes,
      escapeHtml,
      activityToast
    }, context)
  }
};

const toolDefinitions = {
  analysis: { name: "Analysis", file: "analysis.html", icon: "fa-solid fa-pen-clip", desc: "Create source-linked analysis nodes and analyse a source text" },
  memory: { name: "Memory", file: "memory.html", icon: "fa-solid fa-brain", desc: "Flashcard study across subjects to memorise nodes you analyse" },
  mindmap: { name: "Mindmap", file: "mindmap.html", icon: "fa-solid fa-diagram-project", desc: "Visual database overview for establishing connections" },
  tracker: { name: "Tracker", file: "tracker.html", icon: "fa-solid fa-chart-column", desc: "Track study progress with past paper data" },
  scraper: { name: "Scraper", file: "scraper.html", icon: "fa-solid fa-download", desc: "Fetch grade boundaries from exam board spreadsheets" }
};

// ========== AUTH & API ==========
function setProfileUI(user) {
  const pfp = document.getElementById("userPfp");
  const userName = document.getElementById("userName");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const activeUser = user || DEFAULT_PROFILE;

  if (pfp) pfp.src = activeUser.picture || DEFAULT_PROFILE.picture;
  if (userName) {
    userName.textContent = user ? user.name || user.email || "User" : DEFAULT_PROFILE.name;
  }

  if (authActionBtn) authActionBtn.style.display = user ? "none" : "block";
  if (logoutBtn) logoutBtn.style.display = user ? "block" : "none";
}

async function fetchUser() {
  if (!USE_BACKEND) {
    window.currentUser = null;
    setProfileUI(null);
    return null;
  }
  try {
    const res = await fetch(`${BACKEND}/auth/user`, { credentials: "include" });
    if (!res.ok) throw new Error("Not logged in");

    const user = await res.json();
    window.currentUser = user;
    setProfileUI(user);
    return user;
  } catch (error) {
    window.currentUser = null;
    setProfileUI(null);
    return null;
  }
}

async function backupLocalNodesToCloud() {
  if (!USE_BACKEND || !window.currentUser || syncInProgress) return;
  syncInProgress = true;
  try {
    const [localNodes, localQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    await syncToCloud(localNodes, localQuotes);
  } catch (error) {
    console.log("Background cloud backup skipped", error);
  } finally {
    syncInProgress = false;
  }
}

async function syncAfterLogin() {
  if (!USE_BACKEND || !window.currentUser || syncInProgress) return;
  syncInProgress = true;
  try {
    await syncLocalWithCloud();
  } catch (error) {
    console.log("Cloud merge failed", error);
  } finally {
    syncInProgress = false;
  }
}

function startGoogleLogin() {
  if (!USE_BACKEND) return;
  window.location.href = `${BACKEND}/auth/google`;
}

function setActiveTool(toolName) {
  const wrappers = document.querySelectorAll(".tool-btn-wrapper");
  wrappers.forEach(w => w.classList.remove("active"));
  const activeWrapper = document.querySelector(`.tool-btn-wrapper[data-tool="${toolName}"]`);
  if (activeWrapper) activeWrapper.classList.add("active");
}

async function loadTool(toolName, context = {}) {
  flushBoundaryCache();
  // Tear down the tool that is being replaced. Analysis was the only tool
  // whose cleanup ever ran, so Mindmap and Memory could leave document/window
  // listeners behind after a switch.
  const previousCleanup = {
    analysis: window.__neuronetAnalysisCleanup,
    memory: window.__neuronetMemoryCleanup,
    mindmap: window.__neuronetMindmapCleanup
  }[currentToolName];
  if (typeof previousCleanup === "function") {
    previousCleanup();
  }

  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);
  // Keep the shell's subject pills in sync when a tool is opened with an
  // explicit subject. Without this, Memory could silently scope to Macbeth
  // while the sidebar still showed "All".
  await renderSidebarSubjects();
  logActivity(context.subject || currentSubject, toolName);

  const tool = tools[toolName];
  toolContainer.innerHTML = "";

  // Fetch and load tool
  fetch(`./tools/${tool.file}`).then(r => r.text()).then(html => {
    toolContainer.innerHTML = html;
    if (tool.init) tool.init(context);
    hideLaunchpad();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHierarchyPath(parts) {
  return (parts || []).map((part) => String(part || "").trim()).filter(Boolean);
}

function buildSection(path) {
  return path.slice(1).join(" > ");
}

function getNodeTimestamp(node) {
  return Number(node?.updatedAt || node?.createdAt || 0);
}

function isSourceNode(node) {
  return node?.type === "source" || node?.meta?.kind === "source";
}

function isAnalysisNode(node) {
  return node?.type === "analysis" || typeof node?.analysis === "string";
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function removeNodeEverywhere(id) {
  const node = await getNode(id);

  // Cascade deletes + integrity cleanup
  if (node) {
    const nodeType = node.type || node?.meta?.kind || "";

    if (nodeType === "subject") {
      const subjectName = String(node.subject || node.title || "").trim();
      if (subjectName) {
        await deleteSubjectCascadeEverywhere(subjectName);
        return;
      }
    }

    if (nodeType === "source") {
      await deleteSourceCascadeEverywhere(node);
    }

    if (nodeType === "analysis") {
      await detachAnalysisFromQuotesAndCues(node);
    }
  }

  await deleteNode(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudNode(id);
  } catch (error) {
    console.log("Cloud delete skipped", error);
  }
}

async function removeQuoteEverywhere(id) {
  await deleteQuoteCascadeLocal(id);
  await deleteQuote(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudQuote(id);
  } catch (error) {
    console.log("Cloud quote delete skipped", error);
  }
}

function isEmptyAnalysisNode(node) {
  if (!node || node.type !== "analysis") return false;
  const analysisText = String(node.analysis || "").trim();
  const quoteRefs = Array.isArray(node.quoteRefs) ? node.quoteRefs.filter((r) => r && r.quoteId) : [];
  return analysisText.length === 0 && quoteRefs.length === 0;
}

async function detachAnalysisFromQuotesAndCues(analysisNode) {
  if (!analysisNode?.id) return;
  const analysisId = analysisNode.id;

  // Remove analysisId from any quote.meta.analysisNodeIds (fast enough for current scale)
  const allQuotes = await getAllQuotes();
  const now = Date.now();
  for (const quote of allQuotes || []) {
    const ids = Array.isArray(quote?.meta?.analysisNodeIds) ? quote.meta.analysisNodeIds : [];
    if (!ids.includes(analysisId)) continue;
    const nextIds = ids.filter((qid) => qid !== analysisId);
    await addQuote({
      ...quote,
      meta: {
        ...(quote.meta || {}),
        analysisNodeIds: nextIds
      },
      updatedAt: now
    });
  }

  // Clear analysisId on cues that were attached to this analysis (keep cue if it still has a quoteId)
  const cues = await getCuesForAnalysis(analysisId);
  for (const cue of cues || []) {
    if (!cue?.id) continue;
    if (!cue.quoteId) {
      await removeCueEverywhere(cue.id);
      continue;
    }
    await updateCueLinks(cue.id, cue.quoteId, null);
  }
}

async function deleteQuoteCascadeLocal(quoteId) {
  if (!quoteId) return;

  // Remove quote reference from analysis nodes; delete emptied analyses.
  const analyses = await getAnalysesReferencingQuote(quoteId);
  const now = Date.now();
  for (const analysis of analyses || []) {
    if (!analysis?.id) continue;
    const nextRefs = (analysis.quoteRefs || []).filter((ref) => ref?.quoteId && ref.quoteId !== quoteId);
    const nextAnalysis = { ...analysis, quoteRefs: nextRefs, updatedAt: now };
    if (isEmptyAnalysisNode(nextAnalysis)) {
      await removeNodeEverywhere(analysis.id);
    } else {
      await addNode(nextAnalysis);
    }
  }

  // Delete cues for this quote (quote -> cues ownership)
  const cues = await getCuesForQuote(quoteId);
  for (const cue of cues || []) {
    if (!cue?.id) continue;
    await removeCueEverywhere(cue.id);
  }
}

async function deleteSourceCascadeEverywhere(sourceNode) {
  if (!sourceNode?.id) return;

  // Delete quotes that belong to this source.
  const allQuotes = await getAllQuotes();
  const linkedQuotes = (allQuotes || []).filter((q) => q?.link?.sourceId === sourceNode.id);
  for (const quote of linkedQuotes) {
    if (!quote?.id) continue;
    await removeQuoteEverywhere(quote.id);
  }
}

async function deleteSubjectCascadeEverywhere(subjectName) {
  const subject = String(subjectName || "").trim();
  if (!subject) return;

  // Delete nodes first to avoid expensive integrity updates while wiping the subject.
  const allNodes = await getAllNodes();
  const relatedNodes = (allNodes || []).filter((node) => {
    if (!node) return false;
    if (node.type === "subject" || node?.meta?.kind === "subject") {
      return String(node.subject || node.title || "").trim() === subject;
    }
    return node.subject === subject;
  });

  for (const node of relatedNodes) {
    if (!node?.id) continue;
    await deleteNode(node.id);
    if (USE_BACKEND && window.currentUser) {
      try { await deleteCloudNode(node.id); } catch (error) { console.log("Cloud delete skipped", error); }
    }
  }

  // Cards are the study source of truth, so remove them with the subject.
  await deleteCardsForDeck(subject);

  // Delete quotes (and their cues) for the subject.
  const subjectQuotes = await getQuotesForSubject(subject);
  for (const quote of subjectQuotes || []) {
    if (!quote?.id) continue;
    await removeQuoteEverywhere(quote.id);
  }

  // Safety: if any cues remain for the subject, delete them.
  const subjectCues = await getCuesForSubject(subject);
  for (const cue of subjectCues || []) {
    if (!cue?.id) continue;
    await removeCueEverywhere(cue.id);
  }
}

async function removeCueEverywhere(id) {
  await deleteCue(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudCue(id);
  } catch (error) {
    console.log("Cloud cue delete skipped", error);
  }
}

// ---- toast notifications ----
const activityToastRecords = new Map();

function removeActivityToast(key) {
  const rec = activityToastRecords.get(key);
  if (!rec) return;
  activityToastRecords.delete(key);
  if (rec.timer) clearTimeout(rec.timer);
  rec.el.classList.add("hide");
  setTimeout(() => rec.el.remove(), 320);
}

// Persistent, app-native activity toast. It deliberately reuses the scraper
// scratch-buffer language: a live green sweep while work is happening, then a
// completion fill and a short glow when it lands. The caller owns the message;
// this function only paints it, so the UI can never invent progress.
function activityToast(message, {
  key = "app-activity",
  detail = "",
  meta = "",
  hint = "",
  progress = null,
  tone = "loading",
  timeout = null
} = {}) {
  const root = document.getElementById("nnToastRoot");
  if (!root) return null;

  let rec = activityToastRecords.get(key);
  if (!rec || !rec.el.isConnected) {
    const el = document.createElement("div");
    el.className = "nn-toast nn-toast-activity";
    el.dataset.toastKey = key;
    el.innerHTML = `
      <div class="nn-toast-log">
        <span class="nn-toast-text"></span>
        <span class="nn-toast-detail"></span>
        <span class="nn-toast-meta"></span>
        <span class="nn-toast-hint"></span>
      </div>
    `;
    root.appendChild(el);
    rec = {
      el,
      text: el.querySelector(".nn-toast-text"),
      detail: el.querySelector(".nn-toast-detail"),
      meta: el.querySelector(".nn-toast-meta"),
      hint: el.querySelector(".nn-toast-hint"),
      tone: "",
      timer: null
    };
    activityToastRecords.set(key, rec);
  }

  if (rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = null;
  }

  const nextTone = tone === "done" || tone === "error" ? tone : "loading";
  if (rec.tone !== nextTone) {
    rec.el.classList.remove("is-loading", "is-done", "is-error");
    void rec.el.offsetWidth; // restart the sweep/fill from frame zero
    rec.el.classList.add(`is-${nextTone}`);
    rec.tone = nextTone;
  }

  rec.el.setAttribute("role", nextTone === "error" ? "alert" : "status");
  rec.el.setAttribute("aria-live", nextTone === "error" ? "assertive" : "polite");
  rec.text.textContent = message;

  let progressLabel = "";
  if (progress && Number.isFinite(Number(progress.value)) && Number.isFinite(Number(progress.max)) && Number(progress.max) > 0) {
    const value = Math.max(0, Math.min(Number(progress.max), Number(progress.value)));
    progressLabel = `${Math.round(value)}/${Math.round(Number(progress.max))}`;
  }
  const detailText = [progressLabel, detail].filter(Boolean).join(" · ");
  rec.detail.textContent = detailText;
  rec.detail.hidden = !detailText;
  rec.meta.textContent = meta;
  rec.meta.hidden = !meta;
  rec.hint.textContent = hint;
  rec.hint.hidden = !hint;

  // Match the sweep to the visible copy: longer lines get a longer pass, so
  // the animation reads as deliberate intelligence rather than a hyper blur.
  const visualLength = String(message || "").length + Math.min(24, detailText.length);
  const sweep = Math.min(6.5, Math.max(2.4, 1.2 + visualLength * 0.045));
  const fill = Math.min(6, Math.max(2.4, sweep * 0.85));
  rec.el.style.setProperty("--nn-toast-sweep", `${sweep.toFixed(2)}s`);
  rec.el.style.setProperty("--nn-toast-fill", `${fill.toFixed(2)}s`);

  if (nextTone !== "loading") {
    // Keep the toast up long enough for the slower completion fill to actually
    // finish, then leave a beat of glow before dismissing. Otherwise a long
    // line's fill would be cut off mid-animation.
    const base = Number.isFinite(timeout) ? timeout : nextTone === "error" ? 9000 : 4200;
    const delay = nextTone === "done" ? Math.max(base, Math.round(fill * 1000) + 1800) : base;
    rec.timer = setTimeout(() => removeActivityToast(key), Math.max(0, delay));
  }

  return {
    update(nextMessage, opts = {}) {
      activityToast(nextMessage, { detail, meta, hint, progress, timeout, ...opts, key, tone: opts.tone || "loading" });
    },
    complete(nextMessage, opts = {}) {
      activityToast(nextMessage, { detail, meta, hint, progress, timeout, ...opts, key, tone: "done" });
    },
    fail(nextMessage, opts = {}) {
      activityToast(nextMessage, { detail, meta, hint, progress, timeout, ...opts, key, tone: "error" });
    },
    dismiss() {
      removeActivityToast(key);
    }
  };
}

function toast(message, { sticky = false, action = null } = {}) {
  const root = document.getElementById("nnToastRoot");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "nn-toast";
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement("button");
    btn.className = "nn-toast-btn";
    btn.textContent = action.label;
    el.appendChild(btn);
    btn.addEventListener("click", (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      dismiss();
      if (action.onClick) action.onClick();
    });
  }
  const dismiss = () => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 320);
  };
  // Any toast can be tapped/clicked away. The action button keeps its own
  // click and dismisses explicitly, so guard against double handling.
  el.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest(".nn-toast-btn")) return;
    dismiss();
  });
  root.appendChild(el);
  if (!sticky) setTimeout(dismiss, 7000);
  return dismiss;
}

// Stable fingerprint of a dataset (used to detect whether the user is on
// pristine demo data vs. a modified/own dataset).
function fingerprintDataset(nodes, quotes, cues) {
  const norm = (arr) => arr
    .map((o) => JSON.stringify(o))
    .sort()
    .join("|");
  const str = norm(nodes || []) + "||" + norm(quotes || []) + "||" + norm(cues || []);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

async function currentFingerprint() {
  const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
  return fingerprintDataset(nodes, quotes, cues);
}

// Load the shipped demo dataset once per page session. `dataset` keeps the
// explicit `cards` array, so demo detection can compare card identity.
let demoDatasetPromise = null;
async function loadDemoDataset() {
  if (!demoDatasetPromise) {
    demoDatasetPromise = (async () => {
      try {
        const res = await fetch("demo-data.json", { cache: "no-store" });
        if (!res.ok) return null;
        return assertCurrentDataset(await res.json());
      } catch (e) {
        return null;
      }
    })();
  }
  return demoDatasetPromise;
}

async function fetchDemoPayload() {
  const res = await fetch("demo-data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Demo data not found");
  return assertCurrentDataset(await res.json());
}

async function exportDatabaseJson() {
  const [nodes, quotes, cues, cards, heaps, decks] = await Promise.all([
    getAllNodes(),
    getAllQuotes(),
    getAllCues(),
    getAllCards(),
    getAllHeaps(),
    getAllDecks()
  ]);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    nodes,
    quotes,
    cues,
    cards,
    heaps,
    decks
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `neuronet-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importDatabaseJson(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  await importPayload(payload);
}

// The tag store is a derived index, not the source of truth. Keep it in sync
// with nodes, quotes, and cards so backups and old databases cannot inherit
// stale tags. Card tags are included because cards are first-class.
function collectTagTitles({ nodes = [], quotes = [], cards = [] } = {}) {
  const titles = new Map();
  const collect = (tags) => {
    for (const tag of tags || []) {
      const value = String(tag || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!titles.has(key)) titles.set(key, value);
    }
  };
  for (const node of nodes) collect(node?.meta?.tags);
  for (const quote of quotes) collect(quote?.meta?.tags);
  for (const card of cards) collect(card?.tags);
  return titles;
}

async function rebuildTagStoreFromData(data = {}) {
  await clearTags();
  for (const title of collectTagTitles(data).values()) {
    await addTag({ title, subject: "" });
  }
}

// Startup self-heal for old databases: rebuild the derived tag index only
// when it disagrees with the records, so orphaned tags cannot linger.
async function syncTagStoreFromData(data = {}) {
  const existing = await getAllTags();
  const expected = collectTagTitles(data);
  const current = new Set(
    existing
      .map((tag) => String(tag?.title || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    expected.size === current.size
    && [...expected.keys()].every((key) => current.has(key))
  ) return;
  await rebuildTagStoreFromData(data);
}

async function importPayload(payload) {
  // The JSON is owner-editable, but it must already use the current schema.
  // Old exports are rejected with a version error instead of being rewritten.
  const dataset = assertCurrentDataset(payload);

  const nodes = dataset.nodes;
  const quotes = dataset.quotes;
  const cues = dataset.cues;
  const cards = dataset.cards;
  const heaps = dataset.heaps;
  const decks = dataset.decks;

  await clearNodes();
  await clearQuotes();
  await clearCues();
  await clearCards();
  await clearTags();
  await clearHeaps();
  await clearDecks();
  await addNodes(nodes);
  await addQuotes(quotes);
  await addCues(cues);
  await addDecks(decks);
  await addCards(cards);
  await ensureDeckMembership();
  await addHeaps(heaps);
  // Rebuild the derived tag index from the final imported records. This also
  // removes stale tags from the DB the import replaced.
  const [finalNodes, finalQuotes, finalCards] = await Promise.all([
    getAllNodes(),
    getAllQuotes(),
    getAllCards()
  ]);
  await rebuildTagStoreFromData({
    nodes: finalNodes,
    quotes: finalQuotes,
    cards: finalCards
  });

  if (USE_BACKEND && window.currentUser) {
    const [cloudNodes, cloudQuotes, cloudCues] = await Promise.all([
      fetchCloudNodes(),
      fetchCloudQuotes(),
      fetchCloudCues()
    ]);
    await Promise.all([
      ...cloudNodes.map((node) => deleteCloudNode(node.id)),
      ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id)),
      ...cloudCues.map((cue) => deleteCloudCue(cue.id))
    ]);
    await syncToCloud(nodes, quotes, cues);
  }

  // Refresh global launchpad with fresh data
  await renderDashboard();

  // Notify tools that DB has changed so they can refresh
  document.dispatchEvent(new Event("db-change"));

  if (currentToolName) {
    await loadTool(currentToolName);
  }
}

// ========== DEMO DATA & DELETE DATA ==========

async function importDemoData() {
  const [cur, cards] = await Promise.all([currentFingerprint(), getAllCards()]);
  const empty = cur === fingerprintDataset([], [], []) && (cards || []).length === 0;
  if (!empty) {
    const ok = await dialog.confirm(
      "Importing demo data will overwrite YOUR current NeuroNet database. Continue?",
      "Import demo",
      "danger"
    );
    if (!ok) return;
  }
  try {
    const payload = await fetchDemoPayload();
    await importPayload(payload);
    toast("Demo data imported. Explore the launchpad or click a tool.");
  } catch (error) {
    console.error("Demo import failed", error);
    dialog.alert(`Could not load demo data: ${error?.message || "it may not be deployed yet."}`);
  }
}

async function deleteAllData() {
  const [nodes, quotes, cues, cards] = await Promise.all([
    getAllNodes(),
    getAllQuotes(),
    getAllCues(),
    getAllCards()
  ]);
  const isDemo = await isOnDemoData(nodes, quotes, cues, cards);

  // Easy path: pristine demo data, fully recoverable via re-import.
  if (isDemo) {
    const ok = await dialog.confirm(
      "This is demo data — safe to remove and you can re-import it anytime.\n\nDelete demo data?",
      "Delete demo data",
      "danger"
    );
    if (!ok) return;
    await wipeDatabase();
    toast("Demo data removed. Use “Import Demo Data” in your profile to get it back.");
    return;
  }

  // Modified / user data: full caution flow.
  const gate = await dialog.confirm(
    "Delete ALL of your NeuroNet data? This removes every subject, source, analysis, quote, cue, card and past paper from this browser. This is a danger zone.\n\nContinue?",
    "Continue to delete",
    "danger"
  );
  if (!gate) return;

  // Optional backup — never forced.
  const makeBackup = await dialog.confirm(
    "Back up your data first as a .json file? Recommended, optional.\n\nChoose whether to download a backup before deleting.\n\nYes = download backup now.  No = skip (delete without backup).",
    "Yes, back up",
    "primary",
    "No"
  );
  if (makeBackup) {
    await exportDatabaseJson();
    await dialog.alert(
      "Backup downloaded.\n\nKeep your .json data file safe — you can re-import it into NeuroNet anytime (profile → Import JSON Data)."
    );
  }

  const finalOk = await dialog.confirm(
    "FINAL WARNING: This permanently deletes everything from this browser. There is no undo.\n\nProceed to delete?",
    "Delete all data",
    "danger"
  );
  if (!finalOk) return;

  // Real typed double-check ("danger zone").
  const typeOk = await dialog.prompt(
    "This is the danger area. Type the word DELETE to permanently erase all data, or Cancel to keep everything.",
    ""
  );
  if (typeOk == null || String(typeOk).trim().toUpperCase() !== "DELETE") {
    await dialog.alert("Deletion cancelled — nothing was deleted.");
    return;
  }

  await wipeDatabase();
  toast("All data deleted. Your database is now empty.");
}

async function isOnDemoData(nodes, quotes, cues, cards = []) {
  const dataset = await loadDemoDataset();
  if (!dataset) return false;
  if (
    fingerprintDataset(nodes, quotes, cues)
    !== fingerprintDataset(dataset.nodes || [], dataset.quotes || [], dataset.cues || [])
  ) return false;

  // Demo cards have stable IDs. Studying them changes SRS metadata, so
  // compare identity and count rather than the full card payload.
  const demoCards = dataset.cards || [];
  const expectedIds = new Set(demoCards.map((card) => card.id).filter(Boolean));
  return cards.length === expectedIds.size
    && cards.every((card) => expectedIds.has(card.id));
}

async function wipeDatabase() {
  await clearNodes();
  await clearQuotes();
  await clearCues();
  await clearCards();
  await clearTags();
  await clearHeaps();
  await clearDecks();
  if (USE_BACKEND && window.currentUser) {
    try {
      const [cloudNodes, cloudQuotes, cloudCues] = await Promise.all([
        fetchCloudNodes(), fetchCloudQuotes(), fetchCloudCues()
      ]);
      await Promise.all([
        ...cloudNodes.map((node) => deleteCloudNode(node.id)),
        ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id)),
        ...cloudCues.map((cue) => deleteCloudCue(cue.id))
      ]);
      await syncToCloud([], [], []);
    } catch (error) {
      console.log("Cloud wipe skipped", error);
    }
  }
  await renderDashboard();
  document.dispatchEvent(new Event("db-change"));
  if (currentToolName) await loadTool(currentToolName);
}

// ========== LAUNCHPAD SHOW/HIDE ==========

function showLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;

  if (tc) {
    tc.classList.add("exiting");
    setTimeout(() => {
      // A quick action can open a tool while the launchpad is still exiting.
      // Do not wipe that freshly loaded tool when this timer fires.
      if (currentToolName) {
        tc.classList.remove("exiting");
        return;
      }
      tc.style.display = "none";
      tc.classList.remove("exiting");
      tc.innerHTML = "";
    }, 350);
  }

  launchpad.style.display = "flex";
  launchpad.classList.add("entering");
  void launchpad.offsetWidth;
  launchpad.classList.remove("entering");
  launchpad.classList.add("entered");
}

function hideLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;

  launchpad.classList.add("exiting");
  launchpad.classList.remove("entered");
  setTimeout(() => {
    launchpad.style.display = "none";
    launchpad.classList.remove("exiting");
  }, 350);

  if (tc) {
    tc.style.display = "block";
    tc.classList.add("entering");
    void tc.offsetWidth;
    tc.classList.remove("entering");
    tc.classList.add("entered");
  }
}

function openTool(toolName, context = {}) {
  flushBoundaryCache();
  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);
  const tool = tools[toolName];
  toolContainer.innerHTML = "";
  fetch(`./tools/${tool.file}`).then(r => r.text()).then(html => {
    toolContainer.innerHTML = html;
    if (tool.init) tool.init(context);
    hideLaunchpad();
  });
}

// ========== ACTIVITY TRACKING (localStorage) ==========

const ACTIVITY_KEY = "nn-last-activity";
const SESSIONS_KEY = "nn-study-sessions";

function logActivity(subject, toolName, details = {}) {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify({
      subject, tool: toolName, timestamp: Date.now(),
      sourceId: details.sourceId || "",
      sourceTitle: details.sourceTitle || "",
      sourceMode: details.sourceMode || ""
    }));
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    const today = new Date().toISOString().slice(0, 10);
    const lastSession = sessions[sessions.length - 1];
    if (!lastSession || lastSession.date !== today) {
      sessions.push({ date: today, subject, tool: toolName });
      if (sessions.length > 60) sessions.splice(0, sessions.length - 60);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  } catch {}
}

function getLastActivity() {
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "null"); } catch { return null; }
}

function getStudySessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]"); } catch { return []; }
}

// ========== DASHBOARD RENDERERS ==========

function dashEmpty(msg) {
  return `<p class="dash-empty-note">${escapeHtml(msg)}</p>`;
}

async function renderQuickActions() {
  const last = getLastActivity();
  const resumeBtn = document.getElementById("dashResume");
  const resumeSub = document.getElementById("dashResumeSub");
  const studyBtn = document.getElementById("dashStudyNow");
  const studySub = document.getElementById("dashStudySub");

  // Analysis sources can be created before they have a subject. Keep those
  // sessions resumable by their source id instead of treating them as empty.
  const canResume = last && (last.subject || (last.tool === "analysis" && last.sourceId));
  if (canResume) {
    resumeBtn.disabled = false;
    const toolLabel = last.tool ? last.tool.charAt(0).toUpperCase() + last.tool.slice(1) : "Analysis";
    const subjectLabel = last.subject || "Unfiled source";
    resumeSub.textContent = last.sourceTitle
      ? `${subjectLabel} \u2192 ${last.sourceTitle}`
      : `${subjectLabel} \u2192 ${toolLabel}`;
    resumeBtn.onclick = () => {
      if (last.tool === "memory" || last.tool === "mindmap" || last.tool === "tracker") {
        loadTool(last.tool, { subject: last.subject });
      } else {
        loadTool("analysis", {
          subject: last.subject,
          sourceId: last.sourceId || "",
          sourceMode: last.sourceMode || "reader"
        });
      }
    };
  } else {
    resumeBtn.disabled = true;
    resumeSub.textContent = "No recent activity";
    resumeBtn.onclick = null;
  }

  const subjects = await getSubjects();
  let bestSubject = null;
  let bestDue = 0;
  for (const s of subjects) {
    const [dueCards, dueA] = await Promise.all([
      getDueCardsForDeck(s, { limit: 999 }),
      getDueAnalysisNodesForSubject(s, { limit: 999 })
    ]);
    const total = dueCards.length + dueA.length;
    if (total > bestDue) { bestDue = total; bestSubject = s; }
  }
  if (bestSubject && bestDue > 0) {
    studyBtn.disabled = false;
    studySub.textContent = `${bestDue} card${bestDue !== 1 ? "s" : ""} due \u2014 ${bestSubject}`;
    studyBtn.onclick = () => loadTool("memory", { subject: bestSubject });
  } else {
    studyBtn.disabled = true;
    studySub.textContent = "No cards due";
    studyBtn.onclick = null;
  }

  const newSourceBtn = document.getElementById("dashNewSource");
  if (newSourceBtn) {
    let creatingSource = false;
    // The launchpad button must always be actionable after the dashboard has
    // rendered. Use an internal lock for duplicate clicks instead of leaving
    // the actual control stuck disabled if persistence or navigation fails.
    newSourceBtn.disabled = false;
    newSourceBtn.onclick = async () => {
      if (creatingSource) return;
      creatingSource = true;
      const id = crypto.randomUUID();
      try {
        // Empty launchpad drafts are buffers, not saved sources. Remove only
        // old records produced by the previous implementation, then let the
        // editor own the new draft until the user presses Save.
        const oldDrafts = (await getAllNodes()).filter((node) => (
          isSourceNode(node) &&
          !String(node.subject || "").trim() &&
          String(node.title || "").trim().toLowerCase() === "untitled source" &&
          !String(node.contentMarkdown || node.content || "").trim() &&
          !String(node.contentText || "").trim() &&
          (!node.contentHtml || node.contentHtml === "<p><br></p>")
        ));
        for (const draft of oldDrafts) await removeNodeEverywhere(draft.id);

        loadTool("analysis", {
          subject: "",
          sourceId: id,
          sourceMode: "editor",
          newSource: true
        });
      } catch (error) {
        console.error("Failed to create source:", error);
        toast("Could not create a new source");
      } finally {
        creatingSource = false;
        newSourceBtn.disabled = false;
      }
    };
  }

  const makeFlashcardsBtn = document.getElementById("dashMakeFlashcards");
  if (makeFlashcardsBtn) {
    makeFlashcardsBtn.onclick = () => {
      // Card-first: open Quick Add, not the multi-step deck builder.
      loadTool("memory", { subject: currentSubject || "", quickAdd: true })
        .catch((error) => console.error("Could not open Quick Add:", error));
    };
  }
}

async function renderStudyStreak() {
  const sessions = getStudySessions();
  const msgEl = document.getElementById("dashStreakMsg");
  const daysEl = document.getElementById("dashStreakDays");
  if (!msgEl || !daysEl) return;

  const studiedDates = new Set(sessions.map(s => s.date));
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const studiedToday = studiedDates.has(todayStr);

  let streak = 0;
  const d = new Date(today);
  while (true) {
    const ds = d.toISOString().slice(0, 10);
    if (studiedDates.has(ds)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }

  if (studiedToday) {
    if (streak <= 1) {
      msgEl.innerHTML = `Great to see you here today. Ready to make progress?`;
    } else {
      msgEl.innerHTML = `Back again day ${streak} in a row \u2014 great consistency.`;
    }
  } else {
    const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
    if (lastSession) {
      const diff = Math.floor((today - new Date(lastSession.date)) / 86400000);
      msgEl.textContent = diff === 1
        ? "You studied yesterday. Pick up where you left off?"
        : `It's been a few days \u2014 jump back in when you're ready.`;
    } else {
      msgEl.textContent = "Welcome \u2014 start a subject to begin studying.";
    }
  }

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
  const startOfWeek = new Date(today);
  const dayOfWeek = (startOfWeek.getDay() + 6) % 7;
  startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);

  const dots = daysEl.querySelectorAll(".dash-day");
  dots.forEach((dot, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    dot.classList.toggle("studied", studiedDates.has(ds));
    dot.classList.toggle("today", ds === todayStr);
    dot.querySelector(".dash-day-label").textContent = dayLabels[i];
  });
}

async function renderDueForReview() {
  const list = document.getElementById("dashDueList");
  if (!list) return;
  const subjects = await getSubjects();
  const rows = [];

  for (const s of subjects) {
    const [dueCards, dueA] = await Promise.all([
      getDueCardsForDeck(s, { limit: 999 }),
      getDueAnalysisNodesForSubject(s, { limit: 999 })
    ]);
    const total = dueCards.length + dueA.length;
    if (total > 0) {
      rows.push(`
        <div class="dash-due-row">
          <span class="dash-due-name">${escapeHtml(s)}</span>
          <div class="dash-due-counts">
            ${dueCards.length ? `<span><span class="count">${dueCards.length}</span> cards</span>` : ""}
            ${dueA.length ? `<span><span class="count">${dueA.length}</span> analyses</span>` : ""}
          </div>
          <button class="dash-due-btn" data-subject="${escapeHtml(s)}">Study</button>
        </div>
      `);
    }
  }

  list.innerHTML = rows.length > 0 ? rows.join("") : dashEmpty("Nothing due for review");
  list.querySelectorAll(".dash-due-btn").forEach(btn => {
    btn.addEventListener("click", () => loadTool("memory", { subject: btn.dataset.subject }));
  });
}

function timeAgo(ts) {
  const t = Number(ts || 0);
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 45 * 1000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function paperSittingAverage(p) {
  if (!p.results || p.results.length === 0) return null;
  let total = 0, count = 0;
  for (const r of p.results) {
    const attempts = r.attempts || [];
    if (attempts.length === 0) continue;
    let best = 0;
    for (const a of attempts) {
      const pct = a.maxMarks ? Math.round((a.score / a.maxMarks) * 100) : 0;
      if (pct > best) best = pct;
    }
    total += best; count++;
  }
  return count > 0 ? Math.round(total / count) : null;
}

async function renderRecentActivity() {
  const list = document.getElementById("dashActivityList");
  if (!list) return;

  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);

  // Index highlights (quotes) and annotations (analysis nodes) per source,
  // plus the latest moment any of them changed, so sources that were analysed
  // surface as a resumable feed entry instead of just "last edited".
  const bySource = new Map();
  const touchSource = (sourceId, ts) => {
    if (!sourceId) return;
    let rec = bySource.get(sourceId);
    if (!rec) { rec = { highlights: 0, notes: new Set(), latestTs: Number(ts || 0) }; bySource.set(sourceId, rec); }
    if (Number(ts || 0) > rec.latestTs) rec.latestTs = Number(ts || 0);
    return rec;
  };
  for (const q of allQuotes || []) {
    if (!q?.link?.sourceId) continue;
    const rec = touchSource(q.link.sourceId, q.updatedAt || q.createdAt);
    rec.highlights++;
    for (const aId of Array.isArray(q.meta?.analysisNodeIds) ? q.meta.analysisNodeIds : []) {
      if (aId) rec.notes.add(aId);
    }
  }
  for (const n of allNodes || []) {
    if (n.type !== "analysis" || !n.id) continue;
    for (const ref of Array.isArray(n.quoteRefs) ? n.quoteRefs : []) {
      if (ref?.sourceId) touchSource(ref.sourceId, n.updatedAt || n.createdAt)?.notes.add(n.id);
    }
  }

  const sources = allNodes.filter(n => isSourceNode(n) && String(n.title || n.name || "").trim());
  const events = [];

  for (const s of sources) {
    const writtenTs = Number(s.updatedAt || s.createdAt || 0);
    const rec = bySource.get(s.id);
    const analysedTs = rec ? rec.latestTs : 0;
    const hasAnalysis = rec && (rec.highlights > 0 || rec.notes.size > 0);
    if (hasAnalysis) {
      events.push({
        kind: "analysed", ts: Math.max(writtenTs, analysedTs),
        s, highlights: rec.highlights, notes: rec.notes.size
      });
    } else if (writtenTs) {
      events.push({ kind: "written", ts: writtenTs, s });
    }
  }

  const completedPapers = allNodes.filter(n =>
    n.type === "pastpaper" && (n.results || []).some(r => (r.attempts || []).length)
  );
  for (const p of completedPapers) {
    events.push({ kind: "paper", ts: Number(p.updatedAt || p.createdAt || 0), p });
  }

  events.sort((a, b) => b.ts - a.ts);

  const rows = [];
  for (const ev of events.slice(0, 6)) {
    if (ev.kind === "paper") {
      const avg = paperSittingAverage(ev.p);
      const label = [ev.p.subject, ev.p.year, ev.p.series].filter(Boolean).join(" \u2014 ");
      const badge = avg !== null
        ? `<span class="dash-activity-badge ${avg >= 60 ? "good" : "low"}">${avg}%</span>`
        : "";
      rows.push(`
        <button type="button" class="dash-activity-row clickable" data-tool="tracker" data-subject="${escapeHtml(ev.p.subject || "")}">
          <span class="dash-activity-icon"><i class="fa-solid fa-file-circle-check"></i></span>
          <div class="dash-activity-info">
            <div class="dash-activity-title">${escapeHtml(label || "Past Paper")}</div>
            <div class="dash-activity-meta">${(ev.p.results || []).length} sitting${(ev.p.results || []).length !== 1 ? "s" : ""} \u00b7 ${escapeHtml(timeAgo(ev.ts))}</div>
          </div>
          ${badge}
        </button>
      `);
    } else {
      const analysed = ev.kind === "analysed";
      const subject = String(ev.s.subject || ev.s.name || "");
      rows.push(`
        <button type="button" class="dash-activity-row clickable" data-tool="analysis"
          data-subject="${escapeHtml(subject)}" data-source="${escapeHtml(ev.s.id)}" data-mode="${analysed ? "reader" : "editor"}">
          <span class="dash-activity-icon"><i class="fa-solid ${analysed ? "fa-marker" : "fa-file-pen"}"></i></span>
          <div class="dash-activity-info">
            <div class="dash-activity-title">${escapeHtml(ev.s.title || ev.s.name || "Untitled Source")}</div>
            <div class="dash-activity-meta">${escapeHtml(subject || "No subject")} \u00b7 ${analysed
              ? `${ev.highlights} highlight${ev.highlights !== 1 ? "s" : ""} \u00b7 ${ev.notes} note${ev.notes !== 1 ? "s" : ""}`
              : "Written"}</div>
          </div>
          <span class="dash-activity-time">${escapeHtml(timeAgo(ev.ts))}</span>
        </button>
      `);
    }
  }

  const analysedTotal = sources.filter(s => {
    const rec = bySource.get(s.id);
    return rec && (rec.highlights > 0 || rec.notes.size > 0);
  }).length;

  const summary = sources.length > 0 || completedPapers.length > 0 ? `
    <div class="dash-activity-stats">
      <div class="dash-activity-stat" title="Past papers you completed">
        <i class="fa-solid fa-file-circle-check"></i>
        <span class="dash-activity-stat-num">${completedPapers.length}</span>
        <span class="dash-activity-stat-label">paper${completedPapers.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="dash-activity-stat" title="Sources you wrote">
        <i class="fa-solid fa-file-pen"></i>
        <span class="dash-activity-stat-num">${sources.length}</span>
        <span class="dash-activity-stat-label">written</span>
      </div>
      <div class="dash-activity-stat" title="Sources you highlighted and annotated">
        <i class="fa-solid fa-marker"></i>
        <span class="dash-activity-stat-num">${analysedTotal}</span>
        <span class="dash-activity-stat-label">analysed</span>
      </div>
    </div>
  ` : "";

  const statsEl = document.getElementById("dashActivityStats");
  if (statsEl) statsEl.innerHTML = summary || "";

  list.innerHTML = rows.join("") || dashEmpty("No activity yet");

  list.querySelectorAll(".dash-activity-row.clickable").forEach(row => {
    const open = () => {
      const { tool, subject, source, mode } = row.dataset;
      loadTool(tool, tool === "tracker"
        ? { subject }
        : { subject, sourceId: source, sourceMode: mode });
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

async function renderDashboard() {
  await Promise.all([
    renderQuickActions(),
    renderStudyStreak(),
    renderDueForReview(),
    renderRecentActivity()
  ]);
}

async function initLaunchpad() {
  await renderDashboard();
  await renderSidebarSubjects();

  const allBtn = document.getElementById("sidebarSubjectAll");
  if (allBtn) {
    allBtn.addEventListener("click", () => selectSidebarSubject(""));
  }
}

async function enterSubjectWorkspace(subject) {
  currentSubject = subject;
  logActivity(subject, "analysis");
  hideLaunchpad();
  await renderSidebarSubjects();
  await loadTool("analysis", { subject });
}

function returnToGlobalLaunchpad() {
  console.log("Returning to global launchpad");
  currentToolName = "";
  currentSubject = null;
  setActiveTool("");
  // Notify tools to cleanup their internal state
  if (typeof window.__neuronetOnReturnToGlobal === "function") {
    window.__neuronetOnReturnToGlobal();
  }
  showLaunchpad();
  renderSidebarSubjects();
  renderDashboard();

  // Make the transition back to home prominent on the neural background
  if (window.__neuronetCanvas) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    // High-strength pulse for prominence
    window.__neuronetCanvas.triggerRadialPulse(cx, cy, 2.2);
    // Burst of energy for "alien intelligent" feel
    setTimeout(() => {
      window.__neuronetCanvas.triggerRandomNodes(15, 0.9);
      window.__neuronetCanvas.triggerVerticalWave(0.5);
    }, 50);
  }
}

// Wire up back button handler
window.__neuronetReturnToLaunchpad = returnToGlobalLaunchpad;

// For tools to register cleanup when returning to global launchpad
window.__neuronetOnReturnToGlobal = null;

// ========== PINNED TOOLS SIDEBAR ==========

async function initPinnedToolsSidebar() {
  const container = document.getElementById("toolButtonsContainer");
  if (!container) return;

  const pinnedTools = await getPinnedTools();
  const pinnedIds = pinnedTools.map(t => t.toolId);

  // Default: pin all tools initially
  const toolsToShow = Object.keys(toolDefinitions);
  for (const toolId of toolsToShow) {
    if (!pinnedIds.includes(toolId)) {
      await pinTool(toolId);
    }
  }

  await renderPinnedToolsSidebar();
}

async function renderPinnedToolsSidebar() {
  const container = document.getElementById("toolButtonsContainer");
  if (!container) return;

  const pinnedTools = await getPinnedTools();
  const toolCount = document.getElementById("sidebarToolCount");
  if (toolCount) toolCount.textContent = String(pinnedTools.length);

  container.innerHTML = pinnedTools.map((pinned, index) => {
    const def = toolDefinitions[pinned.toolId];
    if (!def) return "";
    const isActive = currentToolName === pinned.toolId ? "active" : "";
    return `
      <div class="tool-btn-wrapper entering ${isActive}" data-tool="${pinned.toolId}">
        <button class="tool-btn" data-tool="${pinned.toolId}" aria-label="Open ${escapeHtml(def.name)}" title="${escapeHtml(def.name)}" ${isActive ? 'aria-current="page"' : ''}>
          <span class="tool-icon" aria-hidden="true"><i class="${escapeHtml(def.icon)}"></i></span>
          <span class="tool-label">${escapeHtml(def.name)}</span>
        </button>
        <div class="tool-actions-menu">
          <button class="tool-action-btn pin" data-action="unpin" data-tool="${pinned.toolId}" title="Unpin">Unpin</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".tool-btn-wrapper").forEach((wrapper, i) => {
    setTimeout(() => {
      wrapper.classList.remove("entering");
      wrapper.classList.add("entered");
    }, 50 + i * 40);
  });

  container.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const toolName = btn.dataset.tool;
      const subject = currentSubject;
      window.closeSubjectDrawer?.();
      hideLaunchpad();
      loadTool(toolName, { subject });
    });
  });

  container.querySelectorAll(".tool-btn-wrapper").forEach(wrapper => {
    wrapper.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.querySelectorAll(".tool-btn-wrapper.show-actions").forEach(el => {
        if (el !== wrapper) el.classList.remove("show-actions");
      });
      wrapper.classList.toggle("show-actions");
    });
  });

  document.addEventListener("click", () => {
    container.querySelectorAll(".tool-btn-wrapper.show-actions").forEach(el => {
      el.classList.remove("show-actions");
    });
  });

  container.querySelectorAll(".tool-action-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const toolId = btn.dataset.tool;
      if (action === "unpin") {
        showUnpinModal(toolId);
      }
      btn.closest(".tool-btn-wrapper").classList.remove("show-actions");
    });
  });
}

// ========== SIDEBAR SUBJECT SWITCHER ==========

let subjectPillMenu = null;

function ensureSubjectPillMenu() {
  if (subjectPillMenu) return subjectPillMenu;
  subjectPillMenu = document.createElement("div");
  subjectPillMenu.className = "subject-pill-menu";
  subjectPillMenu.innerHTML = `
    <button data-action="rename">Rename</button>
    <button data-action="delete" class="danger">Delete</button>
  `;
  document.body.appendChild(subjectPillMenu);
  document.addEventListener("click", () => subjectPillMenu.classList.remove("open"));
  return subjectPillMenu;
}

let subjectEditMode = false;
const SUBJECT_ORDER_KEY = `nn-subject-order-${window.DEMO_MODE ? "demo" : "main"}-${window.APP_VERSION || "v0"}`;

function subjectNameMatches(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

// Subjects are still name-keyed. A trailing parenthetical is treated as an
// implicit level/qualifier so "Biology (A-Level)" groups away from "Biology".
function subjectGroup(name) {
  const match = String(name || "").trim().match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : "General";
}

function compareSubjectGroups(a, b) {
  // Put deliberately qualified groups (A-Level, GCSE, ...) first and leave
  // unqualified legacy subjects in a General section at the bottom.
  if (a === "General" && b !== "General") return 1;
  if (b === "General" && a !== "General") return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function loadSubjectOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUBJECT_ORDER_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSubjectOrder(order) {
  try {
    localStorage.setItem(SUBJECT_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode or storage full */
  }
}

function updateSubjectOrder(mutator) {
  saveSubjectOrder(mutator([...loadSubjectOrder()]));
}

function rememberSubject(name) {
  updateSubjectOrder((order) => order.includes(name) ? order : [...order, name]);
}

function forgetSubject(name) {
  updateSubjectOrder((order) => order.filter((item) => item !== name));
}

function renameInSubjectOrder(oldName, newName) {
  updateSubjectOrder((order) => {
    const seen = new Set();
    return order
      .map((item) => item === oldName ? newName : item)
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  });
}

// Group first (so qualifiers stay contiguous), then honour saved drag order
// inside each group, then fall back to alphabetical for new subjects.
function orderSubjects(subjects) {
  const rank = new Map(loadSubjectOrder().map((name, index) => [name, index]));
  return [...subjects].sort((a, b) => {
    const groupCompare = compareSubjectGroups(subjectGroup(a), subjectGroup(b));
    if (groupCompare !== 0) return groupCompare;
    const aRank = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

async function readSubjects() {
  try {
    return (await getSubjects()) || [];
  } catch (error) {
    console.warn("Could not load subjects:", error);
    return [];
  }
}

// Subject creation belongs to the shell, not to any one tool. Tools only
// consume the global subject list; this is the single creation path.
async function createSubjectFromShell() {
  const subjects = await readSubjects();

  const typed = await dialog.prompt("New subject name (e.g. Biology):", "");
  const name = String(typed || "").trim();
  if (!name) return;

  let subjectName = name;
  const existing = subjects.find((subject) => subjectNameMatches(subject, name));
  if (existing) {
    const qualifier = await dialog.prompt(
      `“${existing}” already exists. Add a qualifier to create a separate subject (for example A-Level), or leave this blank to use the existing subject.`,
      ""
    );
    if (qualifier === null) return;
    const suffix = String(qualifier || "").trim();
    subjectName = suffix ? `${String(existing)} (${suffix})` : String(existing);
  }

  const alreadyExists = subjects.some((subject) => subjectNameMatches(subject, subjectName));
  if (!alreadyExists) {
    try {
      await addSubject(subjectName);
    } catch (error) {
      console.error("Could not create subject:", error);
      await dialog.alert(`Could not create “${subjectName}”: ${error.message}`);
      return;
    }
    rememberSubject(subjectName);
  }

  await renderSidebarSubjects();
  await renderDashboard();
  document.getElementById("sidebarQuickSubjectsMenu")?.classList.remove("open");
  document.getElementById("sidebarQuickSubjects")?.setAttribute("aria-expanded", "false");

  if (alreadyExists) {
    toast(`Subject “${subjectName}” already exists.`);
  } else {
    toast(`Subject “${subjectName}” created.`, {
      action: { label: "Switch", onClick: () => selectSidebarSubject(subjectName) }
    });
  }
}

// Rename keeps all decks/cards/quotes/analyses together. Renaming onto an
// existing name merges the two subjects, so that path asks twice.
async function renameSubjectFromShell(name) {
  const current = String(name || "").trim();
  if (!current) return;

  const typed = await dialog.prompt(`Rename “${current}” to:`, current);
  if (typed === null) return;
  let next = String(typed || "").trim().replace(/\s+/g, " ");
  if (!next) {
    await dialog.alert("A subject name cannot be empty.");
    return;
  }
  if (next === current) return;

  const subjects = await readSubjects();
  const collision = subjects.find((subject) => (
    !subjectNameMatches(subject, current) && subjectNameMatches(subject, next)
  ));
  let merging = false;

  if (collision) {
    merging = true;
    next = String(collision).trim();
    const mergeGate = await dialog.confirm(
      `“${collision}” already exists.\n\nRenaming “${current}” to that name will MERGE both subjects and all their content. This cannot be undone.`,
      "Continue to merge",
      "danger"
    );
    if (!mergeGate) return;
    const mergeFinal = await dialog.confirm(
      `Merge “${current}” into “${collision}”?`,
      "Merge subjects",
      "danger"
    );
    if (!mergeFinal) return;
  }

  if (!merging) {
    const ok = await dialog.confirm(
      `Rename “${current}” to “${next}”?\n\nAll decks, cards, quotes and analyses move with it.`,
      "Rename"
    );
    if (!ok) return;
  }

  try {
    await renameSubject(current, next);
  } catch (error) {
    console.error("Could not rename subject:", error);
    await dialog.alert(`Could not rename “${current}”: ${error.message}`);
    return;
  }

  renameInSubjectOrder(current, next);
  const wasCurrent = subjectNameMatches(currentSubject, current);
  await renderSidebarSubjects();
  await renderDashboard();
  if (wasCurrent) {
    currentSubject = null;
    await selectSidebarSubject(next);
  }
  toast(`Subject renamed to “${next}”.`);
}

async function deleteSubjectFromShell(name) {
  const current = String(name || "").trim();
  if (!current) return;

  let stats = { cards: 0, decks: 0, nodes: 0, quotes: 0 };
  try {
    const [cards, decks, nodes, quotes] = await Promise.all([
      getCardsForDeck(current).catch(() => []),
      getDecksForSubject(current).catch(() => []),
      getAllNodes().catch(() => []),
      getAllQuotes().catch(() => [])
    ]);
    stats = {
      cards: (cards || []).length,
      decks: (decks || []).length,
      nodes: (nodes || []).filter((node) => String(node.subject || "") === current).length,
      quotes: (quotes || []).filter((quote) => String(quote.subject || "") === current).length
    };
  } catch {
    /* counts are only a warning aid */
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const summary = [
    plural(stats.decks, "deck", "decks"),
    plural(stats.cards, "card", "cards"),
    plural(stats.nodes, "item", "items"),
    plural(stats.quotes, "quote", "quotes")
  ].join(", ");

  const first = await dialog.confirm(
    `Delete “${current}”?\n\nThis permanently removes ${summary}.`,
    "Continue",
    "danger"
  );
  if (!first) return;

  const typed = await dialog.prompt(
    `Type the subject name exactly to confirm permanent deletion:\n${current}`,
    ""
  );
  if (typed === null) return;
  if (String(typed).trim() !== current) {
    await dialog.alert("The name did not match. Nothing was deleted.");
    return;
  }

  const last = await dialog.confirm(
    `Last chance — permanently delete “${current}” and all its content?`,
    "Delete forever",
    "danger"
  );
  if (!last) return;

  const wasCurrent = subjectNameMatches(currentSubject, current);
  try {
    await deleteSubject(current);
  } catch (error) {
    console.error("Could not delete subject:", error);
    await dialog.alert(`Could not delete “${current}”: ${error.message}`);
    return;
  }

  forgetSubject(current);
  if (wasCurrent) {
    currentSubject = null;
    await selectSidebarSubject(null);
  } else {
    await renderSidebarSubjects();
    await renderDashboard();
  }
  toast(`Subject “${current}” deleted.`);
}

function setSubjectEditMode(enabled) {
  subjectEditMode = !!enabled;
  const btn = document.getElementById("sidebarSubjectEdit");
  if (btn) {
    btn.classList.toggle("active", subjectEditMode);
    btn.setAttribute("aria-pressed", String(subjectEditMode));
    btn.title = subjectEditMode ? "Done editing subjects" : "Edit subjects";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = subjectEditMode
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
  }
  renderSidebarSubjects();
}

function subjectPillMarkup(subject) {
  const norm = (value) => String(value || "").trim().toLowerCase();
  return `
    <button type="button" class="subject-pill ${norm(subject) === norm(currentSubject) ? "active" : ""}"
            data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>
  `;
}

function subjectEditRowMarkup(subject, group) {
  const safe = escapeHtml(subject);
  return `
    <div class="subject-edit-row" data-subject="${safe}" data-group="${escapeHtml(group)}">
      <button type="button" class="subject-drag-handle" title="Drag to reorder" aria-label="Reorder ${safe}">
        <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
      </button>
      <span class="subject-edit-name">${safe}</span>
      <span class="subject-edit-actions">
        <button type="button" class="subject-row-btn" data-action="rename" title="Rename ${safe}" aria-label="Rename ${safe}">
          <i class="fa-solid fa-pen" aria-hidden="true"></i>
        </button>
        <button type="button" class="subject-row-btn danger" data-action="delete" title="Delete ${safe}" aria-label="Delete ${safe}">
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
      </span>
    </div>
  `;
}

// Pointer-based drag works with mouse, touch and pen. Reordering is confined
// to the subject's group so qualifier sections stay contiguous.
function attachSubjectDrag(row, handle) {
  let drag = null;

  const finish = (event, commit) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { rows, moved } = drag;
    row.classList.remove("dragging");
    try {
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    } catch { /* pointer already released */ }
    drag = null;
    if (!commit || !moved) return;

    const groupNames = [...rows.querySelectorAll(".subject-edit-row")]
      .map((item) => item.dataset.subject);
    const groupSet = new Set(groupNames);
    const rest = loadSubjectOrder().filter((name) => !groupSet.has(name));
    saveSubjectOrder([...rest, ...groupNames]);
    renderSidebarSubjects();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (!subjectEditMode) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try { handle.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
    drag = { pointerId: event.pointerId, rows: row.parentElement, moved: false };
    row.classList.add("dragging");
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const rows = drag.rows;
    const siblings = [...rows.querySelectorAll(".subject-edit-row:not(.dragging)")];
    let before = null;
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        before = sibling;
        break;
      }
    }
    if (before) {
      if (row.nextElementSibling !== before) rows.insertBefore(row, before);
    } else if (rows.lastElementChild !== row) {
      rows.appendChild(row);
    }
    drag.moved = true;
  });

  handle.addEventListener("pointerup", (event) => finish(event, true));
  handle.addEventListener("pointercancel", (event) => finish(event, false));
}

async function renderSidebarSubjects() {
  const listEl = document.getElementById("sidebarSubjectList");
  const quickListEl = document.getElementById("sidebarQuickSubjectList");
  const allBtn = document.getElementById("sidebarSubjectAll");
  if (!allBtn) return;

  const subjects = orderSubjects(await readSubjects());
  const subjectCount = document.getElementById("sidebarSubjectCount");
  // “All” is a filter, not a subject, so keep the header count aligned with
  // the actual subject entries shown below it.
  if (subjectCount) subjectCount.textContent = String(subjects.length);
  const norm = (s) => String(s || "").trim().toLowerCase();
  const scrollBox = document.getElementById("sidebarSubjects");
  const scrollTop = scrollBox?.scrollTop || 0;

  allBtn.classList.toggle("active", !currentSubject);
  allBtn.setAttribute("aria-current", !currentSubject ? "page" : "false");

  const groups = new Map();
  subjects.forEach((subject) => {
    const group = subjectGroup(subject);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(subject);
  });
  const groupNames = [...groups.keys()].sort(compareSubjectGroups);
  const showGroupLabels = groupNames.length > 1;

  if (listEl) {
    if (!subjects.length) {
      listEl.innerHTML = `<div class="subject-empty">No subjects yet</div>`;
    } else {
      listEl.innerHTML = groupNames.map((group) => `
        <div class="subject-group" data-group="${escapeHtml(group)}">
          ${showGroupLabels ? `<div class="subject-group-label">${escapeHtml(group)}</div>` : ""}
          <div class="subject-group-rows">
            ${groups.get(group).map((subject) => (
              subjectEditMode ? subjectEditRowMarkup(subject, group) : subjectPillMarkup(subject)
            )).join("")}
          </div>
        </div>
      `).join("");
    }
    scrollBox && (scrollBox.scrollTop = scrollTop);
  }

  if (quickListEl) {
    quickListEl.innerHTML = `
      <button type="button" role="menuitem" class="quick-subject-item ${!currentSubject ? "active" : ""}" data-subject="">
        <span class="quick-subject-dot"></span><span>All subjects</span>
      </button>
      ${groupNames.map((group) => `
        ${showGroupLabels ? `<div class="quick-group-label">${escapeHtml(group)}</div>` : ""}
        ${groups.get(group).map((subject) => `
          <button type="button" role="menuitem" class="quick-subject-item ${norm(subject) === norm(currentSubject) ? "active" : ""}" data-subject="${escapeHtml(subject)}">
            <span class="quick-subject-dot"></span><span>${escapeHtml(subject)}</span>
          </button>
        `).join("")}
      `).join("")}
    `;
  }

  listEl?.querySelectorAll(".subject-pill").forEach((btn) => {
    btn.setAttribute("aria-current", btn.classList.contains("active") ? "page" : "false");
    btn.addEventListener("click", () => selectSidebarSubject(btn.dataset.subject));
    btn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = ensureSubjectPillMenu();
      const subj = btn.dataset.subject;
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.classList.add("open");
      menu.querySelectorAll("button").forEach((actionBtn) => {
        actionBtn.onclick = async () => {
          menu.classList.remove("open");
          if (actionBtn.dataset.action === "rename") await renameSubjectFromShell(subj);
          else if (actionBtn.dataset.action === "delete") await deleteSubjectFromShell(subj);
        };
      });
    });
  });

  listEl?.querySelectorAll(".subject-edit-row").forEach((row) => {
    const subject = row.dataset.subject;
    row.querySelector('[data-action="rename"]')?.addEventListener("click", () => {
      renameSubjectFromShell(subject);
    });
    row.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      deleteSubjectFromShell(subject);
    });
    const handle = row.querySelector(".subject-drag-handle");
    if (handle) attachSubjectDrag(row, handle);
  });

  quickListEl?.querySelectorAll(".quick-subject-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectSidebarSubject(btn.dataset.subject);
      document.getElementById("sidebarQuickSubjectsMenu")?.classList.remove("open");
      document.getElementById("sidebarQuickSubjects")?.setAttribute("aria-expanded", "false");
    });
  });
}

async function selectSidebarSubject(subject) {
  if (typeof window.closeSubjectDrawer === "function") {
    window.closeSubjectDrawer();
  }
  const next = subject || null;
  const subjectChanged = next !== currentSubject;
  currentSubject = next;
  setActiveTool(currentToolName);
  await renderSidebarSubjects();

  if (!subjectChanged) return;
  if (currentToolName === "mindmap" && typeof window.__neuronetMindmapSetSubject === "function") {
    // The mindmap animates between subject scopes in place; reloading the
    // tool would destroy the canvas and lose the transition.
    window.__neuronetMindmapSetSubject(next);
  } else if (currentToolName) {
    loadTool(currentToolName, { subject: next });
  } else if (next) {
    enterSubjectWorkspace(next);
  } else {
    returnToGlobalLaunchpad();
  }
}

window.__neuronetSelectSubject = selectSidebarSubject;

window.__neuronetRefreshSubjects = async () => {
  await renderSidebarSubjects();
};

// ========== UNPIN MODAL ==========

let pendingUnpinTool = null;

function showUnpinModal(toolId) {
  pendingUnpinTool = toolId;
  const def = toolDefinitions[toolId];
  document.getElementById("unpinToolName").textContent = def?.name || toolId;
  document.getElementById("unpinModal").style.display = "flex";
}

function hideUnpinModal() {
  pendingUnpinTool = null;
  document.getElementById("unpinModal").style.display = "none";
}

async function confirmUnpin() {
  if (!pendingUnpinTool) return;
  await unpinTool(pendingUnpinTool);
  hideUnpinModal();
  await renderPinnedToolsSidebar();
}

// A localhost build is allowed to run on any port. The badge is the ownership
// marker: it links the local copy back to the portfolio instead of pretending
// to be the official deployment. This is deliberately not a security boundary;
// the app is local-first and anyone running a copy can edit it.
function installDevWatermark() {
  if (document.getElementById("devWatermark")) return;
  const watermark = document.createElement("a");
  watermark.id = "devWatermark";
  watermark.href = "https://aigsniperyt.github.io/";
  watermark.target = "_blank";
  watermark.rel = "noopener";
  watermark.textContent = "DEV BUILD · aigsniperyt.github.io";
  watermark.title = "Local development build. Portfolio: https://aigsniperyt.github.io/";
  watermark.setAttribute("aria-label", "Local development build. Open the portfolio.");
  Object.assign(watermark.style, {
    position: "fixed",
    right: "10px",
    bottom: "10px",
    zIndex: "2147483647",
    padding: "4px 9px",
    borderRadius: "999px",
    border: "1px solid rgba(44,255,179,0.35)",
    background: "rgba(8,24,18,0.82)",
    color: "#2cffb3",
    fontFamily: "var(--font-ui), system-ui, sans-serif",
    fontSize: "10px",
    fontWeight: "600",
    lineHeight: "1.4",
    letterSpacing: "0.04em",
    textDecoration: "none",
    opacity: "0.72",
    backdropFilter: "blur(6px)",
    pointerEvents: "auto",
  });
  watermark.addEventListener("mouseenter", () => {
    watermark.style.opacity = "1";
  });
  watermark.addEventListener("mouseleave", () => {
    watermark.style.opacity = "0.72";
  });
  document.body.appendChild(watermark);
}

// ========== TOOL CATALOGUE ==========

// ========== EVENT LISTENERS ==========
document.addEventListener("DOMContentLoaded", async () => {
  installDiag();
  toolContainer = document.getElementById("toolContainer");
  setProfileUI(null);

  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const loadingCheckmark = document.getElementById("loadingCheckmark");
  const appElement = document.getElementById("app");

  // Origin validation. Only the official GitHub Pages host and localhost are
  // allowed. Localhost is allowed on any port so Live Server and other local
  // static servers work; a small watermark links the local build back to the
  // portfolio. Every other host is denied.
  const OFFICIAL_HOST = "aigsniperyt.github.io";
  const hostname = window.location.hostname;
  const isOfficialHost = hostname === OFFICIAL_HOST;
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";
  const isAllowed = isOfficialHost || isLocalhost;

  if (isLocalhost) installDevWatermark();

  if (!isAllowed) {
    loadingOverlay.style.display = "flex";
    loadingMessage.innerHTML = `<span style="color:#ff6b6b;font-size:1.2rem;">&#10060; Access denied</span>`;
    const checkmark = loadingOverlay.querySelector(".checkmark");
    if (checkmark) checkmark.remove();
    return;
  }

  loadingOverlay.style.display = "flex";
  loadingMessage.textContent = "Connecting to the server...";

  const sidebarEl = document.getElementById("sidebar");
  const launchpadEl = document.getElementById("globalLaunchpad");
  if (sidebarEl) sidebarEl.classList.add("entering");
  if (launchpadEl) launchpadEl.classList.add("entering");

  await initDB();
  DB_READY = true;

  // Every card needs a canonical deck home. This is idempotent and backfills
  // pre-deck databases into an Unsorted deck per subject.
  try {
    await ensureDeckMembership();
  } catch (error) {
    console.error("[DECKS] membership backfill failed:", error);
  }

  // Cards are the study source of truth. Legacy quote/cue pairs are optional
  // context only; they are never auto-converted into cards.

  // The tag store is a derived index. Reconcile it with the records so an old
  // database cannot keep orphaned tags or tags that no longer exist.
  const [tagNodes, tagQuotes, tagCards] = await Promise.all([
    getAllNodes(),
    getAllQuotes(),
    getAllCards()
  ]);
  await syncTagStoreFromData({
    nodes: tagNodes,
    quotes: tagQuotes,
    cards: tagCards
  });

  loadingMessage.textContent = "Authenticating with the cloud...";
  let user;
  if (USE_BACKEND) {
    try {
      user = await fetchUser();
    } finally {
      loadingMessage.textContent = "Loading page content complete!";
      loadingCheckmark.classList.add("show");
    }

    await new Promise(r => setTimeout(r, 800));

    loadingOverlay.classList.add("fade-out");

    await new Promise(r => setTimeout(r, 800));

    if (user) {
      await syncAfterLogin();
    }
  } else {
    loadingMessage.textContent = "Loading page content complete!";
    loadingCheckmark.classList.add("show");
    await new Promise(r => setTimeout(r, 800));
    loadingOverlay.classList.add("fade-out");
    await new Promise(r => setTimeout(r, 800));
  }

  loadingOverlay.classList.add("completed");
  loadingOverlay.style.display = "none";

  if (canvasEl) {
    canvasEl.style.filter = "brightness(0.85) contrast(1.15)";
  }

  const sidebarElDone = document.getElementById("sidebar");
  sidebarElDone?.classList.remove("entering");
  sidebarElDone?.classList.add("entered");
  if (launchpadEl) {
    launchpadEl.classList.remove("entering");
    launchpadEl.classList.add("entered");
  }

  const sidebarTools = document.querySelectorAll(".tool-btn-wrapper.entering");
  sidebarTools.forEach((tool, i) => {
    setTimeout(() => {
      tool.classList.remove("entering");
      tool.classList.add("entered");
    }, 50 + i * 40);
  });

  window.addEventListener("neuronet-open-tool", (e) => {
    const { tool, nodeId, cardId, heapId, view, subject } = e.detail || {};
    if (tool) {
      loadTool(tool, { nodeId, cardId, heapId, view, subject });
    }
  });

  const profileElem = document.getElementById("sidebarProfile");
  const dropdown = document.getElementById("dropdown");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const importJsonBtn = document.getElementById("importJsonBtn");
  const importJsonInput = document.getElementById("importJsonInput");
  const importDemoBtn = document.getElementById("importDemoBtn");
  const deleteDataBtn = document.getElementById("deleteDataBtn");

  const setProfileDropdown = (open) => {
    if (!dropdown) return;
    dropdown.style.display = open ? "block" : "none";
    dropdown.classList.toggle("profile-menu-open", open);
  };

  if (profileElem) {
    profileElem.addEventListener("click", (e) => {
      e.stopPropagation();
      setProfileDropdown(dropdown.style.display !== "block");
    });
  }

  document.addEventListener("click", () => {
    setProfileDropdown(false);
    document.getElementById("sidebarQuickSubjectsMenu")?.classList.remove("open");
    document.getElementById("sidebarQuickSubjects")?.setAttribute("aria-expanded", "false");
  });

  // Mobile navigation drawer: hamburger opens, backdrop / selection closes.
  const hamburger = document.getElementById("sidebarHamburger");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const quickSubjectsBtn = document.getElementById("sidebarQuickSubjects");
  const quickSubjectsMenu = document.getElementById("sidebarQuickSubjectsMenu");
  const subjectAddBtn = document.getElementById("sidebarSubjectAdd");
  const subjectEditBtn = document.getElementById("sidebarSubjectEdit");
  const quickSubjectAddBtn = document.getElementById("sidebarQuickSubjectAdd");
  const quickSubjectEditBtn = document.getElementById("sidebarQuickSubjectEdit");

  if (subjectAddBtn) {
    subjectAddBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      createSubjectFromShell();
    });
  }
  if (subjectEditBtn) {
    subjectEditBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setSubjectEditMode(!subjectEditMode);
    });
  }
  if (quickSubjectAddBtn) {
    quickSubjectAddBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      createSubjectFromShell();
    });
  }
  if (quickSubjectEditBtn) {
    quickSubjectEditBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickSubjectsMenu?.classList.remove("open");
      quickSubjectsBtn?.setAttribute("aria-expanded", "false");
      setSidebarCollapsed(false);
      setSubjectEditMode(true);
    });
  }
  const mobileNavClose = document.getElementById("mobileNavClose");
  const mobileNavPanel = document.getElementById("mobileNavPanel");
  const subjectBackdrop = document.getElementById("sidebarSubjectBackdrop");
  const mobileSubjectsToggle = document.getElementById("mobileSubjectsToggle");
  const mobileToolsToggle = document.getElementById("mobileToolsToggle");
  const mobileSubjectsSection = document.getElementById("mobileSubjectsSection");
  const mobileToolsSection = document.getElementById("mobileToolsSection");

  const desktopSidebarQuery = window.matchMedia("(min-width: 701px)");
  function setSidebarCollapsed(collapsed) {
    if (!desktopSidebarQuery.matches || !sidebarEl) return;
    sidebarEl.classList.toggle("collapsed", collapsed);
    collapseBtn?.setAttribute("aria-expanded", String(!collapsed));
    collapseBtn?.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn?.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
    if (collapseBtn) collapseBtn.innerHTML = `<span aria-hidden="true">${collapsed ? "›" : "‹"}</span>`;
    quickSubjectsMenu?.classList.remove("open");
    quickSubjectsBtn?.setAttribute("aria-expanded", "false");
    localStorage.setItem("nn-sidebar-collapsed", collapsed ? "1" : "0");
  }
  const savedSidebarState = localStorage.getItem("nn-sidebar-collapsed") === "1";
  if (desktopSidebarQuery.matches) setSidebarCollapsed(savedSidebarState);
  collapseBtn?.addEventListener("click", () => setSidebarCollapsed(!sidebarEl.classList.contains("collapsed")));
  quickSubjectsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = quickSubjectsMenu?.classList.toggle("open") || false;
    quickSubjectsBtn.setAttribute("aria-expanded", String(open));
  });
  quickSubjectsMenu?.addEventListener("click", (event) => event.stopPropagation());
  desktopSidebarQuery.addEventListener?.("change", (event) => {
    if (!event.matches) sidebarEl?.classList.remove("collapsed");
    else setSidebarCollapsed(localStorage.getItem("nn-sidebar-collapsed") === "1");
  });
  window.closeSubjectDrawer = closeSubjectDrawer;
  function closeSubjectDrawer() {
    mobileNavPanel?.classList.remove("open");
    subjectBackdrop?.classList.remove("show");
    hamburger?.setAttribute("aria-expanded", "false");
    mobileNavPanel?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("nav-drawer-open");
  }
  function openSubjectDrawer() {
    mobileNavPanel?.classList.add("open");
    subjectBackdrop?.classList.add("show");
    hamburger?.setAttribute("aria-expanded", "true");
    mobileNavPanel?.setAttribute("aria-hidden", "false");
    document.body.classList.add("nav-drawer-open");
  }
  hamburger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = mobileNavPanel?.classList.contains("open");
    open ? closeSubjectDrawer() : openSubjectDrawer();
  });
  subjectBackdrop?.addEventListener("click", closeSubjectDrawer);
  mobileNavClose?.addEventListener("click", closeSubjectDrawer);
  function setMobileNavSection(section, toggle, open) {
    if (!section || !toggle) return;
    section.classList.toggle("mobile-section-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }
  function toggleMobileNavSection(sectionName) {
    const isSubjects = sectionName === "subjects";
    const section = isSubjects ? mobileSubjectsSection : mobileToolsSection;
    const toggle = isSubjects ? mobileSubjectsToggle : mobileToolsToggle;
    const open = toggle?.getAttribute("aria-expanded") !== "true";
    setMobileNavSection(section, toggle, open);
  }
  mobileSubjectsToggle?.addEventListener("click", () => toggleMobileNavSection("subjects"));
  mobileToolsToggle?.addEventListener("click", () => toggleMobileNavSection("tools"));
  if (window.matchMedia("(max-width: 700px)").matches) {
    closeSubjectDrawer();
    setMobileNavSection(mobileToolsSection, mobileToolsToggle, false);
  } else {
    mobileNavPanel?.removeAttribute("aria-hidden");
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSubjectDrawer();
      quickSubjectsMenu?.classList.remove("open");
      quickSubjectsBtn?.setAttribute("aria-expanded", "false");
    }
  });

  // Keep the sidebar subject pills (and launchpad subjects) in sync with any
  // database change across all tools.
  document.addEventListener("db-change", async () => {
    await renderSidebarSubjects();
    await renderDashboard();
  });

  const unpinCancel = document.getElementById("unpinCancel");
  const unpinConfirm = document.getElementById("unpinConfirm");

  if (unpinCancel) {
    unpinCancel.addEventListener("click", hideUnpinModal);
  }
  if (unpinConfirm) {
    unpinConfirm.addEventListener("click", confirmUnpin);
  }

  // Initialize pinned tools sidebar
  await initPinnedToolsSidebar();

  // Initialize launchpad
  await initLaunchpad();

  // Default to launchpad (no tool selected)
  showLaunchpad();

  // Logo click - return to launchpad
  const logo = document.getElementById("logo");
  if (logo) {
    logo.addEventListener("click", () => {
      returnToGlobalLaunchpad();
    });
  } else {
    // Fallback: use event delegation
    document.addEventListener("click", (e) => {
      const h2 = e.target.closest("h2");
      if (h2 && h2.id === "logo") {
        returnToGlobalLaunchpad();
      }
    });
  }

  if (authActionBtn) {
    authActionBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      startGoogleLogin();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      if (USE_BACKEND) {
        try {
          await fetch(`${BACKEND}/auth/logout`, {
            credentials: "include",
          });
        } catch (error) {
          console.log("Logout request failed, staying offline locally", error);
        }
      }

      window.currentUser = null;
      setProfileUI(null);
      setProfileDropdown(false);
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await exportDatabaseJson();
      setProfileDropdown(false);
    });
  }

  if (importJsonBtn && importJsonInput) {
    importJsonBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      importJsonInput.click();
    });

    importJsonInput.addEventListener("change", async () => {
      const [file] = importJsonInput.files || [];
      if (!file) return;
      const confirmed = await dialog.confirm("Importing JSON will overwrite your current NeuroNet database. Continue?", "Import", "danger");
      if (!confirmed) {
        importJsonInput.value = "";
        return;
      }

      try {
        await importDatabaseJson(file);
        setProfileDropdown(false);
      } catch (error) {
        console.error("Import failed", error);
        dialog.alert(`Import failed: ${error?.message || "please check the JSON file format."}`);
      } finally {
        importJsonInput.value = "";
      }
    });
  }

  if (importDemoBtn) {
    importDemoBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      setProfileDropdown(false);
      await importDemoData();
    });
  }

  if (deleteDataBtn) {
    deleteDataBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setProfileDropdown(false);
      deleteAllData();
    });
  }

  // First-entry / data-state toast: nudge the user toward the profile card
  // (Import Demo Data / Delete Data live there). Shown whenever the DB is
  // pristine demo data, empty, OR it's the user's first visit — and only
  // stops once they've made their first change (own/modified data).
  try {
    const visitedKey = "nn-first-visit";
    const visited = !!localStorage.getItem(visitedKey);
    if (!visited) localStorage.setItem(visitedKey, "1");

    const [nodes, quotes, cues, cards] = await Promise.all([
      getAllNodes(),
      getAllQuotes(),
      getAllCues(),
      getAllCards()
    ]);
    const isEmpty = nodes.length === 0 && quotes.length === 0 && cues.length === 0 && cards.length === 0;
    const isDemo = await isOnDemoData(nodes, quotes, cues, cards);

    if (isEmpty || isDemo || !visited) {
      setTimeout(() => {
        toast("Tap your profile card (bottom) for data options — import demo data or delete everything.", {
          sticky: true,
          action: {
            label: "Open",
            onClick: () => {
              setProfileDropdown(true);
            }
          }
        });
      }, 1400);
    }
  } catch (e) { /* ignore */ }
});
