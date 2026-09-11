// PDF grade-boundary extraction for OCR and Pearson (Edexcel).
// Uses vendored pdf.js to extract text with layout-preserving line
// reconstruction, then board-specific row parsers to identify subject rows.
//
// Line model: each layout line is { page, y, items: [{x, str}] } with items
// sorted by x. Board files are text-based (not scans), so text extraction is
// reliable; column alignment is not needed beyond token order.

let pdfjs = null;

async function ensurePdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdfjs/index.js");
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  return pdfjs;
}

// ---------- layout line reconstruction ----------

// Cluster text items into lines by y-coordinate (within tolerance),
// items sorted by x within each line, reading top-to-bottom.
function buildLayoutLines(pageResults) {
  const all = [];
  for (const { page, items } of pageResults) {
    for (const it of items) {
      const str = it.str?.trim();
      if (!str || str.length === 0) continue;
      all.push({ page, x: it.transform[4], y: it.transform[5], str });
    }
  }
  all.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const lines = [];
  let cur = [];
  let curY = null;
  let curPage = -1;
  const TOL = 3;

  for (const it of all) {
    if (it.page === curPage && curY !== null && Math.abs(it.y - curY) < TOL) {
      cur.push(it);
      curY = (curY + it.y) / 2;
    } else {
      if (cur.length) lines.push({ page: curPage, y: Math.round(curY), items: cur });
      cur = [it];
      curY = it.y;
      curPage = it.page;
    }
  }
  if (cur.length) lines.push({ page: curPage, y: Math.round(curY), items: cur });

  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    return l;
  });
}

// ---------- PDF fetch + extract ----------

