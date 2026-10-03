// boundaryDebug.js — dev instrumentation for boundary acquisition.
//
// Answers the question "why does this row say Boundary: — when the picker shows
// the data?" without guessing. Two views:
//
//   fetch toast  — every network attempt the engine makes, in order, with the
//                  proxy/direct route and the outcome. The gradient sweep style
//                  is the same one the tracker's log line uses.
//   inspector    — for one subject + year + series, why the decision is
//                  official or unknown, and if unknown, which step refused.
//
// Everything is best-effort and self-contained: it attaches nothing unless
// enabled, and never affects a decision.

import {
  onFetchLog, fetchLog, clearFetchLog,
  getBoundaries, boundaryKey, cachedBoundary, cachedBoundariesForCourse
} from "./boundaries.js";
import { findSubjects, matchSubjects } from "./subjects.js";

const CSS = `
.bd-toast-wrap{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(520px,92vw);
  display:flex;flex-direction:column;gap:6px;pointer-events:none}
.bd-toast{display:flex;flex-direction:column;gap:2px;padding:8px 11px;border-radius:10px;
  background:linear-gradient(135deg,var(--panel-strong,#1a1a1a),#121212);
  border:1px solid rgba(44,255,179,.22);box-shadow:0 8px 26px rgba(0,0,0,.45);
  font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden}
.bd-toast-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-toast-pending .bd-toast-line{background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
  animation:bdSweep 1.25s linear infinite;
  background-image:linear-gradient(100deg,rgba(230,255,245,.55) 30%,rgba(44,255,179,.95) 50%,rgba(230,255,245,.55) 70%)}
@keyframes bdSweep{0%{background-position:200% 0}100%{background-position:-200% 0}}
.bd-toast-ok{border-color:rgba(44,255,179,.4)}
.bd-toast-bad{border-color:rgba(255,120,120,.45)}
.bd-toast-meta{color:rgba(230,255,245,.5)}
.bd-inspect{margin:6px 0 0;padding:10px;border-radius:10px;
  background:linear-gradient(135deg,var(--panel-strong,#1a1a1a),#121212);
  border:1px solid rgba(44,255,179,.2);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;word-break:break-word;color:rgba(230,255,245,.85)}
.bd-inspect b{color:#2cffb3}
.bd-inspect .bd-no{color:#ff9b9b}
.bd-inspect .bd-yes{color:#8affd0}
`;

