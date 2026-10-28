/*
 * Generated into each showcase snapshot by scripts/build-showcase.mjs.
 *
 * The snapshot is a static copy of an old build. This script gives it a
 * usable demo dataset on first load without touching the latest app or any
 * other snapshot. It only writes when every store it knows about is empty.
 */
(() => {
  "use strict";

  const DB_NAME = "neuronet-showcase-v8";
  const VERSION = "v8";
  const TARGET_STORES = ["nodes","quotes","cues","tags"];
  const FLAG = `neuronet-showcase-seeded:${VERSION}`;

  const sessionFlag = {
    get() {
      try {
        return window.sessionStorage.getItem(FLAG);
      } catch {
        return null;
      }
    },
    set() {
      try {
        window.sessionStorage.setItem(FLAG, "1");
      } catch {
        // Private browsing can disable sessionStorage. The empty-store check
        // still prevents duplicate seeds, so this is safe to ignore.
      }
    }
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function collectTags(payload) {
    const titles = new Map();
    const add = (values) => {
      for (const value of values || []) {
        const title = String(value || "").trim();
        if (!title) continue;
        const key = title.toLowerCase();
        if (!titles.has(key)) titles.set(key, title);
      }
    };

    for (const node of payload.nodes || []) add(node && node.meta && node.meta.tags);
    for (const quote of payload.quotes || []) add(quote && quote.meta && quote.meta.tags);
    for (const card of payload.cards || []) add(card && card.tags);

    const now = Date.now();
    const usedIds = new Set();
    const records = [];
    for (const title of titles.values()) {
      const base = `tag-${title.toLowerCase().replace(/\s+/g, "-")}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}-${suffix++}`;
      usedIds.add(id);
      records.push({
        id,
        type: "tag",
        title,
        subject: "",
        createdAt: now,
        updatedAt: now
      });
    }
    return records;
  }

  function makeHeaps(cards) {
    const now = Date.now();
    const allIds = cards.map((card) => card && card.id).filter(Boolean);
    if (!allIds.length) return [];

    const focusIds = cards
      .filter((card) => (card.tags || []).some((tag) => /technique|character/i.test(tag)))
      .map((card) => card.id)
      .filter(Boolean);

    const heaps = [
      {
        id: "demo-heap-macbeth-all",
        type: "heap",
        name: "Macbeth: all cards",
        cardIds: allIds,
        createdAt: now,
        updatedAt: now
      }
    ];

    if (focusIds.length && focusIds.length < allIds.length) {
      heaps.push({
        id: "demo-heap-technique-character",
        type: "heap",
        name: "Technique + character",
        cardIds: focusIds,
        createdAt: now,
        updatedAt: now
      });
    }

    return heaps;
  }

  async function seed() {
    if (sessionFlag.get()) return "done";

    let db;
    try {
      db = await openDatabase();
      const stores = TARGET_STORES.filter((name) => db.objectStoreNames.contains(name));
      if (stores.length !== TARGET_STORES.length) {
        // The app may still be creating its schema. Retry shortly.
        return "retry";
      }

      const counts = await Promise.all(
        stores.map((name) =>
          requestResult(db.transaction(name, "readonly").objectStore(name).count())
        )
      );
      if (counts.some((count) => count > 0)) {
        sessionFlag.set();
        return "done";
      }

      const response = await fetch("demo-data.json", { cache: "no-store" });
      if (!response.ok) throw new Error("demo-data.json is missing");
      const payload = await response.json();

      const tags = collectTags(payload);
      const heaps = stores.includes("heaps")
        ? makeHeaps(Array.isArray(payload.cards) ? payload.cards : [])
        : [];

      const transaction = db.transaction(stores, "readwrite");
      const write = (storeName, records) => {
        if (!stores.includes(storeName)) return;
        const store = transaction.objectStore(storeName);
        for (const record of records || []) {
          if (record && record.id) store.put(record);
        }
      };

      write("nodes", payload.nodes);
      write("quotes", payload.quotes);
      write("cues", payload.cues);
      write("cards", payload.cards);
      write("tags", tags);
      write("heaps", heaps);

      await transactionDone(transaction);
      sessionFlag.set();
      return "seeded";
    } finally {
      if (db) db.close();
    }
  }

  let storeAttempts = 0;
  let errorAttempts = 0;

  async function run() {
    if (sessionFlag.get()) return;

    try {
      const result = await seed();
      if (result === "seeded") {
        // The app has already read its empty database. Reload once so it sees
        // the demo data. The session flag prevents a reload loop.
        window.location.reload();
        return;
      }
      if (result === "done") return;
    } catch (error) {
      errorAttempts += 1;
      console.info(
        "[showcase] demo seed skipped:",
        error && error.message ? error.message : error
      );
      if (errorAttempts >= 3) {
        sessionFlag.set();
        return;
      }
    }

    if (storeAttempts++ < 40) {
      window.setTimeout(run, 500);
    }
  }

  if (document.readyState === "complete") {
    run();
  } else {
    window.addEventListener("load", run, { once: true });
  }
})();
