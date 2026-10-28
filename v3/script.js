import { initDB, addNode, addNodes, getAllNodes, getNode, deleteNode, addQuote, addQuotes, getAllQuotes, getQuote, deleteQuote, clearNodes, clearQuotes, clearCues, addCues, getQuotesForSubject, getAnalysisNodesForSubject, getDueQuotesForSubject, getDueAnalysisNodesForSubject, getQuotesReferencedByAnalysis, getAnalysesReferencingQuote, getPinnedTools, pinTool, unpinTool, isToolPinned, setPinnedToolsOrder, getSubjects, addSubject, deleteSubject, renameSubject, addCue, getAllCues, getCue, deleteCue, getCuesForQuote, getCuesForAnalysis, getCuesForSubject, updateCueLinks } from "./db.js";
import { syncLocalWithCloud, syncToCloud, deleteCloudNode, deleteCloudQuote, deleteCloudCue, fetchCloudNodes, fetchCloudQuotes, fetchCloudCues } from "./sync.js";
import { initAnalysisToolV2 } from "./tools/analysisTool.js";
import { initMemoryTool } from "./tools/memoryTool.js";
import { initMindmapTool } from "./tools/mindmapTool.js";

const BACKEND = "https://showcase.invalid";
let DB_READY = false;
const DEFAULT_PROFILE = {
  name: "Offline Mode",
  email: "local@device",
  picture: "https://via.placeholder.com/40"
};

let syncInProgress = false;
let subjectEditMode = false;

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
      addNode,
      addQuote,
      addCue,
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
      isSourceNode
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
      getQuotesForSubject,
      getAnalysisNodesForSubject,
      getDueQuotesForSubject,
      getDueAnalysisNodesForSubject,
      getQuotesReferencedByAnalysis,
      getAnalysesReferencingQuote,
      getCuesForQuote,
      getNode,
      getNodeTimestamp,
      getSubjects,
      escapeHtml
    }, context)
  },

  mindmap: {
    file: "mindmap.html",
    init: (context) => initMindmapTool({
      getAllNodes,
      getAllQuotes,
      addNode,
      addQuote,
      deleteNode,
      deleteQuote,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      escapeHtml
    }, context)
  },
  tracker: {
    name: "Tracker",
    file: "tracker.html",
    init: null
  }
};

const toolDefinitions = {
  analysis: { name: "Analysis", file: "analysis.html", icon: "A", desc: "Create source-linked analysis nodes and analyse a source text" },
  memory: { name: "Memory", file: "memory.html", icon: "M", desc: "Flashcard study across subjects to memorise nodes you analyse" },
  mindmap: { name: "Mindmap", file: "mindmap.html", icon: "N", desc: "Visual database overview for establishing connections" },
  tracker: { name: "Tracker", file: "tracker.html", icon: "T", desc: "Track study progress with past paper data" }
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
  if (!window.currentUser || syncInProgress) return;
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
  if (!window.currentUser || syncInProgress) return;
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
  window.location.href = `${BACKEND}/auth/google`;
}

function setActiveTool(toolName) {
  const wrappers = document.querySelectorAll(".tool-btn-wrapper");
  wrappers.forEach(w => w.classList.remove("active"));
  const activeWrapper = document.querySelector(`.tool-btn-wrapper[data-tool="${toolName}"]`);
  if (activeWrapper) activeWrapper.classList.add("active");
}

async function loadTool(toolName, context = {}) {
  if (currentToolName === "analysis" && toolName !== "analysis") {
    if (typeof window.__neuronetAnalysisCleanup === "function") {
      window.__neuronetAnalysisCleanup();
    }
  }

  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);

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

  if (!window.currentUser) return;

  try {
    await deleteCloudNode(id);
  } catch (error) {
    console.log("Cloud delete skipped", error);
  }
}

async function removeQuoteEverywhere(id) {
  await deleteQuoteCascadeLocal(id);
  await deleteQuote(id);

  if (!window.currentUser) return;

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
    if (window.currentUser) {
      try { await deleteCloudNode(node.id); } catch (error) { console.log("Cloud delete skipped", error); }
    }
  }

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

  if (!window.currentUser) return;

  try {
    await deleteCloudCue(id);
  } catch (error) {
    console.log("Cloud cue delete skipped", error);
  }
}