let styleInjected = false;
function ensureStyle() {
  if (styleInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

// ---------------------------------------------------------------------------
// fetch toast
// ---------------------------------------------------------------------------

let toastHost = null;
let toasts = [];
const MAX_TOASTS = 4;

function host() {
  if (toastHost && toastHost.isConnected) return toastHost;
  toastHost = document.createElement("div");
  toastHost.className = "bd-toast-wrap";
  document.body.appendChild(toastHost);
  return toastHost;
}

function shortUrl(url) {
  try {
    const u = new URL(url, location.href);
    const p = u.pathname.split("/").filter(Boolean).pop() || u.host;
    return p.length > 34 ? p.slice(0, 32) + "…" : p;
  } catch { return String(url).slice(0, 34); }
}

function renderToast(t) {
  const node = document.createElement("div");
  node.className = "bd-toast" + (t.state === "ok" ? " bd-toast-ok" : t.state === "bad" ? " bd-toast-bad" : " bd-toast-pending");
  const head = document.createElement("div");
  head.className = "bd-toast-line bd-toast-pending";
  head.textContent = `GET ${t.host}  ${shortUrl(t.url)}`;
  if (t.state !== "pending") {
    head.classList.remove("bd-toast-pending");
    head.textContent = `${t.state === "ok" ? "OK " : "ERR"} ${t.host}  ${shortUrl(t.url)}`;
  }
  const meta = document.createElement("div");
  meta.className = "bd-toast-line bd-toast-meta";
  meta.textContent = t.state === "pending"
    ? "fetching…"
    : `${t.ms}ms${t.bytes ? ` · ${(t.bytes / 1024).toFixed(0)} KB` : ""}${t.error ? ` · ${t.error}` : ""}`;
  node.appendChild(head);
  node.appendChild(meta);
  return node;
}

function pushToast(t) {
  ensureStyle();
  const h = host();
  const entry = { ...t, state: t.ok ? "ok" : "bad" };
  toasts.push(entry);
  const node = renderToast(entry);
  h.appendChild(node);
  while (toasts.length > MAX_TOASTS) {
    const old = toasts.shift();
    const oldNode = old && old.node;
    if (oldNode && oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
    else if (h.firstChild) h.removeChild(h.firstChild);
  }
  // Keep the node reference on the entry so eviction removes the right element.
  toasts[toasts.length - 1].node = node;
}

/** Enable the fetch toast. Returns a stop() function. */
export function enableFetchToast() {
  ensureStyle();
  clearFetchLog();
  const off = onFetchLog((e) => pushToast(e));
  return off;
}

// ---------------------------------------------------------------------------
// boundary inspector
// ---------------------------------------------------------------------------

/**
 * Explain what happens for one request, step by step. Read-only: it fetches
 * through the same path the app uses, so an explanation never differs from
 * what the app would do.
 *
 * @returns {Promise<{lines:string[], ok:boolean, key:string|null}>}
 */
export async function inspect({ board, qual, code, tier, year, series } = {}) {
  const lines = [];
  const key = boundaryKey({ board, qual, code, tier, year, series });

  lines.push(`request   ${[board, qual, code, tier || "(no tier)", year, series || "(no series)"].filter(Boolean).join("  ")}`);

  if (!key) {
    lines.push("key       ✗ refused — the request is not fully specified");
    lines.push("          every field must be present: a blank series, unknown");
    lines.push("          series word, missing year or unknown board cannot be");
    lines.push("          resolved, and is never guessed.");
    return { lines, ok: false, key: null };
  }
  lines.push(`key       ${key}`);
  lines.push("          identity is exact, so this can only ever match its own table");

  const cached = cachedBoundary(key);
  if (cached) {
    lines.push(`cache     ✓ already fetched (${cached.grades.length} grades, max ${cached.maxMark})`);
    lines.push(`          ${cached.grades.map((g, i) => `${g}=${cached.marks[i]}`).join("  ")}`);
    return { lines, ok: true, key };
  }
  lines.push("cache     · not fetched yet");

  const known = cachedBoundariesForCourse({ board, qual, code, tier });
  if (known.length) {
    lines.push(`          this course has ${known.length} other exact series cached:`);
    for (const t of known.slice(0, 8)) {
      lines.push(`            ${t.month}-${t.year}  ${t.grades.map((g, i) => `${g}=${t.marks[i]}`).join(" ")}`);
    }
  } else {
    lines.push("          this course has no cached series yet");
  }

  lines.push("fetch     · going to the board's own publication…");
  const table = await getBoundaries({ board, qual, code, tier, year, series });

  if (!table) {
    lines.push("result    ✗ null — no official table for this exact request");
    lines.push("          the board published nothing matching this identity, the");
    lines.push("          PDF could not be reached (see the fetch log above), or the");
    lines.push("          row was not present in it. Nothing is substituted:");
    lines.push("          no other year, series, tier or board is tried.");
    const log = fetchLog();
    if (log.length) {
      const last = log[log.length - 1];
      lines.push(`          last attempt: ${last.ok ? "ok" : "failed"} ${last.host} ${last.error || ""}`.trimEnd());
    }
    return { lines, ok: false, key };
  }

  lines.push("result    ✓ official");
  lines.push(`          max mark ${table.maxMark}`);
  lines.push(`          ${table.grades.map((g, i) => `${g}=${table.marks[i]}`).join("  ")}`);
  if (table.source) {
    lines.push(`          source   ${table.source.publisher}${table.source.url ? ` · ${shortUrl(table.source.url)}` : ""}`);
  }
  return { lines, ok: true, key };
}

/** Render an inspector report into a host element. */
export async function renderInspector(hostEl, request) {
  ensureStyle();
  const { lines, ok } = await inspect(request);
  const cls = ok ? "bd-yes" : "bd-no";
  hostEl.innerHTML =
    `<div class="bd-inspect"><b>boundary inspector</b>\n` +
    lines.map((l) => `<span class="${l.trim().startsWith("result") ? cls : ""}">${escapeHtml(l)}</span>`).join("\n") +
    `</div>`;
  return { lines, ok };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Explain a whole subject: which of its sittings have real data and which do
 * not. This is the "why is one row null when the picker has the others" view.
 */
export async function inspectSubject({ board, qual, code, tier, sittings = [] } = {}) {
  const out = [];
  let withData = 0;
  for (const s of sittings) {
    const r = await inspect({ board, qual, code, tier, year: s.year, series: s.series });
    if (r.ok) withData++;
    out.push(`${s.year} ${s.series || ""}`.padEnd(18) + (r.ok ? `✓ ${r.lines.find((l) => l.includes("="))?.trim() || ""}` : "✗ null"));
  }
  return { rows: out, withData, total: sittings.length };
}

export { fetchLog, clearFetchLog };