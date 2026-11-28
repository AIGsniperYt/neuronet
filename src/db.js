import { createSubjectRecord, parseSubjectName, subjectKey, subjectKeyMatches, migrateSubjectIdentity, compareSubjectRecords } from "./subjectModel.js";
let db;

// Structural schema only: store/index creation. Data-shape changes are handled
// on write (promoteTags / promoteStudyPriority) and old profiles are reset by
// importing the committed demo dataset, not migrated in place.
const DB_VERSION = 20;

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

const SYNC_COLLECTIONS = new Set(["nodes","quotes","cues","cards","heaps","decks","subjects","tasks","commitments"]);
function syncRecordKey(collection, recordId) { return collection + "\u001f" + String(recordId); }
function mutationTransaction(storeName) {
  const names = Array.isArray(storeName) ? storeName : [storeName];
  const stores = new Set(names);
  if (names.some((name) => SYNC_COLLECTIONS.has(name))) stores.add("syncOutbox");
  if (names.some((name) => name === "cards" || name === "tasks")) stores.add("activityEvents");
  return db.transaction([...stores], "readwrite");
}

function localActivityDay(timestamp = Date.now()) {
  const date = new Date(Number(timestamp) || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function queueActivityEvent(tx, kind, recordId, timestamp = Date.now(), uniquePerRecordDay = true) {
  const occurredAt = Number(timestamp) || Date.now();
  const day = localActivityDay(occurredAt);
  const id = uniquePerRecordDay
    ? JSON.stringify([day, kind, String(recordId)])
    : crypto.randomUUID();
  tx.objectStore("activityEvents").put({
    id,
    day,
    kind,
    recordId: String(recordId),
    occurredAt,
    timezoneOffsetMinutes: new Date(occurredAt).getTimezoneOffset()
  });
}

function cardContentChanged(previous, next) {
  const signature = (record) => ({
    front: String(record?.front || ""),
    back: String(record?.back || ""),
    tags: [...(Array.isArray(record?.tags) ? record.tags : [])].map(String).sort(),
    links: stableSyncValue(record?.links || {})
  });
  return JSON.stringify(signature(previous)) !== JSON.stringify(signature(next));
}
function queueSyncUpsert(tx, collection, record) {
  if (!SYNC_COLLECTIONS.has(collection) || !record?.id) return;
  const recordId = String(record.id);
  const key = syncRecordKey(collection, recordId);
  const store = tx.objectStore("syncOutbox");
  const existing = store.get(key);
  existing.onsuccess = () => {
    // A conflicted operation remains blocked until the user resolves it.
    // New local edits replace its payload but must not silently retry it.
    store.put({
      key,
      collection,
      recordId,
      operationId: crypto.randomUUID(),
      type: "upsert",
      payload: record,
      queuedAt: Date.now(),
      firstQueuedAt: Number(existing.result?.firstQueuedAt || existing.result?.queuedAt) || Date.now(),
      ...(existing.result?.blocked ? { blocked: true } : {})
    });
  };
}
function queueSyncDelete(tx, collection, recordId) {
  if (!SYNC_COLLECTIONS.has(collection) || recordId == null) return;
  const id = String(recordId);
  const key = syncRecordKey(collection, id);
  const store = tx.objectStore("syncOutbox");
  const existing = store.get(key);
  existing.onsuccess = () => {
    store.put({
      key,
      collection,
      recordId: id,
      operationId: crypto.randomUUID(),
      type: "delete",
      payload: null,
      queuedAt: Date.now(),
      firstQueuedAt: Number(existing.result?.firstQueuedAt || existing.result?.queuedAt) || Date.now(),
      ...(existing.result?.blocked ? { blocked: true } : {})
    });
  };
}
function queueSyncClear(tx, collection, recordStore) {
  if (!SYNC_COLLECTIONS.has(collection)) return;
  const request = recordStore.getAll();
  request.onsuccess = () => { for (const record of request.result || []) queueSyncDelete(tx, collection, record.id); };
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

      if (!db.objectStoreNames.contains("subjects")) {
        const subjectsStore = db.createObjectStore("subjects", { keyPath: "id" });
        subjectsStore.createIndex("key", "key", { unique: true });
        subjectsStore.createIndex("keyNorm", "keyNorm", { unique: true });
        subjectsStore.createIndex("name", "name", { unique: false });
        subjectsStore.createIndex("level", "level", { unique: false });
        subjectsStore.createIndex("order", "order", { unique: false });
        // Existing subject rows are rebuilt at startup by
        // ensureSubjectIdentity(), so this store starts empty on an upgrade.
      }

      if (!db.objectStoreNames.contains("heaps")) {
        const heapStore = db.createObjectStore("heaps", { keyPath: "id" });
        heapStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("tasks")) {
        const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
        taskStore.createIndex("done", "done", { unique: false });
        taskStore.createIndex("dueDate", "dueDate", { unique: false });
        taskStore.createIndex("subjectId", "subjectId", { unique: false });
        taskStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("commitments")) {
        const commitmentStore = db.createObjectStore("commitments", { keyPath: "id" });
        commitmentStore.createIndex("subjectId", "subjectId", { unique: false });
        commitmentStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // STUB: personal journal entries live in IndexedDB for now. The planned
      // storage overhaul moves user-owned data to the PC/file system; keep this
      // store thin and replace the journal accessors (not the UI) when it lands.
      if (!db.objectStoreNames.contains("journals")) {
        const journalStore = db.createObjectStore("journals", { keyPath: "id" });
        journalStore.createIndex("createdAt", "createdAt", { unique: false });
        journalStore.createIndex("updatedAt", "updatedAt", { unique: false });
        journalStore.createIndex("insight", "insight", { unique: false });
      }
      if (!db.objectStoreNames.contains("activityEvents")) {
        const activityStore = db.createObjectStore("activityEvents", { keyPath: "id" });
        activityStore.createIndex("day", "day", { unique: false });
        activityStore.createIndex("kind", "kind", { unique: false });
        activityStore.createIndex("occurredAt", "occurredAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("syncOutbox")) db.createObjectStore("syncOutbox", { keyPath: "key" });
      if (!db.objectStoreNames.contains("syncMeta")) db.createObjectStore("syncMeta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("syncState")) db.createObjectStore("syncState", { keyPath: "key" });
      if (!db.objectStoreNames.contains("syncConflicts")) db.createObjectStore("syncConflicts", { keyPath: "key" });
      if (!db.objectStoreNames.contains("syncSnapshotRecords")) {
        const snapshotStore = db.createObjectStore("syncSnapshotRecords", { keyPath: "key" });
        snapshotStore.createIndex("snapshotId", "snapshotId", { unique: false });
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
    if (record.type === "analysis" || record.type === "cue") promoteStudyPriority(record);
    promoteTags(record);

    const tx = mutationTransaction("nodes");
    const store = tx.objectStore("nodes");
    queueSyncUpsert(tx, "nodes", record);
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

    const records = (nodes || []).map((node) => {
      const record = {
        ...node,
        id: node.id || crypto.randomUUID()
      };
      if (record.type === "analysis" || record.type === "cue") promoteStudyPriority(record);
      promoteTags(record);
      return record;
    });

    const tx = mutationTransaction("nodes");
    const store = tx.objectStore("nodes");

    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "nodes", record);
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

    const tx = mutationTransaction("nodes");
    const store = tx.objectStore("nodes");
    queueSyncDelete(tx, "nodes", id);
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

    const tx = mutationTransaction("nodes");
    const store = tx.objectStore("nodes");
    queueSyncClear(tx, "nodes", store);
    const req = store.clear();
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
    promoteTags(record);

    const tx = mutationTransaction("quotes");
    const store = tx.objectStore("quotes");
    queueSyncUpsert(tx, "quotes", record);
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
    records.forEach(promoteTags);

    const tx = mutationTransaction("quotes");
    const store = tx.objectStore("quotes");

    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "quotes", record);
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

    const tx = mutationTransaction("quotes");
    const store = tx.objectStore("quotes");
    queueSyncDelete(tx, "quotes", id);
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

    const tx = mutationTransaction("quotes");
    const store = tx.objectStore("quotes");
    queueSyncClear(tx, "quotes", store);
    const req = store.clear();
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
    promoteStudyPriority(record);
    promoteTags(record);

    const tx = mutationTransaction("cues");
    const store = tx.objectStore("cues");
    queueSyncUpsert(tx, "cues", record);
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

    const records = (cues || []).map((cue) => {
      const record = {
        ...cue,
        id: cue.id || crypto.randomUUID(),
        type: "cue"
      };
      promoteStudyPriority(record);
      promoteTags(record);
      return record;
    });

    const tx = mutationTransaction("cues");
    const store = tx.objectStore("cues");

    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "cues", record);
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

    const tx = mutationTransaction("cues");
    const store = tx.objectStore("cues");
    queueSyncDelete(tx, "cues", id);
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

    const tx = mutationTransaction("cues");
    const store = tx.objectStore("cues");
    queueSyncClear(tx, "cues", store);
    const req = store.clear();
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

    const tx = mutationTransaction("cues");
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
      queueSyncUpsert(tx, "cues", cue);
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

// Schema 10: explicit importance is a first-class field on analyses and cues,
// the same way it already is on cards and quotes. A missing value means
// "inherit from links", so nothing is defaulted here — inventing a 3 would
// make every inherited item look manually rated.
function normalizeStudyPriority(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function promoteStudyPriority(record) {
  const priority = normalizeStudyPriority(record.priority ?? record.meta?.priority);
  if (priority) record.priority = priority;
  else delete record.priority;
  if (record.meta && typeof record.meta === "object" && "priority" in record.meta) {
    const meta = { ...record.meta };
    delete meta.priority;
    record.meta = meta;
  }
  return record;
}

// Tags are a first-class field on every study record, not metadata. Cards were
// normalized first; this folds the older `meta.tags` location in for nodes,
// quotes and cues so there is exactly one place to read and write them.
export function promoteTags(record) {
  if (!record || typeof record !== "object") return record;
  const merged = [
    ...(Array.isArray(record.tags) ? record.tags : []),
    ...(Array.isArray(record.meta?.tags) ? record.meta.tags : [])
  ];
  const tags = [...new Set(merged.map((tag) => String(tag || "").trim()).filter(Boolean))];
  if (tags.length) record.tags = tags;
  else delete record.tags;
  if (record.meta && typeof record.meta === "object" && "tags" in record.meta) {
    const meta = { ...record.meta };
    delete meta.tags;
    record.meta = meta;
  }
  return record;
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

export async function addCard(card, options = {}) {
  if (!db || !cardStoreExists()) {
    throw new Error("Cards store not available");
  }

  const record = normalizeCardRecord(card);
  if (!record.front || !record.back) {
    throw new Error("Card requires both a front and a back");
  }
  await assignDeckIdsToCards([record]);

  return new Promise((resolve, reject) => {
    const tx = mutationTransaction("cards");
    const store = tx.objectStore("cards");
    const existing = store.get(record.id);
    existing.onsuccess = () => {
      if (!existing.result) queueActivityEvent(tx, "card-created", record.id);
      else if (cardContentChanged(existing.result, record)) queueActivityEvent(tx, "card-revised", record.id);
      if (options.activity === "review") queueActivityEvent(tx, "card-reviewed", record.id, Date.now(), false);
    };
    queueSyncUpsert(tx, "cards", record);
    const req = store.put(record);
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
    const tx = mutationTransaction("cards");
    const store = tx.objectStore("cards");
    for (const record of records) {
      const existing = store.get(record.id);
      existing.onsuccess = () => {
        if (!existing.result) queueActivityEvent(tx, "card-created", record.id);
        else if (cardContentChanged(existing.result, record)) queueActivityEvent(tx, "card-revised", record.id);
      };
      store.put(record);
      queueSyncUpsert(tx, "cards", record);
    }

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

    const tx = mutationTransaction("cards");
    queueSyncDelete(tx, "cards", id);
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

    const tx = mutationTransaction("cards");
    const store = tx.objectStore("cards");
    queueSyncClear(tx, "cards", store);
    const req = store.clear();
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
    const tx = mutationTransaction("decks");
    queueSyncUpsert(tx, "decks", record);
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

    const tx = mutationTransaction("decks");
    const store = tx.objectStore("decks");
    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "decks", record);
    }

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

    const tx = mutationTransaction("decks");
    queueSyncDelete(tx, "decks", id);
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

    const tx = mutationTransaction("decks");
    const store = tx.objectStore("decks");
    queueSyncClear(tx, "decks", store);
    const req = store.clear();
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
    const tx = mutationTransaction("heaps");
    queueSyncUpsert(tx, "heaps", record);
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

    const tx = mutationTransaction("heaps");
    const store = tx.objectStore("heaps");
    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "heaps", record);
    }
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

    const tx = mutationTransaction("heaps");
    queueSyncDelete(tx, "heaps", id);
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

    const tx = mutationTransaction("heaps");
    const store = tx.objectStore("heaps");
    queueSyncClear(tx, "heaps", store);
    const req = store.clear();
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
  return new Promise((resolve, reject) => { const tx = mode === "readwrite" && SYNC_COLLECTIONS.has(storeName) ? mutationTransaction(storeName) : db.transaction(storeName, mode); const store = tx.objectStore(storeName); for (const row of rows) { store.put(row); queueSyncUpsert(tx, storeName, row); } tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}
export async function getAllSubjects() { return (await readAll("subjects")).sort(compareSubjectRecords); }
export async function getSubject(id) { const all = await getAllSubjects(); return all.find((s) => s.id === id) || null; }
export async function getSubjectByKey(key) { const all = await getAllSubjects(); return all.find((s) => subjectKeyMatches(s.key, key)) || null; }
export async function resolveSubject(idOrKey) { return await getSubject(idOrKey) || await getSubjectByKey(idOrKey); }
export async function getSubjects() { return getAllSubjects(); }
export async function addSubjects(records = []) { return writeRows("subjects", records.map((record) => ({ ...record, keyNorm: String(record.key || "").trim().toLocaleLowerCase() }))); }
export async function clearSubjects() { return new Promise((resolve, reject) => { const tx = mutationTransaction("subjects"); const store = tx.objectStore("subjects"); queueSyncClear(tx, "subjects", store); store.clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
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
  await addNode({ id: `subject-${record.id}`, type: "subject", subject: key, subjectId: record.id, name: record.name, level: record.level, createdAt: now, updatedAt: now });
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
    addNodes(nodes.filter((r) => r.subjectId === record.id || (!r.subjectId && subjectKeyMatches(r.subject, record.key))).map((r) => {
      const subjectNode = r.type === "subject";
      return {
        ...r,
        subjectId: record.id,
        subject: nextKey,
        ...(subjectNode ? { name: next.name, title: next.name, level: next.level } : {}),
        meta: r.meta?.hierarchyPath ? { ...r.meta, hierarchyPath: [nextKey, ...r.meta.hierarchyPath.slice(1)] } : r.meta,
        updatedAt: now
      };
    })),
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
  await new Promise((resolve, reject) => { const tx = mutationTransaction("subjects"); queueSyncDelete(tx, "subjects", subject.id); tx.objectStore("subjects").delete(subject.id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); return subject;
}
export async function mergeSubjects(sourceId, targetId) {
  const source = await resolveSubject(sourceId); const target = await resolveSubject(targetId); if (!source || !target || source.id === target.id) return target;
  const [nodes, quotes, cues, cards, decks] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  const sourceUnsorted = decks.find((d) => d.subjectId === source.id && !d.parentId && d.name === UNSORTED_DECK_NAME);
  const targetUnsorted = decks.find((d) => d.subjectId === target.id && !d.parentId && d.name === UNSORTED_DECK_NAME);
  await Promise.all([
    addNodes(nodes.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => {
      const subjectNode = r.type === "subject";
      return {
        ...r,
        subjectId: target.id,
        subject: target.key,
        ...(subjectNode ? { name: target.name, title: target.name, level: target.level } : {}),
        meta: r.meta?.hierarchyPath ? { ...r.meta, hierarchyPath: [target.key, ...r.meta.hierarchyPath.slice(1)] } : r.meta
      };
    })),
    addQuotes(quotes.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key, meta: r.meta?.hierarchyPath ? { ...r.meta, hierarchyPath: [target.key, ...r.meta.hierarchyPath.slice(1)] } : r.meta }))),
    addCues(cues.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key }))),
    addCards(cards.filter((r) => r.subjectId === source.id || (!r.subjectId && r.deck === source.key)).map((r) => ({ ...r, subjectId: target.id, deck: target.key, deckPath: (r.deckPath || []).map((v, i) => i === 0 && v === source.key ? target.key : v) }))),
    addDecks(decks.filter((r) => r.subjectId === source.id || (!r.subjectId && r.subject === source.key)).map((r) => ({ ...r, subjectId: target.id, subject: target.key })))
  ]);
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
  await new Promise((resolve, reject) => { const tx = mutationTransaction("subjects"); queueSyncDelete(tx, "subjects", source.id); tx.objectStore("subjects").delete(source.id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  const node = (await getAllNodes()).find((r) => r.id === `subject-${source.id}`); if (node) await deleteNode(node.id); return target;
}
export async function ensureSubjectIdentity() {
  const [subjects, nodes, quotes, cues, cards, decks] = await Promise.all([getAllSubjects(), getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(), getAllDecks()]);
  const migrated = migrateSubjectIdentity({ nodes, quotes, cues, cards, decks }); const byKey = new Map(subjects.map((s) => [s.key.toLocaleLowerCase(), s]));
  for (const candidate of migrated.subjects) if (!byKey.has(candidate.key.toLocaleLowerCase())) { const s = { ...candidate, id: `subj_${crypto.randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now() }; await addSubjects([s]); byKey.set(s.key.toLocaleLowerCase(), s); }
  const idByKey = new Map([...byKey.values()].map((s) => [s.key.toLocaleLowerCase(), s.id]));
  for (const [store, rows, owner] of [["nodes", nodes, "subject"], ["quotes", quotes, "subject"], ["cues", cues, "subject"], ["cards", cards, "deck"], ["decks", decks, "subject"]]) { const changed = rows.map((r) => { const k = String(r[owner] || r.meta?.hierarchyPath?.[0] || r.deckPath?.[0] || "").trim(); const id = r.subjectId || idByKey.get(k.toLocaleLowerCase()); return id && id !== r.subjectId ? { ...r, subjectId: id } : null; }).filter(Boolean); if (changed.length) await writeRows(store, changed); }

  // Subject rows are the source of truth for display name and level; subject
  // nodes are the compatibility projection other tools index. Keep them synced
  // so old databases and imported datasets gain level metadata in place.
  const allSubjects = await getAllSubjects();
  const currentNodes = await getAllNodes();
  const subjectNodesById = new Map(
    currentNodes.filter((n) => n && n.type === "subject" && n.subjectId).map((n) => [n.subjectId, n])
  );
  const synced = [];
  for (const subject of allSubjects) {
    const node = subjectNodesById.get(subject.id);
    if (!node) {
      await addNode({
        id: `subject-${subject.id}`, type: "subject", subject: subject.key, subjectId: subject.id,
        name: subject.name, level: subject.level, createdAt: subject.createdAt, updatedAt: subject.updatedAt
      });
      continue;
    }
    if (node.subject !== subject.key || node.name !== subject.name || node.level !== subject.level) {
      synced.push({ ...node, subject: subject.key, name: subject.name, level: subject.level, updatedAt: Date.now() });
    }
  }
  if (synced.length) await addNodes(synced);
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

// ========== TASKS ==========
//
// Tasks are a standalone todo layer, not nodes: they must never leak into the
// mindmap, analysis counts or study queues. `subject` mirrors the key used by
// other records so a task can follow a renamed subject; `subjectId` is the
// stable identity when available. `source` is reserved for the future Google
// Classroom import ("classroom") versus tasks created here ("local").

function taskStoreExists() {
  return db && db.objectStoreNames.contains("tasks");
}

function normalizeTaskRecord(task = {}) {
  const now = Date.now();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(task.dueDate || "")) ? String(task.dueDate) : "";
  const done = !!task.done;
  return {
    ...task,
    id: task.id || crypto.randomUUID(),
    type: "task",
    title: String(task.title || "").trim(),
    notes: String(task.notes || "").trim(),
    subject: String(task.subject || "").trim(),
    subjectId: String(task.subjectId || "").trim(),
    dueDate,
    done,
    completedAt: done ? (Number(task.completedAt) || now) : null,
    source: task.source === "classroom" ? "classroom" : "local",
    createdAt: Number(task.createdAt) || now,
    updatedAt: now
  };
}

export function addTask(task) {
  return new Promise((resolve, reject) => {
    if (!db || !taskStoreExists()) {
      reject(new Error("Tasks store not available"));
      return;
    }

    const record = normalizeTaskRecord(task);
    const tx = mutationTransaction("tasks");
    const store = tx.objectStore("tasks");
    const existing = store.get(record.id);
    existing.onsuccess = () => {
      if (existing.result && !existing.result.done && record.done) {
        queueActivityEvent(tx, "task-completed", record.id);
      }
    };
    queueSyncUpsert(tx, "tasks", record);
    const req = store.put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-task", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addTasks(tasks) {
  return new Promise((resolve, reject) => {
    if (!db || !taskStoreExists()) {
      resolve([]);
      return;
    }

    const records = (tasks || []).map(normalizeTaskRecord);
    if (records.length === 0) {
      resolve([]);
      return;
    }

    const tx = mutationTransaction("tasks");
    const store = tx.objectStore("tasks");
    for (const record of records) {
      const existing = store.get(record.id);
      existing.onsuccess = () => {
        if (existing.result && !existing.result.done && record.done) {
          queueActivityEvent(tx, "task-completed", record.id);
        }
      };
      store.put(record);
      queueSyncUpsert(tx, "tasks", record);
    }
    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-task", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllTasks() {
  return new Promise((resolve, reject) => {
    if (!db || !taskStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("tasks", "readonly");
    const req = tx.objectStore("tasks").getAll();
    req.onsuccess = () => {
      const tasks = req.result || [];
      tasks.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
      resolve(tasks);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteTask(id) {
  return new Promise((resolve, reject) => {
    if (!db || !taskStoreExists()) {
      resolve(id);
      return;
    }

    const tx = mutationTransaction("tasks");
    queueSyncDelete(tx, "tasks", id);
    const req = tx.objectStore("tasks").delete(id);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-task", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearTasks() {
  return new Promise((resolve, reject) => {
    if (!db || !taskStoreExists()) {
      resolve();
      return;
    }

    const tx = mutationTransaction("tasks");
    const store = tx.objectStore("tasks");
    queueSyncClear(tx, "tasks", store);
    const req = store.clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "tasks" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ========== COMMITMENTS ==========
//
// A commitment is a recurring responsibility, not a task with a repeat flag.
// It has no single `done` state or due date; completion is recorded per local
// date in `completions`. Occurrences are derived from `recurrence`, so there
// are no generated daily records to clean up.

function commitmentStoreExists() {
  return db && db.objectStoreNames.contains("commitments");
}

function normalizeCommitmentRecord(commitment = {}) {
  const now = Date.now();
  const dateKey = (value) => (
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : ""
  );
  const recurrence = commitment.recurrence || {};
  const frequency = recurrence.frequency === "weekly" ? "weekly" : "daily";
  const weekdays = [...new Set(
    (Array.isArray(recurrence.weekdays) ? recurrence.weekdays : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )].sort((a, b) => a - b);

  const completions = {};
  for (const [key, value] of Object.entries(commitment.completions || {})) {
    if (!dateKey(key) || !value || typeof value !== "object") continue;
    if (value.skipped) {
      completions[key] = { skipped: true, at: Number(value.at) || now };
    } else if (Number.isFinite(Number(value.completedAt)) && Number(value.completedAt) > 0) {
      completions[key] = {
        completedAt: Number(value.completedAt),
        via: value.via === "memory" ? "memory" : "manual"
      };
    }
  }

  return {
    ...commitment,
    id: commitment.id || crypto.randomUUID(),
    type: "commitment",
    title: String(commitment.title || "").trim(),
    notes: String(commitment.notes || "").trim(),
    subject: String(commitment.subject || "").trim(),
    subjectId: String(commitment.subjectId || "").trim(),
    recurrence: {
      frequency,
      weekdays: frequency === "weekly" ? weekdays : [],
      startDate: dateKey(recurrence.startDate),
      endDate: dateKey(recurrence.endDate)
    },
    completions,
    archivedAt: Number(commitment.archivedAt) || null,
    createdAt: Number(commitment.createdAt) || now,
    updatedAt: now
  };
}

export function addCommitment(commitment) {
  return new Promise((resolve, reject) => {
    if (!db || !commitmentStoreExists()) {
      reject(new Error("Commitments store not available"));
      return;
    }

    const record = normalizeCommitmentRecord(commitment);
    const tx = mutationTransaction("commitments");
    queueSyncUpsert(tx, "commitments", record);
    const req = tx.objectStore("commitments").put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-commitment", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addCommitments(commitments) {
  return new Promise((resolve, reject) => {
    if (!db || !commitmentStoreExists()) {
      resolve([]);
      return;
    }

    const records = (commitments || []).map(normalizeCommitmentRecord);
    if (records.length === 0) {
      resolve([]);
      return;
    }

    const tx = mutationTransaction("commitments");
    const store = tx.objectStore("commitments");
    for (const record of records) {
      store.put(record);
      queueSyncUpsert(tx, "commitments", record);
    }
    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-commitment", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getAllCommitments() {
  return new Promise((resolve, reject) => {
    if (!db || !commitmentStoreExists()) {
      resolve([]);
      return;
    }

    const tx = db.transaction("commitments", "readonly");
    const req = tx.objectStore("commitments").getAll();
    req.onsuccess = () => {
      const commitments = req.result || [];
      commitments.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
      resolve(commitments);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteCommitment(id) {
  return new Promise((resolve, reject) => {
    if (!db || !commitmentStoreExists()) {
      resolve(id);
      return;
    }

    const tx = mutationTransaction("commitments");
    queueSyncDelete(tx, "commitments", id);
    const req = tx.objectStore("commitments").delete(id);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-commitment", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearCommitments() {
  return new Promise((resolve, reject) => {
    if (!db || !commitmentStoreExists()) {
      resolve();
      return;
    }

    const tx = mutationTransaction("commitments");
    const store = tx.objectStore("commitments");
    queueSyncClear(tx, "commitments", store);
    const req = store.clear();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "commitments" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Journal — STUB storage
// Personal reflective entries (psychological/philosophical/self-optimisation),
// stored in IndexedDB today. This is intentionally a thin persistence layer:
// the planned PC/file-system storage overhaul should replace these accessors,
// not the Journal tool's UI or its entry shape.
// ---------------------------------------------------------------------------

function journalStoreExists() {
  return db && db.objectStoreNames.contains("journals");
}

function normalizeJournalEntry(record = {}) {
  const now = Date.now();
  const createdAt = Number(record.createdAt) || now;
  const updatedAt = Number(record.updatedAt) || createdAt;
  const body = typeof record.body === "string" ? record.body : String(record.content || record.text || "");
  const date = new Date(createdAt);
  const dateKey = Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    id: String(record.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `journal-${now}-${Math.random().toString(36).slice(2, 8)}`)),
    type: "journal",
    title: String(record.title || "").trim(),
    body,
    insight: record.insight === true,
    createdAt,
    updatedAt: Math.max(updatedAt, createdAt),
    dateKey
  };
}

export function addJournal(entry) {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      reject(new Error("Journals store not available"));
      return;
    }
    const record = normalizeJournalEntry(entry);
    const tx = db.transaction("journals", "readwrite");
    tx.objectStore("journals").put(record);
    tx.oncomplete = () => {
      emitDBChange({ type: "upsert-journal", ids: [record.id] });
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function addJournals(entries) {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      resolve([]);
      return;
    }
    const records = (entries || []).map(normalizeJournalEntry);
    if (records.length === 0) {
      resolve([]);
      return;
    }
    const tx = db.transaction("journals", "readwrite");
    const store = tx.objectStore("journals");
    for (const record of records) store.put(record);
    tx.oncomplete = () => {
      emitDBChange({ type: "bulk-upsert-journal", ids: records.map((record) => record.id) });
      resolve(records);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getJournal(id) {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      resolve(null);
      return;
    }
    const tx = db.transaction("journals", "readonly");
    const req = tx.objectStore("journals").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export function getAllJournals() {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      resolve([]);
      return;
    }
    const tx = db.transaction("journals", "readonly");
    const req = tx.objectStore("journals").getAll();
    req.onsuccess = () => {
      const journals = (req.result || []).map(normalizeJournalEntry);
      journals.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      resolve(journals);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function deleteJournal(id) {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      resolve(id);
      return;
    }
    const tx = db.transaction("journals", "readwrite");
    tx.objectStore("journals").delete(id);
    tx.oncomplete = () => {
      emitDBChange({ type: "delete-journal", ids: [id] });
      resolve(id);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function clearJournals() {
  return new Promise((resolve, reject) => {
    if (!db || !journalStoreExists()) {
      resolve();
      return;
    }
    const tx = db.transaction("journals", "readwrite");
    tx.objectStore("journals").clear();
    tx.oncomplete = () => {
      emitDBChange({ type: "clear", store: "journals" });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}


// ========== LOCAL ACTIVITY EVENTS ==========

// Events contain metadata only: a day, action type and record ID. They never
// copy card text, task titles, notes or other learning content.
export function getActivityEvents({ sinceDay = "" } = {}) {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("activityEvents")) return resolve([]);
    const tx = db.transaction("activityEvents", "readonly");
    const store = tx.objectStore("activityEvents");
    const request = sinceDay && typeof IDBKeyRange !== "undefined"
      ? store.index("day").getAll(IDBKeyRange.lowerBound(String(sinceDay)))
      : store.getAll();
    request.onsuccess = () => {
      const events = (request.result || [])
        .filter((event) => !sinceDay || String(event.day) >= String(sinceDay))
        .sort((left, right) => Number(left.occurredAt || 0) - Number(right.occurredAt || 0));
      resolve(events);
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ========== CLOUD SYNC STATE ==========

export function getSyncOutbox(limit = 100) {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncOutbox")) return reject(new Error("Sync outbox is unavailable"));
    const tx = db.transaction(["syncOutbox", "syncMeta"], "readonly");
    const outbox = tx.objectStore("syncOutbox");
    const meta = tx.objectStore("syncMeta");
    const request = outbox.getAll();
    let operations = [];
    request.onsuccess = () => {
      operations = (request.result || [])
        .filter((operation) => !operation.blocked)
        .sort((a, b) => Number(a.queuedAt || 0) - Number(b.queuedAt || 0))
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 100)));
      for (const operation of operations) {
        const metaRequest = meta.get(syncRecordKey(operation.collection, operation.recordId));
        metaRequest.onsuccess = () => {
          operation.baseVersion = Number(metaRequest.result?.serverVersion || 0);
        };
      }
    };
    tx.oncomplete = () => resolve(operations);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function acknowledgeSyncOperation(operation, result) {
  return new Promise((resolve, reject) => {
    if (!db || !operation || !result) return reject(new Error("Invalid sync acknowledgement"));
    const key = syncRecordKey(operation.collection, operation.recordId);
    const tx = db.transaction(["syncOutbox", "syncMeta"], "readwrite");
    const outbox = tx.objectStore("syncOutbox");
    const meta = tx.objectStore("syncMeta");
    const pendingRequest = outbox.get(key);
    pendingRequest.onsuccess = () => {
      if (pendingRequest.result?.operationId === operation.operationId) outbox.delete(key);
      const version = Number(result.version);
      const revision = Number(result.revision);
      if (Number.isSafeInteger(version) && version >= 0) {
        meta.put({
          key,
          collection: operation.collection,
          recordId: String(operation.recordId),
          serverVersion: version,
          serverRevision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
          updatedAt: Date.now()
        });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function saveSyncConflict(conflict) {
  return new Promise((resolve, reject) => {
    if (!db || !conflict?.collection || !conflict?.recordId) return reject(new Error("Invalid sync conflict"));
    const key = syncRecordKey(conflict.collection, conflict.recordId);
    const tx = db.transaction(["syncConflicts", "syncOutbox"], "readwrite");
    const pendingStore = tx.objectStore("syncOutbox");
    const pendingRequest = pendingStore.get(key);
    pendingRequest.onsuccess = () => {
      if (pendingRequest.result) {
        pendingStore.put({ ...pendingRequest.result, blocked: true });
      }
      tx.objectStore("syncConflicts").put({ ...conflict, key, updatedAt: Date.now() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getSyncConflicts() {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncConflicts")) return resolve([]);
    const tx = db.transaction("syncConflicts", "readonly");
    const request = tx.objectStore("syncConflicts").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export function resolveSyncConflict(collection, recordId, choice) {
  if (choice !== "local" && choice !== "remote") {
    return Promise.reject(new Error("Choice must be local or remote"));
  }
  return new Promise((resolve, reject) => {
    if (!db || !SYNC_COLLECTIONS.has(collection)) return reject(new Error("Unsupported sync collection"));
    const key = syncRecordKey(collection, recordId);
    const tx = db.transaction([collection, "syncOutbox", "syncMeta", "syncConflicts"], "readwrite");
    const records = tx.objectStore(collection);
    const outbox = tx.objectStore("syncOutbox");
    const meta = tx.objectStore("syncMeta");
    const conflicts = tx.objectStore("syncConflicts");
    const request = conflicts.get(key);

    request.onsuccess = () => {
      const conflict = request.result;
      if (!conflict) return;
      const remote = conflict.remoteChange || {};
      if (choice === "remote") {
        if (remote.type === "delete") records.delete(String(recordId));
        else if (remote.payload) records.put(remote.payload);
        outbox.delete(key);
      } else {
        const currentRequest = records.get(String(recordId));
        currentRequest.onsuccess = () => {
          const current = currentRequest.result;
          outbox.put({
            key,
            collection,
            recordId: String(recordId),
            operationId: crypto.randomUUID(),
            type: current ? "upsert" : "delete",
            payload: current || null,
            queuedAt: Date.now(),
            // Choosing the local copy is an explicit user decision to re-create
            // a record that may have disappeared before the retained baseline.
            firstQueuedAt: Date.now()
          });
        };
      }
      const version = Number(remote.version || remote.currentVersion);
      const revision = Number(remote.revision || 0);
      if (Number.isSafeInteger(version) && version >= 0) {
        meta.put({
          key,
          collection,
          recordId: String(recordId),
          serverVersion: version,
          serverRevision: Number.isSafeInteger(revision) ? revision : 0,
          updatedAt: Date.now()
        });
      }
      conflicts.delete(key);
    };

    tx.oncomplete = () => {
      emitDBChange({ type: "sync-conflict-resolved", ids: [String(recordId)] });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function stableSyncValue(value) {
  if (Array.isArray(value)) return value.map(stableSyncValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableSyncValue(value[key])])
    );
  }
  return value;
}

function syncPayloadsEqual(left, right) {
  return JSON.stringify(stableSyncValue(left)) === JSON.stringify(stableSyncValue(right));
}

export function applyRemoteSyncChanges(changes = [], nextCursor = 0) {
  return new Promise((resolve, reject) => {
    if (!db || !Array.isArray(changes)) return reject(new Error("Invalid remote changes"));

    // A page can contain multiple revisions of one record. Only the latest
    // state for each record matters; applying intermediate revisions in the
    // same transaction creates competing reads against the same outbox row.
    const latestByRecord = new Map();
    for (const change of changes) {
      if (!SYNC_COLLECTIONS.has(change.collection) || change.recordId == null) continue;
      const key = syncRecordKey(change.collection, change.recordId);
      const previous = latestByRecord.get(key);
      if (!previous || Number(change.revision) >= Number(previous.revision)) {
        latestByRecord.set(key, change);
      }
    }
    const valid = [...latestByRecord.values()].sort(
      (left, right) => Number(left.revision) - Number(right.revision)
    );
    const stores = [...new Set([...valid.map((change) => change.collection), "syncOutbox", "syncMeta", "syncConflicts", "syncState"])];
    const tx = db.transaction(stores, "readwrite");
    const outbox = tx.objectStore("syncOutbox");
    const meta = tx.objectStore("syncMeta");
    const conflicts = tx.objectStore("syncConflicts");

    tx.objectStore("syncState").put({
      key: "pullCursor",
      value: Number(nextCursor) || 0,
      updatedAt: Date.now()
    });

    for (const change of valid) {
      const key = syncRecordKey(change.collection, change.recordId);
      const pendingRequest = outbox.get(key);
      const metaRequest = meta.get(key);
      let pendingReady = false;
      let metaReady = false;
      let pending = null;
      let currentMeta = null;
      const applyWhenReady = () => {
        if (!pendingReady || !metaReady) return;
        const incomingVersion = Number(change.version) || 0;
        // A snapshot may already contain a record newer than this change page.
        // Never roll that record back while replaying changes after the snapshot
        // revision; the cursor can still advance because the newer state is local.
        if (Number(currentMeta?.serverVersion || 0) >= incomingVersion) return;
        const localRecords = tx.objectStore(change.collection);

        if (pending) {
          const equal = pending.type === change.type &&
            (change.type === "delete" || syncPayloadsEqual(pending.payload, change.payload));
          if (equal) {
            outbox.delete(key);
            meta.put({
              key,
              collection: change.collection,
              recordId: String(change.recordId),
              serverVersion: Number(change.version) || 0,
              serverRevision: Number(change.revision) || 0,
              updatedAt: Date.now()
            });
          } else {
            outbox.put({ ...pending, blocked: true });
            conflicts.put({
              key,
              collection: change.collection,
              recordId: String(change.recordId),
              localOperation: pending,
              remoteChange: change,
              updatedAt: Date.now()
            });
          }
          meta.put({
            key,
            collection: change.collection,
            recordId: String(change.recordId),
            serverVersion: Number(change.version) || 0,
            serverRevision: Number(change.revision) || 0,
            updatedAt: Date.now()
          });
          return;
        }

        if (change.type === "delete") localRecords.delete(String(change.recordId));
        else if (change.type === "upsert" && change.payload) localRecords.put(change.payload);
        meta.put({
          key,
          collection: change.collection,
          recordId: String(change.recordId),
          serverVersion: Number(change.version) || 0,
          serverRevision: Number(change.revision) || 0,
          updatedAt: Date.now()
        });
      };
      pendingRequest.onsuccess = () => {
        pending = pendingRequest.result || null;
        pendingReady = true;
        applyWhenReady();
      };
      metaRequest.onsuccess = () => {
        currentMeta = metaRequest.result || null;
        metaReady = true;
        applyWhenReady();
      };
    }

    tx.oncomplete = () => {
      if (valid.length) emitDBChange({ type: "sync-pull-applied", count: valid.length, remote: true });
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getSyncCursor() {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncState")) return resolve(0);
    const tx = db.transaction("syncState", "readonly");
    const request = tx.objectStore("syncState").get("pullCursor");
    request.onsuccess = () => resolve(Number(request.result?.value) || 0);
    request.onerror = () => reject(request.error);
  });
}


export function beginSyncSnapshot(snapshotId, revision) {
  if (typeof snapshotId !== "string" || !snapshotId || !Number.isSafeInteger(Number(revision)) || Number(revision) < 0) {
    return Promise.reject(new Error("Invalid cloud snapshot metadata"));
  }
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncSnapshotRecords")) {
      return reject(new Error("Snapshot staging is unavailable; reload NeuroNet to update its local database."));
    }
    const tx = db.transaction(["syncSnapshotRecords", "syncState"], "readwrite");
    tx.objectStore("syncSnapshotRecords").clear();
    tx.objectStore("syncState").put({
      key: "activeSnapshot",
      value: { snapshotId, revision: Number(revision), startedAt: Date.now() },
      updatedAt: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function stageSyncSnapshotPage(snapshotId, records = []) {
  if (typeof snapshotId !== "string" || !snapshotId || !Array.isArray(records)) {
    return Promise.reject(new Error("Invalid cloud snapshot page"));
  }
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncSnapshotRecords")) {
      return reject(new Error("Snapshot staging is unavailable"));
    }
    const tx = db.transaction(["syncSnapshotRecords", "syncState"], "readwrite");
    const store = tx.objectStore("syncSnapshotRecords");
    let abortReason = null;
    const activeRequest = tx.objectStore("syncState").get("activeSnapshot");
    activeRequest.onsuccess = () => {
      const active = activeRequest.result?.value;
      if (active?.snapshotId !== snapshotId) {
        abortReason = new Error("Snapshot page belongs to an inactive recovery session");
        tx.abort();
        return;
      }
    };
    for (const record of records) {
      if (!record || !SYNC_COLLECTIONS.has(record.collection) ||
          typeof record.recordId !== "string" || !record.recordId ||
          !record.payload || String(record.payload.id) !== record.recordId ||
          !Number.isSafeInteger(Number(record.version)) || Number(record.version) < 1) {
        tx.abort();
        return reject(new Error("Cloud snapshot contained an invalid record"));
      }
      const key = snapshotId + "\u001e" + syncRecordKey(record.collection, record.recordId);
      store.put({
        key,
        snapshotId,
        collection: record.collection,
        recordId: record.recordId,
        payload: record.payload,
        version: Number(record.version),
        revision: Number(record.revision) || 0,
        updatedAt: Number(record.updatedAt) || Date.now()
      });
    }
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(abortReason || tx.error || new Error("Snapshot staging transaction failed"));
    tx.onabort = () => reject(abortReason || tx.error || new Error("Snapshot staging transaction aborted"));
  });
}

export function completeSyncSnapshot(snapshotId, revision, compactedAt = 0) {
  const snapshotRevision = Number(revision);
  const snapshotCompactedAt = Number(compactedAt) || 0;
  if (typeof snapshotId !== "string" || !snapshotId ||
      !Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0) {
    return Promise.reject(new Error("Invalid cloud snapshot completion"));
  }

  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncSnapshotRecords")) {
      return reject(new Error("Snapshot staging is unavailable"));
    }
    const names = [...SYNC_COLLECTIONS];
    const stores = [
      ...names, "syncOutbox", "syncMeta", "syncConflicts",
      "syncState", "syncSnapshotRecords"
    ];
    const tx = db.transaction(stores, "readwrite");
    const data = { local: {} };
    let remaining = names.length + 5;
    let failed = false;
    let snapshotSummary = null;

    const failRequest = (request) => {
      request.onerror = () => {
        failed = true;
        reject(request.error || new Error("Unable to read local data for snapshot recovery"));
      };
    };
    const accept = (key, request) => {
      failRequest(request);
      request.onsuccess = () => {
        data[key] = request.result || [];
        remaining -= 1;
        if (remaining === 0 && !failed) reconcile();
      };
    };

    names.forEach((collection) => {
      const request = tx.objectStore(collection).getAll();
      failRequest(request);
      request.onsuccess = () => {
        data.local[collection] = request.result || [];
        remaining -= 1;
        if (remaining === 0 && !failed) reconcile();
      };
    });
    accept("outbox", tx.objectStore("syncOutbox").getAll());
    accept("meta", tx.objectStore("syncMeta").getAll());
    accept("conflicts", tx.objectStore("syncConflicts").getAll());
    accept("remote", tx.objectStore("syncSnapshotRecords").index("snapshotId").getAll(snapshotId));
    accept("activeSnapshot", tx.objectStore("syncState").get("activeSnapshot"));

    function reconcile() {
      try {
        if (data.activeSnapshot?.value?.snapshotId !== snapshotId ||
            Number(data.activeSnapshot?.value?.revision) !== snapshotRevision) {
          throw new Error("This cloud snapshot is no longer the active recovery session.");
        }
        const outbox = tx.objectStore("syncOutbox");
        const meta = tx.objectStore("syncMeta");
        const conflicts = tx.objectStore("syncConflicts");
        const state = tx.objectStore("syncState");
        const staging = tx.objectStore("syncSnapshotRecords");
        const pendingByKey = new Map(data.outbox.map((item) => [item.key, item]));
        const metaByKey = new Map(data.meta.map((item) => [item.key, item]));
        const conflictByKey = new Map(data.conflicts.map((item) => [item.key, item]));
        const localByKey = new Map();

        for (const collection of names) {
          for (const record of data.local[collection]) {
            localByKey.set(syncRecordKey(collection, record.id), { collection, record });
          }
        }

        const remoteByKey = new Map();
        for (const record of data.remote) {
          remoteByKey.set(syncRecordKey(record.collection, record.recordId), record);
        }

        const writeMeta = (key, collection, recordId, serverVersion, serverRevision) => {
          meta.put({
            key,
            collection,
            recordId: String(recordId),
            serverVersion: Number(serverVersion) || 0,
            serverRevision: Number(serverRevision) || 0,
            updatedAt: Date.now()
          });
        };
        const remoteChangeFor = (record) => ({
          type: "upsert",
          payload: record.payload,
          version: record.version,
          revision: record.revision || snapshotRevision,
          operationId: null
        });
        const deletedRemoteChange = () => ({
          type: "delete",
          payload: null,
          version: 0,
          revision: snapshotRevision,
          operationId: null
        });
        let applied = 0;
        let queuedOrphans = 0;
        let conflictCount = 0;
        let removed = 0;

        for (const [key, remote] of remoteByKey) {
          const collection = remote.collection;
          const recordId = remote.recordId;
          const recordStore = tx.objectStore(collection);
          const pending = pendingByKey.get(key);
          const existingConflict = conflictByKey.get(key);
          const recordRevision = Number(remote.revision) || snapshotRevision;

          if (pending) {
            const matches = pending.type === "upsert" &&
              syncPayloadsEqual(pending.payload, remote.payload);
            if (matches) {
              recordStore.put(remote.payload);
              outbox.delete(key);
              conflicts.delete(key);
              pendingByKey.delete(key);
              conflictByKey.delete(key);
            } else {
              // The snapshot can safely retain an offline edit/delete when
              // the cloud record is still exactly at the version this device
              // last acknowledged. A different version means another device
              // changed it and requires an explicit conflict decision.
              const knownVersion = Number(metaByKey.get(key)?.serverVersion || 0);
              const remoteVersion = Number(remote.version || 0);
              const remoteUnchangedSinceLocalBase = knownVersion > 0 &&
                remoteVersion === knownVersion;
              if (remoteUnchangedSinceLocalBase && !existingConflict) {
                outbox.put({ ...pending, blocked: false });
                conflicts.delete(key);
                conflictByKey.delete(key);
              } else {
                outbox.put({ ...pending, blocked: true });
                conflicts.put({
                  ...(existingConflict || {}),
                  key,
                  collection,
                  recordId,
                  localOperation: pending,
                  remoteChange: remoteChangeFor(remote),
                  updatedAt: Date.now()
                });
                conflictCount += 1;
              }
            }
          } else if (existingConflict) {
            conflicts.put({
              ...existingConflict,
              remoteChange: remoteChangeFor(remote),
              updatedAt: Date.now()
            });
            conflictCount += 1;
          } else {
            recordStore.put(remote.payload);
          }

          writeMeta(key, collection, recordId, remote.version, recordRevision);
          applied += 1;
        }

        // Local records missing from the cloud baseline are only discarded
        // when local metadata proves they were previously synced. Untracked
        // local data is preserved and queued instead of guessed away.
        for (const [key, local] of localByKey) {
          if (remoteByKey.has(key) || pendingByKey.has(key)) continue;
          const recordMeta = metaByKey.get(key);
          const existingConflict = conflictByKey.get(key);
          const recordStore = tx.objectStore(local.collection);
          if (existingConflict) {
            conflicts.put({
              ...existingConflict,
              remoteChange: deletedRemoteChange(),
              updatedAt: Date.now()
            });
            writeMeta(key, local.collection, local.record.id, 0, snapshotRevision);
            conflictCount += 1;
          } else if (Number(recordMeta?.serverVersion || 0) > 0) {
            recordStore.delete(String(local.record.id));
            writeMeta(key, local.collection, local.record.id, 0, snapshotRevision);
            removed += 1;
          } else {
            queueSyncUpsert(tx, local.collection, local.record);
            queuedOrphans += 1;
          }
        }

        // Outbox entries can survive even if their local row was deleted by an
        // older app version or a partially completed import. Preserve payloads
        // and convert stale edits into explicit remote-deletion conflicts.
        for (const [key, pending] of pendingByKey) {
          if (remoteByKey.has(key)) continue;
          const recordMeta = metaByKey.get(key);
          const existingConflict = conflictByKey.get(key);
          const recordStore = tx.objectStore(pending.collection);

          if (pending.type === "delete") {
            outbox.delete(key);
            conflicts.delete(key);
            recordStore.delete(String(pending.recordId));
            writeMeta(key, pending.collection, pending.recordId, 0, snapshotRevision);
          } else {
            const firstQueuedAt = Number(pending.firstQueuedAt || pending.queuedAt) || 0;
            const predatesCompaction = snapshotCompactedAt > 0 &&
              firstQueuedAt > 0 && firstQueuedAt <= snapshotCompactedAt;
            if (Number(recordMeta?.serverVersion || 0) > 0 || existingConflict || predatesCompaction) {
              if (pending.payload) recordStore.put(pending.payload);
              outbox.put({ ...pending, blocked: true });
              conflicts.put({
                ...(existingConflict || {}),
                key,
                collection: pending.collection,
                recordId: String(pending.recordId),
                localOperation: pending,
                remoteChange: {
                  ...deletedRemoteChange(),
                  reason: predatesCompaction && !existingConflict
                    ? "pending-operation-predates-compacted-baseline"
                    : "record-absent-from-cloud-snapshot"
                },
                updatedAt: Date.now()
              });
              writeMeta(key, pending.collection, pending.recordId, 0, snapshotRevision);
              conflictCount += 1;
            } else {
              if (pending.payload) recordStore.put(pending.payload);
              writeMeta(key, pending.collection, pending.recordId, 0, snapshotRevision);
            }
          }

        }

        for (const record of data.remote) staging.delete(record.key);
        state.put({
          key: "pullCursor",
          value: snapshotRevision,
          updatedAt: Date.now()
        });
        state.delete("activeSnapshot");
        state.put({
          key: "lastSnapshot",
          value: {
            revision: snapshotRevision,
            compactedAt: snapshotCompactedAt,
            completedAt: Date.now(),
            recordCount: data.remote.length
          },
          updatedAt: Date.now()
        });

        snapshotSummary = {
          applied,
          removed,
          queuedOrphans,
          conflicts: conflictCount,
          recordCount: data.remote.length,
          revision: snapshotRevision,
          compactedAt: snapshotCompactedAt
        };
      } catch (error) {
        failed = true;
        try { tx.abort(); } catch {}
        reject(error);
      }
    }

    tx.oncomplete = () => {
      emitDBChange({
        type: "sync-snapshot-applied",
        count: snapshotSummary?.recordCount || 0,
        remote: true
      });
      resolve(snapshotSummary || { revision: snapshotRevision });
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Snapshot reconciliation transaction aborted"));
  });
}

export function queueSyncSnapshot() {
  return Promise.all([
    getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(),
    getAllHeaps(), getAllDecks(), getAllSubjects(), getAllTasks(), getAllCommitments()
  ]).then((collections) => {
    const names = ["nodes", "quotes", "cues", "cards", "heaps", "decks", "subjects", "tasks", "commitments"];
    const tx = db.transaction([...names, "syncOutbox"], "readwrite");
    const outbox = tx.objectStore("syncOutbox");
    for (let i = 0; i < names.length; i += 1) {
      for (const record of collections[i] || []) {
        const recordId = String(record.id);
        const key = syncRecordKey(names[i], recordId);
        const existing = outbox.get(key);
        existing.onsuccess = () => {
          // Snapshot seeding is idempotent: never replace an operation that
          // may already have reached the server but whose acknowledgement was
          // lost. The ordinary mutation path is responsible for newer edits.
          if (!existing.result) queueSyncUpsert(tx, names[i], record);
        };
      }
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(collections.reduce((sum, rows) => sum + rows.length, 0));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  });
}



const SYNC_LOCK_TTL_MS = 5 * 60 * 1000;

export function acquireSyncLock(owner) {
  if (typeof owner !== "string" || !owner) return Promise.reject(new Error("A sync lock owner is required"));
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncState")) return reject(new Error("Sync state is unavailable"));
    const tx = db.transaction("syncState", "readwrite");
    const store = tx.objectStore("syncState");
    const request = store.get("syncLock");
    let acquired = false;
    request.onsuccess = () => {
      const now = Date.now();
      const current = request.result?.value;
      if (!current || Number(current.expiresAt || 0) <= now || current.owner === owner) {
        store.put({
          key: "syncLock",
          value: { owner, expiresAt: now + SYNC_LOCK_TTL_MS },
          updatedAt: now
        });
        acquired = true;
      }
    };
    tx.oncomplete = () => resolve(acquired);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function renewSyncLock(owner) {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncState")) return resolve(false);
    const tx = db.transaction("syncState", "readwrite");
    const store = tx.objectStore("syncState");
    const request = store.get("syncLock");
    let renewed = false;
    request.onsuccess = () => {
      const current = request.result?.value;
      const now = Date.now();
      if (current?.owner === owner && Number(current.expiresAt || 0) > now) {
        store.put({
          key: "syncLock",
          value: { owner, expiresAt: now + SYNC_LOCK_TTL_MS },
          updatedAt: now
        });
        renewed = true;
      }
    };
    tx.oncomplete = () => resolve(renewed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function releaseSyncLock(owner) {
  return new Promise((resolve, reject) => {
    if (!db || !db.objectStoreNames.contains("syncState")) return resolve(false);
    const tx = db.transaction("syncState", "readwrite");
    const store = tx.objectStore("syncState");
    const request = store.get("syncLock");
    let released = false;
    request.onsuccess = () => {
      if (request.result?.value?.owner === owner) {
        store.delete("syncLock");
        released = true;
      }
    };
    tx.oncomplete = () => resolve(released);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function getSyncState(key) {
  return new Promise((resolve,reject)=>{
    if(!db||!db.objectStoreNames.contains("syncState"))return resolve(null);
    const tx=db.transaction("syncState","readonly");
    const request=tx.objectStore("syncState").get(String(key));
    request.onsuccess=()=>resolve(request.result?.value ?? null);
    request.onerror=()=>reject(request.error);
  });
}

export function setSyncState(key,value) {
  return new Promise((resolve,reject)=>{
    if(!db||!db.objectStoreNames.contains("syncState"))return reject(new Error("Sync state store is unavailable"));
    const tx=db.transaction("syncState","readwrite");
    tx.objectStore("syncState").put({key:String(key),value,updatedAt:Date.now()});
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}