async function exportDatabaseJson() {
  const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
  const payload = {
    schemaVersion: 5,
    exportedAt: new Date().toISOString(),
    nodes,
    quotes,
    cues
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
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const cues = Array.isArray(payload?.cues) ? payload.cues : [];

  await clearNodes();
  await clearQuotes();
  await clearCues();
  await addNodes(nodes);
  await addQuotes(quotes);
  await addCues(cues);

  if (window.currentUser) {
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

  if (currentToolName) {
    await loadTool(currentToolName);
  }
}

// ========== LAUNCHPAD FUNCTIONS ==========

function showLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;
  
  // Animate tool container out if it exists
  if (tc) {
    tc.classList.add("exiting");
    setTimeout(() => {
      tc.style.display = "none";
      tc.classList.remove("exiting");
    }, 350);
  }
  
  // Animate launchpad in
  launchpad.style.display = "flex";
  launchpad.classList.add("entering");
  void launchpad.offsetWidth; // force reflow
  launchpad.classList.remove("entering");
  launchpad.classList.add("entered");
}

function hideLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;
  
  // Animate launchpad out
  launchpad.classList.add("exiting");
  launchpad.classList.remove("entered");
  setTimeout(() => {
    launchpad.style.display = "none";
    launchpad.classList.remove("exiting");
  }, 350);
  
  // Show tool container
  if (tc) {
    tc.style.display = "block";
    tc.classList.add("entering");
    void tc.offsetWidth;
    tc.classList.remove("entering");
    tc.classList.add("entered");
  }
}

function openTool(toolName, context = {}) {
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

async function updateGlobalStats() {
  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);

  const subjects = new Set();
  const sources = [];
  const analyses = [];

  allNodes.forEach(node => {
    if (node.subject) subjects.add(node.subject);
    if (node.type === "source" || node.meta?.kind === "source") sources.push(node);
    if (node.type === "analysis") analyses.push(node);
  });

  document.getElementById("statSubjects").textContent = subjects.size;
  document.getElementById("statSources").textContent = sources.length;
  document.getElementById("statQuotes").textContent = allQuotes.length;
  document.getElementById("statAnalyses").textContent = analyses.length;
}

async function renderSubjectList() {
  const subjectList = document.getElementById("subjectList");
  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);

  const subjectData = {};
  allNodes.forEach(node => {
    if (node.subject) {
      if (!subjectData[node.subject]) {
        subjectData[node.subject] = { sources: 0, analyses: 0 };
      }
      if (node.type === "source" || node.meta?.kind === "source") {
        subjectData[node.subject].sources++;
      }
      if (node.type === "analysis") {
        subjectData[node.subject].analyses++;
      }
    }
  });
  allQuotes.forEach(quote => {
    if (quote.subject && subjectData[quote.subject]) {
      subjectData[quote.subject].quotes = (subjectData[quote.subject].quotes || 0) + 1;
    }
  });

  const subjects = Object.keys(subjectData).sort();

  if (subjects.length === 0) {
    subjectList.innerHTML = '<p class="empty-note">No subjects yet. Create one to get started.</p>';
    return;
  }

  subjectList.innerHTML = subjects.map(subject => `
    <article class="subject-card" data-subject="${escapeHtml(subject)}">
      <span class="subject-name">${escapeHtml(subject)}</span>
      <div class="subject-actions" ${subjectEditMode ? "" : "hidden"} data-subject="${escapeHtml(subject)}">
        <button type="button" data-action="rename-subject" data-subject="${escapeHtml(subject)}">Rename</button>
        <button type="button" data-action="delete-subject" data-subject="${escapeHtml(subject)}">Delete</button>
      </div>
    </article>
  `).join("");

  subjectList.querySelectorAll(".subject-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".subject-actions")) return;
      if (card.dataset.subject) {
        enterSubjectWorkspace(card.dataset.subject);
      }
    });
  });

  subjectList.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const action = e.target.dataset.action;
      const subject = e.target.dataset.subject;
      if (!action || !subject) return;

      if (action === "rename-subject") {
        const updated = window.prompt(`Rename subject "${subject}" to:`, subject);
        const next = (updated || "").trim();
        if (!next || next === subject) return;
        await renameSubject(subject, next);
      } else if (action === "delete-subject") {
        if (!confirm(`Delete subject "${subject}" and all its content?`)) return;
        await deleteSubject(subject);
      }
      await updateGlobalStats();
      await renderSubjectList();
    });
  });
}

