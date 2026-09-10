import { findGradeTable, courseBoundarySeries } from "/home/aigsniper/Documents/website/neuronet/frontend/src/tools/gradeBoundaries.js";

const MATHS = { board: "Pearson (Edexcel)", qual: "GCSE", title: "Mathematics (Higher)", code: "1MA1" };

const subject2024 = {
  code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
  grades: { "9": 197, "8": 167, "7": 137, "6": 105, "5": 73, "4": 42, "3": 26, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
  papers: []
};
const subject2025 = {
  code: "1MA1", title: "Mathematics (Higher)", tier: "H", maxMark: 240,
  grades: { "9": 217, "8": 186, "7": 156, "6": 121, "5": 87, "4": 53, "3": 36, U: 0 },
  gradesInOrder: ["9", "8", "7", "6", "5", "4", "3", "U"],
  papers: []
};

function cacheWith(order) {
  const entries = {};
  const put = (key, series, subject) => { entries[key] = { board: "pearson", qual: "gcse", series, fetchedAt: 1234, subjects: [subject] }; };
  for (const [series, subject] of order) put(`${series.month}-${series.year}`, series, subject);
  return { version: 2, entries };
}

const j24 = { label: "June 2024", month: "JUN", year: 2024, monthAbbr: "JUN" };
const j25 = { label: "June 2025", month: "JUN", year: 2025, monthAbbr: "JUN" };

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  return ok;
};

for (const [label, order, extraNote] of [
  ["insert 2024 then 2025, equal fetchedAt", [[j24, subject2024], [j25, subject2025]], ""],
  ["insert 2025 then 2024, equal fetchedAt", [[j25, subject2025], [j24, subject2024]], ""],
]) {
  const cache = cacheWith(order);
  const undated = findGradeTable(cache, MATHS, null, null);
  const y2024 = findGradeTable(cache, MATHS, 2024, null);
  const y2025 = findGradeTable(cache, MATHS, 2025, null);
  const series = courseBoundarySeries(cache, MATHS);
  const tag = `${label}`;
  check(`${tag}: undated 9 -> 2025(217)`, undated && undated.subject && undated.subject.grades && undated.subject.grades["9"], 217);
  check(`${tag}: dated 2024 9 -> 197`, y2024 && y2024.subject && y2024.subject.grades && y2024.subject.grades["9"], 197);
  check(`${tag}: dated 2025 9 -> 217`, y2025 && y2025.subject && y2025.subject.grades && y2025.subject.grades["9"], 217);
  check(`${tag}: series order newest-first`, series.map((s) => s.series && s.series.year), [2025, 2024]);
}

const newerFetchOldYear = cacheWith([[j25, subject2025], [j24, subject2024]]);
newerFetchOldYear.entries["JUN-2024"].fetchedAt = 99999999;
const undated2 = findGradeTable(newerFetchOldYear, MATHS, null, null);
check("2024 fetched AFTER 2025 still loses: undated 9 -> 2025(217)", undated2 && undated2.subject && undated2.subject.grades && undated2.subject.grades["9"], 217);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);