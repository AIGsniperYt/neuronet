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
    simulationRunning: true
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
    source: 80,
    quote: 180,
    analysis: 280
  };

  const canvas = document.getElementById("mindmapCanvas");
  const ctx = canvas?.getContext("2d");
  const blueprintArea = document.getElementById("blueprintArea");
  const emptyState = document.getElementById("emptyState");
  const nodeSidebar = document.getElementById("nodeSidebar");
  const sidebarTitle = document.getElementById("sidebarTitle");
  const sidebarType = document.getElementById("sidebarType");
  const fullContent = document.getElementById("fullContent");
  const deleteNodeBtn = document.getElementById("deleteNodeBtn");
  const editNodeBtn = document.getElementById("editNodeBtn");
  const sidebarClose = document.getElementById("sidebarClose");

  const config = {
    nodeRadius: 8,
    nodeHoverRadius: 12,
    labelOffset: 18,
    minZoom: 0.25,
    maxZoom: 3,
    colors: {
      subject: "#ff6b6b",
      source: "#4da6ff",
      quote: "#ff9b39",
      analysis: "#2cffb3"
    }
  };

  function getNodeTypeIcon(type) {
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
    if (node.type === "source") return node.content?.substring(0, maxLength) || node.contentText?.substring(0, maxLength) || "";
    return "";
  }

  function getNodeFullContent(node) {
    if (node.type === "quote") return node.quote || "";
    if (node.type === "analysis") return node.analysis || "";
    if (node.type === "source") return node.content || node.contentText || "";
    return "";
  }

  function getNodeType(node) {
    return node.type || node.itemType || "unknown";
  }

  function buildGraph() {
    const graph = { nodes: new Map(), edges: [] };
    const items = getAllItems();
    const subjectNodes = items.filter(n => n.type === "subject");
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

    sources.forEach(source => {
      if (source.subject) {
        const subjectNode = subjectNodes.find(s => s.subject === source.subject);
        if (subjectNode) {
          addEdge(subjectNode.id, source.id, "subject-source", 3);
        }
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
    const baseRadius = ringConfig[type] || 200;
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

    graph.nodes.forEach((node, id) => {
      forces.set(id, { x: 0, y: 0 });
    });

    graph.nodes.forEach((nodeA, idA) => {
      graph.nodes.forEach((nodeB, idB) => {
        if (idA === idB) return;
        const posA = positions.get(idA);
        const posB = positions.get(idB);
        if (!posA || !posB) return;

        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;

        if (dist > physicsConfig.repulsionRange) return;

        const repulsion = physicsConfig.repulsion / (dist * dist);
        const fx = (dx / dist) * repulsion;
        const fy = (dy / dist) * repulsion;

        forces.get(idA).x += fx;
        forces.get(idA).y += fy;
      });
    });

    graph.edges.forEach(edge => {
      const posFrom = positions.get(edge.from);
      const posTo = positions.get(edge.to);
      if (!posFrom || !posTo) return;

      const dx = posTo.x - posFrom.x;
      const dy = posTo.y - posFrom.y;

      const dist = Math.sqrt(dx*dx + dy*dy) + 0.01;
      const desired = 100;
      const spring = (dist - desired) * 0.001;

      forces.get(edge.from).x += (dx / dist) * spring;
      forces.get(edge.from).y += (dy / dist) * spring;
      forces.get(edge.to).x -= (dx / dist) * spring;
      forces.get(edge.to).y -= (dy / dist) * spring;
    });

    graph.nodes.forEach((node, id) => {
      const pos = positions.get(id);
      if (!pos) return;

      // Light centering preference for subject (not hard lock)
      if (node.type === "subject") {
        const dx = centerX - pos.x;
        const dy = centerY - pos.y;
        forces.get(id).x += dx * 0.005;
        forces.get(id).y += dy * 0.005;
        return;
      }

      // Inverse repulsion - pushes nodes apart to prevent collapsing
      graph.nodes.forEach((otherNode, otherId) => {
        if (id === otherId) return;
        const otherPos = positions.get(otherId);
        if (!otherPos) return;

        const dx = pos.x - otherPos.x;
        const dy = pos.y - otherPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;
        if (dist < 200) {
          const repulsion = 120 / (dist * dist);
          forces.get(id).x += (dx / dist) * repulsion;
          forces.get(id).y += (dy / dist) * repulsion;
        }
      });

      // Radial constraint - pushes nodes OUTWARD if too close, inward if too far
      const dx = pos.x - centerX;
      const dy = pos.y - centerY;
      const radialDist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const level = getHierarchyLevel(node);
      const targetRadius = 140 * level;
      
      // If node is inside its target ring, push outward. If outside, push back.
      if (radialDist < targetRadius) {
        const pushOut = (targetRadius - radialDist) * 0.015;
        forces.get(id).x += (dx / radialDist) * pushOut;
        forces.get(id).y += (dy / radialDist) * pushOut;
      } else {
        const pushIn = (radialDist - targetRadius) * 0.008;
        forces.get(id).x -= (dx / radialDist) * pushIn;
        forces.get(id).y -= (dy / radialDist) * pushIn;
      }
    });

    return forces;
  }

  function updatePositionsWithPhysics(forces) {
    const positions = state.nodePositions;
    const velocities = state.velocities;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    state.graph.nodes.forEach((node, id) => {
      const pos = positions.get(id);
      if (!pos) return;

      if (state.lockedNodes.has(id)) {
        velocities.set(id, { x: 0, y: 0 });
        return;
      }

      const vel = velocities.get(id) || { x: 0, y: 0 };
      const force = forces.get(id) || { x: 0, y: 0 };

      const confidence = node.data?.meta?.confidence ?? 0.7;
      const nodeDamping = physicsConfig.damping + (confidence * 0.05);

      vel.x = vel.x * nodeDamping + force.x;
      vel.y = vel.y * nodeDamping + force.y;

      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (speed > physicsConfig.maxVelocity) {
        vel.x = (vel.x / speed) * physicsConfig.maxVelocity;
        vel.y = (vel.y / speed) * physicsConfig.maxVelocity;
      }

      pos.x += vel.x;
      pos.y += vel.y;

      if (Math.abs(vel.x) < physicsConfig.minVelocity) vel.x = 0;
      if (Math.abs(vel.y) < physicsConfig.minVelocity) vel.y = 0;

      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);

      velocities.set(id, vel);
    });

    const spreadX = maxX - minX;
    const spreadY = maxY - minY;
    const maxSpread = physicsConfig.maxGlobalSpread;

    if (spreadX > maxSpread || spreadY > maxSpread) {
      const scale = maxSpread / Math.max(spreadX, spreadY);
      const centerOfMassX = (minX + maxX) / 2;
      const centerOfMassY = (minY + maxY) / 2;

      state.graph.nodes.forEach((node, id) => {
        const pos = positions.get(id);
        if (!pos) return;
        pos.x = centerOfMassX + (pos.x - centerOfMassX) * scale;
        pos.y = centerOfMassY + (pos.y - centerOfMassY) * scale;
      });
    }
  }

  function getHierarchyLevel(node) {
    if (node.type === "subject") return 0;
    if (node.type === "source") return 1;
    if (node.type === "quote") return 2;
    if (node.type === "analysis") return 3;
    return 4;
  }

  function layoutRadial(containerWidth, containerHeight) {
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    const graph = state.graph;

    const levels = new Map();
    graph.nodes.forEach((node, id) => {
      const level = getHierarchyLevel(node);
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push([id, node]);
    });

    const baseRadius = 140;
    levels.forEach((nodes, level) => {
      const radius = baseRadius * level;
      nodes.forEach(([id, node], i) => {
        const angle = (i / nodes.length) * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        state.nodePositions.set(id, { x, y });
        state.velocities.set(id, { x: 0, y: 0 });
      });
    });
  }

  function initializePositions(containerWidth, containerHeight) {
    buildGraph();
    layoutRadial(containerWidth, containerHeight);
  }

  function getAllItems() {
    return [...state.nodes, ...state.quotes];
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
    render();
    requestAnimationFrame(tick);
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
    
    const selectedItem = findItemById(nodeId);
    if (!selectedItem) return;
    
    sidebarTitle.textContent = getNodeDisplayTitle(selectedItem);
    sidebarType.innerHTML = `<span>${getNodeTypeIcon(selectedItem.type)}</span> ${selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1)}`;
    
    fullContent.textContent = getNodeFullContent(selectedItem);
    
    if (nodeSidebar) nodeSidebar.classList.add("open");
  }

  function closeSidebar() {
    if (nodeSidebar) nodeSidebar.classList.remove("open");
    state.selectedNodeId = null;
  }

  async function handleDeleteNode() {
    if (!state.selectedNodeId) return;
    
    const selectedItem = findItemById(state.selectedNodeId);
    if (!selectedItem) return;
    
    const confirmed = window.confirm(`Delete this ${selectedItem.type}? This action cannot be undone.`);
    if (!confirmed) return;
    
    try {
      if (selectedItem.type === "quote") {
        await removeQuoteEverywhere(selectedItem.id);
      } else {
        if (selectedItem.type === "analysis") {
          const allQuotes = state.quotes;
          for (const quote of allQuotes) {
            if (quote.meta?.analysisNodeIds?.includes(selectedItem.id)) {
              quote.meta.analysisNodeIds = quote.meta.analysisNodeIds.filter(id => id !== selectedItem.id);
              await addQuote(quote);
            }
          }
        }
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
    const items = getAllItems();
    const totalNodes = document.getElementById("totalNodes");
    const totalSubjects = document.getElementById("totalSubjects");
    const totalSources = document.getElementById("totalSources");
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalConnections = document.getElementById("totalConnections");

    if (totalNodes) totalNodes.textContent = items.length;
    if (totalSubjects) totalSubjects.textContent = items.filter(i => i.type === "subject").length;
    if (totalSources) totalSources.textContent = items.filter(i => i.type === "source").length;
    if (totalQuotes) totalQuotes.textContent = items.filter(i => i.type === "quote").length;
    if (totalAnalyses) totalAnalyses.textContent = items.filter(i => i.type === "analysis").length;

    buildGraph();
    const connections = state.graph.edges;
    if (totalConnections) totalConnections.textContent = connections.length;
  }

  async function refreshData() {
    const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    state.nodes = nodes;
    state.quotes = quotes;

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
          state.panOffset.x += e.movementX;
          state.panOffset.y += e.movementY;
        } else if (state.draggingNodeId) {
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
              detail: { tool: "analysis", nodeId: selectedItem.id }
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
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      state.nodePositions.forEach(pos => {
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y);
      });
      
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      
      if (contentWidth > width - 100 || contentHeight > height - 100) {
        const scaleX = (width - 100) / contentWidth;
        const scaleY = (height - 100) / contentHeight;
        const scale = Math.min(scaleX, scaleY, 1);
        
        const centerX = width / 2;
        const centerY = height / 2;
        const oldCenterX = (minX + maxX) / 2;
        const oldCenterY = (minY + maxY) / 2;
        
        state.nodePositions.forEach(pos => {
          pos.x = centerX + (pos.x - oldCenterX) * scale;
          pos.y = centerY + (pos.y - oldCenterY) * scale;
        });
      }
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