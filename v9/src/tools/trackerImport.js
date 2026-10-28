// Pure transform: flat legacy past-paper export rows -> neuronet node records.
// Rows look like:
//   { subject, year, paper1, paper2, paper3, totals, gradeBoundary, notes,
//     averagePercent, id, paper1Date, paper2Date, paper3Date, sequence }
// Returns { subjects: [subjectNode], sittings: [pastpaperNode] }
//
// Forward-looking schema (bare-bones until a scraper lands):
//   - subject node carries `qualification` (GCSE | A-Level) and `officialCourse`
//     (nullable). `officialCourse` links a subject to its official course so a
//     future scraper can auto-fetch paper structure / max marks / boundaries by
//     (qualification, exam board, subject). Custom self-study subjects start
//     with officialCourse null and can be linked later.

const DEFAULT_QUALIFICATION = "GCSE"; // set once; this dataset predates A-Level

const SERIES_BY_SUFFIX = {
  J: "June",
  N: "November"
};

// "47/100" -> {score:47, max:100}
// "89 -> 91/100" -> means 2 attempts: 89 then 91 (both /100)
// "73/82", "207/240", "-1", "", "null - p1 mocks" uneven/handled.
function parseScoreToAttempts(raw) {
  if (raw == null) return [];
  const str = String(raw).trim();
  if (str === "" || str === "-1" || /^null/i.test(str)) return [];
  if (/^[-+*~]/i.test(str)) return []; // marker strings like "~"
  const parts = str.split(/\s*->\s*/).map((p) => p.trim()).filter(Boolean);

  // Find the explicit denominator (e.g. "91/100") so bare scores like
  // "89 -> 91/100" inherit it (both attempts are out of that max).
  let sharedMax = null;
  for (const part of parts) {
    const mm = part.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    if (mm) { sharedMax = Number(mm[2]); break; }
  }

  const attempts = [];
  for (const part of parts) {
    const m = part.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/);
    if (!m) continue;
    const score = Number(m[1]);
    const max = m[2] != null && m[2] !== "" ? Number(m[2]) : sharedMax;
    if (max == null || max <= 0) continue;
    attempts.push({ score, maxMarks: max });  }
  return attempts;
}

// "2023J" -> {year:2023, series:"June"}
// "2023" -> {year:2023, series:null}
// "2023/26 (specimen)", "specimen" -> {year:null, series:"Specimen"}
// "mock (custom??)" -> {year:null, series:"Mock"}
// "2020N/J" -> {year:2020, series:"November"}
function parseYear(input) {
  if (input == null) return { year: null, series: null, label: null };
  const str = String(input).trim();
  if (str === "") return { year: null, series: null, label: null };

  let base = str;
  let series = null;

  // special "mock (custom??)"
  if (/^mock/i.test(str)) return { year: null, series: "Mock", label: str };

  // strip specimen markers -> Specimen series
  if (/specimen/i.test(str)) {
    base = str.replace(/\(?\s*specimen\s*\)?/gi, "").trim();
    series = "Specimen";
    base = base.replace(/[/()\s]+/g, "");
  }

  // trailing J / N
  const sm = base.match(/(\d{4})[JN]$/i);
  // combined J/N
  const jn = base.match(/(\d{4})[NJ]\/[NJ]$/i);
  if (jn) {
    const y = Number(jn[1]);
    return { year: y, series: "November", label: str };
  }
  if (sm) {
    const y = Number(sm[1]);
    const suff = sm[0].slice(-1).toUpperCase();
    series = SERIES_BY_SUFFIX[suff] || null;
    return { year: y, series, label: str };
  }
  const plain = base.match(/^(\d{4})$/);
  if (plain) return { year: Number(plain[1]), series, label: str };

  // something else (e.g. stray) -> keep raw as label, no numeric year
  return { year: null, series, label: str };
}

const PAPER_KEY_TO_INDEX = { paper1: 0, paper2: 1, paper3: 2 };
const KNOWN_PAPER_KEYS = Object.keys(PAPER_KEY_TO_INDEX);
const DATE_KEY_BY_PAPER = { paper1: "paper1Date", paper2: "paper2Date", paper3: "paper3Date" };

function normalizeGradeBoundary(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function transformRows(rows) {
  const subjects = new Map(); // name -> subjectNode
  const sittings = [];

  const ensureSubject = (name) => {
    if (!name) return null;
    if (!subjects.has(name)) {
      subjects.set(name, {
        id: `subject-${crypto.randomUUID()}`,
        type: "subject",
        subject: name,
        name: name,
        examBoard: "",
        qualification: DEFAULT_QUALIFICATION,
        officialCourse: null, // { board, code, title, qual } once linked to scrape-able course
        customized: false,    // user-created / self-study (unlinkable to a standard course)
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    return subjects.get(name);
  };

  for (const row of rows || []) {
    const subject = (row.subject || "").trim();
    if (!subject) continue;
    ensureSubject(subject);

    const { year, series, label } = parseYear(row.year);

    const results = [];
    for (const key of KNOWN_PAPER_KEYS) {
      const attempts = parseScoreToAttempts(row[key]);
      if (attempts.length === 0) continue;
      const dateKey = DATE_KEY_BY_PAPER[key];
      const date = (row[dateKey] || "").trim();
      const attemptsWithDate = attempts.map((a) => ({ ...a, date }));
      const last = attemptsWithDate[attemptsWithDate.length - 1];
      results.push({
        paper: "Paper " + (PAPER_KEY_TO_INDEX[key] + 1),
        score: last.score,
        maxMarks: last.maxMarks,
        date,
        attempts: attemptsWithDate
      });
    }

    const boundary = normalizeGradeBoundary(row.gradeBoundary);

    sittings.push({
      id: `paper-${crypto.randomUUID()}`,
      type: "pastpaper",
      subject,
      year,
      series,
      label: year != null ? null : label,
      gradeBoundary: boundary,
      examBoard: "",
      notes: (row.notes || "").trim(),
      legacyId: row.id ?? null,
      results,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  return { subjects: Array.from(subjects.values()), sittings };
}
