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
  const galleryCss = fs.readFileSync(
    path.join(scriptDir, "showcase-gallery.css"),
    "utf8"
  );

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

  const cards = versions
    .map((entry, index) => {
      const version = escapeHtml(entry.version);
      const label = escapeHtml(entry.label || entry.version);
      const description = escapeHtml(entry.description || "");
      const dateSource = entry.committedAt || entry.addedAt || "";
      const date = formatDate(dateSource);
      const commitShort = entry.commit
        ? escapeHtml(String(entry.commit).slice(0, 7))
        : "";
      const commitUrl = entry.commit
        ? `https://github.com/AIGsniperYt/neuronet/commit/${encodeURIComponent(entry.commit)}`
        : "";
      const features =
        entry.features ||
        (VERSION_META[entry.version] && VERSION_META[entry.version].features) ||
        [];
      const latest = index === versions.length - 1;
      const href = `./${encodeURIComponent(entry.version)}/`;
      const delay = (index * 0.035).toFixed(3);

      return `
        <div class="timeline-item reveal${latest ? " latest" : ""}" style="transition-delay:${delay}s">
            <div class="timeline-dot${latest ? " latest" : ""}"></div>
            <div class="timeline-card">
                <div class="timeline-header">
                    <h3>${label}</h3>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        ${date ? `<span class="timeline-date">${date}</span>` : ""}
                        <span class="timeline-version">${version}</span>
                        ${latest ? '<span class="timeline-latest">Latest</span>' : ""}
                        ${
                          commitShort
                            ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="timeline-commit">${commitShort}</a>`
                            : ""
                        }
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
                    <a href="${href}" class="btn-ghost">
                        <i class="fa-solid fa-play" style="font-size:0.7rem"></i>
                        Launch
                    </a>
                    ${
                      commitUrl
                        ? `<a href="${commitUrl}" target="_blank" rel="noopener" class="btn-ghost">
                        <i class="fa-brands fa-github" style="font-size:0.75rem"></i>
                        Commit
                    </a>`
                        : ""
                    }
                </div>
            </div>
        </div>`;
    })
    .join("");

  const empty = versions.length
    ? ""
    : `<div class="empty-state">
        <h2>No snapshots yet</h2>
        <p>Run the <strong>Deploy NeuroNet showcase</strong> workflow from the Actions tab to add one.</p>
      </div>`;

  const times = versions
    .map((entry) => Date.parse(entry.committedAt || entry.addedAt || ""))
    .filter((value) => Number.isFinite(value));
  const firstTime = times.length ? Math.min(...times) : 0;
  const lastTime = times.length ? Math.max(...times) : 0;
  const days =
    firstTime && lastTime
      ? Math.max(1, Math.round((lastTime - firstTime) / 86400000))
      : 0;
  const latestVersion = versions.length
    ? versions[versions.length - 1].version
    : "—";
  const stats = [
    { number: String(versions.length), label: "Snapshots" },
    { number: days ? String(days) : "—", label: "Days of History" },
    { number: latestVersion, label: "Latest Build" },
    { number: "Local", label: "Storage" }
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeuroNet — Version History</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
${galleryCss}
</style>
</head>
<body>

<div id="scrollProgress"></div>
<canvas id="neuralCanvas"></canvas>

<!-- Header -->
<header id="header">
    <div class="container">
        <a href="./" class="logo">
            <span class="logo-mark"></span>
            Neuro<span>Net</span>
        </a>
        <ul class="nav-links">
            <li><a href="#versions">Versions</a></li>
            <li><a href="#stats">Stats</a></li>
            <li><a href="https://aigsniperyt.github.io/">Portfolio</a></li>
            <li><button id="themeToggle" class="theme-toggle">Switch Theme</button></li>
        </ul>
    </div>
</header>

<!-- Hero -->
<section class="hero" id="hero">
    <div class="floating-shapes">
        <div class="shape shape-1"></div>
        <div class="shape shape-2"></div>
        <div class="shape shape-3"></div>
        <div class="shape shape-4"></div>
    </div>
    <div class="hero-content">
        <div class="hero-badge"><i class="fa-solid fa-brain" style="margin-right:6px"></i> Browser-based study app</div>
        <h1>NeuroNet — Version History</h1>
        <p>Every iteration of NeuroNet, from the first version to the latest build. Browse, compare, and launch any version.</p>
        <div class="hero-actions">
            <a href="#versions" class="btn-primary">
                <i class="fa-solid fa-timeline" style="font-size:0.85rem"></i>
                View Timeline
            </a>
            <a href="../" class="btn-ghost">
                Launch Latest
                <i class="fa-solid fa-arrow-right" style="font-size:0.75rem"></i>
            </a>
        </div>
    </div>
    <div class="scroll-indicator">
        <span>Scroll</span>
        <div class="line"></div>
    </div>
</section>

<!-- Section Divider -->
<div class="section-divider parallax-medium" data-speed="-0.08">
    <svg viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path d="M0,40 C240,160 480,0 720,120 C960,240 1200,20 1440,80 L1440,200 L0,200 Z" fill="var(--forest-canopy)" opacity="0.3"/>
        <path d="M0,60 C320,180 640,40 960,140 C1280,240 1360,60 1440,100 L1440,200 L0,200 Z" fill="var(--forest-understory)"/>
    </svg>
</div>

<!-- Version Timeline -->
<section class="version-timeline" id="versions">
    <div class="container">
        <h2 class="section-title reveal">Version Timeline</h2>
        <div class="timeline" id="timeline">${cards}</div>
        ${empty}
    </div>
</section>

<!-- Section Divider -->
<div class="section-divider parallax-slow" data-speed="-0.05">
    <svg viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path d="M0,20 C360,120 720,0 1080,80 C1260,120 1350,40 1440,60 L1440,200 L0,200 Z" fill="rgba(11,46,31,0.2)"/>
        <path d="M0,40 C400,160 800,20 1200,100 C1320,140 1380,60 1440,80 L1440,200 L0,200 Z" fill="var(--forest-floor)"/>
    </svg>
</div>

<!-- Stats -->
<section class="stats-section" id="stats">
    <div class="container">
        <h2 class="section-title reveal">By the Numbers</h2>
        <div class="stats-grid" id="statsGrid">${stats}</div>
    </div>
</section>

<!-- Section Divider -->
<div class="section-divider parallax-medium" data-speed="-0.07">
    <svg viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path d="M0,140 C240,60 480,180 720,100 C960,20 1200,160 1440,80 L1440,200 L0,200 Z" fill="rgba(11,46,31,0.25)"/>
        <path d="M0,160 C320,80 640,200 960,120 C1200,40 1320,160 1440,100 L1440,200 L0,200 Z" fill="var(--forest-floor)"/>
    </svg>
</div>

<!-- Footer -->
<footer>
    <div class="container">
        <div class="footer-content">
            <div class="breadcrumb">
                <a href="https://aigsniperyt.github.io/">Portfolio</a>
                <span>/</span>
                <span>Version History</span>
            </div>
            <p class="copyright">&copy; 2026 AIGsniper. NeuroNet.</p>
            <p class="copyright">Each snapshot keeps its own demo data in your browser.</p>
        </div>
    </div>
</footer>

<script src="gallery.js"></script>
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
  write(
    path.join(showcaseDir, "gallery.js"),
    fs.readFileSync(
      path.join(scriptDir, "showcase-gallery.template.js"),
      "utf8"
    )
  );
  write(path.join(showcaseDir, ".nojekyll"), "");

  if (addedVersion && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${addedVersion}\n`);
  }
}

main();
