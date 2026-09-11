// examData/storage.js — canonical persistence for exam-data snapshots.
//
// The six stores (execution-spec #37-#38) hold the canonical course/series/
// boundary/paper/source/job records between sessions.  An IndexedDB-backed
// implementation runs in the browser; an in-memory map serves Node tests and
// situations where IndexedDB is unavailable.  Consumers never touch storage
// directly — the ingest module and the repository build read models from it.

const STORES = Object.freeze([
  "examCourses",
  "examSeries",
  "examPapers",
  "examBoundaries",
  "examSources",
  "examJobs"
]);

// ---- in-memory fallback ----------------------------------------------------
let memStore = null;
function memInit() {
  if (!memStore) memStore = Object.fromEntries(STORES.map((s) => [s, []]));
  return memStore;
}

// ---- real IndexedDB (browser) ----------------------------------------------
const DB_NAME = "neuronet-exam-data";
const DB_VERSION = 1;

function idbOpen() {
  const idb = (globalThis.indexedDB) || (typeof self !== "undefined" && self.indexedDB) || null;
  if (!idb) return null;
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

let idbPromise = null;
function getIdb() {
  if (!idbPromise) idbPromise = idbOpen().catch(() => null);
  return idbPromise;
}

async function idbTx(storeName, mode, fn) {
  const db = await getIdb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result._val);
    tx.onabort = () => reject(tx.error || new Error("tx abort"));
    tx.onerror = () => reject(tx.error || new Error("tx error"));
  });
}

// ---- public snapshot API ----------------------------------------------------
// A snapshot is the entire canonical state: { courses:[], series:[], boundaries:[], papers:[], sources:[], jobs:[], updatedAt }.
// Stored under a singleton id so we never accidentally stack snapshots.

const SNAPSHOT_KEY = "current";
let latestSnapshot = null;

export async function loadSnapshot() {
  if (latestSnapshot) return latestSnapshot;

  // Try IDB first
  try {
    const db = await getIdb();
    if (db) {
      const contents = await Promise.all(
        STORES.map(async (name) => {
          const items = await new Promise((resolve, reject) => {
            const tx = db.transaction(name, "readonly");
            const req = tx.objectStore(name).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
          return [name, items];
        })
      );
      latestSnapshot = Object.fromEntries(contents);
      latestSnapshot.updatedAt = Date.now();
      return latestSnapshot;
    }
  } catch { /* fall through to memory */ }

  // Memory fallback
  memInit();
  latestSnapshot = {
    examCourses: memStore.examCourses.slice(),
    examSeries: memStore.examSeries.slice(),
    examBoundaries: memStore.examBoundaries.slice(),
    examPapers: memStore.examPapers.slice(),
    examSources: memStore.examSources.slice(),
    examJobs: memStore.examJobs.slice(),
    updatedAt: Date.now()
  };
  return latestSnapshot;
}

export async function saveSnapshot(snapshot) {
  if (!snapshot) return;
  const trimmed = { ...snapshot, updatedAt: Date.now() };

  // Write IDB
  try {
    const db = await getIdb();
    if (db) {
      for (const name of STORES) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(name, "readwrite");
          const store = tx.objectStore(name);
          store.clear();
          for (const item of trimmed[name] || []) {
            if (item && item.id) store.put(item);
          }
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      }
      latestSnapshot = trimmed;
      return;
    }
  } catch { /* fall through to memory */ }

  memInit();
  for (const name of STORES) memStore[name] = trimmed[name] ? trimmed[name].map((i) => ({ ...i })) : [];
  latestSnapshot = trimmed;
}

export function clearSnapshotCache() {
  latestSnapshot = null;
}

export async function clearAllStores() {
  latestSnapshot = null;
  try {
    const db = await getIdb();
    if (db) {
      await Promise.all(
        STORES.map(
          (name) => new Promise((resolve) => {
            const tx = db.transaction(name, "readwrite");
            tx.objectStore(name).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(true);
          })
        )
      );
    }
  } catch { /* OK */ }
  memInit();
  for (const name of STORES) memStore[name] = [];
}

// ---- sha-256 helper (used by ingestion for content-hashing official docs) --
export async function sha256Hex(bytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (subtle && subtle.digest) {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261;
  for (const byte of new Uint8Array(bytes)) { h ^= byte; h = Math.imul(h, 16777619); }
  return `faux-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export { STORES };