import { initDB, addNode, addNodes, getAllNodes, deleteNode, addQuote, addQuotes, getAllQuotes, getQuote, deleteQuote, clearNodes, clearQuotes } from "./db.js";
import { syncLocalWithCloud, syncToCloud, deleteCloudNode, deleteCloudQuote, fetchCloudNodes, fetchCloudQuotes } from "./sync.js";
import { initAnalysisToolV2 } from "./analysisTool.js";

const BACKEND = "https://showcase.invalid";
const DEV_MODE = false;
let DB_READY = false;
const OFFLINE_MODE = false;
const DEFAULT_PROFILE = {
  name: "Offline Mode",
  email: "local@device",
  picture: "https://via.placeholder.com/40"
};

let syncInProgress = false;

const tools = {
  analysis: {
    file: "analysis.html",
    init: () => initAnalysisToolV2({
      getAllNodes,
      getAllQuotes,
      addNode,
      addQuote,
      getQuote,
      deleteQuote,
      backupLocalNodesToCloud,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      normalizeHierarchyPath,
      buildSection,
      parseTags,
      escapeHtml,
      getNodeTimestamp,
      isSourceNode,
      setAnalysisFocus
    })
  },

  memory: {
    file: "memory.html",
    init: null
  },

  mindmap: {
    file: "mindmap.html",
    init: null
  },

  tracker: {
    file: "tracker.html",
    init: null
  }
};

// ========== CANVAS BACKGROUND ==========
const canvas = document.getElementById("neuronet");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let nodes = [],
  nodeCount = 92,
  maxDist = 150,
  separationStrength = 0.02,
  edgeRepulsionStrength = 0.01,
  edgeBuffer = 50;
const cellSize = maxDist;
let grid = {},
  gridWidth,
  gridHeight;

function resetGrid() {
  grid = {};
  gridWidth = Math.ceil(canvas.width / cellSize);
  gridHeight = Math.ceil(canvas.height / cellSize);
}

function getCellIndex(x, y) {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

class Node {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.vx = (Math.random() - 0.5) * 1.2;
    this.vy = (Math.random() - 0.5) * 1.2;
    this.maxConnections = Math.floor(Math.random() * 3) + 3;
    this.radius = 2 + Math.random() * 2;
  }

  update() {
    let moveX = 0,
      moveY = 0;
    const cellX = Math.floor(this.x / cellSize),
      cellY = Math.floor(this.y / cellSize);
    let nearbyNodes = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) nearbyNodes.push(...grid[key]);
      }
    }

    for (let other of nearbyNodes) {
      if (other === this) continue;
      let dx = other.x - this.x,
        dy = other.y - this.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01 && dist < maxDist) {
        let force = separationStrength * (1 / dist) * (1 - dist / maxDist);
        moveX -= dx * force;
        moveY -= dy * force;
      }
    }

    if (this.x < edgeBuffer)
      moveX += edgeRepulsionStrength * (1 - this.x / edgeBuffer);
    if (this.x > canvas.width - edgeBuffer)
      moveX -=
        edgeRepulsionStrength *
        ((this.x - (canvas.width - edgeBuffer)) / edgeBuffer);
    if (this.y < edgeBuffer)
      moveY += edgeRepulsionStrength * (1 - this.y / edgeBuffer);
    if (this.y > canvas.height - edgeBuffer)
      moveY -=
        edgeRepulsionStrength *
        ((this.y - (canvas.height - edgeBuffer)) / edgeBuffer);

    const mouseForceRadius = 50,
      mouseRepelStrength = 0.5;
    if (mouse.x !== undefined && mouse.y !== undefined) {
      let dx = this.x - mouse.x,
        dy = this.y - mouse.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouseForceRadius && dist > 0.01) {
        let force = mouseRepelStrength * (1 - dist / mouseForceRadius);
        moveX += (dx / dist) * force;
        moveY += (dy / dist) * force;
      }
    }

    const randomDrift = 0.02;
    this.vx += moveX + (Math.random() - 0.5) * randomDrift;
    this.vy += moveY + (Math.random() - 0.5) * randomDrift;

    const maxSpeed = 0.6;
    let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }

    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0) {
      this.x = 0;
      this.vx *= -1;
    }
    if (this.x > canvas.width) {
      this.x = canvas.width;
      this.vx *= -1;
    }
    if (this.y < 0) {
      this.y = 0;
      this.vy *= -1;
    }
    if (this.y > canvas.height) {
      this.y = canvas.height;
      this.vy *= -1;
    }
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#9fffd6";
    ctx.fill();
  }
}

function buildGrid() {
  resetGrid();
  for (const node of nodes) {
    const key = getCellIndex(node.x, node.y);
    if (!grid[key]) grid[key] = [];
    grid[key].push(node);
  }
}

function connectNodes() {
  buildGrid();
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cellX = Math.floor(a.x / cellSize),
      cellY = Math.floor(a.y / cellSize);
    let candidates = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) candidates.push(...grid[key]);
      }
    }

    candidates = candidates
      .filter((n) => n !== a)
      .map((b) => {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dist = Math.sqrt(dx * dx + dy * dy);
        return { node: b, dist };
      });

    let neighbors = candidates.filter((c) => c.dist < maxDist);
    let farNeighbors = candidates.filter(
      (c) => c.dist >= maxDist && c.dist < maxDist * 2
    );

    neighbors.sort((n1, n2) => n1.dist - n2.dist);
    farNeighbors.sort((n1, n2) => n1.dist - n2.dist);

    neighbors = neighbors.slice(0, a.maxConnections);
    if (farNeighbors.length > 0) neighbors.push(farNeighbors[0]);

    for (let { node: b, dist } of neighbors) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(31,209,138,${0.5 * (1 - dist / maxDist)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  nodes.forEach((n) => {
    n.update();
    n.draw();
  });
  connectNodes();
  requestAnimationFrame(animate);
}

function initCanvas() {
  nodes = [];
  resetGrid();
  for (let i = 0; i < nodeCount; i++) nodes.push(new Node());
  animate();
}

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initCanvas();
});

