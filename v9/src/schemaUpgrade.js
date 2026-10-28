/**
 * schemaUpgrade.js — automatic, idempotent upgrade of legacy export/IndexedDB
 * data to the markdown-first schema.
 *
 * WHY IT EXISTS
 *   Before the markdown editor, sources stored only contentHtml in the OLD
 *   reader space (contiguous text, no separators) and quote links carried
 *   offsets measured against THAT text. The rendered markdown reader inserts
 *   newlines between blocks, so those stored offsets drift and highlights land
 *   in the wrong place. This module rewrites a dataset in the { nodes, quotes,
 *   cues } export shape so every source carries real contentMarkdown
 *   (+ derived contentHtml/contentText), every quote link is re-anchored in
 *   the NEW reader text, and quote links get prefix/suffix fingerprints so the
 *   SSS self-healing (anchor fingerprint + relocation) actually works.
 *
 * USE
 *   - App import path: upgradeDataset(payload) runs on anything the user
 *     imports, so old JSON files uplevel on the way in.
 *   - App startup: upgradeStoredDatabase() scans IndexedDB once and upserts
 *     upgraded records in place.
 *   - The upgrade is idempotent: running it twice is a no-op.
 *
 * NOTE: findQuoteInSource / mdNormalize / htmlToMarkdown mirror their
 * analysisTool.js counterparts — keep them in sync when you change either.
 */

import { parse, render, domToMarkdown } from "./vendor/md-format/mdeditor.js";

export const SCHEMA_VERSION = 6;

/* Legacy HTML → markdown round trips leave junk the parser turns back into
 * invisible blocks: a <br> inside a blockquote becomes a hardbreak that
 * domToMarkdown serialises as an empty '> >' line, which re-parses to an
 * empty nested blockquote → blank space in the reader/preview. */
export function mdNormalize(md) {
  if (!md) return md;
  return md
    .split("\n")
    .filter((line) => !line.trim().match(/^>[\s>]*$/))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}

export function htmlToMarkdown(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return mdNormalize(domToMarkdown(div) || "");
}

export function sourceMarkdownFor(source) {
  if (!source) return "";
  let md = "";
  if (source.contentMarkdown) md = source.contentMarkdown;
  else if (source.contentHtml) md = htmlToMarkdown(source.contentHtml);
  else md = source.content || "";
  return mdNormalize(md);
}

function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

/**
 * Locate a quote inside source text. Same algorithm as analysisTool's
 * findQuoteInSource, plus a whitespace-stripped fallback that recovers legacy
 * quotes whose old reader glued words together (e.g. the speaker name and the
 * first line became "MACBETHSo foul and fair a day..." with no separator).
 */
export function findQuoteInSource(quote, sourceText) {
  if (!quote || !sourceText) return null;

  const normalize = (text) => text.split(/\s+/).filter((w) => w.length > 0).join(" ").trim();
  const normalizedQuote = normalize(quote);

  let exactPos = sourceText.indexOf(quote);
  if (exactPos !== -1) return { start: exactPos, end: exactPos + quote.length, quote };

  exactPos = sourceText.toLowerCase().indexOf(quote.toLowerCase());
  if (exactPos !== -1) {
    return {
      start: exactPos,
      end: exactPos + quote.length,
      quote: sourceText.substring(exactPos, exactPos + quote.length)
    };
  }

  const normalizedSource = normalize(sourceText);
  const normalizedPos = normalizedSource.indexOf(normalizedQuote);
  if (normalizedPos !== -1) {
    let originalStart = 0, normalizedCount = 0, inWhitespace = true;
    for (let i = 0; i < sourceText.length; i++) {
      const char = sourceText[i];
      const isWhitespace = /\s/.test(char);
      if (!isWhitespace) {
        if (inWhitespace && normalizedCount > 0) normalizedCount++;
        if (normalizedCount === normalizedPos) { originalStart = i; break; }
        normalizedCount++;
        inWhitespace = false;
      } else if (!inWhitespace) inWhitespace = true;
    }
    let quotePart = "", charCount = 0, lastWasSpace = false;
    for (let i = originalStart; i < sourceText.length && charCount < normalizedQuote.length; i++) {
      const char = sourceText[i];
      const isWhitespace = /\s/.test(char);
      if (!isWhitespace) {
        if (char.toLowerCase() === normalizedQuote[charCount].toLowerCase()) { quotePart += char; charCount++; lastWasSpace = false; }
        else if (charCount > 0) { quotePart += char; lastWasSpace = false; }
      } else if (!lastWasSpace && charCount > 0) { quotePart += " "; charCount++; lastWasSpace = true; }
    }
    quotePart = quotePart.trim();
    if (quotePart.length > 0) {
      const finalPos = sourceText.indexOf(quotePart, originalStart);
      if (finalPos !== -1) return { start: finalPos, end: finalPos + quotePart.length, quote: quotePart };
    }
  }

  const stripped = (s) => s.replace(/\s+/g, "");
  const strippedQuote = stripped(quote);
  if (strippedQuote.length < 8) return null; // too short → ambiguous
  const strippedSource = stripped(sourceText);
  const strippedIdx = strippedSource.indexOf(strippedQuote);
  if (strippedIdx === -1) return null;

  let start = -1, pos = 0, end = -1;
  for (let i = 0; i < sourceText.length && pos <= strippedIdx + strippedQuote.length; i++) {
    if (/\s/.test(sourceText[i])) continue;
    if (pos === strippedIdx && start === -1) start = i;
    pos++;
    if (pos === strippedIdx + strippedQuote.length) { end = i + 1; break; }
  }
  if (start === -1 || end <= start) return null;
  return { start, end, quote };
}