// `proxyFn(url)` maps a target URL through the CORS proxy; returns the
// proxied absolute URL. We fetch through it so the browser can read the file.
// Optional `onProgress(page, total)` fires per page for live progress feedback.
export async function extractPdfLayoutLines(url, proxyFn, onProgress) {
  const res = await fetch(proxyFn(url));
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching PDF`);
  return extractPdfLayoutLinesFromBuffer(await res.arrayBuffer(), onProgress);
}

// Buffer-based extraction (used by the canonical ingestion pipeline, which
// validates magic bytes and content-hashes BEFORE handing bytes to the parser).
export async function extractPdfLayoutLinesFromBuffer(buffer, onProgress) {
  const lib = await ensurePdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pageResults = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pageResults.push({ page: p, items: tc.items });
    if (onProgress) onProgress(p, doc.numPages);
  }
  return buildLayoutLines(pageResults);
}

// ---------- shared row utilities ----------

// Subject/qual code shapes:
//   OCR: J198 (GCSE), H407 (A-level), J111, H460...
//   Pearson: 1BI0/1AA0 (GCSE), 8BN0 (AS), 9AA0 (A-level), 2AS0, 2BI0...
// Both are 4-5 alphanumeric chars beginning with a letter or digit and
// containing at least one digit; pure words like "Option"/"Overall"/"Subject"
// are excluded by requiring any digit and no vowels-only shape.
const CODE_RE = /^[A-Z0-9]{4,6}$/;

function isCode(tok) {
  return CODE_RE.test(tok) && /\d/.test(tok) && !/^(Option|Overall|Subject|Raw|Paper)/.test(tok);
}

function isNumber(tok) {
  return /^-?\d+$/.test(tok);
}

function lineTokens(line) {
  return line.items.map((it) => it.str.trim()).filter((s) => s.length > 0);
}

// Detect the grade-label column header on a line like
//   Max Mark  9  8  7  6  5  4  3  2  1  u
//   Max Mark  a*  a  b  c  d  e  u
// and return the grade label at each column x-position. The whole-file column
// layout is fixed, so values in tiered rows (which right-align to only the
// grades that apply to that tier) can be mapped to their true label instead
// of being read positionally.
function extractGradeColumns(line) {
  const items = line.items || [];
  let markIdx = -1;
  for (let i = 0; i < items.length; i++) {
    const s = String(items[i].str || "").trim();
    if (s === "Mark" || s === "Max Mark") { markIdx = i; break; }
  }
  if (markIdx < 0) {
    const lead = items[0] && String(items[0].str || "").trim();
    if (lead && /^Max\s*Mark$/i.test(lead)) markIdx = 0;
  }
  if (markIdx < 0) return null;
  const cols = [];
  for (let i = markIdx + 1; i < items.length; i++) {
    const s = String(items[i].str || "").trim();
    if (!LABEL_RE.test(s)) break;
    cols.push({ x: items[i].x, label: normalizeLabel(s) });
  }
  return cols.length >= 3 ? cols : null;
}

// Map a data row's numeric value items to grade labels by column x-position,
// returning the grades object keyed by label. Only columns that actually hold
// a numeric value are recorded, so tiered rows that right-align values (e.g.
// OCR/Pearson Foundation) produce a correct max grade (5..U) instead of being
// lent the full 9..1 label range.
function alignGradeValues(items, columns) {
  if (!columns || !columns.length) return null;
  const used = new Set();
  const grades = {};
  const numeric = items
    .map((it, i) => ({ i, x: it.x !== undefined ? it.x : -1, v: Number(String(it.str || "").trim()) }))
    .filter((o) => /^-?\d+$/.test(String(items[o.i].str || "").trim()));
  numeric.sort((a, b) => a.x - b.x);
  for (const o of numeric) {
    let best = null;
    let bestD = Infinity;
    for (let c = 0; c < columns.length; c++) {
      if (used.has(c)) continue;
      const d = Math.abs(o.x - columns[c].x);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best !== null && bestD <= 20) {
      used.add(best);
      grades[columns[best].label] = o.v;
    }
  }
  return Object.keys(grades).length ? grades : null;
}

// Normalise a tier marker for a subject row: "F" / "H" / null.
function tierFromRow(lineTokens) {
  for (const t of Array.isArray(lineTokens) ? lineTokens : []) {
    if (t === "F" || t === "H") return t;
  }
  return null;
}

function tierFromTitle(title) {
  const t = String(title || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t) || /\(F\)/i.test(t)) return "F";
  return null;
}

// AQA subject codes embed the tier (8300F / 8300H); OCR/Pearson rows carry it
// in the title. Keep tier resolution on the parsed row so gradeBoundaries.js
// courseTierOf can rely on the explicit `tier` field across every board.
function tierFromCodeOrTitle(code, title) {
  const c = String(code || "").trim().toUpperCase();
  if (/H$/.test(c)) return "H";
  if (/F$/.test(c)) return "F";
  return tierFromTitle(title);
}

// Map OCR lowercase grade labels to display labels.
const LABEL_RE = /^(9|8|7|6|5|4|3|2|1|u|A\*|a\*|A|B|C|D|E)$/i;

function normalizeLabel(tok) {
  if (tok === "u") return "U";
  if (tok.toLowerCase() === "a*") return "A*";
  if (/^[a-e]$/i.test(tok)) return tok.toUpperCase();
  if (/^[1-9]$/.test(tok)) return tok;
  return tok;
}

// Detect the grade-label header from a line containing "Mark", e.g.
//   Max Mark  9  8  7  6  5  4  3  2  1  u
//   Max Mark  a*  a  b  c  d  e  u
//   Max Mark  a*   a   b   c   d   e   u
// Returns array of normalized label strings, or null.
function detectGradeLabels(tokens) {
  // OCR may merge "Max Mark" into a single token after layout extraction.
  let i = tokens.indexOf("Mark");
  if (i < 0) i = tokens.indexOf("Max Mark");
  if (i < 0) {
    // "Max Mark 9 8 7 ..." also appears as a single leading token in some files.
    const lead = tokens[0];
    if (typeof lead === "string" && /^Max\s*Mark$/i.test(lead)) i = 0;
  }
  if (i < 0) return null;
  const after = tokens.slice(i + 1).filter((t) => t.length > 0);
  const out = [];
  for (const t of after) {
    if (!LABEL_RE.test(t)) break;
    out.push(normalizeLabel(t));
  }
  return out.length >= 3 ? out : null;
}

// ---------- board: AQA (legacy PDF, pre-2022) ----------

// AQA pre-2022 files are layout-based PDFs with a repeating header every ~45
// rows:
//   Subject                                             Maximum    Grade Boundaries
//    Code     Subject Title                               Mark      9  8  7  6  5  4  3  2  1
//   8201     ART & DESIGN (ART CRAFT & DESIGN)            480      403 371 340 306 273 240 175 110 45
// GCSE rows may carry a tier suffix (F/H) and use "-" for marks not applicable
// to that tier. A-level rows use A*..E; AS uses A..E. Values may be grouped
// across wrapped lines, so we merge continuation rows that start with a weight
// column (e.g. "2357 4701 ..." component rows) — but for subject grade
// boundaries we only want the subject-level rows, which start with a code.
const AQA_GCSE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
const AQA_ALEVEL_LABELS = ["A*", "A", "B", "C", "D", "E", "U"];
const AQA_AS_LABELS = ["A", "B", "C", "D", "E", "U"];

// Merge a run of layout lines into a single string per line (space-joined),
// so wrapped subject rows are easy to re-assemble.
function aqaLinesToText(lines) {
  return lines.map((l) => lineTokens(l).join(" "));
}

function parseAqaPdf(lines, qual) {
  const subjects = [];
  const gradeLabels =
    qual === "gcse" ? AQA_GCSE_LABELS
    : qual === "as" ? AQA_AS_LABELS
    : AQA_ALEVEL_LABELS;

  // Detect the current grade-labels from the most recent "Mark" header.
  let currentGrades = gradeLabels;
  const textLines = aqaLinesToText(lines);

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    const toks = line.trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;

    // Header line carries "Mark" + the numeric/letter labels -> set current.
    const markIdx = toks.indexOf("Mark");
    if (markIdx >= 0) {
      const detected = detectGradeLabels(toks);
      if (detected) currentGrades = detected;
      continue;
    }

    // Subject rows begin with a code (4-6 alnum, contains a digit).
    if (!isCode(toks[0])) continue;

    // Find the maximum-mark token: it's the first 1-3 digit integer that is
    // immediately followed by the grade labels. If already found, skip NULL.
    // Scan forward: max mark is a positive integer appearing before the grades.
    let maxMark = -1;
    let gradesStart = -1;
    for (let t = 1; t < toks.length; t++) {
      if (isNumber(toks[t]) && Number(toks[t]) > 2) {
        // Candidate max mark; grades follow after it.
        maxMark = Number(toks[t]);
        gradesStart = t + 1;
        break;
      }
    }
    if (maxMark <= 0 || gradesStart < 0) continue;

    // Title = tokens between the code and the max mark.
    const title = toks.slice(1, toks.indexOf(String(maxMark))).join(" ").trim();
    if (!title) continue;

    const grades = {};
    const marksOrder = [];
    for (let g = 0; g < currentGrades.length && gradesStart + g < toks.length; g++) {
      const raw = toks[gradesStart + g];
      if (raw === "-") continue;
      const v = Number(raw);
      if (isFinite(v)) {
        grades[currentGrades[g]] = v;
        marksOrder.push(currentGrades[g]);
      }
    }

    subjects.push({
      board: "aqa",
      qual,
      code: toks[0],
      title,
      tier: tierFromCodeOrTitle(toks[0], title),
      maxMark,
      grades,
      gradesInOrder: marksOrder
    });

    // Skip the continuation row (component sub-rows) if present.
    while (i + 1 < textLines.length) {
      const next = textLines[i + 1].trim().split(/\s+/).filter(Boolean);
      if (next.length > 0 && !isCode(next[0]) && !/[A-Za-z]/.test(next[0][0]) && Number.isFinite(Number(next[0]))) {
        i++;
      } else break;
    }
  }
  return subjects;
}

// ---------- board: OCR ----------
// OCR grade-boundary files are per-qualification blocks headed by a subject
// title (e.g. "GCSE English Language"). Each block contains component rows:
//   J351  01  Communicating information and ideas   Raw    80   66  61 ...
// and qualification ("Overall") rows, which for A-level carry NO code:
//   Option A: 11+21   Overall  196  168  144 ...
// GCSE Overall rows DO carry the code:  J351   Overall  160  132 ...
// We therefore only accept Overall rows, falling back to the most recent code
// seen in a Raw row within the current subject block.
const OCR_GCSE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
const OCR_ALEVEL_LABELS = ["A*", "A", "B", "C", "D", "E", "U"];

// Track blocks for OCR: a new subject block starts when a line like
//   "A Level Ancient History"  /  "GCSE English Language"
// appears (title only, no code/mark). We capture the title to label data rows
// that have no code of their own (A-level Overall rows).
function parseOcr(lines, qual) {
  const subjects = [];
  const gradeLabels = qual === "gcse" ? OCR_GCSE_LABELS : OCR_ALEVEL_LABELS;
  let blockTitle = null;
  let blockCode = null;
  let blockComponents = [];
  let currentGrades = gradeLabels;
  let currentColumns = null;

  for (const line of lines) {
    const toks = lineTokens(line);
    if (toks.length === 0) continue;

    // Detect block header: a short line with no "Mark", no code, no numbers
    // that names a subject/qualification block.
    if (
      toks.length <= 8 &&
      !toks.some(isNumber) &&
      !isCode(toks[0]) &&
      !toks.includes("Mark") &&
      !/\bMark\b/i.test(toks.join(" ")) &&
      /(GCSE|Level|GCE|with|and|Modern|Ancient|The|Option|Raw|Overall|Mathematics|English|for)/i.test(toks.join(" "))
    ) {
      blockTitle = toks.join(" ");
      blockCode = null;
      blockComponents = [];
      continue;
    }

    // Filter blocks by qualification: the "AS and A level" PDF mixes both.
    if (blockTitle && (qual === "gcse" || qual === "as" || qual === "aLevel")) {
      const isAsBlock = /^AS\b|^AS GCE/.test(blockTitle);
      const isALevelBlock = /^A Level\b|^A2\b/.test(blockTitle);
      const isGcseBlock = /^GCSE\b/.test(blockTitle);
      if (qual === "as" && !isAsBlock) continue;
      if ((qual === "aLevel" || qual === "gcse") && isAsBlock) continue;
      if (qual === "aLevel" && isGcseBlock) continue;
      if (qual === "gcse" && isALevelBlock) continue;
    }

    // Detect the grade-label header line and capture its column x-positions.
    // Tiered rows right-align values to only the grades that apply to that
    // tier, so aligning by x (not position) keeps Foundation max at 5 while
    // Higher tops out at 9.
    const detected = detectGradeLabels(toks);
    if (detected) {
      currentGrades = detected;
      currentColumns = extractGradeColumns(line);
      continue;
    }

    const first = toks[0];
    // Component (Raw) rows carry the code; use them to anchor the block code
    // and to capture per-paper maxima/labels for the paper-slot editor.
    if (isCode(first) && toks.includes("Raw")) {
      blockCode = first;
      const rawIdx = toks.indexOf("Raw");
      if (rawIdx > 2) {
        const id = toks[1];
        const label = toks.slice(2, rawIdx).join(" ");
        const compMax = parseInt(toks[rawIdx + 1], 10);
        if (id && label && isFinite(compMax) && compMax > 0 && !blockComponents.some((p) => p.id === id)) {
          blockComponents.push({ id, label, maxMark: compMax });
        }
      }
      continue;
    }

    // Overall rows: accept either <code> Overall ... or <...> Overall ...
    const overIdx = toks.indexOf("Overall");
    if (overIdx < 0) continue;
    const rest = toks.slice(overIdx + 1);
    if (rest.length < 2) continue;
    const maxMark = parseInt(rest[0], 10);
    if (!isFinite(maxMark) || maxMark <= 0) continue;

    const code = isCode(toks[0]) ? toks[0] : blockCode;
    if (!code) continue;

    let grades = {};
    let gradesInOrder = [];
    if (currentColumns) {
      grades = alignGradeValues(line.items, currentColumns) || {};
      // Keep only the columns that actually carry a value, in header order, so
      // tiered rows expose their real top grade (Foundation = 5..U).
      gradesInOrder = currentColumns
        .filter((c) => grades[c.label] !== undefined)
        .map((c) => c.label);
    }
    if (!gradesInOrder.length) {
      for (let g = 0; g < currentGrades.length && g + 1 < rest.length; g++) {
        const v = parseInt(rest[g + 1], 10);
        if (isFinite(v)) grades[currentGrades[g]] = v;
      }
      gradesInOrder = currentGrades;
    }

    const tier = tierFromRow(toks);
    const title = (blockTitle || code) + (tier ? ` (${tier === "F" ? "Foundation" : "Higher"})` : "");

    subjects.push({
      board: "ocr",
      qual,
      code,
      title,
      tier,
      maxMark,
      grades,
      gradesInOrder,
      papers: blockComponents.length ? blockComponents : null
    });
    blockComponents = [];
  }
  return subjects;
}

// ---------- board: Pearson / Edexcel ----------

// Pearson files are split by section:
//   AS overall grade boundaries     (qual = as)
//   A level overall grade boundaries (qual = aLevel)
// GCSE file has no AS/A-level sections.
// Data rows:
//   1BI0  Biology (Higher)   Subject  200  167 155 144 124 104 84 74  0
//   8BN0  AS Biology A ...   Subject  160  117 103 89  75  62  0
//   9BN0  A Level Biology ... Subject  300  220 196 170 144 119 94  0
// Codes are 5 chars; the FIRST digit encodes level: 8 = AS, 9 = A-level,
// 1 = GCSE. We rely on the section header AND the code prefix.
const PEARSON_GCSE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
const PEARSON_ALEVEL_LABELS = ["A*", "A", "B", "C", "D", "E", "U"];
const PEARSON_AS_LABELS = ["A", "B", "C", "D", "E", "U"];

function parsePearsonSections(lines, qual) {
  const subjects = [];
  let section = null; // "AS" | "A level" | null
  let inSection = false;
  let columns = null;
  const gradeLabels =
    qual === "gcse" ? PEARSON_GCSE_LABELS
    : qual === "as" ? PEARSON_AS_LABELS
    : PEARSON_ALEVEL_LABELS;

  for (const line of lines) {
    const toks = lineTokens(line);
    if (toks.length === 0) continue;

    // Track section headers. Matched on the leading phrase regardless of the
    // header's total token count (it also carries the grade labels).
    const joined = toks.join(" ");
    if (/^AS\s+overall grade boundaries/i.test(joined)) {
      section = "AS";
      inSection = qual === "as";
      columns = extractGradeColumns(line);
      continue;
    }
    if (/^A level\s+overall grade boundaries/i.test(joined)) {
      section = "A level";
      inSection = qual === "aLevel";
      columns = extractGradeColumns(line);
      continue;
    }
    if (/^GCSE overall grade boundaries/i.test(joined) || !section && /^Overall grade boundaries/i.test(joined)) {
      section = "GCSE";
      inSection = qual === "gcse";
      columns = extractGradeColumns(line);
      continue;
    }

    const first = toks[0];
    if (!isCode(first)) continue;
    if (!toks.includes("Subject")) continue;
    if (toks.includes("Paper(s)")) continue;
    if (!inSection && (qual === "as" || qual === "aLevel")) continue;

    const subjIdx = toks.indexOf("Subject");
    const title = toks.slice(1, subjIdx).join(" ");
    const rest = toks.slice(subjIdx + 1);
    if (rest.length < 2) continue;
    const maxMark = parseInt(rest[0], 10);
    if (!isFinite(maxMark) || maxMark <= 0) continue;

    // Section-header primary; code prefix secondary (8=AS, 9=A-level).
    if (section === "AS" && qual !== "as") continue;
    if (section === "A level" && qual !== "aLevel") continue;

    let grades = {};
    let gradesInOrder = [];
    if (columns) {
      grades = alignGradeValues(line.items, columns) || {};
      gradesInOrder = columns
        .filter((c) => grades[c.label] !== undefined)
        .map((c) => c.label);
    }
    if (!gradesInOrder.length) {
      for (let g = 0; g < gradeLabels.length && g + 1 < rest.length; g++) {
        const v = parseInt(rest[g + 1], 10);
        if (isFinite(v)) grades[gradeLabels[g]] = v;
      }
      gradesInOrder = gradeLabels;
    }

    subjects.push({
      board: "pearson",
      qual,
      code: first,
      title,
      tier: tierFromTitle(title),
      maxMark,
      grades,
      gradesInOrder
    });
  }
  return subjects;
}

// ---------- entry point ----------

export function parsePdfBoundaries(layoutLines, board, qual) {
  let subjects;
  if (board === "aqa") subjects = parseAqaPdf(layoutLines, qual);
  else if (board === "ocr") subjects = parseOcr(layoutLines, qual);
  else if (board === "pearson") subjects = parsePearsonSections(layoutLines, qual);
  else return [];

  // Dedupe by (code, title): PDFs reprint identical rows for alternative
  // paper variants (e.g. Pearson "Higher" printed for both 1H2H and 1HT2HT).
  const seen = new Set();
  return subjects.filter((s) => {
    const key = `${s.code}|${s.title}|${s.maxMark}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}