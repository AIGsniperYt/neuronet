// examData/sources/PearsonSectionParser.js — pure layout-lines -> subject-rows.
//
// Dependency-free and I/O-free: takes layout lines from
// extractPdfLayoutLines* (each line = { items: [{ str, x }] }) and a qual
// string, returns subject-level boundary rows. This is the SAME algorithm used
// by the legacy browser pipeline (x-position column alignment is what lets
// tiered rows that right-align numbers map to their true grade labels instead
// of being lent the full 9..1 range). Extracted so the ExamData adapter owns
// its parse evidence and pdfBoundaries.js reuses it (one parser, one truth).

const PEARSON_GCSE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
const PEARSON_ALEVEL_LABELS = ["A*", "A", "B", "C", "D", "E", "U"];
const PEARSON_AS_LABELS = ["A", "B", "C", "D", "E", "U"];
const LABEL_RE = /^(9|8|7|6|5|4|3|2|1|u|A\*|a\*|A|B|C|D|E)$/i;

function str(item) {
  return String((item && item.str) || "").trim();
}

function lineText(line) {
  return (line.items || []).map(str).join(" ");
}

function isCode(tok) {
  return /^[A-Z0-9]{4,6}$/.test(tok) && /\d/.test(tok) && !/^(Option|Overall|Subject|Raw|Paper)/i.test(tok);
}

function normalizeLabel(tok) {
  if (tok.replace(/\s+/g, "").toLowerCase() === "a*") return "A*";
  if (/^[1-9]$/.test(tok)) return tok;
  if (/^[a-e]$/i.test(tok)) return tok.toUpperCase();
  if (tok.replace(/\s+/g, "").toUpperCase() === "U") return "U";
  return tok;
}

function tierFromTitle(title) {
  const t = String(title || "");
  if (/\b(?:higher|h)\b/i.test(t)) return "H";
  if (/\bfoundation\b/i.test(t) || /\(F\)/i.test(t)) return "F";
  return null;
}

// Grade-label column header by x-position ("Max Mark 9 8 7 ...").
function extractGradeColumns(line) {
  const items = line.items || [];
  let markIdx = -1;
  for (let i = 0; i < items.length; i++) {
    if (str(items[i]) === "Mark" || str(items[i]) === "Max Mark") { markIdx = i; break; }
  }
  if (markIdx < 0) {
    const lead = str(items[0]);
    if (lead && /^Max\s*Mark$/i.test(lead)) markIdx = 0;
  }
  if (markIdx < 0) return null;
  const cols = [];
  for (let i = markIdx + 1; i < items.length; i++) {
    const s = str(items[i]);
    if (!LABEL_RE.test(s)) break;
    cols.push({ x: items[i].x, label: normalizeLabel(s) });
  }
  // Layout order is the datum: grade-boundary tables read left-to-right in
  // official pdfs (Max Mark 9 8 7 … U). Object-key order is a JS artifact
  // (integer keys enumerate ascending), so sort by the aligned x-position.
  cols.sort((a, b) => a.x - b.x);
  return cols.length >= 3 ? cols : null;
}

// Map a data row's numeric value items to grade labels by column x-position.
function alignGradeValues(items, columns) {
  if (!columns || !columns.length) return null;
  const used = new Set();
  const grades = {};
  const numeric = items
    .map((it, i) => ({ i, x: it.x !== undefined ? it.x : -1, v: Number(str(it)) }))
    .filter((o) => /^-?\d+$/.test(str(items[o.i])));
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

export function parsePearsonBoundaries(lines, qual) {
  const subjects = [];
  let section = null;
  let inSection = false;
  let columns = null;
  const gradeLabels =
    qual === "gcse" ? PEARSON_GCSE_LABELS
    : qual === "as" ? PEARSON_AS_LABELS
    : PEARSON_ALEVEL_LABELS;

  for (const line of lines || []) {
    const toks = (line.items || [])
      .map(str)
      .filter((s) => s.length > 0);
    if (!toks.length) continue;

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
    if (/^GCSE overall grade boundaries/i.test(joined) || (!section && /^Overall grade boundaries/i.test(joined))) {
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

    if (section === "AS" && qual !== "as") continue;
    if (section === "A level" && qual !== "aLevel") continue;

    let grades = {};
    let gradesInOrder = [];
    if (columns) {
      grades = alignGradeValues(line.items, columns) || {};
      gradesInOrder = Array.isArray(line.items)
        ? columns
            .filter((c) => grades[c.label] !== undefined)
            .map((c) => c.label)
        : [];
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
      maxMark,
      grades,
      gradesInOrder,
      tier: tierFromTitle(title)
    });
  }

  // Dedupe reprinted rows (e.g. Higher printed for multiple paper variants).
  const seen = new Set();
  return subjects.filter((s) => {
    const key = `${s.code}|${s.title}|${s.maxMark}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}