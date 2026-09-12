// examData/sources/officialEngine.js — reusable official-source discovery
// engine. Board adapters (Pearson, AQA, …) own WHAT is relevant content; this
// module owns HOW official archives are crawled, linked, classified, ranked and
// fetched. No board-specific assumptions live here.
//
// Pipeline (item 2 of the frontier review):
//
//   link discovered on an official page
//        ↓
//   candidate resource           (kept even before any metadata is known)
//        ↓
//   cheap metadata extraction    (classifyCandidate → meta or null)
//        ↓
//   candidate ranking            (rankCandidates → ORDER ONLY, never a winner)
//        ↓
//   fetch candidate              (content-validated download)
//        ↓
//   document verification        (the adapter/ingest stage — doc identity)
//
// A candidate whose title/anchor carries no series metadata is NOT discarded:
// it is surfaced with meta === UNKNOWN_METADATA so the caller can decide
// (fetch-and-verify / surface to the user), instead of dropping evidence.
//
// Safety limits exist to protect the browser, but they are limits, not the
// definition of "archive complete": hitting one sets `incomplete: true`
// (DISCOVERY_INCOMPLETE), which the pipeline must prefer over NO_EXACT_SOURCE.

export const DISCOVERY_INCOMPLETE = "DISCOVERY_INCOMPLETE";
export const UNKNOWN_METADATA = "UNKNOWN_METADATA";

const MONTH_WORDS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"
];
const MONTH_RE = new RegExp(`(${MONTH_WORDS.join("|")})`, "i");
const QUAL_HINTS = [
  ["gcse", /gcse|(9-1)/i],
  ["alevel", /a.level|gce|advanced.level/i],
  ["as", /^as\b/i]
];