async function addSubjectFromInput() {
  const input = document.getElementById("newSubjectName");
  const name = input.value.trim();
  if (!name) return;

  await addSubject(name);
  input.value = "";
  await renderSubjectList();
  await updateGlobalStats();
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  if (addSubjectBtn) addSubjectBtn.disabled = true;
}

async function initLaunchpad() {
  await updateGlobalStats();
  await renderSubjectList();
  await renderToolCatalogue();

  const addSubjectBtn = document.getElementById("addSubjectBtn");
  const newSubjectInput = document.getElementById("newSubjectName");
  const toggleSubjectEdit = document.getElementById("toggleSubjectEdit");

  async function updateSubjectCreateState() {
    if (!newSubjectInput || !addSubjectBtn) return;
    const subject = (newSubjectInput.value || "").trim();
    const existingSubjects = await getSubjects();
    const disabled = !subject || existingSubjects.includes(subject);
    addSubjectBtn.disabled = disabled;
  }

  if (addSubjectBtn) {
    addSubjectBtn.addEventListener("click", addSubjectFromInput);
  }
  if (newSubjectInput) {
    newSubjectInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") addSubjectFromInput();
    });
    newSubjectInput.addEventListener("input", updateSubjectCreateState);
    await updateSubjectCreateState();
  }
  async function refreshSubjectAddState() {
    await updateSubjectCreateState();
  }
  window.refreshSubjectAddState = refreshSubjectAddState;
  const toggleBtn = document.getElementById("toggleSubjectEdit");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      subjectEditMode = !subjectEditMode;
      toggleBtn.textContent = subjectEditMode ? "Done" : "Edit";
      
      const actions = document.querySelectorAll(".subject-actions");
      actions.forEach(el => {
        el.hidden = !subjectEditMode;
      });
    });
  }
}

