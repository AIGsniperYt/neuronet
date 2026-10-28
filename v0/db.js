const DB_NAME = "neuronet-showcase-v0";
const DB_VERSION = 2; // Updated for new quote/analysis separation

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

      // Clear old data during migration
      const stores = Array.from(db.objectStoreNames);
      
      // Create nodes store (for all node types: source, analysis)
      if (!db.objectStoreNames.contains("nodes")) {
        db.createObjectStore("nodes", { keyPath: "id" });
      }

      // Create separate quotes store
      if (!db.objectStoreNames.contains("quotes")) {
        const quoteStore = db.createObjectStore("quotes", { keyPath: "id" });
        quoteStore.createIndex("subject", "subject", { unique: false });
        quoteStore.createIndex("sourceId", "link.sourceId", { unique: false });
        quoteStore.createIndex("subjectSource", ["subject", "link.sourceId"], { unique: false });
      }

      // Add indices to nodes store for better querying
      if (!db.objectStoreNames.contains("nodes")) {
        const nodeStore = db.createObjectStore("nodes", { keyPath: "id" });
        nodeStore.createIndex("type", "type", { unique: false });
        nodeStore.createIndex("subject", "subject", { unique: false });
        nodeStore.createIndex("subjectType", ["subject", "type"], { unique: false });
      } else {
        // If nodes already exists, try to add indices if they don't exist
        try {
          if (!db.objectStoreNames.contains("nodes").indices?.contains("type")) {
            // This will fail in onupgradeneeded but that's okay
          }
        } catch (e) {
          // Indices already exist or can't be added
        }
      }
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
      type: "quote"
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

// ========== ANALYSIS NODES (stored in nodes) ==========

/**
 * Get all analysis nodes for a subject
 */
export function getAnalysisNodesForSubject(subject) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const allAnalyses = getAllNodes().then(nodes => 
      nodes.filter(n => n.type === "analysis" && n.subject === subject)
    );
    resolve(allAnalyses);
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
