import { dialog } from "./dialog.js";
import { parse, render as renderMarkdown, domToMarkdown, renderMathWithKatex } from "../vendor/md-format/mdeditor.js";
export async function initMindmapTool(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    getAllCues,
    getAllCards,
    getAllTags,
    addNode,
    addQuote,
    addCue,
    addTag,
    deleteNode,
    deleteQuote,
    deleteCue,
    deleteCard,
    deleteTag,
    addHeap,
    getAllHeaps,
    getHeap,
    deleteHeap,
    removeNodeEverywhere,
    removeQuoteEverywhere,
    removeCueEverywhere,
    linkAnalysisToQuote,
    unlinkAnalysisFromQuote,
    escapeHtml
  } = deps;

  const { subject: contextSubject, heapId: contextHeapId, view: contextView } = context;
  // The shell always passes a `subject` key when a tool is opened from the
  // launchpad or sidebar, including an explicit null for "All subjects".
  // That explicit scope must beat the last subject saved by this tool,
  // otherwise clicking the NeuroNet home button and reopening the mindmap
  // silently restores the old single-subject focus while the shell says All.
  const hasSubjectContext = Object.prototype.hasOwnProperty.call(context, "subject");

  if (typeof window.__neuronetMindmapCleanup === "function") {
    window.__neuronetMindmapCleanup();
  }

