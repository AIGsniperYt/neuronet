import { transformRows } from "./trackerImport.js";
import { dialog } from "./dialog.js";
import {
  loadBoundaryCache,
  reloadBoundaryCache,
  listCachedCourses,
  resolveTrackedCourse,
  reconcileCourse,
  getBoundaryStatus,
  subscribeBoundaryStatus,
  subscribeBoundaryCacheChanged,
  runBoundarySweep,
  findGradeTable,
  boardIdToName,
  qualIdToName,
  boardToId,
  qualToId,
  trackerSeriesToMonth,
  bestSeriesForYear,
  ensureBoundarySeries,
  normalizeTitle,
  scoreToGrade,
  canonicalGradeKey,
  normalizeBoundaryTable,
  findGradeMark,
  courseGradeLabels,
  courseBoundarySeries,
  tierFromName,
  resolveBoundaryDecision,
  seriesRecentlyAttempted
} from "./gradeBoundaries.js";
import { planRequirements, REQUIREMENT_TYPES } from "./examData/scheduler.js";
import { parseCourseKey, seriesKeyOf, courseKey, seriesId } from "./examData/schema.js";

export function initTrackerTool(deps, context = {}) {
  const { getAllNodes, addNode, addNodes, deleteNode, getSubjects, escapeHtml } = deps;
  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const el = {
    papersBtn: $("trackerPapersBtn"),
    statsBtn: $("trackerStatsBtn"),
    exportBtn: $("trackerExportBtn"),
    importBtn: $("trackerImportBtn"),
    importFile: $("trackerImportFile"),

    papers: $("trackerPapers"),
    stats: $("trackerStats"),

    
    subjectList: $("trackerSubjectList"),
    addBtn: $("trackerAddBtn"),
    dropBtn: $("trackerDropBtn"),
    collapseBtn: $("trackerCollapseBtn"),
    paperGroups: $("trackerPaperGroups"),

    statsGrid: $("trackerStatsGrid"),

    modal: $("trackerModal"),
    modalOverlay: $("trackerModalOverlay"),
    modalClose: $("trackerModalClose"),
    modalTitle: $("trackerModalTitle"),
    formSubject: $("trackerFormSubject"),
    formYear: $("trackerFormYear"),
    formSeries: $("trackerFormSeries"),
    formNotes: $("trackerFormNotes"),
    saveBtn: $("trackerSaveBtn"),
    cancelBtn: $("trackerCancelBtn"),
    formMsg: $("trackerFormMsg"),

    colsBtn: $("trackerCustomiseBtn"),
    colsPop: $("trackerCustomisePop"),
    tableInfo: $("trackerTableInfo"),
    boundaryChips: $("trackerBoundaryChips"),
    boundaryPreview: $("trackerBoundaryPreview"),
    boundaryNote: $("trackerBoundaryNote"),
    colList: $("trackerColList"),
    cusReset: $("trackerCusReset"),
    linkArea: $("trackerLinkArea"),
    linkPill: $("trackerLinkPill"),
    linkPop: $("trackerLinkPop"),
    linkFilter: $("trackerLinkFilter"),
    linkFilters: $("trackerLinkFilters"),
    linkList: $("trackerLinkList"),
    linkStatus: $("trackerLinkStatus"),
    unlinkBtn: $("trackerUnlinkBtn"),

    slotList: $("trackerSlotList"),
    addSlotBtn: $("trackerAddSlotBtn")
  };

  // ---- state ----
  let papers = [];
  let allSubjects = [];
  let subjectNodes = [];
  let boardsBySubject = {}; // subject -> examBoard (from subject nodes)
  let coursesBySubject = {}; // subject -> officially linked course { board, code, title, qual }
  let subjectMeta = {}; // subject -> { examBoard, qualification, code } for auto resolution
  const COL_DEFS = [
    { id: "boundary", label: "Boundary" },
    { id: "sitting", label: "Sitting" },
    { id: "avg", label: "Average" }
  ];
  const COL_DEFAULTS = { boundary: true, sitting: true, avg: true };
  let cols = loadCols(); // visible table columns, persisted in localStorage
  let aimGrades = loadAim(); // subject -> boundary grade labels shown as thresholds in the Boundary column
  let chipTokens = new Set(); // toggled quick-filter chips in the link picker — level + board coexist
  let linkHint = null; // auto-suggested official course for the scoped subject (one-click link)
  let focusedSubject = context.subject || null;
  let editingId = null;
  let slotSeq = 0;
  const expandedNotes = new Set();

  function loadCols() {
    try {
      const raw = JSON.parse(localStorage.getItem("neuronet:trackerCols") || "{}");
      const out = { ...COL_DEFAULTS };
      for (const k of Object.keys(COL_DEFAULTS)) if (typeof raw[k] === "boolean") out[k] = raw[k];
      return out;
    } catch (e) { return { ...COL_DEFAULTS }; }
  }
  function saveCols() {
    try { localStorage.setItem("neuronet:trackerCols", JSON.stringify(cols)); } catch (e) {}
  }
  function loadAim() {
    try { return JSON.parse(localStorage.getItem("neuronet:trackerAim") || "{}"); }
    catch (e) { return {}; }
  }
  function saveAimGrades() {
    try { localStorage.setItem("neuronet:trackerAim", JSON.stringify(aimGrades)); } catch (e) {}
  }
  // The grade thresholds shown for a subject in the Boundary column. Labels are
  // picked from the fetched pack; empty = use the top grade only.
  function aimFor(subject) {
    const raw = (subject && Array.isArray(aimGrades[subject])) ? aimGrades[subject] : [];
    return Array.from(new Set(raw.map((label) => canonicalGradeKey(label)).filter(Boolean)));
  }

  function nowISO() { return new Date().toISOString(); }
  function pct(score, max) {
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
    return Math.round((score / max) * 100);
  }
  function isLow(p) { return p !== null && p < 60; }

  // ---- persistence ----
  async function loadPapers() {
    const all = await getAllNodes();
    papers = (all || []).filter((n) => n && n.type === "pastpaper");
    return papers;
  }

  async function loadSubjects() {
    try {
      allSubjects = (await getSubjects()) || [];
    } catch (e) {
      allSubjects = [];
    }
    boardsBySubject = {};
    coursesBySubject = {};
    subjectMeta = {};
    subjectNodes = [];
    try {
      const all = (await getAllNodes()) || [];
      for (const n of all) {
        if (n && n.type === "subject") {
          subjectNodes.push(n);
          const name = n.name || n.subject;
          if (name && n.examBoard) boardsBySubject[name] = n.examBoard;
          if (name && n.officialCourse && n.officialCourse.code) coursesBySubject[name] = n.officialCourse;
          if (name) subjectMeta[name] = {
            examBoard: n.examBoard || "",
            qualification: n.qualification || "",
            code: (n.officialCourse && n.officialCourse.code) || ""
          };
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Canonical identity keys for a sitting (Phase D): every stored sitting
  // references the course (board:qual:code:tier) and series (MONTH-YEAR) it
  // belongs to, when those are resolvable. Identity comes from the confirmed
  // course or a unique resolution — an ambiguous subject stays null rather than
  // guessing. These keys are written once at save time and read for import
  // dedupe, warm planning, and export.
  function annotateSitting(rec) {
    const out = { ...rec };
    if (out.subject) {
      const resolved = resolveCourse(loadBoundaryCache(), out.subject);
      if (resolved && out.courseId === undefined) out.courseId = courseKey(resolved) || null;
      if (out.courseId === undefined) out.courseId = null;
    }
    if (out.courseId === undefined) out.courseId = null;
    if (!out.seriesId) {
      const y = numberEq(out.year);
      out.seriesId = (y !== null && out.series) ? seriesId({ month: trackerSeriesToMonth(out.series), year: y }) : null;
    }
    return out;
  }

  async function persist(paper) {
    const now = nowISO();
    const record = {
      ...annotateSitting(paper),
      type: "pastpaper",
      results: Array.isArray(paper.results) ? paper.results : [],
      createdAt: paper.createdAt || now,
      updatedAt: now
    };
    await addNode(record);
    await loadPapers();
    await loadSubjects();
    scheduleWarm();
  }

  async function persistMany(list) {
    const now = nowISO();
    const records = list.map((p) => ({
      ...annotateSitting(p),
      type: "pastpaper",
      results: Array.isArray(p.results) ? p.results : [],
      createdAt: p.createdAt || now,
      updatedAt: now
    }));
    await addNodes(records);
    await loadPapers();
    await loadSubjects();
    scheduleWarm();
  }

  async function removePaper(paper) {
    const label = `${paper.subject} ${paper.year ?? ""}${paper.series ? " (" + paper.series + ")" : ""}`.trim();
    const confirmed = await dialog.confirm(`Delete this sitting?\n\n${label}`, "Delete", "danger");
    if (!confirmed) return;
    if (!paper.id) paper.id = `paper-${crypto.randomUUID()}`;
    await deleteNode(paper.id);
    await loadPapers();
    scheduleWarm();
    renderPapers();
  }

  // ---- board editing (per subject) ----
  function boardFor(subject) {
    if (subject && boardsBySubject[subject]) return boardsBySubject[subject];
    const p = papers.find((x) => x.subject === subject && x.examBoard);
    return p ? p.examBoard : "";
  }

  function qualFor(subject) {
    const node = subjectNodes.find((s) => (s.name || s.subject) === subject);
    return node ? (node.qualification || "") : "";
  }

  async function ensureSubjectMeta(subject, { examBoard, qualification }) {
    const name = (subject || "").trim();
    if (!name) return;
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    const patch = {};
    if (examBoard != null) patch.examBoard = examBoard.trim();
    if (qualification != null) patch.qualification = qualification.trim();
    if (existing) {
      await addNode({ ...existing, ...patch, updatedAt: Date.now() });
    } else {
      await addNode({
        type: "subject", subject: name, name: name,
        examBoard: (examBoard || "").trim(),
        qualification: (qualification || "").trim(),
        customized: false, officialCourse: null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    }
    await loadSubjects();
    scheduleWarm();
  }

  async function setSubjectBoard(subject, board) {
    const name = (subject || "").trim();
    const b = (board || "").trim();
    if (!name) return;
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    if (existing) {
      await addNode({ ...existing, examBoard: b, updatedAt: Date.now() });
    } else {
      await addNode({
        type: "subject",
        subject: name,
        name: name,
        examBoard: b,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    await loadSubjects();
    scheduleWarm();
    renderPapers();
  }

  // ---- auto grade boundaries ----
  // The official cached subject for a tracker subject. Never requires manual
  // linking: an explicit stored link wins (reconciled against the live cache
  // so stale/pre-fix Foundation links heal to the tier the course really is),
  // else we resolve it automatically from the subject's meta
  // (board/qualification/code) or by exact title match.
  // Resolution outcome for a subject: the resolved course plus an explosion
  // flag. Identity never resolves on cache richness: when the resolver reports
  // ambiguity (equal-score candidates, e.g. "Geography" across boards) we do
  // NOT pick one — the caller surfaces the candidate list and asks.
  function courseResolution(subject, cacheSrc) {
    const meta = subjectMeta[subject || ""] || {};
    const res = resolveTrackedCourse(cacheSrc || loadBoundaryCache(), {
      board: meta.examBoard,
      qual: meta.qualification,
      title: subject,
      code: meta.code,
      tier: tierFromName(subject)
    });
    if (res && res.ambiguous) return { course: null, ambiguous: true, candidates: res.candidates || [] };
    return { course: res || null, ambiguous: false, candidates: [] };
  }

  function resolveCourse(cache, name) {
    if (!name) return null;
    const linked = coursesBySubject[name];
    if (linked && linked.code) {
      const healed = reconcileCourse(cache, linked, tierFromName(name));
      if (healed) return healed;
      return linked;
    }
    // Tolerant resolver: matches by code when known, else by normalized word
    // tokens with subject aliases ("Maths" → "Mathematics (Higher)", "Geography"
    // → "Geography B", "English Lit" → "English Literature"). Without this, an
    // unlinked "Maths"/"Geography" row resolves to null and the whole pipeline
    // (auto-warm fetch, grade chips, boundary badge) silently dead-ends even
    // after a successful pack fetch. Ambiguity returns null here — an unstable
    // guess is worse than none, and the row UI points the user at the picker.
    const res = courseResolution(name, cache);
    return res.course;
  }

  function resolveBoundaryTable(subject, year, series, cacheSrc) {
    if (/^(mock|specimen)$/i.test(String(series || "").trim())) return null;
    const cache = cacheSrc || loadBoundaryCache();
    const course = subject ? resolveCourse(cache, subject) : null;
    if (!course) return null;
    const hit = findGradeTable(cache, course, year, series);
    if (!hit || !hit.subject) return null;
    return normalizeBoundaryTable({
      grades: hit.subject.grades || {},
      gradesInOrder: Array.isArray(hit.subject.gradesInOrder) ? hit.subject.gradesInOrder : [],
      maxMark: hit.subject.maxMark || null,
      papers: Array.isArray(hit.subject.papers) && hit.subject.papers.length ? hit.subject.papers : [],
      board: hit.boardId,
      qual: hit.qualId,
      seriesLabel: hit.series ? hit.series.label : null,
      seriesKey: hit.series ? `${hit.series.month}-${hit.series.year}` : null,
      fresh: !!hit.fresh
    });
  }

  // The ONE table a row renders from: live per-year cache resolution, else the
  // sitting's stored snapshot — both run through the canonical normalizer so
  // every consumer reads canonical grade keys.
  function effectiveTable(sitting, cacheSrc) {
    const live = resolveBoundaryTable(sitting.subject, numberEq(sitting.year), sitting.series, cacheSrc);
    if (live) {
      return live;
    }
    const snapshot = normalizeBoundaryTable(sitting && sitting.gradeBoundaries);
    return snapshot;
  }

  // Best-effort paper list for a subject: scan the cache across series for any
  // entry of this course that carries a component/paper list.
  function coursePapers(subject) {
    const course = subject ? resolveCourse(loadBoundaryCache(), subject) : null;
    if (!course) return null;
    const cache = loadBoundaryCache();
    for (const entry of Object.values(cache.entries || {})) {
      if (String(entry.board || "").toLowerCase() !== String(course.board || "").toLowerCase()) continue;
      if (String(entry.qual || "").toLowerCase() !== String(course.qual || "").toLowerCase()) continue;
      for (const it of entry.subjects || []) {
        if (it.code === course.code && Array.isArray(it.papers) && it.papers.length) return it.papers;
      }
    }
    return null;
  }

  function topGradeOf(table) {
    const normalized = normalizeBoundaryTable(table);
    const top = normalized && Array.isArray(normalized.gradesInOrder) ? normalized.gradesInOrder[0] : null;
    return top == null ? null : findGradeMark(normalized, top);
  }

  function boundsTooltip(gb) {
    const normalized = normalizeBoundaryTable(gb);
    const lines = normalized.gradesInOrder.filter((g) => Number.isFinite(normalized.grades[g])).map((g) => `${g}: ${normalized.grades[g]}`);
    return `${gb.seriesLabel || "Grade boundaries"}` + (lines.length ? " · " + lines.join(", ") : "");
  }

  function markForGrade(gb, label) {
    return findGradeMark(gb, label);
  }

  // Subject-level grade, NOT per-paper. Sums each paper's best-attempt raw total
  // and compares that aggregate against the whole-subject boundary table:
  //   - totalMax (sum of paper maxes) is compared to the subject maxMark. If they
  //     match, the grade is REAL. If papers are missing (totalMax < maxMark) the
  //     result is normalised to a percentage and reported as PROJECTED, not real.
  // Returns { grade, real, projected, answered, total, max } or null.
  function subjectGrade(sitting, gb) {
    if (!gb || !Array.isArray(gb.gradesInOrder) || !gb.gradesInOrder.length || !(gb.grades && typeof gb.grades === "object")) return null;
    if (!Number.isFinite(gb.maxMark) || gb.maxMark <= 0) return null;
    const rows = (sitting.results || []).map((r) => bestAttemptScore(r)).filter(Boolean);
    if (rows.length === 0) return null;
    const total = rows.reduce((m, b) => m + b.score, 0);
    const max = rows.reduce((m, b) => m + b.max, 0);
    if (max <= 0) return null;
    const real = Math.abs(max - gb.maxMark) <= 1;
    if (real) {
      const grade = scoreToGrade(gb.grades, gb.gradesInOrder, total);
      if (grade == null) return null;
      return { grade, real: true, projected: false, answered: rows.length, total, max, maxMark: gb.maxMark };
    }
    // incomplete — normalise both totals and boundary to percentage and project
    const pctScale = 100;
    const totalPct = (total / max) * pctScale;
    const boundPct = {};
    const boundOrder = [];
    for (const g of gb.gradesInOrder) {
      const m = gb.grades[g];
      if (!Number.isFinite(m)) continue;
      const scaled = (m / gb.maxMark) * pctScale;
      if (!boundPct[g]) { boundPct[g] = scaled; boundOrder.push(g); }
    }
    if (boundOrder.length === 0) return null;
    const grade = scoreToGrade(boundPct, boundOrder, totalPct);
    if (grade == null) return null;
    return { grade, real: false, projected: true, answered: rows.length, total, max, maxMark: gb.maxMark };
  }

  // Renders the subject-level grade badge. Explicitly labels projection so the
  // app never hypes a real grade that isn't earned yet.
  function subjectGradeChip(sitting, gb) {
    const sg = subjectGrade(sitting, gb);
    if (!sg) return "";
    if (sg.real) {
      return `<span class="head-grade real" title="Real subject grade (${escapeHtml(String(sg.answered))} paper(s) complete, totals ${sg.total}/${sg.maxMark})">${escapeHtml(sg.grade)}</span>`;
    }
    const totalPapers = gb && Array.isArray(gb.papers) && gb.papers.length ? gb.papers.length : null;
    const projected = `projected from ${sg.answered}${totalPapers ? "/" + totalPapers : ""} paper(s) \u2014 real once all papers are done`;
    return `<span class="head-grade proj" title="${escapeHtml(projected)}">${escapeHtml(sg.grade)} <em class="proj-label">proj</em></span>`;
  }

  // ---- table customise (persistent popover above the table) ----
  // The Boundary column shows the grade thresholds YOU want to aim for — picked
  // per subject from the fetched pack (the source of truth — the pack itself is
  // never edited here). Any number of grades: 9, 9+7, 9+4, 9+8+7, whatever.
  // Nothing picked = the top grade only, which is the default.
  function aimTable(subject) {
    const cache = loadBoundaryCache();
    const direct = resolveBoundaryTable(subject, null, null, cache);
    if (direct) return direct;
    const sitting = papers.find((p) => p.subject === subject && p.year != null);
    const resolved = sitting
      ? resolveBoundaryTable(subject, numberEq(sitting.year), sitting.series, cache)
      : null;
    if (resolved) return resolved;
    const stored = papers.find((p) => p.subject === subject && p.gradeBoundaries);
    return stored ? normalizeBoundaryTable(stored.gradeBoundaries) : null;
  }
  function pickableGrades(subject) {
    const cache = loadBoundaryCache();
    const course = subject ? resolveCourse(cache, subject) : null;
    const union = course ? courseGradeLabels(cache, course) : [];
    const tableLabels = (() => {
      const t = aimTable(subject);
      if (!t) return [];
      const raw = Array.isArray(t.gradesInOrder) && t.gradesInOrder.length
        ? t.gradesInOrder
        : t.grades && typeof t.grades === "object" ? Object.keys(t.grades) : [];
      return raw.map((g) => canonicalGradeKey(g)).filter((g) => g && g !== "U");
    })();
    const seen = new Set();
    const out = [];
    for (const label of [...union, ...tableLabels]) {
      if (!label || label === "U" || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  }

  function renderBoundaryChips() {
    if (el.boundaryChips) el.boundaryChips.innerHTML = "";
    if (el.boundaryPreview) el.boundaryPreview.innerHTML = "";
    if (el.boundaryNote) el.boundaryNote.textContent = "";
    const s = getBoundaryStatus();
    const busy = s && (s.phase === "discovering" || s.phase === "fetching");
    if (!focusedSubject) {
      if (el.boundaryChips) el.boundaryChips.innerHTML = `<div class="tracker-cus-empty">Scope to one subject (sidebar) to pick the grades it aims for.</div>`;
      return;
    }
    const options = pickableGrades(focusedSubject);
    if (!options.length) {
      // No usable boundaries for this subject yet. If the shared sweep (this
      // page's picker, the auto-warm, or the scraper tab) is running, tell the
      // user to wait instead of dead-ending with "go use another tool".
      if (busy) {
        const msg = sweepMessage(s) || "Fetching grade boundaries...";
        if (el.boundaryChips) el.boundaryChips.innerHTML = `<div class="tracker-cus-empty"><span class="tracker-cus-busy-text">${escapeHtml(msg)}</span></div>`;
      } else {
        if (el.boundaryChips) el.boundaryChips.innerHTML = `<div class="tracker-cus-empty">No grade boundaries fetched for ${escapeHtml(focusedSubject)} yet &mdash; they'll be fetched in the background (or open the <b>Scraper</b> tool / link the official subject).</div>`;
      }
      return;
    }
    const selected = aimFor(focusedSubject);
    el.boundaryChips.innerHTML = options.map((g) =>
      `<button type="button" class="tracker-chip tracker-grade-chip ${selected.includes(g) ? "active" : ""}" data-g="${escapeHtml(g)}" title="Toggle grade ${escapeHtml(g)}${selected.includes(g) ? " (shown)" : ""}">` +
      `<span class="bmark">${escapeHtml(g)}</span>` +
      `</button>`
    ).join("");
    renderBoundaryPreview(options, selected);
    if (el.boundaryNote) el.boundaryNote.textContent = "";
  }

  // Live thresholds for the aimed grades — the direct, visible response to a
  // chip click even when the table has no rows yet. Rendered PER SERIES through
  // the exact same per-year lookups the rows use (findGradeTable -> the sitting's
  // year), so the customise picker shows year-faithful thresholds instead of one
  // arbitrary any-year table repeated for every grade and every year. Grades a
  // given year's pack doesn't carry (e.g. 9 on a Foundation row) are simply not
  // listed for that year.
  function renderBoundaryPreview(options, selected) {
    if (!el.boundaryPreview) return;
    const cache = loadBoundaryCache();
    const course = focusedSubject ? resolveCourse(cache, focusedSubject) : null;
    if (!course) return;
    const grades = selected.length ? selected : [options[0] || null];
    if (!grades.length) return;
    const toTable = (subject, series) => normalizeBoundaryTable({
      grades: subject.grades || {},
      gradesInOrder: Array.isArray(subject.gradesInOrder) ? subject.gradesInOrder : [],
      maxMark: subject.maxMark || null,
      papers: Array.isArray(subject.papers) && subject.papers.length ? subject.papers : [],
      board: course.board,
      qual: course.qual,
      seriesLabel: series ? series.label : "Cached boundaries",
      seriesKey: series ? `${series.month}-${series.year}` : null,
      seriesYear: series && series.year != null ? Number(series.year) : null,
      seriesMonth: series ? String(series.month || "") : ""
    });
    const groups = [];
    for (const s of courseBoundarySeries(cache, course)) {
      const table = toTable(s.subject, s.series);
      const marks = grades.map((label) => {
        const mark = markForGrade(table, label);
        return mark != null ? `${escapeHtml(label)} &ge; <b>${escapeHtml(String(mark))}</b>` : null;
      }).filter(Boolean);
      if (!marks.length) continue;
      groups.push({ table, marks });
    }
    if (!groups.length) {
      // No per-series pack resolved (e.g. only a stored snapshot) — fall back to
      // the subject's best single table so the picker still answers.
      const table = aimTable(focusedSubject);
      if (!table) return;
      const marks = grades.map((label) => {
        const mark = markForGrade(table, label);
        return mark != null ? `${escapeHtml(label)} &ge; <b>${escapeHtml(String(mark))}</b>` : null;
      }).filter(Boolean);
      if (!marks.length) return;
      groups.push({ table, marks });
    }
    // Groups are sorted newest-year-first (courseBoundarySeries), so duplicate
    // years are adjacent. When a year has more than one series (e.g. June +
    // November) label the groups with the month too.
    const yearCounts = new Map();
    for (const g of groups) {
      if (g.table.seriesYear == null) continue;
      yearCounts.set(g.table.seriesYear, (yearCounts.get(g.table.seriesYear) || 0) + 1);
    }
    const keyLabel = (table) => {
      const year = table.seriesYear;
      const count = yearCounts.get(year) || 0;
      if (table.seriesMonth && count > 1) {
        return `${String(table.seriesMonth).toUpperCase() === "JUN" ? "Jun" : "Nov"} ${year}`;
      }
      return table.seriesLabel || String(year != null ? year : "Cached");
    };
    const title = selected.length
      ? `Threshold per year fetched for this subject (shown in the Boundary column)`
      : `Top grade (default) threshold per year fetched for this subject`;
    el.boundaryPreview.innerHTML =
      `<div class="tracker-cus-preview-title">${escapeHtml(title)}</div>` +
      `<div class="tracker-cus-preview-row">` +
      groups.map(({ table, marks }, i) =>
        `<span class="tracker-cus-preview-group">` +
        `<span class="tracker-cus-preview-key" title="${escapeHtml(boundsTooltip(table))}">${escapeHtml(keyLabel(table))}</span>` +
        `<span class="tracker-cus-preview-grades">${marks.join('<span class="tracker-cus-preview-sep">·</span>')}</span>` +
        `<span class="tracker-cus-preview-sep">${i < groups.length - 1 ? "|" : ""}</span>` +
        `</span>`
      ).join("") +
      (selected.length ? `<span class="tracker-cus-preview-clear"><button type="button" class="tracker-cus-reset-mini" data-clear-aim>clear</button></span>` : "") +
      `</div>`;
    const clear = el.boundaryPreview.querySelector("[data-clear-aim]");
    if (clear) clear.addEventListener("click", () => {
      aimGrades = {};
      saveAimGrades();
      renderBoundaryChips();
      renderPapers();
    });
  }

  function renderColList() {
    if (!el.colList) return;
    el.colList.innerHTML = COL_DEFS.map((c) =>
      `<button type="button" class="tracker-col-toggle ${cols[c.id] ? "" : "off"}" data-col="${c.id}">` +
      `<span class="check">&#10003;</span><span>${c.label}</span></button>`
    ).join("");
  }

  function toggleAim(subject, label) {
    if (!subject) return;
    aimGrades = loadAim();
    const canonical = canonicalGradeKey(label);
    let list = (aimGrades[subject] || []).slice().map((item) => canonicalGradeKey(item)).filter(Boolean);
    const idx = list.indexOf(canonical);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(canonical);
    aimGrades[subject] = Array.from(new Set(list));
    saveAimGrades();
    renderPapers();
  }

  // ---- link subject to an official course ----
  // Bound to the table bar's "Link subject" pill. Boundaries then auto-load from
  // the fetched pack; the auto-resolver also links by name when not explicit.
  function courseSummary(course) {
    if (!course) return "";
    const parts = [boardIdToName(course.board), qualIdToName(course.qual), course.code];
    return `${parts.filter(Boolean).join(" · ")}${course.title ? " — " + course.title : ""}`.trim();
  }

  function renderLinkArea() {
    if (!el.linkPill) return;
    const subject = focusedSubject;
    const course = subject ? coursesBySubject[subject] : null;
    linkHint = null;
    if (course) {
      el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill linked" data-act="open" title="${escapeHtml(courseSummary(course))}"><i class="fa-solid fa-link"></i> ${escapeHtml(courseSummary(course))}</button>`;
    } else {
      const res = subject && !coursesBySubject[subject] ? courseResolution(subject) : { course: null, ambiguous: false, candidates: [] };
      linkHint = res.ambiguous ? null : res.course;
      if (res.ambiguous) {
        const n = res.candidates.length;
        el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill suggest" data-act="ambiguity" title="${n} matched courses — choose the one that is yours.">Ambiguous (${n} courses) — choose yours</button>`;
      } else if (linkHint) {
        el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill suggest" data-act="suggest" title="Matched from your fetched pack. Click to confirm.">Is this your course? ${escapeHtml(courseSummary(linkHint))}</button>`;
      } else {
        el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill" data-act="open"><i class="fa-solid fa-link"></i> Link subject</button>`;
      }
    }
    const pill = el.linkPill.querySelector(".tracker-link-pill");
    if (pill) {
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pill.dataset.act === "suggest") {
          if (linkHint) applyOfficialCourse(subject, linkHint);
        } else {
          openLinkPicker(subject);
        }
      });
    }
  }

  function openLinkPicker(subject) {
    if (el.colsPop) el.colsPop.hidden = true;
    if (el.linkFilter) el.linkFilter.value = "";
    chipTokens.clear();
    renderCourseList();
    seedLinkCourses();
    if (el.unlinkBtn) el.unlinkBtn.hidden = !(subject && coursesBySubject[subject]);
    if (el.linkPop) el.linkPop.hidden = false;
  }

  function closeLinkPicker() {
    if (el.linkPop) el.linkPop.hidden = true;
    clearLinkScratch();
  }

  // Populate the link picker with official subjects for EVERY exam board.
  // This is just the TRACKER's view onto the one shared sweep in
  // gradeBoundaries.js — the same engine the scraper and the auto-warm use.
  // Cached series never re-fetch, dead series aren't retried within the retry
  // window, and a recently-completed sweep is served as-is, so opening the
  // picker never triggers a fresh fetch set. Concurrent opens/queues collapse
  // into one run.
  async function seedLinkCourses() {
    renderCourseList();
    linkScratch("Checking AQA, OCR and Pearson grade-boundaries cache...");
    const total = listCachedCourses(loadBoundaryCache()).length;
    if (total === 0) {
      if (el.linkList) el.linkList.innerHTML = `<div class="tracker-course-empty">Fetching official subjects from AQA, OCR and Pearson...</div>`;
    } else {
      renderCourseList();
    }
    await runBoundarySweep({
      onStatus: (s) => linkScratch(sweepMessage(s))
    });
    if (el.linkList) renderCourseList();
    linkScratchDone(`${listCachedCourses(loadBoundaryCache()).length} official subjects ready — search to link.`);
  }

  // A human-readable line from the shared sweep status ("Fetching OCR GCSE June
  // 2025…", "3/12 series done, 1 failed…"), shown in the picker + customise.
  function sweepMessage(s) {
    if (!s) return "Waiting on grade-boundaries fetch...";
    if (s.phase === "discovering") return s.current && s.current.message
      ? `Scanning exam boards: ${s.current.message}`
      : "Scanning AQA, OCR and Pearson for the latest grade boundaries...";
    if (s.phase === "fetching") {
      const cur = s.current || {};
      const label = [boardIdToName(cur.board), quadLabel(cur.qual), cur.seriesLabel].filter(Boolean).join(" ");
      const base = label ? `Fetching ${label}...` : "Fetching grade boundaries...";
      if (cur.message && !/^\s*fetching\s*/i.test(cur.message)) return `${base} ${cur.message}`;
      if (s.jobsTotal > 0) return `${base} (${s.jobsDone + s.jobsFailed}/${s.jobsTotal} series done)`;
      return base;
    }
    if (s.phase === "ready") {
      const failed = s.jobsFailed || 0;
      const note = failed ? ` — ${failed} series unavailable (will retry later)` : "";
      return `Grade-boundary cache ready${note}.`;
    }
    return "Checking grade-boundary cache...";
  }

  function quadLabel(qualId) {
    const m = { gcse: "GCSE", alevel: "A-Level", as: "AS" };
    return m[String(qualId || "").toLowerCase()] || String(qualId || "");
  }

  // Search strengthening: every whitespace token must match (order-independent),
  // and qual/board levels are NOT mutually exclusive — "chemistry aqa gcse" and
  // "a level" both work. Matches against title, code, board id/name, qual id/name.
  function normalizeSearch(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\ba level\b/g, "alevel")
      .replace(/\bas level\b/g, "as");
  }

  function courseTerms(c) {
    const set = new Set();
    const put = (...xs) => {
      for (const x of xs) {
        const t = String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!t) continue;
        set.add(t);
        for (const part of t.split(/\s+/)) if (part) set.add(part);
      }
    };
    put(c.code);
    put(c.title);
    put(c.board, c.boardName);
    put(qualIdToName(c.qual), c.qualName);
    const qualProbe = normalizeSearch(`${qualIdToName(c.qual)} ${c.qualName || ""} ${c.qual || ""}`);
    if (qualProbe.includes("alevel")) { set.add("alevel"); set.add("a level"); }
    return set;
  }

  function matchesTokens(c, tokens) {
    if (tokens.length === 0) return true;
    const hay = courseTerms(c);
    return tokens.every((tok) => [...hay].some((h) => h.includes(tok)));
  }

  function queryTokens() {
    const typed = normalizeSearch(el.linkFilter ? el.linkFilter.value : "");
    const t = typed ? typed.split(/\s+/).filter(Boolean) : [];
    return [...new Set([...chipTokens, ...t])];
  }

  function chipForToken(tok) {
    if (tok === "alevel") return "alevel";
    if (tok === "as") return "as";
    if (tok === "gcse") return "gcse";
    if (tok === "aqa") return "aqa";
    if (tok === "ocr") return "ocr";
    if (tok && (tok === "pearson" || tok.includes("edexcel"))) return "pearson";
    return null;
  }

  function updateChipLighting() {
    if (!el.linkFilters) return;
    const tokens = queryTokens();
    const lit = new Set(tokens.map(chipForToken).filter(Boolean));
    if (tokens.length === 0) lit.add("");
    el.linkFilters.querySelectorAll(".tracker-chip").forEach((ch) =>
      ch.classList.toggle("active", lit.has(ch.dataset.f || ""))
    );
  }

  // Scraper-style "scratch buffer": one overwriting log line that sweeps a
  // green gradient while work is in progress, fills on completion, then
  // breathes softly. It never accumulates history — the most recent message
  // replaces the previous one.
  let linkScratchLine = null;
  let linkCompletionTimer = null;

  function linkScratch(message, shimmer = true) {
    if (!el.linkStatus) return;
    el.linkStatus.hidden = false;
    if (!linkScratchLine) {
      linkScratchLine = document.createElement("div");
      linkScratchLine.className = "tracker-log-line";
      linkScratchLine.innerHTML = `<span class="tracker-log-text"></span>`;
      el.linkStatus.appendChild(linkScratchLine);
    }
    const text = linkScratchLine.querySelector(".tracker-log-text");
    if (text) text.textContent = message;
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkCompletionTimer = null;
    linkScratchLine.classList.remove("idle", "tracker-log-done", "tracker-log-glow");
    linkScratchLine.classList.toggle("tracker-log-shimmer", !!shimmer);
  }

  function linkScratchDone(message) {
    linkScratch(message, false);
    if (!linkScratchLine) return;
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkScratchLine.classList.remove("tracker-log-shimmer", "tracker-log-done", "tracker-log-glow");
    linkScratchLine.classList.add("tracker-log-done");
    linkCompletionTimer = setTimeout(() => {
      linkScratchLine.classList.remove("tracker-log-done");
      linkScratchLine.classList.add("tracker-log-glow");
      linkCompletionTimer = null;
    }, 2000);
  }

  function clearLinkScratch() {
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkCompletionTimer = null;
    linkScratchLine = null;
    if (el.linkStatus) {
      el.linkStatus.innerHTML = "";
      el.linkStatus.hidden = true;
    }
  }

  function sweepBusyNow() {
    const s = getBoundaryStatus();
    return !!(s && (s.phase === "discovering" || s.phase === "fetching"));
  }

  function renderLinkStatus() {
    if (!el.linkStatus) return;
    const busy = sweepBusyNow();
    if (!busy) {
      if (el.linkFilter) el.linkFilter.classList.remove("tracker-input-skeleton");
      return;
    }
    if (el.linkFilter) el.linkFilter.classList.add("tracker-input-skeleton");
    if (!linkScratchLine) linkScratch("Fetching official subjects from AQA, OCR and Pearson...");
  }

  const TRACKER_SKELETON_ROWS = 6;

  function renderCourseList() {
    const courses = listCachedCourses(loadBoundaryCache());
    const tokens = queryTokens();
    const visible = courses.filter((c) => matchesTokens(c, tokens));
    updateChipLighting();
    renderLinkStatus();
    const subject = focusedSubject;
    const current = subject ? coursesBySubject[subject] : null;

    if (!el.linkList) return;
    if (visible.length === 0) {
      const busy = sweepBusyNow();
      if (busy && courses.length === 0) {
        // Loading placeholder: shimmer rows until the first subjects land so
        // the popover shows instant, tangible progress instead of a plain text
        // line while the fetch pass runs.
        el.linkList.innerHTML =
          `<div class="tracker-track-skel">` +
          Array.from({ length: TRACKER_SKELETON_ROWS }, () => `<div class="tracker-track-skel-row"></div>`).join("") +
          `</div>`;
        return;
      }
      el.linkList.innerHTML = courses.length === 0
        ? `<div class="tracker-course-empty">No subjects available yet &mdash; fetching from AQA, OCR and Pearson failed, or there's no cached data. Open the <b>Scraper</b> tool to fetch boundaries manually.</div>`
        : `<div class="tracker-course-empty">No subjects match those filters.</div>`;
      return;
    }

    let html = "";
    let lastBoard = "";
    for (const c of visible) {
      if (c.boardName !== lastBoard) {
        if (lastBoard !== "") html += "</div>";
        html += `<div class="tracker-course-board">${escapeHtml(c.boardName)}</div>`;
        lastBoard = c.boardName;
      }
      const isSel = !!current && c.board === current.board && c.code === current.code && c.qual === current.qual && normalizeTitle(c.title) === normalizeTitle(current.title);
      const codeTxt = c.code ? `<span class="course-code">${escapeHtml(c.code)}</span> ` : "";
      html +=
        `<button type="button" class="tracker-course-item${isSel ? " sel" : ""}" data-board="${escapeHtml(c.board)}" data-qual="${escapeHtml(c.qual)}" data-code="${escapeHtml(c.code)}" data-title="${escapeHtml(c.title || "")}">` +
        `${codeTxt}${escapeHtml(c.title)} <span class="course-qual">${escapeHtml(c.qualName)}${c.maxMark ? ` &middot; max ${escapeHtml(String(c.maxMark))}` : ""}</span>` +
        `</button>`;
    }
    html += "</div>";
    el.linkList.innerHTML = html;
  }

  async function applyOfficialCourse(subject, candidate) {
    if (!subject || !candidate) return;
    if (el.linkList) el.linkList.innerHTML = "";
    try {
      const nodes = (await getAllNodes()) || [];
      const existing = nodes.find((n) => n.type === "subject" && (n.subject === subject || n.name === subject));
      const course = { board: candidate.board, code: candidate.code, title: candidate.title, qual: candidate.qual };
      if (existing) {
        await addNode({
          ...existing,
          officialCourse: course,
          customized: false,
          examBoard: existing.examBoard || candidate.boardName,
          qualification: existing.qualification || candidate.qualName,
          updatedAt: Date.now()
        });
      } else {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: candidate.boardName,
          qualification: candidate.qualName,
          customized: false,
          officialCourse: course,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      await loadSubjects();
      closeLinkPicker();
      renderPapers();
      flash(`Linked ${subject} to ${courseSummary(course)}. Boundaries auto-load from the fetched pack.`, true);
    } catch (err) {
      if (el.linkList) el.linkList.innerHTML = `<div class="tracker-course-empty">Could not link ${escapeHtml(subject)} (${escapeHtml(err && err.message ? err.message : String(err))}).</div>`;
    }
  }

  async function unlinkOfficialCourse(subject) {
    if (!subject) return;
    if (el.linkList) el.linkList.innerHTML = "";
    const confirmed = await dialog.confirm(`Unlink ${subject} from its official course?`, "Unlink", "danger");
    if (!confirmed) return;
    try {
      const nodes = (await getAllNodes()) || [];
      const existing = nodes.find((n) => n.type === "subject" && (n.subject === subject || n.name === subject));
      if (existing) {
        await addNode({ ...existing, officialCourse: null, updatedAt: Date.now() });
      } else {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: "", qualification: "", customized: false, officialCourse: null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      await loadSubjects();
      closeLinkPicker();
      renderPapers();
      flash(`Unlinked ${subject}.`, true);
    } catch (err) {
      if (el.linkList) el.linkList.innerHTML = `<div class="tracker-course-empty">Could not unlink ${escapeHtml(subject)} (${escapeHtml(err && err.message ? err.message : String(err))}).</div>`;
    }
  }

  // ---- view switching ----
  function showView(view) {
    el.papers.style.display = view === "papers" ? "" : "none";
    el.stats.style.display = view === "stats" ? "" : "none";
    el.papersBtn.classList.toggle("active", view === "papers");
    el.statsBtn.classList.toggle("active", view === "stats");
    if (view === "papers") renderPapers();
    if (view === "stats") renderStats();
  }

  // ---- papers list ----
  function refreshSubjectDatalist() {
    const seen = new Set(allSubjects.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean));
    for (const p of papers) if (p.subject) seen.add(p.subject);
    el.subjectList.innerHTML = Array.from(seen).map((s) => `<option value="${escapeHtml(s)}">`).join("");
  }

  function sittingAverage(sitting) {
    const scored = (sitting.results || []).map((r) => bestAttemptPct(r)).filter((p) => p !== null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((m, p) => m + p, 0) / scored.length);
  }

  function latestAttempt(result) {
    if (!result.attempts || result.attempts.length === 0) return result;
    return result.attempts[result.attempts.length - 1];
  }

  function numberEq(v) {
    // null/undefined/empty are "no value", NOT 0 — Number(null) coerces to 0
    // which turns an undated lookup into a phantom year-0 lookup.
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function bestAttemptPct(result) {
    const list = (result.attempts && result.attempts.length ? result.attempts : [result]);
    let best = null;
    for (const a of list) {
      const score = numberEq(a.score);
      const max = numberEq(a.maxMarks);
      if (score === null || max === null || max <= 0) continue;
      const p = pct(score, max);
      if (best === null || p > best) best = p;
    }
    return best;
  }

  function compareSorted(a, b) {
    const yb = (numberEq(b.year) || 0) - (numberEq(a.year) || 0);
    if (yb !== 0) return yb;
    const SESSION_ORDER = { "November": 3, "October": 2, "June": 1, "May": 1, "March": 0, "Specimen": -1, "Mock": -1 };
    const sb = (SESSION_ORDER[b.series] ?? 0) - (SESSION_ORDER[a.series] ?? 0);
    if (sb !== 0) return sb;
    return 0;
  }

  function visiblePapers() {
    return focusedSubject
      ? papers.filter((p) => (p.subject || "Unassigned") === focusedSubject)
      : papers;
  }

  function setAllNotes(open) {
    const visible = visiblePapers();
    for (const s of visible) {
      if (!s.notes) continue;
      if (open) expandedNotes.add(s.id);
      else expandedNotes.delete(s.id);
    }
    renderPapers();
  }

  function renderPapers() {
    refreshSubjectDatalist();

    const showAll = !focusedSubject;
    const visible = visiblePapers();

    if (el.tableInfo) {
      el.tableInfo.innerHTML = showAll
        ? `All subjects`
        : `<b>${escapeHtml(focusedSubject)}</b> &middot; ${visible.length} sitting${visible.length === 1 ? "" : "s"}`;
    }

    const anyNotes = visible.some((s) => !!s.notes);
    el.dropBtn.disabled = !anyNotes;
    el.collapseBtn.disabled = !anyNotes;

    if (showAll) {
      if (el.linkPill) el.linkPill.innerHTML = "";
    } else {
      renderLinkArea();
    }

    el.paperGroups.innerHTML = "";
    if (visible.length === 0) {
      el.paperGroups.innerHTML =
        '<div class="tracker-empty">' + (showAll ? "No past papers tracked yet." : `No past papers for <b>${escapeHtml(focusedSubject)}</b> yet.`) +
        '<br><button id="trackerEmptyAddBtn" class="tracker-btn primary">Add a sitting</button></div>';
      const b = $("trackerEmptyAddBtn");
      if (b) b.addEventListener("click", () => openModal(null));
      renderBoundaryChips();
      return;
    }

    const sorted = visible.slice().sort(compareSorted);
    const cacheSrc = loadBoundaryCache();

    const scroll = document.createElement("div");
    scroll.className = "sit-scroll";
    const table = document.createElement("table");
    table.className = "sit-table";
    const thead = document.createElement("thead");
    let header = `<tr>` + (showAll ? `<th class="col-subject">Subject</th>` : "");
    if (cols.sitting) header += `<th class="col-session">Sitting</th>`;
    header += `<th class="col-papers">Papers</th>`;
    if (cols.boundary) header += `<th class="col-boundary">Boundary</th>`;
    if (cols.avg) header += `<th class="col-avg">Avg</th>`;
    header += `<th class="col-actions"></th></tr>`;
    thead.innerHTML = header;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const openNow = new Set(expandedNotes);
    for (const sitting of sorted) {
      const hasNote = !!sitting.notes;
      const row = renderMainRow(sitting, showAll, hasNote && openNow.has(sitting.id), cacheSrc);
      tbody.appendChild(row.main);
      if (hasNote) {
        row.note.hidden = !openNow.has(sitting.id);
        tbody.appendChild(row.note);
      }
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    el.paperGroups.appendChild(scroll);
    renderBoundaryChips();
  }

  // Auto-ensure boundary packs for every dated row that has no cached table
  // yet, so per-year boundaries are populated without the user having to open
  // the Scraper. Runs TARGETED (only the series each row actually needs, via
  // the shared engine) and NEVER renders from inside itself — a previous
  // version called a full sweep + renderPapers() from here, which made
  // focus-subject spin render -> warm -> render -> ... forever with no idle
  // between microtasks: the whole app froze with no clicks.
  //
  // The warm path is deliberately decoupled from rendering:
  //  - renderPapers() does NOT kick it, so a cache-change render can never
  //    re-enter network work from inside the render pass.
  //  - scheduleWarm() defers to a macrotask and is single-flight (a running
  //    warm consumes pending kicks; there is no recursion in a finally).
  //  - each kick fetches at most MAX_WARM_JOBS_PER_KICK series, yields
  //    between every fetch, and continues via a fresh macrotask only when it
  //    actually made progress, so it provably terminates.
  //  - series that failed within the retry window are skipped, so a dead
  //    legacy URL cannot churn fetch+parse churn from every schedule.
  const MAX_WARM_JOBS_PER_KICK = 6;
  let warmTimer = null;
  let warmRunning = false;

  function collectWarmJobs(cache) {
    // Legacy fixed-candidate planner — superseded by planRequirements below;
    // kept only for callers that still query it synchronously.
    const jobs = new Map();
    for (const sitting of papers || []) {
      if (!sitting || !sitting.subject) continue;
      if (/^(mock|specimen)$/i.test(String(sitting.series || "").trim())) continue;
      const year = numberEq(sitting.year);
      if (year === null) continue;
      const course = resolveCourse(cache, sitting.subject);
      if (!course) continue;
      const board = boardToId(course && course.board);
      const qualId = qualToId(course && course.qual);
      if (!board || !qualId) continue;
      // Already resolvable from the cache — nothing to do for this row.
      if (findGradeTable(cache, course, year, sitting.series)) continue;
      const target = bestSeriesForYear(board, year, trackerSeriesToMonth(sitting.series));
      if (!target) continue;
      const key = `${board}:${target.month}-${target.year}:${qualId}`;
      if (!jobs.has(key)) jobs.set(key, { board, qualId, series: target });
    }
    return jobs;
  }

  // ---- planner-based warm path (examData scheduler) ----
  // Only the exam-data scheduler decides what work exists. This browser layer
  // owns execution: real network fetches, the retry window, and the per-kick
  // cap. Boundary and paper requirements for the same course+series are two
  // outputs of one fetch (the scraper returns papers with the boundary pack),
  // so the executor satisfies both with a single ensureBoundarySeries call.

  function warmEnrollment(sitting, cache) {
    if (!sitting || !sitting.subject) return null;
    const course = resolveCourse(cache, sitting.subject);
    if (!course) return null;
    const board = boardToId(course && course.board);
    const qual = qualToId(course && course.qual);
    if (!board || !qual) return null;
    return {
      board,
      qual,
      code: String(course.code || ""),
      tier: String(course.tier || "").toUpperCase() || undefined
    };
  }

  function warmSatisfied(cache) {
    return (type, courseKey, seriesKey, base) => {
      const parsed = parseCourseKey(courseKey);
      if (!parsed) return true;
      if (type === REQUIREMENT_TYPES.BOUNDARY) {
        const year = Number(base.series.year);
        if (!Number.isFinite(year)) return true;
        const word = { JUN: "Jun", NOV: "Nov" }[String(base.series.month || "").toUpperCase()] ||
          String(base.series.month || "");
        const decision = resolveBoundaryDecision(cache, parsed, year, word, {});
        return decision.kind === "official" || decision.kind === "manual";
      }
      // Papers are satisfied once the series entry carries paper metadata — the
      // boundary fetch itself delivers that, so the seam needs no extra work.
      const entry = (cache.entries || {})[seriesKeyOf(base.board, base.qual, base.series)];
      return !!(entry && Array.isArray(entry.subjects) &&
        entry.subjects.some((s) => Array.isArray(s.papers) && s.papers.length > 0));
    };
  }

  function planWarmRequirements(cache) {
    const reqs = planRequirements(
      papers,
      (sitting) => warmEnrollment(sitting, cache),
      warmSatisfied(cache)
    );
    return reqs.filter((r) => r.type === REQUIREMENT_TYPES.BOUNDARY &&
      !seriesRecentlyAttempted(r.key));
  }

  function scheduleWarm() {
    if (warmRunning || warmTimer) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      warmRunning = true;
      (async () => {
        try {
          await runWarmFlight();
        } finally {
          warmRunning = false;
        }
      })();
    }, 0);
  }

  // Best-effort; a failure just leaves that series uncached. Concurrent runs
  // share one in-flight fetch inside ensureBoundarySeries.
  async function runWarmFlight() {
    const cache = loadBoundaryCache();
    const reqs = planWarmRequirements(cache);
    if (reqs.length === 0) return;
    let madeFetch = false;
    let attempted = 0;
    for (const r of reqs) {
      if (r.type !== REQUIREMENT_TYPES.BOUNDARY) continue;
      if (seriesRecentlyAttempted(r.key)) continue;
      if (attempted >= MAX_WARM_JOBS_PER_KICK) break;
      attempted++;
      await new Promise((res) => setTimeout(res, 0));
      try {
        await ensureBoundarySeries(r.board, { id: r.qual }, r.series, () => {});
        madeFetch = true;
      } catch (e) {
        /* best-effort */
      }
    }
    // If this kick did real work and rows still need series, continue in a
    // fresh macrotask rather than recursively re-entering the flight.
    const remaining = planWarmRequirements(loadBoundaryCache()).length > 0;
    if (madeFetch && remaining) scheduleWarm();
    // If only paper requirements remain (entries lack paper metadata) there is
    // nothing fetchable for them here yet — the paper catalogue seam (Phase C-2)
    // will own that work; do not busy-loop over it.
  }

  function shortSeries(s) {
    if (!s) return "";
    const m = { june: "J", jun: "J", summer: "S", november: "N", nov: "N", autumn: "A", winter: "W", march: "M" };
    const k = String(s).toLowerCase();
    return m[k] ? m[k] : String(s);
  }

  function sessionTitle(sitting) {
    if (sitting.year == null || sitting.year === "") {
      if (sitting.series) return escapeHtml(shortSeries(sitting.series));
      if (sitting.label) return escapeHtml(String(sitting.label));
      return "Unstated";
    }
    let t = String(sitting.year);
    const ser = shortSeries(sitting.series);
    if (ser) t += " <span class=\"series\">(" + escapeHtml(ser) + ")</span>";
    return t;
  }

  function scoreSummary(sitting) {
    const parts = (sitting.results || []).map((r) => {
      const at = latestAttempt(r);
      const score = numberEq(at.score);
      const max = numberEq(at.maxMarks);
      if (score == null || max == null) return null;
      const short = r.paper ? r.paper.replace(/^Paper\s+/i, "P") : "?";
      const p = pct(score, max);
      const low = p !== null && isLow(p) ? " low" : "";
      return `<span class="head-score"><span class="head-score-name">${escapeHtml(short)}</span> <b${low}>${score}</b>/<i>${max}</i>${p != null ? ` <em>${p}%</em>` : ""}</span>`;
    }).filter(Boolean);
    if (parts.length === 0) return `<span class="tracker-sitting-badge">no scores</span>`;
    return `<span class="head-scores">${parts.join("")}</span>`;
  }

  function highestGradeLabel(subject) {
    const subjNode = subjectNodes.find((s) => (s.name || s.subject) === subject);
    const q = subjNode ? (subjNode.qualification || "") : "";
    if (/A.?Level/i.test(q)) return "A*";
    if (/GCSE/i.test(q)) return "Grade 9";
    return "Boundary";
  }

  async function ensureQualifications() {
    const want = Array.from(new Set(papers.map((p) => p.subject).filter(Boolean)));
    const missing = [];
    for (const subject of want) {
      const node = subjectNodes.find((s) => (s.name || s.subject) === subject);
      if (node && node.qualification) continue; // already set
      if (!node) {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: "", qualification: "", customized: false, officialCourse: null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      missing.push(subject);
    }
    if (missing.length === 0) return;

    let answer = null;
    if (missing.length === 1) {
      answer = await dialog.prompt(`Is ${missing[0]} GCSE or A-Level?`, "GCSE");
    } else {
      answer = await dialog.prompt(`What level are these subjects: ${missing.join(", ")}?\n(GCSE or A-Level - drives the grade labels)`, "GCSE");
    }
    if (answer === null) return; // user declined
    const qual = (answer || "").trim();
    if (!qual) return;
    for (const subject of missing) {
      const nodes = (await getAllNodes()) || [];
      const n = nodes.find((x) => x.type === "subject" && (x.subject === subject || x.name === subject));
      if (n) await addNode({ ...n, qualification: qual, updatedAt: Date.now() });
    }
    await loadSubjects();
  }

  function renderMainRow(sitting, showSubject, noteOpen, cacheSrc) {
    const cache = cacheSrc || loadBoundaryCache();
    const course = sitting.subject ? resolveCourse(cache, sitting.subject) : null;
    const yearNum = numberEq(sitting.year);
    const decision = resolveBoundaryDecision(cache, course, yearNum, sitting.series, sitting);
    const gb = decision.hasTable ? decision.table : null;

    const avg = sittingAverage(sitting);
    const avgEl = avg !== null
      ? `<span style="color:${avg < 60 ? "#ff8c8c" : "var(--accent)"};font-weight:700;">${avg}%</span>`
      : `<span class="tracker-sitting-badge">&ndash;</span>`;

    const tr = document.createElement("tr");
    tr.className = "row-main";
    const annotatedSitting = annotateSitting(sitting);
    tr.dataset.courseId = String(annotatedSitting.courseId || "");
    tr.dataset.seriesId = String(annotatedSitting.seriesId || "");

    const cells = [];
    if (showSubject) {
      cells.push(td(`<span class="sit-subject">${escapeHtml(sitting.subject || "Unassigned")}</span>`, "col-subject"));
    }
    if (cols.sitting) {
      cells.push(td(`<span class="sit-session">${sessionTitle(sitting)}</span>`, "col-session"));
    }
    cells.push(td(`<div class="sit-papers">${scoreSummary(sitting)}${subjectGradeChip(sitting, gb)}</div>`, "col-papers"));
    if (cols.boundary) {
      cells.push(td(boundaryBadges(sitting.subject, decision), "col-boundary"));
    }
    if (cols.avg) {
      cells.push(td(avgEl, "col-avg"));
    }

    const hasNote = !!sitting.notes;
    const actionsCell = document.createElement("td");
    actionsCell.className = "col-actions";
    actionsCell.innerHTML =
      (hasNote ? `<button class="row-btn note-toggle ${noteOpen ? "open" : ""}" data-act="note" title="${noteOpen ? "Collapse" : "Expand"} note">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 15.7v-5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="7.1" r="1.3" fill="currentColor"/></svg>` +
        `</button>` : "") +
      `<button class="row-btn" data-act="edit" title="Edit">&#9998;</button>` +
      `<button class="row-btn danger" data-act="del" title="Delete">&#10005;</button>`;
    if (hasNote) {
      actionsCell.querySelector('[data-act="note"]').addEventListener("click", () => toggleNote(sitting));
    }
    actionsCell.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(sitting));
    actionsCell.querySelector('[data-act="del"]').addEventListener("click", () => removePaper(sitting));
    cells.push(actionsCell);

    for (const c of cells) tr.appendChild(c);

    let note = null;
    if (hasNote) {
      note = document.createElement("tr");
      note.className = "note-row";
      const ntd = document.createElement("td");
      ntd.colSpan = cells.length;
      ntd.innerHTML = `<div class="note-inner"></div>`;
      ntd.firstChild.textContent = sitting.notes;
      note.appendChild(ntd);
    }
    return { main: tr, note };
  }

  // Boundary column content. Default: the top grade's threshold from the
  // sitting's OWN fetched year-pack — the source of truth, never fabricated.
  // When the user picked aim grades for the subject, show those thresholds
  // instead (still from this sitting's year-pack only). A dated sitting whose
  // year-pack was never fetched renders an honest dash with an explanation —
  // the tracker does NOT substitute another year's numbers. Only undated rows
  // (a sitting in progress, no exam year yet) may fall back to the subject's
  // best published table, since there is no official boundary to claim.
  function boundaryBadges(subject, decision) {
    const aim = aimFor(subject);
    const topLabel = escapeHtml(highestGradeLabel(subject));
    const badge = (mark, t, cls) => {
      const title = t != null ? ` title="${escapeHtml(t)}"` : "";
      return `<span class="tracker-sitting-badge bnd${cls ? ` ${cls}` : ""}"${title}>${topLabel}${mark != null ? ` &ge; ${escapeHtml(String(mark))}` : ""}</span>`;
    };
    if (decision.kind === "unknown") {
      return `<span class="tracker-sitting-badge bnd bnd-unknown" title="${escapeHtml(decision.tip || "No boundary data")}">&ndash;</span>`;
    }
    if (aim.length && decision.hasTable) {
      const items = aim.map((label) => ({ label, mark: findGradeMark(decision.table, label) }));
      if (items.length) {
        return items.map((x) =>
          `<span class="tracker-sitting-badge bnd" title="${escapeHtml(decision.tip || "")}">${escapeHtml(x.label)} &ge; ${x.mark != null ? escapeHtml(String(x.mark)) : "&ndash;"}</span>`
        ).join("");
      }
    }
    if (decision.top != null) {
      const cls = decision.kind === "projected" ? " bnd-proj" : "";
      return badge(decision.top, decision.tip, cls);
    }
    return `<span class="tracker-sitting-badge bnd bnd-unknown" title="${escapeHtml(decision.tip || "No boundary data")}">&ndash;</span>`;
  }

  function td(html, cls) {
    const c = document.createElement("td");
    if (cls) c.className = cls;
    c.innerHTML = html;
    return c;
  }

  function toggleNote(sitting) {
    const id = sitting.id;
    if (expandedNotes.has(id)) expandedNotes.delete(id);
    else expandedNotes.add(id);
    renderPapers();
  }

  // ---- modal (add / edit a sitting) ----
  function openModal(sitting) {
    editingId = sitting ? sitting.id : null;
    slotSeq = (sitting && sitting.results) ? sitting.results.map((r) => r.paper || "").filter(Boolean) : [];
    el.modalTitle.textContent = editingId ? "Edit sitting" : "Add sitting";

    const initSubject = sitting ? (sitting.subject || "") : (focusedSubject || "");
    el.formSubject.value = initSubject;
    el.formYear.value = sitting ? (sitting.year ?? "") : "";
    el.formSeries.value = sitting ? (sitting.series || "") : "";
    el.formNotes.value = sitting ? (sitting.notes || "") : "";

    const slots = sitting ? (sitting.results || []) : [];
    el.slotList.innerHTML = "";
    const premade = sitting ? null : coursePapers(initSubject);
    if (premade && premade.length) {
      premade.forEach((p) => addSlotRow(null, { paper: p.label, maxMark: p.maxMark }));
    } else if (slots.length === 0) addSlotRow();
    else slots.forEach((r) => addSlotRow(r));

    el.formMsg.textContent = "";
    el.modal.classList.add("open");
    setTimeout(() => el.formSubject.focus(), 0);
  }

  function todayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function addSlotRow(result, preset) {
    const idx = el.slotList.children.length;
    const row = document.createElement("div");
    row.className = "tracker-slot-editor";
    row.dataset.slot = idx;

    const att = (result && result.attempts) ? result.attempts : [];
    const base = result || {};
    const fresh = att.length === 0;
    const baseMax = fresh && preset && preset.maxMark != null ? preset.maxMark : null;

    let attemptsHTML = "";
    const list = att.length ? att : [{ score: base.score, maxMarks: base.maxMarks, date: base.date }];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const maxVal = a.maxMarks != null ? a.maxMarks : baseMax;
      const dateVal = a.date || (fresh && i === 0 ? todayDate() : "");
      attemptsHTML +=
        `<div class="attempt-row">` +
        `<label style="flex:none;font-size:0.75rem;color:var(--text-muted);">${i === 0 ? "1st" : i === 1 ? "2nd" : (i + 1) + "th"}:</label>` +
        `<input data-att-score class="tracker-att-score" type="number" placeholder="Score" value="${a.score != null ? escapeHtml(String(a.score)) : ""}" />` +
        `<input data-att-max class="tracker-att-max" type="number" placeholder="Max" value="${maxVal != null ? escapeHtml(String(maxVal)) : ""}" />` +
        `<input data-att-date class="tracker-att-date" type="text" placeholder="Date" value="${dateVal ? escapeHtml(String(dateVal)) : ""}" />` +
        `<button class="tracker-att-del" type="button" title="Remove attempt">&times;</button>` +
        `</div>`;
    }

    const usedNames = new Set(slotSeq);
    let paperVal = (preset && preset.paper) || base.paper || "";
    if (!paperVal) {
      let n = 1;
      while (usedNames.has("Paper " + n)) n++;
      paperVal = "Paper " + n;
    }
    usedNames.add(paperVal);

    row.innerHTML =
      `<div class="head">` +
      `<input class="tracker-slot-paper" type="text" placeholder="Paper name" value="${escapeHtml(paperVal)}" />` +
      `<button type="button" class="tracker-slot-del" title="Remove paper">Remove</button>` +
      `</div>` +
      `<div class="tracker-att-list">${attemptsHTML}</div>` +
      `<button type="button" class="tracker-att-add">+ Attempt</button>`;

    row.querySelector(".tracker-slot-del").addEventListener("click", () => row.remove());
    row.querySelector(".tracker-att-add").addEventListener("click", () => {
      const wrap = row.querySelector(".tracker-att-list");
      const div = document.createElement("div");
      div.className = "attempt-row";
      div.innerHTML =
        `<label style="flex:none;font-size:0.75rem;color:var(--text-muted);">${wrap.children.length + 1}-th:</label>` +
        `<input data-att-score type="number" placeholder="Score" />` +
        `<input data-att-max type="number" placeholder="Max" />` +
        `<input data-att-date type="text" placeholder="Date" value="${todayDate()}" />` +
        `<button class="tracker-att-del" type="button" title="Remove attempt">&times;</button>`;
      div.querySelector(".tracker-att-del").addEventListener("click", () => div.remove());
      wrap.appendChild(div);
    });
    row.querySelectorAll(".tracker-att-del").forEach((b) =>
      b.addEventListener("click", (e) => {
        const wrap = row.querySelector(".tracker-att-list");
        if (wrap.children.length <= 1) return;
        e.target.closest(".attempt-row").remove();
      })
    );

    el.slotList.appendChild(row);
  }

  function closeModal() {
    el.modal.classList.remove("open");
    editingId = null;
  }

  async function collectSitting() {
    const subject = el.formSubject.value.trim();
    const yearRaw = el.formYear.value.trim();
    const year = yearRaw === "" ? null : Number(yearRaw);
    const series = el.formSeries.value;
    const notes = el.formNotes.value.trim();
    const examBoard = boardFor(subject);
    const qualification = qualFor(subject);

    if (!subject) { flash("Subject is required.", false); return null; }
    if ((year !== null && !Number.isFinite(year))) { flash("Enter a valid year.", false); return null; }

    const gradeBoundaries = resolveBoundaryTable(subject, year, series) || null;
    let boundary = gradeBoundaries ? topGradeOf(gradeBoundaries) : null;
    if (boundary === null) {
      const existing = editingId && papers.find((p) => p.id === editingId);
      const existingBoundary = existing ? numberEq(existing.gradeBoundary) : null;
      if (existingBoundary !== null && existingBoundary !== 0) boundary = existingBoundary;
      else {
        const sittingLabel = [year, series].filter(Boolean).join(" ") || "this sitting";
        const continueManual = await dialog.confirm(
          `No official grade-boundary data is available for ${subject} (${sittingLabel}). You will need to enter the boundary yourself.`,
          "Enter manually",
          "primary"
        );
        if (!continueManual) { flash("Sitting not saved: a boundary is required.", false); return null; }
        const raw = await dialog.prompt(
          `Enter the top-grade boundary mark for ${subject} (${sittingLabel}). This value will be saved with this sitting.`,
          ""
        );
        if (raw === null || raw.trim() === "") { flash("Sitting not saved: enter a boundary mark.", false); return null; }
        boundary = Number(raw.trim());
        if (!Number.isFinite(boundary) || boundary < 0) {
          flash("Sitting not saved: the boundary must be a non-negative number.", false);
          return null;
        }
      }
    }

    const results = [];
    for (const row of el.slotList.querySelectorAll(".tracker-slot-editor")) {
      const paper = row.querySelector(".tracker-slot-paper").value.trim();
      if (!paper) continue;
      const attempts = [];
      for (const ar of row.querySelectorAll(".attempt-row")) {
        const score = ar.querySelector("[data-att-score]").value.trim();
        const max = ar.querySelector("[data-att-max]").value.trim();
        if (score === "" && max === "") continue;
        if (score === "" || max === "") { flash("Each attempt needs both score and max.", false); return null; }
        const nScore = Number(score), nMax = Number(max);
        if (!Number.isFinite(nScore) || !Number.isFinite(nMax)) { flash("Scores must be numbers.", false); return null; }
        attempts.push({ score: nScore, maxMarks: nMax, date: ar.querySelector("[data-att-date]").value.trim() });
      }
      if (attempts.length === 0) continue;
      results.push({
        paper,
        score: attempts[attempts.length - 1].score,
        maxMarks: attempts[attempts.length - 1].maxMarks,
        date: attempts[attempts.length - 1].date,
        attempts
      });
    }

    return { subject, year, series, gradeBoundary: boundary, gradeBoundaries, notes, examBoard, qualification, results };
  }

  function flash(text, ok) {
    el.formMsg.textContent = text;
    el.formMsg.className = "tracker-form-msg " + (ok ? "ok" : "err");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.formMsg.textContent = ""; }, 3000);
  }

  async function save() {
    const data = await collectSitting();
    if (!data) return;
    const now = nowISO();
    if (editingId) {
      const existing = papers.find((p) => p.id === editingId);
      await persist({
        ...existing,
        ...data,
        id: editingId,
        createdAt: existing ? existing.createdAt : now
      });
      flash("Saved.", true);
    } else {
      await persist({ ...data, id: `paper-${crypto.randomUUID()}`, createdAt: now });
      flash("Added.", true);
    }
    await ensureSubjectMeta(data.subject, {
      examBoard: data.examBoard || "",
      qualification: data.qualification || qualFor(data.subject)
    });
    closeModal();
    renderPapers();
    if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
  }

  // ---- stats ----
  function bestAttemptScore(result) {
    const list = (result.attempts && result.attempts.length ? result.attempts : [result]);
    return list.map((a) => ({ score: numberEq(a.score), max: numberEq(a.maxMarks) }))
      .filter((a) => a.score !== null && a.max !== null && a.max > 0)
      .reduce((best, a) => (best === null || pct(a.score, a.max) > pct(best.score, best.max) ? a : best), null);
  }

  function renderStats() {
    const bySubject = {};
    for (const p of papers) {
      (bySubject[p.subject || "Unassigned"] = bySubject[p.subject || "Unassigned"] || []).push(p);
    }
    el.statsGrid.innerHTML = "";
    const names = Object.keys(bySubject).sort();
    if (names.length === 0) {
      el.statsGrid.innerHTML = '<div class="tracker-empty">No data yet. Add some sittings.</div>';
      return;
    }
    const cacheSrc = loadBoundaryCache();
    for (const subject of names) {
      const set = bySubject[subject];
      const bests = [];
      const gradeCounts = {};
      let projCount = 0, realCount = 0;
      for (const s of set) {
        const gb = effectiveTable(s, cacheSrc);
        const hasT = !!(gb && Array.isArray(gb.gradesInOrder) && gb.gradesInOrder.length && gb.grades && typeof gb.grades === "object");
        for (const r of s.results || []) {
          const b = bestAttemptScore(r);
          if (!b) bests.push(null);
          else bests.push(b);
        }
        if (hasT) {
          const sg = subjectGrade(s, gb);
          if (sg) {
            if (sg.real) { gradeCounts[sg.grade] = (gradeCounts[sg.grade] || 0) + 1; realCount++; }
            else { gradeCounts[sg.grade] = (gradeCounts[sg.grade] || 0) + 1; projCount++; }
          }
        }
      }
      const seen = bests.filter((b) => b !== null);
      const avg = seen.length ? Math.round(seen.reduce((m, b) => m + pct(b.score, b.max), 0) / seen.length) : null;
      const max = seen.length ? Math.max(...seen.map((b) => pct(b.score, b.max))) : null;
      const min = seen.length ? Math.min(...seen.map((b) => pct(b.score, b.max))) : null;

      const dist = Object.keys(gradeCounts).sort().map((g) => `${g}\u00d7${gradeCounts[g]}`).join(" ");
      const projNote = projCount ? ` <em style="color:var(--text-muted);font-size:0.72rem;">includes ${projCount} projected</em>` : "";

      const card = document.createElement("div");
      card.className = "tracker-stat-card";
      card.innerHTML =
        `<h4>${escapeHtml(subject)} <span class="count" style="font-size:0.75rem;color:var(--text-muted);">${set.length} sitting${set.length===1?"":"s"}</span></h4>` +
        `<div class="stat">${avg !== null ? avg + "%" : "&ndash;"}</div>` +
        `<div class="stat-sub">average (best per paper)</div>` +
        (max !== null
          ? `<div class="tracker-bar"><div style="width:${Math.max(4, max)}%"></div></div>` +
            `<div class="tracker-trend">best ${max}% &middot; lowest ${min}%</div>`
          : "") +
        (dist ? `<div class="tracker-trend" style="margin-top:4px;">grades <b>${escapeHtml(dist)}</b>${projNote}</div>` : "");
      el.statsGrid.appendChild(card);
    }
  }

  // ---- export / import ----
  function exportData() {
    const data = {
      type: "neuronet-pastpapers",
      version: 3,
      exportedAt: nowISO(),
      subjects: subjectNodes.map((n) => ({
        name: n.name || n.subject,
        examBoard: n.examBoard || "",
        qualification: n.qualification || "",
        customized: n.customized || false,
        officialCourse: n.officialCourse ?? null,
        createdAt: n.createdAt, updatedAt: n.updatedAt
      })),
      sittings: papers.map((p) => ({
        subject: p.subject,
        year: p.year,
        series: p.series,
        label: p.label || null,
        gradeBoundary: p.gradeBoundary,
        gradeBoundaries: p.gradeBoundaries || null,
        examBoard: p.examBoard,
        notes: p.notes,
        results: p.results,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "past-papers-tracker.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importDataFile(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { flash("Invalid JSON file.", false); return; }
    if (data.type && data.type !== "neuronet-pastpapers") { flash("Unrecognised export (wrong type).", false); return; }

    // Legacy flat export (the old tracker's downloaded rows): array of rows with
    // paper1/paper2/paper3 slots. Transform via the shared importer.
    if (Array.isArray(data) && data.length && "paper1" in data[0]) {
      const { subjects, sittings } = transformRows(data);
      if (sittings.length === 0) { flash("No sittings found in file.", false); return; }
      const existingKeys = new Set(papers.map((p) => p.subject + "|" + p.year + "|" + p.series + "|" + p.gradeBoundary));
      const toAdd = sittings.filter((p) => !existingKeys.has(p.subject + "|" + p.year + "|" + p.series + "|" + p.gradeBoundary));
      if (toAdd.length === 0) { flash("Nothing new to import (all sittings already exist).", false); return; }
      await persistMany(toAdd);
      for (const s of subjects) {
        if (!(await subjectNodeExists(s.name))) await addNode(s);
      }
      await loadSubjects();
      await ensureQualifications();
      flash(`Imported ${toAdd.length} sitting${toAdd.length === 1 ? "" : "s"} across ${subjects.length} subjects. Set each subject's exam board once.`, true);
      renderPapers();
      if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
      return;
    }

    let imported = [];
    if (Array.isArray(data)) {
      // v1-style export: array of papers
      imported = data;
    } else if (Array.isArray(data.sittings)) {
      imported = data.sittings;
    } else {
      flash("Unrecognised export format.", false);
      return;
    }

    const valid = imported.filter((p) => p && p.subject);
    if (valid.length === 0) { flash("No sittings found in file.", false); return; }

    const existingKeys = new Set(papers.map((p) => p.subject + "|" + p.year + "|" + p.series));
    const toAdd = valid.filter((p) => !existingKeys.has(p.subject + "|" + p.year + "|" + p.series));
    if (toAdd.length === 0) { flash("Nothing new to import (all sittings already exist).", false); return; }

    for (const p of toAdd) {
      p.id = `paper-${crypto.randomUUID()}`;
      if (!Array.isArray(p.results)) p.results = [];
    }
    await persistMany(toAdd);

    for (const p of toAdd) {
      if (p.examBoard) await setSubjectBoard(p.subject, p.examBoard);
    }

    // Ensure a subject node exists for every imported subject, applying any
    // board / qualification carried in the file.
    const subjectMeta = {};
    for (const s of (data.subjects || [])) {
      if (s && s.name) subjectMeta[s.name] = s;
    }
    for (const subject of new Set(toAdd.map((p) => p.subject).filter(Boolean))) {
      const meta = subjectMeta[subject] || {};
      if (!(await subjectNodeExists(subject))) {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: meta.examBoard || "",
          qualification: meta.qualification || "",
          customized: meta.customized || false,
          officialCourse: meta.officialCourse ?? null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      } else if (meta.examBoard || meta.qualification || meta.customized || meta.officialCourse) {
        await setSubjectMeta(subject, meta);
      }
    }

    await loadSubjects();
    await ensureQualifications();
    flash(`Imported ${toAdd.length} sitting${toAdd.length === 1 ? "" : "s"}.`, true);
    renderPapers();
    if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
  }

  async function setSubjectMeta(name, meta) {
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    if (!existing) {
      await addNode({
        type: "subject", subject: name, name: name,
        examBoard: meta.examBoard || "",
        qualification: meta.qualification || "",
        customized: meta.customized || false,
        officialCourse: meta.officialCourse ?? null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    } else {
      await addNode({
        ...existing,
        examBoard: meta.examBoard ?? existing.examBoard ?? "",
        qualification: meta.qualification ?? existing.qualification ?? "",
        customized: meta.customized ?? existing.customized ?? false,
        officialCourse: meta.officialCourse ?? existing.officialCourse ?? null,
        updatedAt: Date.now()
      });
    }
    await loadSubjects();
  }

  async function subjectNodeExists(name) {
    const nodes = (await getAllNodes()) || [];
    return nodes.some((n) => n.type === "subject" && (n.subject === name || n.name === name));
  }

  // ---- wire up ----
  function wire() {
    el.papersBtn.addEventListener("click", () => showView("papers"));
    el.statsBtn.addEventListener("click", () => showView("stats"));
    el.addBtn.addEventListener("click", () => openModal(null));
    el.dropBtn.addEventListener("click", () => setAllNotes(true));
    el.collapseBtn.addEventListener("click", () => setAllNotes(false));
    el.saveBtn.addEventListener("click", save);
    el.cancelBtn.addEventListener("click", () => closeModal());
    el.modalClose.addEventListener("click", () => closeModal());
    el.modalOverlay.addEventListener("click", () => closeModal());

    // ---- link-to-official-subject picker (persistent popover) ----
    el.linkArea.addEventListener("click", (e) => {
      const pill = e.target.closest(".tracker-link-pill");
      if (!pill) return;
      e.preventDefault();
      e.stopPropagation();
      if (pill.dataset.act === "suggest") {
        if (linkHint) applyOfficialCourse(focusedSubject, linkHint);
      } else {
        openLinkPicker(focusedSubject);
      }
    });
    el.linkFilter.addEventListener("input", () => renderCourseList());
    el.linkFilters.addEventListener("click", (e) => {
      const ch = e.target.closest(".tracker-chip");
      if (!ch) return;
      const f = ch.dataset.f || "";
      if (f === "") {
        chipTokens.clear();
        el.linkFilter.value = "";
      } else {
        const typed = normalizeSearch(el.linkFilter.value);
        const typedTokens = typed ? typed.split(/\s+/).filter(Boolean) : [];
        const inTyped = typedTokens.includes(f) || (f === "pearson" && typedTokens.some((t) => t.includes("edexcel")));
        if (chipTokens.has(f) || inTyped) {
          chipTokens.delete(f);
          const keep = typedTokens.filter((t) => t !== f && !(f === "pearson" && t.includes("edexcel")));
          el.linkFilter.value = keep.join(" ");
        } else {
          chipTokens.add(f);
        }
      }
      renderCourseList();
    });
    el.linkList.addEventListener("click", (e) => {
      const item = e.target.closest(".tracker-course-item");
      if (!item) return;
      const c = listCachedCourses(loadBoundaryCache()).find(
        (x) => x.board === item.dataset.board && x.qual === item.dataset.qual && x.code === item.dataset.code && normalizeTitle(x.title) === normalizeTitle(item.dataset.title)
      );
      if (c) applyOfficialCourse(focusedSubject, c);
    });
    el.unlinkBtn.addEventListener("click", () => unlinkOfficialCourse(focusedSubject));
    el.addSlotBtn.addEventListener("click", () => addSlotRow(null));
    el.exportBtn.addEventListener("click", exportData);
    el.importBtn.addEventListener("click", () => el.importFile.click());

    // ---- table customise popover (persistent element, bound once) ----
    el.colsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeLinkPicker();
      if (el.colsPop.hidden) {
        renderBoundaryChips();
        renderColList();
        el.colsPop.hidden = false;
      } else {
        el.colsPop.hidden = true;
      }
    });
    el.colsPop.addEventListener("click", (e) => {
      // Stop the click from reaching the document-level outside-click handler,
      // which uses e.target.closest(".tracker-cus-wrap") to decide whether to
      // close. Toggling a chip re-renders the chip list (toggleAim ->
      // renderPapers -> renderBoundaryChips), detaching the clicked node BEFORE
      // the event finishes bubbling, so closest() returns null and the popover
      // gets wrongly closed on every grade pick. Clicking inside the popover
      // must never close it.
      e.stopPropagation();
      const chip = e.target.closest(".tracker-grade-chip");
      if (chip) {
        toggleAim(focusedSubject, chip.dataset.g);
        renderBoundaryChips();
        return;
      }
      const colBtn = e.target.closest(".tracker-col-toggle");
      if (colBtn) {
        cols = loadCols();
        cols[colBtn.dataset.col] = !cols[colBtn.dataset.col];
        saveCols();
        renderColList();
        renderPapers();
      }
    });
    el.cusReset.addEventListener("click", () => {
      cols = { ...COL_DEFAULTS };
      saveCols();
      aimGrades = {};
      saveAimGrades();
      renderColList();
      renderBoundaryChips();
      renderPapers();
    });
    document.addEventListener("click", (e) => {
      if (el.colsPop && !el.colsPop.hidden && !e.target.closest(".tracker-cus-wrap")) el.colsPop.hidden = true;
      if (el.linkPop && !el.linkPop.hidden && !e.target.closest(".tracker-link-area")) el.linkPop.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (el.colsPop) el.colsPop.hidden = true;
      if (el.linkPop) el.linkPop.hidden = true;
    });
    el.importFile.addEventListener("change", async () => {
      if (el.importFile.files[0]) await importDataFile(el.importFile.files[0]);
      el.importFile.value = "";
    });

    // ---- join the ONE shared grade-boundaries fetch model ----
    // The customise popover bails out with "fetching… wait" if the shared sweep
    // (this page's picker, the auto-warm, or a fetch running in the scraper tab
    // in another browser tab) is mid-flight, and both modals re-render live as
    // series land in the cache. Throttled so a long sweep doesn't repaint the
    // whole table per job.
    let bsPending = false;
    let bsTimer = null;
    subscribeBoundaryStatus(() => {
      if (bsPending) return;
      bsPending = true;
      bsTimer = setTimeout(() => {
        bsPending = false;
        renderBoundaryChips();
        if (el.linkPop && !el.linkPop.hidden) linkScratch(sweepMessage(getBoundaryStatus()));
      }, 150);
    });
    let bcPending = false;
    let bcTimer = null;
    subscribeBoundaryCacheChanged(() => {
      if (bcPending) return;
      bcPending = true;
      bcTimer = setTimeout(() => {
        bcPending = false;
        renderCourseList();
        renderPapers();
      }, 150);
    });
  }

  // ---- init ----
  async function init() {
    wire();
    await loadPapers();
    await loadSubjects();
    await ensureQualifications();
    renderPapers();
    // Targeted auto-warm for the rows' own series. Single-flight, decoupled
    // from the render path (see runWarmFlight), so it can neither re-enter a
    // render nor loop. This is the ONLY background fetcher the tracker runs:
    // the full board-wide sweep is triggered on demand by the link picker
    // (seedLinkCourses), never from init. Firing it here stormed the whole
    // AQA history (proxy + CORS fallback per series) plus OCR/Pearson PDF
    // parses on every scope, janking the main thread for a minute+.
    scheduleWarm();
  }

  if (typeof context.onload === "function") {
    context.onload(init());
  } else {
    init();
  }

  return { load: init, reload: () => init() };
}