/**
 * Decide a quote's [start, end] in the given (new reader) coordinate space.
 * Keeps the stored offsets when they still match the quote text, otherwise
 * relocates by text search. Returns { state, start, end } where state is
 * "kept", "relocated" or "failed".
 */
export function relocateQuote(quoteObj, domText) {
  const quote = quoteObj?.quote || "";
  const link = quoteObj?.link || {};
  const start = Number(link.start ?? quoteObj.start ?? 0);
  const end = Number(link.end ?? quoteObj.end ?? 0);
  if (!quote) return { state: "kept", start, end };

  const norm = (t) => t.replace(/\s+/g, " ").trim();
  const strip = (t) => t.replace(/\s+/g, "");
  const slice =
    domText && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= domText.length
      ? domText.slice(start, end)
      : "";
  // Accept a slice as valid when it collapses to the quote (normal whitespace)
  // OR when it strips to the quote (legacy quotes whose old reader glued words
  // together with no separator — the window then covers e.g. "MACBETH\n\nSo…").
  const valid = !!slice && (norm(slice) === norm(quote) || strip(slice) === strip(quote));
  if (valid) return { state: "kept", start, end };

  const loc = findQuoteInSource(quote, domText);
  if (loc) return { state: "relocated", start: loc.start, end: loc.end };
  return { state: "failed", start, end };
}

/**
 * Upgrade one source node in place. Returns true if it was upgraded.
 */
export function upgradeSource(node) {
  if (!node) return false;
  if (node.contentMarkdown && node.contentHtml && node.contentText && node.meta?.schemaUpgraded) return false;
  const md = sourceMarkdownFor(node);
  const contentHtml = render(parse(md), "html") || "<p><br></p>";
  const contentText = htmlToPlainText(contentHtml);
  node.contentMarkdown = md;
  node.contentHtml = contentHtml;
  node.contentText = contentText;
  node.content = contentText;
  node.meta = node.meta || {};
  node.meta.formatVersion = 3;
  node.meta.schemaUpgraded = true;
  return true;
}

/**
 * Upgrade a dataset in the export shape { nodes, quotes, cues } in place.
 * Idempotent. Returns { dataset, stats }.
 */
export function upgradeDataset(dataset) {
  const stats = {
    sourceUpgraded: 0,
    quoteRelocated: 0,
    quoteKept: 0,
    quoteFailed: 0,
    refRelocated: 0,
    refFailed: 0
  };
  if (!dataset) return { dataset, stats };
  const nodes = Array.isArray(dataset.nodes) ? dataset.nodes : [];
  const quotes = Array.isArray(dataset.quotes) ? dataset.quotes : [];

  const byId = new Map();
  for (const node of nodes) {
    if (node.type !== "source") continue;
    if (upgradeSource(node)) stats.sourceUpgraded++;
    byId.set(node.id, node);
  }

  for (const quote of quotes) {
    if (!quote?.link?.sourceId) continue;
    const source = byId.get(quote.link.sourceId);
    if (!source) continue;
    const domText = source.contentText || "";
    const res = relocateQuote(quote, domText);
    if (res.state === "relocated") { quote.link.start = res.start; quote.link.end = res.end; stats.quoteRelocated++; }
    else if (res.state === "failed") { quote.meta = quote.meta || {}; quote.meta.relocationFailed = true; stats.quoteFailed++; }
    else stats.quoteKept++;
    if (domText) {
      quote.link.prefix = domText.substring(Math.max(0, quote.link.start - 20), quote.link.start);
      quote.link.suffix = domText.substring(quote.link.end, Math.min(domText.length, quote.link.end + 20));
    }
    quote.meta = quote.meta || {};
    quote.meta.schemaUpgrade = 1;
  }

  for (const node of nodes) {
    if (node.type !== "analysis" || !Array.isArray(node.quoteRefs)) continue;
    for (const ref of node.quoteRefs) {
      if (!ref?.sourceId || !ref.quote) continue;
      const source = byId.get(ref.sourceId);
      if (!source) continue;
      const res = relocateQuote({ quote: ref.quote, link: ref }, source.contentText || "");
      if (res.state === "relocated") { ref.start = res.start; ref.end = res.end; stats.refRelocated++; }
      else if (res.state === "failed") stats.refFailed++;
    }
  }

  dataset.schemaVersion = SCHEMA_VERSION;
  return { dataset, stats };
}

/**
 * Scan stored IndexedDB data (already read with getAllNodes/Quotes/Cues) and
 * upgrade it in place if any legacy source is present. Cheap no-op check so it
 * costs nothing on every boot.
 */
export function upgradeStoredData(nodes, quotes, cues) {
  const needsUpgrade = Array.isArray(nodes) && nodes.some((n) => n.type === "source" && !n.contentMarkdown);
  if (!needsUpgrade) return { upgraded: false, stats: null };
  const { dataset, stats } = upgradeDataset({ nodes, quotes, cues, schemaVersion: 5 });
  return { upgraded: true, stats, dataset };
}