const mouse = {};
canvas.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mouseleave", () => {
  delete mouse.x;
  delete mouse.y;
});

// ========== AUTH & API ==========
function setProfileUI(user) {
  const pfp = document.getElementById("userPfp");
  const userName = document.getElementById("userName");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const activeUser = user || DEFAULT_PROFILE;

  if (pfp) pfp.src = activeUser.picture || DEFAULT_PROFILE.picture;
  if (userName) {
    userName.textContent = user
      ? user.name || user.email || "User"
      : DEFAULT_PROFILE.name;
  }

  if (authActionBtn) authActionBtn.style.display = user ? "none" : "block";
  if (logoutBtn) logoutBtn.style.display = user ? "block" : "none";
}

async function fetchUser() {
  try {
    const res = await fetch(`${BACKEND}/auth/user`, {
      credentials: "include",
    });

    if (!res.ok) throw new Error("Not logged in");

    const user = await res.json();
    console.log("Fetched user:", user);

    window.currentUser = user;
    setProfileUI(user);
    return user;
  } catch (error) {
    console.log("Running in offline mode until user logs in", error);
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
    console.log("Local IndexedDB and cloud backup are in sync");
  } catch (error) {
    console.log("Cloud merge failed, continuing with local IndexedDB only", error);
  } finally {
    syncInProgress = false;
  }
}

function startGoogleLogin() {
  window.location.href = `${BACKEND}/auth/google`;
}

// ========== TOOL SWITCHING SYSTEM ==========
const toolContainer = document.getElementById("toolContainer");
const toolButtons = document.querySelectorAll(".tool-btn");
let currentToolName = "";
let analysisFocusEnabled = false;

function setActiveTool(activeBtn) {
  toolButtons.forEach(btn => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

function setAnalysisFocus(enabled) {
  analysisFocusEnabled = Boolean(enabled);
  const focusBtn = document.getElementById("focusToggleBtn");
  const canFocus = typeof window.__neuronetCanFocus === "function" && window.__neuronetCanFocus();
  const active = currentToolName === "analysis" && canFocus && analysisFocusEnabled;
  document.body.classList.toggle("analysis-focus-mode", active);

  if (focusBtn) {
    const visible = currentToolName === "analysis";
    focusBtn.style.display = visible ? "block" : "none";
    focusBtn.textContent = analysisFocusEnabled ? "Exit Focus" : "Enter Focus";
  }
}

function setAnalysisToolActive(active) {
  document.body.classList.toggle("analysis-tool-active", Boolean(active));
  if (!active) {
    setAnalysisFocus(false);
  } else {
    setAnalysisFocus(analysisFocusEnabled);
  }
}

async function loadTool(toolName) {
  if (currentToolName === "analysis" && toolName !== "analysis") {
    if (typeof window.__neuronetAnalysisCleanup === "function") {
      window.__neuronetAnalysisCleanup();
    }
  }

  currentToolName = toolName;
  setAnalysisToolActive(toolName === "analysis");

  const tool = tools[toolName];
  const res = await fetch(`./tools/${tool.file}`);
  toolContainer.innerHTML = await res.text();

  if (tool.init) setTimeout(tool.init, 0);
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
  await deleteNode(id);

  if (!window.currentUser) return;

  try {
    await deleteCloudNode(id);
  } catch (error) {
    console.log("Cloud delete skipped", error);
  }
}

async function removeQuoteEverywhere(id) {
  await deleteQuote(id);

  if (!window.currentUser) return;

  try {
    await deleteCloudQuote(id);
  } catch (error) {
    console.log("Cloud quote delete skipped", error);
  }
}

async function exportDatabaseJson() {
  const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
  const payload = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    nodes,
    quotes
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

  await clearNodes();
  await clearQuotes();
  await addNodes(nodes);
  await addQuotes(quotes);

  if (window.currentUser) {
    const [cloudNodes, cloudQuotes] = await Promise.all([fetchCloudNodes(), fetchCloudQuotes()]);
    await Promise.all([
      ...cloudNodes.map((node) => deleteCloudNode(node.id)),
      ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id))
    ]);
    await syncToCloud(nodes, quotes);
  }

  if (currentToolName) {
    await loadTool(currentToolName);
  }
}

// ========== EVENT LISTENERS ==========
document.addEventListener("DOMContentLoaded", async () => {
  initCanvas();
  setProfileUI(null);

  await initDB();
  DB_READY = true;
  console.log("IndexedDB ready", { DB_READY, OFFLINE_MODE, DEV_MODE });

  const user = await fetchUser();
  if (user) {
    await syncAfterLogin();
  }

  const profileElem = document.getElementById("sidebarProfile");
  const dropdown = document.getElementById("dropdown");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const focusToggleBtn = document.getElementById("focusToggleBtn");
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

  if (focusToggleBtn) {
    focusToggleBtn.addEventListener("click", () => {
      if (currentToolName !== "analysis") return;
      if (typeof window.__neuronetCanFocus === "function" && !window.__neuronetCanFocus()) return;
      setAnalysisFocus(!analysisFocusEnabled);
    });
  }

  toolButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      setActiveTool(btn);
      loadTool(btn.dataset.tool);
    });
  });

  const defaultToolButton =
    document.querySelector(".tool-btn.active") || toolButtons[0];

  if (defaultToolButton) {
    setActiveTool(defaultToolButton);
    await loadTool(defaultToolButton.dataset.tool);
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
