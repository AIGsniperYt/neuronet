export async function initMindmapTool(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    addNode,
    addQuote,
    deleteNode,
    deleteQuote,
    removeNodeEverywhere,
    removeQuoteEverywhere,
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
    sidebarView: "content",
    layerNodes: [],
    userInteracted: false,
    hasDragged: false
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
  const emptyState = document.getElementById("emptyState");
  const nodeSidebar = document.getElementById("nodeSidebar");
  const sidebarTitle = document.getElementById("sidebarTitle");
  const sidebarType = document.getElementById("sidebarType");
  const sidebarContentLabel = document.getElementById("sidebarContentLabel");
  const fullContent = document.getElementById("fullContent");
  const metaContent = document.getElementById("metaContent");
  const deleteNodeBtn = document.getElementById("deleteNodeBtn");
  const editNodeBtn = document.getElementById("editNodeBtn");
  const sidebarClose = document.getElementById("sidebarClose");
  const toggleMetadataBtn = document.getElementById("toggleMetadataBtn");

  const config = {
    nodeRadius: 8,
    nodeHoverRadius: 12,
    labelOffset: 18,
    minZoom: 0.25,
    maxZoom: 3,
    colors: {
      subject: "#ff6b6b",
      "layer 1": "#b388ff",
      "layer 2": "#9966ff",
      "layer 3": "#7e57c2",
      source: "#4da6ff",
      quote: "#ff9b39",
      analysis: "#2cffb3"
    }
  };

  function makeLayerId(subject, l1 = "", l2 = "", l3 = "") {
    return `layer|${String(subject || "").trim()}|${String(l1 || "").trim()}|${String(l2 || "").trim()}|${String(l3 || "").trim()}`;
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
      return node.title || node.analysis?.substring(0, 40) + (node.analysis?.length > 40 ? "..." : "") || "Untitled Analysis";
    }
    if (node.type === "source") {
      return node.title || node.subject || "Untitled Source";
    }
    if (node.type === "subject") {
      return node.title || node.subject || "Untitled Subject";
    }
    return node.subject || node.title || "Unknown";
  }

  function getNodePreview(node, maxLength = 150) {
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type?.startsWith("layer")) return (node?.meta?.layerPath || []).join(" > ") || "";
    if (node.type === "source") return node.content?.substring(0, maxLength) || node.contentText?.substring(0, maxLength) || "";
    return "";
  }

  function getNodeFullContent(node) {
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type?.startsWith("layer")) return (node?.meta?.layerPath || []).join(" > ") || "";
    if (node.type === "source") return node.content || node.contentText || "";
    return "";
  }

  function getNodeType(node) {
    return node.type || node.itemType || "unknown";
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
    const memoryKeys = ["S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount", "expectedTime", "avgTime", "timeVariance", "consistency", "confidence", "easeFactor", "honestyFlag", "clusterId"];
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

  function renderSidebar(selectedItem) {
    if (!selectedItem) return;

    sidebarTitle.textContent = getNodeDisplayTitle(selectedItem);
    sidebarType.innerHTML = `<span>${getNodeTypeIcon(selectedItem.type)}</span> ${selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1)}`;

    const isMeta = state.sidebarView === "metadata";
    if (sidebarContentLabel) sidebarContentLabel.textContent = isMeta ? "Metadata" : "Content";
    if (toggleMetadataBtn) toggleMetadataBtn.textContent = isMeta ? "Content" : "Metadata";

    if (fullContent) fullContent.style.display = isMeta ? "none" : "block";
    if (metaContent) metaContent.style.display = isMeta ? "block" : "none";

    if (fullContent) fullContent.textContent = getNodeFullContent(selectedItem);
    if (metaContent) metaContent.textContent = formatMetadataHumanReadable(selectedItem);
  }

  function buildGraph() {
    const graph = { nodes: new Map(), edges: [] };
    const items = getAllItems();
    const subjectNodes = items.filter(n => n.type === "subject");
    const layers = items.filter(n => n.type?.startsWith("layer"));
    const sources = items.filter(n => n.type === "source");
    const quotes = items.filter(n => n.type === "quote");
    const analyses = items.filter(n => n.type === "analysis");

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

    quotes.forEach(quote => {
      if (quote.link?.sourceId) {
        addEdge(quote.link.sourceId, quote.id, "source-quote", 2.5);
      }
    });

    analyses.forEach(analysis => {
      (analysis.quoteRefs || []).forEach(ref => {
        if (ref.quoteId) {
          addEdge(ref.quoteId, analysis.id, "quote-analysis", 2);
        }
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

    // 1. Global Repulsion & Angular Placement
    const nodesArr = Array.from(graph.nodes.entries());
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
        if (parentsA && parentsB) {
          for (const p of parentsA) {
            if (parentsB.has(p)) {
              isSibling = true;
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
          // Attract slightly to siblings around a resting distance
          const siblingIdeal = 90 + Math.max(weightA, weightB) * 10;
          const siblingSpring = 0.008; // Softer sibling attraction
          const attractForce = (dist - siblingIdeal) * siblingSpring;
          // Subtly repel, but mostly allow spring to find equilibrium
          forceMag = (repStrength * 0.3) / distSq - attractForce;
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
      const pos = positions.get(id);
      if (!pos) return;

      const dx = centerX - pos.x;
      const dy = centerY - pos.y;
      
      // Equal, extremely gentle pull for all nodes.
      // This prevents the "bent/pinned subject" issue because the subject is free to move relative to its children!
      forces.get(id).x += dx * 0.00005;
      forces.get(id).y += dy * 0.00005;
    });

    return forces;
  }

  function updatePositionsWithPhysics(forces) {
    const positions = state.nodePositions;
    const velocities = state.velocities;
    
    // Custom damping and velocity limits for our dynamic fractal engine
    // Lower damping (more friction) to prevent bouncing, allowing a soft settling
    const damping = 0.78; 
    const maxVelocity = 20;

    state.graph.nodes.forEach((node, id) => {
      const pos = positions.get(id);
      if (!pos) return;

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
    return 7;
  }

  function layoutRadial(containerWidth, containerHeight) {
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    const graph = state.graph;

    // Exploding Cluster Layout: Start all nodes in a tiny cluster near the center.
    // The massive global repulsion will naturally explode them outward instantly,
    // and springs + grandparent-repulsion will smoothly unspool them into a perfect tree!
    graph.nodes.forEach((node, id) => {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 30; // 30px cluster
      state.nodePositions.set(id, { 
        x: centerX + Math.cos(angle) * r, 
        y: centerY + Math.sin(angle) * r 
      });
      state.velocities.set(id, { x: 0, y: 0 });
    });
  }

  function initializePositions(containerWidth, containerHeight) {
    buildGraph();
    layoutRadial(containerWidth, containerHeight);
  }

  function getAllItems() {
    return [...state.nodes, ...state.quotes, ...(state.layerNodes || [])];
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

  let frameCount = 0;
  function tick() {
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
    fitCameraToGraph();
    render();
    requestAnimationFrame(tick);
  }

  function fitCameraToGraph() {
    if (state.graph.nodes.size === 0 || state.userInteracted || !canvas) return;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    state.nodePositions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    });

    if (minX === Infinity) return;

    // Add padding around the graph
    const padding = 150;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const contentWidth = Math.max(100, maxX - minX);
    const contentHeight = Math.max(100, maxY - minY);
    
    const scaleX = canvas.width / contentWidth;
    const scaleY = canvas.height / contentHeight;
    const targetZoom = Math.min(config.maxZoom, Math.max(config.minZoom, Math.min(scaleX, scaleY)));

    const centerOfMassX = (minX + maxX) / 2;
    const centerOfMassY = (minY + maxY) / 2;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    const targetPanX = -(centerOfMassX - centerX) * targetZoom;
    const targetPanY = -(centerOfMassY - centerY) * targetZoom;

    // Smooth camera interpolation
    state.zoom += (targetZoom - state.zoom) * 0.05;
    state.panOffset.x += (targetPanX - state.panOffset.x) * 0.05;
    state.panOffset.y += (targetPanY - state.panOffset.y) * 0.05;
  }

  function render() {
    if (!ctx || !canvas) return;

    const container = canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    const items = getAllItems();
    const edges = state.graph.edges;

    edges.forEach(edge => {
      const fromPos = state.nodePositions.get(edge.from);
      const toPos = state.nodePositions.get(edge.to);

      if (fromPos && toPos) {
        const fromTrans = transformPoint(fromPos.x, fromPos.y);
        const toTrans = transformPoint(toPos.x, toPos.y);
        const isActive = state.selectedNodeId === edge.from || state.selectedNodeId === edge.to;

        ctx.beginPath();
        ctx.moveTo(fromTrans.x, fromTrans.y);
        ctx.lineTo(toTrans.x, toTrans.y);
        ctx.strokeStyle = isActive ? "rgba(44, 255, 179, 0.9)" : "rgba(44, 255, 179, 0.35)";
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.stroke();
      }
    });

    items.forEach(item => {
      const pos = state.nodePositions.get(item.id);
      if (!pos) return;

      const posTrans = transformPoint(pos.x, pos.y);
      const isSelected = state.selectedNodeId === item.id;
      const isHovered = state.hoveredNodeId === item.id;
      const radius = (isHovered || isSelected ? config.nodeHoverRadius : config.nodeRadius) * state.zoom;
      const color = getNodeColor(item.type);

      ctx.beginPath();
      ctx.arc(posTrans.x, posTrans.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10, 30, 22, 0.9)";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      ctx.font = `${12 * state.zoom}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(230, 255, 245, 0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const title = getNodeDisplayTitle(item);
      const maxChars = Math.max(8, Math.floor(18 / state.zoom));
      const displayTitle = title.length > maxChars ? title.substring(0, maxChars - 2) + "..." : title;
      ctx.fillText(displayTitle, posTrans.x, posTrans.y + config.labelOffset * state.zoom);
    });

    updateStats();

    if (items.length > 0) {
      if (emptyState) emptyState.style.display = "none";
    } else {
      if (emptyState) emptyState.style.display = "flex";
    }
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
    const items = getAllItems();
    const clickRadius = 20 / state.zoom;
    
    const inv = inverseTransform(x, y);
    
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
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
    
    if (nodeSidebar) nodeSidebar.classList.add("open");
  }

  function closeSidebar() {
    if (nodeSidebar) nodeSidebar.classList.remove("open");
    state.selectedNodeId = null;
    state.sidebarView = "content";
  }

  async function handleDeleteNode() {
    if (!state.selectedNodeId) return;
    
    const selectedItem = findItemById(state.selectedNodeId);
    if (!selectedItem) return;
    
    const message = selectedItem.type?.startsWith("layer")
      ? "Delete this layer and everything inside it? (All sources + their quotes + any now-empty analyses will be removed.)"
      : `Delete this ${selectedItem.type}? This action cannot be undone.`;
    const confirmed = window.confirm(message);
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
      } else {
        await removeNodeEverywhere(selectedItem.id);
      }
      
      closeSidebar();
      await refreshData();
    } catch (error) {
      console.error("Failed to delete node:", error);
      alert("Failed to delete node: " + error.message);
    }
  }

  function updateStats() {
    const totalNodes = document.getElementById("totalNodes");
    const totalSubjects = document.getElementById("totalSubjects");
    const totalSources = document.getElementById("totalSources");
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalConnections = document.getElementById("totalConnections");

    const nodeItems = state.nodes || [];
    const quoteItems = state.quotes || [];

    if (totalNodes) totalNodes.textContent = nodeItems.length + quoteItems.length;
    if (totalSubjects) totalSubjects.textContent = nodeItems.filter(i => i.type === "subject").length;
    if (totalSources) totalSources.textContent = nodeItems.filter(i => i.type === "source").length;
    if (totalQuotes) totalQuotes.textContent = quoteItems.length;
    if (totalAnalyses) totalAnalyses.textContent = nodeItems.filter(i => i.type === "analysis").length;

    buildGraph();
    const connections = state.graph.edges;
    if (totalConnections) totalConnections.textContent = connections.length;
  }

  async function refreshData() {
    const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    state.nodes = nodes;
    state.quotes = quotes;
    state.layerNodes = computeLayerNodesFromSources(nodes);

    buildGraph();

    const currentIds = new Set(state.graph.nodes.keys());
    for (const id of state.nodePositions.keys()) {
      if (!currentIds.has(id)) {
        state.nodePositions.delete(id);
        state.velocities.delete(id);
      }
    }

    layoutRadial(canvas?.parentElement?.clientWidth || 800, canvas?.parentElement?.clientHeight || 600);
  }

  function setupEventListeners() {
    if (canvas) {
      canvas.addEventListener("click", (e) => {
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
        }
      });

      canvas.addEventListener("mouseup", () => {
        const dragged = state.draggingNodeId;
        state.draggingNodeId = null;
        state.isPanning = false;
        // Keep locked for 2 seconds after release
        if (dragged) {
          setTimeout(() => state.lockedNodes.delete(dragged), 2000);
        }
        canvas.style.cursor = "default";
      });

      canvas.addEventListener("mouseleave", () => {
        state.draggingNodeId = null;
        state.isPanning = false;
        state.hoveredNodeId = null;
      });

      canvas.addEventListener("wheel", (e) => {
        state.userInteracted = true;
        e.preventDefault();
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

    if (sidebarClose) {
      sidebarClose.addEventListener("click", closeSidebar);
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
            window.dispatchEvent(new CustomEvent("neuronet-open-tool", {
              detail: (() => {
                if (selectedItem.type === "subject") {
                  const subject = String(selectedItem.subject || selectedItem.title || "").trim();
                  return subject ? { tool: "analysis", subject } : { tool: "analysis", nodeId: selectedItem.id };
                }
                if (selectedItem.type?.startsWith("layer")) {
                  const subject = String(selectedItem.subject || "").trim();
                  return subject ? { tool: "analysis", subject } : { tool: "analysis", nodeId: selectedItem.id };
                }
                return { tool: "analysis", nodeId: selectedItem.id };
              })()
            }));
          }
        }
      });
    }
  }

  function handleDBChange() {
    refreshData();
  }

  function handleResize() {
    const container = canvas?.parentElement;
    if (!container) return;
    
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
  
  setupEventListeners();
  tick();

  window.__neuronetMindmapCleanup = () => {
    state.simulationRunning = false;
    document.removeEventListener("db-change", handleDBChange);
    window.removeEventListener("resize", handleResize);
  };
}
