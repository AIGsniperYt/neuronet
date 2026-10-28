const DB_NAME = "neuronet-showcase-v7";
const DB_VERSION = 4; // Pinned tools + global subjects

let db;

function emitDBChange(detail) {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("db-change", { detail }));
  }
}

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      db = e.target.result;

      // Alpha reset: recreate stores cleanly instead of migrating legacy data.
      for (const storeName of Array.from(db.objectStoreNames)) {
        db.deleteObjectStore(storeName);
      }

      const nodeStore = db.createObjectStore("nodes", { keyPath: "id" });
      nodeStore.createIndex("type", "type", { unique: false });
      nodeStore.createIndex("subject", "subject", { unique: false });
      nodeStore.createIndex("subjectType", ["subject", "type"], { unique: false });

      const quoteStore = db.createObjectStore("quotes", { keyPath: "id" });
      quoteStore.createIndex("subject", "subject", { unique: false });
      quoteStore.createIndex("sourceId", "link.sourceId", { unique: false });
      quoteStore.createIndex("subjectSource", ["subject", "link.sourceId"], { unique: false });

      const pinnedStore = db.createObjectStore("pinnedTools", { keyPath: "toolId" });
      pinnedStore.createIndex("position", "position", { unique: false });
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => {
        console.error("IndexedDB failed:", e);
        reject(e);
    };
  });
}

