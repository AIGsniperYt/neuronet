// tests/e2e_tracker.mjs — real-browser end-to-end test of the Tracker
// boundary column with the *actual* app (index.html + db.js + trackerTool).
//
// Requires a Chrome/Chromium binary + puppeteer-core (both present on this
// machine). Serves the repo over HTTP, seeds the real IndexedDB with a Maths
// subject + sittings and the real localStorage boundary cache, opens the
// Tracker exactly like src/main.js does, and asserts the RENDERED badges.
//
//   node tests/e2e_tracker.mjs            # offline path (cached boundaries)
//   LIVE=1 node tests/e2e_tracker.mjs     # + live refetch of Pearson Jun 2024
//                                          #   original source → assert the real
//                                          #   parser reproduces the OFFICIAL
//                                          #   full table (197/167/137/105/73/42/26)

import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";

const ROOT = normalize(join(new URL(import.meta.url).pathname, "..", ".."));
const LIVE = process.env.LIVE === "1";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".js.gz": "text/javascript",
  ".mjs.gz": "text/javascript", ".woff2": "font/woff2",
  ".xlsx": "application/octet-stream", ".pdf": "application/pdf"
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    const data = await readFile(file);
    const ext = "." + file.split(".").pop();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(500); res.end();
  }
});

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};

const SUBJECT_TABLES = {
  2024: [{
    code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
    grades: { 9: 197, 8: 167, 7: 137, 6: 105, 5: 73, 4: 42, 3: 26, U: 0 },
    gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
    papers: [
      { label: "Paper 1", maxMark: 80 }, { label: "Paper 2", maxMark: 80 }, { label: "Paper 3", maxMark: 80 }
    ]
  }],
  2025: [{
    code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
    grades: { 9: 217, 8: 186, 7: 156, 6: 121, 5: 87, 4: 53, 3: 36, U: 0 },
    gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
    papers: [
      { label: "Paper 1", maxMark: 80 }, { label: "Paper 2", maxMark: 80 }, { label: "Paper 3", maxMark: 80 }
    ]
  }]
};

// Deliberate cross-board tie: English Literature exists as AQA 8702 AND OCR
// J352, so "English Literature" with no board must resolve as AMBIGUOUS — the
// honesty rule forbids picking one by cache richness.
const ENGLISH_AQA = [{
  code: "8702", title: "English Literature", tier: "", maxMark: 160,
  grades: { 9: 135, 8: 125, 7: 113, 6: 101, 5: 89, 4: 78, 3: 63, 2: 48, 1: 33, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"]
}];
const ENGLISH_OCR = [{
  code: "J352", title: "English Literature", tier: "", maxMark: 160,
  grades: { 9: 128, 8: 118, 7: 108, 6: 98, 5: 88, 4: 76, 3: 60, 2: 45, 1: 30, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"]
}];

const SEEDS = {
  nodes: [
    {
      id: "subject-maths", type: "subject", subject: "Maths", name: "Maths",
      examBoard: "Pearson (Edexcel)", qualification: "GCSE",
      officialCourse: { board: "Pearson (Edexcel)", qual: "GCSE", code: "1MA1", name: "Mathematics (Higher)", tier: "H" },
      createdAt: Date.now(), updatedAt: Date.now()
    },
    {
      id: "subject-english", type: "subject", subject: "English Literature", name: "English Literature",
      examBoard: "", qualification: "GCSE",
      createdAt: Date.now(), updatedAt: Date.now()
    },
    {
      id: "sit-2024", type: "pastpaper", subject: "Maths", year: 2024, series: "June",
      results: [{ paper: "Paper 1", score: 72, maxMark: 80 }],
      createdAt: Date.now(), updatedAt: Date.now()
    },
    {
      id: "sit-2025", type: "pastpaper", subject: "Maths", year: 2025, series: "June",
      results: [{ paper: "Paper 1", score: 75, maxMark: 80 }],
      createdAt: Date.now(), updatedAt: Date.now()
    },
    {
      id: "sit-undated", type: "pastpaper", subject: "Maths", year: null, series: "",
      results: [{ paper: "Paper 1", score: 60, maxMark: 80 }],
      createdAt: Date.now(), updatedAt: Date.now()
    },
    {
      id: "sit-english", type: "pastpaper", subject: "English Literature", year: 2024, series: "June",
      results: [{ paper: "Paper 1", score: 42, maxMark: 80 }],
      createdAt: Date.now(), updatedAt: Date.now()
    }
  ],
  tables: SUBJECT_TABLES,
  english: { aqa: ENGLISH_AQA, ocr: ENGLISH_OCR }
};

const escapeHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const OPEN_TRACKER = `
  (async () => {
    const db = await import("/src/db.js");
    await db.initDB();
    const { initTrackerTool } = await import("/src/tools/trackerTool.js");
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const tc = document.getElementById("toolContainer");
    tc.innerHTML = await fetch("./tools/tracker.html").then((r) => r.text());
    initTrackerTool({
      getAllNodes: db.getAllNodes,
      addNode: db.addNode,
      addNodes: db.addNodes,
      deleteNode: db.deleteNode,
      getSubjects: db.getSubjects,
      escapeHtml: esc
    }, { subject: "Maths" });
  })();
`;

await new Promise((r) => server.listen(8765, r));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
});

