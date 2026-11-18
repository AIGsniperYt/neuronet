// Pure helpers for the Journal tool.
//
// STUB: this MVP stores entries in IndexedDB via the journal store in db.js.
// The intended long-term home for personal journals is a user-owned file system
// on the PC (see todo: "upgrade our current main provider for data storage being
// indexed db and moving it to pc"). These helpers and the UI are deliberately
// kept storage-agnostic so that migration can replace the persistence layer
// without rewriting the reflective experience.

export const JOURNAL_PROMPTS = [
  "What thought kept returning to you today?",
  "What did you avoid, and what might that be protecting?",
  "When did you feel most like yourself recently?",
  "What assumption did you quietly challenge?",
  "What drained you more than it should have?",
  "What would you tell yourself a month ago?",
  "What are you pretending not to notice?",
  "Where did you choose comfort over growth?",
  "What felt small but stayed with you?",
  "What would 'better' look like in one specific way?"
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function nowMs() {
  return Date.now();
}

export function createJournalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `journal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(Number(value) || nowMs());
  if (Number.isNaN(date.getTime())) return toDateKey(nowMs());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeJournalEntry(entry = {}, now = nowMs()) {
  const createdAt = Number(entry.createdAt) || now;
  const updatedAt = Number(entry.updatedAt) || createdAt;
  const title = String(entry.title || "").trim();
  const body = typeof entry.body === "string" ? entry.body : String(entry.content || entry.text || "");
  const id = String(entry.id || "").trim() || createJournalId();
  return {
    id,
    type: "journal",
    title,
    body,
    insight: entry.insight === true,
    createdAt,
    updatedAt: Math.max(updatedAt, createdAt),
    dateKey: toDateKey(createdAt)
  };
}

export function touchJournalEntry(entry, patch = {}, now = nowMs()) {
  const base = normalizeJournalEntry(entry, now);
  const next = {
    ...base,
    ...patch,
    id: base.id,
    type: "journal",
    createdAt: base.createdAt,
    dateKey: base.dateKey
  };
  if (patch.title !== undefined) next.title = String(patch.title || "").trim();
  if (patch.body !== undefined) next.body = typeof patch.body === "string" ? patch.body : String(patch.body || "");
  if (patch.insight !== undefined) next.insight = patch.insight === true;
  next.updatedAt = Number(patch.updatedAt) || now;
  return normalizeJournalEntry(next, now);
}

export function createJournalEntry(patch = {}, now = nowMs()) {
  const createdAt = Number(patch.createdAt) || now;
  return normalizeJournalEntry({
    id: createJournalId(),
    title: "",
    body: "",
    insight: false,
    ...patch,
    createdAt,
    updatedAt: Number(patch.updatedAt) || createdAt,
    dateKey: toDateKey(createdAt)
  }, now);
}

export function sortJournals(entries = []) {
  return [...entries].sort((a, b) => {
    const delta = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    if (delta !== 0) return delta;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

export function journalWordCount(entry) {
  const text = `${entry?.title || ""}\n${entry?.body || ""}`
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[>#*_~\-]+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function journalSnippet(entry, max = 120) {
  const source = String(entry?.body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "No words yet.";
  if (source.length <= max) return source;
  return `${source.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function journalDisplayTitle(entry) {
  const title = String(entry?.title || "").trim();
  if (title) return title;
  const snippet = journalSnippet(entry, 48);
  return snippet && snippet !== "No words yet." ? snippet : "Untitled reflection";
}

export function matchesJournalSearch(entry, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const title = String((entry && entry.title) || "");
  const body = String((entry && entry.body) || "");
  const haystack = (title + "\n" + body).toLowerCase();
  return haystack.includes(needle);
}

export function filterJournals(entries = [], { query = "", insightOnly = false } = {}) {
  return sortJournals(entries).filter((entry) => {
    if (insightOnly && entry.insight !== true) return false;
    return matchesJournalSearch(entry, query);
  });
}

function sameLocalDay(a, b) {
  return toDateKey(a) === toDateKey(b);
}

export function formatJournalDayLabel(dateKey, todayKey = toDateKey(nowMs())) {
  if (!dateKey) return "Unknown day";
  if (dateKey === todayKey) return "Today";
  const yesterday = toDateKey(new Date(new Date(`${todayKey}T12:00:00`).getTime() - DAY_MS));
  if (dateKey === yesterday) return "Yesterday";
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatJournalMonthLabel(dateKey) {
  const date = new Date(`${String(dateKey || "").slice(0, 7)}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Earlier";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatJournalTime(value) {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime()) || !Number(value)) return "";
  if (sameLocalDay(date, new Date())) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function groupJournalsByMonth(entries = []) {
  const groups = [];
  const byMonth = new Map();
  for (const entry of sortJournals(entries)) {
    const monthKey = String(entry.dateKey || "").slice(0, 7) || "unknown";
    if (!byMonth.has(monthKey)) {
      const group = { monthKey, label: formatJournalMonthLabel(entry.dateKey), entries: [] };
      byMonth.set(monthKey, group);
      groups.push(group);
    }
    byMonth.get(monthKey).entries.push(entry);
  }
  return groups;
}

export function pickJournalPrompt(seed = nowMs()) {
  const index = Math.abs(Number(seed) || 0) % JOURNAL_PROMPTS.length;
  return JOURNAL_PROMPTS[index];
}