const state = {
    hoveredNodeId: null,
    nodePositions: new Map(),
    velocities: new Map(),
    graph: { nodes: new Map(), edges: [] },
    draggingNodeId: null,
    dragOffset: { x: 0, y: 0 },
    // Session-only physics hold. Restored layouts and freshly dropped nodes
    // live here so the force simulation cannot drift them. It is deliberately
    // invisible: a restored layout is not the same thing as an explicit lock.
    pinnedNodes: new Set(),
    // Explicit user locks. These survive reloads and Re-layout, and are the
    // only nodes that get the solid "secured" treatment on the canvas.
    lockedNodes: new Set(),
    // 0..1 fill/ring transitions and short-lived crystal feedback, keyed by
    // node id. Both are visual only and never serialized.
    lockVisuals: new Map(),
    lockParticles: [],
    lockRings: [],
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    isPanning: false,
    panStartPos: { x: 0, y: 0 },
    panLastPos: { x: 0, y: 0 },
    simulationRunning: true,
    viewMode: contextView === "grid" || contextHeapId ? "grid" : "graph",
    sidebarView: "content",
    inspectorTab: "details",
    selectedNodeId: null,
    layerNodes: [],
    userInteracted: false,
    hasDragged: false,
    isConnecting: false,
    connectingSourceId: null,
    // Subject scope. `null` is the global view; a string focuses one subject
    // and fades every other subject out of the canvas.
    focusSubject: String(contextSubject || "").trim() || null,
    focusSubjectId: null,
    scopeNodeIds: new Set(),
    nodeVisibility: new Map(),
    cards: [],
    librarySearch: "",
    librarySort: "deck",
    librarySelectMode: false,
    selectedCardIds: new Set(),
    collapsedDecks: new Set(),
    graphSearch: "",
    graphTypeFilter: "all",
    // When true, tapping a node toggles its lock instead of opening the
    // inspector. This is the fast path for locking several nodes on touch.
    lockMode: false,
    // Named, ordered card-ID lists. Heap content lives in the cards store;
    // these records are metadata only.
    heaps: [],
    activeHeapId: String(contextHeapId || "").trim() || null,
    heapSidebarOpen: Boolean(contextHeapId),
    // One scene object per card for the whole tool session. The object is also
    // the card's entry in `nodePositions`, so `x/y` is the single canonical
    // position shared by Graph, Dots, hit-testing, dragging, and transitions.
    cardScene: new Map(),
    // Dots geometry only (sections + cached slot indices). Card positions are
    // never duplicated into a second graph/dot map.
    dotsLayout: null,
    sceneTransition: null
  };

  const physicsConfig = {
    repulsion: 80,
    repulsionRange: 180,
    attraction: 0.002,
    damping: 0.94,
    minVelocity: 0.02,
    maxVelocity: 2,
    maxGlobalSpread: 450,
    radialStrength: 0.02
  };

  const ringConfig = {
    subject: 0,
    layer: 70,
    source: 150,
    quote: 250,
    analysis: 350
  };

  const canvas = document.getElementById("mindmapCanvas");
  const ctx = canvas?.getContext("2d");
  const graphToolbar = document.getElementById("graphToolbar");
  const graphSearchInput = document.getElementById("graphSearch");
  const graphFitBtn = document.getElementById("graphFitBtn");
  const lockModeBtn = document.getElementById("lockModeBtn");
  const graphStatus = document.getElementById("graphStatus");
  const blueprintArea = document.getElementById("blueprintArea");
  const gridView = document.getElementById("mindmapGridView");
  const gridContainer = document.getElementById("mindmapGrid");
  const dotsLegend = document.getElementById("mindmapDotsLegend");
  const viewToggle = document.getElementById("mindmapViewToggle");
  const relayoutGraphBtn = document.getElementById("relayoutGraphBtn");
  const connectNodesBtn = document.getElementById("connectNodesBtn");
  const newNodeDropdown = document.getElementById("newNodeDropdown");
  const libraryHeapBar = document.getElementById("libraryHeapBar");
  const librarySearchInput = document.getElementById("librarySearch");
  const librarySortSelect = document.getElementById("librarySort");
  const librarySelectToggle = document.getElementById("librarySelectToggle");
  const libraryAddSelectedBtn = document.getElementById("libraryAddSelectedBtn");
  const libraryHeapSelect = document.getElementById("libraryHeapSelect");
  const libraryHeapStatus = document.getElementById("libraryHeapStatus");
  const newHeapBtn = document.getElementById("newHeapBtn");
  const toggleHeapSidebarBtn = document.getElementById("toggleHeapSidebarBtn");
  const libraryHeapSidebarName = document.getElementById("libraryHeapSidebarName");
  const libraryHeapSidebarMeta = document.getElementById("libraryHeapSidebarMeta");
  const libraryHeapItems = document.getElementById("libraryHeapItems");
  const heapSidebarStudyBtn = document.getElementById("heapSidebarStudyBtn");
  const deleteHeapBtn = document.getElementById("deleteHeapBtn");
  const emptyState = document.getElementById("emptyState");
  const nodeSidebar = document.getElementById("nodeSidebar");
  const nodeSidebarBackdrop = document.getElementById("nodeSidebarBackdrop");
  const sidebarTitle = document.getElementById("sidebarTitle");
  const sidebarType = document.getElementById("sidebarType");
  const sidebarContentLabel = document.getElementById("sidebarContentLabel");
  const fullContent = document.getElementById("fullContent");
  const metaContent = document.getElementById("metaContent");
  const deleteNodeBtn = document.getElementById("deleteNodeBtn");
  const editNodeBtn = document.getElementById("editNodeBtn");
  const sidebarClose = document.getElementById("sidebarClose");
  const toggleMetadataBtn = document.getElementById("toggleMetadataBtn");

  // The tap that opens the tool can produce a delayed synthetic click on the
  // freshly rendered canvas (notably in iPad standalone/Safari). Ignore canvas
  // selections for a moment so Mindmap always starts on the graph, not on a
  // node detail panel.
  let ignoreCanvasClicksUntil = 0;
  let headerResizeObserver = null;
  let inspectorReturnFocus = null;

  // Persist the user's arrangement locally. The key is scoped to the signed-in
  // account (or the local database when signed out) so two people sharing a
  // browser do not inherit each other's camera and node positions.
  const LAYOUT_STORAGE_PREFIX = "nn-mindmap-layout-v1";
  let layoutSaveTimer = 0;
  let layoutDirty = false;
  let positionsStable = false;

  function layoutStorageKey() {
    const owner = window.currentUser?.id || window.currentUser?.email || "local";
    return `${LAYOUT_STORAGE_PREFIX}:${owner}`;
  }

  function readPersistedLayout() {
    try {
      const raw = localStorage.getItem(layoutStorageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function applyPersistedLayout(saved) {
    if (!saved) return false;

    if (saved.positions && typeof saved.positions === "object") {
      Object.entries(saved.positions).forEach(([id, point]) => {
        const x = Array.isArray(point) ? Number(point[0]) : Number(point?.x);
        const y = Array.isArray(point) ? Number(point[1]) : Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        state.nodePositions.set(id, { x, y });
      });
      if (state.nodePositions.size > 0) {
        positionsStable = true;
        // A restored arrangement is deliberate. Pin those nodes so the force
        // simulation cannot slowly drift the saved layout away from the user's
        // chosen positions. These are session pins, not visible user locks:
        // Re-layout clears them and explodes afresh.
        state.nodePositions.forEach((_, id) => state.pinnedNodes.add(id));
      }
    }

    if (Array.isArray(saved.locks)) {
      saved.locks.forEach((id) => {
        if (typeof id !== "string" || !id) return;
        state.lockedNodes.add(id);
        state.pinnedNodes.add(id);
        state.lockVisuals.set(id, { level: 1, target: 1 });
      });
    }

    const camera = saved.camera;
    if (camera && Number.isFinite(Number(camera.zoom))) {
      state.zoom = Math.min(3, Math.max(0.25, Number(camera.zoom)));
      state.panOffset = {
        x: Number(camera.x) || 0,
        y: Number(camera.y) || 0
      };
      // A restored camera is an explicit view choice. Do not let auto-fit
      // immediately override it on load.
      state.userInteracted = true;
    }

    const hasViewContext = contextView === "grid" || Boolean(contextHeapId);
    if (!hasViewContext && ["graph", "dots", "grid"].includes(saved.viewMode)) {
      state.viewMode = saved.viewMode;
    }

    const validFilters = ["all", "subject", "layer", "source", "quote", "analysis", "pastpaper", "cue", "tag", "card"];
    if (validFilters.includes(saved.graphTypeFilter)) {
      state.graphTypeFilter = saved.graphTypeFilter;
    }

    if (!hasSubjectContext && typeof saved.focusSubject === "string" && saved.focusSubject.trim()) {
      state.focusSubject = saved.focusSubject.trim();
    }

    return true;
  }

  function serializeLayout() {
    const positions = {};
    state.nodePositions.forEach((point, id) => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      positions[id] = [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10];
    });

    return {
      version: 2,
      // Only persist an arrangement once it has settled (or the user has
      // arranged it), never the first frames of an explosion. Locks follow
      // the same rule: a lock without its position is meaningless.
      positions: positionsStable ? positions : null,
      locks: positionsStable ? Array.from(state.lockedNodes) : [],
      camera: state.userInteracted
        ? { zoom: Math.round(state.zoom * 1000) / 1000, x: state.panOffset.x, y: state.panOffset.y }
        : null,
      viewMode: state.viewMode,
      graphTypeFilter: state.graphTypeFilter,
      focusSubject: state.focusSubject || null
    };
  }

  function saveLayoutNow() {
    if (layoutSaveTimer) {
      clearTimeout(layoutSaveTimer);
      layoutSaveTimer = 0;
    }
    if (state.nodePositions.size === 0) return;
    // Never replace a good saved arrangement with a half-formed explosion.
    // pagehide can fire while Re-layout is still settling; in that case the
    // previous record (including its locks) is the safer thing to keep.
    if (!positionsStable) return;
    try {
      localStorage.setItem(layoutStorageKey(), JSON.stringify(serializeLayout()));
      layoutDirty = false;
    } catch (_) {
      // Private mode / quota failures must never break the graph.
    }
  }

  function scheduleLayoutSave(delay = 700) {
    layoutDirty = true;
    if (layoutSaveTimer) return;
    layoutSaveTimer = setTimeout(() => {
      layoutSaveTimer = 0;
      saveLayoutNow();
    }, delay);
  }

  let layoutSettleTimer = 0;
  let graphStatusTimer = 0;
  function setGraphStatus(text, tone = "neutral", { sticky = false } = {}) {
    if (!graphStatus) return;
    if (graphStatusTimer) {
      clearTimeout(graphStatusTimer);
      graphStatusTimer = 0;
    }
    graphStatus.textContent = text || "";
    graphStatus.dataset.tone = tone;
    if (!text || sticky) return;
    graphStatusTimer = setTimeout(() => {
      graphStatusTimer = 0;
      graphStatus.textContent = "";
      delete graphStatus.dataset.tone;
    }, 2400);
  }

  function markLayoutUnstable(delay = 3500) {
    positionsStable = false;
    if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
    layoutSettleTimer = setTimeout(() => {
      layoutSettleTimer = 0;
      positionsStable = true;
      scheduleLayoutSave(200);
    }, delay);
  }

  const config = {
    nodeRadius: 8,
    nodeHoverRadius: 12,
    labelOffset: 18,
    minZoom: 0.25,
    maxZoom: 3,
    labelZoomThresholds: {
      "subject": 0.2,
      "layer 1": 0.35,
      "layer 2": 0.45,
      "layer 3": 0.55,
      "source": 0.65,
      "tag": 0.5, // tag grouping is for many quotes with same tag, so show earlier
      "quote": 0.9,
      "analysis": 0.9,
      "cue": 1.0,
      "pastpaper": 0.65,
      "card": 0.9
    },
    colors: {
      subject: "#ff6b6b",
      "layer 1": "#b992fc",
      "layer 2": "#9560ff",
      "layer 3": "#7539dd",
      source: "#4da6ff",
      quote: "#ff9b39",
      analysis: "#2cffb3",
      cue: "#ff79c6",
      tag: "#f1fa8c",
      pastpaper: "#ffd166",
      // Cards are the only node type without a knowledge role, so they get
      // the one hue the knowledge palette does not already use: cyan. It stays
      // distinct from source blue and analysis green on the dark canvas.
      card: "#22d3ee"
    }
  };

  const GRID_IMPORTANCE_COLORS = {
    1: "#9aa4ad",
    2: "#4ba3ff",
    3: "#3fd07d",
    4: "#ff9b39",
    5: "#ff4d4d"
  };
  // Dots are cards first. Both halves of a dot use the same five-step score
  // scale so recall and accuracy stay directly comparable. These are solid
  // fills, not tints or bars: the eye can rank a dot at a glance.
  const DOT_SCORE_BINS = [
    { min: 0, max: 0.2, color: "#ff4d4d", label: "0–20%" },
    { min: 0.2, max: 0.4, color: "#ff8a3d", label: "20–40%" },
    { min: 0.4, max: 0.6, color: "#ffa500", label: "40–60%" },
    { min: 0.6, max: 0.8, color: "#a8d95f", label: "60–80%" },
    { min: 0.8, max: 1, color: "#3fd07d", label: "80–100%" }
  ].map((bin) => ({ ...bin, rgb: hexToRgb(bin.color) }));
  const DOT_UNKNOWN_COLOR = "#33443d";
  const GRADE_SCORES = { easy: 1, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };
  const RECALL_GRADE_SCORES = { easy: 0.9, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };
  const DOT_MIN_CELL = 6;
  const DOT_MAX_CELL = 40;
  // One global duration, one global t. Cards do not stagger: the transition
  // reads as a single surface changing shape, not a sequence of pop-ins.
  const DOT_MORPH_MS = 680;
  const CARD_COLOR_RGB = hexToRgb(config.colors.card);
  const CARD_UNKNOWN_RGB = hexToRgb(DOT_UNKNOWN_COLOR);
  // Graph nodes are hollow. Cards start with the same dark fill as every
  // other node and only fill with score colour once Dots takes over.
  const CARD_GRAPH_FILL_RGB = [10, 30, 22];

  function hexToRgb(hex) {
    const value = String(hex || "").replace("#", "").trim();
    if (value.length === 3) {
      return [
        parseInt(value[0] + value[0], 16),
        parseInt(value[1] + value[1], 16),
        parseInt(value[2] + value[2], 16)
      ];
    }
    if (value.length !== 6) return [154, 164, 173];
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16)
    ];
  }

  function mixRgb(from, to, t) {
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t
    ];
  }

  function rgbCss(rgb) {
    return `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`;
  }

  function clamp01Number(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function smoothstep(value) {
    const t = clamp01Number(value);
    return t * t * (3 - 2 * t);
  }

  function easeInOutCubic(value) {
    const t = clamp01Number(value);
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function makeLayerId(subject, l1 = "", l2 = "", l3 = "") {
    return `layer|${String(subject || "").trim()}|${String(l1 || "").trim()}|${String(l2 || "").trim()}|${String(l3 || "").trim()}`;
  }

  function normalizeSubjectName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getItemSubject(item) {
    if (!item) return "";
    if (item.type === "subject") return item.subject || item.title || "";
    return item.subject || item?.meta?.subject || "";
  }

  function resolveFocusSubject(value) {
    const wanted = normalizeSubjectName(value);
    if (!wanted) return null;

    const items = getAllItems();
    const subjectNode = items.find((item) =>
      item.type === "subject" && normalizeSubjectName(item.subject || item.title) === wanted
    );
    if (subjectNode) return String(subjectNode.subject || subjectNode.title || "").trim();

    const subjectItem = items.find((item) => normalizeSubjectName(getItemSubject(item)) === wanted);
    if (subjectItem) return String(getItemSubject(subjectItem) || "").trim();

    // Dots are card-first, so a deck can be a valid scope even when it has no
    // knowledge-layer subject node. Match either the deck itself or any part
    // of its hierarchy path.
    const card = (state.cards || []).find((entry) => {
      if (normalizeSubjectName(entry?.deck) === wanted) return true;
      return (Array.isArray(entry?.deckPath) ? entry.deckPath : [])
        .some((part) => normalizeSubjectName(part) === wanted);
    });
    if (card) {
      const pathMatch = (Array.isArray(card.deckPath) ? card.deckPath : [])
        .find((part) => normalizeSubjectName(part) === wanted);
      return String(pathMatch || card.deck || value || "").trim() || null;
    }

    return String(value || "").trim() || null;
  }

  function findFocusSubjectNodeId() {
    const wanted = normalizeSubjectName(state.focusSubject);
    if (!wanted) return null;
    const subjectNode = getAllItems().find((item) =>
      item.type === "subject" && normalizeSubjectName(item.subject || item.title) === wanted
    );
    return subjectNode?.id || null;
  }

  function isNodeInScope(id) {
    return !state.focusSubject || state.scopeNodeIds.has(id);
  }

  // Search used to inspect only title/preview fields, so a word in the body of
  // a source or analysis looked like a silent failure. Build a complete,
  // cached haystack per graph node; buildGraph replaces node objects on data
  // changes, so a WeakMap invalidates itself.
  const nodeSearchTextCache = new WeakMap();
  function getNodeSearchText(node) {
    if (nodeSearchTextCache.has(node)) return nodeSearchTextCache.get(node);
    const data = node?.data || {};
    const meta = data.meta || {};
    const values = [
      getNodeDisplayTitle(data),
      getNodePreview(data),
      data.title,
      data.subject,
      data.deck,
      data.section,
      data.text,
      data.quote,
      data.analysis,
      data.cue,
      data.content,
      data.contentText,
      data.front,
      data.back,
      data.year,
      data.series,
      data.examBoard,
      data.paper,
      data.paperCode,
      ...(Array.isArray(data.tags) ? data.tags : []),
      ...(Array.isArray(meta.tags) ? meta.tags : []),
      ...(Array.isArray(meta.layerPath) ? meta.layerPath : [])
    ];
    const haystack = values
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase();
    nodeSearchTextCache.set(node, haystack);
    return haystack;
  }

  function matchingGraphNodeCount() {
    let count = 0;
    state.graph.nodes.forEach((node, id) => {
      if (isNodeInScope(id) && nodeMatchesGraphFilter(node)) count += 1;
    });
    return count;
  }

  function graphFilterLabel(filter) {
    switch (filter) {
      case "subject": return "Subjects";
      case "layer": return "Layers";
      case "source": return "Sources";
      case "quote": return "Quotes";
      case "analysis": return "Analyses";
      case "pastpaper": return "Past papers";
      case "cue": return "Cues";
      case "tag": return "Tags";
      case "card": return "Cards";
      default: return "";
    }
  }

  function updateGraphSearchStatus() {
    const term = state.graphSearch.trim();
    const filter = state.graphTypeFilter;
    if (!term && filter === "all") {
      setGraphStatus("");
      return;
    }
    const count = matchingGraphNodeCount();
    const noun = count === 1 ? "match" : "matches";
    const scope = graphFilterLabel(filter);
    if (count === 0) {
      setGraphStatus(term ? `No matches for “${term}”` : `No ${scope.toLowerCase()} to show`, "warning", { sticky: true });
      return;
    }
    const text = term
      ? `${count} ${noun}${scope ? ` in ${scope.toLowerCase()}` : ""}`
      : `${count} ${scope.toLowerCase()}`;
    setGraphStatus(text, "success", { sticky: true });
  }

  function nodeMatchesGraphFilter(node) {
    if (!node) return false;
    const filter = state.graphTypeFilter;
    if (filter !== "all") {
      if (filter === "layer") {
        if (!String(node.type || "").startsWith("layer")) return false;
      } else if (node.type !== filter) {
        return false;
      }
    }
    const term = state.graphSearch.trim().toLowerCase();
    if (!term) return true;
    return getNodeSearchText(node).includes(term);
  }

  const GRAPH_FILTER_TYPES = new Set([
    "all", "subject", "layer", "source", "quote", "analysis", "pastpaper", "cue", "tag", "card"
  ]);

  function graphFilterPills() {
    return Array.from(document.querySelectorAll(".stat-pill[data-graph-type]"));
  }

  function syncGraphFilterUI() {
    const active = state.graphTypeFilter || "all";
    const enabled = state.viewMode === "graph";
    graphFilterPills().forEach((pill) => {
      const isActive = pill.dataset.graphType === active;
      pill.classList.toggle("active", isActive);
      pill.setAttribute("aria-pressed", String(isActive));
      // The type filter only affects the knowledge graph. In Library/Dots the
      // pills remain plain stats so tapping them cannot hide anything.
      pill.disabled = !enabled;
    });
  }

  function setGraphTypeFilter(next) {
    const requested = GRAPH_FILTER_TYPES.has(next) ? next : "all";
    // Tapping the active type again clears the filter, which makes the pills a
    // single, obvious control instead of needing a separate "all" reset.
    state.graphTypeFilter = requested !== "all" && state.graphTypeFilter === requested
      ? "all"
      : requested;
    // Reframe on the next tick so the remaining nodes are actually visible.
    state.userInteracted = false;
    syncGraphFilterUI();
    updateEmptyState();
    updateGraphSearchStatus();
    scheduleLayoutSave(400);
  }

  function isCardInScope(card) {
    if (!state.focusSubject) return true;
    const wanted = normalizeSubjectName(state.focusSubject);
    if (!wanted) return true;
    if (normalizeSubjectName(card?.deck) === wanted) return true;
    return (Array.isArray(card?.deckPath) ? card.deckPath : [])
      .some((part) => normalizeSubjectName(part) === wanted);
  }

  function recomputeScope() {
    state.focusSubjectId = findFocusSubjectNodeId();
    const wanted = normalizeSubjectName(state.focusSubject);

    if (!wanted) {
      state.scopeNodeIds = new Set(state.graph.nodes.keys());
      return;
    }

    const scoped = new Set();
    state.graph.nodes.forEach((node, id) => {
      if (node.type === "card") {
        if (isCardInScope(node.data)) scoped.add(id);
        return;
      }
      if (normalizeSubjectName(getItemSubject(node.data)) === wanted) scoped.add(id);
    });
    if (state.focusSubjectId) scoped.add(state.focusSubjectId);

    // Tags are shared across subjects, so keep only the ones attached to a
    // node that belongs to the focused subject.
    state.graph.nodes.forEach((node, id) => {
      if (node.type !== "tag") return;
      for (const neighborId of node.connections) {
        if (scoped.has(neighborId)) {
          scoped.add(id);
          break;
        }
      }
    });

    state.scopeNodeIds = scoped;
  }

  function getSourceLayerParts(source) {
    const raw = Array.isArray(source?.meta?.hierarchyPath)
      ? source.meta.hierarchyPath
      : [source?.subject || "", ...(source?.section ? String(source.section).split(" > ") : [])];

    const clean = (raw || []).map((s) => String(s || "").trim());
    const subject = clean[0] || String(source?.subject || "").trim();
    const l1 = clean[1] || "";
    const l2 = clean[2] || "";
    const l3 = clean[3] || "";
    return { subject, l1, l2, l3 };
  }

  function computeLayerNodesFromSources(nodes) {
    const sources = (nodes || []).filter((n) => n?.type === "source");
    const layerMap = new Map();

    for (const source of sources) {
      const { subject, l1, l2, l3 } = getSourceLayerParts(source);
      if (!subject || !l1) continue;

      const now = Date.now();
      const id1 = makeLayerId(subject, l1);
      if (!layerMap.has(id1)) {
        layerMap.set(id1, {
          id: id1,
          type: "layer 1",
          subject,
          title: l1,
          createdAt: now,
          updatedAt: now,
          meta: {
            layerLevel: 1,
            layerName: l1,
            layerPath: [subject, l1],
            parentLayerId: null
          }
        });
      }

      if (!l2) continue;
      const id2 = makeLayerId(subject, l1, l2);
      if (!layerMap.has(id2)) {
        layerMap.set(id2, {
          id: id2,
          type: "layer 2",
          subject,
          title: l2,
          createdAt: now,
          updatedAt: now,
          meta: {
            layerLevel: 2,
            layerName: l2,
            layerPath: [subject, l1, l2],
            parentLayerId: id1
          }
        });
      }

      if (!l3) continue;
      const id3 = makeLayerId(subject, l1, l2, l3);
      if (!layerMap.has(id3)) {
        layerMap.set(id3, {
          id: id3,
          type: "layer 3",
          subject,
          title: l3,
          createdAt: now,
          updatedAt: now,
          meta: {
            layerLevel: 3,
            layerName: l3,
            layerPath: [subject, l1, l2, l3],
            parentLayerId: id2
          }
        });
      }
    }

    return Array.from(layerMap.values());
  }

  function getNodeTypeIcon(type) {
    if (type?.startsWith("layer")) return "L";
    switch (type) {
      case "subject": return "📚";
      case "source": return "📄";
      case "quote": return "💬";
      case "analysis": return "💡";
      case "cue": return "🎯";
      case "tag": return "🏷️";
      case "pastpaper": return "✅";
      case "card": return "▣";
      default: return "●";
    }
  }

  function getNodeColor(type) {
    return config.colors[type] || "#9aa4ad";
  }

  // A lock is a shape state, not an icon: unlocked nodes stay hollow, locked
  // ones fill with their own colour and gain a brighter containment ring.
  // Effects are single-colour too: locking sends out one fading ring, while
  // unlocking shatters into particles, all in the node's own colour.
  function getLockLevel(id) {
    const visual = state.lockVisuals.get(id);
    if (visual) return visual.level;
    return state.lockedNodes.has(id) ? 1 : 0;
  }

  function spawnLockEffect(id, locking) {
    const pos = state.nodePositions.get(id);
    const node = state.graph.nodes.get(id);
    if (!pos || !node) return;

    const screen = transformPoint(pos.x, pos.y);
    const radius = Math.max(8, config.nodeRadius * state.zoom);
    const nodeRgb = hexToRgb(getNodeColor(node.type));

    if (locking) {
      // Locking is a calm containment pulse: one ring expands out and fades.
      state.lockRings.push({
        x: screen.x,
        y: screen.y,
        from: radius * 0.95,
        to: radius * 2.6,
        age: 0,
        ttl: 520,
        rgb: nodeRgb
      });
      return;
    }

    // Unlocking shatters the held shape. Every shard uses the node colour so
    // the effect reads as that node releasing, not a generic sparkle.
    const ttl = 430;
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.34;
      const startDistance = radius * (0.22 + Math.random() * 0.35);
      const endDistance = radius * (1.8 + Math.random() * 0.8);
      const travel = endDistance - startDistance;
      state.lockParticles.push({
        x: screen.x + Math.cos(angle) * startDistance,
        y: screen.y + Math.sin(angle) * startDistance,
        vx: (Math.cos(angle) * travel) / ttl,
        vy: (Math.sin(angle) * travel) / ttl,
        size: 2.2 + Math.random() * 2.2,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.012,
        age: 0,
        ttl: ttl + Math.random() * 120,
        rgb: nodeRgb
      });
    }
  }

  function setNodeLocked(id, locked, { announce = true } = {}) {
    if (!id || !state.graph.nodes.has(id)) return false;
    const wasLocked = state.lockedNodes.has(id);
    if (wasLocked === locked) {
      updateLockControls();
      return false;
    }

    const visual = state.lockVisuals.get(id) || {
      level: wasLocked ? 1 : 0,
      target: wasLocked ? 1 : 0
    };
    visual.target = locked ? 1 : 0;
    state.lockVisuals.set(id, visual);

    if (locked) {
      state.lockedNodes.add(id);
      state.pinnedNodes.add(id);
      if (state.nodePositions.has(id)) spawnLockEffect(id, true);
    } else {
      state.lockedNodes.delete(id);
      // Unlocking only removes the persistent lock. Keep the session pin so
      // the node does not immediately drift away from where it was placed.
      state.pinnedNodes.add(id);
      if (state.nodePositions.has(id)) spawnLockEffect(id, false);
    }

    saveLayoutNow();
    updateLockControls();
    if (announce) {
      setGraphStatus(locked ? "Position locked" : "Position unlocked", "success");
    }
    return true;
  }

  function unlockAllNodes() {
    if (state.lockedNodes.size === 0) return;
    const ids = Array.from(state.lockedNodes);
    ids.forEach((id, index) => {
      state.lockedNodes.delete(id);
      state.pinnedNodes.add(id);
      const visual = state.lockVisuals.get(id) || { level: 1, target: 1 };
      visual.target = 0;
      state.lockVisuals.set(id, visual);
      // A whole map can hold hundreds of locks; cap the flourish when the
      // user clears a large batch so the canvas stays responsive.
      if (index < 24 && state.nodePositions.has(id)) spawnLockEffect(id, false);
    });
    saveLayoutNow();
    updateLockControls();
    updateInspectorLockState();
    setGraphStatus(ids.length === 1 ? "Position unlocked" : `${ids.length} positions unlocked`, "success");
  }

  function setLockMode(enabled, { announce = true } = {}) {
    state.lockMode = Boolean(enabled) && state.viewMode === "graph";

    if (lockModeBtn) {
      lockModeBtn.setAttribute("aria-pressed", String(state.lockMode));
      lockModeBtn.textContent = state.lockMode ? "Done locking" : "Lock mode";
      lockModeBtn.title = state.lockMode
        ? "Stop toggling locks and return to opening node details"
        : "Tap nodes to lock or unlock several positions quickly";
    }

    if (state.lockMode) {
      // Lock mode owns the next canvas taps. Clear the competing tools so a
      // tap cannot try to open a panel or finish a connection.
      if (nodeSidebar?.classList.contains("open")) closeSidebar();
      state.isConnecting = false;
      state.connectingSourceId = null;
      connectNodesBtn?.classList.remove("active");
      connectingOverlay?.classList.remove("visible");
    }

    if (canvas) {
      canvas.style.cursor = state.lockMode
        ? "crosshair"
        : state.draggingNodeId
          ? "grabbing"
          : "default";
    }

    if (announce) {
      setGraphStatus(
        state.lockMode ? "Lock mode: tap nodes to lock or unlock" : "Lock mode off",
        state.lockMode ? "success" : "neutral",
        { sticky: state.lockMode }
      );
    }
  }

  function updateLockControls() {
    const button = document.getElementById("lockNodeBtn");
    const selectedId = state.selectedNodeId;
    const selectedIsNode = Boolean(selectedId && state.graph.nodes.has(selectedId));
    const selectedIsLocked = Boolean(selectedId && state.lockedNodes.has(selectedId));
    if (button) {
      button.disabled = !selectedIsNode;
      button.setAttribute("aria-pressed", String(selectedIsLocked));
      button.textContent = selectedIsLocked ? "Unlock position" : "Lock position";
      button.title = selectedIsLocked
        ? "Let the simulation and Re-layout move this node again"
        : "Keep this node in place during Re-layout";
    }

    const unlockAll = document.getElementById("unlockAllNodesBtn");
    const count = state.lockedNodes.size;
    if (unlockAll) {
      unlockAll.hidden = count === 0;
      unlockAll.disabled = count === 0;
      const countEl = document.getElementById("lockedNodeCount");
      if (countEl) countEl.textContent = String(count);
      unlockAll.setAttribute("aria-label", `Unlock ${count} locked ${count === 1 ? "position" : "positions"}`);
    }
  }

  function updateInspectorLockState() {
    const item = state.selectedNodeId ? findItemById(state.selectedNodeId) : null;
    if (item && sidebarType) {
      sidebarType.innerHTML = inspectorTypeMarkup(item);
    }
    updateLockControls();
  }

  function inspectorTypeMarkup(item) {
    const locked = state.lockedNodes.has(item.id);
    return `<span>${getNodeTypeIcon(item.type)}</span> ${item.type.charAt(0).toUpperCase() + item.type.slice(1)}${locked ? '<span class="sidebar-lock-badge">Locked</span>' : ""}`;
  }

  function getNodeDisplayTitle(node) {
    if (node.type === "card") {
      return String(node.front || "").trim() || "Untitled Card";
    }
    if (node.type === "quote") {
      const text = node.quote || "";
      return text.substring(0, 40) + (text.length > 40 ? "..." : "") || "Untitled Quote";
    }
    if (node.type?.startsWith("layer")) {
      const name = node?.meta?.layerName || node.title || "";
      const path = Array.isArray(node?.meta?.layerPath) ? node.meta.layerPath : [];
      return name ? `Layer: ${name}` : (path.length ? path.join(" > ") : "Layer");
    }
    if (node.type === "analysis") {
      const text = node.analysis || "";
      return node.title || text.substring(0, 40) + (text.length > 40 ? "..." : "") || "Untitled Analysis";
    }
    if (node.type === "source") {
      return node.title || node.subject || "Untitled Source";
    }
    if (node.type === "cue") {
      const content = node.cue || "";
      return content.substring(0, 40) + (content.length > 40 ? "..." : "") || "Untitled Cue";
    }
    if (node.type === "subject") {
      return node.title || node.subject || "Untitled Subject";
    }
    if (node.type === "tag") {
      return `#${node.title || "Untitled Tag"}`;
    }
    if (node.type === "pastpaper") {
      return [node.subject, node.year, node.series].filter(Boolean).join(" \u2014 ") || "Past Paper";
    }
    return node.subject || node.title || "Unknown";
  }

  function getNodePreview(node, maxLength = 150) {
    if (node.type === "card") return node.back || "";
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type?.startsWith("layer")) return (node?.meta?.layerPath || []).join(" > ") || "";
    if (node.type === "source") return node.content?.substring(0, maxLength) || node.contentText?.substring(0, maxLength) || "";
    if (node.type === "cue") return node.cue || "";
    if (node.type === "pastpaper") return pastPaperSummary(node);
    return "";
  }

  function getNodeFullContent(node) {
    if (node.type === "card") {
      const front = String(node.front || "").trim();
      const back = String(node.back || "").trim();
      return [front ? `Front\n${front}` : "", back ? `Back\n${back}` : ""]
        .filter(Boolean)
        .join("\n\n");
    }
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type?.startsWith("layer")) return (node?.meta?.layerPath || []).join(" > ") || "";
    if (node.type === "source") return node.content || node.contentText || "";
    if (node.type === "cue") return node.cue || "";
    if (node.type === "pastpaper") return pastPaperSummary(node);
    return "";
  }

  /* Source reading uses the same first-party markdown pipeline as the Analysis
   * tool, so the sidebar shows real headings, lists, quotes and maths instead
   * of raw markup. Soft breaks follow the account-wide Analysis preference
   * unless the document carries its own setting. */
  const SOFT_BREAKS_KEY = "nn-analysis-soft-breaks";

  function getSoftBreaksDefault() {
    try { return localStorage.getItem(SOFT_BREAKS_KEY) !== "0"; } catch { return true; }
  }

  function sourceSoftBreaks(node) {
    if (node && typeof node.meta?.softBreaks === "boolean") return node.meta.softBreaks;
    return getSoftBreaksDefault();
  }

  function mdNormalize(md) {
    if (!md) return md;
    return md
      .split("\n")
      .filter((line) => !line.trim().match(/^>[\s>]*$/))
      .join("\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .replace(/^\s+/, "")
      .replace(/\s+$/, "");
  }

  function htmlToMarkdown(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return mdNormalize(domToMarkdown(div) || "");
  }

  function sourceMarkdown(node) {
    if (!node) return "";
    // Legacy saves occasionally stringified a missing value, leaving the
    // literal text "undefined"/"null" in a content field. Treat that as empty
    // so the next (real) field in the chain wins instead of printing it.
    const usable = (value) => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      return trimmed === "undefined" || trimmed === "null" ? "" : value;
    };
    let md = "";
    const markdown = usable(node.contentMarkdown);
    if (markdown) {
      md = markdown;
    } else {
      const html = usable(node.contentHtml);
      if (html) md = htmlToMarkdown(html);
      else md = usable(node.content) || usable(node.contentText) || "";
    }
    return mdNormalize(md);
  }

  function getNodeType(node) {
    return node.type || node.itemType || "unknown";
  }

  function bestAttemptPct(r) {
    const attempts = r?.attempts || [];
    if (attempts.length === 0) return null;
    let best = 0;
    for (const a of attempts) {
      const pct = a.maxMarks ? Math.round((a.score / a.maxMarks) * 100) : 0;
      if (pct > best) best = pct;
    }
    return best;
  }

  function pastPaperSummary(node) {
    const lines = [node.examBoard && `Board: ${node.examBoard}`];
    const percentages = (node.results || []).map(bestAttemptPct).filter((p) => p !== null);
    if (percentages.length > 0) {
      const avg = Math.round(percentages.reduce((m, p) => m + p, 0) / percentages.length);
      lines.push(`${percentages.length} question${percentages.length !== 1 ? "s" : ""}, avg ${avg}%`);
    }
    return lines.filter(Boolean).join("\n") || "Past paper sitting";
  }

  function formatTimestamp(ms) {
    if (!Number.isFinite(Number(ms))) return null;
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return null;
    return `${d.toLocaleString()} (${d.toISOString()})`;
  }

  function formatNumber(value, digits = 3) {
    if (!Number.isFinite(Number(value))) return null;
    return Number(value).toFixed(digits);
  }

  function formatMetadataHumanReadable(node) {
    if (!node) return "";

    const lines = [];
    const push = (label, value) => {
      if (value === undefined || value === null || value === "") return;
      lines.push(`${label}: ${value}`);
    };
    const resolveRef = (id) => {
      if (!id) return "";
      const item = findItemById(id);
      if (!item) return `${id} (not found)`;
      return `${getNodeDisplayTitle(item)} \u2014 ${id}`;
    };
    const pushRef = (label, id) => {
      if (!id) return;
      push(label, resolveRef(id));
    };
    const formatMetaValue = (value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        if (value.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
          return value.join(", ");
        }
        return JSON.stringify(value);
      }
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    };

    lines.push("[identity]");
    push("id", node.id);
    push("type", node.type);
    if (node.type !== "card") push("subject", node.subject);

    const createdAt = formatTimestamp(node.createdAt);
    const updatedAt = formatTimestamp(node.updatedAt);
    if (createdAt) push("createdAt", createdAt);
    if (updatedAt) push("updatedAt", updatedAt);

    const meta = node.meta || {};
    const tags = Array.isArray(node.tags)
      ? node.tags
      : (Array.isArray(meta.tags) ? meta.tags : []);
    const organization = [];
    if (node.type === "card") {
      if (node.deck) organization.push(`deck: ${node.deck}`);
      if (Array.isArray(node.deckPath) && node.deckPath.length) {
        organization.push(`deckPath: ${node.deckPath.join(" > ")}`);
      }
      if (node.order !== undefined) organization.push(`order: ${node.order}`);
      if (node.origin) organization.push(`origin: ${node.origin}`);
    }
    if (node.section) organization.push(`section: ${node.section}`);
    if (tags.length) organization.push(`tags: ${tags.join(", ")}`);
    if (organization.length) {
      lines.push("");
      lines.push("[organization]");
      organization.forEach((line) => lines.push(line));
    }

    const signals = [];
    if (node.type === "card") {
      if (node.priority !== undefined && node.priority !== null) signals.push(`priority: ${node.priority}`);
      if (node.recall?.score !== undefined && node.recall?.score !== null) {
        signals.push(`recall: ${Math.round(node.recall.score * 100)}%${node.recall.source ? ` (${node.recall.source})` : ""}`);
      }
      if (node.accuracy !== undefined && node.accuracy !== null) {
        signals.push(`accuracy: ${Math.round(node.accuracy * 100)}%`);
      }
    }
    const lastGrade = node.lastGrade ?? meta.lastGrade;
    if (lastGrade !== undefined && lastGrade !== null) signals.push(`lastGrade: ${lastGrade}`);
    if (signals.length) {
      lines.push("");
      lines.push("[signals]");
      signals.forEach((line) => lines.push(line));
    }

    // References are first-class data. Resolve them to titles so the panel
    // explains what a record points at instead of hiding a count.
    const references = [];
    const pushRefLine = (label, id) => {
      if (!id) return;
      references.push(`${label}: ${resolveRef(id)}`);
    };
    if (node.type === "quote") {
      pushRefLine("link.sourceId", node.link?.sourceId);
    }
    if (node.type === "cue") {
      pushRefLine("quoteId", node.quoteId);
      pushRefLine("analysisId", node.analysisId);
    }
    if (node.type === "analysis" && Array.isArray(node.quoteRefs)) {
      node.quoteRefs.forEach((ref, index) => {
        if (!ref) return;
        const id = typeof ref === "string" ? ref : ref.quoteId;
        const detail = [];
        if (ref?.section) detail.push(`section: ${ref.section}`);
        if (ref?.priority !== undefined) detail.push(`priority: ${ref.priority}`);
        pushRefLine(
          `quoteRefs[${index}]${detail.length ? ` (${detail.join(", ")})` : ""}`,
          id
        );
      });
    }
    if (Array.isArray(node.links)) {
      node.links.forEach((link, index) => {
        const id = typeof link === "string"
          ? link
          : (link?.nodeId || link?.targetId || link?.id || link?.quoteId);
        if (id) pushRefLine(`links[${index}]`, id);
        else references.push(`links[${index}]: ${formatMetaValue(link)}`);
      });
    }
    if (Array.isArray(meta.manualLinks)) {
      meta.manualLinks.forEach((id, index) => pushRefLine(`manualLinks[${index}]`, id));
    }
    if (references.length) {
      lines.push("");
      lines.push("[references]");
      references.forEach((line) => lines.push(line));
    }

    const memoryKeys = [
      "S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount",
      "expectedTime", "avgTime", "timeVariance", "consistency", "confidence",
      "easeFactor", "honestyFlag", "clusterId", "lastGrade"
    ];
    const metaHasAny = memoryKeys.some((k) => meta[k] !== undefined && meta[k] !== null);
    if (metaHasAny) {
      lines.push("");
      lines.push("[memory]");

      if (meta.S !== undefined) push("S", formatNumber(meta.S, 3));
      if (meta.D !== undefined) push("D", formatNumber(meta.D, 3));
      if (meta.U !== undefined) push("U", formatNumber(meta.U, 3));
      if (meta.interval !== undefined) push("interval(days)", formatNumber(meta.interval, 3));
      if (meta.reviewCount !== undefined) push("reviewCount", meta.reviewCount);

      const nextReview = formatTimestamp(meta.nextReview);
      const lastReview = formatTimestamp(meta.lastReview);
      if (nextReview) push("nextReview", nextReview);
      if (lastReview) push("lastReview", lastReview);

      if (meta.expectedTime !== undefined) push("expectedTime(s)", formatNumber(meta.expectedTime, 2));
      if (meta.avgTime !== undefined) push("avgTime(s)", formatNumber(meta.avgTime, 2));
      if (meta.timeVariance !== undefined) push("timeVariance", formatNumber(meta.timeVariance, 3));
      if (meta.consistency !== undefined) push("consistency", formatNumber(meta.consistency, 3));
      if (meta.confidence !== undefined) push("confidence", formatNumber(meta.confidence, 3));
      if (meta.easeFactor !== undefined) push("easeFactor", formatNumber(meta.easeFactor, 3));
      if (meta.honestyFlag !== undefined) push("honestyFlag", formatNumber(meta.honestyFlag, 3));
      if (meta.clusterId) push("clusterId", meta.clusterId);
    }

    // Everything not already shown above, including arrays and nested objects,
    // is printed in full. A diagnostic panel should never reduce data to
    // "[n items]" or "{...}".
    const shownMetaKeys = new Set([
      ...memoryKeys,
      "tags",
      "manualLinks",
      "priority",
      "subject"
    ]);
    const otherMetaKeys = Object.keys(meta).filter((k) => !shownMetaKeys.has(k)).sort();
    if (otherMetaKeys.length > 0 || Object.keys(meta).length === 0) {
      lines.push("");
      lines.push("[meta]");
      if (otherMetaKeys.length === 0) {
        lines.push("(empty)");
      } else {
        otherMetaKeys.forEach((k) => {
          const value = formatMetaValue(meta[k]);
          if (value !== "") push(k, value);
        });
      }
    }

    return lines.join("\n");
  }

  function normalizePriority(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(5, Math.max(1, Math.round(n)));
  }

  function getDirectPriority(item) {
    return normalizePriority(item?.priority ?? item?.meta?.priority);
  }

  function getItemPriority(item, depth = 0) {
    if (!item || depth > 4) return null;

    const direct = getDirectPriority(item);
    if (direct) return direct;

    if (item.type === "analysis") {
      const refs = Array.isArray(item.quoteRefs) ? item.quoteRefs : [];
      const refPriorities = refs
        .map((ref) => normalizePriority(ref?.priority))
        .filter(Boolean);
      if (refPriorities.length) return Math.max(...refPriorities);

      const linkedPriorities = refs
        .map((ref) => (ref?.quoteId ? findItemById(ref.quoteId) : null))
        .filter(Boolean)
        .map((quote) => getItemPriority(quote, depth + 1))
        .filter(Boolean);
      if (linkedPriorities.length) return Math.max(...linkedPriorities);
      return null;
    }

    if (item.type === "cue") {
      if (item.quoteId) {
        const quote = findItemById(item.quoteId);
        const priority = quote ? getItemPriority(quote, depth + 1) : null;
        if (priority) return priority;
      }
      if (item.analysisId) {
        const analysis = findItemById(item.analysisId);
        const priority = analysis ? getItemPriority(analysis, depth + 1) : null;
        if (priority) return priority;
      }
      return null;
    }

    if (item.type === "source") {
      const priorities = (state.quotes || [])
        .filter((quote) => quote?.link?.sourceId === item.id)
        .map((quote) => getDirectPriority(quote))
        .filter(Boolean);
      if (priorities.length) return Math.max(...priorities);
    }

    return null;
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, n));
  }

  function normalizeAccuracy(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    const ratio = n > 1 ? n / 100 : n;
    return Math.min(1, Math.max(0, ratio));
  }

  function getGradeScore(grade, scale = GRADE_SCORES) {
    return scale[String(grade || "").toLowerCase()];
  }

  function recallFromScore(score, derived = false, source = "observed") {
    const value = clamp01(score);
    if (value === null) {
      return { level: "unknown", label: "No recall data", score: null, derived, source };
    }
    if (value >= 0.8) return { level: "strong", label: "Strong", score: value, derived, source };
    if (value >= 0.5) return { level: "medium", label: "Partial", score: value, derived, source };
    return { level: "weak", label: "Weak", score: value, derived, source };
  }

  function getItemRecall(item, depth = 0) {
    const meta = item?.meta || {};

    const lastGrade = String(meta.lastGrade || "").toLowerCase();
    const directGradeScore = getGradeScore(lastGrade, RECALL_GRADE_SCORES);
    if (directGradeScore !== undefined) return recallFromScore(directGradeScore);

    const phase = String(meta.L_phase || "").toLowerCase();
    if (phase === "new") {
      const confidence = normalizeAccuracy(meta.confidence);
      return recallFromScore(confidence ?? 0.8, false, confidence !== null ? "prior" : "observed");
    }
    const phaseScores = {
      mastered: 0.95,
      stable: 0.85,
      stabilising: 0.65,
      warming: 0.55
    };
    if (phaseScores[phase] !== undefined) return recallFromScore(phaseScores[phase]);

    const rawS = meta.S;
    const rawU = meta.U;
    const hasS = rawS !== undefined && rawS !== null && rawS !== "" && Number.isFinite(Number(rawS));
    const hasU = rawU !== undefined && rawU !== null && rawU !== "" && Number.isFinite(Number(rawU));
    const stability = hasS ? Number(rawS) : 0;
    const uncertainty = hasU ? Number(rawU) : 0;

    if (hasS && hasU) {
      const stabilityScore = clamp01(stability / 1.5) ?? 0;
      const certaintyScore = clamp01(1 - uncertainty) ?? 0;
      const score = clamp01(stabilityScore * 0.55 + certaintyScore * 0.45);
      return recallFromScore(score);
    }
    if (hasU) return recallFromScore(clamp01(1 - uncertainty));
    if (hasS) return recallFromScore(clamp01(stability / 1.5));

    if (Array.isArray(meta.recentGrades) && meta.recentGrades.length) {
      const scores = meta.recentGrades.map((grade) => getGradeScore(grade)).filter((score) => score !== undefined);
      if (scores.length) {
        return recallFromScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
      }
    }

    if (depth < 4 && item?.type === "analysis") {
      const refs = Array.isArray(item.quoteRefs) ? item.quoteRefs : [];
      const linked = refs
        .map((ref) => (ref?.quoteId ? findItemById(ref.quoteId) : null))
        .filter(Boolean)
        .map((quote) => getItemRecall(quote, depth + 1))
        .filter((recall) => recall.level !== "unknown");
      if (linked.length) {
        const weakest = linked.reduce((worst, recall) =>
          (recall.score ?? 0) < (worst.score ?? 0) ? recall : worst
        );
        return { ...weakest, derived: true };
      }
    }

    if (depth < 4 && item?.type === "cue") {
      const candidates = [
        item.quoteId ? findItemById(item.quoteId) : null,
        item.analysisId ? findItemById(item.analysisId) : null
      ].filter(Boolean);
      for (const linkedItem of candidates) {
        const recall = getItemRecall(linkedItem, depth + 1);
        if (recall.level !== "unknown") return { ...recall, derived: true };
      }
    }

    // Creating a card is itself a revision pass, so a card with no reviews yet
    // still gets a legitimate prior. Bulk imports can set a lower prior.
    const confidence = normalizeAccuracy(meta.confidence);
    if (confidence !== null) {
      return { ...recallFromScore(confidence, false, "prior"), label: "Prior" };
    }

    return { level: "unknown", label: "No recall data", score: null, derived: false, source: "none" };
  }

  function getItemAccuracy(item) {
    const meta = item?.meta || {};

    // Observed grades are the strongest evidence. They must beat the creation
    // prior, otherwise every new card would read as 80% accurate forever.
    if (Array.isArray(meta.recentGrades) && meta.recentGrades.length) {
      const scores = meta.recentGrades.map((grade) => getGradeScore(grade)).filter((score) => score !== undefined);
      if (scores.length) {
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }
    }

    const accuracy = normalizeAccuracy(meta.accuracy);
    if (accuracy !== null) return accuracy;

    const lastGradeScore = getGradeScore(meta.lastGrade);
    if (lastGradeScore !== undefined) return lastGradeScore;

    // The 0.8 prior is intentional: making a card is revision. Bulk imports
    // can lower this initial value, and real grades replace it over time.
    const confidence = normalizeAccuracy(meta.confidence);
    if (confidence !== null) return confidence;

    if (item?.type === "pastpaper") {
      const percentages = (item.results || []).map(bestAttemptPct).filter((pct) => pct !== null);
      if (percentages.length) {
        return percentages.reduce((sum, pct) => sum + pct, 0) / percentages.length / 100;
      }
    }

    return null;
  }

  function getScoreBin(score) {
    const normalized = normalizeAccuracy(score);
    if (normalized === null) {
      return { index: -1, color: DOT_UNKNOWN_COLOR, label: "No data" };
    }
    const index = Math.min(DOT_SCORE_BINS.length - 1, Math.floor(normalized / 0.2));
    return { index, ...DOT_SCORE_BINS[index] };
  }

  function getGridTags(item) {
    const tags = Array.isArray(item?.tags)
      ? item.tags
      : Array.isArray(item?.meta?.tags)
        ? item.meta.tags
        : [];
    return tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean);
  }

  function getItemLayerParts(item, depth = 0) {
    if (!item || depth > 4) {
      return { subject: getItemSubject(item), l1: "", l2: "", l3: "" };
    }

    if (item.type === "source") return getSourceLayerParts(item);

    if (item.type === "quote") {
      const source = item.link?.sourceId ? findItemById(item.link.sourceId) : null;
      if (source?.type === "source") return getSourceLayerParts(source);
    }

    if (item.type === "analysis") {
      const refs = Array.isArray(item.quoteRefs) ? item.quoteRefs : [];
      for (const ref of refs) {
        const quote = ref?.quoteId ? findItemById(ref.quoteId) : null;
        if (quote) {
          const parts = getItemLayerParts(quote, depth + 1);
          if (parts.l1) return parts;
        }
        if (ref?.section) {
          const sectionParts = String(ref.section)
            .split(">")
            .map((part) => part.trim())
            .filter(Boolean);
          if (sectionParts.length) {
            return {
              subject: getItemSubject(item),
              l1: sectionParts[0] || "",
              l2: sectionParts[1] || "",
              l3: sectionParts[2] || ""
            };
          }
        }
      }
    }

    if (item.type === "cue") {
      const quote = item.quoteId ? findItemById(item.quoteId) : null;
      if (quote) {
        const parts = getItemLayerParts(quote, depth + 1);
        if (parts.l1) return parts;
      }
      const analysis = item.analysisId ? findItemById(item.analysisId) : null;
      if (analysis) {
        const parts = getItemLayerParts(analysis, depth + 1);
        if (parts.l1) return parts;
      }
    }

    const raw = Array.isArray(item?.meta?.hierarchyPath)
      ? item.meta.hierarchyPath
      : [getItemSubject(item), ...(item?.section ? String(item.section).split(">") : [])];
    const clean = raw.map((part) => String(part || "").trim());
    return {
      subject: clean[0] || getItemSubject(item),
      l1: clean[1] || "",
      l2: clean[2] || "",
      l3: clean[3] || ""
    };
  }

  function buildCardItem(card) {
    const front = String(card?.front || "").trim();
    const back = String(card?.back || "").trim();
    const deck = String(card?.deck || "").trim() || "Unsorted";
    const deckPath = (Array.isArray(card?.deckPath) ? card.deckPath : [])
      .map((part) => String(part || "").trim())
      .filter(Boolean);

    return {
      id: card.id,
      type: "card",
      typeLabel: "Card",
      icon: "▣",
      title: front || "(untitled card)",
      preview: back,
      priority: getItemPriority(card),
      recall: getItemRecall(card),
      accuracy: getItemAccuracy(card),
      tags: getGridTags(card),
      deck,
      deckPath,
      order: Number.isFinite(Number(card?.order)) ? Number(card.order) : 0,
      createdAt: Number(card?.createdAt) || 0,
      updatedAt: Number(card?.updatedAt) || 0
    };
  }

  // Resolve a card's graph anchors once per graph rebuild. Cards are real
  // scene objects, so their context links are cached rather than re-walked
  // every frame.
  function getCardAnchorIdsForGraph(card, graph) {
    const links = card?.links && typeof card.links === "object" ? card.links : {};
    const ids = [];
    const add = (id) => {
      if (!id || ids.includes(id)) return;
      const node = graph.nodes.get(id);
      if (!node || node.type === "card") return;
      ids.push(id);
    };
    add(links.quoteId);
    add(links.cueId);
    add(links.analysisId);
    add(links.nodeId);
    add(links.sourceId);
    if (ids.length) return ids;

    const deck = normalizeSubjectName(card?.deck);
    const deckPath = (Array.isArray(card?.deckPath) ? card.deckPath : [])
      .map((part) => normalizeSubjectName(part))
      .filter(Boolean);
    if (!deck && !deckPath.length) return ids;

    let exactSubjectId = null;
    let pathSubjectId = null;
    graph.nodes.forEach((node, id) => {
      if (node.type === "card") return;
      const subject = normalizeSubjectName(getItemSubject(node.data));
      if (!subject) return;
      if (subject === deck && node.type === "subject") exactSubjectId = id;
      else if (!pathSubjectId && deckPath.includes(subject) && node.type === "subject") pathSubjectId = id;
    });
    if (exactSubjectId) return [exactSubjectId];
    if (pathSubjectId) return [pathSubjectId];

    // A deck can exist as a card-only scope with no subject node yet. In that
    // case attach the card to any knowledge node in the same subject rather
    // than dropping it at the centre of the map.
    let fallbackId = null;
    graph.nodes.forEach((node, id) => {
      if (fallbackId || node.type === "card") return;
      if (normalizeSubjectName(getItemSubject(node.data)) === deck) fallbackId = id;
    });
    return fallbackId ? [fallbackId] : ids;
  }

  // The card scene object is the card's position record. `nodePositions`
  // points at the same object, so Graph physics, dragging, hit-testing, and
  // the Dots transition all read/write one canonical x/y.
  function ensureCardSceneObjects() {
    const cards = Array.isArray(state.cards) ? state.cards : [];
    const seen = new Set();

    cards.forEach((card) => {
      if (!card?.id) return;
      seen.add(card.id);
      let scene = state.cardScene.get(card.id);
      if (!scene) {
        // A persisted (or otherwise pre-seeded) position is a plain point in
        // nodePositions. Hydrate the scene from it before replacing the entry,
        // otherwise restoring a layout would discard every card position.
        const savedPoint = state.nodePositions.get(card.id);
        const hasSavedPoint = Boolean(savedPoint &&
          Number.isFinite(savedPoint.x) && Number.isFinite(savedPoint.y));
        scene = {
          isCardScene: true,
          id: card.id,
          card,
          item: null,
          x: hasSavedPoint ? savedPoint.x : NaN,
          y: hasSavedPoint ? savedPoint.y : NaN,
          homeX: hasSavedPoint ? savedPoint.x : 0,
          homeY: hasSavedPoint ? savedPoint.y : 0,
          homeValid: hasSavedPoint,
          seeded: hasSavedPoint,
          anchorIds: [],
          dotSection: -1,
          dotGroup: 0,
          dotRow: 0,
          dotCol: 0,
          recallRgb: CARD_UNKNOWN_RGB,
          accuracyRgb: CARD_UNKNOWN_RGB,
          priority: null,
          priorityColor: null,
          priorityRgb: null
        };
        state.cardScene.set(card.id, scene);
        state.nodePositions.set(card.id, scene);
        state.velocities.set(card.id, { x: 0, y: 0 });
      } else {
        scene.card = card;
      }

      const item = buildCardItem(card);
      scene.item = item;
      const recallBin = getScoreBin(item.recall?.score);
      const accuracyBin = getScoreBin(item.accuracy);
      scene.recallRgb = recallBin.rgb || CARD_UNKNOWN_RGB;
      scene.accuracyRgb = accuracyBin.rgb || CARD_UNKNOWN_RGB;
      scene.priority = item.priority;
      scene.priorityColor = item.priority ? GRID_IMPORTANCE_COLORS[item.priority] : null;
      scene.priorityRgb = item.priority ? hexToRgb(GRID_IMPORTANCE_COLORS[item.priority]) : null;
    });

    for (const id of [...state.cardScene.keys()]) {
      if (seen.has(id)) continue;
      state.cardScene.delete(id);
      state.nodePositions.delete(id);
      state.velocities.delete(id);
      state.nodeVisibility.delete(id);
    }
  }

  // New cards appear next to the context they came from. Existing cards keep
  // their session position; only the one-time home snapshot is used by the
  // Dots return trip.
  function seedCardScenePositions() {
    const width = canvas?.parentElement?.clientWidth || viewWidth() || 800;
    const height = canvas?.parentElement?.clientHeight || viewHeight() || 600;
    const fallback = { x: width / 2, y: height / 2 };
    let index = 0;

    state.cardScene.forEach((scene) => {
      if (scene.seeded && Number.isFinite(scene.x) && Number.isFinite(scene.y)) {
        index += 1;
        return;
      }

      let anchorX = 0;
      let anchorY = 0;
      let anchorCount = 0;
      scene.anchorIds.forEach((id) => {
        const pos = state.nodePositions.get(id);
        if (!pos) return;
        anchorX += pos.x;
        anchorY += pos.y;
        anchorCount += 1;
      });

      if (anchorCount > 0) {
        anchorX /= anchorCount;
        anchorY /= anchorCount;
      } else {
        anchorX = fallback.x;
        anchorY = fallback.y;
      }

      // Deterministic golden-angle spread keeps sibling cards from stacking
      // without a per-frame layout pass or a second coordinate map.
      const angle = index * 2.399963229728653;
      const radius = 34 + (index % 4) * 9;
      scene.x = anchorX + Math.cos(angle) * radius;
      scene.y = anchorY + Math.sin(angle) * radius;
      scene.seeded = true;
      const velocity = state.velocities.get(scene.id);
      if (velocity) {
        velocity.x = 0;
        velocity.y = 0;
      } else {
        state.velocities.set(scene.id, { x: 0, y: 0 });
      }
      index += 1;
    });
  }

  function setWorldPosition(id, x, y) {
    const existing = state.nodePositions.get(id);
    if (existing?.isCardScene) {
      existing.x = x;
      existing.y = y;
      return;
    }
    state.nodePositions.set(id, { x, y });
  }

  function compareCardBrowseOrder(a, b) {
    const orderDelta = a.order - b.order;
    if (orderDelta !== 0) return orderDelta;
    const createdDelta = a.createdAt - b.createdAt;
    if (createdDelta !== 0) return createdDelta;
    return a.title.localeCompare(b.title);
  }

  function buildCardSections() {
    const deckMap = new Map();

    (state.cards || []).forEach((card) => {
      if (!card?.id || !isCardInScope(card)) return;
      const deck = String(card.deck || "").trim() || "Unsorted";
      if (!deckMap.has(deck)) deckMap.set(deck, []);
      deckMap.get(deck).push(buildCardItem(card));
    });

    return Array.from(deckMap.entries())
      .map(([deck, cards]) => {
        // Stable creation order is the default. Performance sorting belongs to
        // the study queue, not this browse view.
        cards.sort(compareCardBrowseOrder);
        return { deck, cards, count: cards.length };
      })
      .sort((a, b) => a.deck.localeCompare(b.deck, undefined, { sensitivity: "base" }));
  }

  function matchesLibrarySearch(card, term) {
    if (!term) return true;
    const haystack = [
      card.title,
      card.preview,
      card.deck,
      ...(card.deckPath || []),
      ...(card.tags || [])
    ].join(" ").toLowerCase();
    return haystack.includes(term);
  }

  function compareNullableAsc(a, b) {
    const av = a === null || a === undefined ? Infinity : a;
    const bv = b === null || b === undefined ? Infinity : b;
    return av - bv;
  }

  function sortLibraryCards(cards) {
    const sorted = [...cards];
    switch (state.librarySort) {
      case "priority-desc":
        return sorted.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.title.localeCompare(b.title));
      case "priority-asc":
        return sorted.sort((a, b) => (a.priority || 99) - (b.priority || 99) || a.title.localeCompare(b.title));
      case "recall-asc":
        return sorted.sort((a, b) => compareNullableAsc(a.recall?.score, b.recall?.score) || a.title.localeCompare(b.title));
      case "accuracy-asc":
        return sorted.sort((a, b) => compareNullableAsc(a.accuracy, b.accuracy) || a.title.localeCompare(b.title));
      case "updated-desc":
        return sorted.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
      case "title":
        return sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      default:
        return sorted.sort(compareCardBrowseOrder);
    }
  }

  function buildGridData() {
    const term = state.librarySearch.trim().toLowerCase();
    return buildCardSections().map((section) => {
      // Deck sections are the primary grouping. When a deck carries a deeper
      // deckPath, preserve that hierarchy as sub-groups instead of flattening it.
      const cards = sortLibraryCards(section.cards.filter((card) => matchesLibrarySearch(card, term)));
      const groupMap = new Map();
      cards.forEach((card) => {
        const subPath = card.deckPath.slice(1).join(" › ");
        const groupName = subPath || "Cards";
        if (!groupMap.has(groupName)) groupMap.set(groupName, []);
        groupMap.get(groupName).push(card);
      });

      const groups = Array.from(groupMap.entries())
        .map(([name, cards]) => ({ name, cards }))
        .sort((a, b) => {
          if (a.name === "Cards") return -1;
          if (b.name === "Cards") return 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });

      return {
        deck: section.deck,
        groups,
        showGroupHeads: groups.length > 1 || (groups[0] && groups[0].name !== "Cards"),
        count: cards.length
      };
    }).filter((section) => section.groups.length > 0);
  }

  function syncGridSelection() {
    if (!gridContainer) return;
    gridContainer.querySelectorAll(".mindmap-grid-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.nodeId === state.selectedNodeId);
      card.classList.toggle("multi-selected", state.selectedCardIds.has(card.dataset.nodeId));
    });
    updateLibrarySelectionUI();
  }

  function updateLibrarySelectionUI() {
    const selectedCount = state.selectedCardIds.size;
    const countLabel = document.getElementById("librarySelectionCount");
    const addButton = document.getElementById("libraryAddSelectedBtn");
    if (countLabel) {
      countLabel.textContent = selectedCount
        ? `${selectedCount} selected`
        : (state.librarySelectMode ? "Tap cards to select" : "");
    }
    if (addButton) {
      addButton.disabled = selectedCount === 0;
      addButton.textContent = selectedCount ? `Add ${selectedCount} to heap` : "Add selected to heap";
    }
    const toggleButton = document.getElementById("librarySelectToggle");
    if (toggleButton) {
      toggleButton.textContent = state.librarySelectMode ? "Done" : "Select";
      toggleButton.setAttribute("aria-pressed", String(state.librarySelectMode));
    }
  }

  function toggleLibraryCardSelection(cardId) {
    if (!cardId) return;
    if (state.selectedCardIds.has(cardId)) state.selectedCardIds.delete(cardId);
    else state.selectedCardIds.add(cardId);
    syncGridSelection();
  }

  async function addSelectedCardsToHeap() {
    if (state.selectedCardIds.size === 0) return;
    const ensured = await ensureActiveHeap();
    if (!ensured) return;
    const heap = getActiveHeap() || ensured;
    const current = Array.isArray(heap.cardIds) ? heap.cardIds : [];
    const additions = [...state.selectedCardIds].filter((id) => !current.includes(id));
    if (additions.length) {
      await saveHeapCardIds(heap, [...current, ...additions]);
    }
    state.selectedCardIds.clear();
    state.librarySelectMode = false;
    renderGrid();
  }

  function getActiveHeap() {
    if (!state.activeHeapId) return null;
    return (state.heaps || []).find((heap) => heap.id === state.activeHeapId) || null;
  }

  function mergeHeapOrder(incoming) {
    // getAllHeaps() returns updatedAt-desc. That is correct for a database
    // listing, but using it directly makes the active heap jump to the top of
    // the select every time it is edited. Keep the order the user is looking
    // at and append genuinely new heaps.
    const order = new Map((state.heaps || []).map((heap, index) => [heap.id, index]));
    return [...(incoming || [])].sort((a, b) => {
      const ai = order.has(a.id) ? order.get(a.id) : Infinity;
      const bi = order.has(b.id) ? order.get(b.id) : Infinity;
      if (ai === bi) return 0;
      if (ai === Infinity) return -1;
      if (bi === Infinity) return 1;
      return ai - bi;
    });
  }

  function getHeapCards(heap) {
    if (!heap) return [];
    const cardsById = new Map((state.cards || []).map((card) => [card.id, card]));
    return (heap.cardIds || []).map((id) => cardsById.get(id)).filter(Boolean);
  }

  function updateInspectorHeader() {
    const item = state.selectedNodeId ? findItemById(state.selectedNodeId) : null;
    if (item) {
      if (sidebarTitle) sidebarTitle.textContent = getNodeDisplayTitle(item);
      if (sidebarType) sidebarType.innerHTML = inspectorTypeMarkup(item);
      return;
    }
    const heap = getActiveHeap();
    if (state.inspectorTab === "heap") {
      if (sidebarTitle) sidebarTitle.textContent = "Study heap";
      if (sidebarType) sidebarType.textContent = heap?.name || "No heap selected";
      return;
    }
    if (sidebarTitle) sidebarTitle.textContent = state.inspectorTab === "connections" ? "Connections" : "Details";
    if (sidebarType) sidebarType.textContent = "Select a node or card";
  }

  function setInspectorTab(tab) {
    const nextTab = ["details", "connections", "heap"].includes(tab) ? tab : "details";
    state.inspectorTab = nextTab;

    nodeSidebar?.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      const active = button.dataset.inspectorTab === nextTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    nodeSidebar?.querySelectorAll("[data-inspector-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.inspectorPanel !== nextTab;
    });

    const hasSelection = Boolean(state.selectedNodeId && findItemById(state.selectedNodeId));
    if (nextTab === "details") {
      const empty = document.getElementById("inspectorDetailsEmpty");
      const content = nodeSidebar?.querySelector(".sidebar-content");
      const actions = nodeSidebar?.querySelector(".sidebar-actions");
      if (empty) empty.hidden = hasSelection;
      if (content) content.hidden = !hasSelection;
      if (actions) actions.hidden = !hasSelection;
      updateInspectorHeader();
    } else if (nextTab === "heap") {
      state.heapSidebarOpen = true;
      renderHeapSidebar();
      updateInspectorHeader();
    } else if (nextTab === "connections" && !hasSelection) {
      const container = document.getElementById("connectionsContainer");
      const items = document.getElementById("connectionsItems");
      const empty = document.getElementById("connectionsEmpty");
      const count = document.getElementById("connectionCount");
      const tabCount = document.getElementById("connectionTabCount");
      if (container) container.hidden = true;
      if (items) items.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Select a node or card to see its connections.";
      }
      if (count) count.textContent = "0";
      if (tabCount) tabCount.textContent = "0";
      updateInspectorHeader();
    }

    if (toggleHeapSidebarBtn) {
      toggleHeapSidebarBtn.setAttribute(
        "aria-expanded",
        String(state.heapSidebarOpen && nextTab === "heap" && Boolean(getActiveHeap()))
      );
    }
  }

  function openInspector(tab = "details", options = {}) {
    if (nodeSidebar) {
      nodeSidebar.classList.add("open");
      nodeSidebar.setAttribute("aria-hidden", "false");
    }
    nodeSidebarBackdrop?.classList.add("visible");
    setInspectorTab(tab);
    if (options.focus) {
      requestAnimationFrame(() => {
        if (nodeSidebar?.classList.contains("open")) {
          nodeSidebar.focus({ preventScroll: true });
        }
      });
    }
  }

  function updateHeapSidebarVisibility() {
    const heap = getActiveHeap();
    const wantsHeapPanel = Boolean(heap) && state.heapSidebarOpen;
    if (toggleHeapSidebarBtn) {
      toggleHeapSidebarBtn.setAttribute("aria-expanded", String(wantsHeapPanel && state.inspectorTab === "heap"));
      toggleHeapSidebarBtn.textContent = `Heap (${getHeapCards(heap).length})`;
    }
    if (!wantsHeapPanel && !state.selectedNodeId && state.inspectorTab === "heap" && nodeSidebar?.classList.contains("open")) {
      closeSidebar();
    }
  }

  function renderHeapSidebar() {
    const heap = getActiveHeap();
    if (libraryHeapSidebarName) {
      libraryHeapSidebarName.textContent = heap?.name || "No heap selected";
    }

    const availableCards = getHeapCards(heap);
    const missingCount = heap ? Math.max(0, (heap.cardIds || []).length - availableCards.length) : 0;

    if (libraryHeapSidebarMeta) {
      libraryHeapSidebarMeta.textContent = heap
        ? `${availableCards.length} card${availableCards.length === 1 ? "" : "s"} in study order${missingCount ? ` · ${missingCount} deleted card${missingCount === 1 ? "" : "s"} skipped` : ""}`
        : "Select or create a heap to start collecting cards.";
    }

    if (libraryHeapItems) {
      libraryHeapItems.innerHTML = !heap
        ? `<div class="library-heap-empty">
             <p>No heap selected. Create one to collect cards in study order.</p>
             <div class="library-heap-empty-actions">
               <button type="button" class="btn primary" data-heap-empty-action="new">New heap</button>
               <button type="button" class="btn" data-heap-empty-action="browse">Browse Library</button>
             </div>
           </div>`
        : availableCards.length === 0
          ? `<div class="library-heap-empty">
               <p>This heap is empty. Add cards with <strong>+ Heap</strong> in the Library.</p>
               <div class="library-heap-empty-actions">
                 <button type="button" class="btn" data-heap-empty-action="browse">Browse Library</button>
               </div>
             </div>`
          : availableCards.map((card, index) => `
              <div class="library-heap-item" data-heap-item-id="${escapeHtml(card.id)}">
                <span class="heap-drag-handle" data-heap-drag-handle title="Drag to reorder" aria-hidden="true">\u2630</span>
                <div class="library-heap-item-title">${escapeHtml(card.front || "Untitled card")}</div>
                <div class="library-heap-item-meta">${index + 1}. ${escapeHtml(card.deck || "Unsorted")}</div>
                <div class="library-heap-item-actions">
                  <button type="button" data-heap-action="up" data-heap-card-id="${escapeHtml(card.id)}" title="Move up" ${index === 0 ? "disabled" : ""}>\u2191</button>
                  <button type="button" data-heap-action="down" data-heap-card-id="${escapeHtml(card.id)}" title="Move down" ${index === availableCards.length - 1 ? "disabled" : ""}>\u2193</button>
                  <button type="button" data-heap-action="remove" data-heap-card-id="${escapeHtml(card.id)}" title="Remove from heap">\u00d7</button>
                </div>
              </div>
            `).join("");
    }

    if (heapSidebarStudyBtn) heapSidebarStudyBtn.disabled = availableCards.length === 0;
    if (deleteHeapBtn) deleteHeapBtn.disabled = !heap;
  }

  function renderHeapControls() {
    const heap = getActiveHeap();
    const availableCards = getHeapCards(heap);

    if (libraryHeapSelect) {
      const options = [
        `<option value="">No heap selected</option>`,
        ...(state.heaps || []).map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)} (${(entry.cardIds || []).length})</option>`)
      ];
      libraryHeapSelect.innerHTML = options.join("");
      libraryHeapSelect.value = heap?.id || "";
    }

    if (libraryHeapStatus) {
      libraryHeapStatus.classList.toggle("is-warning", !heap && (state.heaps || []).length === 0);
      if (!(state.heaps || []).length) {
        libraryHeapStatus.textContent = "No heaps yet. Create one, then collect cards from the library.";
      } else if (!heap) {
        libraryHeapStatus.textContent = "Select a heap, or create a new one, then add cards with + Heap.";
      } else {
        libraryHeapStatus.textContent = `${heap.name}: ${availableCards.length} card${availableCards.length === 1 ? "" : "s"}. Study follows this order exactly; grades still update SRS.`;
      }
    }

    if (toggleHeapSidebarBtn) {
      toggleHeapSidebarBtn.textContent = `Heap (${availableCards.length})`;
    }

    renderHeapSidebar();
    updateHeapSidebarVisibility();
  }

  async function createHeap() {
    if (typeof addHeap !== "function") {
      dialog.alert("Heap creation is unavailable.");
      return null;
    }
    const name = await dialog.prompt("Name this heap:");
    if (name === null) return null;
    const trimmed = name.trim();
    if (!trimmed) {
      dialog.alert("Please enter a heap name.");
      return null;
    }

    try {
      const heap = await addHeap({ name: trimmed, cardIds: [] });
      state.heaps = [heap, ...(state.heaps || []).filter((entry) => entry.id !== heap.id)];
      state.activeHeapId = heap.id;
      state.heapSidebarOpen = true;
      renderHeapControls();
      renderGrid();
      openInspector("heap");
      return heap;
    } catch (error) {
      console.error("Failed to create heap:", error);
      dialog.alert("Failed to create heap: " + error.message);
      return null;
    }
  }

  async function ensureActiveHeap() {
    return getActiveHeap() || createHeap();
  }

  let heapSaveTimer = null;
  let pendingHeapSave = null;
  let suppressHeapDBRefresh = false;

  function applyHeapCardIds(heap, cardIds) {
    const next = { ...heap, cardIds: [...cardIds] };
    state.heaps = (state.heaps || []).map((entry) => (entry.id === heap.id ? next : entry));
    return next;
  }

  function syncGridHeapState() {
    if (!gridContainer) return;
    const activeIds = new Set(getActiveHeap()?.cardIds || []);
    gridContainer.querySelectorAll(".mindmap-grid-card").forEach((card) => {
      const id = card.dataset.nodeId;
      if (!id) return;
      const inHeap = activeIds.has(id);
      card.classList.toggle("in-heap", inHeap);
      const button = card.querySelector(".mindmap-grid-heap-btn");
      if (button) {
        button.classList.toggle("in-heap", inHeap);
        button.setAttribute("aria-pressed", String(inHeap));
        button.title = inHeap ? "Remove from heap" : "Add to heap";
        button.textContent = inHeap ? "\u2713 In Heap" : "+ Heap";
      }
    });
  }

  async function flushHeapSave() {
    const pending = pendingHeapSave;
    pendingHeapSave = null;
    if (!pending || typeof addHeap !== "function") return;
    try {
      // The optimistic state is already correct. Chasing our own heap write
      // with a full database refresh is what made a single reorder rebuild the
      // whole library.
      suppressHeapDBRefresh = true;
      const saved = await addHeap({ ...pending, updatedAt: Date.now() });
      state.heaps = (state.heaps || []).map((entry) => (entry.id === saved.id ? saved : entry));
      renderHeapControls();
      syncGridHeapState();
    } catch (error) {
      suppressHeapDBRefresh = false;
      console.error("Failed to save heap:", error);
      dialog.alert("Failed to save heap: " + error.message);
    }
  }

  function scheduleHeapSave(heap) {
    pendingHeapSave = { ...heap, cardIds: [...(heap.cardIds || [])] };
    if (heapSaveTimer) clearTimeout(heapSaveTimer);
    heapSaveTimer = setTimeout(() => {
      heapSaveTimer = null;
      flushHeapSave();
    }, 300);
  }

  async function saveHeapCardIds(heap, cardIds) {
    if (!heap) return null;
    const next = applyHeapCardIds(heap, cardIds);
    renderHeapControls();
    syncGridHeapState();
    scheduleHeapSave(next);
    return next;
  }

  async function toggleCardInActiveHeap(cardId) {
    const ensured = await ensureActiveHeap();
    if (!ensured) return;
    // ensureActiveHeap resolves asynchronously. Re-read the heap after the
    // await so rapid taps each build on the previous tap's optimistic update
    // instead of all overwriting it with their own single-card list.
    const heap = getActiveHeap() || ensured;
    const cardIds = Array.isArray(heap.cardIds) ? heap.cardIds : [];
    const nextIds = cardIds.includes(cardId)
      ? cardIds.filter((id) => id !== cardId)
      : [...cardIds, cardId];
    try {
      await saveHeapCardIds(heap, nextIds);
    } catch (error) {
      console.error("Failed to update heap:", error);
      dialog.alert("Failed to update heap: " + error.message);
    }
  }

  async function removeHeapCard(cardId) {
    const heap = getActiveHeap();
    if (!heap) return;
    await saveHeapCardIds(heap, (heap.cardIds || []).filter((id) => id !== cardId));
  }

  async function moveHeapCard(cardId, delta) {
    const heap = getActiveHeap();
    if (!heap) return;
    const cardIds = [...(heap.cardIds || [])];
    const index = cardIds.indexOf(cardId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= cardIds.length) return;
    [cardIds[index], cardIds[nextIndex]] = [cardIds[nextIndex], cardIds[index]];
    await saveHeapCardIds(heap, cardIds);
  }

  function reorderHeapCard(cardId, insertPosition) {
    const heap = getActiveHeap();
    if (!heap) return;
    const cardIds = [...(heap.cardIds || [])];
    const from = cardIds.indexOf(cardId);
    if (from < 0) return;
    const target = Math.max(0, Math.min(cardIds.length - 1, insertPosition));
    if (target === from) return;
    cardIds.splice(from, 1);
    cardIds.splice(Math.min(target, cardIds.length), 0, cardId);
    const next = applyHeapCardIds(heap, cardIds);
    renderHeapControls();
    scheduleHeapSave(next);
  }

  function studyActiveHeap() {
    const heap = getActiveHeap();
    if (!heap) {
      dialog.alert("Create or select a heap first.");
      return;
    }
    if (getHeapCards(heap).length === 0) {
      dialog.alert("This heap is empty. Add some cards first.");
      return;
    }
    window.dispatchEvent(new CustomEvent("neuronet-open-tool", {
      detail: { tool: "memory", heapId: heap.id }
    }));
  }

  async function deleteActiveHeap() {
    const heap = getActiveHeap();
    if (!heap || typeof deleteHeap !== "function") return;
    const confirmed = await dialog.confirm(`Delete the heap "${heap.name}"? Cards and their SRS data are not affected.`, "Delete", "danger");
    if (!confirmed) return;
    try {
      await deleteHeap(heap.id);
      state.heaps = (state.heaps || []).filter((entry) => entry.id !== heap.id);
      state.activeHeapId = state.heaps[0]?.id || null;
      state.heapSidebarOpen = Boolean(state.activeHeapId);
      renderHeapControls();
      renderGrid();
    } catch (error) {
      console.error("Failed to delete heap:", error);
      dialog.alert("Failed to delete heap: " + error.message);
    }
  }

  function renderGrid() {
    if (!gridContainer) return;

    renderHeapControls();
    const decks = buildGridData();
    updateStats();
    gridView?.classList.toggle("selecting", state.librarySelectMode);
    updateLibrarySelectionUI();

    if (!decks.length) {
      const term = state.librarySearch.trim();
      const message = term
        ? `No cards match “${term}”. Try a different search.`
        : state.focusSubject
          ? `No cards in ${state.focusSubject} yet. Add cards in Memory or Quick Add to fill this deck.`
          : "No cards yet. Add cards in Memory or Quick Add to fill the grid.";
      gridContainer.innerHTML = `
        <div class="mindmap-grid-empty">
          <div class="mindmap-grid-empty-icon" aria-hidden="true">🃏</div>
          <p>${escapeHtml(message)}</p>
        </div>
      `;
      return;
    }

    let cardIndex = 0;
    const activeHeap = getActiveHeap();
    const activeHeapCardIds = new Set(activeHeap?.cardIds || []);
    const html = decks.map((section, sectionIndex) => {
      const groups = section.groups.map((group) => {
        const cards = group.cards.map((card) => {
          const inHeap = activeHeapCardIds.has(card.id);
          const importanceColor = card.priority
            ? GRID_IMPORTANCE_COLORS[card.priority]
            : "rgba(255, 255, 255, 0.14)";
          const recallScore = card.recall?.score;
          const accuracyScore = card.accuracy;
          const recallBin = getScoreBin(recallScore);
          const accuracyBin = getScoreBin(accuracyScore);
          const recallLabel = recallScore === null || recallScore === undefined
            ? "—"
            : `${Math.round(recallScore * 100)}%`;
          const accuracyLabel = accuracyScore === null || accuracyScore === undefined
            ? "—"
            : `${Math.round(accuracyScore * 100)}%`;
          const recallPrior = card.recall?.source === "prior" ? " prior" : "";
          const tagChips = card.tags
            .slice(0, 3)
            .map((tag) => `<span class="mindmap-grid-tag">#${escapeHtml(tag)}</span>`)
            .join("");
          const tagOverflow = card.tags.length > 3
            ? `<span class="mindmap-grid-tag">+${card.tags.length - 3}</span>`
            : "";
          const delay = Math.min(cardIndex * 16, 360);
          cardIndex += 1;
          const isSelected = state.selectedNodeId === card.id;
          const isMultiSelected = state.selectedCardIds.has(card.id);
          const titleAttr = [
            card.deck,
            card.priority ? `Priority ${card.priority}` : "No priority data",
            recallScore === null || recallScore === undefined
              ? "No recall data"
              : `${recallLabel} recall${recallPrior}`,
            accuracyScore === null || accuracyScore === undefined
              ? "No accuracy data"
              : `${accuracyLabel} accuracy`,
            card.tags.length ? card.tags.map((tag) => `#${tag}`).join(" ") : ""
          ].filter(Boolean).join(" · ");

          return `
            <div class="mindmap-grid-card${isSelected ? " selected" : ""}${isMultiSelected ? " multi-selected" : ""}${inHeap ? " in-heap" : ""}" role="button" tabindex="0" data-node-id="${escapeHtml(card.id)}"${state.librarySelectMode ? ` aria-pressed="${isMultiSelected}"` : ""} style="--importance-color: ${importanceColor}; animation-delay: ${delay}ms" title="${escapeHtml(titleAttr)}">
              <span class="mindmap-grid-check" aria-hidden="true">\u2713</span>
              <button type="button" class="mindmap-grid-heap-btn${inHeap ? " in-heap" : ""}" data-heap-card-id="${escapeHtml(card.id)}" aria-pressed="${inHeap}" title="${inHeap ? "Remove from heap" : "Add to heap"}">${inHeap ? "\u2713 In Heap" : "+ Heap"}</button>
              <span class="mindmap-grid-card-top">
                <span class="mindmap-grid-card-icon" aria-hidden="true">${card.icon}</span>
                <span class="mindmap-grid-card-type">${escapeHtml(card.typeLabel)}</span>
                ${card.priority ? `<span class="mindmap-grid-priority">P${card.priority}</span>` : ""}
              </span>
              <span class="mindmap-grid-card-title">${escapeHtml(card.title)}</span>
              ${card.preview ? `<span class="mindmap-grid-card-preview">${escapeHtml(card.preview)}</span>` : ""}
              <span class="mindmap-grid-card-footer">
                <span class="mindmap-grid-score${recallBin.index === -1 ? " is-unknown" : ""}" style="--score-color: ${recallBin.color}" title="Recall ${escapeHtml(recallLabel)}${escapeHtml(recallPrior)}">R ${recallLabel}</span>
                <span class="mindmap-grid-score${accuracyBin.index === -1 ? " is-unknown" : ""}" style="--score-color: ${accuracyBin.color}" title="Accuracy ${escapeHtml(accuracyLabel)}">A ${accuracyLabel}</span>
                ${tagChips}${tagOverflow}
              </span>
            </div>
          `;
        }).join("");

        return `
          <div class="mindmap-grid-group">
            ${section.showGroupHeads
              ? `<div class="mindmap-grid-group-head">${escapeHtml(group.name)}<span class="mindmap-grid-group-count">· ${group.cards.length}</span></div>`
              : ""}
            <div class="mindmap-grid-cards">${cards}</div>
          </div>
        `;
      }).join("");

      const groupMeta = section.showGroupHeads
        ? ` · ${section.groups.length} group${section.groups.length === 1 ? "" : "s"}`
        : "";

      const isCollapsed = state.collapsedDecks.has(section.deck);
      return `
        <section class="mindmap-grid-subject${isCollapsed ? " collapsed" : ""}" style="animation-delay: ${Math.min(sectionIndex * 40, 200)}ms">
          <header class="mindmap-grid-subject-head" data-deck-toggle="${escapeHtml(section.deck)}" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
            <span class="mindmap-grid-subject-dot" aria-hidden="true"></span>
            <span class="mindmap-grid-deck-caret" aria-hidden="true">${isCollapsed ? "\u25b8" : "\u25be"}</span>
            <h3>${escapeHtml(section.deck)}</h3>
            <span class="mindmap-grid-subject-meta">${section.count} card${section.count === 1 ? "" : "s"}${groupMeta}</span>
          </header>
          ${groups}
        </section>
      `;
    }).join("");

    gridContainer.innerHTML = html;
  }

  function groupCardsByType(cards) {
    const groups = [];
    const byType = new Map();
    cards.forEach((card) => {
      if (!byType.has(card.type)) {
        const group = { type: card.type, cards: [] };
        byType.set(card.type, group);
        groups.push(group);
      }
      byType.get(card.type).cards.push(card);
    });
    return groups;
  }

  function dotTargetScreenX(scene, layout) {
    const section = layout.sections[scene.dotSection];
    if (!section) return NaN;
    return section.contentX + scene.dotCol * layout.cell + layout.cell / 2;
  }

  function dotTargetScreenY(scene, layout) {
    const section = layout.sections[scene.dotSection];
    if (!section) return NaN;
    const groupTop = section.groupTops[scene.dotGroup];
    if (!Number.isFinite(groupTop)) return NaN;
    return groupTop + scene.dotRow * layout.cell + layout.cell / 2;
  }

  function screenToWorldX(x) {
    const centerX = viewWidth() / 2;
    return (x - centerX - state.panOffset.x) / state.zoom + centerX;
  }

  function screenToWorldY(y) {
    const centerY = viewHeight() / 2;
    return (y - centerY - state.panOffset.y) / state.zoom + centerY;
  }

  function applyDotsTargets() {
    const layout = state.dotsLayout;
    if (!layout || layout.empty) return;
    state.cardScene.forEach((scene) => {
      if (scene.dotSection < 0) return;
      const screenX = dotTargetScreenX(scene, layout);
      const screenY = dotTargetScreenY(scene, layout);
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
      scene.x = screenToWorldX(screenX);
      scene.y = screenToWorldY(screenY);
    });
  }

  function buildDotsLayout({ applyTargets = false } = {}) {
    if (!canvas) return;

    const { width, height } = syncCanvasSize();
    const sections = buildCardSections();
    const legendHeight = dotsLegend && !dotsLegend.hidden ? dotsLegend.offsetHeight + 10 : 6;
    const padX = Math.max(10, Math.min(24, width * 0.018));
    const top = legendHeight + 6;
    const bottom = 14;
    const availW = Math.max(80, width - padX * 2);
    const availH = Math.max(80, height - top - bottom);

    // Every layout pass reassigns slots. Cards outside the current scope keep
    // dotSection = -1 and are simply not drawn in Dots.
    state.cardScene.forEach((scene) => {
      scene.dotSection = -1;
      scene.dotGroup = 0;
      scene.dotRow = 0;
      scene.dotCol = 0;
    });

    if (!sections.length) {
      state.dotsLayout = {
        sections: [],
        width,
        height,
        radius: 0,
        cell: 0,
        top,
        empty: true
      };
      return;
    }

    const sectionCount = sections.length;
    const minSectionWidth = 180;
    const maxColumns = Math.max(1, Math.floor((availW + 10) / (minSectionWidth + 10)));
    const columns = Math.min(sectionCount, maxColumns);
    const colGap = Math.max(8, Math.min(14, availW * 0.012));
    const colW = (availW - colGap * (columns - 1)) / columns;

    let chosen = null;
    for (let cell = DOT_MAX_CELL; cell >= DOT_MIN_CELL; cell -= 1) {
      const radius = Math.max(2.2, Math.min(9.5, cell * 0.24));
      const sectionPad = Math.max(6, Math.round(cell * 0.4));
      const innerPad = Math.max(4, Math.round(cell * 0.35));
      const headerH = Math.max(20, Math.min(26, cell * 1.1));
      const typeGap = Math.max(4, Math.round(cell * 0.35));
      const contentW = Math.max(cell, colW - sectionPad * 2 - innerPad * 2);
      const perRow = Math.max(1, Math.floor(contentW / cell));

      const infos = sections.map((section) => {
        const groups = groupCardsByType(section.cards);
        let sectionHeight = sectionPad * 2 + headerH;
        groups.forEach((group, index) => {
          const rows = Math.ceil(group.cards.length / perRow);
          sectionHeight += rows * cell;
          if (index < groups.length - 1) sectionHeight += typeGap;
        });
        const maxGroupCards = Math.max(...groups.map((group) => group.cards.length));
        const blockWidth = Math.min(perRow, maxGroupCards) * cell;
        const offsetX = Math.max(0, (contentW - blockWidth) / 2);
        return { groups, perRow, height: sectionHeight, offsetX };
      });

      const colHeights = new Array(columns).fill(0);
      const placements = infos.map((info) => {
        let col = 0;
        for (let index = 1; index < columns; index += 1) {
          if (colHeights[index] < colHeights[col]) col = index;
        }
        const y = colHeights[col];
        colHeights[col] = y + info.height + colGap;
        return { ...info, col, y };
      });
      const maxHeight = Math.max(...colHeights);

      chosen = { cell, radius, sectionPad, innerPad, headerH, typeGap, perRow, infos, placements, maxHeight };
      if (maxHeight <= availH) break;
    }

    const layoutSections = [];

    sections.forEach((section, sectionIndex) => {
      const placement = chosen.placements[sectionIndex];
      const x = padX + placement.col * (colW + colGap);
      const y = top + placement.y;
      const contentX = x + chosen.sectionPad + chosen.innerPad + placement.offsetX;
      const groupTops = [];
      let cursorY = y + chosen.sectionPad + chosen.headerH;

      placement.groups.forEach((group, groupIndex) => {
        groupTops.push(cursorY);
        group.cards.forEach((card, cardIndex) => {
          const scene = state.cardScene.get(card.id);
          if (!scene) return;
          scene.dotSection = sectionIndex;
          scene.dotGroup = groupIndex;
          scene.dotRow = Math.floor(cardIndex / placement.perRow);
          scene.dotCol = cardIndex % placement.perRow;
        });
        cursorY += Math.ceil(group.cards.length / placement.perRow) * chosen.cell;
        if (groupIndex < placement.groups.length - 1) cursorY += chosen.typeGap;
      });

      layoutSections.push({
        deck: section.deck,
        count: section.count,
        x,
        y,
        w: colW,
        h: placement.height,
        contentX,
        groupTops,
        groupPerRow: placement.perRow
      });
    });

    state.dotsLayout = {
      sections: layoutSections,
      width,
      height,
      radius: chosen.radius,
      cell: chosen.cell,
      top,
      maxHeight: chosen.maxHeight,
      canScroll: top + chosen.maxHeight + bottom > height,
      basePanY: state.panOffset.y,
      empty: false
    };
    clampDotsScroll();

    if (applyTargets) applyDotsTargets();
  }

  function clampDotsScroll() {
    const layout = state.dotsLayout;
    if (!layout || layout.empty || !layout.canScroll) return;
    const overflow = Math.max(0, layout.top + layout.maxHeight + 14 - layout.height);
    const min = layout.basePanY - overflow;
    const max = layout.basePanY;
    state.panOffset.y = Math.min(max, Math.max(min, state.panOffset.y));
  }

  function scrollDots(deltaY) {
    const layout = state.dotsLayout;
    if (!layout || layout.empty || !layout.canScroll) return false;
    state.userInteracted = true;
    state.panOffset.y -= deltaY;
    clampDotsScroll();
    return true;
  }

  function captureCardHomes() {
    state.cardScene.forEach((scene) => {
      if (!Number.isFinite(scene.x) || !Number.isFinite(scene.y)) return;
      scene.homeX = scene.x;
      scene.homeY = scene.y;
      scene.homeValid = true;
    });
  }

  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function startSceneTransition(mode) {
    const now = performance.now();
    state.cardScene.forEach((scene) => {
      scene.transitionFromX = Number.isFinite(scene.x)
        ? scene.x
        : (scene.homeValid ? scene.homeX : 0);
      scene.transitionFromY = Number.isFinite(scene.y)
        ? scene.y
        : (scene.homeValid ? scene.homeY : 0);
    });
    state.sceneTransition = {
      mode,
      // Reduced motion keeps the state change but skips the morph: starting
      // the clock in the past lets the first tick land on the final frame.
      start: prefersReducedMotion() ? now - DOT_MORPH_MS : now,
      duration: DOT_MORPH_MS,
      t: prefersReducedMotion() ? 1 : 0,
      // Keep the camera exactly where the learner left it. If the camera was
      // still auto-fitting before Dots, it resumes fitting after the return;
      // if they had taken control, it stays put.
      userInteracted: state.userInteracted
    };
    state.velocities.forEach((velocity) => {
      velocity.x = 0;
      velocity.y = 0;
    });
  }

  function finishSceneTransition() {
    const transition = state.sceneTransition;
    if (!transition) return;
    if (transition.mode === "to-dots") {
      applyDotsTargets();
      state.viewMode = "dots";
    } else {
      state.cardScene.forEach((scene) => {
        if (!scene.homeValid) return;
        scene.x = scene.homeX;
        scene.y = scene.homeY;
      });
      state.viewMode = "graph";
      state.userInteracted = Boolean(transition.userInteracted);
    }
    state.sceneTransition = null;
  }

  function updateSceneTransition(now) {
    const transition = state.sceneTransition;
    if (!transition) return;
    const t = clamp01Number((now - transition.start) / transition.duration);
    transition.t = t;
    const eased = easeInOutCubic(t);

    if (transition.mode === "to-dots") {
      const layout = state.dotsLayout;
      state.cardScene.forEach((scene) => {
        const fromX = scene.transitionFromX;
        const fromY = scene.transitionFromY;
        if (!layout || layout.empty || scene.dotSection < 0) {
          scene.x = fromX;
          scene.y = fromY;
          return;
        }
        const screenX = dotTargetScreenX(scene, layout);
        const screenY = dotTargetScreenY(scene, layout);
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
          scene.x = fromX;
          scene.y = fromY;
          return;
        }
        const targetX = screenToWorldX(screenX);
        const targetY = screenToWorldY(screenY);
        scene.x = fromX + (targetX - fromX) * eased;
        scene.y = fromY + (targetY - fromY) * eased;
      });
    } else {
      // Cards return first. Knowledge nodes stay hidden until the cards have
      // landed, so the graph never assembles underneath a moving card field.
      const cardT = easeInOutCubic(clamp01Number(t / 0.7));
      state.cardScene.forEach((scene) => {
        const targetX = scene.homeValid ? scene.homeX : scene.transitionFromX;
        const targetY = scene.homeValid ? scene.homeY : scene.transitionFromY;
        scene.x = scene.transitionFromX + (targetX - scene.transitionFromX) * cardT;
        scene.y = scene.transitionFromY + (targetY - scene.transitionFromY) * cardT;
      });
    }

    if (t >= 1) finishSceneTransition();
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(x, y, width, height, r);
      return;
    }
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function truncateCanvasText(context, text, maxWidth) {
    const value = String(text || "");
    if (context.measureText(value).width <= maxWidth) return value;
    let shortened = value;
    while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened}…`;
  }

  function findCardSceneAtScreenPosition(x, y) {
    const layout = state.dotsLayout;
    if (!layout || layout.empty) return null;

    const centerX = viewWidth() / 2;
    const centerY = viewHeight() / 2;
    // At the minimum cell size a dot is only a few pixels wide. Grow the
    // invisible hit target so touch users can still select it; nearest-dot
    // resolution keeps overlapping targets deterministic.
    const hitRadius = Math.max(14, Math.min(22, layout.cell * 0.5));
    let best = null;
    let bestDistance = Infinity;

    state.cardScene.forEach((scene) => {
      if (scene.dotSection < 0 || !isCardInScope(scene.card)) return;
      const screenX = centerX + (scene.x - centerX) * state.zoom + state.panOffset.x;
      const screenY = centerY + (scene.y - centerY) * state.zoom + state.panOffset.y;
      const dx = x - screenX;
      const dy = y - screenY;
      const distance = dx * dx + dy * dy;
      if (distance <= hitRadius * hitRadius && distance < bestDistance) {
        best = scene;
        bestDistance = distance;
      }
    });

    return best;
  }

  function drawCardTooltip(scene, screenX, screenY, width, height, top) {
    const card = scene.item;
    if (!card) return;
    const layout = state.dotsLayout;
    const recallScore = card.recall?.score;
    const recall = recallScore === null || recallScore === undefined
      ? "no recall"
      : `${Math.round(recallScore * 100)}% recall${card.recall.source === "prior" ? " prior" : ""}`;
    const accuracy = card.accuracy === null
      ? "no accuracy"
      : `${Math.round(card.accuracy * 100)}% accuracy`;
    const priority = card.priority ? `P${card.priority}` : "no priority";
    const deck = card.deck ? ` · ${card.deck}` : "";
    const tags = card.tags.slice(0, 4).map((tag) => `#${tag}`).join(" ");
    const maxTextWidth = Math.min(360, width - 48);
    const dotRadius = layout?.radius || 6;

    ctx.save();
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    const title = truncateCanvasText(ctx, card.title, maxTextWidth);
    const meta = truncateCanvasText(
      ctx,
      `${card.typeLabel}${deck} · ${priority} · ${recall} · ${accuracy}`,
      maxTextWidth
    );
    const tagLine = tags ? truncateCanvasText(ctx, tags, maxTextWidth) : "";
    const lines = [title, meta, tagLine].filter(Boolean);

    let textWidth = 0;
    lines.forEach((line, index) => {
      ctx.font = index === 0
        ? "600 12px Inter, system-ui, sans-serif"
        : "11px Inter, system-ui, sans-serif";
      textWidth = Math.max(textWidth, ctx.measureText(line).width);
    });

    const boxWidth = Math.max(120, textWidth + 20);
    const boxHeight = 14 + lines.length * 15;
    let boxX = screenX + dotRadius + 14;
    if (boxX + boxWidth > width - 8) boxX = screenX - boxWidth - dotRadius - 14;
    boxX = Math.max(8, Math.min(width - boxWidth - 8, boxX));
    const boxY = Math.max(top + 4, Math.min(height - boxHeight - 8, screenY - boxHeight / 2));

    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 8);
    ctx.fillStyle = "rgba(7, 18, 13, 0.97)";
    ctx.fill();
    ctx.strokeStyle = "rgba(44, 255, 179, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.font = index === 0
        ? "600 12px Inter, system-ui, sans-serif"
        : "11px Inter, system-ui, sans-serif";
      ctx.fillStyle = index === 0
        ? "rgba(230, 255, 245, 0.95)"
        : "rgba(230, 255, 245, 0.6)";
      ctx.fillText(line, boxX + 10, boxY + 7 + index * 15);
    });
    ctx.restore();
  }

  function drawDotsSections(layout, alpha) {
    if (!layout || layout.empty || alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    layout.sections.forEach((section) => {
      drawRoundedRect(ctx, section.x, section.y, section.w, section.h, 10);
      ctx.fillStyle = "rgba(10, 30, 22, 0.5)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 107, 107, 0.13)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.beginPath();
      ctx.arc(section.x + 11, section.y + 14, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 107, 107, 0.85)";
      ctx.fill();

      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(230, 255, 245, 0.82)";
      ctx.fillText(
        truncateCanvasText(ctx, section.deck, Math.max(40, section.w - 58)),
        section.x + 18,
        section.y + 14
      );

      ctx.textAlign = "right";
      ctx.font = "500 10px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(230, 255, 245, 0.42)";
      ctx.fillText(String(section.count), section.x + section.w - 10, section.y + 14);
      ctx.restore();
    });

    ctx.restore();
  }

  function drawDotsEmpty(width, height, alpha, top) {
    if (alpha <= 0.01) return;
    const centerY = top + (height - top) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(230, 255, 245, 0.55)";
    ctx.font = "600 15px Inter, system-ui, sans-serif";
    ctx.fillText("No cards to chart yet", width / 2, centerY - 10);
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(230, 255, 245, 0.38)";
    ctx.fillText("Add cards in Memory or Quick Add to see them here.", width / 2, centerY + 14);
    ctx.restore();
  }

  function drawDotsScrollHint(layout, alpha, width, height) {
    if (!layout || layout.empty || !layout.canScroll || alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = "\u2195 Scroll for more";
    const boxWidth = ctx.measureText(label).width + 20;
    const boxHeight = 22;
    const boxX = width - boxWidth - 12;
    const boxY = height - boxHeight - 10;
    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 11);
    ctx.fillStyle = "rgba(7, 18, 13, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(44, 255, 179, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 255, 245, 0.62)";
    ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.5);
    ctx.restore();
  }

  function drawCardScene(scene, morph, alpha, now) {
    if (!isCardInScope(scene.card)) return;
    const layout = state.dotsLayout;
    if (morph > 0.999 && (!layout || layout.empty || scene.dotSection < 0)) return;

    const centerX = viewWidth() / 2;
    const centerY = viewHeight() / 2;
    const screenX = centerX + (scene.x - centerX) * state.zoom + state.panOffset.x;
    const screenY = centerY + (scene.y - centerY) * state.zoom + state.panOffset.y;

    const isHovered = state.hoveredNodeId === scene.id;
    const isSelected = state.selectedNodeId === scene.id;
    const visibility = state.nodeVisibility.get(scene.id) ?? 1;
    const lockLevel = getLockLevel(scene.id);
    if (visibility < 0.02 && morph < 0.01) return;

    // Graph cards use exactly the same radius, reveal scale, border width and
    // zoom behaviour as knowledge nodes. Only the dot end of the morph gets
    // the compact score-dot sizing.
    const baseRadius = isHovered || isSelected ? config.nodeHoverRadius : config.nodeRadius;
    const revealScale = 0.55 + 0.45 * visibility;
    const graphRadius = baseRadius * state.zoom * revealScale;
    const dotRadius = (layout?.radius || graphRadius)
      * (isHovered ? 1.35 : 1)
      * (isSelected ? 1.12 : 1);
    const radius = graphRadius + (dotRadius - graphRadius) * morph;
    const graphBorder = isSelected ? 3 : 2;
    const dotBorder = isSelected
      ? 2.5
      : Math.max(1.2, Math.min(2.4, (layout?.cell || 8) * 0.085));
    const borderWidth = graphBorder + (dotBorder - graphBorder) * morph;
    // Keep the importance ring visually separate from the score fill. The
    // gap is structure, not another data channel.
    const fillRadius = Math.max(1.2, radius - borderWidth - 0.35);

    // Graph nodes are hollow: dark fill plus a coloured ring. Cards follow
    // that until Dots fills them with the two score colours.
    const recallRgb = mixRgb(CARD_GRAPH_FILL_RGB, scene.recallRgb, morph);
    const accuracyRgb = mixRgb(CARD_GRAPH_FILL_RGB, scene.accuracyRgb, morph);
    const priorityRgb = scene.priorityRgb || [255, 255, 255];
    const borderRgb = mixRgb(CARD_COLOR_RGB, priorityRgb, morph);
    const borderAlpha = scene.priorityRgb ? 1 : 1 - 0.76 * morph;
    const cardAlpha = alpha * ((1 - morph) * visibility + morph);

    ctx.save();
    ctx.globalAlpha = cardAlpha;

    if ((isHovered || isSelected) && morph > 0.01) {
      ctx.globalAlpha = cardAlpha * morph;
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "rgba(255, 255, 255, 0.07)" : "rgba(44, 255, 179, 0.08)";
      ctx.fill();
      ctx.globalAlpha = cardAlpha;
    }

    // Right half: accuracy. Paint the full inner disc first, then overwrite
    // the left half with recall. At morph 0 both halves are the same dark
    // hollow fill as a knowledge node.
    ctx.globalAlpha = cardAlpha * (0.9 + 0.1 * morph);
    ctx.beginPath();
    ctx.arc(screenX, screenY, fillRadius, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(accuracyRgb);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(screenX, screenY, fillRadius, Math.PI / 2, Math.PI * 1.5, false);
    ctx.closePath();
    ctx.fillStyle = rgbCss(recallRgb);
    ctx.fill();
    ctx.globalAlpha = cardAlpha;

    if (morph > 0.05 && fillRadius >= 1.5) {
      ctx.globalAlpha = cardAlpha * morph;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - fillRadius);
      ctx.lineTo(screenX, screenY + fillRadius);
      ctx.strokeStyle = "rgba(7, 18, 13, 0.9)";
      ctx.lineWidth = Math.max(1, Math.min(1.5, fillRadius * 0.2));
      ctx.stroke();
      ctx.globalAlpha = cardAlpha;
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = scene.priorityRgb
      ? rgbCss(borderRgb)
      : `rgba(${borderRgb[0] | 0}, ${borderRgb[1] | 0}, ${borderRgb[2] | 0}, ${borderAlpha})`;
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    if (lockLevel > 0.01) {
      // Cards use the same filled-when-locked language in Graph view. Dots
      // are already filled by score, so the gold containment ring carries the
      // state there without fighting the data colour.
      if (morph < 0.98) {
        ctx.beginPath();
        ctx.arc(screenX, screenY, Math.max(1, fillRadius - 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${CARD_COLOR_RGB[0]}, ${CARD_COLOR_RGB[1]}, ${CARD_COLOR_RGB[2]}, ${0.26 * lockLevel * (1 - morph)})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius + 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${CARD_COLOR_RGB[0]}, ${CARD_COLOR_RGB[1]}, ${CARD_COLOR_RGB[2]}, ${0.5 * lockLevel})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    if (isSelected && morph > 0.01) {
      ctx.globalAlpha = cardAlpha * morph;
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius + 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.globalAlpha = cardAlpha;
    }

    // Graph labels follow the same zoom, density and type-size rules as the
    // knowledge nodes. Dots use the hover tooltip instead of permanent text.
    const labelAlpha = cardAlpha * (1 - morph);
    const isDenseGlobal = !state.focusSubject && state.graph.nodes.size > 70;
    const densityBoost = isDenseGlobal ? 0.3 : 0;
    const labelThreshold = (config.labelZoomThresholds.card || 1.0) + densityBoost;
    const labelsVisible = !(isDenseGlobal && state.zoom < 1.35)
      && state.zoom >= labelThreshold;
    if (labelAlpha > 0.02 && labelsVisible) {
      const fontSize = 12 * Math.max(0.8, Math.min(1.6, state.zoom));
      ctx.globalAlpha = labelAlpha;
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(230, 255, 245, 0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const maxChars = Math.max(8, Math.floor(18 / Math.max(0.35, state.zoom)));
      const title = scene.item?.title || "Untitled Card";
      const displayTitle = title.length > maxChars
        ? title.substring(0, maxChars - 2) + "..."
        : title;
      ctx.fillText(displayTitle, screenX, screenY + config.labelOffset * state.zoom);
    }

    ctx.restore();
  }

  let lastLockFxAt = 0;

  function updateLockEffects(now) {
    const dt = lastLockFxAt ? Math.min(48, Math.max(0, now - lastLockFxAt)) : 16.7;
    lastLockFxAt = now;
    // Frame-rate independent easing: the fill reaches its target in roughly
    // the same wall-clock time at 60Hz and 120Hz.
    const easing = 1 - Math.pow(0.82, dt / 16.67);
    state.lockVisuals.forEach((visual, id) => {
      const delta = visual.target - visual.level;
      if (Math.abs(delta) <= 0.004) {
        visual.level = visual.target;
        state.lockVisuals.delete(id);
        return;
      }
      visual.level += delta * easing;
    });

    if (state.lockParticles.length) {
      state.lockParticles = state.lockParticles.filter((particle) => {
        particle.age += dt;
        if (particle.age >= particle.ttl) return false;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.rotation += particle.spin * dt;
        return true;
      });
    }
    if (state.lockRings.length) {
      state.lockRings = state.lockRings.filter((ring) => {
        ring.age += dt;
        return ring.age < ring.ttl;
      });
    }
  }

  function drawLockEffects() {
    if (!state.lockParticles.length && !state.lockRings.length) return;
    ctx.save();
    state.lockRings.forEach((ring) => {
      const t = clamp01Number(ring.age / ring.ttl);
      const radius = ring.from + (ring.to - ring.from) * (1 - Math.pow(1 - t, 2));
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${ring.rgb[0]}, ${ring.rgb[1]}, ${ring.rgb[2]}, 0.9)`;
      ctx.lineWidth = 0.5 + (1 - t) * 1.6;
      ctx.stroke();
    });
    state.lockParticles.forEach((particle) => {
      const t = clamp01Number(particle.age / particle.ttl);
      const size = particle.size * (1 - 0.32 * t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = `rgb(${particle.rgb[0]}, ${particle.rgb[1]}, ${particle.rgb[2]})`;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    });
    ctx.restore();
  }

  function renderScene(now) {
    if (!ctx || !canvas) return;

    const { width, height } = syncCanvasSize();
    updateLockEffects(now);
    if (
      (state.viewMode === "dots" || state.sceneTransition?.mode === "to-dots")
      && (!state.dotsLayout
        || state.dotsLayout.width !== width
        || state.dotsLayout.height !== height)
    ) {
      buildDotsLayout({ applyTargets: !state.sceneTransition });
    }
    ctx.clearRect(0, 0, width, height);

    const transition = state.sceneTransition;
    let morph = 0;
    let knowledgeAlpha = 1;
    let chromeAlpha = 0;

    if (transition) {
      const t = transition.t;
      if (transition.mode === "to-dots") {
        morph = easeInOutCubic(t);
        knowledgeAlpha = 1 - smoothstep(t / 0.75);
        chromeAlpha = smoothstep((t - 0.2) / 0.8);
      } else {
        morph = 1 - easeInOutCubic(clamp01Number(t / 0.7));
        knowledgeAlpha = smoothstep((t - 0.7) / 0.3);
        chromeAlpha = 1 - smoothstep(t / 0.45);
      }
    } else if (state.viewMode === "dots") {
      morph = 1;
      knowledgeAlpha = 0;
      chromeAlpha = 1;
    }

    if (knowledgeAlpha > 0.01) drawKnowledgeScene(now, knowledgeAlpha);
    if (chromeAlpha > 0.01) drawDotsSections(state.dotsLayout, chromeAlpha);
    if (chromeAlpha > 0.01 && (!state.dotsLayout || state.dotsLayout.empty)) {
      drawDotsEmpty(width, height, chromeAlpha, state.dotsLayout?.top || 0);
    }
    if (chromeAlpha > 0.01) {
      drawDotsScrollHint(state.dotsLayout, chromeAlpha, width, height);
    }

    state.cardScene.forEach((scene) => {
      drawCardScene(scene, morph, 1, now);
    });

    // Lock feedback is drawn in screen space so the little crystal squares
    // keep a stable size while the camera is at any zoom level.
    drawLockEffects();

    if (state.hoveredNodeId) {
      const hovered = state.cardScene.get(state.hoveredNodeId);
      if (hovered && hovered.dotSection >= 0 && (morph > 0.5 || state.viewMode === "dots")) {
        const centerX = viewWidth() / 2;
        const centerY = viewHeight() / 2;
        drawCardTooltip(
          hovered,
          centerX + (hovered.x - centerX) * state.zoom + state.panOffset.x,
          centerY + (hovered.y - centerY) * state.zoom + state.panOffset.y,
          width,
          height,
          state.dotsLayout?.top || 0
        );
      }
    }
  }

  function updateEmptyState() {
    if (!emptyState) return;

    if (state.viewMode === "grid" || state.viewMode === "dots") {
      emptyState.style.display = "none";
      return;
    }

    const visibleItems = getAllItems().filter((item) => {
      const node = state.graph.nodes.get(item.id);
      return isNodeInScope(item.id) && nodeMatchesGraphFilter(node);
    });
    const hasVisibleCards = [...state.cardScene.values()]
      .some((scene) => isCardInScope(scene.card) && nodeMatchesGraphFilter(state.graph.nodes.get(scene.id)));

    if (visibleItems.length > 0 || hasVisibleCards) {
      emptyState.style.display = "none";
      return;
    }

    emptyState.style.display = "flex";
    const copy = emptyState.querySelector("p");
    if (copy) {
      const filtering = state.graphSearch.trim() || state.graphTypeFilter !== "all";
      copy.textContent = filtering
        ? "No nodes match the current search or filter. Clear it to see the graph again."
        : state.focusSubject
          ? `No nodes in ${state.focusSubject} yet. Add a source, quote, or analysis to grow this subject.`
          : "No nodes yet. Add sources, quotes, and analyses to see your knowledge network.";
    }
  }

  function updateContextualActions() {
    const isGraph = state.viewMode === "graph";
    [connectNodesBtn, relayoutGraphBtn, newNodeDropdown].forEach((element) => {
      if (element) element.hidden = !isGraph;
    });
    [graphToolbar].forEach((element) => {
      if (element) element.hidden = !isGraph;
    });
    if (!isGraph) newNodeDropdown?.classList.remove("open");
  }

  function setViewMode(nextMode) {
    const mode = nextMode === "dots" ? "dots" : nextMode === "grid" ? "grid" : "graph";
    const previousMode = state.viewMode;
    const changed = previousMode !== mode;
    state.viewMode = mode;
    updateContextualActions();
    // Lock mode only makes sense while nodes are visible. Leaving Graph
    // returns to normal inspection instead of leaving taps in a strange state.
    if (mode !== "graph" && state.lockMode) setLockMode(false, { announce: false });
    if (mode !== "grid") {
      state.librarySelectMode = false;
      state.selectedCardIds.clear();
    }

    if (viewToggle) {
      viewToggle.querySelectorAll(".view-toggle-btn").forEach((button) => {
        const isActive = button.dataset.view === mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    if (gridView) gridView.hidden = mode !== "grid";
    if (dotsLegend) dotsLegend.hidden = mode !== "dots";
    updateHeapSidebarVisibility();
    if (canvas) {
      canvas.style.opacity = mode === "grid" ? "0" : "1";
      canvas.style.pointerEvents = mode === "grid" ? "none" : "";
    }

    state.hoveredNodeId = null;
    state.draggingNodeId = null;
    state.isPanning = false;
    state.hasDragged = false;
    const activeTransition = state.sceneTransition;

    if (mode === "dots") {
      if (changed) {
        // Capture the exact pre-Dots graph positions once. A return trip in
        // progress already has valid homes and must not overwrite them with
        // an in-between position.
        if (previousMode === "graph" && activeTransition?.mode !== "to-graph") {
          captureCardHomes();
        }
        if (![...state.cardScene.values()].every((scene) => scene.homeValid)) {
          captureCardHomes();
        }
        buildDotsLayout({ applyTargets: false });
        startSceneTransition("to-dots");
      }
    } else if (mode === "graph") {
      if (changed) {
        if (previousMode === "grid") {
          // Grid hides the canvas, so restore immediately instead of running
          // a transition nobody can see.
          state.sceneTransition = null;
          state.cardScene.forEach((scene) => {
            if (!scene.homeValid) return;
            scene.x = scene.homeX;
            scene.y = scene.homeY;
          });
          state.userInteracted = false;
        } else {
          if (![...state.cardScene.values()].every((scene) => scene.homeValid)) {
            captureCardHomes();
          }
          startSceneTransition("to-graph");
        }
      }
    } else {
      // Grid is card-only and covers the canvas. Leaving Dots restores the
      // graph homes immediately; the next Graph view is already correct.
      if (previousMode === "dots" || activeTransition?.mode === "to-dots") {
        state.cardScene.forEach((scene) => {
          if (!scene.homeValid) return;
          scene.x = scene.homeX;
          scene.y = scene.homeY;
        });
      }
      state.sceneTransition = null;
      state.dotsLayout = null;
    }

    if (mode === "grid" || mode === "dots") {
      updateEmptyState();
      if (state.isConnecting) {
        state.isConnecting = false;
        state.connectingSourceId = null;
        document.getElementById("connectNodesBtn")?.classList.remove("active");
        document.getElementById("connectingOverlay")?.classList.remove("visible");
      }
    }

    if (mode === "grid") {
      renderGrid();
    } else if (mode === "dots") {
      // The transition was started above; renderScene handles both surfaces.
    } else if (changed) {
      if (!state.sceneTransition) state.userInteracted = false;
      updateEmptyState();
    }
    updateStats();
    updateGraphSearchStatus();
    scheduleLayoutSave();
  }

  function renderSidebar(selectedItem) {
    if (!selectedItem) return;

    const isCard = selectedItem.type === "card";
    sidebarTitle.textContent = getNodeDisplayTitle(selectedItem);
    sidebarType.innerHTML = inspectorTypeMarkup(selectedItem);
    updateLockControls();

    if (editNodeBtn) editNodeBtn.textContent = isCard ? "Open in Memory" : "Edit";
    if (deleteNodeBtn) {
      deleteNodeBtn.hidden = false;
      deleteNodeBtn.textContent = isCard ? "Delete Card" : "Delete";
    }

    const isMeta = state.sidebarView === "metadata";
    if (sidebarContentLabel) sidebarContentLabel.textContent = isMeta ? "Metadata" : "Content";
    if (toggleMetadataBtn) toggleMetadataBtn.textContent = isMeta ? "Content" : "Metadata";

    if (fullContent) fullContent.style.display = isMeta ? "none" : "block";
    if (metaContent) metaContent.style.display = isMeta ? "block" : "none";

    if (fullContent) {
      const isSource = selectedItem.type === "source";
      fullContent.classList.toggle("is-plain", !isSource);
      if (isSource) {
        const markdown = sourceMarkdown(selectedItem);
        try {
          fullContent.innerHTML = markdown.trim()
            ? renderMarkdown(parse(markdown), "html", { softBreaks: sourceSoftBreaks(selectedItem) })
            : "";
          renderMathWithKatex(fullContent);
        } catch (error) {
          console.warn("mindmap: markdown render failed, falling back to plain text", error);
          fullContent.classList.add("is-plain");
          fullContent.textContent = getNodeFullContent(selectedItem);
        }
      } else {
        fullContent.textContent = getNodeFullContent(selectedItem);
      }
    }
    if (metaContent) {
      metaContent.classList.add("is-plain");
      metaContent.textContent = formatMetadataHumanReadable(selectedItem);
    }

    // Render Connections. Cards are not part of the knowledge graph, so there
    // is no connection list to show; explain that instead of leaving a blank
    // panel that looks broken on a touch device.
    const connectionsContainer = document.getElementById("connectionsContainer");
    const connectionsEmpty = document.getElementById("connectionsEmpty");
    const connectionsItems = document.getElementById("connectionsItems");
    const connectionCount = document.getElementById("connectionCount");
    const connectionTabCount = document.getElementById("connectionTabCount");
    const graphNode = state.graph.nodes.get(selectedItem.id);
    const setConnectionsEmpty = (message) => {
      if (!connectionsEmpty) return;
      connectionsEmpty.hidden = !message;
      connectionsEmpty.textContent = message || "";
    };

    if (connectionsContainer) connectionsContainer.hidden = !graphNode;

    if (connectionsItems && connectionCount) {
      if (!graphNode) {
        connectionCount.textContent = "0";
        if (connectionTabCount) connectionTabCount.textContent = "0";
        connectionsItems.innerHTML = "";
        setConnectionsEmpty(isCard
          ? "Cards do not have graph connections yet. Open the source, quote, or analysis they belong to, or connect knowledge nodes in Graph view."
          : "This item has no graph connections yet. Use Connect Nodes in Graph view to link it.");
      } else {
        const neighbors = Array.from(graphNode.connections);
        connectionCount.textContent = neighbors.length;
        if (connectionTabCount) connectionTabCount.textContent = String(neighbors.length);
        connectionsItems.innerHTML = "";
        setConnectionsEmpty(neighbors.length === 0
          ? "No connections yet. Select Connect Nodes in Graph view, then tap this node and a target node to link them."
          : "");

        neighbors.forEach(neighborId => {
          const neighbor = findItemById(neighborId);
          if (!neighbor) return;

          const itemEl = document.createElement("div");
          itemEl.className = "connection-item";
          itemEl.innerHTML = `
            <div class="connection-info">
              <span>${getNodeTypeIcon(neighbor.type)}</span>
              <span class="connection-name">${escapeHtml(getNodeDisplayTitle(neighbor))}</span>
            </div>
            <button class="btn-break" title="Break Connection" data-target-id="${escapeHtml(neighborId)}">&times;</button>
          `;

          itemEl.querySelector(".btn-break").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (await dialog.confirm(`Break connection to "${getNodeDisplayTitle(neighbor)}"?`)) {
              breakLink(selectedItem.id, neighborId);
            }
          });

          itemEl.addEventListener("click", () => {
            openNodeSidebar(neighborId);
          });

          connectionsItems.appendChild(itemEl);
        });
      }
    }

    // Render Tags
    renderSidebarTags(selectedItem);
  }

  function renderSidebarTags(item) {
    const sidebarContent = document.querySelector(".sidebar-content");
    let tagsContainer = document.getElementById("sidebarTagsContainer");

    if (!tagsContainer) {
      tagsContainer = document.createElement("div");
      tagsContainer.id = "sidebarTagsContainer";
      tagsContainer.className = "tags-section";
      sidebarContent.appendChild(tagsContainer);
    }

    const isCard = item.type === "card";
    const tags = isCard
      ? (Array.isArray(item.tags) ? item.tags : [])
      : (item.meta?.tags || []);

    if (isCard && !tags.length) {
      tagsContainer.hidden = true;
      tagsContainer.innerHTML = "";
      return;
    }
    tagsContainer.hidden = false;

    tagsContainer.innerHTML = `
      <div class="tags-header">Tags</div>
      <div class="tags-list">
        ${tags.map(tag => `
          <div class="tag-pill">
            <span>${escapeHtml(tag)}</span>
            ${isCard ? "" : `<button class="tag-remove" data-tag="${escapeHtml(tag)}">&times;</button>`}
          </div>
        `).join("")}
        ${isCard ? "" : `<button id="addTagBtn" class="tag-add-pill">+ Add Tag</button>`}
      </div>
    `;

    if (isCard) return;

    tagsContainer.querySelectorAll(".tag-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTagFromNode(item, btn.dataset.tag);
      });
    });

    const addBtn = document.getElementById("addTagBtn");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const tagName = await dialog.prompt("Enter tag name:");
        if (tagName) {
          addTagToNode(item, tagName);
        }
      });
    }
  }

  async function addTagToNode(item, tagName) {
    if (!item.meta) item.meta = {};
    if (!item.meta.tags) item.meta.tags = [];

    const normalized = tagName.trim();
    if (!normalized) return;

    // Ensure tag exists in DB
    const existingTags = state.tags || [];
    let tag = existingTags.find(t => t.title.toLowerCase() === normalized.toLowerCase());
    if (!tag) {
      tag = await addTag({ title: normalized });
    }

    if (!item.meta.tags.includes(tag.title)) {
      item.meta.tags.push(tag.title);
      await saveItem(item);
      await refreshData();
      if (state.selectedNodeId === item.id) renderSidebar(item);
    }
  }

  async function removeTagFromNode(item, tagName) {
    if (item.meta && item.meta.tags) {
      item.meta.tags = item.meta.tags.filter(t => t !== tagName);
      await saveItem(item);
      await refreshData();
      if (state.selectedNodeId === item.id) renderSidebar(item);
    }
  }

  async function saveItem(item) {
    if (item.type === "quote") await addQuote(item);
    else if (item.type === "cue") await addCue(item);
    else await addNode(item);
  }

  function buildGraph() {
    const graph = { nodes: new Map(), edges: [] };
    ensureCardSceneObjects();
    const items = getAllItems();
    const subjectNodes = items.filter(n => n.type === "subject");
    const layers = items.filter(n => n.type?.startsWith("layer"));
    const sources = items.filter(n => n.type === "source");
    const quotes = items.filter(n => n.type === "quote");
    const analyses = items.filter(n => n.type === "analysis");
    const cues = items.filter(n => n.type === "cue");
    const pastpapers = items.filter(n => n.type === "pastpaper");

    // Subject and tag lookups used to scan the whole list once per node. Both
    // are keyed maps now, so graph construction stays close to linear.
    const subjectByName = new Map();
    subjectNodes.forEach((subject) => {
      const key = normalizeSubjectName(subject.subject || subject.title);
      if (key && !subjectByName.has(key)) subjectByName.set(key, subject);
    });
    const findSubject = (name) => subjectByName.get(normalizeSubjectName(name)) || null;
    const tagByTitle = new Map();
    (state.tags || []).forEach((tag) => {
      const key = String(tag.title || "").trim().toLowerCase();
      if (key && !tagByTitle.has(key)) tagByTitle.set(key, tag);
    });
    const quoteIds = new Set(quotes.map((quote) => quote.id));
    // Analyses whose link is recorded on the quote side. Precomputed once so
    // the per-analysis check is not a scan of every quote.
    const analysesWithQuoteParent = new Set();
    quotes.forEach((quote) => {
      (quote.meta?.analysisNodeIds || []).forEach((id) => analysesWithQuoteParent.add(id));
    });

    items.forEach(item => {
      graph.nodes.set(item.id, {
        id: item.id,
        type: item.type,
        data: item,
        connections: new Set(),
        weight: 1
      });
    });

    // Cards are real graph scene objects, not a separate Dots-only layer.
    state.cardScene.forEach((scene) => {
      graph.nodes.set(scene.id, {
        id: scene.id,
        type: "card",
        data: scene.card,
        connections: new Set(),
        weight: 1,
        cardScene: scene
      });
    });

    // Edge identity is a Set lookup instead of scanning every existing edge
    // with a sort+join on each insertion.
    const edgeKeys = new Set();
    const addEdge = (from, to, type, strength = 1) => {
      if (!from || !to || from === to) return;
      if (!graph.nodes.has(from) || !graph.nodes.has(to)) return;
      const key = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      graph.edges.push({ from, to, type, strength });
      graph.nodes.get(from)?.connections.add(to);
      graph.nodes.get(to)?.connections.add(from);
    };

    layers.forEach((layer) => {
      const subjectNode = findSubject(layer.subject);
      if (!subjectNode) return;
      const parentId = layer?.meta?.parentLayerId || subjectNode.id;
      addEdge(parentId, layer.id, "layer-chain", 3.2);
    });

    sources.forEach(source => {
      if (!source.subject) return;
      const subjectNode = findSubject(source.subject);
      if (!subjectNode) return;

      const { l1, l2, l3 } = getSourceLayerParts(source);
      if (!l1) {
        addEdge(subjectNode.id, source.id, "subject-source", 3);
        return;
      }

      const layerId = l3
        ? makeLayerId(source.subject, l1, l2, l3)
        : (l2 ? makeLayerId(source.subject, l1, l2) : makeLayerId(source.subject, l1));

      if (graph.nodes.has(layerId)) {
        addEdge(layerId, source.id, "layer-source", 3);
      } else {
        addEdge(subjectNode.id, source.id, "subject-source", 3);
      }
    });

    pastpapers.forEach(paper => {
      if (!paper.subject) return;
      const subjectNode = findSubject(paper.subject);
      if (!subjectNode) return;
      addEdge(subjectNode.id, paper.id, "subject-pastpaper", 2.6);
    });

    quotes.forEach(quote => {
      if (quote.link?.sourceId) {
        addEdge(quote.link.sourceId, quote.id, "source-quote", 2.5);
      }
      // Only connect quote to subject directly if it has NO source (orphan prevention for flashcard-builder quotes)
      if (quote.subject && !quote.link?.sourceId) {
        const subjectNode = findSubject(quote.subject);
        if (subjectNode) addEdge(subjectNode.id, quote.id, "subject-quote", 2.3);
      }
    });

    analyses.forEach(analysis => {
      // Check if analysis has any quote parent (not orphaned)
      const hasQuoteParent =
        (analysis.quoteRefs || []).some(ref => ref.quoteId) ||
        (analysis.meta?.manualLinks || []).some(id => quoteIds.has(id)) ||
        analysesWithQuoteParent.has(analysis.id);

      // Only connect orphaned analyses (no quote parents) to subject node
      if (!hasQuoteParent && analysis.subject) {
        const subjectNode = findSubject(analysis.subject);
        if (subjectNode) {
          addEdge(subjectNode.id, analysis.id, "subject-analysis", 2.2);
        }
      }

      (analysis.quoteRefs || []).forEach(ref => {
        if (ref.quoteId) {
          addEdge(ref.quoteId, analysis.id, "quote-analysis", 2);
        }
      });
    });

    cues.forEach(cue => {
      if (cue.quoteId) addEdge(cue.quoteId, cue.id, "quote-cue", 2);
      if (cue.analysisId) addEdge(cue.analysisId, cue.id, "analysis-cue", 2);
    });

    // Tag links
    items.forEach(item => {
      const itemTags = item.meta?.tags || [];
      itemTags.forEach(tagName => {
        const tag = tagByTitle.get(String(tagName || "").trim().toLowerCase());
        if (tag) {
          addEdge(item.id, tag.id, "tag-link", 1.2);
        }
      });
    });

    // Manual links (bidirectional no-limit connections)
    items.forEach(item => {
      const manualLinks = item.meta?.manualLinks || [];
      manualLinks.forEach(targetId => {
        addEdge(item.id, targetId, "manual-link", 1.5);
      });
    });

    // Cache each card's anchors once. Card edges use the same spring system as
    // knowledge edges, but a shorter ideal length keeps cards clustered around
    // their quote/analysis/source/deck instead of drifting into the graph.
    state.cardScene.forEach((scene) => {
      scene.anchorIds = getCardAnchorIdsForGraph(scene.card, graph);
      scene.anchorIds.forEach((anchorId) => {
        addEdge(scene.id, anchorId, "card-context", 1.1);
      });
    });

    graph.nodes.forEach(node => {
      let weight = 1;
      weight += node.connections.size * 0.5;
      if (node.data?.priority) weight += node.data.priority * 0.8;
      if (node.data?.meta?.confidence) weight += node.data.meta.confidence * 0.5;
      node.weight = weight;
    });

    state.graph = graph;
    recomputeScope();

    // New nodes always fade in from zero. Existing nodes keep their current
    // alpha so a database refresh does not flash the whole canvas.
    for (const id of graph.nodes.keys()) {
      if (!state.nodeVisibility.has(id)) state.nodeVisibility.set(id, 0);
    }
    for (const id of state.nodeVisibility.keys()) {
      if (!graph.nodes.has(id)) state.nodeVisibility.delete(id);
    }

    return graph;
  }

  function getAnchorPosition(node, centerX, centerY) {
    const type = node.type;
    let baseRadius = ringConfig[type] || 200;
    if (type === "layer") {
      const level = Number(node?.data?.meta?.layerLevel || node?.meta?.layerLevel || 1);
      baseRadius = ringConfig.layer + (Math.max(1, Math.min(3, level)) - 1) * 60;
    }
    const variance = baseRadius * 0.4;
    const hash = node.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const angle = (hash % 360) * (Math.PI / 180);
    const radius = baseRadius + ((hash % 100) / 100 - 0.5) * variance;

    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  }

  function computeForces() {
    const forces = new Map();
    const positions = state.nodePositions;
    const graph = state.graph;
    const centerX = viewWidth() / 2;
    const centerY = viewHeight() / 2;

    const nodeParents = new Map();
    graph.nodes.forEach((node, id) => {
      forces.set(id, { x: 0, y: 0 });
      const parents = new Set();
      const nodeLevel = getHierarchyLevel(node);
      node.connections.forEach(neighborId => {
        const neighbor = graph.nodes.get(neighborId);
        if (neighbor && getHierarchyLevel(neighbor) < nodeLevel) {
          parents.add(neighborId);
        }
      });
      nodeParents.set(id, parents);
    });

    // 1. Global Repulsion & Angular Placement - Full O(n²) needed for fractal structure
    // Only the nodes inside the active subject scope participate, so hidden
    // subjects cannot keep inflating the focused graph.
    const nodesArr = Array.from(graph.nodes.entries()).filter(([id]) => isNodeInScope(id));

    for (let i = 0; i < nodesArr.length; i++) {
      const [idA, nodeA] = nodesArr[i];
      const posA = positions.get(idA);
      if (!posA) continue;

      const parentsA = nodeParents.get(idA);

      for (let j = i + 1; j < nodesArr.length; j++) {
        const [idB, nodeB] = nodesArr[j];
        const posB = positions.get(idB);
        if (!posB) continue;

        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        let distSq = dx * dx + dy * dy;

        // Prevent singularity
        if (distSq < 1) distSq = 1;

        const dist = Math.sqrt(distSq);

        const weightA = Math.max(1, nodeA.connections.size);
        const weightB = Math.max(1, nodeB.connections.size);
        let repStrength = 15000 + (weightA * weightB) * 5000;
        // Cards are lightweight satellites. Full knowledge-node repulsion
        // would push them away from the very context they belong to.
        if (nodeA.type === "card" || nodeB.type === "card") repStrength *= 0.32;

        const parentsB = nodeParents.get(idB);

        let isSibling = false;
        let commonParentId = null;
        if (parentsA && parentsB) {
          for (const p of parentsA) {
            if (parentsB.has(p)) {
              isSibling = true;
              commonParentId = p;
              break;
            }
          }
        }

        let isGrandparent = false;
        if (parentsA && !parentsA.has(idB)) {
           for (const p of parentsA) {
               const pParents = nodeParents.get(p);
               if (pParents && pParents.has(idB)) isGrandparent = true;
           }
        }
        if (parentsB && !parentsB.has(idA)) {
           for (const p of parentsB) {
               const pParents = nodeParents.get(p);
               if (pParents && pParents.has(idA)) isGrandparent = true;
           }
        }

        let forceMag = 0;

        if (isSibling) {
          const parentNode = graph.nodes.get(commonParentId);
          // Children count is connections minus the parent link
          const siblingCount = parentNode ? Math.max(1, parentNode.connections.size - 1) : 1;

          // Boost repulsion if there are many siblings to prevent clumping
          // The more siblings, the stronger they push each other apart
          let siblingRepMultiplier = 0.35;
          if (siblingCount > 3) {
            siblingRepMultiplier += (siblingCount - 3) * 0.15;
          }

          // Also increase the ideal distance between siblings when they are numerous
          // This ensures the "mesh" of siblings doesn't collapse too tightly in a circle
          const siblingIdeal = 100 + (Math.max(weightA, weightB) * 10) + (siblingCount > 4 ? (siblingCount - 4) * 20 : 0);

          const siblingSpring = 0.008; // Softer sibling attraction
          const attractForce = (dist - siblingIdeal) * siblingSpring;

          // Weaken repulsion slightly for analysis nodes to keep them more compact
          if (nodeA.type === "analysis" && nodeB.type === "analysis") {
            siblingRepMultiplier *= 0.3;
          }

          // Repulsion force adjusted by sibling multiplier, minus the spring attraction
          forceMag = (repStrength * siblingRepMultiplier) / distSq - attractForce;
        } else if (isGrandparent) {
          // Repel strongly from grandparent to stretch branches outward
          repStrength += 160000;
          forceMag = repStrength / distSq;
        } else {
          forceMag = repStrength / distSq;
        }

        const fx = (dx / dist) * forceMag;
        const fy = (dy / dist) * forceMag;

        forces.get(idA).x += fx;
        forces.get(idA).y += fy;
        forces.get(idB).x -= fx;
        forces.get(idB).y -= fy;
      }
    }

    // 2. Spring Attraction (Edges)
    graph.edges.forEach(edge => {
      if (!isNodeInScope(edge.from) || !isNodeInScope(edge.to)) return;
      const posFrom = positions.get(edge.from);
      const posTo = positions.get(edge.to);
      if (!posFrom || !posTo) return;

      const nodeFrom = graph.nodes.get(edge.from);
      const nodeTo = graph.nodes.get(edge.to);

      const dx = posTo.x - posFrom.x;
      const dy = posTo.y - posFrom.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Dynamic spacing: if node has many connections, it needs more space
      const weightFrom = Math.max(1, nodeFrom.connections.size);
      const weightTo = Math.max(1, nodeTo.connections.size);
      const levelFrom = getHierarchyLevel(nodeFrom);
      const levelTo = getHierarchyLevel(nodeTo);
      const hierarchyDepth = Math.max(levelFrom, levelTo);

      // Estimate children count for the branch (connections minus the parent link)
      const childrenCount = Math.max(0, Math.max(weightFrom, weightTo) - 1);

      // If only a few children (0-2), no extra length needed. If many children, expand length dramatically.
      // Cards sit close to their context; knowledge branches keep the longer
      // dynamic spacing that makes the hierarchy readable.
      const isCardEdge = edge.type === "card-context";
      const childrenBonus = childrenCount <= 2 ? 0 : (childrenCount * 25);
      const idealLength = isCardEdge
        ? 52
        : 90 + (hierarchyDepth * 15) + childrenBonus;

      // Softer spring for a more elegant, less bouncy feel
      const springK = 0.03;
      const force = (dist - idealLength) * springK;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      forces.get(edge.from).x += fx;
      forces.get(edge.from).y += fy;
      forces.get(edge.to).x -= fx;
      forces.get(edge.to).y -= fy;
    });

    // 3. Very Weak Center Gravity (just to prevent infinite drifting)
    graph.nodes.forEach((node, id) => {
      if (!isNodeInScope(id)) return;
      const pos = positions.get(id);
      if (!pos) return;

      const dx = centerX - pos.x;
      const dy = centerY - pos.y;

      // Equal, extremely gentle pull for all nodes.
      // This prevents the "bent/pinned subject" issue because the subject is free to move relative to its children!
      forces.get(id).x += dx * 0.00005;
      forces.get(id).y += dy * 0.00005;
    });

    // 4. Angular Sector Encouragement (Fractal Spreading)
    // This pushes children to spread out in a sector oriented AWAY from their grandparent
    graph.nodes.forEach((node, id) => {
      if (!isNodeInScope(id)) return;
      const parents = nodeParents.get(id);
      if (!parents || parents.size === 0) return;

      const pos = positions.get(id);

      parents.forEach(parentId => {
        const parentNode = graph.nodes.get(parentId);
        const parentPos = positions.get(parentId);
        if (!parentNode || !parentPos) return;

        const gParents = nodeParents.get(parentId);
        if (!gParents || gParents.size === 0) return; // Root children spread 360

        // Use the first grandparent as the orientation anchor
        const gId = gParents.values().next().value;
        const gPos = positions.get(gId);
        if (!gPos) return;

        // Forward direction: away from grandparent
        const dxGP = parentPos.x - gPos.x;
        const dyGP = parentPos.y - gPos.y;
        const angleGP = Math.atan2(dyGP, dxGP);

        // Current direction: parent to child
        const dxPC = pos.x - parentPos.x;
        const dyPC = pos.y - parentPos.y;
        const anglePC = Math.atan2(dyPC, dxPC);

        // Calculate shortest angular distance
        let angleDiff = anglePC - angleGP;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Sector width scales with child count.
        // 1 child = narrow (~70deg), many children = wide (up to 270deg)
        const siblingCount = Math.max(1, parentNode.connections.size - 1);
        const sectorWidth = Math.min(Math.PI * 1.5, (siblingCount * 0.35) + 0.6);
        const halfSector = sectorWidth / 2;

        if (Math.abs(angleDiff) > halfSector) {
          // Soft corrective torque to bring node back into the allowed sector
          const overshoot = Math.abs(angleDiff) - halfSector;
          const strength = 0.2;
          const forceMag = overshoot * strength;

          // Apply a tangential force (perpendicular to parent-child axis)
          const tangentAngle = anglePC + (angleDiff > 0 ? -Math.PI / 2 : Math.PI / 2);

          forces.get(id).x += Math.cos(tangentAngle) * forceMag * 12;
          forces.get(id).y += Math.sin(tangentAngle) * forceMag * 12;
        }
      });
    });

    return forces;
  }

  function updatePositionsWithPhysics(forces) {
    const positions = state.nodePositions;
    const velocities = state.velocities;
    let moved = false;

    // Custom damping and velocity limits for our dynamic fractal engine
    // Lower damping (more friction) to prevent bouncing, allowing a soft settling
    const damping = 0.78;
    const maxVelocity = 20;
    const width = viewWidth();
    const height = viewHeight();
    const centerX = width / 2;
    const centerY = height / 2;

    state.graph.nodes.forEach((node, id) => {
      const pos = positions.get(id);
      if (!pos) return;

      if (!isNodeInScope(id)) {
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      // An explicit lock always wins over the subject's automatic centring.
      // Otherwise locking the focused subject would still make it drift to
      // the middle of the viewport on the next frame.
      if (state.lockedNodes.has(id)) {
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      // The focused subject is the visual anchor: it glides to the exact
      // centre and then stays there while its cluster settles around it.
      if (id === state.focusSubjectId) {
        const dx = (centerX - pos.x) * 0.14;
        const dy = (centerY - pos.y) * 0.14;
        pos.x += dx;
        pos.y += dy;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) moved = true;
        if (Math.abs(centerX - pos.x) < 0.1) pos.x = centerX;
        if (Math.abs(centerY - pos.y) < 0.1) pos.y = centerY;
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      if (state.pinnedNodes.has(id)) {
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      const vel = velocities.get(id) || { x: 0, y: 0 };
      const force = forces.get(id) || { x: 0, y: 0 };

      // Apply force to velocity
      vel.x = (vel.x + force.x) * damping;
      vel.y = (vel.y + force.y) * damping;

      // Cap velocity to prevent extreme snapping
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (speed > maxVelocity) {
        vel.x = (vel.x / speed) * maxVelocity;
        vel.y = (vel.y / speed) * maxVelocity;
      }

      // Snap to 0 to reach perfectly resting state
      if (Math.abs(vel.x) < 0.05) vel.x = 0;
      if (Math.abs(vel.y) < 0.05) vel.y = 0;

      pos.x += vel.x;
      pos.y += vel.y;
      if (Math.abs(vel.x) > 0.01 || Math.abs(vel.y) > 0.01) moved = true;

      velocities.set(id, vel);
    });

    if (moved) layoutDirty = true;
  }

  // Hierarchy level is immutable for a graph node and is read several times
  // per physics tick. Graph nodes are rebuilt on every data refresh, so a
  // WeakMap invalidates itself when the graph changes.
  const hierarchyLevelCache = new WeakMap();
  function getHierarchyLevel(node) {
    if (hierarchyLevelCache.has(node)) return hierarchyLevelCache.get(node);
    const level = computeHierarchyLevel(node);
    hierarchyLevelCache.set(node, level);
    return level;
  }

  function computeHierarchyLevel(node) {
    const rawNode = node.data || node;
    if (rawNode.type === "subject") return 0;
    if (rawNode.type === "layer 1") return 1;
    if (rawNode.type === "layer 2") return 2;
    if (rawNode.type === "layer 3") return 3;

    if (rawNode.type === "source") {
      const { l1, l2, l3 } = getSourceLayerParts(rawNode);
      if (l3) return 4;
      if (l2) return 3;
      if (l1) return 2;
      return 1;
    }
    if (rawNode.type === "quote") {
      if (rawNode.link?.sourceId) {
        const source = findItemById(rawNode.link.sourceId);
        if (source) {
          const { l1, l2, l3 } = getSourceLayerParts(source);
          return (l3 ? 4 : (l2 ? 3 : (l1 ? 2 : 1))) + 1;
        }
      }
      return 5;
    }
    if (rawNode.type === "analysis") {
      if (rawNode.quoteRefs?.[0]?.quoteId) {
        const quote = findItemById(rawNode.quoteRefs[0].quoteId);
        if (quote && quote.link?.sourceId) {
          const source = findItemById(quote.link.sourceId);
          if (source) {
            const { l1, l2, l3 } = getSourceLayerParts(source);
            return (l3 ? 4 : (l2 ? 3 : (l1 ? 2 : 1))) + 2;
          }
        }
      }
      return 6;
    }
    if (rawNode.type === "cue") {
      if (rawNode.quoteId) return 6;
      if (rawNode.analysisId) return 7;
      return 5;
    }
    if (rawNode.type === "tag") return 4;
    if (rawNode.type === "card") return 8;
    return 8;
  }

  function layoutRadial(containerWidth, containerHeight, options = {}) {
    const preserveExisting = Boolean(options.preserveExisting);
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    const graph = state.graph;
    const focusId = state.focusSubjectId;

    // Exploding Cluster Layout: Start all nodes in a tiny cluster near the center.
    // The massive global repulsion will naturally explode them outward instantly,
    // and springs + grandparent-repulsion will smoothly unspool them into a perfect tree!
    // In subject mode the focused subject is pinned to the exact centre and its
    // cluster explodes outward from there, which gives the filter transition a
    // clear "subject comes into focus" origin.
    graph.nodes.forEach((node, id) => {
      // Locks hold their exact position through Re-layout. Ordinary session
      // pins are handled by the preserveExisting branch below and are released
      // when Re-layout restarts the explosion.
      if (state.lockedNodes.has(id) && state.nodePositions.has(id)) {
        state.velocities.set(id, { x: 0, y: 0 });
        return;
      }
      if (node.type === "card") {
        const velocity = state.velocities.get(id);
        if (velocity) {
          velocity.x = 0;
          velocity.y = 0;
        } else {
          state.velocities.set(id, { x: 0, y: 0 });
        }
        // Re-layout should include cards in the same opening burst as the
        // knowledge nodes. Skipping them left cards at their old positions
        // while everything else exploded, so the springs had to drag them in
        // from far away afterwards. Their anchor springs still settle them.
        if (!preserveExisting) {
          const scene = node.cardScene || state.cardScene.get(id);
          if (scene) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * (focusId ? 24 : 30);
            scene.x = centerX + Math.cos(angle) * r;
            scene.y = centerY + Math.sin(angle) * r;
            scene.seeded = true;
            state.nodePositions.set(id, scene);
          }
        }
        return;
      }
      // Ordinary data changes must not move a graph the user has arranged.
      // Only Re-layout (preserveExisting: false) restarts the explosion.
      if (preserveExisting && state.nodePositions.has(id)) {
        if (!state.velocities.has(id)) state.velocities.set(id, { x: 0, y: 0 });
        return;
      }
      if (id === focusId) {
        state.nodePositions.set(id, { x: centerX, y: centerY });
        state.velocities.set(id, { x: 0, y: 0 });
        return;
      }
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * (focusId ? 24 : 30);
      state.nodePositions.set(id, {
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r
      });
      state.velocities.set(id, { x: 0, y: 0 });
    });
  }

  let lastCanvasSize = { width: 0, height: 0 };

  function initializePositions(containerWidth, containerHeight) {
    buildGraph();
    // The initial refresh already seeded positions. Re-running a full explode
    // here would discard them and play the animation twice on every load.
    if (state.nodePositions.size === 0) {
      layoutRadial(containerWidth, containerHeight);
    }
    seedCardScenePositions();
    lastCanvasSize = { width: containerWidth, height: containerHeight };
  }

  function relayoutGraph() {
    if (state.viewMode === "grid") {
      setGraphStatus("Switch to Graph to re-layout.", "warning");
      return;
    }
    if (state.graph.nodes.size === 0) {
      setGraphStatus("Nothing to lay out yet.", "warning");
      return;
    }
    const unlockedCount = [...state.graph.nodes.keys()]
      .filter((id) => !state.lockedNodes.has(id)).length;
    if (unlockedCount === 0) {
      setGraphStatus("Every node is locked. Unlock one to re-layout.", "warning", { sticky: true });
      return;
    }
    const width = canvas?.parentElement?.clientWidth || canvas?.width || 800;
    const height = canvas?.parentElement?.clientHeight || canvas?.height || 600;
    state.sceneTransition = null;
    // Re-layout releases ordinary session pins, but explicit locks are the
    // user's arrangement and must stay exactly where they are.
    state.pinnedNodes.clear();
    state.lockedNodes.forEach((id) => state.pinnedNodes.add(id));
    state.draggingNodeId = null;
    state.isPanning = false;
    state.panOffset = { x: 0, y: 0 };
    state.zoom = 1;
    // Re-layout is also a camera reset: let auto-fit frame the fresh
    // explosion instead of leaving a previously panned/zoomed view in place.
    state.userInteracted = false;
    state.simulationRunning = true;
    layoutRadial(width, height);
    markLayoutUnstable(3000);
    lastCanvasSize = { width, height };
    if (state.viewMode === "dots") {
      buildDotsLayout({ applyTargets: true });
    }
    if (canvas && window.__neuronetCanvas?.triggerRadialPulse) {
      const rect = canvas.getBoundingClientRect();
      window.__neuronetCanvas.triggerRadialPulse(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        1.2
      );
    }
    const lockedCount = state.lockedNodes.size;
    setGraphStatus(
      lockedCount ? `Layout reset · ${lockedCount} locked kept` : "Layout reset",
      "success"
    );
  }

  // The flattened knowledge list is rebuilt on every frame by the renderer and
  // by many lookups. The source arrays are only replaced by refreshData, so
  // reference equality is a cheap and safe cache key.
  let itemsCache = null;
  let itemsCacheSources = [];
  function getAllItems() {
    const sources = [state.nodes, state.quotes, state.cues, state.tags, state.layerNodes];
    if (itemsCache && sources.every((source, index) => source === itemsCacheSources[index])) {
      return itemsCache;
    }
    itemsCache = [
      ...(state.nodes || []),
      ...(state.quotes || []),
      ...(state.cues || []),
      ...(state.tags || []),
      ...(state.layerNodes || [])
    ];
    itemsCacheSources = sources;
    return itemsCache;
  }

  let itemIndexCache = null;
  let itemIndexItems = null;
  let cardIndexCache = null;
  let cardIndexCards = null;
  function findItemById(id) {
    const items = getAllItems();
    if (itemIndexItems !== items) {
      itemIndexCache = new Map();
      items.forEach((entry) => {
        if (!itemIndexCache.has(entry.id)) itemIndexCache.set(entry.id, entry);
      });
      itemIndexItems = items;
    }
    const item = itemIndexCache.get(id);
    if (item) return item;

    // Grid cards are card-first now, so the sidebar must be able to resolve a
    // card id that never appears in the knowledge graph.
    if (cardIndexCards !== state.cards) {
      cardIndexCards = state.cards;
      cardIndexCache = new Map();
      (state.cards || []).forEach((entry) => {
        if (!cardIndexCache.has(entry.id)) cardIndexCache.set(entry.id, entry);
      });
    }
    const card = cardIndexCache.get(id);
    if (!card) return undefined;
    return { ...card, type: "card", subject: card.deck || "" };
  }

  function transformPoint(x, y) {
    const centerX = viewWidth() / 2;
    const centerY = viewHeight() / 2;
    return {
      x: centerX + (x - centerX) * state.zoom + state.panOffset.x,
      y: centerY + (y - centerY) * state.zoom + state.panOffset.y
    };
  }

  function updateNodeVisibility() {
    state.graph.nodes.forEach((node, id) => {
      const target = isNodeInScope(id) && nodeMatchesGraphFilter(node) ? 1 : 0;
      const current = state.nodeVisibility.get(id) ?? 0;
      let next = current + (target - current) * 0.16;
      if (Math.abs(target - next) < 0.01) next = target;
      state.nodeVisibility.set(id, next);
    });
  }

  function seedIncomingNodes(previousScope = new Set()) {
    // Returning to the global view keeps every node at its last global
    // position, so the wider map fades back in where the user left it.
    if (!state.focusSubject) return;

    const width = canvas?.parentElement?.clientWidth || canvas?.width || 800;
    const height = canvas?.parentElement?.clientHeight || canvas?.height || 600;
    const center = { x: width / 2, y: height / 2 };
    const focusId = state.focusSubjectId;

    // A subject that was hidden materialises at the centre. This is also the
    // anchor for its child cluster, so a subject switch assembles in place
    // instead of snapping nodes across the screen.
    if (focusId && !previousScope.has(focusId)) {
      state.nodePositions.set(focusId, { x: center.x, y: center.y });
      state.velocities.set(focusId, { x: 0, y: 0 });
    }
    const anchor = focusId ? (state.nodePositions.get(focusId) || center) : center;

    state.graph.nodes.forEach((node, id) => {
      if (!state.scopeNodeIds.has(id) || previousScope.has(id) || id === focusId) return;
      if ((state.nodeVisibility.get(id) ?? 0) > 0.05) return;
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 30;
      setWorldPosition(
        id,
        anchor.x + Math.cos(angle) * radius,
        anchor.y + Math.sin(angle) * radius
      );
      state.velocities.set(id, { x: 0, y: 0 });
    });
  }

  function setFocusSubject(nextSubject) {
    const canonical = resolveFocusSubject(nextSubject);
    if (normalizeSubjectName(canonical) === normalizeSubjectName(state.focusSubject)) {
      return;
    }

    const previousScope = new Set(state.scopeNodeIds);
    state.focusSubject = canonical || null;
    recomputeScope();
    state.userInteracted = false;
    seedIncomingNodes(previousScope);

    if (state.selectedNodeId && !state.scopeNodeIds.has(state.selectedNodeId)) {
      closeSidebar();
    }

    if (canvas && window.__neuronetCanvas?.triggerRadialPulse) {
      const rect = canvas.getBoundingClientRect();
      window.__neuronetCanvas.triggerRadialPulse(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        1.4
      );
    }

    if (state.viewMode === "grid") {
      renderGrid();
    } else if (state.viewMode === "dots") {
      buildDotsLayout({ applyTargets: !state.sceneTransition });
    }
    updateStats();
    updateEmptyState();
    scheduleLayoutSave();
  }

  let frameCount = 0;
  let rafId = 0;
  let lastLayoutSaveAt = 0;
  function tick() {
    const now = performance.now();
    if (state.viewMode === "graph" || state.viewMode === "dots") {
      if (state.sceneTransition) {
        // One renderer, one global t. Physics and camera are deliberately
        // paused so the morph is the only thing moving.
        updateSceneTransition(now);
        renderScene(now);
      } else if (state.viewMode === "graph") {
        frameCount++;
        if (state.simulationRunning && !state.draggingNodeId) {
          if (state.graph.nodes.size === 0) {
            buildGraph();
          }
          // Only run physics every 2 frames (half rate)
          if (frameCount % 2 === 0) {
            const forces = computeForces();
            updatePositionsWithPhysics(forces);
          }
        }
        updateNodeVisibility();
        fitCameraToGraph();
        renderScene(now);
        if (layoutDirty && !layoutSaveTimer && now - lastLayoutSaveAt > 3000) {
          lastLayoutSaveAt = now;
          saveLayoutNow();
        }
      } else {
        renderScene(now);
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function fitCameraToGraph() {
    if (state.sceneTransition) return;
    // Dots targets are baked in screen space from the camera at entry. Letting
    // the auto-fit keep running would slide the chart off its own layout.
    if (state.viewMode === "dots") return;
    if (state.graph.nodes.size === 0 || state.userInteracted || !canvas) return;

    // Frame the knowledge graph only. Cards are satellites of their context,
    // so including them would let a few study cards pull the camera away from
    // the same min/max framing the knowledge nodes get on their own. If a
    // subject has cards but no knowledge nodes, fall back to the cards so a
    // card-only deck still has a sensible view.
    const scopedPositions = [];
    state.nodePositions.forEach((pos, id) => {
      if (!state.scopeNodeIds.has(id) || state.cardScene.has(id)) return;
      if (!nodeMatchesGraphFilter(state.graph.nodes.get(id))) return;
      scopedPositions.push(pos);
    });
    if (scopedPositions.length === 0) {
      state.nodePositions.forEach((pos, id) => {
        if (!state.scopeNodeIds.has(id)) return;
        if (!nodeMatchesGraphFilter(state.graph.nodes.get(id))) return;
        scopedPositions.push(pos);
      });
    }
    if (scopedPositions.length === 0) return;

    const viewportWidth = viewWidth() || canvas.parentElement?.clientWidth || 800;
    const viewportHeight = viewHeight() || canvas.parentElement?.clientHeight || 600;
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    let targetZoom = state.zoom;
    let targetPanX = state.panOffset.x;
    let targetPanY = state.panOffset.y;

    const focusPos = state.focusSubjectId ? state.nodePositions.get(state.focusSubjectId) : null;

    if (focusPos) {
      // Subject mode: the focused subject owns the centre of the screen and
      // the camera frames its cluster, rather than the bounding box of every
      // subject in the database.
      let maxDistance = 80;
      scopedPositions.forEach((pos) => {
        const dx = pos.x - focusPos.x;
        const dy = pos.y - focusPos.y;
        maxDistance = Math.max(maxDistance, Math.sqrt(dx * dx + dy * dy));
      });
      const viewport = Math.max(240, Math.min(viewportWidth, viewportHeight));
      targetZoom = Math.min(1.9, Math.max(config.minZoom, (viewport * 0.42) / (maxDistance + 80)));
      targetPanX = -(focusPos.x - centerX) * targetZoom;
      targetPanY = -(focusPos.y - centerY) * targetZoom;
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      scopedPositions.forEach((pos) => {
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y);
      });
      if (minX === Infinity) return;

      // Responsive padding: a fixed 150px gutter over-zooms small canvases
      // and wastes a large monitor, so scale it to the viewport.
      const padding = Math.min(160, Math.max(60, Math.min(viewportWidth, viewportHeight) * 0.12));
      minX -= padding;
      maxX += padding;
      minY -= padding;
      maxY += padding;

      const contentWidth = Math.max(100, maxX - minX);
      const contentHeight = Math.max(100, maxY - minY);
      const scaleX = viewportWidth / contentWidth;
      const scaleY = viewportHeight / contentHeight;
      targetZoom = Math.min(config.maxZoom, Math.max(config.minZoom, Math.min(scaleX, scaleY)));

      const centerOfMassX = (minX + maxX) / 2;
      const centerOfMassY = (minY + maxY) / 2;
      targetPanX = -(centerOfMassX - centerX) * targetZoom;
      targetPanY = -(centerOfMassY - centerY) * targetZoom;
    }

    // Smooth camera interpolation. A slightly faster ease keeps subject
    // switches feeling intentional without snapping.
    state.zoom += (targetZoom - state.zoom) * 0.07;
    state.panOffset.x += (targetPanX - state.panOffset.x) * 0.07;
    state.panOffset.y += (targetPanY - state.panOffset.y) * 0.07;
  }

  // Canvas geometry is kept in CSS pixels for every calculation (hit-testing,
  // layout, camera). Only the backing store is scaled, so the map is sharp on
  // Retina/iPad screens without changing any coordinate system.
  const viewportSize = { width: 1, height: 1, dpr: 1 };
  const viewWidth = () => viewportSize.width;
  const viewHeight = () => viewportSize.height;

  function syncCanvasSize() {
    const container = canvas.parentElement;
    const width = Math.max(1, Math.round(container.clientWidth));
    const height = Math.max(1, Math.round(container.clientHeight));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    viewportSize.width = width;
    viewportSize.height = height;
    viewportSize.dpr = dpr;
    // Resizing the backing store resets the context, so reapply the scale each
    // time the size is confirmed. All drawing then uses CSS pixels.
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  function drawKnowledgeScene(now, alpha) {
    if (!ctx || !canvas || alpha <= 0.01) return;

    const items = getAllItems();
    const edges = state.graph.edges;
    const focusId = state.focusSubjectId;

    ctx.save();
    ctx.globalAlpha = alpha;

    edges.forEach(edge => {
      const fromPos = state.nodePositions.get(edge.from);
      const toPos = state.nodePositions.get(edge.to);
      const fromVisibility = state.nodeVisibility.get(edge.from) ?? 0;
      const toVisibility = state.nodeVisibility.get(edge.to) ?? 0;
      const edgeVisibility = Math.min(fromVisibility, toVisibility);

      if (fromPos && toPos && edgeVisibility > 0.02) {
        const fromTrans = transformPoint(fromPos.x, fromPos.y);
        const toTrans = transformPoint(toPos.x, toPos.y);
        const isActive = state.selectedNodeId === edge.from || state.selectedNodeId === edge.to;
        // Card-context edges are orientation hints, not the knowledge network
        // itself. Keep them faint so the cards read as clustered satellites.
        const baseAlpha = edge.type === "card-context" ? 0.14 : 0.35;

        ctx.beginPath();
        ctx.moveTo(fromTrans.x, fromTrans.y);
        ctx.lineTo(toTrans.x, toTrans.y);
        ctx.strokeStyle = isActive
          ? `rgba(44, 255, 179, ${0.9 * edgeVisibility})`
          : `rgba(44, 255, 179, ${baseAlpha * edgeVisibility})`;
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.stroke();
      }
    });

    items.forEach(item => {
      const pos = state.nodePositions.get(item.id);
      if (!pos) return;

      const visibility = state.nodeVisibility.get(item.id) ?? 0;
      if (visibility < 0.02) return;

      const posTrans = transformPoint(pos.x, pos.y);
      const isSelected = state.selectedNodeId === item.id;
      const isHovered = state.hoveredNodeId === item.id;
      const isFocusedSubject = item.id === focusId;
      const baseRadius = isHovered || isSelected ? config.nodeHoverRadius : config.nodeRadius;
      const revealScale = 0.55 + 0.45 * visibility;
      const radius = baseRadius * state.zoom * revealScale * (isFocusedSubject ? 1.35 : 1);
      const color = getNodeColor(item.type);
      const lockLevel = getLockLevel(item.id);

      ctx.globalAlpha = alpha * visibility;

      // A focused subject gets a slow, breathing double halo so the eye
      // immediately knows which node owns the centre of the view.
      if (isFocusedSubject) {
        const pulse = 1 + Math.sin(now / 420) * 0.08;
        ctx.beginPath();
        ctx.arc(posTrans.x, posTrans.y, radius * 2.1 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 107, 107, 0.32)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(posTrans.x, posTrans.y, radius * 3.0 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 107, 107, 0.12)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(posTrans.x, posTrans.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10, 30, 22, 0.9)";
      ctx.fill();
      if (lockLevel > 0.01) {
        // Unlocked nodes are hollow. A locked node fills with its own colour
        // so security is readable at a glance without a padlock glyph.
        const tint = hexToRgb(color);
        ctx.beginPath();
        ctx.arc(posTrans.x, posTrans.y, Math.max(1, radius - 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.3 * lockLevel})`;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = (isSelected ? 3 : 2) + lockLevel * 0.7;
      ctx.stroke();
      if (lockLevel > 0.01) {
        const halo = hexToRgb(color);
        ctx.beginPath();
        ctx.arc(posTrans.x, posTrans.y, radius + 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${halo[0]}, ${halo[1]}, ${halo[2]}, ${0.5 * lockLevel})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // Hierarchical label visibility based on zoom level. The focused
      // subject is always labelled, even when the cluster is zoomed out.
      // In a dense global map, only the structural labels stay visible until
      // the user zooms in, otherwise 100+ quotes turn the overview into noise.
      const isDenseGlobal = !state.focusSubject && state.graph.nodes.size > 70;
      const structuralLabel = item.type === "subject" || item.type === "tag" || item.type?.startsWith("layer");
      if (isDenseGlobal && !structuralLabel && state.zoom < 1.35) {
        ctx.globalAlpha = alpha;
        return;
      }
      const densityBoost = isDenseGlobal ? 0.3 : 0;
      const threshold = (config.labelZoomThresholds[item.type] || 1.0) + densityBoost;
      if (state.zoom < threshold && !isFocusedSubject) {
        ctx.globalAlpha = alpha;
        return;
      }

      const fontSize = (isFocusedSubject ? 14 : 12) * Math.max(0.8, Math.min(1.6, state.zoom));
      ctx.font = `${isFocusedSubject ? "700 " : ""}${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = isFocusedSubject ? "rgba(255, 220, 220, 0.98)" : "rgba(230, 255, 245, 0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const title = getNodeDisplayTitle(item);
      const maxChars = Math.max(8, Math.floor(18 / Math.max(0.35, state.zoom)));
      const displayTitle = title.length > maxChars ? title.substring(0, maxChars - 2) + "..." : title;
      ctx.fillText(displayTitle, posTrans.x, posTrans.y + config.labelOffset * state.zoom);
      ctx.globalAlpha = alpha;
    });

    ctx.restore();
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function inverseTransform(x, y) {
    const centerX = viewWidth() / 2;
    const centerY = viewHeight() / 2;
    return {
      x: (x - centerX - state.panOffset.x) / state.zoom + centerX,
      y: (y - centerY - state.panOffset.y) / state.zoom + centerY
    };
  }

  function findNodeAtPosition(x, y) {
    if (state.viewMode === "dots") {
      const scene = findCardSceneAtScreenPosition(x, y);
      return scene ? { id: scene.id } : null;
    }

    const clickRadius = 20 / state.zoom;
    const inv = inverseTransform(x, y);

    // Cards are drawn on top of the knowledge graph, so hit-test them first.
    let cardHit = null;
    state.cardScene.forEach((scene) => {
      if (cardHit || !isCardInScope(scene.card)) return;
      // A filtered-out card is invisible; it must not keep a click target.
      if ((state.nodeVisibility.get(scene.id) ?? 0) < 0.35) return;
      const dx = inv.x - scene.x;
      const dy = inv.y - scene.y;
      if (dx * dx + dy * dy <= clickRadius * clickRadius) cardHit = { id: scene.id };
    });
    if (cardHit) return cardHit;

    const items = getAllItems();

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (!isNodeInScope(item.id)) continue;
      if ((state.nodeVisibility.get(item.id) ?? 0) < 0.35) continue;
      const pos = state.nodePositions.get(item.id);
      if (!pos) continue;

      const dx = inv.x - pos.x;
      const dy = inv.y - pos.y;
      if (dx * dx + dy * dy <= clickRadius * clickRadius) {
        return item;
      }
    }
    return null;
  }

  function openNodeSidebar(nodeId, trigger = null) {
    state.selectedNodeId = nodeId;
    state.sidebarView = "content";

    if (trigger instanceof HTMLElement) inspectorReturnFocus = trigger;
    else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      inspectorReturnFocus = document.activeElement;
    }

    const selectedItem = findItemById(nodeId);
    if (!selectedItem) return;

    renderSidebar(selectedItem);
    syncGridSelection();
    openInspector("details", { focus: true });
  }

  function closeSidebar() {
    const returnFocus = inspectorReturnFocus;
    inspectorReturnFocus = null;
    if (nodeSidebar) {
      nodeSidebar.classList.remove("open");
      nodeSidebar.setAttribute("aria-hidden", "true");
    }
    nodeSidebarBackdrop?.classList.remove("visible");
    state.selectedNodeId = null;
    state.sidebarView = "content";
    state.inspectorTab = "details";
    state.heapSidebarOpen = false;
    if (toggleHeapSidebarBtn) toggleHeapSidebarBtn.setAttribute("aria-expanded", "false");
    updateLockControls();
    syncGridSelection();
    if (returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });
    } else if (document.activeElement === document.body && canvas) {
      canvas.focus({ preventScroll: true });
    }
  }

  async function handleDeleteNode() {
    if (!state.selectedNodeId) return;

    const selectedItem = findItemById(state.selectedNodeId);
    if (!selectedItem) return;

    const isCard = selectedItem.type === "card";
    const message = isCard
      ? "Delete this card? This action cannot be undone."
      : selectedItem.type?.startsWith("layer")
        ? "Delete this layer and everything inside it? (All sources + their quotes + any now-empty analyses will be removed.)"
        : `Delete this ${selectedItem.type}? This action cannot be undone.`;
    const confirmed = await dialog.confirm(message, "Delete", "danger");
    if (!confirmed) return;

    try {
      if (isCard) {
        if (typeof deleteCard !== "function") {
          throw new Error("Card deletion is unavailable.");
        }
        await deleteCard(selectedItem.id);
      } else if (selectedItem.type?.startsWith("layer")) {
        const parts = Array.isArray(selectedItem?.meta?.layerPath) ? selectedItem.meta.layerPath : [];
        const prefix = parts.map((s) => String(s || "").trim()).filter(Boolean);
        const sources = (state.nodes || []).filter((n) => n?.type === "source" && n?.subject === selectedItem.subject);
        for (const source of sources) {
          const { subject, l1, l2, l3 } = getSourceLayerParts(source);
          const path = [subject, l1, l2, l3].filter(Boolean);
          const matches = prefix.every((value, idx) => path[idx] === value);
          if (matches) {
            await removeNodeEverywhere(source.id);
          }
        }
      } else if (selectedItem.type === "quote") {
        await removeQuoteEverywhere(selectedItem.id);
      } else if (selectedItem.type === "cue") {
        await removeCueEverywhere(selectedItem.id);
      } else {
        await removeNodeEverywhere(selectedItem.id);
      }

      closeSidebar();
      await refreshData();
    } catch (error) {
      console.error("Failed to delete item:", error);
      dialog.alert(`Failed to delete ${isCard ? "card" : "node"}: ` + error.message);
    }
  }

  function updateStats() {
    const totalNodes = document.getElementById("totalNodes");
    const totalSubjects = document.getElementById("totalSubjects");
    const totalLayers = document.getElementById("totalLayers");
    const totalSources = document.getElementById("totalSources");
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalPastPapers = document.getElementById("totalPastPapers");
    const totalCues = document.getElementById("totalCues");
    const totalTags = document.getElementById("totalTags");
    const totalCards = document.getElementById("totalCards");
    const totalConnections = document.getElementById("totalConnections");

    const nodeItems = (state.nodes || []).filter((item) => isNodeInScope(item.id));
    const quoteItems = (state.quotes || []).filter((item) => isNodeInScope(item.id));
    const cueItems = (state.cues || []).filter((item) => isNodeInScope(item.id));
    const tagItems = (state.tags || []).filter((item) => isNodeInScope(item.id));
    const scopedCards = (state.cards || []).filter(isCardInScope);
    const cardMode = state.viewMode === "dots" || state.viewMode === "grid";

    const setLabel = (element, text) => {
      const label = element?.parentElement?.querySelector(".stat-label");
      if (label) label.textContent = text;
    };
    const setPillVisible = (element, visible) => {
      if (element?.parentElement) element.parentElement.style.display = visible ? "flex" : "none";
    };

    if (totalNodes) {
      totalNodes.textContent = cardMode
        ? scopedCards.length
        : nodeItems.length + quoteItems.length + cueItems.length + tagItems.length
          + (state.layerNodes || []).filter((item) => isNodeInScope(item.id)).length
          + scopedCards.length;
      setLabel(totalNodes, cardMode ? "Cards" : "Total");
    }
    if (totalSubjects) {
      totalSubjects.textContent = cardMode
        ? new Set(scopedCards.map((card) => String(card.deck || "").trim() || "Unsorted")).size
        : nodeItems.filter(i => i.type === "subject").length;
      setLabel(totalSubjects, cardMode ? "Decks" : "Subjects");
    }

    if (totalLayers) {
      const layerCount = cardMode
        ? 0
        : (state.layerNodes || []).filter((item) => isNodeInScope(item.id)).length;
      totalLayers.textContent = layerCount;
      setPillVisible(totalLayers, !cardMode && layerCount > 0);
    }

    if (totalSources) {
      totalSources.textContent = nodeItems.filter(i => i.type === "source").length;
      setPillVisible(totalSources, !cardMode);
    }
    if (totalQuotes) {
      totalQuotes.textContent = quoteItems.length;
      setPillVisible(totalQuotes, !cardMode);
    }
    if (totalAnalyses) {
      totalAnalyses.textContent = nodeItems.filter(i => i.type === "analysis").length;
      setPillVisible(totalAnalyses, !cardMode);
    }
    if (totalPastPapers) {
      const paperCount = nodeItems.filter(i => i.type === "pastpaper").length;
      totalPastPapers.textContent = paperCount;
      setPillVisible(totalPastPapers, !cardMode && paperCount > 0);
    }
    if (totalCues) {
      const cueCount = cueItems.length;
      totalCues.textContent = cueCount;
      setPillVisible(totalCues, !cardMode && cueCount > 0);
    }
    if (totalTags) {
      const tagCount = tagItems.length;
      totalTags.textContent = tagCount;
      setPillVisible(totalTags, !cardMode && tagCount > 0);
    }
    if (totalCards) {
      totalCards.textContent = scopedCards.length;
      setPillVisible(totalCards, !cardMode && scopedCards.length > 0);
    }

    const connections = state.graph.edges.filter((edge) =>
      isNodeInScope(edge.from) && isNodeInScope(edge.to)
    );
    if (totalConnections) {
      totalConnections.textContent = connections.length;
      setPillVisible(totalConnections, !cardMode);
    }

    syncGraphFilterUI();
  }

  async function refreshData() {
    const cardPromise = typeof getAllCards === "function" ? getAllCards() : Promise.resolve([]);
    const heapPromise = typeof getAllHeaps === "function" ? getAllHeaps() : Promise.resolve([]);
    const [nodes, quotes, cues, tags, cards, heaps] = await Promise.all([
      getAllNodes(),
      getAllQuotes(),
      getAllCues(),
      getAllTags(),
      cardPromise,
      heapPromise
    ]);
    state.nodes = nodes;
    state.quotes = quotes;
    state.cues = cues;
    state.tags = tags;
    state.cards = cards || [];
    state.heaps = mergeHeapOrder(heaps);
    if (state.activeHeapId && !state.heaps.some((heap) => heap.id === state.activeHeapId)) {
      state.activeHeapId = null;
      state.heapSidebarOpen = false;
    }
    state.layerNodes = computeLayerNodesFromSources(nodes);

    const hadFocus = Boolean(state.focusSubject);
    state.focusSubject = resolveFocusSubject(state.focusSubject);

    buildGraph();

    // A focused subject that was deleted (or renamed away) falls back to the
    // global map rather than leaving an empty canvas. Card-only decks are a
    // valid scope even when they have no knowledge-layer nodes.
    const hasScopedCards = (state.cards || []).some(isCardInScope);
    if (hadFocus && state.focusSubject && state.scopeNodeIds.size === 0 && !hasScopedCards) {
      state.focusSubject = null;
      recomputeScope();
    }

    const currentIds = new Set(state.graph.nodes.keys());
    let prunedLock = false;
    for (const id of state.nodePositions.keys()) {
      if (!currentIds.has(id)) {
        state.nodePositions.delete(id);
        state.velocities.delete(id);
        if (state.lockedNodes.delete(id)) prunedLock = true;
        state.pinnedNodes.delete(id);
        state.lockVisuals.delete(id);
      }
    }
    state.lockedNodes.forEach((id) => {
      if (currentIds.has(id)) return;
      state.lockedNodes.delete(id);
      state.pinnedNodes.delete(id);
      state.lockVisuals.delete(id);
      prunedLock = true;
    });
    if (prunedLock) scheduleLayoutSave();

    const layoutWidth = canvas?.parentElement?.clientWidth || 800;
    const layoutHeight = canvas?.parentElement?.clientHeight || 600;
    layoutRadial(layoutWidth, layoutHeight, { preserveExisting: true });
    seedCardScenePositions();
    lastCanvasSize = { width: layoutWidth, height: layoutHeight };

    // A data refresh invalidates any in-flight morph. Dots rebuild their
    // slots from the fresh card set; Graph keeps the session card positions.
    state.sceneTransition = null;

    if (state.viewMode === "dots") {
      // New cards were just seeded in graph space. Capture that as their
      // home before the dot targets overwrite x/y.
      state.cardScene.forEach((scene) => {
        if (scene.homeValid || !Number.isFinite(scene.x) || !Number.isFinite(scene.y)) return;
        scene.homeX = scene.x;
        scene.homeY = scene.y;
        scene.homeValid = true;
      });
      buildDotsLayout({ applyTargets: true });
    } else if (state.viewMode === "grid") {
      renderGrid();
    }

    updateStats();
    updateEmptyState();
    updateGraphSearchStatus();
    updateLockControls();
  }

  async function createNewNode(type) {
    const subject = state.focusSubject || contextSubject || (await dialog.prompt("Enter subject for the new node:")) || "General";
    const now = Date.now();

    try {
      if (type === "analysis") {
        const title = await dialog.prompt("Enter analysis title:");
        if (title === null) return;
        const analysis = await dialog.prompt("Enter analysis content:");
        if (analysis === null) return;

        await addNode({
          type: "analysis",
          subject,
          title,
          analysis,
          createdAt: now,
          updatedAt: now,
          quoteRefs: [],
          meta: {}
        });
      } else if (type === "quote") {
        const quote = await dialog.prompt("Enter quote text:");
        if (quote === null) return;

        await addQuote({
          type: "quote",
          subject,
          quote,
          createdAt: now,
          updatedAt: now,
          link: { sourceId: null },
          meta: {}
        });
      } else if (type === "cue") {
        const cue = await dialog.prompt("Enter cue text:");
        if (cue === null) return;

        await addCue({
          type: "cue",
          subject,
          cue,
          createdAt: now,
          updatedAt: now,
          meta: {}
        });
      }

      await refreshData();
      if (window.__neuronetCanvas) {
        window.__neuronetCanvas.triggerVerticalWave(0.8);
      }
    } catch (error) {
      console.error("Failed to create node:", error);
      dialog.alert("Error: " + error.message);
    }
  }

  function isConnectableItem(item) {
    // Cards live in the cards store. The generic link path writes through
    // addNode(), so connecting a card would copy it into the nodes store.
    // Card linking is a separate design question; keep cards out of Connect.
    return Boolean(item) && item.type !== "card";
  }

  async function linkNodes(id1, id2) {
    if (id1 === id2) return;

    const item1 = findItemById(id1);
    const item2 = findItemById(id2);
    if (!isConnectableItem(item1) || !isConnectableItem(item2)) return;

    // Use proper bidirectional linking for analysis-quote connections
    if (item1.type === "analysis" && item2.type === "quote") {
      // FIX: Use correct parameter order (quoteId, analysisId)
      await linkAnalysisToQuote(item2.id, item1.id);
      return;
    }

    if (item1.type === "quote" && item2.type === "analysis") {
      // FIX: Use correct parameter order (quoteId, analysisId)
      await linkAnalysisToQuote(item1.id, item2.id);
      return;
    }

    if (item1.type === "cue") {
      if (item2.type === "quote") {
        item1.quoteId = item2.id;
        await addCue(item1);
        return;
      } else if (item2.type === "analysis") {
        item1.analysisId = item2.id;
        await addCue(item1);
        return;
      }
    }

    if (item2.type === "cue") {
      return linkNodes(id2, id1);
    }

    // Generic bidirectional manual link (for non-analysis-quote connections)
    const updateManualLink = async (item, targetId) => {
      if (!item.meta) item.meta = {};
      if (!item.meta.manualLinks) item.meta.manualLinks = [];
      if (!item.meta.manualLinks.includes(targetId)) {
        item.meta.manualLinks.push(targetId);
        if (item.type === "quote") await addQuote(item);
        else if (item.type === "cue") await addCue(item);
        else await addNode(item);
      }
    };

    await updateManualLink(item1, id2);
    await updateManualLink(item2, id1);
  }

  async function breakLink(id1, id2) {
    const item1 = findItemById(id1);
    const item2 = findItemById(id2);
    if (!isConnectableItem(item1) || !isConnectableItem(item2)) return;

    // Use proper bidirectional unlinking for analysis-quote connections
    if (item1.type === "analysis" && item2.type === "quote") {
      // FIX: Use correct parameter order (quoteId, analysisId)
      await unlinkAnalysisFromQuote(item2.id, item1.id);
      await refreshData();
      if (state.selectedNodeId === id1) renderSidebar(item1);
      return;
    } else if (item1.type === "quote" && item2.type === "analysis") {
      // FIX: Use correct parameter order (quoteId, analysisId)
      await unlinkAnalysisFromQuote(item1.id, item2.id);
      await refreshData();
      if (state.selectedNodeId === id1) renderSidebar(item1);
      return;
    }

    // Handle manual links (non-analysis-quote connections)
    const removeFromMeta = async (item, targetId) => {
      if (item.meta && item.meta.manualLinks) {
        item.meta.manualLinks = item.meta.manualLinks.filter(id => id !== targetId);
        if (item.type === "quote") await addQuote(item);
        else if (item.type === "cue") await addCue(item);
        else await addNode(item);
      }
    };

    await removeFromMeta(item1, id2);
    await removeFromMeta(item2, id1);

    if (item1.type === "cue") {
      if (item1.quoteId === id2) {
        item1.quoteId = null;
        await addCue(item1);
      } else if (item1.analysisId === id2) {
        item1.analysisId = null;
        await addCue(item1);
      }
    } else if (item2.type === "cue") {
      await breakLink(id2, id1);
    }

    await refreshData();
    if (state.selectedNodeId === id1) renderSidebar(item1);
  }

  function setupEventListeners() {
    document.addEventListener("keydown", handleSidebarEscape);
    nodeSidebar?.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () => setInspectorTab(button.dataset.inspectorTab));
    });
    nodeSidebar?.querySelector(".inspector-tabs")?.addEventListener("keydown", (e) => {
      const tabs = Array.from(nodeSidebar.querySelectorAll("[data-inspector-tab]"));
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      let next = current;
      if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;
      e.preventDefault();
      tabs[next].focus();
      setInspectorTab(tabs[next].dataset.inspectorTab);
    });
    if (viewToggle) {
      viewToggle.querySelectorAll(".view-toggle-btn").forEach((button) => {
        button.addEventListener("click", () => setViewMode(button.dataset.view));
      });
    }
    relayoutGraphBtn?.addEventListener("click", relayoutGraph);

    // Keyboard access to the canvas. Touch users get pointer gestures; this
    // keeps the same pan/zoom reachable without a mouse or trackpad.
    canvas?.addEventListener("keydown", (e) => {
      if (state.viewMode === "grid") return;
      const step = e.shiftKey ? 160 : 48;
      const zoomBy = (factor) => {
        const oldZoom = state.zoom;
        const nextZoom = Math.min(config.maxZoom, Math.max(config.minZoom, oldZoom * factor));
        if (nextZoom === oldZoom) return;
        state.zoom = nextZoom;
        state.panOffset.x *= nextZoom / oldZoom;
        state.panOffset.y *= nextZoom / oldZoom;
        state.userInteracted = true;
      };

      switch (e.key) {
        case "ArrowLeft": state.panOffset.x += step; break;
        case "ArrowRight": state.panOffset.x -= step; break;
        case "ArrowUp": state.panOffset.y += step; break;
        case "ArrowDown": state.panOffset.y -= step; break;
        case "+":
        case "=": zoomBy(1.2); break;
        case "-":
        case "_": zoomBy(1 / 1.2); break;
        case "0":
        case "f":
        case "F":
          state.userInteracted = false;
          e.preventDefault();
          scheduleLayoutSave(400);
          return;
        default:
          return;
      }
      e.preventDefault();
      state.userInteracted = true;
      scheduleLayoutSave(400);
    });

    librarySearchInput?.addEventListener("input", () => {
      state.librarySearch = librarySearchInput.value;
      state.selectedCardIds.clear();
      renderGrid();
    });
    librarySortSelect?.addEventListener("change", () => {
      state.librarySort = librarySortSelect.value || "deck";
      renderGrid();
    });
    librarySelectToggle?.addEventListener("click", () => {
      state.librarySelectMode = !state.librarySelectMode;
      if (!state.librarySelectMode) state.selectedCardIds.clear();
      renderGrid();
    });
    libraryAddSelectedBtn?.addEventListener("click", addSelectedCardsToHeap);

    graphSearchInput?.addEventListener("input", () => {
      state.graphSearch = graphSearchInput.value;
      // Searching is a navigation action: reframe so matches are on screen
      // rather than leaving the camera parked on an unrelated part of the map.
      state.userInteracted = false;
      updateEmptyState();
      updateGraphSearchStatus();
    });
    graphSearchInput?.addEventListener("search", () => {
      // Safari's native clear button fires "search" without a reliable input
      // event in older iOS versions.
      state.graphSearch = graphSearchInput.value;
      state.userInteracted = false;
      updateEmptyState();
      updateGraphSearchStatus();
    });
    graphSearchInput?.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !graphSearchInput.value) return;
      e.preventDefault();
      graphSearchInput.value = "";
      state.graphSearch = "";
      state.userInteracted = false;
      updateEmptyState();
      updateGraphSearchStatus();
      graphSearchInput.blur();
    });
    graphFilterPills().forEach((pill) => {
      pill.addEventListener("click", () => setGraphTypeFilter(pill.dataset.graphType));
    });
    graphFitBtn?.addEventListener("click", () => {
      state.userInteracted = false;
      const term = state.graphSearch.trim();
      const filter = state.graphTypeFilter;
      if (term || filter !== "all") {
        const count = matchingGraphNodeCount();
        setGraphStatus(`${count} ${count === 1 ? "match" : "matches"} framed`, "success");
      } else {
        setGraphStatus("Fit to graph", "success");
      }
    });
    lockModeBtn?.addEventListener("click", () => {
      setLockMode(!state.lockMode);
    });

    if (gridContainer) {
      gridContainer.addEventListener("click", async (e) => {
        if (performance.now() < ignoreCanvasClicksUntil) return;
        const target = e.target instanceof Element ? e.target : null;
        const deckToggle = target?.closest("[data-deck-toggle]");
        if (deckToggle) {
          const deck = deckToggle.dataset.deckToggle;
          if (state.collapsedDecks.has(deck)) state.collapsedDecks.delete(deck);
          else state.collapsedDecks.add(deck);
          renderGrid();
          return;
        }
        const heapBtn = target?.closest("[data-heap-card-id]");
        if (heapBtn) {
          e.preventDefault();
          e.stopPropagation();
          await toggleCardInActiveHeap(heapBtn.dataset.heapCardId);
          return;
        }
        const card = target?.closest(".mindmap-grid-card");
        if (!card?.dataset?.nodeId) return;
        if (state.librarySelectMode) {
          toggleLibraryCardSelection(card.dataset.nodeId);
          return;
        }
        openNodeSidebar(card.dataset.nodeId, card);
        if (window.__neuronetCanvas?.triggerRadialPulse) {
          window.__neuronetCanvas.triggerRadialPulse(e.clientX, e.clientY, 1.0);
        }
      });

      gridContainer.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const target = e.target instanceof Element ? e.target : null;
        const deckToggle = target?.closest("[data-deck-toggle]");
        if (deckToggle) {
          e.preventDefault();
          const deck = deckToggle.dataset.deckToggle;
          if (state.collapsedDecks.has(deck)) state.collapsedDecks.delete(deck);
          else state.collapsedDecks.add(deck);
          renderGrid();
          return;
        }
        if (target?.closest("[data-heap-card-id]")) return;
        const card = target?.closest(".mindmap-grid-card");
        if (!card?.dataset?.nodeId) return;
        e.preventDefault();
        if (state.librarySelectMode) {
          toggleLibraryCardSelection(card.dataset.nodeId);
          return;
        }
        openNodeSidebar(card.dataset.nodeId, card);
      });
    }

    if (libraryHeapSelect) {
      libraryHeapSelect.addEventListener("change", () => {
        state.activeHeapId = libraryHeapSelect.value || null;
        renderHeapControls();
        renderGrid();
      });
    }

    if (newHeapBtn) {
      newHeapBtn.addEventListener("click", () => createHeap());
    }

    if (heapSidebarStudyBtn) {
      heapSidebarStudyBtn.addEventListener("click", studyActiveHeap);
    }

    if (toggleHeapSidebarBtn) {
      toggleHeapSidebarBtn.addEventListener("click", () => {
        const heap = getActiveHeap();
        if (!heap) {
          dialog.alert("Create or select a heap first.");
          return;
        }
        if (nodeSidebar?.classList.contains("open") && state.inspectorTab === "heap") {
          closeSidebar();
          return;
        }
        state.heapSidebarOpen = true;
        openInspector("heap");
      });
    }

    if (deleteHeapBtn) {
      deleteHeapBtn.addEventListener("click", deleteActiveHeap);
    }

    if (libraryHeapItems) {
      libraryHeapItems.addEventListener("click", async (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const emptyAction = target?.closest("[data-heap-empty-action]")?.dataset.heapEmptyAction;
        if (emptyAction === "new") {
          await createHeap();
          return;
        }
        if (emptyAction === "browse") {
          closeSidebar();
          setViewMode("grid");
          return;
        }
        const actionBtn = target?.closest("[data-heap-action]");
        if (!actionBtn || actionBtn.disabled) return;
        const cardId = actionBtn.dataset.heapCardId;
        const action = actionBtn.dataset.heapAction;
        if (!cardId) return;
        if (action === "up") await moveHeapCard(cardId, -1);
        else if (action === "down") await moveHeapCard(cardId, 1);
        else if (action === "remove") await removeHeapCard(cardId);
      });

      // Pointer-based reorder. The list is re-rendered only once, on release,
      // so the dragged element is never destroyed mid-gesture.
      let heapDrag = null;

      const heapDropPosition = (clientY) => {
        const remaining = heapDrag.items.filter((element) => element !== heapDrag.item);
        let position = 0;
        for (const element of remaining) {
          const rect = element.getBoundingClientRect();
          if (clientY > rect.top + rect.height / 2) position += 1;
          else break;
        }
        return position;
      };

      libraryHeapItems.addEventListener("pointerdown", (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const handle = target?.closest("[data-heap-drag-handle]");
        const item = handle?.closest("[data-heap-item-id]");
        if (!item || !libraryHeapItems.contains(item) || !getActiveHeap()) return;
        const items = Array.from(libraryHeapItems.querySelectorAll("[data-heap-item-id]"));
        heapDrag = {
          pointerId: e.pointerId,
          cardId: item.dataset.heapItemId,
          item,
          items,
          startIndex: items.indexOf(item),
          dropPosition: items.indexOf(item)
        };
        item.classList.add("dragging");
        handle.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });

      libraryHeapItems.addEventListener("pointermove", (e) => {
        if (!heapDrag || heapDrag.pointerId !== e.pointerId) return;
        const rect = libraryHeapItems.getBoundingClientRect();
        if (e.clientY < rect.top + 36) libraryHeapItems.scrollTop -= 10;
        else if (e.clientY > rect.bottom - 36) libraryHeapItems.scrollTop += 10;

        heapDrag.dropPosition = heapDropPosition(e.clientY);
        const remaining = heapDrag.items.filter((element) => element !== heapDrag.item);
        remaining.forEach((element, index) => {
          element.classList.toggle(
            "drag-over",
            index === Math.min(heapDrag.dropPosition, remaining.length - 1)
          );
        });
      });

      const finishHeapDrag = (e, cancelled = false) => {
        if (!heapDrag || heapDrag.pointerId !== e.pointerId) return;
        const { cardId, item, items, startIndex, dropPosition } = heapDrag;
        heapDrag = null;
        items.forEach((element) => element.classList.remove("dragging", "drag-over"));
        item.classList.remove("dragging");
        try {
          if (item.hasPointerCapture?.(e.pointerId)) item.releasePointerCapture(e.pointerId);
        } catch (_) {
          // Already released.
        }
        if (!cancelled && dropPosition !== startIndex) {
          reorderHeapCard(cardId, dropPosition);
        }
      };

      libraryHeapItems.addEventListener("pointerup", (e) => finishHeapDrag(e));
      libraryHeapItems.addEventListener("pointercancel", (e) => finishHeapDrag(e, true));
    }

    if (canvas) {
      canvas.addEventListener("click", (e) => {
        if (performance.now() < ignoreCanvasClicksUntil) return;
        if (state.isConnecting) return;
        if (state.hasDragged) {
          state.hasDragged = false; // Reset it here just in case
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const pos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        const node = findNodeAtPosition(pos.x, pos.y);
        if (state.lockMode) {
          if (node) {
            setNodeLocked(node.id, !state.lockedNodes.has(node.id), { announce: false });
            const count = state.lockedNodes.size;
            setGraphStatus(
              count === 0
                ? "Lock mode: tap nodes to lock"
                : `${count} ${count === 1 ? "position" : "positions"} locked`,
              "success",
              { sticky: true }
            );
          }
          return;
        }
        if (node) {
          openNodeSidebar(node.id);
          // Trigger reactive pulse at screen coordinates
          if (window.__neuronetCanvas) {
            window.__neuronetCanvas.triggerRadialPulse(e.clientX, e.clientY, 1.2);
          }
        } else {
          closeSidebar();
        }
      });

      // Pointer Events are the single gesture layer for mouse, pen and touch.
      // One pointer pans or drags a node; two pointers pinch-zoom. Node
      // positions are kept in world space so the drag offset survives zoom.
      const activePointers = new Map();
      let pinchStart = null;

      const canvasPoint = (e) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      const pointerMidpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const pointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

      const releasePointer = (e) => {
        try {
          if (canvas.hasPointerCapture?.(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch (_) {
          // Pointer already released by the browser.
        }
      };

      const finishGesture = (e, cancelled = false) => {
        const wasDragging = Boolean(state.draggingNodeId);
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) pinchStart = null;
        if (activePointers.size === 0) {
          // A dragged node stays pinned until Re-layout. Otherwise the next
          // physics tick would pull the arrangement straight back.
          state.draggingNodeId = null;
          state.isPanning = false;
          canvas.style.cursor = state.lockMode ? "crosshair" : "default";
        }
        if (cancelled) state.hasDragged = true;
        releasePointer(e);
        // A deliberate drag is a layout the user chose; persist it now once the
        // map has settled. During the opening explosion, let the settle timer
        // capture the final arrangement instead of freezing a half-formed one.
        if (wasDragging && positionsStable) scheduleLayoutSave(200);
        else if (!wasDragging) scheduleLayoutSave(400);
      };

      canvas.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;

        canvas.setPointerCapture?.(e.pointerId);
        const point = canvasPoint(e);

        if (state.viewMode === "dots") {
          // Dots is a tall chart. One finger drags it vertically when the
          // content overflows; taps still fall through to the click handler.
          if (!state.dotsLayout?.canScroll) return;
          activePointers.set(e.pointerId, point);
          state.hasDragged = false;
          state.isPanning = true;
          state.panStartPos = point;
          state.panLastPos = point;
          return;
        }

        activePointers.set(e.pointerId, point);
        state.hasDragged = false;

        if (activePointers.size === 2) {
          const [a, b] = Array.from(activePointers.values());
          const mid = pointerMidpoint(a, b);
          const centerX = viewWidth() / 2;
          const centerY = viewHeight() / 2;
          pinchStart = {
            distance: Math.max(1, pointerDistance(a, b)),
            zoom: state.zoom,
            pan: { ...state.panOffset },
            world: {
              x: (mid.x - centerX - state.panOffset.x) / state.zoom + centerX,
              y: (mid.y - centerY - state.panOffset.y) / state.zoom + centerY
            }
          };
          state.draggingNodeId = null;
          state.isPanning = false;
          state.hasDragged = true;
          return;
        }

        if (activePointers.size > 2) return;

        const node = findNodeAtPosition(point.x, point.y);
        if (node && e.button !== 1) {
          state.userInteracted = true;
          state.draggingNodeId = node.id;
          state.panStartPos = point;
          const nodePos = state.nodePositions.get(node.id);
          if (nodePos) {
            const world = inverseTransform(point.x, point.y);
            state.dragOffset = {
              x: world.x - nodePos.x,
              y: world.y - nodePos.y
            };
          } else {
            state.dragOffset = { x: 0, y: 0 };
          }
          canvas.style.cursor = "grabbing";
        } else {
          state.isPanning = true;
          state.panStartPos = point;
          state.panLastPos = point;
          canvas.style.cursor = "grabbing";
        }
      });

      canvas.addEventListener("pointermove", (e) => {
        const point = canvasPoint(e);

        if (!activePointers.has(e.pointerId)) {
          if (e.pointerType === "mouse") {
            const node = findNodeAtPosition(point.x, point.y);
            state.hoveredNodeId = node ? node.id : null;
            canvas.style.cursor = node ? "pointer" : state.lockMode ? "crosshair" : "default";
          }
          return;
        }

        activePointers.set(e.pointerId, point);

        if (state.viewMode === "dots" && activePointers.size > 1) return;

        if (activePointers.size >= 2 && pinchStart) {
          if (state.viewMode === "dots") return;
          const [a, b] = Array.from(activePointers.values());
          const mid = pointerMidpoint(a, b);
          const nextZoom = Math.min(
            config.maxZoom,
            Math.max(config.minZoom, pinchStart.zoom * (pointerDistance(a, b) / pinchStart.distance))
          );
          const centerX = viewWidth() / 2;
          const centerY = viewHeight() / 2;
          state.zoom = nextZoom;
          state.panOffset = {
            x: mid.x - centerX - (pinchStart.world.x - centerX) * nextZoom,
            y: mid.y - centerY - (pinchStart.world.y - centerY) * nextZoom
          };
          state.hasDragged = true;
          state.userInteracted = true;
          return;
        }

        if (state.isPanning) {
          const dx = point.x - state.panLastPos.x;
          const dy = point.y - state.panLastPos.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) state.hasDragged = true;
          state.userInteracted = true;
          state.panOffset.x += dx;
          state.panOffset.y += dy;
          state.panLastPos = point;
          if (state.viewMode === "dots") {
            state.panOffset.x -= dx;
            clampDotsScroll();
          }
        } else if (state.draggingNodeId) {
          if (Math.hypot(point.x - state.panStartPos.x, point.y - state.panStartPos.y) <= 3) return;
          state.hasDragged = true;
          state.userInteracted = true;
          // A drop holds the node for this session. It is not an explicit lock:
          // Re-layout may still release it and move it with the rest.
          state.pinnedNodes.add(state.draggingNodeId);
          const nodePos = state.nodePositions.get(state.draggingNodeId);
          if (nodePos) {
            const world = inverseTransform(point.x, point.y);
            nodePos.x = world.x - state.dragOffset.x;
            nodePos.y = world.y - state.dragOffset.y;
          }
        }
      });

      canvas.addEventListener("pointerup", (e) => finishGesture(e));
      canvas.addEventListener("pointercancel", (e) => finishGesture(e, true));

      canvas.addEventListener("pointerleave", () => {
        // With pointer capture this fires only after the gesture is over.
        // Never clear drag/pan here: that was the source of stuck nodes.
        state.hoveredNodeId = null;
        if (!state.draggingNodeId && !state.isPanning) {
          canvas.style.cursor = state.lockMode ? "crosshair" : "default";
        }
      });

      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (state.viewMode === "dots") {
          scrollDots(e.deltaY);
          return;
        }
        state.userInteracted = true;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(config.maxZoom, Math.max(config.minZoom, state.zoom * zoomFactor));

        const worldX = (mouseX - viewWidth() / 2 - state.panOffset.x) / state.zoom + viewWidth() / 2;
        const worldY = (mouseY - viewHeight() / 2 - state.panOffset.y) / state.zoom + viewHeight() / 2;

        state.panOffset.x = mouseX - viewWidth() / 2 - (worldX - viewWidth() / 2) * newZoom;
        state.panOffset.y = mouseY - viewHeight() / 2 - (worldY - viewHeight() / 2) * newZoom;
        state.zoom = newZoom;
        scheduleLayoutSave(400);
      }, { passive: false });
    }

    if (blueprintArea) {
      blueprintArea.addEventListener("click", (e) => {
        if (e.target === blueprintArea) {
          closeSidebar();
        }
      });
    }

    // Delegate the close action to the sidebar so it keeps working even if the
    // header content is re-rendered while a node is selected.
    if (nodeSidebar) {
      nodeSidebar.addEventListener("click", (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest("#sidebarClose")) {
          e.preventDefault();
          closeSidebar();
        }
      });
    }
    nodeSidebarBackdrop?.addEventListener("click", closeSidebar);

    const lockNodeBtn = document.getElementById("lockNodeBtn");
    if (lockNodeBtn) {
      lockNodeBtn.addEventListener("click", () => {
        if (!state.selectedNodeId) return;
        const id = state.selectedNodeId;
        setNodeLocked(id, !state.lockedNodes.has(id));
        updateInspectorLockState();
      });
    }

    const unlockAllNodesBtn = document.getElementById("unlockAllNodesBtn");
    if (unlockAllNodesBtn) {
      unlockAllNodesBtn.addEventListener("click", () => {
        unlockAllNodes();
      });
    }

    if (toggleMetadataBtn) {
      toggleMetadataBtn.addEventListener("click", () => {
        if (!state.selectedNodeId) return;
        const selectedItem = findItemById(state.selectedNodeId);
        if (!selectedItem) return;
        state.sidebarView = state.sidebarView === "metadata" ? "content" : "metadata";
        renderSidebar(selectedItem);
      });
    }

    if (deleteNodeBtn) {
      deleteNodeBtn.addEventListener("click", handleDeleteNode);
    }

    if (editNodeBtn) {
      editNodeBtn.addEventListener("click", () => {
        if (state.selectedNodeId) {
          const selectedItem = findItemById(state.selectedNodeId);
          if (selectedItem) {
            closeSidebar();
            if (selectedItem.type === "card") {
              window.dispatchEvent(new CustomEvent("neuronet-open-tool", {
                detail: {
                  tool: "memory",
                  cardId: selectedItem.id,
                  subject: String(selectedItem.deck || contextSubject || "").trim()
                }
              }));
              return;
            }
            window.dispatchEvent(new CustomEvent("neuronet-open-tool", {
              detail: (() => {
                const subject = String(selectedItem.subject || selectedItem.title || "").trim();
                return {
                  tool: "analysis",
                  subject: subject || contextSubject,
                  nodeId: selectedItem.id
                };
              })()
            }));
          }
        }
      });
    }

    // New Node Dropdown
    const dropdownToggle = newNodeDropdown?.querySelector(".dropdown-toggle");
    const dropdownBtns = newNodeDropdown?.querySelectorAll(".dropdown-content button");

    if (dropdownToggle) {
      dropdownToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        newNodeDropdown.classList.toggle("open");
      });
    }

    dropdownBtns?.forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        createNewNode(type);
        newNodeDropdown.classList.remove("open");
      });
    });

    document.addEventListener("click", () => {
      newNodeDropdown?.classList.remove("open");
    });

    // Connection Mode
    const connectingOverlay = document.getElementById("connectingOverlay");

    if (connectNodesBtn) {
      connectNodesBtn.addEventListener("click", () => {
        state.isConnecting = !state.isConnecting;
        state.connectingSourceId = null;

        connectNodesBtn.classList.toggle("active", state.isConnecting);
        if (!state.isConnecting) {
          connectingOverlay?.classList.remove("visible");
        }
      });
    }

    // Handle connection clicks
    if (canvas) {
      canvas.addEventListener("click", async (e) => {
        if (!state.isConnecting || state.hasDragged) return;

        const rect = canvas.getBoundingClientRect();
        const pos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        const node = findNodeAtPosition(pos.x, pos.y);
        const nodeItem = node ? findItemById(node.id) : null;

        if (node && isConnectableItem(nodeItem)) {
          if (!state.connectingSourceId) {
            state.connectingSourceId = node.id;
            if (connectingOverlay) {
              connectingOverlay.textContent = `Connecting from: ${getNodeDisplayTitle(nodeItem)}... Select target.`;
              connectingOverlay.classList.add("visible");
            }
          } else {
            const sourceId = state.connectingSourceId;
            const targetId = node.id;

            if (sourceId !== targetId) {
              await linkNodes(sourceId, targetId);
              await refreshData();
              if (window.__neuronetCanvas) {
                window.__neuronetCanvas.triggerRadialPulse(e.clientX, e.clientY, 1.0);
              }
            }

            state.connectingSourceId = null;
            state.isConnecting = false;
            connectNodesBtn?.classList.remove("active");
            connectingOverlay?.classList.remove("visible");
          }
        }
      });
    }

    // Connections Toggle
    const connectionsHeader = document.getElementById("connectionsHeader");
    const connectionsContainer = document.getElementById("connectionsContainer");
    if (connectionsHeader && connectionsContainer) {
      connectionsHeader.addEventListener("click", () => {
        connectionsContainer.classList.toggle("collapsed");
      });
    }
  }

  function handleDBChange() {
    if (suppressHeapDBRefresh) {
      suppressHeapDBRefresh = false;
      return;
    }
    refreshData();
    // Trigger reactive sweep on data change
    if (window.__neuronetCanvas) {
      window.__neuronetCanvas.triggerVerticalWave(0.8);
    }
  }

  function handleSidebarEscape(event) {
    if (event.key !== "Escape") return;
    if (!nodeSidebar?.classList.contains("open")) return;
    closeSidebar();
  }

  function syncHeaderHeight() {
    const shell = document.querySelector(".mindmap-shell");
    const header = document.querySelector(".mindmap-header");
    if (!shell || !header) return;
    shell.style.setProperty("--mindmap-header-height", `${header.offsetHeight}px`);
  }

  function handleResize() {
    const container = canvas?.parentElement;
    if (!container) return;

    syncHeaderHeight();

    if (state.viewMode === "dots") {
      buildDotsLayout({ applyTargets: !state.sceneTransition });
      return;
    }

    const width = container.clientWidth;
    const height = container.clientHeight;

    if (state.nodePositions.size === 0) {
      initializePositions(width, height);
    }
  }

  window.addEventListener("resize", handleResize);
  document.addEventListener("db-change", handleDBChange);
  const handlePageHide = () => saveLayoutNow();
  window.addEventListener("pagehide", handlePageHide);

  // Restore before the first data refresh so buildGraph and the radial layout
  // treat the saved points as the existing arrangement instead of re-seeding.
  applyPersistedLayout(readPersistedLayout());

  await refreshData();

  const container = canvas?.parentElement;
  if (container) {
    initializePositions(container.clientWidth, container.clientHeight);
  }
  if (!positionsStable) markLayoutUnstable(4500);

  syncHeaderHeight();
  if (typeof ResizeObserver === "function") {
    const header = document.querySelector(".mindmap-header");
    if (header) {
      headerResizeObserver = new ResizeObserver(syncHeaderHeight);
      headerResizeObserver.observe(header);
    }
  }

  // A tool load always starts with the detail panel closed. This also clears
  // any stale state if the previous instance left a node selected.
  nodeSidebar?.classList.remove("open");
  nodeSidebar?.setAttribute("aria-hidden", "true");
  nodeSidebarBackdrop?.classList.remove("visible");
  state.selectedNodeId = null;
  setInspectorTab("details");

  // Suppress the opening tap's delayed synthetic click on the canvas.
  ignoreCanvasClicksUntil = performance.now() + 450;

  // Opening from Memory's Manual mode lands directly in the Library with the
  // chosen heap active. Sync the toggle/visibility state without replaying a
  // Graph↔Dots transition.
  if (state.viewMode !== "graph") {
    setViewMode(state.viewMode);
  }
  updateContextualActions();

  // Opening from a heap context lands in the Library with the unified
  // inspector already showing that heap.
  if (state.heapSidebarOpen && getActiveHeap()) {
    openInspector("heap");
  }

  syncGraphFilterUI();
  setupEventListeners();
  tick();

  const setSubjectHandler = (subject) => setFocusSubject(subject);
  window.__neuronetMindmapSetSubject = setSubjectHandler;

  window.__neuronetMindmapCleanup = () => {
    saveLayoutNow();
    state.simulationRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (layoutSettleTimer) {
      clearTimeout(layoutSettleTimer);
      layoutSettleTimer = 0;
    }
    if (graphStatusTimer) {
      clearTimeout(graphStatusTimer);
      graphStatusTimer = 0;
    }
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleSidebarEscape);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pagehide", handlePageHide);
    headerResizeObserver?.disconnect();
    headerResizeObserver = null;
    if (window.__neuronetMindmapSetSubject === setSubjectHandler) {
      window.__neuronetMindmapSetSubject = null;
    }
  };
}