try {
  const page = await browser.newPage();
  // Network-gate injected on every document: block external fetches only while
  // the harness has set localStorage e2e:netblock=1 (real network otherwise).
  await page.evaluateOnNewDocument(() => {
    const orig = window.fetch;
    window.fetch = (url, opts) => {
      let blocked = false;
      try { blocked = localStorage.getItem("e2e:netblock") === "1"; } catch {}
      if (!blocked) return orig(url, opts);
      let u = null;
      try { u = new URL(url, location.href); } catch { u = null; }
      if (u && u.origin === location.origin) return orig(url, opts);
      return Promise.resolve(new Response("", { status: 404 }));
    };
  });
    await page.goto("http://localhost:8765/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#toolContainer") !== null, { timeout: 15000 });

    // ---- seed the REAL app storage through its OWN write paths ----
    // (gradeBoundaries keeps an in-memory mirror and flushes over localStorage
    // on pagehide, so hand-writing the key gets clobbered — we must go through
    // createBoundaryCacheStore().setCachedSubjects + flushBoundaryCache.)
    await page.evaluate(async (seed) => {
      const db = await import("/src/db.js");
      await db.initDB();
      try { await db.clearNodes(); } catch {}
      try { await db.clearQuotes(); } catch {}
      for (const n of seed.nodes) {
        try { await db.addNode(n); } catch {}
      }
      const gb = await import("/src/tools/gradeBoundaries.js");
      const store = gb.createBoundaryCacheStore();
      store.setCachedSubjects("pearson", "gcse", { month: "JUN", year: 2024, label: "June 2024" }, seed.tables["2024"]);
      store.setCachedSubjects("pearson", "gcse", { month: "JUN", year: 2025, label: "June 2025" }, seed.tables["2025"]);
      store.setCachedSubjects("aqa", "gcse", { month: "JUN", year: 2024, label: "June 2024" }, seed.english.aqa);
      store.setCachedSubjects("ocr", "gcse", { month: "JUN", year: 2024, label: "June 2024" }, seed.english.ocr);
      gb.flushBoundaryCache();
      localStorage.setItem("nn-last-activity", "null");
    }, SEEDS);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#toolContainer") !== null, { timeout: 15000 });

  // ---- open the Tracker exactly like src/main.js openTool('tracker') ----
  await page.evaluate(OPEN_TRACKER);

  await page.waitForSelector(".row-main", { timeout: 15000 });
  await page.waitForSelector(".row-main .bnd", { timeout: 15000 });

  // ---- render-time assertions ----
  const rows = await page.$$eval(".row-main", (rows) =>
    rows.map((row) => {
      const subj = row.querySelector(".sit-subject");
      const badges = [...row.querySelectorAll(".col-boundary .bnd")];
      return {
        subject: subj ? subj.textContent.trim() : "",
        badges: badges.map((b) => ({ text: b.textContent.trim(), cls: b.className.trim() })),
        session: row.querySelector(".sit-session") ? row.querySelector(".sit-session").textContent.trim() : ""
      };
    })
  );
  const bySubject = Object.fromEntries(rows.map((r, i) => ["row" + i, r]));
  const allBnd = rows.flatMap((r) => r.badges.map((b) => b.text));

  check("table renders 3 focused sittings", rows.length === 3, JSON.stringify(rows));
  check("2024 row renders official 197", allBnd.some((b) => b.includes("9 ≥ 197")),
    "badges=" + JSON.stringify(allBnd));
  check("2025 row renders official 217", allBnd.some((b) => b.includes("9 ≥ 217")),
    "badges=" + JSON.stringify(allBnd));
  const projected = rows.find((r) => r.session === "") ||
    rows.find((r) => r.badges.some((b) => b.cls.includes("bnd-proj")));
  check("undated row labelled projected (bnd-proj)",
    !!projected && projected.badges.some((b) => b.cls.includes("bnd-proj")),
    JSON.stringify(rows));

  const ambigResult = await page.evaluate(async () => {
    const gb = await import("/src/tools/gradeBoundaries.js");
    const res = gb.resolveTrackedCourse(gb.loadBoundaryCache(), { title: "English Literature" });
    return {
      ambiguous: res && res.ambiguous ? true : false,
      boards: (res && res.candidates ? res.candidates : []).map((c) => c.board).sort(),
      length: res && res.candidates ? res.candidates.length : 0
    };
  });
  check("resolver reports true ambiguity (AQA + OCR, never cache-rich pick)",
    ambigResult.ambiguous && ambigResult.length === 2 && JSON.stringify(ambigResult.boards) === JSON.stringify(["aqa", "ocr"]),
    JSON.stringify(ambigResult));

  // open the customise popover, then check the per-year preview groups
  await page.evaluate(() => {
    const btn = document.getElementById("trackerCustomiseBtn");
    if (btn) btn.click();
  });
  await page.waitForFunction(() => {
    const pop = document.getElementById("trackerCustomisePop");
    return pop && !pop.hidden && document.querySelector("#trackerBoundaryPreview .tracker-cus-preview-key");
  }, { timeout: 10000 }).catch(() => {});
  const preview = await page.$$eval("#trackerBoundaryPreview .tracker-cus-preview-key", (els) => els.map((e) => e.textContent.trim()));
  if (!preview.length) {
    const dumpPop = await page.evaluate(() =>
      document.getElementById("trackerBoundaryPreview") ? document.getElementById("trackerBoundaryPreview").textContent.trim().slice(0, 200) : "(no preview el)");
    console.log("  (preview debug)", JSON.stringify(dumpPop));
  }
  check("preview lists June 2025 group", preview.some((t) => t.includes("2025")), JSON.stringify(preview));
  check("preview lists June 2024 group", preview.some((t) => t.includes("2024")), JSON.stringify(preview));

  // ---- Phase D-3: confirmed course auto-suggests its discovered papers ----
  // (Only meaningful while a confirmed subject is focused: the Add action
  // pre-fills the paper list printed by the fetched pack of that course.)
  await page.evaluate(() => {
    const btn = document.getElementById("trackerAddBtn");
    if (btn) btn.click();
  });
  await page.waitForSelector("#trackerModal.open", { timeout: 10000 });
  const suggested = await page.$$eval("#trackerSlotList .tracker-slot-editor", (els) =>
    els.map((e) => ({
      paper: e.querySelector(".tracker-slot-paper").value.trim(),
      max: e.querySelector(".tracker-att-max").value.trim()
    }))
  );
  check("confirmed course auto-suggests its 3 discovered papers (max 80)",
    suggested.length === 3 &&
      suggested.every((s) => s.max === "80") &&
      JSON.stringify(suggested.map((s) => s.paper)) === JSON.stringify(["Paper 1", "Paper 2", "Paper 3"]),
    JSON.stringify(suggested));

  // ---- Phase D: sittings reference courseId + seriesId; ambiguity stays
  // literal. Re-open WITHOUT a focused subject so every subject column and
  // row is visible (the Maths-focused view above hides the subject column).
  await page.evaluate(async () => {
    const db = await import("/src/db.js");
    await db.initDB();
    const { initTrackerTool } = await import("/src/tools/trackerTool.js");
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const tc = document.getElementById("toolContainer");
    tc.innerHTML = await fetch("./tools/tracker.html").then((r) => r.text());
    initTrackerTool({
      getAllNodes: db.getAllNodes, addNode: db.addNode, addNodes: db.addNodes,
      deleteNode: db.deleteNode, getSubjects: db.getSubjects, escapeHtml: esc
    }, {});
  });
  await page.waitForSelector(".row-main", { timeout: 15000 });
  const rowMeta = await page.$$eval(".row-main", (rows) =>
    rows.map((r) => ({
      subject: r.querySelector(".sit-subject") ? r.querySelector(".sit-subject").textContent.trim() : "",
      courseId: r.dataset.courseId,
      seriesId: r.dataset.seriesId,
      badges: [...r.querySelectorAll(".col-boundary .bnd")].map((b) => b.textContent.trim())
    }))
  );
  const m2024row = rowMeta.find((r) => r.subject === "Maths" && r.seriesId === "JUN-2024");
  const mUndatedRow = rowMeta.find((r) => r.subject === "Maths" && r.seriesId === "");
  const englishRow = rowMeta.find((r) => r.subject === "English Literature");
  check("table shows all 4 sittings (showAll)", rowMeta.length === 4, JSON.stringify(rowMeta));
  check("Maths 2024 sitting references canonical courseId",
    !!m2024row && m2024row.courseId === "pearson:gcse:1MA1:H", JSON.stringify(rowMeta));
  check("Maths 2024 sitting references canonical seriesId",
    !!m2024row && m2024row.seriesId === "JUN-2024", JSON.stringify(rowMeta));
  check("undated sitting has a courseId but no seriesId",
    !!mUndatedRow && mUndatedRow.courseId === "pearson:gcse:1MA1:H" && mUndatedRow.seriesId === "",
    JSON.stringify(rowMeta));
  check("ambiguous English Literature row has NO guessed courseId",
    !!englishRow && englishRow.courseId === "" && englishRow.seriesId === "JUN-2024", JSON.stringify(rowMeta));
  check("ambiguous English Literature row never fabricates a boundary number",
    !!englishRow && !englishRow.badges.some((b) => /≥\s*\d+/.test(b)), JSON.stringify(englishRow));

  // ---- Scraper tool: boots and qualifies from the adapter vocabulary ----
  await page.evaluate(async () => {
    const db = await import("/src/db.js");
    await db.initDB();
    const { initScraperTool } = await import("/src/tools/scraperTool.js");
    const esc = (s) => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const tc = document.getElementById("toolContainer");
    tc.innerHTML = await fetch("./tools/scraper.html").then((r) => r.text());
    initScraperTool({ getAllNodes: db.getAllNodes, escapeHtml: esc }, {});
  });
  await page.waitForSelector("#scraperDiag", { timeout: 10000 });
  const scraper = await page.evaluate(() => {
    const quals = () =>
      [...document.getElementById("scraperQual").options].map((o) => o.value);
    const aqa = quals();
    document.getElementById("scraperBoard").value = "pearson";
    document.getElementById("scraperBoard").dispatchEvent(new Event("change"));
    const pearson = quals();
    const diag = document.getElementById("scraperDiag").textContent;
    return { aqa, pearson, diag, hasForce: !!document.getElementById("scraperForceBtn") };
  });
  check("scraper boots with force-refetch button", scraper.hasForce);
  const norm = (a) => a.map((v) => v.toLowerCase()).sort();
  check("AQA qual options from adapter (gcse+alevel+as)", JSON.stringify(norm(scraper.aqa)) === JSON.stringify(["alevel", "as", "gcse"]), JSON.stringify(scraper.aqa));
  check("Pearson qual options drop AS (adapter declares no AS)",
    norm(scraper.pearson).includes("gcse") && norm(scraper.pearson).includes("alevel") && !norm(scraper.pearson).includes("as"),
    JSON.stringify(scraper.pearson));
  check("scraper diagnostics name the adapter", /adapter: pearson/.test(scraper.diag), JSON.stringify(scraper.diag));

  // ---- baseline honesty re-check without a cache entry (2022 must be a dash)
  // While the gate is lowered, external fetches 404, so the warm flight can't
  // secretly fill 2022 from the live web; cached series must still render.
  await page.evaluate(() => { localStorage.setItem("e2e:netblock", "1"); });
  await page.evaluate(async () => {
    const db = await import("/src/db.js");
    await db.initDB();
    await db.addNode({
      id: "sit-2022", type: "pastpaper", subject: "Maths", year: 2022, series: "November",
      results: [{ paper: "Paper 1", score: 70, maxMark: 80 }],
      createdAt: Date.now(), updatedAt: Date.now()
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(OPEN_TRACKER);
  await page.waitForSelector(".row-main .bnd", { timeout: 15000 });

  const rows2 = await page.$$eval(".row-main", (rows) =>
    rows.map((row) => ({
      session: row.querySelector(".sit-session") ? row.querySelector(".sit-session").textContent.trim() : "",
      badges: [...row.querySelectorAll(".col-boundary .bnd")].map((b) => b.textContent.trim())
    }))
  );
  const flat2 = rows2.flatMap((r) => r.badges);
  check("2022 sitting never fabricates a number", flat2.some((b) => b.includes("–") || b.includes("—")), JSON.stringify(flat2));
  const r2022 = rows2.find((r) => r.session.includes("2022"));
  check("2022 sitting does NOT show 217", !r2022 || !r2022.badges.some((b) => b.includes("9 ≥ 217")), JSON.stringify(rows2));
  check("cached 2024 still official 197 under network block", flat2.some((b) => b.includes("9 ≥ 197")), JSON.stringify(flat2));
  await page.evaluate(() => { localStorage.removeItem("e2e:netblock"); });

  // ---- optional LIVE network verification: refetch Pearson June 2024 from
  // the official source and check the real parser reproduces the full official
  // 1MA1 Higher table (not just the top mark).
  if (LIVE) {
    console.log("LIVE: refetching Pearson GCSE June 2024 from official source...");
    await page.evaluate(async () => {
      const gb = await import("/src/tools/gradeBoundaries.js");
      const cache = gb.loadBoundaryCache();
      const key = Object.keys(cache.entries).find((k) => k.includes("2024"));
      if (key) delete cache.entries[key];
      gb.saveBoundaryCache(cache);
      gb.reloadBoundaryCache();
      try {
        await gb.ensureBoundarySeries("pearson", { id: "gcse" }, { month: "JUN", year: 2024, label: "June 2024" }, () => {});
      } catch (e) { window.__liveError = String(e); }
    });
    let live = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      live = await page.evaluate(async () => {
        try {
          const gb = await import("/src/tools/gradeBoundaries.js");
          const entries = gb.loadBoundaryCache().entries || {};
          const entry = Object.values(entries).find((e) => e.series && e.series.year === 2024 && String(e.series.month).toUpperCase() === "JUN");
          if (!entry || !entry.subjects || !entry.subjects.length) return { state: "waiting" };
          const h = entry.subjects.find((s) => (s.tier || "").toUpperCase() === "H" || /higher/i.test(s.title || ""));
          return { state: "done", grades: h ? h.grades : null, error: window.__liveError || null };
        } catch (e) { return { state: "error", error: String(e) }; }
      });
      if (live.state === "done" || live.state === "error") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Official Pearson June 2024 1MA1 Higher (verified from the published PDF):
    // 9=197 8=167 7=137 6=105 5=73 4=42 3=26 (U=0). No grades 2/1 for Higher.
    const OFFICIAL_2024_H = { 9: 197, 8: 167, 7: 137, 6: 105, 5: 73, 4: 42, 3: 26, U: 0 };
    const parsed = live && live.state === "done" ? live.grades : null;
    const ok = parsed != null && Object.keys(OFFICIAL_2024_H).every(
      (g) => Number(parsed[String(g)]) === OFFICIAL_2024_H[g]);
    check("LIVE Pearson Jun 2024 refetch → real parser reproduces official table",
      ok, "live=" + JSON.stringify(live));
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nE2E: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);