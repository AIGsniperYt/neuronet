// First-party past-paper discovery.
//
// This module only discovers official paper/mark-scheme documents. It never
// guesses a grade boundary and it never accepts a non-board URL. A caller may
// provide proxyFn(url) for browser deployments where the board blocks CORS.

import { boardId, qualId, singleCode } from "./schema.js";

const HOSTS = Object.freeze({
  aqa: /^(https?:)?\/\/(?:[a-z0-9-]+\.)*aqa\.org\.uk(?::\d+)?(?:\/|$)/i,
  pearson: /^(https?:)?\/\/(?:[a-z0-9-]+\.)*pearson\.com(?::\d+)?(?:\/|$)/i,
  ocr: /^(https?:)?\/\/(?:[a-z0-9-]+\.)*ocr\.org\.uk(?::\d+)?(?:\/|$)/i
});

const AQA_API = "https://www.aqa.org.uk/api/search";
const PEARSON_INDEX = "https://qualifications.pearson.com/content/dam/grade-boundaries.json";
const OCR_RESOURCE = "https://www.ocr.org.uk/resource/filterresourcesbysubject/";

function officialUrl(board, value, base = "") {
  if (!value) return null;
  let url;
  try { url = new URL(String(value), base || undefined).href; } catch { return null; }
  return HOSTS[board] && HOSTS[board].test(url) ? url : null;
}

function monthCode(value) {
  const m = String(value || "").toLowerCase();
  return ({ january: "JAN", february: "FEB", march: "MAR", april: "APR", may: "MAY", june: "JUN", july: "JUL", august: "AUG", september: "SEP", october: "OCT", november: "NOV", december: "DEC" })[m] || String(value || "").slice(0, 3).toUpperCase();
}

function seriesFrom(text) {
  const s = String(text || "");
  const named = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (named) return { month: monthCode(named[1]), year: Number(named[2]) };
  const compact = s.match(/\b(JUN|NOV|JAN|FEB|MAR|APR|MAY|JUL|AUG|SEP|OCT|DEC)[-_ ]?(20\d{2}|\d{2})\b/i);
  return compact ? { month: monthCode(compact[1]), year: Number(compact[2].length === 2 ? `20${compact[2]}` : compact[2]) } : {};
}

function paperType(text) {
  return /mark\s*scheme|\bMS\b/i.test(String(text || "")) ? "mark-scheme" : "question-paper";
}

function normalize(board, item, base = "") {
  const title = String(item.title || item.name || item.text || "").replace(/\s+/g, " ").trim();
  const url = officialUrl(board, item.url || item.href || item.source_url, base);
  if (!url) return null;
  const series = { ...seriesFrom(`${title} ${url}`), ...(item.series || {}) };
  const code = singleCode(item.code || item.spec_code || item.specCode || "") || null;
  const id = `${board}|${code || "unknown"}|${series.month || "?"}-${series.year || "?"}|${paperType(title)}|${url}`;
  return {
    id,
    board,
    qual: qualId(item.qual || item.qualification) || null,
    courseCode: code,
    series: series.month && series.year ? series : null,
    type: paperType(title),
    title: title || url.split("/").pop(),
    url,
    paper: item.paper || item.paper_number || null,
    tier: item.tier || null,
    official: true
  };
}

async function request(url, { fetchImpl = fetch, proxyFn } = {}, init) {
  const target = proxyFn ? proxyFn(url) : url;
  const response = await fetchImpl(target, init);
  if (!response || !response.ok) throw new Error(`HTTP_${response && response.status || 0}`);
  return response;
}

async function aqa(requested, options) {
  const params = new URLSearchParams({ type: "aqaResource", scope: "findPastPapers", page: "1", limit: "100" });
  if (requested.code) params.set("specCode", singleCode(requested.code));
  const response = await request(`${AQA_API}?${params}`, options);
  const body = await response.json();
  const results = Array.isArray(body && body.results) ? body.results : [];
  return results.map((x) => normalize("aqa", {
    ...x,
    title: x.title || x.name || x.contentId,
    url: x.url || x.contentId && `https://www.aqa.org.uk/files/${x.contentId}`,
    code: requested.code,
    qual: requested.qual
  })).filter(Boolean);
}

async function pearson(requested, options) {
  const response = await request(PEARSON_INDEX, options);
  const body = await response.json();
  const records = (body && body.searchResults && body.searchResults.algoliaRecords) || (Array.isArray(body) ? body : []);
  return records.map((x) => normalize("pearson", {
    ...x,
    title: x.title || x.name,
    code: requested.code,
    qual: requested.qual
  }, PEARSON_INDEX)).filter((x) => !requested.qual || !x.qual || x.qual === requested.qual);
}

async function ocr(requested, options) {
  const form = new URLSearchParams({ qualification: requested.ocrQualification || requested.code || "", level: requested.qual === "gcse" ? "GCSE" : "A Level" });
  const response = await request(OCR_RESOURCE, { ...options, method: "POST", body: form });
  const html = await response.text();
  const out = [];
  for (const match of html.matchAll(/href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\//gi)) {
    const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const row = normalize("ocr", { title, href: match[1], code: requested.code, qual: requested.qual }, OCR_RESOURCE);
    if (row) out.push(row);
  }
  return out;
}

/** Discover official question papers and mark schemes for one course. */
export async function discoverPastPapers(requested = {}, options = {}) {
  const board = boardId(requested.board);
  const qual = qualId(requested.qual);
  if (!board || !qual) return { ok: false, reason: "INCOMPLETE_REQUEST", papers: [] };
  try {
    const papers = board === "aqa"
      ? await aqa({ ...requested, qual }, options)
      : board === "pearson"
        ? await pearson({ ...requested, qual }, options)
        : await ocr({ ...requested, qual }, options);
    const unique = [...new Map(papers.map((p) => [p.id, p])).values()];
    return { ok: true, board, qual, papers: unique, incomplete: false };
  } catch (error) {
    return { ok: false, board, qual, papers: [], reason: String(error && error.message || error) };
  }
}

export const paperFetcher = Object.freeze({ discoverPastPapers });