// ---- URL resolution + host verification ------------------------------------
export function resolveUrl(href, base = "") {
  if (!href) return null;
  const raw = String(href).trim();
  if (!raw || /^(mailto|javascript|tel|#)/i.test(raw)) return null;
  let out;
  try {
    out = new URL(raw, base || undefined);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(out.protocol)) return null;
  out.hash = "";
  return out.href;
}

export function verifyOfficialHost(url, hostRe) {
  return Boolean(url && hostRe && hostRe.test(url));
}

// ---- link extraction -------------------------------------------------------
// Returns [{ url, text }] for every resource-ish/no-target href found in an
// official page: anchor tags (with their clickable text) plus the Pearson UK
// "hiddenAssetTitle / hiddenAssetUrl" span pairs whose URL is typically
// relative. Relative+protocol-relative hrefs are resolved against `base`.
export function extractLinks(html, { base = "", hostRe = null } = {}) {
  if (!html) return [];
  const out = [];
  const push = (pendingUrl, text) => {
    const abs = resolveUrl(pendingUrl, base);
    if (!abs) return;
    if (hostRe && !hostRe.test(abs)) return;
    out.push({ url: abs, text: String(text || "").trim() });
  };

  // anchor tags: capture href and the contained clickable text
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of anchors) {
    const href = m[2] || m[3];
    const inner = String(m[4] || "");
    const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    push(href, text || href);
  }

  // hiddenAsset span pairs (Pearson UK asset listings): title followed by url
  const titles = [...html.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
  const urls = [...html.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1].trim());
  for (let i = 0; i < Math.min(titles.length, urls.length); i++) {
    push(urls[i], titles[i]);
  }
  return out;
}

// ---- cheap metadata classification ----------------------------------------
// Best-effort, cheap, and NEVER a reason to discard: returns { month?, year?,
// qual? } for whatever the title/anchor reveals, or null when nothing is known
// (the caller keeps the candidate and marks it UNKNOWN_METADATA). Series is
// read from the TITLE, never the filename (filename naming conventions are not
// identity). Qualification from title words only.
export function classifyCandidate(url, title, { qualFilter = null } = {}) {
  const t = String(title || "").trim();
  if (!t) return null;
  let month = null;
  let year = null;
  const mSeries = t.match(new RegExp(`${MONTH_RE.source}\\s*\\d{4}`, "i"));
  const mYear = t.match(/\b\d{4}\b/);
  const mM = t.match(MONTH_RE);
  if (mSeries) {
    const pair = mSeries[0].match(/([A-Za-z]+)\s*(\d{4})/i);
    month = monthCode(pair[1]);
    year = Number(pair[2]);
  } else {
    if (mM) month = monthCode(mM[1]);
    if (mYear) year = Number(mYear[0]);
    if (month === null && year === null) return null;
  }
  let qual = null;
  const norm = t.toLowerCase();
  for (const [q, re] of QUAL_HINTS) {
    if (re.test(norm)) { qual = q; break; }
  }
  if (qual && qualFilter && qual !== qualFilter) return null;
  return {
    month: Number.isInteger(year) ? month : null,
    year: Number.isInteger(year) ? year : null,
    qual,
    documentType: /notional/i.test(norm) ? "notional-component" : "grade-boundaries",
    international: /international|iglobal/i.test(norm)
  };
}

function monthCode(word) {
  const i = MONTH_WORDS.findIndex((m) => m.toLowerCase().startsWith(String(word || "").toLowerCase().slice(0, 3)));
  if (i < 0) return null;
  return "JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC".split(",")[i];
}

// ---- candidate ranking -----------------------------------------------------
// Evidence scoring is ONLY for ordering — "inspect A first". It never wins a
// candidate on its own; automatic resolution requires deterministic evidence
// elsewhere (exact series + qualification match, verified document identity).
// Returns a new array (same candidate objects) with a `.score` attached,
// best-first. Unknown-metadata candidates sink to the bottom but remain.
export function rankCandidates(candidates, request, { monthYearBonus = 1000, qualBonus = 500 } = {}) {
  const wantMonth = String((request && request.series && request.series.month) || "").toUpperCase();
  const wantYear = Number(request && request.series && request.series.year);
  const wantQual = (request && request.qual ? String(request.qual).toLowerCase() : null);
  return (candidates || [])
    .map((c) => {
      let score = 0;
      // Accept both raw crawl candidates ({ meta }) and already-classified
      // resources ({ month, year, qual, international }).
      const flat = c.meta ? null : {
        month: c.month ?? null, year: c.year ?? null,
        qual: c.qual ?? null, international: c.international
      };
      const meta = c.meta || flat;
      if (meta) {
        if (meta.international) score -= 1000; // home-qual request never wants iGCSE
        if (wantQual && meta.qual === wantQual) score += qualBonus;
        if (wantsSeries(wantMonth, wantYear) && meta.month === wantMonth && Number(meta.year) === wantYear) score += monthYearBonus;
        else if (meta.year !== null) score -= 1; // dated but not the requested series
      }
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}

function wantsSeries(month, year) {
  return Boolean(month && Number.isFinite(year));
}

// ---- graph crawl -----------------------------------------------------------
// Bounded-but-complete official archive crawl. Starts at `startUrls`, harvests
// candidate links from each page, follows onward links that the adapter says
// are relevant (archive/index/pagination pages), and records every candidate
// resource — even unclassifiable ones. Safety caps set `incomplete: true`.
//
//   doFetch(url) → { ok, text() } or null
//   harvest(text, url) → [{ url, text }]   (defaults to extractLinks)
//   isRelevantPage(absUrl) → follow this onward link? (adapter: relevance)
//   isResourceUrl(absUrl)  → treat as a downloadable candidate?
//   maxPages / maxResources → browser-protection caps (not completeness)
//
// Returns { resources, visited, incomplete, capped: "pages"|"resources"|null }.
// resources[i] = { url, title, raw, meta } where meta is classifyCandidate
// output or null (→ UNKNOWN_METADATA at the adapter layer).
export async function crawlOfficialIndex({
  doFetch,
  startUrls = [],
  hostRe = null,
  harvest = null,
  classify = null,
  isRelevantPage = null,
  isResourceUrl = null,
  maxPages = 300,
  maxResources = 5000,
  onProgress = null
} = {}) {
  const visited = new Set();
  const resources = [];
  const seen = new Set();
  const queue = (startUrls || []).slice();
  let cappedAt = null;

  const harvestFn = harvest || ((text, url) => extractLinks(text, { base: url, hostRe }));
  const classifyFn = classify || ((url, title) => classifyCandidate(url, title));
  const relevant = isRelevantPage || (() => true);
  const resource = isResourceUrl || ((u) => /\.pdf$/i.test(u));

  while (queue.length) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    if (visited.size >= maxPages) { cappedAt = "pages"; break; }
    visited.add(url);

    let text = null;
    try {
      const res = await doFetch(url);
      if (res && res.ok && typeof res.text === "function") text = await res.text();
    } catch {
      text = null; // best-effort crawl — a dead page is not an error
    }
    if (!text) continue;

    for (const link of harvestFn(text, url) || []) {
      const abs = resolveUrl(link.url, url);
      if (!abs || !verifyOfficialHost(abs, hostRe)) continue;
      if (resource(abs)) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        resources.push({
          url: abs,
          title: link.text || abs,
          raw: link,
          meta: classifyFn(abs, link.text)
        });
        if (resources.length >= maxResources) { cappedAt = "resources"; break; }
      } else if (relevant(abs) && !visited.has(abs) && !queue.includes(abs)) {
        queue.push(abs);
      }
    }
    if (onProgress) onProgress(`crawl: ${visited.size} page(s), ${resources.length} resource(s)`);
    if (resources.length >= maxResources) { cappedAt = "resources"; break; }
  }

  return {
    resources,
    visited: [...visited],
    incomplete: cappedAt !== null,
    capped: cappedAt
  };
}

// ---- content-validated candidate fetch -------------------------------------
// HTTP 200 is NOT acceptance (boards return HTML error pages under .pdf names
// with a 200). Verifies final URL is still on the official host, the
// content-type is PDF-family, and the %PDF magic bytes are present.
export function isPdfBuffer(buf) {
  if (!buf || buf.byteLength < 5) return false;
  const b = new Uint8Array(buf, 0, 5);
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

async function sha256Hex(bytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (subtle && subtle.digest) {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261;
  for (const byte of new Uint8Array(bytes)) { h ^= byte; h = Math.imul(h, 16777619); }
  return `faux-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export async function fetchCandidate(candidate, {
  doFetch,
  hostRe = null,
  isPdf = isPdfBuffer,
  hash = sha256Hex
} = {}) {
  const url = (candidate && candidate.url) || candidate;
  const fetchImpl = doFetch || ((u) => fetch(u));
  let res;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    return { ok: false, url, reason: "NETWORK", error: String(e && e.message || e) };
  }
  const finalUrl = res.url || url;
  if (hostRe && !verifyOfficialHost(finalUrl, hostRe)) {
    return { ok: false, url: finalUrl, status: res.status, reason: "HOST_UNVERIFIED" };
  }
  if (!res.ok) return { ok: false, url: finalUrl, status: res.status, reason: `HTTP_${res.status}` };
  const contentType = String(res.headers && res.headers.get && res.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (contentType && !/pdf|octet-stream/.test(contentType)) {
    return { ok: false, url: finalUrl, status: res.status, contentType, reason: "CONTENT_TYPE" };
  }
  if (!isPdf(bytes)) {
    return { ok: false, url: finalUrl, status: res.status, contentType, byteLength: bytes.byteLength, reason: "NOT_PDF" };
  }
  const contentHash = await hash(bytes);
  return {
    ok: true, url: finalUrl, status: res.status, contentType,
    bytes, byteLength: bytes.byteLength, contentHash,
    hostVerified: true
  };
}