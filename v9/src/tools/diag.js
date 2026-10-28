// diag.js - console diagnostics for boundary problems.
// Prefixes: B?=boundary engine  C?=subject linking  R?=render  E?=environment
// Enable: window.NEURONET_DIAG = true, then reload. Or open page with ?diag=1
// Then run nnDiag.report() and copy the output.

const KEY = "neuronet:boundaries";
const buffer = [];
let enabled = false;

const COLORS = { B: "#2cffb3", C: "#7cc4ff", R: "#ffc857", E: "#ff9b9b" };

export function diag(scope, message, data) {
  buffer.push({ scope: scope, message: message, data: data });
  if (buffer.length > 3000) buffer.shift();
  if (!enabled) return;
  const t = "%c" + scope;
  const s = "color:" + (COLORS[scope.charAt(0)] || "#ffffff") + ";font-weight:700";
  if (data === undefined) console.log(t, s, message);
  else console.log(t, s, message, data);
}

export function diagReport() {
  const lines = buffer.map(function (l) {
    var d = "";
    if (l.data !== undefined) {
      try {
        d = " " + (typeof l.data === "string" ? l.data : JSON.stringify(l.data));
      } catch (e) {
        d = " [unserialisable]";
      }
    }
    return l.scope + " " + l.message + d;
  });
  return ["===== NEURONET DIAG =====", "entries: " + buffer.length]
    .concat(lines, ["===== END ====="])
    .join("\n");
}

export function install() {
  if (typeof window === "undefined") return false;
  if (typeof window.NEURONET_DIAG === "boolean") enabled = window.NEURONET_DIAG;
  try {
    const q = new URL(location.href).searchParams.get("diag");
    if (q === "1") enabled = true;
    if (q === "0") enabled = false;
  } catch (e) { /* ignore */ }
  window.NEURONET_DIAG = enabled;
  if (enabled) {
    if (!window.__nnDiagReady) {
      window.__nnDiagReady = true;
      window.nnDiag = {
        report: diagReport,
        log: function () { diag("E? ", Array.prototype.join.call(arguments, " ")); },
        cache: reportCache,
        tables: reportTables,
        env: reportEnv
      };
      window.addEventListener("error", function (e) {
        diag("E? ", "UNCAUGHT " + e.message, e.filename + ":" + e.lineno);
      });
      window.addEventListener("unhandledrejection", function (e) {
        const r = e.reason;
        diag("E? ", "UNHANDLED REJECTION " + (r && r.message ? r.message : String(r)));
      });
    }
    diag("E? ", "diagnostics enabled");
  }
  return enabled;
}

export function reportEnv() {
  const out = {
    hasLocalStorage: typeof localStorage !== "undefined",
    hasIndexedDB: typeof indexedDB !== "undefined",
    hasFetch: typeof fetch !== "undefined",
    proxyBase: (typeof window !== "undefined" && window.__NEURONET_PROXY_BASE) ||
      (document.querySelector('meta[name="neuronet-proxy"]') || {}).content ||
      "(default)",
    page: location.href
  };
  diag("E? ", "environment", out);
  return out;
}

export function reportCache() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) {
    diag("B? ", "localStorage blocked: " + e.message); return [];
  }
  if (!raw) { diag("B? ", "no boundary cache yet"); return []; }
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) {
    diag("B? ", "cache CORRUPT: " + e.message); return [];
  }
  const keys = Object.keys(parsed.tables || {});
  diag("B? ", "cache has " + keys.length + " table(s)", keys.slice(0, 30));
  return keys;
}

export function reportTables() {
  const keys = reportCache();
  if (!keys.length) return;
  let parsed = null;
  try { parsed = JSON.parse(localStorage.getItem(KEY)); } catch (e) { return; }
  for (const k of keys) {
    const t = parsed.tables[k];
    const rows = t.grades.map(function (g, i) { return g + "=" + t.marks[i]; }).join(" ");
    diag("B? ", k + " -> " + rows);
  }
}
