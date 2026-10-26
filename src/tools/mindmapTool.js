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
    deleteTag,
    removeNodeEverywhere,
    removeQuoteEverywhere,
    removeCueEverywhere,
    linkAnalysisToQuote,
    unlinkAnalysisFromQuote,
    escapeHtml
  } = deps;

  const { subject: contextSubject } = context;

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
    lockedNodes: new Set(),
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    isPanning: false,
    panStartPos: { x: 0, y: 0 },
    simulationRunning: true,
    viewMode: "graph",
    sidebarView: "content",
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
    dotsLayout: null,
    dotAnim: null
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
  const blueprintArea = document.getElementById("blueprintArea");
  const gridView = document.getElementById("mindmapGridView");
  const gridContainer = document.getElementById("mindmapGrid");
  const dotsLegend = document.getElementById("mindmapDotsLegend");
  const viewToggle = document.getElementById("mindmapViewToggle");
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
      "pastpaper": 0.65
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
      pastpaper: "#ffd166"
    }
  };

  const GRID_CARD_TYPES = new Set(["analysis", "quote", "cue", "source", "pastpaper"]);
  const GRID_TYPE_ORDER = { analysis: 0, quote: 1, cue: 2, source: 3, pastpaper: 4 };
  const GRID_TYPE_LABELS = {
    analysis: "Analysis",
    quote: "Quote",
    cue: "Cue",
    source: "Source",
    pastpaper: "Past paper"
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
  ];
  const DOT_UNKNOWN_COLOR = "#33443d";
  const GRADE_SCORES = { easy: 1, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };
  const RECALL_GRADE_SCORES = { easy: 0.9, kinda: 0.6, didnt_know: 0.2, didntknow: 0.2 };
  const DOT_MIN_CELL = 6;
  const DOT_MAX_CELL = 40;
  const DOT_MORPH_MS = 760;
  const DOT_MORPH_STAGGER_MS = 180;

  // QuadTree implementation for efficient spatial indexing
  class QuadTree {
    constructor(boundary, capacity = 4) {
      this.boundary = boundary;
      this.capacity = capacity;
      this.points = [];
      this.divided = false;
      this.northeast = null;
      this.northwest = null;
      this.southeast = null;
      this.southwest = null;
    }

    insert(point) {
      if (!this.contains(this.boundary, point)) return false;
      if (this.points.length < this.capacity) {
        this.points.push(point);
        return true;
      }
      if (!this.divided) this.subdivide();
      if (this.northeast.insert(point)) return true;
      if (this.northwest.insert(point)) return true;
      if (this.southeast.insert(point)) return true;
      if (this.southwest.insert(point)) return true;
      return false;
    }

    contains(boundary, point) {
      return (
        point.x >= boundary.x &&
        point.x < boundary.x + boundary.w &&
        point.y >= boundary.y &&
        point.y < boundary.y + boundary.h
      );
    }

    subdivide() {
      const { x, y, w, h } = this.boundary;
      const halfW = w / 2;
      const halfH = h / 2;
      const ne = { x: x + halfW, y: y, w: halfW, h: halfH };
      this.northeast = new QuadTree(ne, this.capacity);
      const nw = { x: x, y: y, w: halfW, h: halfH };
      this.northwest = new QuadTree(nw, this.capacity);
      const se = { x: x + halfW, y: y + halfH, w: halfW, h: halfH };
      this.southeast = new QuadTree(se, this.capacity);
      const sw = { x: x, y: y + halfH, w: halfW, h: halfH };
      this.southwest = new QuadTree(sw, this.capacity);
      this.divided = true;
    }

    query(range, found = []) {
      if (!this.intersects(this.boundary, range)) return found;
      for (const p of this.points) {
        if (this.contains(range, p)) found.push(p);
      }
      if (this.divided) {
        this.northeast.query(range, found);
        this.northwest.query(range, found);
        this.southeast.query(range, found);
        this.southwest.query(range, found);
      }
      return found;
    }

    intersects(boundary, range) {
      return !(
        range.x > boundary.x + boundary.w ||
        range.x + range.w < boundary.x ||
        range.y > boundary.y + boundary.h ||
        range.y + range.h < boundary.y
      );
    }
  }

  // Profiler functions
  const perf = { enabled: true, lastLog: 0 };

  function profileStart(label) {
    if (!perf.enabled) return;
    performance.mark(label + "-start");
  }

  function profileEnd(label) {
    if (!perf.enabled) return;
    performance.mark(label + "-end");
    performance.measure(label, label + "-start", label + "-end");
  }

  function logPerf() {
    if (!perf.enabled) return;
    const now = performance.now();
    if (now - perf.lastLog < 1000) return;
    const entries = performance.getEntriesByType("measure");
    const grouped = {};
    entries.forEach(e => {
      if (!grouped[e.name]) grouped[e.name] = [];
      grouped[e.name].push(e.duration);
    });
    Object.entries(grouped).forEach(([name, arr]) => {
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    });
    performance.clearMeasures();
    perf.lastLog = now;
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
      default: return "●";
    }
  }

  function getNodeColor(type) {
    return config.colors[type] || "#9aa4ad";
  }

  function getNodeDisplayTitle(node) {
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
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type?.startsWith("layer")) return (node?.meta?.layerPath || []).join(" > ") || "";
    if (node.type === "source") return node.content?.substring(0, maxLength) || node.contentText?.substring(0, maxLength) || "";
    if (node.type === "cue") return node.cue || "";
    if (node.type === "pastpaper") return pastPaperSummary(node);
    return "";
  }

  function getNodeFullContent(node) {
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

    push("id", node.id);
    push("type", node.type);
    push("subject", node.subject);

    const createdAt = formatTimestamp(node.createdAt);
    const updatedAt = formatTimestamp(node.updatedAt);
    if (createdAt) push("createdAt", createdAt);
    if (updatedAt) push("updatedAt", updatedAt);

    if (node.type === "quote") {
      if (node.link?.sourceId) push("link.sourceId", node.link.sourceId);
      if (node.section) push("section", node.section);
    }

    if (node.type === "analysis") {
      push("quoteRefs.count", Array.isArray(node.quoteRefs) ? node.quoteRefs.length : 0);
    }

    const meta = node.meta || {};
    const memoryKeys = ["S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount", "expectedTime", "avgTime", "timeVariance", "consistency", "confidence", "easeFactor", "honestyFlag", "clusterId", "lastGrade"];
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

    const otherMetaKeys = Object.keys(meta || {}).filter((k) => !memoryKeys.includes(k)).sort();
    if (otherMetaKeys.length > 0) {
      lines.push("");
      lines.push("[meta]");
      otherMetaKeys.forEach((k) => {
        const v = meta[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          push(k, v);
        } else if (Array.isArray(v)) {
          push(k, `[${v.length} items]`);
        } else if (v && typeof v === "object") {
          push(k, "{...}");
        }
      });
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
      .filter((tag) => tag && tag.toLowerCase() !== "custom-deck");
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

  function buildGridCard(item) {
    const priority = getItemPriority(item);
    const recall = getItemRecall(item);
    const accuracy = getItemAccuracy(item);
    const tags = getGridTags(item);
    const preview = String(getNodePreview(item, 260) || "").replace(/\s+/g, " ").trim();

    return {
      id: item.id,
      type: item.type,
      typeLabel: GRID_TYPE_LABELS[item.type] || String(item.type || "node"),
      icon: getNodeTypeIcon(item.type),
      title: getNodeDisplayTitle(item),
      preview,
      priority,
      recall,
      accuracy,
      tags
    };
  }

  function buildCardDotItem(card) {
    const front = String(card?.front || "").trim();
    const back = String(card?.back || "").trim();
    const deck = String(card?.deck || "").trim() || "Unsorted";

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
      deckPath: Array.isArray(card?.deckPath) ? card.deckPath : [],
      order: Number.isFinite(Number(card?.order)) ? Number(card.order) : 0,
      createdAt: Number(card?.createdAt) || 0
    };
  }

  function buildGridData() {
    const subjectMap = new Map();

    getAllItems().forEach((item) => {
      if (!GRID_CARD_TYPES.has(item?.type)) return;
      if (!isNodeInScope(item.id)) return;

      const subject = getItemSubject(item) || "Unsorted";
      const parts = getItemLayerParts(item);
      const groupName = parts.l1 || (item.type === "pastpaper" ? "Past Papers" : "Unsorted");

      if (!subjectMap.has(subject)) subjectMap.set(subject, new Map());
      const groupMap = subjectMap.get(subject);
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName).push(buildGridCard(item));
    });

    return Array.from(subjectMap.entries())
      .map(([subject, groupMap]) => {
        const groups = Array.from(groupMap.entries())
          .map(([name, cards]) => {
            cards.sort((a, b) => {
              const typeDelta = (GRID_TYPE_ORDER[a.type] ?? 9) - (GRID_TYPE_ORDER[b.type] ?? 9);
              if (typeDelta !== 0) return typeDelta;
              const priorityDelta = (b.priority || 0) - (a.priority || 0);
              if (priorityDelta !== 0) return priorityDelta;
              return a.title.localeCompare(b.title);
            });
            return { name, cards };
          })
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

        const count = groups.reduce((sum, group) => sum + group.cards.length, 0);
        return { subject, groups, count };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: "base" }));
  }

  function syncGridSelection() {
    if (!gridContainer) return;
    gridContainer.querySelectorAll(".mindmap-grid-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.nodeId === state.selectedNodeId);
    });
  }

  function renderGrid() {
    if (!gridContainer) return;

    const subjects = buildGridData();
    updateStats();

    if (!subjects.length) {
      const message = state.focusSubject
        ? `No knowledge cards in ${state.focusSubject} yet. Add a quote, analysis, cue, or source to grow this subject.`
        : "No knowledge cards yet. Add sources, quotes, analyses, or cues to fill the grid.";
      gridContainer.innerHTML = `
        <div class="mindmap-grid-empty">
          <div class="mindmap-grid-empty-icon" aria-hidden="true">🕸️</div>
          <p>${escapeHtml(message)}</p>
        </div>
      `;
      return;
    }

    let cardIndex = 0;
    const html = subjects.map((section, subjectIndex) => {
      const groups = section.groups.map((group) => {
        const cards = group.cards.map((card) => {
          const importanceColor = card.priority
            ? GRID_IMPORTANCE_COLORS[card.priority]
            : "rgba(255, 255, 255, 0.14)";
          const accuracyClass = card.accuracy === null
            ? ""
            : card.accuracy >= 0.75
              ? "high"
              : card.accuracy >= 0.5
                ? "mid"
                : "low";
          const accuracyLabel = card.accuracy === null ? "—" : `${Math.round(card.accuracy * 100)}%`;
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
          const titleAttr = [
            card.typeLabel,
            card.priority ? `Priority ${card.priority}` : "No priority data",
            card.accuracy !== null ? `${accuracyLabel} accuracy` : "No accuracy data",
            card.recall.level !== "unknown"
              ? `${card.recall.label} recall${card.recall.derived ? " (linked quotes)" : ""}`
              : "No recall data"
          ].join(" · ");

          return `
            <button type="button" class="mindmap-grid-card recall-${card.recall.level}${card.type === "source" || card.type === "pastpaper" ? " is-context" : ""}${isSelected ? " selected" : ""}" data-node-id="${escapeHtml(card.id)}" style="--importance-color: ${importanceColor}; animation-delay: ${delay}ms" title="${escapeHtml(titleAttr)}">
              <span class="mindmap-grid-card-top">
                <span class="mindmap-grid-card-icon" aria-hidden="true">${card.icon}</span>
                <span class="mindmap-grid-card-type">${escapeHtml(card.typeLabel)}</span>
                <span class="mindmap-grid-accuracy ${accuracyClass}">${accuracyLabel}</span>
              </span>
              <span class="mindmap-grid-card-title">${escapeHtml(card.title)}</span>
              ${card.preview ? `<span class="mindmap-grid-card-preview">${escapeHtml(card.preview)}</span>` : ""}
              <span class="mindmap-grid-card-footer">
                ${tagChips}${tagOverflow}
                ${card.priority ? `<span class="mindmap-grid-priority">P${card.priority}</span>` : ""}
              </span>
            </button>
          `;
        }).join("");

        return `
          <div class="mindmap-grid-group">
            <div class="mindmap-grid-group-head">
              ${escapeHtml(group.name)}
              <span class="mindmap-grid-group-count">${group.cards.length}</span>
            </div>
            <div class="mindmap-grid-cards">${cards}</div>
          </div>
        `;
      }).join("");

      return `
        <section class="mindmap-grid-subject" style="animation-delay: ${Math.min(subjectIndex * 40, 200)}ms">
          <header class="mindmap-grid-subject-head">
            <span class="mindmap-grid-subject-dot" aria-hidden="true"></span>
            <h3>${escapeHtml(section.subject)}</h3>
            <span class="mindmap-grid-subject-meta">${section.count} card${section.count === 1 ? "" : "s"} · ${section.groups.length} group${section.groups.length === 1 ? "" : "s"}</span>
          </header>
          ${groups}
        </section>
      `;
    }).join("");

    gridContainer.innerHTML = html;
  }

  function buildDotSections() {
    const deckMap = new Map();

    (state.cards || []).forEach((card) => {
      if (!card?.id || !isCardInScope(card)) return;
      const deck = String(card.deck || "").trim() || "Unsorted";
      if (!deckMap.has(deck)) deckMap.set(deck, []);
      deckMap.get(deck).push(buildCardDotItem(card));
    });

    return Array.from(deckMap.entries())
      .map(([deck, cards]) => {
        // Stable creation order is the default. Performance sorting belongs to
        // the study queue, not this browse view.
        cards.sort((a, b) => {
          const orderDelta = a.order - b.order;
          if (orderDelta !== 0) return orderDelta;
          const createdDelta = a.createdAt - b.createdAt;
          if (createdDelta !== 0) return createdDelta;
          return a.title.localeCompare(b.title);
        });
        return { deck, cards, count: cards.length };
      })
      .sort((a, b) => a.deck.localeCompare(b.deck, undefined, { sensitivity: "base" }));
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

  function getDotsDisplayPositions(now, layout = state.dotsLayout, anim = state.dotAnim) {
    const positions = new Map();
    if (!layout) return positions;

    if (!anim) {
      layout.dots.forEach((dot, id) => positions.set(id, dot));
      return positions;
    }

    const elapsed = now - anim.start;
    if (elapsed >= anim.duration) {
      if (anim === state.dotAnim) state.dotAnim = null;
      layout.dots.forEach((dot, id) => positions.set(id, dot));
      return positions;
    }

    const morphDuration = Math.max(1, anim.duration - DOT_MORPH_STAGGER_MS);
    layout.dots.forEach((dot, id) => {
      const from = anim.from.get(id) || dot;
      const progress = Math.max(0, Math.min(1, (elapsed - (dot.delay || 0)) / morphDuration));
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      positions.set(id, {
        ...dot,
        x: from.x + (dot.x - from.x) * eased,
        y: from.y + (dot.y - from.y) * eased
      });
    });
    return positions;
  }

  function buildDotsLayout({ animate = false, fromGraph = false } = {}) {
    if (!canvas) return;

    const { width, height } = syncCanvasSize();
    const sections = buildDotSections();
    const previousLayout = state.dotsLayout;
    const previousPositions = getDotsDisplayPositions(performance.now(), previousLayout, state.dotAnim);
    const legendHeight = dotsLegend && !dotsLegend.hidden ? dotsLegend.offsetHeight + 10 : 6;
    const padX = Math.max(10, Math.min(24, width * 0.018));
    const top = legendHeight + 6;
    const bottom = 14;
    const availW = Math.max(80, width - padX * 2);
    const availH = Math.max(80, height - top - bottom);

    if (!sections.length) {
      state.dotsLayout = {
        dots: new Map(),
        sections: [],
        width,
        height,
        radius: 0,
        cell: 0,
        top,
        empty: true
      };
      state.dotAnim = null;
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

    const dots = new Map();
    const layoutSections = [];

    sections.forEach((section, sectionIndex) => {
      const placement = chosen.placements[sectionIndex];
      const x = padX + placement.col * (colW + colGap);
      const y = top + placement.y;
      const contentX = x + chosen.sectionPad + chosen.innerPad + placement.offsetX;
      let cursorY = y + chosen.sectionPad + chosen.headerH;

      placement.groups.forEach((group, groupIndex) => {
        group.cards.forEach((card, cardIndex) => {
          const row = Math.floor(cardIndex / placement.perRow);
          const col = cardIndex % placement.perRow;
          dots.set(card.id, {
            x: contentX + col * chosen.cell + chosen.cell / 2,
            y: cursorY + row * chosen.cell + chosen.cell / 2,
            card,
            delay: Math.min(DOT_MORPH_STAGGER_MS, (col + row) * 12),
            sectionIndex
          });
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
        h: placement.height
      });
    });

    state.dotsLayout = {
      dots,
      sections: layoutSections,
      width,
      height,
      radius: chosen.radius,
      cell: chosen.cell,
      top,
      empty: false
    };

    if (animate) {
      const from = new Map();
      dots.forEach((dot, id) => {
        let start = null;
        if (fromGraph) {
          const graphPos = state.nodePositions.get(id);
          if (graphPos) start = transformPoint(graphPos.x, graphPos.y);
        } else if (previousPositions.has(id)) {
          start = previousPositions.get(id);
        }
        from.set(id, start ? { x: start.x, y: start.y } : { x: width / 2, y: top + 30 });
      });
      state.dotAnim = { from, start: performance.now(), duration: DOT_MORPH_MS };
    } else {
      state.dotAnim = null;
    }
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

  function findDotAtPosition(x, y) {
    const layout = state.dotsLayout;
    if (!layout || !layout.dots.size) return null;

    const positions = state.dotAnim
      ? getDotsDisplayPositions(performance.now(), layout, state.dotAnim)
      : layout.dots;
    const hitRadius = Math.max(6, Math.min(14, layout.cell * 0.5));
    let best = null;
    let bestDistance = Infinity;

    positions.forEach((dot, id) => {
      const dx = x - dot.x;
      const dy = y - dot.y;
      const distance = dx * dx + dy * dy;
      if (distance <= hitRadius * hitRadius && distance < bestDistance) {
        best = dot;
        bestDistance = distance;
      }
    });

    return best;
  }

  function drawDotTooltip(dot, width, height, top) {
    const card = dot.card;
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
    let boxX = dot.x + state.dotsLayout.radius + 14;
    if (boxX + boxWidth > width - 8) boxX = dot.x - boxWidth - state.dotsLayout.radius - 14;
    boxX = Math.max(8, Math.min(width - boxWidth - 8, boxX));
    const boxY = Math.max(top + 4, Math.min(height - boxHeight - 8, dot.y - boxHeight / 2));

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

  function renderDots() {
    if (!ctx || !canvas) return;

    const { width, height } = syncCanvasSize();
    if (!state.dotsLayout || state.dotsLayout.width !== width || state.dotsLayout.height !== height) {
      buildDotsLayout({ animate: false });
    }

    const layout = state.dotsLayout;
    ctx.clearRect(0, 0, width, height);

    if (!layout || layout.empty || !layout.dots.size) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(230, 255, 245, 0.55)";
      ctx.font = "600 15px Inter, system-ui, sans-serif";
      ctx.fillText("No cards to chart yet", width / 2, height / 2 - 10);
      ctx.font = "13px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(230, 255, 245, 0.38)";
      ctx.fillText("Add cards in Memory or Quick Add to see them here.", width / 2, height / 2 + 14);
      ctx.restore();
      updateStats();
      updateEmptyState();
      return;
    }

    const positions = getDotsDisplayPositions(performance.now(), layout, state.dotAnim);

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

    const drawDot = (id, dot) => {
      const position = positions.get(id);
      if (!position) return;

      const isHovered = state.hoveredNodeId === id;
      const isSelected = state.selectedNodeId === id;
      const priorityColor = dot.card.priority
        ? GRID_IMPORTANCE_COLORS[dot.card.priority]
        : "rgba(255, 255, 255, 0.24)";
      const recallBin = getScoreBin(dot.card.recall?.score);
      const accuracyBin = getScoreBin(dot.card.accuracy);
      const radius = layout.radius
        * (isHovered ? 1.35 : 1)
        * (isSelected ? 1.12 : 1);
      const borderWidth = isSelected ? 2.5 : Math.max(1.2, Math.min(2.4, layout.cell * 0.085));
      // Keep the importance ring visually separate from the score fill. The
      // gap is structure, not another data channel.
      const fillRadius = Math.max(1.2, radius - borderWidth - 0.35);

      ctx.save();

      if (isHovered || isSelected) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "rgba(255, 255, 255, 0.07)" : "rgba(44, 255, 179, 0.08)";
        ctx.fill();
      }

      // Right half: accuracy. Paint the full inner disc first, then overwrite
      // the left half with recall. Both halves are solid colour bins.
      ctx.beginPath();
      ctx.arc(position.x, position.y, fillRadius, 0, Math.PI * 2);
      ctx.fillStyle = accuracyBin.color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(position.x, position.y, fillRadius, Math.PI / 2, Math.PI * 1.5, false);
      ctx.closePath();
      ctx.fillStyle = recallBin.color;
      ctx.fill();

      if (fillRadius >= 1.5) {
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - fillRadius);
        ctx.lineTo(position.x, position.y + fillRadius);
        ctx.strokeStyle = "rgba(7, 18, 13, 0.9)";
        ctx.lineWidth = Math.max(1, Math.min(1.5, fillRadius * 0.2));
        ctx.stroke();
      }

      // Importance border. This is the only ring on the dot; there is no
      // accuracy arc or type pip.
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = priorityColor;
      ctx.lineWidth = borderWidth;
      ctx.stroke();

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius + 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      ctx.restore();
    };

    const highlighted = new Set(
      [state.hoveredNodeId, state.selectedNodeId].filter(Boolean)
    );
    positions.forEach((dot, id) => {
      if (!highlighted.has(id)) drawDot(id, dot);
    });
    positions.forEach((dot, id) => {
      if (highlighted.has(id)) drawDot(id, dot);
    });

    if (state.hoveredNodeId && positions.has(state.hoveredNodeId)) {
      drawDotTooltip(positions.get(state.hoveredNodeId), width, height, layout.top);
    }

    updateStats();
    updateEmptyState();
  }

  function updateEmptyState() {
    if (!emptyState) return;

    if (state.viewMode === "grid" || state.viewMode === "dots") {
      emptyState.style.display = "none";
      return;
    }

    const visibleItems = getAllItems().filter(
      (item) => (state.nodeVisibility.get(item.id) ?? 0) > 0.05
    );

    if (visibleItems.length > 0) {
      emptyState.style.display = "none";
      return;
    }

    emptyState.style.display = "flex";
    const copy = emptyState.querySelector("p");
    if (copy) {
      copy.textContent = state.focusSubject
        ? `No nodes in ${state.focusSubject} yet. Add a source, quote, or analysis to grow this subject.`
        : "No nodes yet. Add sources, quotes, and analyses to see your knowledge network.";
    }
  }

  function setViewMode(nextMode) {
    const mode = nextMode === "dots" ? "dots" : nextMode === "grid" ? "grid" : "graph";
    const changed = state.viewMode !== mode;
    state.viewMode = mode;

    if (viewToggle) {
      viewToggle.querySelectorAll(".view-toggle-btn").forEach((button) => {
        const isActive = button.dataset.view === mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    if (gridView) gridView.hidden = mode !== "grid";
    if (dotsLegend) dotsLegend.hidden = mode !== "dots";
    if (canvas) {
      canvas.style.opacity = mode === "grid" ? "0" : "1";
      canvas.style.pointerEvents = mode === "grid" ? "none" : "";
    }

    state.hoveredNodeId = null;
    state.draggingNodeId = null;
    state.isPanning = false;
    state.hasDragged = false;
    if (mode !== "dots") state.dotAnim = null;

    if (mode === "grid" || mode === "dots") {
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
      if (changed) buildDotsLayout({ animate: true, fromGraph: true });
    } else if (changed) {
      state.userInteracted = false;
      updateEmptyState();
    }
  }

  function renderSidebar(selectedItem) {
    if (!selectedItem) return;

    sidebarTitle.textContent = getNodeDisplayTitle(selectedItem);
    sidebarType.innerHTML = `<span>${getNodeTypeIcon(selectedItem.type)}</span> ${selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1)}`;

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

    // Render Connections
    const connectionsItems = document.getElementById("connectionsItems");
    const connectionCount = document.getElementById("connectionCount");
    const graphNode = state.graph.nodes.get(selectedItem.id);

    if (connectionsItems && connectionCount && graphNode) {
      const neighbors = Array.from(graphNode.connections);
      connectionCount.textContent = neighbors.length;
      connectionsItems.innerHTML = "";

      neighbors.forEach(neighborId => {
        const neighbor = findItemById(neighborId);
        if (!neighbor) return;

        const itemEl = document.createElement("div");
        itemEl.className = "connection-item";
        itemEl.innerHTML = `
          <div class="connection-info">
            <span>${getNodeTypeIcon(neighbor.type)}</span>
            <span class="connection-name">${getNodeDisplayTitle(neighbor)}</span>
          </div>
          <button class="btn-break" title="Break Connection" data-target-id="${neighborId}">&times;</button>
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

    const tags = item.meta?.tags || [];
    tagsContainer.innerHTML = `
      <div class="tags-header">Tags</div>
      <div class="tags-list">
        ${tags.map(tag => `
          <div class="tag-pill">
            <span>${tag}</span>
            <button class="tag-remove" data-tag="${tag}">&times;</button>
          </div>
        `).join("")}
        <button id="addTagBtn" class="tag-add-pill">+ Add Tag</button>
      </div>
    `;

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
    const items = getAllItems();
    const subjectNodes = items.filter(n => n.type === "subject");
    const layers = items.filter(n => n.type?.startsWith("layer"));
    const sources = items.filter(n => n.type === "source");
    const quotes = items.filter(n => n.type === "quote");
    const analyses = items.filter(n => n.type === "analysis");
    const cues = items.filter(n => n.type === "cue");
    const pastpapers = items.filter(n => n.type === "pastpaper");

    items.forEach(item => {
      graph.nodes.set(item.id, {
        id: item.id,
        type: item.type,
        data: item,
        connections: new Set(),
        weight: 1
      });
    });

    const addEdge = (from, to, type, strength = 1) => {
      if (!from || !to || from === to) return;
      if (!graph.nodes.has(from) || !graph.nodes.has(to)) return;
      const key = [from, to].sort().join("-");
      if (graph.edges.some(e => [e.from, e.to].sort().join("-") === key)) return;
      graph.edges.push({ from, to, type, strength });
      graph.nodes.get(from)?.connections.add(to);
      graph.nodes.get(to)?.connections.add(from);
    };

    layers.forEach((layer) => {
      const subjectNode = subjectNodes.find((s) => s.subject === layer.subject);
      if (!subjectNode) return;
      const parentId = layer?.meta?.parentLayerId || subjectNode.id;
      addEdge(parentId, layer.id, "layer-chain", 3.2);
    });

    sources.forEach(source => {
      if (!source.subject) return;
      const subjectNode = subjectNodes.find(s => s.subject === source.subject);
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
      const subjectNode = subjectNodes.find(s => s.subject === paper.subject);
      if (!subjectNode) return;
      addEdge(subjectNode.id, paper.id, "subject-pastpaper", 2.6);
    });

    quotes.forEach(quote => {
      if (quote.link?.sourceId) {
        addEdge(quote.link.sourceId, quote.id, "source-quote", 2.5);
      }
      // Only connect quote to subject directly if it has NO source (orphan prevention for flashcard-builder quotes)
      if (quote.subject && !quote.link?.sourceId) {
        const subjectNode = subjectNodes.find(s => s.subject === quote.subject);
        if (subjectNode) addEdge(subjectNode.id, quote.id, "subject-quote", 2.3);
      }
    });

    analyses.forEach(analysis => {
      // Check if analysis has any quote parent (not orphaned)
      const hasQuoteParent =
        (analysis.quoteRefs || []).some(ref => ref.quoteId) ||
        (analysis.meta?.manualLinks || []).some(id => quotes.some(q => q.id === id)) ||
        quotes.some(q => q.meta?.analysisNodeIds?.includes(analysis.id));

      // Only connect orphaned analyses (no quote parents) to subject node
      if (!hasQuoteParent && analysis.subject) {
        const subjectNode = subjectNodes.find(s => s.subject === analysis.subject);
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
        const tag = (state.tags || []).find(t => t.title.toLowerCase() === tagName.toLowerCase());
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
    profileStart("physics");
    const forces = new Map();
    const positions = state.nodePositions;
    const graph = state.graph;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

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
      const childrenBonus = childrenCount <= 2 ? 0 : (childrenCount * 25);

      // Base length + extra for deep hierarchies + bonus for many children
      const idealLength = 90 + (hierarchyDepth * 15) + childrenBonus;

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

    profileEnd("physics");
    return forces;
  }

  function updatePositionsWithPhysics(forces) {
    const positions = state.nodePositions;
    const velocities = state.velocities;

    // Custom damping and velocity limits for our dynamic fractal engine
    // Lower damping (more friction) to prevent bouncing, allowing a soft settling
    const damping = 0.78;
    const maxVelocity = 20;
    const width = canvas?.width || canvas?.parentElement?.clientWidth || 800;
    const height = canvas?.height || canvas?.parentElement?.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    state.graph.nodes.forEach((node, id) => {
      const pos = positions.get(id);
      if (!pos) return;

      if (!isNodeInScope(id)) {
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      // The focused subject is the visual anchor: it glides to the exact
      // centre and then stays there while its cluster settles around it.
      if (id === state.focusSubjectId) {
        pos.x += (centerX - pos.x) * 0.14;
        pos.y += (centerY - pos.y) * 0.14;
        if (Math.abs(centerX - pos.x) < 0.1) pos.x = centerX;
        if (Math.abs(centerY - pos.y) < 0.1) pos.y = centerY;
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      if (state.lockedNodes.has(id)) {
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

      velocities.set(id, vel);
    });
  }

  function getHierarchyLevel(node) {
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
    return 8;
  }

  function layoutRadial(containerWidth, containerHeight) {
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
    layoutRadial(containerWidth, containerHeight);
    lastCanvasSize = { width: containerWidth, height: containerHeight };
  }

  function getAllItems() {
    return [
      ...(state.nodes || []),
      ...(state.quotes || []),
      ...(state.cues || []),
      ...(state.tags || []),
      ...(state.layerNodes || [])
    ];
  }

  function findItemById(id) {
    return getAllItems().find(item => item.id === id);
  }

  function transformPoint(x, y) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
      x: centerX + (x - centerX) * state.zoom + state.panOffset.x,
      y: centerY + (y - centerY) * state.zoom + state.panOffset.y
    };
  }

  function updateNodeVisibility() {
    state.graph.nodes.forEach((node, id) => {
      const target = isNodeInScope(id) ? 1 : 0;
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
      state.nodePositions.set(id, {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius
      });
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
      buildDotsLayout({ animate: true });
    }
  }

  let frameCount = 0;
  let rafId = 0;
  function tick() {
    if (state.viewMode === "graph") {
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
      render();
      logPerf();
    } else if (state.viewMode === "dots") {
      renderDots();
    }
    rafId = requestAnimationFrame(tick);
  }

  function fitCameraToGraph() {
    if (state.graph.nodes.size === 0 || state.userInteracted || !canvas) return;

    const scopedPositions = [];
    state.nodePositions.forEach((pos, id) => {
      if (state.scopeNodeIds.has(id)) scopedPositions.push(pos);
    });
    if (scopedPositions.length === 0) return;

    const viewportWidth = canvas.width || canvas.parentElement?.clientWidth || 800;
    const viewportHeight = canvas.height || canvas.parentElement?.clientHeight || 600;
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

  function syncCanvasSize() {
    const container = canvas.parentElement;
    const width = Math.max(1, Math.round(container.clientWidth));
    const height = Math.max(1, Math.round(container.clientHeight));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height };
  }

  function render() {
    if (!ctx || !canvas) return;

    const { width, height } = syncCanvasSize();

    ctx.clearRect(0, 0, width, height);

    const items = getAllItems();
    const edges = state.graph.edges;
    const now = performance.now();
    const focusId = state.focusSubjectId;

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

        ctx.beginPath();
        ctx.moveTo(fromTrans.x, fromTrans.y);
        ctx.lineTo(toTrans.x, toTrans.y);
        ctx.strokeStyle = isActive
          ? `rgba(44, 255, 179, ${0.9 * edgeVisibility})`
          : `rgba(44, 255, 179, ${0.35 * edgeVisibility})`;
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

      ctx.globalAlpha = visibility;

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
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      // Hierarchical label visibility based on zoom level. The focused
      // subject is always labelled, even when the cluster is zoomed out.
      // In a dense global map, only the structural labels stay visible until
      // the user zooms in, otherwise 100+ quotes turn the overview into noise.
      const isDenseGlobal = !state.focusSubject && state.graph.nodes.size > 70;
      const structuralLabel = item.type === "subject" || item.type === "tag" || item.type?.startsWith("layer");
      if (isDenseGlobal && !structuralLabel && state.zoom < 1.35) {
        ctx.globalAlpha = 1;
        return;
      }
      const densityBoost = isDenseGlobal ? 0.3 : 0;
      const threshold = (config.labelZoomThresholds[item.type] || 1.0) + densityBoost;
      if (state.zoom < threshold && !isFocusedSubject) {
        ctx.globalAlpha = 1;
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
      ctx.globalAlpha = 1;
    });

    updateStats();
    updateEmptyState();
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function inverseTransform(x, y) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
      x: (x - centerX - state.panOffset.x) / state.zoom + centerX,
      y: (y - centerY - state.panOffset.y) / state.zoom + centerY
    };
  }

  function findNodeAtPosition(x, y) {
    if (state.viewMode === "dots") {
      const dot = findDotAtPosition(x, y);
      return dot ? { id: dot.card.id } : null;
    }

    const items = getAllItems();
    const clickRadius = 20 / state.zoom;

    const inv = inverseTransform(x, y);

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

  function openNodeSidebar(nodeId) {
    state.selectedNodeId = nodeId;
    state.sidebarView = "content";

    const selectedItem = findItemById(nodeId);
    if (!selectedItem) return;

    renderSidebar(selectedItem);
    syncGridSelection();

    if (nodeSidebar) {
      nodeSidebar.classList.add("open");
      nodeSidebar.setAttribute("aria-hidden", "false");
    }
    nodeSidebarBackdrop?.classList.add("visible");
  }

  function closeSidebar() {
    if (nodeSidebar) {
      nodeSidebar.classList.remove("open");
      nodeSidebar.setAttribute("aria-hidden", "true");
    }
    nodeSidebarBackdrop?.classList.remove("visible");
    state.selectedNodeId = null;
    state.sidebarView = "content";
    syncGridSelection();
  }

  async function handleDeleteNode() {
    if (!state.selectedNodeId) return;

    const selectedItem = findItemById(state.selectedNodeId);
    if (!selectedItem) return;

    const message = selectedItem.type?.startsWith("layer")
      ? "Delete this layer and everything inside it? (All sources + their quotes + any now-empty analyses will be removed.)"
      : `Delete this ${selectedItem.type}? This action cannot be undone.`;
    const confirmed = await dialog.confirm(message, "Delete", "danger");
    if (!confirmed) return;

    try {
      if (selectedItem.type?.startsWith("layer")) {
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
      console.error("Failed to delete node:", error);
      dialog.alert("Failed to delete node: " + error.message);
    }
  }

  function updateStats() {
    const totalNodes = document.getElementById("totalNodes");
    const totalSubjects = document.getElementById("totalSubjects");
    const totalSources = document.getElementById("totalSources");
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalCues = document.getElementById("totalCues");
    const totalTags = document.getElementById("totalTags");
    const totalConnections = document.getElementById("totalConnections");

    const nodeItems = (state.nodes || []).filter((item) => isNodeInScope(item.id));
    const quoteItems = (state.quotes || []).filter((item) => isNodeInScope(item.id));
    const cueItems = (state.cues || []).filter((item) => isNodeInScope(item.id));
    const tagItems = (state.tags || []).filter((item) => isNodeInScope(item.id));
    const scopedCards = (state.cards || []).filter(isCardInScope);
    const dotsMode = state.viewMode === "dots";

    if (totalNodes) {
      totalNodes.textContent = dotsMode
        ? scopedCards.length
        : nodeItems.length + quoteItems.length + cueItems.length + tagItems.length;
    }
    if (totalSubjects) {
      totalSubjects.textContent = dotsMode
        ? new Set(scopedCards.map((card) => String(card.deck || "").trim()).filter(Boolean)).size
        : nodeItems.filter(i => i.type === "subject").length;
    }
    if (totalSources) totalSources.textContent = nodeItems.filter(i => i.type === "source").length;
    if (totalQuotes) totalQuotes.textContent = quoteItems.length;
    if (totalAnalyses) totalAnalyses.textContent = nodeItems.filter(i => i.type === "analysis").length;
    if (totalCues) {
      const cueCount = cueItems.length;
      totalCues.textContent = cueCount;
      totalCues.parentElement.style.display = cueCount > 0 ? "flex" : "none";
    }
    if (totalTags) {
      const tagCount = tagItems.length;
      totalTags.textContent = tagCount;
      totalTags.parentElement.style.display = tagCount > 0 ? "flex" : "none";
    }

    const connections = state.graph.edges.filter((edge) =>
      isNodeInScope(edge.from) && isNodeInScope(edge.to)
    );
    if (totalConnections) totalConnections.textContent = connections.length;
  }

  async function refreshData() {
    const cardPromise = typeof getAllCards === "function" ? getAllCards() : Promise.resolve([]);
    const [nodes, quotes, cues, tags, cards] = await Promise.all([
      getAllNodes(),
      getAllQuotes(),
      getAllCues(),
      getAllTags(),
      cardPromise
    ]);
    state.nodes = nodes;
    state.quotes = quotes;
    state.cues = cues;
    state.tags = tags;
    state.cards = cards || [];
    state.layerNodes = computeLayerNodesFromSources(nodes);

    const hadFocus = Boolean(state.focusSubject);
    state.focusSubject = resolveFocusSubject(state.focusSubject);

    buildGraph();

    // A focused subject that was deleted (or renamed away) falls back to the
    // global map rather than leaving an empty canvas.
    if (hadFocus && state.focusSubject && state.scopeNodeIds.size === 0) {
      state.focusSubject = null;
      recomputeScope();
    }

    const currentIds = new Set(state.graph.nodes.keys());
    for (const id of state.nodePositions.keys()) {
      if (!currentIds.has(id)) {
        state.nodePositions.delete(id);
        state.velocities.delete(id);
      }
    }

    const layoutWidth = canvas?.parentElement?.clientWidth || 800;
    const layoutHeight = canvas?.parentElement?.clientHeight || 600;
    layoutRadial(layoutWidth, layoutHeight);
    lastCanvasSize = { width: layoutWidth, height: layoutHeight };

    if (state.viewMode === "grid") {
      renderGrid();
    } else if (state.viewMode === "dots") {
      buildDotsLayout({ animate: true });
    }
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

  async function linkNodes(id1, id2) {
    if (id1 === id2) return;

    const item1 = findItemById(id1);
    const item2 = findItemById(id2);
    if (!item1 || !item2) return;

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
    if (!item1 || !item2) return;

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
    if (viewToggle) {
      viewToggle.querySelectorAll(".view-toggle-btn").forEach((button) => {
        button.addEventListener("click", () => setViewMode(button.dataset.view));
      });
    }

    if (gridContainer) {
      gridContainer.addEventListener("click", (e) => {
        if (performance.now() < ignoreCanvasClicksUntil) return;
        const target = e.target instanceof Element ? e.target : null;
        const card = target?.closest(".mindmap-grid-card");
        if (!card?.dataset?.nodeId) return;
        openNodeSidebar(card.dataset.nodeId);
        if (window.__neuronetCanvas?.triggerRadialPulse) {
          window.__neuronetCanvas.triggerRadialPulse(e.clientX, e.clientY, 1.0);
        }
      });
    }

    if (canvas) {
      canvas.addEventListener("click", (e) => {
        if (performance.now() < ignoreCanvasClicksUntil) return;
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

      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const pos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        const node = findNodeAtPosition(pos.x, pos.y);

        if (state.viewMode === "dots") {
          state.hoveredNodeId = node ? node.id : null;
          canvas.style.cursor = node ? "pointer" : "default";
          return;
        }

        if (state.isPanning) {
          state.userInteracted = true;
          state.hasDragged = true;
          state.panOffset.x += e.movementX;
          state.panOffset.y += e.movementY;
        } else if (state.draggingNodeId) {
          state.userInteracted = true;
          state.hasDragged = true;
          const centerX = canvas.width / 2;
          const centerY = canvas.height / 2;
          const nodePos = state.nodePositions.get(state.draggingNodeId);
          if (nodePos) {
            const rawX = (pos.x - centerX - state.panOffset.x) / state.zoom + centerX;
            const rawY = (pos.y - centerY - state.panOffset.y) / state.zoom + centerY;
            nodePos.x = rawX;
            nodePos.y = rawY;
          }
        } else {
          state.hoveredNodeId = node ? node.id : null;
          canvas.style.cursor = node ? "pointer" : state.isPanning ? "grabbing" : "default";
        }
      });

      canvas.addEventListener("mousedown", (e) => {
        state.hasDragged = false;
        if (state.viewMode === "dots") return;
        if (e.button === 1) {
          state.isPanning = true;
          canvas.style.cursor = "grabbing";
          e.preventDefault();
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const pos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        const node = findNodeAtPosition(pos.x, pos.y);
        if (node) {
          state.userInteracted = true;
          state.draggingNodeId = node.id;
          state.lockedNodes.add(node.id);
          const nodePos = state.nodePositions.get(node.id);
          if (nodePos) {
            state.dragOffset = {
              x: pos.x - nodePos.x,
              y: pos.y - nodePos.y
            };
          }
          e.preventDefault();
        } else {
          // Pan with left-click on empty space
          state.isPanning = true;
          state.panStartPos = { x: e.clientX, y: e.clientY };
          canvas.style.cursor = "grabbing";
          e.preventDefault();
        }
      });

      canvas.addEventListener("mouseup", (e) => {
        const dragged = state.draggingNodeId;
        state.draggingNodeId = null;
        if (state.isPanning) {
          state.isPanning = false;
          // Only reset cursor if we're not hovering over a node
          const rect = canvas.getBoundingClientRect();
          const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const node = findNodeAtPosition(pos.x, pos.y);
          canvas.style.cursor = node ? "pointer" : "default";
        }
        // Keep locked for 2 seconds after release
        if (dragged) {
          setTimeout(() => state.lockedNodes.delete(dragged), 2000);
        }
      });

      canvas.addEventListener("mouseleave", () => {
        state.draggingNodeId = null;
        state.isPanning = false;
        state.hoveredNodeId = null;
      });

      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (state.viewMode === "dots") return;
        state.userInteracted = true;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(config.maxZoom, Math.max(config.minZoom, state.zoom * zoomFactor));

        const worldX = (mouseX - canvas.width / 2 - state.panOffset.x) / state.zoom + canvas.width / 2;
        const worldY = (mouseY - canvas.height / 2 - state.panOffset.y) / state.zoom + canvas.height / 2;

        state.panOffset.x = mouseX - canvas.width / 2 - (worldX - canvas.width / 2) * newZoom;
        state.panOffset.y = mouseY - canvas.height / 2 - (worldY - canvas.height / 2) * newZoom;
        state.zoom = newZoom;
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
    const newNodeDropdown = document.getElementById("newNodeDropdown");
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
    const connectNodesBtn = document.getElementById("connectNodesBtn");
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

        if (node) {
          if (!state.connectingSourceId) {
            state.connectingSourceId = node.id;
            if (connectingOverlay) {
              connectingOverlay.textContent = `Connecting from: ${getNodeDisplayTitle(node)}... Select target.`;
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
    refreshData();
    // Trigger reactive sweep on data change
    if (window.__neuronetCanvas) {
      window.__neuronetCanvas.triggerVerticalWave(0.8);
    }
  }

  function handleSidebarEscape(event) {
    if (event.key === "Escape") closeSidebar();
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
      buildDotsLayout({ animate: false });
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

  await refreshData();

  const container = canvas?.parentElement;
  if (container) {
    initializePositions(container.clientWidth, container.clientHeight);
  }

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

  // Suppress the opening tap's delayed synthetic click on the canvas.
  ignoreCanvasClicksUntil = performance.now() + 450;

  setupEventListeners();
  tick();

  const setSubjectHandler = (subject) => setFocusSubject(subject);
  window.__neuronetMindmapSetSubject = setSubjectHandler;

  window.__neuronetMindmapCleanup = () => {
    state.simulationRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleSidebarEscape);
    window.removeEventListener("resize", handleResize);
    headerResizeObserver?.disconnect();
    headerResizeObserver = null;
    if (window.__neuronetMindmapSetSubject === setSubjectHandler) {
      window.__neuronetMindmapSetSubject = null;
    }
  };
}