export function addNode(node) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const record = {
      ...node,
      id: node.id || crypto.randomUUID()
    };

    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    const req = store.put(record);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addNodes(nodes) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const records = (nodes || []).map((node) => ({
      ...node,
      id: node.id || crypto.randomUUID()
    }));

    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");

    for (const record of records) {
      store.put(record);
    }

    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllNodes() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("nodes", "readonly");
    const req = tx.objectStore("nodes").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getNode(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("nodes", "readonly");
    const req = tx.objectStore("nodes").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteNode(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("nodes", "readwrite");
    const store = tx.objectStore("nodes");
    const req = store.delete(id);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearNodes() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("nodes", "readwrite");
    const req = tx.objectStore("nodes").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "nodes" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== QUOTE STORE OPERATIONS ==========

/**
 * Add or update a quote node
 */
export function addQuote(quote) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const record = {
      ...quote,
      id: quote.id || crypto.randomUUID(),
      type: "quote",
      priority: Number.isFinite(Number(quote.priority)) ? Math.min(5, Math.max(1, Number(quote.priority))) : 3
    };

    const tx = db.transaction("quotes", "readwrite");
    const store = tx.objectStore("quotes");
    const req = store.put(record);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-quote", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Add multiple quotes
 */
export function addQuotes(quotes) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const records = (quotes || []).map((quote) => ({
      ...quote,
      id: quote.id || crypto.randomUUID(),
      type: "quote"
    }));

    const tx = db.transaction("quotes", "readwrite");
    const store = tx.objectStore("quotes");

    for (const record of records) {
      store.put(record);
    }

    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-quote", ids: records.map((r) => r.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Get all quotes
 */
export function getAllQuotes() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readonly");
    const req = tx.objectStore("quotes").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get quote by ID
 */
export function getQuote(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readonly");
    const req = tx.objectStore("quotes").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all quotes for a source
 */
export function getQuotesForSource(sourceId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readonly");
    const store = tx.objectStore("quotes");
    const index = store.index("sourceId");
    const req = index.getAll(sourceId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all quotes for a subject
 */
export function getQuotesForSubject(subject) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readonly");
    const store = tx.objectStore("quotes");
    const index = store.index("subject");
    const req = index.getAll(subject);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete a quote
 */
export function deleteQuote(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readwrite");
    const store = tx.objectStore("quotes");
    const req = store.delete(id);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-quote", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearQuotes() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readwrite");
    const req = tx.objectStore("quotes").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "quotes" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== ANALYSIS NODES (stored in nodes) ==========

/**
 * Get all analysis nodes for a subject
 */
export function getAnalysisNodesForSubject(subject) {
  return new Promise(async (resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const nodes = await getAllNodes();
    const analyses = nodes.filter(n => n.type === "analysis" && n.subject === subject);
    resolve(analyses);
  });
}

// ========== BIDIRECTIONAL LINKING UTILITIES ==========

/**
 * Add analysis ID to a quote's analysisNodeIds
 */
export async function linkAnalysisToQuote(quoteId, analysisId) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error(`Quote ${quoteId} not found`);

  if (!quote.meta) quote.meta = {};
  if (!quote.meta.analysisNodeIds) quote.meta.analysisNodeIds = [];
  
  if (!quote.meta.analysisNodeIds.includes(analysisId)) {
    quote.meta.analysisNodeIds.push(analysisId);
  }
  quote.updatedAt = Date.now();
  
  return addQuote(quote);
}

/**
 * Remove analysis ID from a quote's analysisNodeIds
 */
export async function unlinkAnalysisFromQuote(quoteId, analysisId) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error(`Quote ${quoteId} not found`);

  if (quote.meta?.analysisNodeIds) {
    quote.meta.analysisNodeIds = quote.meta.analysisNodeIds.filter(id => id !== analysisId);
  }
  quote.updatedAt = Date.now();
  
  return addQuote(quote);
}

/**
 * Get all analysis nodes that reference a quote
 */
export async function getAnalysesReferencingQuote(quoteId) {
  const allNodes = await getAllNodes();
  return allNodes.filter(node => 
    node.type === "analysis" && 
    node.quoteRefs?.some(ref => ref.quoteId === quoteId)
  );
}

/**
 * Get all quotes referenced by an analysis node
 */
export async function getQuotesReferencedByAnalysis(analysisId) {
  const analysis = await getNode(analysisId);
  if (!analysis || !analysis.quoteRefs) return [];

  const quotes = [];
  for (const ref of analysis.quoteRefs) {
    const quote = await getQuote(ref.quoteId);
    if (quote) quotes.push(quote);
  }
  return quotes;
}

// ========== PINNED TOOLS ==========

export async function getPinnedTools() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("pinnedTools", "readonly");
    const req = tx.objectStore("pinnedTools").getAll();
    req.onsuccess = () => {
      const tools = req.result || [];
      tools.sort((a, b) => (a.position || 0) - (b.position || 0));
      resolve(tools);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function pinTool(toolId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("pinnedTools", "readwrite");
    const store = tx.objectStore("pinnedTools");

    store.get(toolId).onsuccess = (e) => {
      const existing = e.target.result;
      if (existing) {
        resolve(existing);
        return;
      }

      store.getAll().onsuccess = (getAllReq) => {
        const allTools = getAllReq.target.result || [];
        const maxPosition = allTools.reduce((max, t) => Math.max(max, t.position || 0), 0);

        const record = {
          toolId,
          position: maxPosition + 1,
          createdAt: Date.now()
        };
        store.put(record);
        tx.oncomplete = () => resolve(record);
      };
    };

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function unpinTool(toolId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("pinnedTools", "readwrite");
    const store = tx.objectStore("pinnedTools");
    const req = store.delete(toolId);

    req.onsuccess = () => resolve(toolId);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function isToolPinned(toolId) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("pinnedTools", "readonly");
    const req = tx.objectStore("pinnedTools").get(toolId);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setPinnedToolsOrder(toolIds) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("pinnedTools", "readwrite");
    const store = tx.objectStore("pinnedTools");

    toolIds.forEach((toolId, index) => {
      store.get(toolId).onsuccess = (e) => {
        const existing = e.target.result;
        if (existing) {
          existing.position = index + 1;
          store.put(existing);
        }
      };
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== SUBJECTS ==========

export async function getSubjects() {
  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
  const subjects = new Set();
  allNodes.forEach(node => {
    if (node.subject) subjects.add(node.subject);
  });
  allQuotes.forEach(quote => {
    if (quote.subject) subjects.add(quote.subject);
  });
  return Array.from(subjects).sort();
}

export async function addSubject(name) {
  const subjectNode = {
    id: `subject-${crypto.randomUUID()}`,
    type: "subject",
    subject: name,
    name: name,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return addNode(subjectNode);
}

export async function deleteSubject(subjectName) {
  const allNodes = await getAllNodes();
  const allQuotes = await getAllQuotes();

  const subjectNodes = allNodes.filter(n => n.subject === subjectName);
  const subjectQuotes = allQuotes.filter(q => q.subject === subjectName);

  for (const node of subjectNodes) {
    await deleteNode(node.id);
  }
  for (const quote of subjectQuotes) {
    await deleteQuote(quote.id);
  }

  return subjectName;
}

export async function renameSubject(oldName, newName) {
  const allNodes = await getAllNodes();
  const allQuotes = await getAllQuotes();
  const now = Date.now();

  const subjectNodes = allNodes.filter(n => n.subject === oldName);
  const subjectQuotes = allQuotes.filter(q => q.subject === oldName);

  for (const node of subjectNodes) {
    const copy = { ...node };
    copy.subject = newName;
    if (copy.type === "subject" || copy.meta?.kind === "subject") {
      copy.title = newName;
    }
    copy.updatedAt = now;
    await deleteNode(node.id);
    await addNode(copy);
  }
  for (const quote of subjectQuotes) {
    await deleteQuote(quote.id);
    await addQuote({ ...quote, subject: newName, updatedAt: now });
  }

  return newName;
}
