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
    nodes: [],
    quotes: [],
    currentSubject: contextSubject || null,
    selectedNodeId: null,
    hoveredNodeId: null,
    nodePositions: new Map(),
    draggingNodeId: null,
    dragOffset: { x: 0, y: 0 },
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    isPanning: false,
    panStartPos: { x: 0, y: 0 }
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
      source: "#4da6ff",
      quote: "#ff9b39",
      analysis: "#2cffb3"
    }
  };

  function getNodeTypeIcon(type) {
    switch (type) {
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

  function initializePositions(containerWidth, containerHeight) {
    state.nodePositions.clear();
    
    const allItems = getAllItems();
    if (allItems.length === 0) return;
    
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    
    allItems.forEach((item, index) => {
      if (!state.nodePositions.has(item.id)) {
        const angle = (index / allItems.length) * Math.PI * 2;
        const radius = Math.min(containerWidth, containerHeight) * 0.22;
        state.nodePositions.set(item.id, {
          x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
          y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 40
        });
      }
    });
  }

  function getAllItems() {
    return [...state.nodes, ...state.quotes];
  }

  function findItemById(id) {
    return getAllItems().find(item => item.id === id);
  }

  function getConnections() {
    const connections = [];
    const connectionSet = new Set();

    const items = getAllItems();
    const analysisNodes = items.filter(n => n.type === "analysis");
    const quoteNodes = items.filter(q => q.type === "quote");

    analysisNodes.forEach(analysis => {
      if (analysis.quoteRefs && Array.isArray(analysis.quoteRefs)) {
        analysis.quoteRefs.forEach(ref => {
          if (ref.quoteId) {
            const key = [ref.quoteId, analysis.id].sort().join("-");
            if (!connectionSet.has(key)) {
              connectionSet.add(key);
              connections.push({ from: ref.quoteId, to: analysis.id, type: "quote-analysis" });
            }
          }
        });
      }
    });

    quoteNodes.forEach(quote => {
      if (quote.meta?.analysisNodeIds && Array.isArray(quote.meta.analysisNodeIds)) {
        quote.meta.analysisNodeIds.forEach(analysisId => {
          const key = [quote.id, analysisId].sort().join("-");
          if (!connectionSet.has(key)) {
            connectionSet.add(key);
            connections.push({ from: quote.id, to: analysisId, type: "quote-analysis" });
          }
        });
      }
    });

    return connections;
  }

  function transformPoint(x, y) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
      x: centerX + (x - centerX) * state.zoom + state.panOffset.x,
      y: centerY + (y - centerY) * state.zoom + state.panOffset.y
    };
  }

  function render() {
    if (!ctx || !canvas) return;
    
    const container = canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    canvas.width = width;
    canvas.height = height;
    
    ctx.clearRect(0, 0, width, height);

    const connections = getConnections();
    const items = getAllItems();

    connections.forEach(conn => {
      const fromPos = state.nodePositions.get(conn.from);
      const toPos = state.nodePositions.get(conn.to);
      
      if (fromPos && toPos) {
        const fromTrans = transformPoint(fromPos.x, fromPos.y);
        const toTrans = transformPoint(toPos.x, toPos.y);
        const isActive = state.selectedNodeId === conn.from || state.selectedNodeId === conn.to;
        
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
    
    requestAnimationFrame(render);
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
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalConnections = document.getElementById("totalConnections");
    
    if (totalNodes) totalNodes.textContent = items.length;
    if (totalQuotes) totalQuotes.textContent = items.filter(i => i.type === "quote").length;
    if (totalAnalyses) totalAnalyses.textContent = items.filter(i => i.type === "analysis").length;
    
    const connections = getConnections();
    if (totalConnections) totalConnections.textContent = connections.length;
  }

  async function refreshData() {
    const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    state.nodes = nodes;
    state.quotes = quotes;
    
    const container = canvas?.parentElement;
    if (container) {
      initializePositions(container.clientWidth, container.clientHeight);
    }
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
        state.draggingNodeId = null;
        state.isPanning = false;
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
  render();

  window.__neuronetMindmapCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    window.removeEventListener("resize", handleResize);
  };
}