import { createSubjectRecord, parseSubjectName, subjectKey, subjectKeyMatches, migrateSubjectIdentity, compareSubjectRecords } from "./subjectModel.js";
let db;

const DB_VERSION = 12;

// Decks are canonical folders inside a subject. Cards point at one deck via
// deckId; the legacy `card.deck` string remains the subject owner until the
// UI move is complete. Heaps are a separate, non-owning study layer.
export const UNSORTED_DECK_NAME = "Unsorted";

function getDBName() {
  return window.DEMO_MODE ? `neuronet-${window.APP_VERSION}` : "neuronet";
}

function emitDBChange(detail) {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("db-change", { detail }));
  }
}

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(getDBName(), DB_VERSION);

    request.onupgradeneeded = (e) => {
      db = e.target.result;
      const tx = e.target.transaction;

      const ensureNodeIndexes = (nodeStore) => {
        if (!nodeStore.indexNames.contains("type")) {
          nodeStore.createIndex("type", "type", { unique: false });
        }
        if (!nodeStore.indexNames.contains("subject")) {
          nodeStore.createIndex("subject", "subject", { unique: false });
        }
        if (!nodeStore.indexNames.contains("subjectType")) {
          nodeStore.createIndex("subjectType", ["subject", "type"], { unique: false });
        }
        if (!nodeStore.indexNames.contains("subjectTypeNextReview")) {
          nodeStore.createIndex("subjectTypeNextReview", ["subject", "type", "meta.nextReview"], { unique: false });
        }
      };

      const ensureQuoteIndexes = (quoteStore) => {
        if (!quoteStore.indexNames.contains("subject")) {
          quoteStore.createIndex("subject", "subject", { unique: false });
        }
        if (!quoteStore.indexNames.contains("sourceId")) {
          quoteStore.createIndex("sourceId", "link.sourceId", { unique: false });
        }
        if (!quoteStore.indexNames.contains("subjectSource")) {
          quoteStore.createIndex("subjectSource", ["subject", "link.sourceId"], { unique: false });
        }
        if (!quoteStore.indexNames.contains("subjectNextReview")) {
          quoteStore.createIndex("subjectNextReview", ["subject", "meta.nextReview"], { unique: false });
        }
      };

      if (!db.objectStoreNames.contains("nodes")) {
        const nodeStore = db.createObjectStore("nodes", { keyPath: "id" });
        ensureNodeIndexes(nodeStore);
      } else if (tx) {
        ensureNodeIndexes(tx.objectStore("nodes"));
      }

      if (!db.objectStoreNames.contains("quotes")) {
        const quoteStore = db.createObjectStore("quotes", { keyPath: "id" });
        ensureQuoteIndexes(quoteStore);
      } else if (tx) {
        ensureQuoteIndexes(tx.objectStore("quotes"));
      }

      if (!db.objectStoreNames.contains("pinnedTools")) {
        const pinnedStore = db.createObjectStore("pinnedTools", { keyPath: "toolId" });
        pinnedStore.createIndex("position", "position", { unique: false });
      }

      if (!db.objectStoreNames.contains("cues")) {
        const cueStore = db.createObjectStore("cues", { keyPath: "id" });
        cueStore.createIndex("subject", "subject", { unique: false });
        cueStore.createIndex("quoteId", "quoteId", { unique: false });
        cueStore.createIndex("analysisId", "analysisId", { unique: false });
      }

      if (!db.objectStoreNames.contains("tags")) {
        const tagStore = db.createObjectStore("tags", { keyPath: "id" });
        tagStore.createIndex("title", "title", { unique: true });
      }

      const ensureCardIndexes = (cardStore) => {
        if (!cardStore.indexNames.contains("deck")) {
          cardStore.createIndex("deck", "deck", { unique: false });
        }
        if (!cardStore.indexNames.contains("deckId")) {
          cardStore.createIndex("deckId", "deckId", { unique: false });
        }
        if (!cardStore.indexNames.contains("nextReview")) {
          cardStore.createIndex("nextReview", "meta.nextReview", { unique: false });
        }
        if (!cardStore.indexNames.contains("deckNextReview")) {
          cardStore.createIndex("deckNextReview", ["deck", "meta.nextReview"], { unique: false });
        }
        if (!cardStore.indexNames.contains("quoteId")) {
          cardStore.createIndex("quoteId", "links.quoteId", { unique: false });
        }
        if (!cardStore.indexNames.contains("order")) {
          cardStore.createIndex("order", "order", { unique: false });
        }
        if (!cardStore.indexNames.contains("createdAt")) {
          cardStore.createIndex("createdAt", "createdAt", { unique: false });
        }
      };

      if (!db.objectStoreNames.contains("cards")) {
        const cardStore = db.createObjectStore("cards", { keyPath: "id" });
        ensureCardIndexes(cardStore);
      } else if (tx) {
        ensureCardIndexes(tx.objectStore("cards"));
      }

      if (!db.objectStoreNames.contains("decks")) {
        const deckStore = db.createObjectStore("decks", { keyPath: "id" });
        deckStore.createIndex("subject", "subject", { unique: false });
        deckStore.createIndex("parentId", "parentId", { unique: false });
        deckStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      for (const storeName of ["nodes", "quotes", "cues", "decks", "cards"]) {
        if (db.objectStoreNames.contains(storeName)) {
          const store = tx.objectStore(storeName);
          if (!store.indexNames.contains("subjectId")) store.createIndex("subjectId", "subjectId", { unique: false });
        }
      }

      const creatingSubjects = !db.objectStoreNames.contains("subjects");
      if (creatingSubjects) {
        const subjectsStore = db.createObjectStore("subjects", { keyPath: "id" });
        subjectsStore.createIndex("key", "key", { unique: true });
        subjectsStore.createIndex("keyNorm", "keyNorm", { unique: true });
        subjectsStore.createIndex("name", "name", { unique: false });
        subjectsStore.createIndex("level", "level", { unique: false });
        subjectsStore.createIndex("order", "order", { unique: false });
        const names = ["nodes", "quotes", "cues", "cards", "decks"].filter((name) => db.objectStoreNames.contains(name));
        if (names.length) {
          const data = {};
          let pending = names.length;
          for (const name of names) {
            const req = tx.objectStore(name).getAll();
            req.onsuccess = () => {
              data[name] = req.result || [];
              if (--pending === 0) {
                const migrated = migrateSubjectIdentity(data);
                for (const record of migrated.subjects) subjectsStore.put({ ...record, keyNorm: String(record.key || "").trim().toLocaleLowerCase() });
                for (const name of names) for (const record of migrated[name] || []) tx.objectStore(name).put(record);
              }
            };
          }
        }
      }

      if (!db.objectStoreNames.contains("heaps")) {
        const heapStore = db.createObjectStore("heaps", { keyPath: "id" });
        heapStore.createIndex("updatedAt", "updatedAt", { unique: false });
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

// ========== MEMORY (DUE QUERIES) ==========

export function getDueQuotesForSubject(subject, { now = Date.now(), limit = 200 } = {}) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("quotes", "readonly");
    const store = tx.objectStore("quotes");

    let index;
    try {
      index = store.index("subjectNextReview");
    } catch (error) {
      // Fallback: scan subject quotes once
      const subjectIndex = store.index("subject");
      const reqAll = subjectIndex.getAll(subject);
      reqAll.onsuccess = () => {
        const all = reqAll.result || [];
        const due = all.filter((q) => (q?.meta?.nextReview ?? 0) <= now);
        resolve(due.slice(0, limit));
      };
      reqAll.onerror = () => reject(reqAll.error);
      tx.onerror = () => reject(tx.error);
      return;
    }

    const range = IDBKeyRange.bound([subject, 0], [subject, now]);
    const results = [];
    const req = index.openCursor(range);

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getDueAnalysisNodesForSubject(subject, { now = Date.now(), limit = 200 } = {}) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }

    const tx = db.transaction("nodes", "readonly");
    const store = tx.objectStore("nodes");

    let index;
    try {
      index = store.index("subjectTypeNextReview");
    } catch (error) {
      // Fallback: scan analyses for subject once
      getAnalysisNodesForSubject(subject).then((nodes) => {
        const due = (nodes || []).filter((n) => (n?.meta?.nextReview ?? 0) <= now);
        resolve(due.slice(0, limit));
      }).catch(reject);
      return;
    }

    const range = IDBKeyRange.bound([subject, "analysis", 0], [subject, "analysis", now]);
    const results = [];
    const req = index.openCursor(range);

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
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
    if (id == null || id === "") {
      resolve(null);
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

// ========== QUOTE SEARCH & DUPLICATE DETECTION ==========

/**
 * Find an existing quote by sourceId + start + end position
 * Used to prevent duplicate quote nodes for the same text position
 */
export async function findExistingQuote(sourceId, start, end) {
  const quotes = await getQuotesForSource(sourceId);
  return quotes.find(q =>
    Number(q.link?.start) === Number(start) &&
    Number(q.link?.end) === Number(end)
  ) || null;
}

/**
 * Find an existing quote by its text content and source (fuzzy match)
 */
export async function findExistingQuoteByText(sourceId, quoteText) {
  if (!quoteText) return null;
  const quotes = await getQuotesForSource(sourceId);
  const normalized = (text) => text?.toLowerCase().replace(/\s+/g, " ").trim() || "";
  const target = normalized(quoteText);

  return quotes.find(q => normalized(q.quote) === target) || null;
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

    const tx = db.transaction("nodes", "readonly");
    const store = tx.objectStore("nodes");

    let index;
    try {
      index = store.index("subjectType");
    } catch (error) {
      // Fallback for older DBs: scan all nodes once
      getAllNodes()
        .then((nodes) => resolve((nodes || []).filter((n) => n.type === "analysis" && n.subject === subject)))
        .catch(reject);
      return;
    }

    const req = index.getAll(IDBKeyRange.only([subject, "analysis"]));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
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

  // Also update analysis.quoteRefs to maintain bidirectional consistency
  const analysis = await getNode(analysisId);
  if (analysis) {
    if (!analysis.quoteRefs) analysis.quoteRefs = [];
    if (!analysis.quoteRefs.some(ref => ref.quoteId === quoteId)) {
      // FIX: Include all necessary fields from quote node, not just basic info
      const priority = quote.priority ? Math.min(5, Math.max(1, Math.round(Number(quote.priority)))) : 3;
      analysis.quoteRefs.push({
        quoteId: quote.id,
        section: quote.section || "",
        quote: quote.quote || "",
        sourceId: quote.link?.sourceId,
        start: Number.isFinite(Number(quote.link?.start)) ? Number(quote.link.start) : undefined,
        end: Number.isFinite(Number(quote.link?.end)) ? Number(quote.link.end) : undefined,
        priority
      });
      analysis.updatedAt = Date.now();
      await addNode(analysis);
    }
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
  quote.updatedAt = Date.now();

  // Also update analysis.quoteRefs to maintain bidirectional consistency
  const analysis = await getNode(analysisId);
  if (analysis && analysis.quoteRefs) {
    analysis.quoteRefs = analysis.quoteRefs.filter(ref => ref.quoteId !== quoteId);
    analysis.updatedAt = Date.now();
    await addNode(analysis);
  }

  return addQuote(quote);
}

/**
 * Get all analysis nodes that reference a quote
 */
export async function getAnalysesReferencingQuote(quoteId) {
  const allNodes = await getAllNodes();
  const quote = await getQuote(quoteId);

  // Get analysis IDs from both sides of the relationship
  const idsFromQuoteMeta = new Set(quote?.meta?.analysisNodeIds || []);

  // Check quoteRefs in analysis nodes
  const idsFromQuoteRefs = new Set();
  const analysesWithRefs = allNodes.filter(node =>
    node.type === "analysis" &&
    node.quoteRefs?.some(ref => {
      if (ref.quoteId === quoteId) {
        idsFromQuoteRefs.add(node.id);
        return true;
      }
      return false;
    })
  );

  // Merge both sets of IDs
  const allAnalysisIds = new Set([...idsFromQuoteMeta, ...idsFromQuoteRefs]);

  // Return full analysis nodes
  return allNodes.filter(node =>
    node.type === "analysis" && allAnalysisIds.has(node.id)
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

// ========== CUE STORE OPERATIONS ==========

function cueStoreExists() {
  return db && db.objectStoreNames.contains("cues");
}

export function addCue(cue) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }
    if (!cueStoreExists()) {
      reject(new Error("Cues store not available"));
      return;
    }

    const record = {
      ...cue,
      id: cue.id || crypto.randomUUID(),
      type: "cue",
      createdAt: cue.createdAt || Date.now(),
      updatedAt: cue.updatedAt || Date.now()
    };

    const tx = db.transaction("cues", "readwrite");
    const store = tx.objectStore("cues");
    const req = store.put(record);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-cue", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addCues(cues) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("IndexedDB is not initialized"));
      return;
    }
    if (!cueStoreExists()) {
      resolve([]);
      return;
    }

    const records = (cues || []).map((cue) => ({
      ...cue,
      id: cue.id || crypto.randomUUID(),
      type: "cue"
    }));

    const tx = db.transaction("cues", "readwrite");
    const store = tx.objectStore("cues");

    for (const record of records) {
      store.put(record);
    }

    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-cue", ids: records.map((r) => r.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllCues() {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cues", "readonly");
    const req = tx.objectStore("cues").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCue(id) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve(null);
      return;
    }

    const tx = db.transaction("cues", "readonly");
    const req = tx.objectStore("cues").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteCue(id) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve(id);
      return;
    }

    const tx = db.transaction("cues", "readwrite");
    const store = tx.objectStore("cues");
    const req = store.delete(id);

    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-cue", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearCues() {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve();
      return;
    }

    const tx = db.transaction("cues", "readwrite");
    const req = tx.objectStore("cues").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "cues" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getCuesForQuote(quoteId) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cues", "readonly");
    const store = tx.objectStore("cues");
    const index = store.index("quoteId");
    const req = index.getAll(quoteId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCuesForAnalysis(analysisId) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cues", "readonly");
    const store = tx.objectStore("cues");
    const index = store.index("analysisId");
    const req = index.getAll(analysisId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCuesForSubject(subject) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cues", "readonly");
    const store = tx.objectStore("cues");
    const index = store.index("subject");
    const req = index.getAll(subject);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function updateCueLinks(cueId, quoteId, analysisId) {
  return new Promise((resolve, reject) => {
    if (!db || !cueStoreExists()) {
      reject(new Error("Cues store not available"));
      return;
    }

    const tx = db.transaction("cues", "readwrite");
    const store = tx.objectStore("cues");
    const req = store.get(cueId);

    req.onsuccess = () => {
      const cue = req.result;
      if (!cue) {
        reject(new Error(`Cue ${cueId} not found`));
        return;
      }
      cue.quoteId = quoteId;
      cue.analysisId = analysisId || null;
      cue.updatedAt = Date.now();
      store.put(cue);
      tx.oncomplete = () => {
        emitDBChange({ type: "upsert-cue", ids: [cueId] });
        resolve(cue);
      };
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== CARD STORE OPERATIONS ==========
//
// Cards are the unit of study. A card owns its front/back, deck/topic, tags,
// priority, stable order, and SRS state. It may link to a legacy quote/cue or
// analysis, but those links are optional context; they do not create the card.

function cardStoreExists() {
  return db && db.objectStoreNames.contains("cards");
}

function normalizeDeckPath(card = {}) {
  const rawPath = Array.isArray(card.deckPath)
    ? card.deckPath
    : Array.isArray(card.meta?.hierarchyPath)
      ? card.meta.hierarchyPath
      : [];
  let deckPath = rawPath
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  let deck = String(card.deck || card.subject || deckPath[0] || "").trim();
  if (!deck && deckPath.length > 0) deck = deckPath[0];
  if (deck && deckPath[0] !== deck) {
    deckPath = [deck, ...deckPath.filter((part) => part !== deck)];
  }
  if (!deckPath.length && deck) deckPath = [deck];
  return { deck, deckPath };
}

function normalizeCardTags(tags = []) {
  return [...new Set(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
  )];
}

function normalizeCardRecord(card = {}) {
  const now = Date.now();
  const { deck, deckPath } = normalizeDeckPath(card);
  const meta = { ...(card.meta || {}) };
  // These fields moved out of metadata when cards became first-class.
  delete meta.tags;
  delete meta.hierarchyPath;
  delete meta.deckOrder;
  if (!Number.isFinite(Number(meta.nextReview))) meta.nextReview = 0;
  if (!Number.isFinite(Number(meta.interval))) meta.interval = 1;
  if (!Number.isFinite(Number(meta.ease))) meta.ease = 2.5;
  if (!Number.isFinite(Number(meta.repetitions))) meta.repetitions = 0;
  if (!Number.isFinite(Number(meta.confidence))) meta.confidence = 0.8;

  const priority = Number.isFinite(Number(card.priority))
    ? Math.min(5, Math.max(1, Number(card.priority)))
    : 3;
  const order = Number.isFinite(Number(card.order)) ? Number(card.order) : now;
  const tags = normalizeCardTags([
    ...(Array.isArray(card.tags) ? card.tags : []),
    ...(Array.isArray(card.meta?.tags) ? card.meta.tags : [])
  ]);

  const links = {};
  if (card.links && typeof card.links === "object") {
    for (const key of ["quoteId", "cueId", "analysisId", "nodeId", "sourceId"]) {
      if (card.links[key]) links[key] = card.links[key];
    }
  }

  return {
    ...card,
    id: card.id || crypto.randomUUID(),
    type: "card",
    front: String(card.front || "").trim(),
    back: String(card.back || "").trim(),
    deck,
    // Canonical folder. `deck` above is the subject string and is kept for
    // legacy readers until the deck UI ships.
    deckId: card.deckId ? String(card.deckId) : null,
    deckPath,
    tags,
    priority,
    order,
    meta,
    links,
    origin: card.origin || "manual",
    createdAt: Number(card.createdAt) || now,
    updatedAt: Number(card.updatedAt) || now
  };
}

export async function addCard(card) {
  if (!db || !cardStoreExists()) {
    throw new Error("Cards store not available");
  }

  const record = normalizeCardRecord(card);
  if (!record.front || !record.back) {
    throw new Error("Card requires both a front and a back");
  }
  await assignDeckIdsToCards([record]);

  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const req = tx.objectStore("cards").put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-card", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function addCards(cards) {
  if (!db || !cardStoreExists()) {
    return [];
  }

  const records = (cards || [])
    .map(normalizeCardRecord)
    .filter((record) => record.front && record.back);

  if (records.length === 0) {
    return [];
  }
  await assignDeckIdsToCards(records);

  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    for (const record of records) store.put(record);

    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-card", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllCards() {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const req = tx.objectStore("cards").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCard(id) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve(null);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const req = tx.objectStore("cards").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCardsForDeck(deck) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const store = tx.objectStore("cards");
    const req = store.index("deck").getAll(deck);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getDueCardsForDeck(deck, { now = Date.now(), limit = 200 } = {}) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const store = tx.objectStore("cards");

    const scanDeck = () => {
      const reqAll = store.index("deck").getAll(deck);
      reqAll.onsuccess = () => {
        const due = (reqAll.result || []).filter((card) => (card?.meta?.nextReview ?? 0) <= now);
        resolve(due.slice(0, limit));
      };
      reqAll.onerror = () => reject(reqAll.error);
      tx.onerror = () => reject(tx.error);
    };

    let index;
    try {
      index = store.index("deckNextReview");
    } catch (error) {
      scanDeck();
      return;
    }

    const range = IDBKeyRange.bound([deck, 0], [deck, now]);
    const results = [];
    const req = index.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getCardsForQuote(quoteId) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const req = tx.objectStore("cards").index("quoteId").getAll(quoteId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteCard(id) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve(id);
      return;
    }

    const tx = db.transaction("cards", "readwrite");
    const req = tx.objectStore("cards").delete(id);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-card", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteCardsForDeck(deck) {
  const cards = await getCardsForDeck(deck);
  for (const card of cards) {
    await deleteCard(card.id);
  }
  return cards.length;
}

export function clearCards() {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve();
      return;
    }

    const tx = db.transaction("cards", "readwrite");
    const req = tx.objectStore("cards").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "cards" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getCardsForDeckId(deckId) {
  return new Promise((resolve, reject) => {
    if (!db || !cardStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("cards", "readonly");
    const req = tx.objectStore("cards").index("deckId").getAll(deckId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ========== DECKS ==========
//
// A deck is a canonical, nestable folder inside a subject. It owns cards by
// reference (`card.deckId`); cards are never copied into decks. Heaps are a
// separate, non-owning study layer.
//
// The legacy `card.deck` string still carries the subject name. During the
// transition, cards without a deckId are collected into an "Unsorted" deck for
// their subject so navigation has a home for every card.

function deckStoreExists() {
  return db && db.objectStoreNames.contains("decks");
}

function normalizeDeckRecord(deck = {}) {
  const now = Date.now();
  const id = deck.id ? String(deck.id) : crypto.randomUUID();
  const parentId = deck.parentId && String(deck.parentId) !== id
    ? String(deck.parentId)
    : null;
  return {
    ...deck,
    id,
    type: "deck",
    name: String(deck.name || "").trim() || "Untitled Deck",
    subject: String(deck.subject || "").trim(),
    parentId,
    createdAt: Number(deck.createdAt) || now,
    updatedAt: Number(deck.updatedAt) || now
  };
}

export function addDeck(deck) {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      reject(new Error("Decks store not available"));
      return;
    }

    const record = normalizeDeckRecord(deck);
    const tx = db.transaction("decks", "readwrite");
    const req = tx.objectStore("decks").put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-deck", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addDecks(decks) {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve([]);
      return;
    }

    const records = (decks || []).map(normalizeDeckRecord);
    if (records.length === 0) {
      resolve([]);
      return;
    }

    const tx = db.transaction("decks", "readwrite");
    const store = tx.objectStore("decks");
    for (const record of records) store.put(record);

    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-deck", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllDecks() {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("decks", "readonly");
    const req = tx.objectStore("decks").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getDeck(id) {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve(null);
      return;
    }

    const tx = db.transaction("decks", "readonly");
    const req = tx.objectStore("decks").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getDecksForSubject(subject) {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("decks", "readonly");
    const req = tx.objectStore("decks").index("subject").getAll(String(subject || "").trim());
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteDeckRecord(id) {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve(id);
      return;
    }

    const tx = db.transaction("decks", "readwrite");
    const req = tx.objectStore("decks").delete(id);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-deck", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearDecks() {
  return new Promise((resolve, reject) => {
    if (!db || !deckStoreExists()) {
      resolve();
      return;
    }

    const tx = db.transaction("decks", "readwrite");
    const req = tx.objectStore("decks").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "decks" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function findOrCreateUnsortedDeck(subject, subjectId = "") {
  const normalizedSubject = String(subject || "").trim();
  const decks = await getAllDecks().catch(() => []);
  const existing = decks.find((deck) => (
    !deck.parentId
    && deck.name === UNSORTED_DECK_NAME
    && (subjectId ? deck.subjectId === subjectId : String(deck.subject || "").trim() === normalizedSubject)
  ));
  if (existing) return existing;

  return addDeck({
    name: UNSORTED_DECK_NAME,
    subject: normalizedSubject,
    subjectId: subjectId || undefined,
    parentId: null
  });
}

async function assignDeckIdsToCards(cards) {
  if (!cards.length) return;
  const decks = await getAllDecks().catch(() => []);
  const knownDeckIds = new Set(decks.map((deck) => deck.id));
  const unsortedBySubject = new Map();
  for (const deck of decks) {
    if (!deck.parentId && deck.name === UNSORTED_DECK_NAME) {
      unsortedBySubject.set(String(deck.subject || "").trim(), deck.id);
    }
  }

  for (const card of cards) {
    if (card.deckId && knownDeckIds.has(card.deckId)) continue;
    const subject = String(card.deck || "").trim();
    let deckId = unsortedBySubject.get(subject);
    if (!deckId) {
      try {
        const created = await findOrCreateUnsortedDeck(subject);
        deckId = created.id;
        knownDeckIds.add(deckId);
        unsortedBySubject.set(subject, deckId);
      } catch (error) {
        console.warn("[DECKS] could not assign an Unsorted deck:", error);
        deckId = null;
      }
    }
    card.deckId = deckId || null;
  }
}

// Backfill deck membership for cards written before decks existed. Idempotent:
// cards with a live deckId are left untouched.
export async function ensureDeckMembership() {
  const cards = await getAllCards();
  const missingIds = new Set(cards.filter((card) => !card.deckId).map((card) => card.id));
  if (!missingIds.size) return { cardsAssigned: 0, decksCreated: 0 };

  const deckCountBefore = (await getAllDecks().catch(() => [])).length;
  await assignDeckIdsToCards(cards);
  const changed = cards.filter((card) => missingIds.has(card.id) && card.deckId);
  if (changed.length) await addCards(changed);
  const deckCountAfter = (await getAllDecks().catch(() => [])).length;
  return { cardsAssigned: changed.length, decksCreated: deckCountAfter - deckCountBefore };
}

// Pure tree helpers. Kept in this module so every surface (Library, Memory,
// Mindmap) builds the same forest from the same records.

export function sortDecksByCreated(decks = [], direction = "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return [...decks].sort((a, b) => {
    const createdDiff = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    if (createdDiff !== 0) return createdDiff * sign;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function buildDeckForest(decks = [], { direction = "desc" } = {}) {
  const nodes = sortDecksByCreated(decks, direction).map((deck) => ({
    ...deck,
    children: []
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Break cycles before attaching. A malformed parent chain must not swallow
  // every deck in the subject.
  for (const node of nodes) {
    let parentId = node.parentId;
    const seen = new Set([node.id]);
    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) {
        node.parentId = null;
        break;
      }
      seen.add(parentId);
      parentId = byId.get(parentId).parentId;
    }
  }

  const roots = [];
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function flattenDeckTree(forest = []) {
  const out = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      out.push({ ...node, depth });
      walk(node.children || [], depth + 1);
    }
  };
  walk(forest, 0);
  return out;
}

export function getDeckDescendantIds(decks = [], deckId) {
  const id = String(deckId || "");
  if (!id) return [];
  // A deck that is not in the store has no descendants. Without this guard a
  // missing id would be echoed back with any decks whose parentId matches it.
  if (!decks.some((deck) => String(deck.id) === id)) return [];
  const childMap = new Map();
  for (const deck of decks) {
    const parentId = deck.parentId ? String(deck.parentId) : "";
    if (!parentId) continue;
    if (!childMap.has(parentId)) childMap.set(parentId, []);
    childMap.get(parentId).push(deck.id);
  }
  const out = [];
  const seen = new Set();
  const walk = (current) => {
    if (seen.has(current)) return;
    seen.add(current);
    out.push(current);
    for (const child of childMap.get(current) || []) walk(child);
  };
  walk(id);
  return out;
}

export function groupDecksBySubject(decks = [], { direction = "desc", subjectsByKey } = {}) {
  const groups = new Map();
  for (const deck of decks) {
    const subject = String(deck.subject || "").trim();
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(deck);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupDecks]) => {
      const record = subjectsByKey?.get?.(key) || subjectsByKey?.[key];
      return {
        key,
        subjectId: record?.id || groupDecks[0]?.subjectId || "",
        subject: record?.name || key,
        level: record?.level || "",
        decks: buildDeckForest(groupDecks, { direction })
      };
    });
}

// ========== DECK DELETION ==========
//
// Deleting a deck is never silent. The caller confirms one of two modes:
//   move   - cards move to the parent deck (or the subject's Unsorted deck when
//            the deck is a root). Direct subdecks are reparented, so the subtree
//            survives.
//   delete - the whole subtree and every card inside it are removed.
//
// `describeDeckDeletion` is pure so the confirmation copy and the destructive
// operation always agree on the counts.

export function getDeckPath(decks = [], deckId) {
  const id = String(deckId || "");
  if (!id) return [];
  const byId = new Map(decks.map((deck) => [String(deck.id), deck]));
  const path = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    path.unshift(String(current.name || ""));
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return path;
}

export function describeDeckDeletion(decks = [], cards = [], deckId) {
  const id = String(deckId || "");
  const deck = decks.find((item) => String(item.id) === id);
  if (!deck) return null;

  const descendantDeckIds = getDeckDescendantIds(decks, id);
  const subtreeIds = new Set(descendantDeckIds);
  const subtreeCards = cards.filter((card) => subtreeIds.has(String(card.deckId || "")));
  const directCards = cards.filter((card) => String(card.deckId || "") === id);
  const childDecks = decks.filter((item) => String(item.parentId || "") === id);
  const parent = deck.parentId
    ? decks.find((item) => String(item.id) === String(deck.parentId)) || null
    : null;

  return {
    deck,
    parent,
    childDecks,
    directCards,
    subtreeCards,
    descendantDeckIds,
    counts: {
      directCards: directCards.length,
      subtreeCards: subtreeCards.length,
      childDecks: childDecks.length,
      decks: descendantDeckIds.length
    }
  };
}

export async function deleteDeck(deckId, { mode = "move" } = {}) {
  const id = String(deckId || "");
  if (!id) throw new Error("Deck id is required");

  const [decks, cards] = await Promise.all([getAllDecks(), getAllCards()]);
  const plan = describeDeckDeletion(decks, cards, id);
  if (!plan) throw new Error("Deck not found");
  if (plan.deck.name === UNSORTED_DECK_NAME && !plan.deck.parentId) {
    throw new Error("The Unsorted deck cannot be deleted");
  }

  if (mode === "delete") {
    for (const card of plan.subtreeCards) {
      await deleteCard(card.id);
    }
    for (const deck of [...plan.descendantDeckIds].reverse()) {
      await deleteDeckRecord(deck);
    }
    return { mode, deletedCards: plan.subtreeCards.length, deletedDecks: plan.descendantDeckIds.length };
  }

  const target = plan.parent || await findOrCreateUnsortedDeck(plan.deck.subject);
  const targetPath = getDeckPath(decks, target.id);
  const now = Date.now();

  for (const child of plan.childDecks) {
    await addDeck({
      ...child,
      parentId: plan.parent ? target.id : null,
      updatedAt: now
    });
  }

  if (plan.directCards.length) {
    await addCards(plan.directCards.map((card) => ({
      ...card,
      deckId: target.id,
      deckPath: targetPath.length ? targetPath : [plan.deck.subject, target.name].filter(Boolean),
      updatedAt: now
    })));
  }

  await deleteDeckRecord(id);
  return { mode, movedCards: plan.directCards.length, movedDecks: plan.childDecks.length };
}

// ========== HEAPS ==========
//
// A heap is metadata only: a named, ordered list of card IDs. It is not a
// deck, tag, or copy of card content. Card records remain the source of truth;
// IDs that no longer resolve are skipped by consumers.

function heapStoreExists() {
  return db && db.objectStoreNames.contains("heaps");
}

function normalizeHeapRecord(heap = {}) {
  const now = Date.now();
  const seen = new Set();
  const cardIds = [];
  for (const rawId of Array.isArray(heap.cardIds) ? heap.cardIds : []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cardIds.push(id);
  }

  return {
    ...heap,
    id: heap.id || crypto.randomUUID(),
    type: "heap",
    name: String(heap.name || "").trim() || "Untitled Heap",
    cardIds,
    createdAt: Number(heap.createdAt) || now,
    updatedAt: Number(heap.updatedAt) || now
  };
}

export function addHeap(heap) {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      reject(new Error("Heaps store not available"));
      return;
    }

    const record = normalizeHeapRecord(heap);
    const tx = db.transaction("heaps", "readwrite");
    const req = tx.objectStore("heaps").put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-heap", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addHeaps(heaps) {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      resolve([]);
      return;
    }

    const records = (heaps || []).map(normalizeHeapRecord);
    if (records.length === 0) {
      resolve([]);
      return;
    }

    const tx = db.transaction("heaps", "readwrite");
    const store = tx.objectStore("heaps");
    for (const record of records) store.put(record);
    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-heap", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllHeaps() {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("heaps", "readonly");
    const req = tx.objectStore("heaps").getAll();
    req.onsuccess = () => {
      const heaps = req.result || [];
      heaps.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      resolve(heaps);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function getHeap(id) {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      resolve(null);
      return;
    }

    const tx = db.transaction("heaps", "readonly");
    const req = tx.objectStore("heaps").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteHeap(id) {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      resolve(id);
      return;
    }

    const tx = db.transaction("heaps", "readwrite");
    const req = tx.objectStore("heaps").delete(id);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-heap", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearHeaps() {
  return new Promise((resolve, reject) => {
    if (!db || !heapStoreExists()) {
      resolve();
      return;
    }

    const tx = db.transaction("heaps", "readwrite");
    const req = tx.objectStore("heaps").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "heaps" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
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

function readAll(storeName) {
  return new Promise((resolve, reject) => { const tx = db.transaction(storeName, "readonly"); const req = tx.objectStore(storeName).getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error); });
}
function writeRows(storeName, rows, mode = "readwrite") {
  return new Promise((resolve, reject) => { const tx = db.transaction(storeName, mode); const store = tx.objectStore(storeName); for (const row of rows) store.put(row); tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}
export async function getAllSubjects() { return (await readAll("subjects")).sort(compareSubjectRecords); }
export async function getSubject(id) { const all = await getAllSubjects(); return all.find((s) => s.id === id) || null; }
export async function getSubjectByKey(key) { const all = await getAllSubjects(); return all.find((s) => subjectKeyMatches(s.key, key)) || null; }
export async function resolveSubject(idOrKey) { return await getSubject(idOrKey) || await getSubjectByKey(idOrKey); }
export async function getSubjects() { return getAllSubjects(); }
export async function addSubjects(records = []) { return writeRows("subjects", records.map((record) => ({ ...record, keyNorm: String(record.key || "").trim().toLocaleLowerCase() }))); }
export async function clearSubjects() { return new Promise((resolve, reject) => { const tx = db.transaction("subjects", "readwrite"); tx.objectStore("subjects").clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
export async function addSubject(nameOrOptions) {
  const parsed = typeof nameOrOptions === "string" ? parseSubjectName(nameOrOptions) : { name: nameOrOptions?.name || "", level: nameOrOptions?.level || "" };
  const key = subjectKey(parsed.name, parsed.level); if (!key) throw new Error("Subject name is required");
  const existing = await getSubjectByKey(key); if (existing) return existing;
  // Subject order is global (setSubjectOrder rewrites every row), so append
  // after the highest existing order. Counting rows in the same level would
  // collide after a delete or with imported non-contiguous orders.
  const order = (await getAllSubjects()).reduce((max, subject) => Math.max(max, Number(subject.order) || 0), -1) + 1;
  const now = Date.now(); const record = { ...createSubjectRecord({ ...parsed, key, order }), id: `subj_${crypto.randomUUID()}`, createdAt: now, updatedAt: now };
  await addSubjects([record]);
  await addNode({ id: `subject-${record.id}`, type: "subject", subject: key, subjectId: record.id, name: key, level: record.level, createdAt: now, updatedAt: now });
  try { await findOrCreateUnsortedDeck(key, record.id); } catch (error) { console.warn("[DECKS] could not create Unsorted deck for subject:", error); }
  return record;
}
export async function setSubjectOrder(orderedIds = []) { const records = await getAllSubjects(); const byId = new Map(records.map((s) => [s.id, s])); await addSubjects(orderedIds.map((id, order) => byId.has(id) ? { ...byId.get(id), order, updatedAt: Date.now() } : null).filter(Boolean)); }
export async function renameSubject(idOrKey, newNameOrOptions) {
  const record = await resolveSubject(idOrKey); if (!record) return null;
  const next = typeof newNameOrOptions === "string" ? { ...record, ...parseSubjectName(newNameOrOptions) } : { ...record, name: newNameOrOptions?.name ?? record.name, level: newNameOrOptions?.level ?? record.level };
  const nextKey = subjectKey(next.name, next.level); const other = await getSubjectByKey(nextKey);
  if (other && other.id !== record.id) { const error = new Error("A subject with this name and level already exists"); error.code = "SUBJECT_KEY_EXISTS"; throw error; }
  const now = Date.now(); const updated = { ...record, name: next.name, level: next.level, key: nextKey, updatedAt: now }; await addSubjects([updated]);
  const [nodes, quotes, cues, cards, decks] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  await Promise.all([
    addNodes(nodes.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.subject, record.key))).map((r) => ({ ...r, subjectId: record.id, subject: r.subject === record.key ? nextKey : r.subject, name: r.type === "subject" ? nextKey : r.name, title: r.type === "subject" ? nextKey : r.title, meta: r.meta?.hierarchyPath ? { ...r.meta, hierarchyPath: [nextKey, ...r.meta.hierarchyPath.slice(1)] } : r.meta, updatedAt: now }))),
    addQuotes(quotes.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.subject, record.key))).map((r) => ({ ...r, subjectId: record.id, subject: nextKey, meta: r.meta?.hierarchyPath ? { ...r.meta, hierarchyPath: [nextKey, ...r.meta.hierarchyPath.slice(1)] } : r.meta, updatedAt: now }))),
    addCues(cues.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.subject, record.key))).map((r) => ({ ...r, subjectId: record.id, subject: nextKey, updatedAt: now }))),
    addCards(cards.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.deck, record.key))).map((r) => ({ ...r, subjectId: record.id, deck: r.deck === record.key ? nextKey : r.deck, deckPath: (r.deckPath || []).map((v, i) => i === 0 && v === record.key ? nextKey : v), updatedAt: now }))),
    addDecks(decks.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.subject, record.key))).map((r) => ({ ...r, subjectId: record.id, subject: nextKey, updatedAt: now })))
  ]); return updated;
}
export async function setSubjectLevel(id, level) { const subject = await getSubject(id); return subject ? renameSubject(id, { name: subject.name, level }) : null; }
export async function deleteSubject(idOrKey) {
  const subject = await resolveSubject(idOrKey); if (!subject) return null; const key = subject.key;
  const [nodes, quotes, cues, cards, decks] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  await Promise.all([
    ...cards.filter((r) => r.subjectId === subject.id || (!r.subjectId && subjectKeyMatches(r.deck, key))).map((r) => deleteCard(r.id)),
    ...decks.filter((r) => r.subjectId === subject.id || (!r.subjectId && subjectKeyMatches(r.subject, key))).map((r) => deleteDeckRecord(r.id)),
    ...nodes.filter((r) => r.subjectId === subject.id || (!r.subjectId && subjectKeyMatches(r.subject, key))).map((r) => deleteNode(r.id)),
    ...quotes.filter((r) => r.subjectId === subject.id || (!r.subjectId && subjectKeyMatches(r.subject, key))).map((r) => deleteQuote(r.id)),
    ...cues.filter((r) => r.subjectId === subject.id || (!r.subjectId && subjectKeyMatches(r.subject, key))).map((r) => deleteCue(r.id))
  ]);
  await new Promise((resolve, reject) => { const tx = db.transaction("subjects", "readwrite"); tx.objectStore("subjects").delete(subject.id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); return subject;
}
export async function mergeSubjects(sourceId, targetId) {
  const source = await resolveSubject(sourceId); const target = await resolveSubject(targetId); if (!source || !target || source.id === target.id) return target;
  const [nodes, quotes, cues, cards, decks] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  const sourceUnsorted = decks.find((d) => d.subjectId === source.id && !d.parentId && d.name === UNSORTED_DECK_NAME);
  const targetUnsorted = decks.find((d) => d.subjectId === target.id && !d.parentId && d.name === UNSORTED_DECK_NAME);
  await Promise.all([addNodes(nodes.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key, name: r.type === "subject" ? target.key : r.name }))), addQuotes(quotes.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key }))), addCues(cues.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key }))), addCards(cards.filter((r) => r.subjectId === source.id || (!r.subjectId && r.deck === source.key)).map((r) => ({ ...r, subjectId: target.id, deck: target.key }))), addDecks(decks.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key }))) ]);
  // Both subjects usually have a root "Unsorted" deck. After the move they
  // would appear as two identical roots in Memory, so fold the source one into
  // the target's deck and keep every card.
  if (sourceUnsorted && targetUnsorted && sourceUnsorted.id !== targetUnsorted.id) {
    const now = Date.now();
    const orphanCards = (await getAllCards()).filter((card) => card.deckId === sourceUnsorted.id);
    if (orphanCards.length) await addCards(orphanCards.map((card) => ({ ...card, deckId: targetUnsorted.id, deckPath: [target.key, targetUnsorted.name], updatedAt: now })));
    const childDecks = (await getAllDecks()).filter((deck) => deck.parentId === sourceUnsorted.id);
    for (const child of childDecks) await addDeck({ ...child, parentId: targetUnsorted.id, updatedAt: now });
    await deleteDeckRecord(sourceUnsorted.id);
  }
  await new Promise((resolve, reject) => { const tx = db.transaction("subjects", "readwrite"); tx.objectStore("subjects").delete(source.id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  const node = (await getAllNodes()).find((r) => r.id === `subject-${source.id}`); if (node) await deleteNode(node.id); return target;
}
export async function ensureSubjectIdentity() {
  const [subjects, nodes, quotes, cues, cards, decks] = await Promise.all([getAllSubjects(), getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  const migrated = migrateSubjectIdentity({ nodes, quotes, cues, cards, decks }); const byKey = new Map(subjects.map((s) => [s.key.toLocaleLowerCase(), s]));
  for (const candidate of migrated.subjects) if (!byKey.has(candidate.key.toLocaleLowerCase())) { const s = { ...candidate, id: `subj_${crypto.randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now() }; await addSubjects([s]); byKey.set(s.key.toLocaleLowerCase(), s); }
  const idByKey = new Map([...byKey.values()].map((s) => [s.key.toLocaleLowerCase(), s.id]));
  for (const [store, rows, owner] of [["nodes", nodes, "subject"], ["quotes", quotes, "subject"], ["cues", cues, "subject"], ["cards", cards, "deck"], ["decks", decks, "subject"]]) { const changed = rows.map((r) => { const k = String(r[owner] || r.meta?.hierarchyPath?.[0] || r.deckPath?.[0] || "").trim(); const id = r.subjectId || idByKey.get(k.toLocaleLowerCase()); return id && id !== r.subjectId ? { ...r, subjectId: id } : null; }).filter(Boolean); if (changed.length) await writeRows(store, changed); }
  for (const s of await getAllSubjects()) if (!(await getAllNodes()).some((n) => n.type === "subject" && n.subjectId === s.id)) await addNode({ id: `subject-${s.id}`, type: "subject", subject: s.key, subjectId: s.id, name: s.key, level: s.level, createdAt: s.createdAt, updatedAt: s.updatedAt });
  return getAllSubjects();
}
export async function getQuotesForSubjectId(id) { return (await getAllQuotes()).filter((r) => r.subjectId === id); }
export async function getAnalysisNodesForSubjectId(id) { return (await getAllNodes()).filter((r) => r.subjectId === id && r.type === "analysis"); }
export async function getDueQuotesForSubjectId(id, options) { const { now = Date.now(), limit = 200 } = options || {}; return (await getQuotesForSubjectId(id)).filter((r) => Number(r.meta?.nextReview || 0) <= now).slice(0, limit); }
export async function getDueAnalysisNodesForSubjectId(id, options) { const { now = Date.now(), limit = 200 } = options || {}; return (await getAnalysisNodesForSubjectId(id)).filter((r) => Number(r.meta?.nextReview || 0) <= now).slice(0, limit); }
export async function getCuesForSubjectId(id) { return (await getAllCues()).filter((r) => r.subjectId === id); }
export async function getDecksForSubjectId(id) { return (await getAllDecks()).filter((r) => r.subjectId === id); }
export async function getCardsForSubjectId(id) { return (await getAllCards()).filter((r) => r.subjectId === id); }
export async function getDueCardsForSubjectId(id, options) { const { now = Date.now(), limit = 200 } = options || {}; return (await getCardsForSubjectId(id)).filter((r) => Number(r.meta?.nextReview || 0) <= now).slice(0, limit); }

// ========== TAGS ==========

function tagStoreExists() {
  return db && db.objectStoreNames.contains("tags");
}

export function addTag(tag) {
  return new Promise((resolve, reject) => {
    if (!db || !tagStoreExists()) {
      reject(new Error("Tags store not available"));
      return;
    }

    const record = {
      ...tag,
      id: tag.id || `tag-${tag.title.toLowerCase().replace(/\s+/g, "-")}`,
      type: "tag",
      createdAt: tag.createdAt || Date.now(),
      updatedAt: tag.updatedAt || Date.now()
    };

    const tx = db.transaction("tags", "readwrite");
    const store = tx.objectStore("tags");
    const req = store.put(record);

    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-tag", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function getAllTags() {
  return new Promise((resolve, reject) => {
    if (!db || !tagStoreExists()) {
      resolve([]);
      return;
    }
    const tx = db.transaction("tags", "readonly");
    const req = tx.objectStore("tags").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteTag(id) {
  return new Promise((resolve, reject) => {
    if (!db || !tagStoreExists()) {
      reject(new Error("Tags store not available"));
      return;
    }
    const tx = db.transaction("tags", "readwrite");
    const store = tx.objectStore("tags");
    store.delete(id);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-tag", ids: [id] });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function clearTags() {
  return new Promise((resolve, reject) => {
    if (!db || !tagStoreExists()) {
      resolve();
      return;
    }

    const tx = db.transaction("tags", "readwrite");
    const req = tx.objectStore("tags").clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "tags" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== SSS (Semantic Search System) ENGINE ==========

function escapeHtmlForDB(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolves the precise start and end indices of a quote in a source text.
 * Falls back to semantic anchoring if the original indices are invalid.
 */
export function resolveQuoteInSource(quoteNode, sourceNode) {
  if (!quoteNode || !sourceNode) return null;

  const sourceText = sourceNode.contentText || "";
  const quoteText = quoteNode.quote || "";
  const originalStart = Number(quoteNode.link?.start ?? -1);
  const originalEnd = Number(quoteNode.link?.end ?? -1);

  // Support both nested context and direct prefix/suffix
  const prefix = quoteNode.link?.prefix || quoteNode.link?.context?.prefix || "";
  const suffix = quoteNode.link?.suffix || quoteNode.link?.context?.suffix || "";

  if (!quoteText) return null;

  const matchesExactly = (text, start, end) => {
    if (start >= 0 && end <= text.length && end > start) {
      return text.substring(start, end).trim() === quoteText.trim();
    }
    return false;
  };

  // 1. Try exact original position in sourceText
  if (matchesExactly(sourceText, originalStart, originalEnd)) {
    return { start: originalStart, end: originalEnd };
  }

  // 2. Semantic Search using prefix and suffix in sourceText
  if (prefix || suffix) {
    const searchString = `${prefix}${quoteText}${suffix}`;
    let matchIdx = sourceText.indexOf(searchString);

    if (matchIdx !== -1) {
      const newStart = matchIdx + prefix.length;
      return { start: newStart, end: newStart + quoteText.length };
    }
  } else if (matchesExactly(sourceText, originalStart, originalEnd)) {
     return { start: originalStart, end: originalEnd };
  }

  // 3. Fallback to basic text search (find closest match to original start)
  let bestStart = -1;
  let minDiff = Infinity;
  let currentIdx = sourceText.indexOf(quoteText);

  while (currentIdx !== -1) {
    const diff = Math.abs(currentIdx - Math.max(0, originalStart));
    if (diff < minDiff) {
      minDiff = diff;
      bestStart = currentIdx;
    }
    currentIdx = sourceText.indexOf(quoteText, currentIdx + 1);
  }

  if (bestStart !== -1) {
    return { start: bestStart, end: bestStart + quoteText.length };
  }

  return null;
}

/**
 * Extracts rich HTML formatting from a source document using SSS.
 * Falls back to correctly formatted plain text with <br> tags.
 */
export function getFormattedQuote(quoteNode, sourceNode) {
  const quoteText = quoteNode.quote || "";

  const formatFallback = (text) => {
    return escapeHtmlForDB(text).replace(/\n/g, "<br>");
  };

  if (!sourceNode || !sourceNode.contentHtml) {
    return formatFallback(quoteText);
  }

  const temp = document.createElement("div");
  temp.innerHTML = sourceNode.contentHtml;
  const visualText = temp.textContent || "";

  const prefix = quoteNode.link?.prefix || quoteNode.link?.context?.prefix || "";
  const suffix = quoteNode.link?.suffix || quoteNode.link?.context?.suffix || "";

  // Helper to find offsets in visual text (textContent)
  const resolveVisualOffsets = () => {
    const stripped = (s) => s.replace(/\s+/g, "").toLowerCase();
    const quoteKey = stripped(quoteText);
    // 1. Trust the stored link window first. Migrations and the source
    //    editor re-anchor every quote against THIS document's textContent
    //    (sourceNode.contentText is exactly this rendered html's textContent),
    //    so link.start/end give the true character range. For a glued legacy
    //    quote such as "Third WitchThere to meet with Macbeth." that window is
    //    the bold name, its newline and the quote in one clean slice.
    const os = Number(quoteNode.link?.start ?? -1);
    const oe = Number(quoteNode.link?.end ?? -1);
    if (quoteKey && os >= 0 && oe > os && oe <= visualText.length) {
      const sliceKey = stripped(visualText.substring(os, oe));
      // Accept when the window is exactly the quote, or the quote is embedded
      // in it (a glued legacy quote's window = name + newline + quote).
      if (sliceKey === quoteKey || sliceKey.includes(quoteKey)) {
        return { start: os, end: oe };
      }
    }
    // 2. Try fingerprint
    if (prefix || suffix) {
      const searchString = `${prefix}${quoteText}${suffix}`;
      const idx = visualText.indexOf(searchString);
      if (idx !== -1) {
        return { start: idx + prefix.length, end: idx + prefix.length + quoteText.length };
      }
    }
    // 3. Try raw quote
    const rawIdx = visualText.indexOf(quoteText);
    if (rawIdx !== -1) {
       return { start: rawIdx, end: rawIdx + quoteText.length };
    }
    // 4. Fall back to the DB semantic search
    const dbResolved = resolveQuoteInSource(quoteNode, sourceNode);
    return dbResolved;
  };

  const resolved = resolveVisualOffsets();

  if (!resolved) {
    return formatFallback(quoteText);
  }

  let { start, end } = resolved;

  // CRITICAL: Trim leading/trailing whitespace from indices to avoid gaps in cards
  while (start < end && /\s/.test(visualText[start])) start++;
  while (end > start && /\s/.test(visualText[end - 1])) end--;

  // Extract with basic textContent walker (standard indexing)
  let currentPos = 0;
  const parts = [];
  let lastNodeWasBlock = false;
  const blockTags = new Set(["P", "DIV", "BLOCKQUOTE", "H1", "H2", "H3", "UL", "OL", "LI", "BR"]);

  function walk(node) {
    if (currentPos >= end) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || "";
      const nodeStart = currentPos;
      const nodeEnd = currentPos + text.length;

      if (nodeEnd > start && nodeStart < end) {
        // If we just entered a block and have previous content, add a break
        if (lastNodeWasBlock && parts.length > 0) {
           parts.push("<br>");
           lastNodeWasBlock = false;
        }

        const sliceStart = Math.max(0, start - nodeStart);
        const sliceEnd = Math.min(text.length, end - nodeStart);
        const slice = text.slice(sliceStart, sliceEnd);

        let parent = node.parentElement;
        let hasBold = false;
        let hasItalic = false;
        while (parent && parent !== temp) {
          const tag = parent.tagName?.toUpperCase();
          if (tag === "B" || tag === "STRONG") hasBold = true;
          if (tag === "I" || tag === "EM") hasItalic = true;
          parent = parent.parentElement;
        }

        let formatted = escapeHtmlForDB(slice);
        if (hasBold) formatted = `<strong>${formatted}</strong>`;
        if (hasItalic) formatted = `<em>${formatted}</em>`;
        parts.push(formatted);
      }
      currentPos = nodeEnd;
      lastNodeWasBlock = false;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toUpperCase();
      const isBlock = blockTags.has(tag);

      if (isBlock && currentPos >= start && currentPos < end && parts.length > 0) {
        lastNodeWasBlock = true;
      }

      for (const child of node.childNodes) {
        walk(child);
      }

      // Also check after children for block closure if it helps
      if (isBlock && currentPos >= start && currentPos < end) {
        lastNodeWasBlock = true;
      }
    }
  }

  walk(temp);

  // Join and trim leading/trailing breaks/whitespace
  let result = parts.join("");

  // Clean up: remove leading/trailing <br> tags and excess whitespace,
  // and collapse the walker's duplicate <br>s at block boundaries (the
  // reader emits leading/trailing newlines inside each block element) so
  // "Name<br>\n<br>\n<br>quote" renders as clean "Name<br>quote".
  result = result.replace(/^(<br>|\s)+/gi, "").replace(/(<br>|\s)+$/gi, "");
  result = result.replace(/(<br>\s*)+/gi, "<br>");

  if (!result.trim()) {
     return formatFallback(quoteText);
   }
  return result;
}
