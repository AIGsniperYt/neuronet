#!/usr/bin/env node
/**
 * Build the version showcase.
 *
 * With SNAPSHOT_DIR set, copies that checkout into SHOWCASE_DIR/<version>/,
 * patches it into an isolated offline demo, updates versions.json, and
 * regenerates the gallery. Without SNAPSHOT_DIR it only regenerates the
 * gallery from versions.json.
 *
 * Every snapshot gets its own IndexedDB name (neuronet-showcase-<version>),
 * so demo data in one version cannot touch the latest app or another version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = process.cwd();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotDir = process.env.SNAPSHOT_DIR
  ? path.resolve(cwd, process.env.SNAPSHOT_DIR)
  : "";
const showcaseDir = path.resolve(cwd, process.env.SHOWCASE_DIR || "showcase");
const requestedVersion = (process.env.VERSION || "").trim();
const requestedLabel = (process.env.LABEL || "").trim();
const requestedDescription = (process.env.DESCRIPTION || "").trim();
const ref = (process.env.REF || "").trim();
const commit = (process.env.COMMIT || "").trim();
const committedAt = (process.env.COMMITTED_AT || "").trim();

const SKIP_NAMES = new Set([
  "node_modules",
  "tests",
  "scripts",
  "docs",
  "todo.md",
  "README.md",
  "SNAPSHOTS.md",
  "LICENSE.md",
  "package.json",
  "package-lock.json"
]);

// The version numbers are not chronological (v6 and v7 landed before v2), so
// the gallery is ordered by commit date. These labels stay attached to a
// version even when the snapshot is rebuilt later.
const VERSION_META = {
  v0: {
    label: "Initial split",
    description:
      "Analysis, Memory, Mindmap and Tracker split into separate tools. Sources and quotes already live in IndexedDB.",
    features: [
      "Analysis, Memory, Mindmap and Tracker as separate tools",
      "Sources and quotes stored in IndexedDB",
      "Source-linked analysis workflow"
    ]
  },
  v1: {
    label: "Quote-first analysis",
    description:
      "The analysis tool and database cleanup pass, with quote priority and a cleaner source/quote split.",
    features: [
      "Quote priority and cleaner source/quote separation",
      "Analysis tool and database cleanup",
      "JSON import/export controls"
    ]
  },
  v2: {
    label: "Mindmap layers + physics",
    description:
      "Layered mindmap nodes, better physics, and node flagging came back.",
    features: [
      "Layered mindmap nodes",
      "Improved physics",
      "Node flagging returns",
      "Cue node groundwork"
    ]
  },
  v3: {
    label: "Memory graph overhaul",
    description:
      "A significant Memory tool update: new graph engine behaviour and a reworked interface.",
    features: [
      "Significant Memory graph engine update",
      "Reworked Memory interface",
      "Flashcard scheduling experiment",
      "View metadata from the mindmap"
    ]
  },
  v4: {
    label: "Card grading + stats",
    description:
      "Card grading, a stats menu with system reasoning, live stats, and a heap viewer debugger.",
    features: [
      "Card grading",
      "Stats menu with system reasoning",
      "Live stats and heap viewer debugger",
      "Much bigger Memory tool"
    ]
  },
  v5: {
    label: "Cue nodes + semantic tags",
    description:
      "Cue nodes, tag-driven semantic theming, and the Memory tool era.",
    features: [
      "Cue nodes",
      "Tag-driven semantic theming",
      "Cues rendered in the graph",
      "Database v8"
    ]
  },
  v6: {
    label: "The styling pass",
    description:
      "Loading screen, offline mode, animations, and a big readability and accessibility pass.",
    features: [
      "Loading screen and offline mode",
      "Styling, animation and accessibility pass",
      "Pinned tools and launchpad",
      "Better error handling and feedback"
    ]
  },
  v7: {
    label: "Canvas split",
    description:
      "The graph engine moved into canvas.js, with a reworked NeuroNet visual and more Memory tool work.",
    features: [
      "Graph engine moved into canvas.js",
      "Reworked NeuroNet visual",
      "More Memory tool work",
      "Canvas initialisation removed from the main script"
    ]
  },
  v8: {
    label: "Pre-card-first UI",
    description:
      "The last build before cards became the study unit.",
    features: [
      "Formatting and editor fixes",
      "Google Docs copy/paste toolbar",
      "Flipping freeze bug fixed",
      "Last build before the card-first rebuild"
    ]
  },
  v9: {
    label: "Card-first + Heaps",
    description:
      "Cards became the study unit, with heaps for manual study and a unified graph.",
    features: [
      "Cards became the study unit",
      "Heaps for manual study",
      "Unified graph view",
      "Grades still feed SRS scheduling"
    ]
  }
};

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function sanitizeVersion(value) {
  let cleaned = String(value || "").trim().toLowerCase();
  cleaned = cleaned.replace(/^refs\/(tags|heads)\//, "");
  cleaned = cleaned.replace(/^demo[-/]/, "");
  cleaned = cleaned.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 48) || "snapshot";
}

function detectVersion() {
  if (requestedVersion) return sanitizeVersion(requestedVersion);

  // A non-main ref is the most predictable version name: v8 stays v8, a tag
  // like demo-v10 becomes v10, and a feature branch does not overwrite the
  // main snapshot just because it inherited the same APP_VERSION.
  const refName = String(ref || "").replace(/^refs\/(tags|heads)\//, "");
  if (refName && refName !== "main" && refName !== "master") {
    return sanitizeVersion(refName);
  }

  const mainJs = read(path.join(snapshotDir, "src/main.js"));
  const appVersion = mainJs.match(/window\.APP_VERSION\s*=\s*["']([^"']+)["']/);
  if (appVersion) return sanitizeVersion(appVersion[1]);

  return sanitizeVersion(`snapshot-${(commit || Date.now().toString()).slice(0, 7)}`);
}

function copyApp(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const copyRecursive = (src, target) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      // Dotfiles/dot-directories are never part of the static app.
      if (entry.name.startsWith(".")) continue;
      if (SKIP_NAMES.has(entry.name)) continue;

      const from = path.join(src, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        copyRecursive(from, to);
      } else if (entry.isFile()) {
        fs.copyFileSync(from, to);
      }
    }
  };

  copyRecursive(snapshotDir, dest);
}

function walkFiles(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      walkFiles(full, callback);
    } else if (entry.isFile()) {
      callback(full);
    }
  }
}

function patchApp(dest, version) {
  const demoVersion = `showcase-${version}`;
  const demoDbName = `neuronet-${demoVersion}`;
  const changes = [];

  walkFiles(dest, (file) => {
    if (!file.endsWith(".js")) return;

    const rel = path.relative(dest, file).split(path.sep).join("/");
    const isMain = rel === "src/main.js" || rel === "main.js";
    const isOldScript = rel === "script.js";
    const isDb = rel === "db.js" || rel === "src/db.js";
    const isSync = rel === "sync.js" || rel === "src/sync.js";

    // Leave feature-specific backend calls (grade boundaries, scraper, exam
    // data) alone. Only the auth/sync entry points need to be forced offline.
    if (!isMain && !isOldScript && !isDb && !isSync) return;

    const before = read(file);
    let after = before;

    if (isMain || isOldScript || isSync) {
      after = after.replaceAll(
        "https://neuronet-backend.onrender.com",
        "https://showcase.invalid"
      );
    }

    if (isMain || isOldScript) {
      // Current builds use DEMO_MODE; force it on even if main ever flips it.
      after = after.replace(/const DEMO_MODE\s*=\s*(?:true|false);/g, "const DEMO_MODE = true;");
    }

    if (isMain) {
      // Current builds derive the DB name from window.APP_VERSION.
      after = after.replace(
        /window\.APP_VERSION\s*=\s*["'][^"']*["'];/g,
        `window.APP_VERSION = "${demoVersion}";`
      );
    }

    if (isDb) {
      // Older builds hard-code the main DB name. Do not touch the separate
      // exam-data database in src/tools/examData/storage.js.
      after = after.replace(
        /const DB_NAME\s*=\s*["'][^"']*["'];/g,
        `const DB_NAME = "${demoDbName}";`
      );
    }

    if (after !== before) {
      write(file, after);
      changes.push(rel);
    }
  });

  return changes;
}

function detectDemoStores(dest) {
  const source = read(path.join(dest, "src/db.js")) || read(path.join(dest, "db.js"));
  if (!source) return [];

  return ["nodes", "quotes", "cues", "tags", "cards", "heaps"].filter((name) =>
    new RegExp(`createObjectStore\\(\\s*["']${name}["']`).test(source)
  );
}

function ensureDemoData(dest) {
  const own = path.join(dest, "demo-data.json");
  if (fs.existsSync(own)) return "snapshot";

  // Old branches predate the demo dataset. Reuse the current canonical file;
  // its nodes and quotes are backwards-compatible, and newer stores are
  // filtered out by the seed script.
  const canonical = path.resolve(scriptDir, "..", "demo-data.json");
  if (!fs.existsSync(canonical)) return "";
  fs.copyFileSync(canonical, own);
  return "main";
}

function writeSeedScript(dest, version, stores) {
  if (!stores.length) return false;

  const template = read(path.join(scriptDir, "showcase-seed.template.js"));
  if (!template) return false;

  const script = template
    .replaceAll("__DB_NAME__", `neuronet-showcase-${version}`)
    .replaceAll("__VERSION__", version)
    .replaceAll("__TARGET_STORES__", JSON.stringify(stores));

  write(path.join(dest, "showcase-seed.js"), script);
  return true;
}

function injectSeedScript(dest) {
  const file = path.join(dest, "index.html");
  const html = read(file);
  if (!html || html.includes("showcase-seed.js")) return false;

  const tag = '  <script src="showcase-seed.js"></script>\n';
  const marker = /<\/body>/i;
  const output = marker.test(html)
    ? html.replace(marker, `${tag}</body>`)
    : `${html}\n${tag}`;
  write(file, output);
  return true;
}

function loadVersions() {
  const file = path.join(showcaseDir, "versions.json");
  try {
    const parsed = JSON.parse(read(file) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function versionRank(version) {
  const match = String(version || "").match(/(\d+)/);
  return match ? Number(match[1]) : -1;
}

function entryTime(entry) {
  const parsed = Date.parse(entry.committedAt || entry.addedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function saveVersions(versions) {
  versions.sort((a, b) => {
    // Oldest first, so the gallery reads like the actual build history.
    const byDate = entryTime(a) - entryTime(b);
    if (byDate) return byDate;
    const byNumber = versionRank(a.version) - versionRank(b.version);
    if (byNumber) return byNumber;
    return String(a.version).localeCompare(String(b.version));
  });
  write(
    path.join(showcaseDir, "versions.json"),
    `${JSON.stringify(versions, null, 2)}\n`
  );
  return versions;
}

function renderGallery(versions) {
  const formatDate = (value) => {
    const parsed = Date.parse(value || "");
    if (!Number.isFinite(parsed)) return "";
    return new Date(parsed).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    });
  };

  const cards = versions.map((entry, index) => {
    const version = escapeHtml(entry.version);
    const label = escapeHtml(entry.label || entry.version);
    const description = escapeHtml(entry.description || "");
    const dateSource = entry.committedAt || entry.addedAt || "";
    const date = formatDate(dateSource);
    const commitShort = entry.commit ? escapeHtml(String(entry.commit).slice(0, 7)) : "";
    const commitUrl = entry.commit
      ? `https://github.com/AIGsniperYt/neuronet/commit/${encodeURIComponent(entry.commit)}`
      : "";
    const features =
      entry.features ||
      (VERSION_META[entry.version] && VERSION_META[entry.version].features) ||
      [];
    const latest = index === versions.length - 1;
    const href = `./${encodeURIComponent(entry.version)}/`;

    return `
      <article class="timeline-item reveal${latest ? " latest" : ""}" id="${version}">
        <div class="timeline-dot${latest ? " latest" : ""}"></div>
        <div class="timeline-card">
          <div class="timeline-header">
            <h3>${label}</h3>
            <div class="timeline-tags">
              ${date ? `<span class="timeline-date">${date}</span>` : ""}
              <span class="timeline-version">${version}</span>
              ${latest ? '<span class="timeline-latest">latest snapshot</span>' : ""}
              ${commitShort ? `<a class="timeline-commit" href="${commitUrl}" target="_blank" rel="noopener" title="View commit ${commitShort}">${commitShort}</a>` : ""}
            </div>
          </div>
          <p class="timeline-description">${description}</p>
          ${
            features.length
              ? `<ul class="timeline-features">${features
                  .map((feature) => `<li>${escapeHtml(feature)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          <div class="timeline-actions">
            <a class="btn-ghost" href="${href}"><span aria-hidden="true">▶</span> Launch</a>
            ${
              commitUrl
                ? `<a class="btn-ghost" href="${commitUrl}" target="_blank" rel="noopener"><span aria-hidden="true">↗</span> Commit</a>`
                : ""
            }
          </div>
        </div>
      </article>`;
  }).join("");

  const empty = versions.length
    ? ""
    : `<div class="empty-state">
        <h2>No snapshots yet</h2>
        <p>Run the <strong>Deploy NeuroNet showcase</strong> workflow from the GitHub Actions tab to add one.</p>
      </div>`;

  const times = versions
    .map((entry) => Date.parse(entry.committedAt || entry.addedAt || ""))
    .filter((value) => Number.isFinite(value));
  const firstTime = times.length ? Math.min(...times) : 0;
  const lastTime = times.length ? Math.max(...times) : 0;
  const days = firstTime && lastTime ? Math.max(1, Math.round((lastTime - firstTime) / 86400000)) : 0;
  const latestVersion = versions.length ? versions[versions.length - 1].version : "—";
  const stats = [
    { number: String(versions.length), label: "snapshots" },
    { number: days ? String(days) : "—", label: "days of history" },
    { number: latestVersion, label: "latest build" }
  ]
    .map(
      (stat) => `
      <div class="stat-card reveal">
        <div class="stat-number">${escapeHtml(stat.number)}</div>
        <div class="stat-label">${escapeHtml(stat.label)}</div>
      </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NeuroNet — version by version</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<script>document.documentElement.classList.add("js");</script>
<style>
  :root {
    --forest-floor: #04120c;
    --forest-understory: #071f14;
    --forest-canopy: #0b2e1f;
    --forest-light: #145a32;
    --emerald: #2cffb3;
    --emerald-soft: rgba(44, 255, 179, 0.35);
    --emerald-glow: rgba(44, 255, 179, 0.2);
    --emerald-rgb: 44, 255, 179;
    --text-primary: #e6fff5;
    --text-soft: rgba(230, 255, 245, 0.85);
    --text-muted: rgba(230, 255, 245, 0.55);
    --glass-bg: rgba(7, 31, 20, 0.55);
    --glass-border: rgba(44, 255, 179, 0.12);
    --glass-border-hover: rgba(44, 255, 179, 0.3);
    --line-subtle: rgba(255, 255, 255, 0.06);
    --card-bg: rgba(7, 31, 20, 0.88);
    --panel-bg: rgba(4, 20, 13, 0.85);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    min-height: 100vh;
    overflow-x: hidden;
    color: var(--text-primary);
    font-family: "Sora", "Segoe UI", system-ui, -apple-system, sans-serif;
    font-weight: 400;
    line-height: 1.7;
    background: linear-gradient(180deg, var(--forest-understory) 0%, var(--forest-floor) 100%);
  }
  a { color: inherit; }
  #neuralCanvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }
  #scrollProgress {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    width: 0%;
    z-index: 1001;
    background: linear-gradient(90deg, var(--emerald), var(--forest-light));
    box-shadow: 0 0 10px var(--emerald-glow);
    transition: width 0.05s linear;
  }
  .container {
    width: min(1100px, calc(100% - 48px));
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }
  header {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 1000;
    padding: 16px 0;
    border-bottom: 1px solid transparent;
    transition: background 0.4s, backdrop-filter 0.4s, border-color 0.4s;
  }
  header.scrolled {
    background: rgba(4, 18, 12, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom-color: var(--glass-border);
  }
  header .container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .logo {
    display: inline-block;
    color: var(--text-primary);
    text-decoration: none;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .logo span { color: var(--emerald); }
  .logo-mark {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--emerald);
    box-shadow: 0 0 10px var(--emerald-glow);
    vertical-align: middle;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  .nav-links {
    display: flex;
    align-items: center;
    gap: 28px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nav-links a {
    color: var(--text-soft);
    text-decoration: none;
    font-size: 0.88rem;
    font-weight: 500;
    transition: color 0.3s;
  }
  .nav-links a:hover { color: var(--emerald); }
  .hero {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    position: relative;
    overflow: hidden;
    padding: 120px 0 80px;
  }
  .hero::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 40%, rgba(var(--emerald-rgb), 0.12), transparent 60%);
  }
  .hero-content {
    position: relative;
    z-index: 2;
    max-width: 820px;
  }
  .hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 18px;
    margin-bottom: 24px;
    border: 1px solid var(--glass-border);
    border-radius: 100px;
    background: var(--card-bg);
    color: var(--emerald);
    font-size: 0.8rem;
    font-weight: 500;
    backdrop-filter: blur(8px);
  }
  .hero h1 {
    margin: 0 0 20px;
    font-size: clamp(2.6rem, 6vw, 4.2rem);
    font-weight: 700;
    line-height: 1.12;
    letter-spacing: -0.04em;
  }
  .hero h1 span { color: var(--emerald); }
  .hero p {
    max-width: 640px;
    margin: 0 auto 36px;
    color: var(--text-soft);
    font-size: clamp(1rem, 2vw, 1.15rem);
    line-height: 1.8;
  }
  .hero-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .btn-primary, .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 26px;
    border-radius: 100px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: transform 0.25s, box-shadow 0.25s, background 0.25s, color 0.25s, border-color 0.25s;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--emerald), var(--forest-light));
    color: var(--forest-floor);
    border: 1px solid transparent;
    box-shadow: 0 4px 20px rgba(var(--emerald-rgb), 0.25);
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(var(--emerald-rgb), 0.35);
  }
  .btn-ghost {
    background: transparent;
    color: var(--emerald);
    border: 1.5px solid var(--emerald);
    padding: 9px 22px;
    font-size: 0.85rem;
  }
  .btn-ghost:hover {
    background: var(--emerald);
    color: var(--forest-floor);
    box-shadow: 0 0 20px var(--emerald-glow);
  }
  .scroll-indicator {
    position: absolute;
    bottom: 36px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--emerald);
    font-size: 0.72rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    text-shadow: 0 0 12px var(--emerald-glow);
    animation: bob-down 2s ease-in-out infinite, land-fade 0.8s ease 1.2s both;
  }
  .scroll-indicator .line {
    width: 1.5px;
    height: 44px;
    background: linear-gradient(to bottom, var(--emerald), transparent);
    box-shadow: 0 0 8px var(--emerald-glow);
  }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 0 0 56px;
    font-size: clamp(2rem, 4vw, 2.6rem);
    font-weight: 600;
    letter-spacing: -0.03em;
    text-align: center;
  }
  .section-title::before,
  .section-title::after {
    content: "";
    width: 60px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--emerald));
    opacity: 0.4;
  }
  .section-title::after {
    background: linear-gradient(90deg, var(--emerald), transparent);
  }
  .version-timeline {
    position: relative;
    padding: 90px 0 70px;
  }
  .timeline {
    position: relative;
    max-width: 900px;
    margin: 0 auto;
  }
  .timeline::before {
    content: "";
    position: absolute;
    left: 32px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: linear-gradient(to bottom, var(--emerald), var(--forest-light), transparent);
    opacity: 0.3;
  }
  .timeline-item {
    position: relative;
    padding-left: 80px;
    margin-bottom: 40px;
  }
  .timeline-item:last-child { margin-bottom: 0; }
  .timeline-dot {
    position: absolute;
    left: 24px;
    top: 10px;
    width: 18px;
    height: 18px;
    border: 3px solid var(--forest-floor);
    border-radius: 50%;
    background: var(--emerald);
    box-shadow: 0 0 12px var(--emerald-glow);
    z-index: 2;
  }
  .timeline-dot.latest {
    left: 21px;
    top: 7px;
    width: 24px;
    height: 24px;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  .timeline-card {
    padding: 24px 28px;
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    background: var(--card-bg);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
  }
  .timeline-card:hover {
    transform: translateX(4px);
    border-color: var(--glass-border-hover);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .timeline-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px 16px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .timeline-header h3 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .timeline-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .timeline-date {
    color: var(--text-muted);
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .timeline-version {
    padding: 3px 12px;
    border-radius: 100px;
    background: var(--emerald);
    color: var(--forest-floor);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .timeline-latest {
    padding: 3px 10px;
    border: 1px solid var(--glass-border-hover);
    border-radius: 100px;
    color: var(--emerald);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .timeline-commit {
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(var(--emerald-rgb), 0.06);
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    text-decoration: none;
  }
  .timeline-commit:hover { color: var(--emerald); }
  .timeline-description {
    margin: 0 0 12px;
    color: var(--text-soft);
    font-size: 0.92rem;
    line-height: 1.7;
  }
  .timeline-features {
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }
  .timeline-features li {
    position: relative;
    padding-left: 18px;
    margin-bottom: 4px;
    color: var(--text-soft);
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .timeline-features li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 9px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--emerald);
    opacity: 0.55;
  }
  .timeline-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .stats-section { padding: 70px 0 90px; }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 20px;
  }
  .stat-card {
    padding: 32px 20px;
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    background: var(--card-bg);
    text-align: center;
    transition: border-color 0.3s;
  }
  .stat-card:hover { border-color: var(--glass-border-hover); }
  .stat-number {
    margin-bottom: 4px;
    color: var(--emerald);
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 1.1;
  }
  .stat-label {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .note {
    max-width: 820px;
    margin: 0 auto 70px;
    padding: 18px 22px;
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    background: rgba(var(--emerald-rgb), 0.04);
    color: var(--text-soft);
    font-size: 0.88rem;
    line-height: 1.7;
  }
  .note strong { color: var(--text-primary); }
  footer {
    padding: 50px 0 32px;
    border-top: 1px solid var(--line-subtle);
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
  }
  footer p { margin: 0 0 8px; }
  footer a { color: var(--emerald); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  .empty-state {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem;
    border: 1px dashed var(--glass-border);
    border-radius: 1rem;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-state h2 { margin: 0 0 0.5rem; color: var(--text-primary); }
  .js .reveal {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .js .reveal.revealed {
    opacity: 1;
    transform: translateY(0);
  }
  @keyframes pulse-dot {
    0%, 100% { box-shadow: 0 0 6px var(--emerald-glow); }
    50% { box-shadow: 0 0 16px var(--emerald-soft); }
  }
  @keyframes bob-down {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50% { transform: translateX(-50%) translateY(8px); }
  }
  @keyframes land-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes land-up {
    from { opacity: 0; transform: translateY(34px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .hero-badge { animation: land-up 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
    .hero h1 { animation: land-up 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) 0.25s both; }
    .hero p { animation: land-up 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) 0.4s both; }
    .hero-actions { animation: land-up 0.65s cubic-bezier(0.22, 0.61, 0.36, 1) 0.55s both; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .js .reveal { opacity: 1; transform: none; transition: none; }
    .scroll-indicator { animation: none; }
    .timeline-dot.latest, .logo-mark { animation: none; }
  }
  @media (max-width: 768px) {
    .container { width: min(100% - 32px, 1100px); }
    .nav-links { display: none; }
    .timeline::before { left: 20px; }
    .timeline-item { padding-left: 56px; }
    .timeline-dot { left: 12px; }
    .timeline-dot.latest { left: 9px; }
    .timeline-card { padding: 20px; }
    .section-title { margin-bottom: 40px; }
    .section-title::before, .section-title::after { width: 36px; }
    .stats-grid { grid-template-columns: 1fr 1fr; }
    .stat-card:last-child { grid-column: 1 / -1; }
  }
</style>
</head>
<body>
  <div id="scrollProgress"></div>
  <canvas id="neuralCanvas" aria-hidden="true"></canvas>

  <header id="header">
    <div class="container">
      <a class="logo" href="./">
        <span class="logo-mark" aria-hidden="true"></span>Neuro<span>Net</span>
      </a>
      <ul class="nav-links">
        <li><a href="#versions">Versions</a></li>
        <li><a href="#stats">Stats</a></li>
        <li><a href="../">Latest app</a></li>
        <li><a href="https://github.com/AIGsniperYt/neuronet" target="_blank" rel="noopener">GitHub</a></li>
      </ul>
    </div>
  </header>

  <main>
    <section class="hero" id="hero">
      <div class="container hero-content">
        <div class="hero-badge">NeuroNet · old builds</div>
        <h1>NeuroNet, <span>version by version</span>.</h1>
        <p>
          Old builds, still working. Sorted by when they were built, not by
          version number — the numbers jumped around. Open any version and have
          a look, or jump into the latest.
        </p>
        <div class="hero-actions">
          <a class="btn-primary" href="#versions">View timeline</a>
          <a class="btn-ghost" href="../">Launch latest <span aria-hidden="true">→</span></a>
        </div>
      </div>
      <div class="scroll-indicator" aria-hidden="true">
        <span>Scroll</span>
        <div class="line"></div>
      </div>
    </section>

    <section class="version-timeline" id="versions">
      <div class="container">
        <h2 class="section-title">Version timeline</h2>
        <div class="timeline">${cards}</div>
        ${empty}
      </div>
    </section>

    <section class="stats-section" id="stats">
      <div class="container">
        <h2 class="section-title">By the numbers</h2>
        <div class="stats-grid">${stats}</div>
      </div>
    </section>

    <div class="container">
      <div class="note">
        <strong>How this works.</strong> Each snapshot is a static copy of an old
        build with its own demo data and browser database. Anything you change
        stays in that version. The latest app is the live build.
      </div>
    </div>
  </main>

  <footer>
    <div class="container">
      <p>Snapshots are generated from the git history of this repository.</p>
      <p><a href="https://github.com/AIGsniperYt/neuronet">AIGsniperYt/neuronet</a></p>
    </div>
  </footer>

  <script>
    (function () {
      var progress = document.getElementById("scrollProgress");
      var header = document.getElementById("header");
      function onScroll() {
        var doc = document.documentElement;
        var max = doc.scrollHeight - window.innerHeight;
        progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
        header.classList.toggle("scrolled", window.scrollY > 40);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();

      var revealItems = document.querySelectorAll(".reveal");
      if ("IntersectionObserver" in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          });
        }, { threshold: 0.08 });
        revealItems.forEach(function (item) { observer.observe(item); });
      } else {
        revealItems.forEach(function (item) { item.classList.add("revealed"); });
      }

      var canvas = document.getElementById("neuralCanvas");
      var ctx = canvas && canvas.getContext("2d");
      if (!ctx) return;
      var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var width = 0;
      var height = 0;
      var nodes = [];
      var frame = 0;

      function makeNodes() {
        var count = Math.max(28, Math.min(80, Math.floor((width * height) / 26000)));
        nodes = [];
        for (var i = 0; i < count; i += 1) {
          nodes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.18,
            vy: (Math.random() - 0.5) * 0.18,
            r: Math.random() * 1.6 + 0.8
          });
        }
      }

      function resize() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        makeNodes();
      }

      function draw() {
        ctx.clearRect(0, 0, width, height);
        var maxDist = Math.min(150, Math.max(90, width / 10));
        for (var i = 0; i < nodes.length; i += 1) {
          var a = nodes[i];
          for (var j = i + 1; j < nodes.length; j += 1) {
            var b = nodes[j];
            var dx = a.x - b.x;
            var dy = a.y - b.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDist) continue;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = "rgba(44,255,179," + ((1 - dist / maxDist) * 0.12) + ")";
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
        for (var k = 0; k < nodes.length; k += 1) {
          var node = nodes[k];
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(44,255,179,0.5)";
          ctx.shadowBlur = 8;
          ctx.shadowColor = "rgba(44,255,179,0.35)";
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      function tick() {
        if (!reduced) {
          for (var i = 0; i < nodes.length; i += 1) {
            var node = nodes[i];
            node.x += node.vx;
            node.y += node.vy;
            if (node.x < -20) node.x = width + 20;
            if (node.x > width + 20) node.x = -20;
            if (node.y < -20) node.y = height + 20;
            if (node.y > height + 20) node.y = -20;
          }
        }
        draw();
        if (!reduced) frame = window.requestAnimationFrame(tick);
      }

      resize();
      tick();
      window.addEventListener("resize", function () {
        window.cancelAnimationFrame(frame);
        resize();
        tick();
      });
    })();
  </script>
</body>
</html>
`;
}

function main() {
  fs.mkdirSync(showcaseDir, { recursive: true });

  let addedVersion = "";
  if (snapshotDir && fs.existsSync(snapshotDir)) {
    const version = detectVersion();
    const dest = path.join(showcaseDir, version);
    copyApp(dest);
    const changes = patchApp(dest, version);
    const demoData = ensureDemoData(dest);
    const demoStores = detectDemoStores(dest);
    const seeded = writeSeedScript(dest, version, demoStores) && injectSeedScript(dest);

    const meta = VERSION_META[version] || {};
    const entry = {
      version,
      label: requestedLabel || meta.label || `Version ${version}`,
      description:
        requestedDescription ||
        meta.description ||
        `Snapshot of ${ref || "the repository"}${commit ? ` at ${commit.slice(0, 7)}` : ""}.`,
      ref: ref || "",
      commit: commit || "",
      committedAt: committedAt || "",
      addedAt: new Date().toISOString(),
      path: `${version}/`,
      features: meta.features || []
    };

    write(
      path.join(dest, "showcase-meta.json"),
      `${JSON.stringify(entry, null, 2)}\n`
    );

    const versions = loadVersions().filter((item) => item.version !== version);
    versions.push(entry);
    saveVersions(versions);

    addedVersion = version;
    console.log(
      `Added ${version} from ${ref || "snapshot"}` +
        (changes.length ? ` (patched ${changes.join(", ")})` : " (no patches needed)")
    );
    console.log(
      seeded
        ? `Demo seed enabled from ${demoData === "snapshot" ? "the snapshot" : "main"} (${demoStores.join(", ")})`
        : "Demo seed disabled (no demo data or database schema found)"
    );
  } else {
    console.log("No snapshot supplied; regenerating gallery only.");
  }

  const versions = loadVersions();
  write(path.join(showcaseDir, "index.html"), renderGallery(versions));
  write(path.join(showcaseDir, ".nojekyll"), "");

  if (addedVersion && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${addedVersion}\n`);
  }
}

main();