async function enterSubjectWorkspace(subject) {
  currentSubject = subject;
  hideLaunchpad();
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

  container.innerHTML = pinnedTools.map((pinned, index) => {
    const def = toolDefinitions[pinned.toolId];
    if (!def) return "";
    const isActive = currentToolName === pinned.toolId ? "active" : "";
    return `
      <div class="tool-btn-wrapper entering ${isActive}" data-tool="${pinned.toolId}">
        <button class="tool-btn" data-tool="${pinned.toolId}">${def.icon} ${def.name}</button>
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
  await renderToolCatalogue();
}

// ========== TOOL CATALOGUE ==========

async function renderToolCatalogue() {
  const grid = document.getElementById("toolCardsGrid");
  if (!grid) return;

  const pinnedTools = await getPinnedTools();
  const pinnedIds = new Set(pinnedTools.map(t => t.toolId));

  grid.innerHTML = Object.entries(toolDefinitions).map(([toolId, def]) => {
    const isPinned = pinnedIds.has(toolId);
    const actionText = isPinned ? "Unpin" : "Pin";
    return `
      <div class="tool-card" data-tool="${toolId}">
        <div class="tool-card-actions">
          <button class="tool-card-action-btn" data-action="${isPinned ? 'unpin' : 'pin'}" data-tool="${toolId}">${actionText}</button>
        </div>
        <div class="tool-card-icon">${def.icon}</div>
        <div class="tool-card-title">${def.name}</div>
        <div class="tool-card-desc">${def.desc}</div>
      </div>
    `;
  }).join("");

  const cards = grid.querySelectorAll(".tool-card");
  cards.forEach((card) => {
    card.style.opacity = "1";
    card.style.transform = "translateY(0) scale(1)";
  });

  grid.querySelectorAll(".tool-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".tool-card-actions")) return;
      const toolName = card.dataset.tool;
      hideLaunchpad();
      loadTool(toolName, {});
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      grid.querySelectorAll(".tool-card.show-actions").forEach(el => {
        if (el !== card) el.classList.remove("show-actions");
      });
      card.classList.toggle("show-actions");
    });
  });

  document.addEventListener("click", () => {
    grid.querySelectorAll(".tool-card.show-actions").forEach(el => {
      el.classList.remove("show-actions");
    });
  });

  grid.querySelectorAll(".tool-card-action-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const toolId = btn.dataset.tool;

      if (action === "unpin") {
        showUnpinModal(toolId);
      } else if (action === "pin") {
        await pinTool(toolId);
        await renderPinnedToolsSidebar();
        await renderToolCatalogue();
      }
    });
  });
}

// ========== EVENT LISTENERS ==========
document.addEventListener("DOMContentLoaded", async () => {
  toolContainer = document.getElementById("toolContainer");
  setProfileUI(null);

  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const loadingCheckmark = document.getElementById("loadingCheckmark");
  const appElement = document.getElementById("app");

  // Origin validation
  const ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "https://aigsniperyt.github.io"
  ];
  const currentOrigin = window.location.origin;
  const isAllowed = ALLOWED_ORIGINS.some(origin => currentOrigin.startsWith(origin));

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

  loadingMessage.textContent = "Authenticating with the cloud...";
  let user;
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

  loadingOverlay.classList.add("completed");
  loadingOverlay.style.display = "none";

  if (canvas) {
    canvas.style.filter = "brightness(0.85) contrast(1.15)";
  }

  const sidebarElDone = document.getElementById("sidebar");
  sidebarElDone?.classList.remove("entering");
  sidebarElDone?.classList.add("entered");
  if (launchpadEl) {
    launchpadEl.classList.remove("entering");
    launchpadEl.classList.add("entered");
  }

  const toolCards = document.querySelectorAll(".tool-card.entering");
  toolCards.forEach((card, i) => {
    setTimeout(() => {
      card.classList.remove("entering");
      card.classList.add("entered");
    }, 50 + i * 50);
  });

  const sidebarTools = document.querySelectorAll(".tool-btn-wrapper.entering");
  sidebarTools.forEach((tool, i) => {
    setTimeout(() => {
      tool.classList.remove("entering");
      tool.classList.add("entered");
    }, 50 + i * 40);
  });

  window.addEventListener("neuronet-open-tool", (e) => {
    const { tool, nodeId, subject } = e.detail || {};
    if (tool) {
      loadTool(tool, { nodeId, subject });
    }
  });

  const profileElem = document.getElementById("sidebarProfile");
  const dropdown = document.getElementById("dropdown");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const importJsonBtn = document.getElementById("importJsonBtn");
  const importJsonInput = document.getElementById("importJsonInput");

  if (profileElem) {
    profileElem.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.style.display =
        dropdown.style.display === "block" ? "none" : "block";
    });
  }

  document.addEventListener("click", () => {
    if (dropdown) dropdown.style.display = "none";
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

      try {
        await fetch(`${BACKEND}/auth/logout`, {
          credentials: "include",
        });
      } catch (error) {
        console.log("Logout request failed, staying offline locally", error);
      }

      window.currentUser = null;
      setProfileUI(null);
      if (dropdown) dropdown.style.display = "none";
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await exportDatabaseJson();
      if (dropdown) dropdown.style.display = "none";
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
      const confirmed = window.confirm("Importing JSON will overwrite your current NeuroNet database. Continue?");
      if (!confirmed) {
        importJsonInput.value = "";
        return;
      }

      try {
        await importDatabaseJson(file);
        if (dropdown) dropdown.style.display = "none";
      } catch (error) {
        console.error("Import failed", error);
        alert("Import failed. Please check the JSON file format.");
      } finally {
        importJsonInput.value = "";
      }
    });
  }
});
