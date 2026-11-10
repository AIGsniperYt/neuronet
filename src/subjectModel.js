export function collapseWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function parseSubjectName(raw) {
  const text = collapseWhitespace(raw);
  const match = text.match(/\(([^()]+)\)\s*$/);
  if (match && text.slice(0, match.index).trim()) {
    return { name: text.slice(0, match.index).trim(), level: match[1].trim() };
  }
  return { name: text, level: "" };
}

export function subjectKey(name, level) {
  const cleanName = collapseWhitespace(name);
  const cleanLevel = collapseWhitespace(level);
  return cleanLevel ? `${cleanName} (${cleanLevel})` : cleanName;
}

export function createSubjectRecord({ key, name, level = "", order = 0, id } = {}) {
  const parsed = name == null ? parseSubjectName(key) : { name: collapseWhitespace(name), level: collapseWhitespace(level) };
  const cleanKey = collapseWhitespace(key) || subjectKey(parsed.name, parsed.level);
  return { id: id || `subj_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`, name: parsed.name, level: parsed.level, key: cleanKey, order: Number.isFinite(Number(order)) ? Number(order) : 0, createdAt: 0, updatedAt: 0 };
}

export function subjectDisplay(record) {
  return { name: record?.name || "", level: record?.level || "General" };
}

// Qualification vocabulary used by the exam-data layer. Levels are free text,
// so this is deliberately tolerant: "A Level", "A-Level" and "Alevel" all map
// to the same qualification. An empty/unknown level stays empty rather than
// silently becoming GCSE.
export function qualificationForLevel(level) {
  const text = collapseWhitespace(level).toLowerCase();
  if (!text) return "";
  if (text.includes("gcse")) return "gcse";
  if (/\ba[\s-]?level\b/.test(text)) return "aLevel";
  if (/^as(\b|$)/.test(text) || /^a\/s\b/.test(text)) return "as";
  return "";
}

export function normalizeQualificationId(qual) {
  const text = collapseWhitespace(qual).toLowerCase();
  if (!text) return "";
  if (text.includes("gcse")) return "gcse";
  if (text.includes("a level") || text.includes("a-level") || text === "alevel") return "aLevel";
  if (text === "as" || text === "a/s" || text === "as level" || text === "as-level") return "as";
  return "";
}

export function qualificationLabel(qual) {
  return { gcse: "GCSE", aLevel: "A-Level", as: "AS" }[normalizeQualificationId(qual)] || "";
}

// A level and an official course qualification conflict only when BOTH are
// known and they name different qualifications. Unknown/blank data never
// creates a false mismatch.
export function levelsConflict(level, qual) {
  const wanted = qualificationForLevel(level);
  const offered = normalizeQualificationId(qual);
  return !!wanted && !!offered && wanted !== offered;
}

export function subjectOptionLabel(record) {
  const name = collapseWhitespace(record?.name);
  const level = collapseWhitespace(record?.level);
  return level ? `${name} \u00b7 ${level}` : name;
}

const groupOrder = (level) => level ? collapseWhitespace(level).toLocaleLowerCase() : "\uffff";
export function compareSubjectRecords(a, b) {
  return groupOrder(a?.level).localeCompare(groupOrder(b?.level)) || (Number(a?.order) || 0) - (Number(b?.order) || 0) || String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
}

export function groupSubjectRecords(records = []) {
  const groups = new Map();
  for (const record of [...records].sort(compareSubjectRecords)) {
    const level = collapseWhitespace(record.level);
    if (!groups.has(level)) groups.set(level, { level, label: level || "General", subjects: [] });
    groups.get(level).subjects.push(record);
  }
  return [...groups.values()];
}

export function subjectKeyMatches(a, b) {
  return collapseWhitespace(a).toLocaleLowerCase() === collapseWhitespace(b).toLocaleLowerCase();
}

export function migrateSubjectIdentity({ nodes = [], quotes = [], cues = [], cards = [], decks = [] } = {}) {
  const collections = { nodes: nodes || [], quotes: quotes || [], cues: cues || [], cards: cards || [], decks: decks || [] };
  const keys = [];
  const add = (raw) => { const key = collapseWhitespace(raw); if (key && !keys.some((known) => subjectKeyMatches(known, key))) keys.push(key); };
  for (const n of collections.nodes) { add(n.subject); if (!n.subject) { add(n.meta?.hierarchyPath?.[0]); if (n.type === "subject") add(n.name || n.title); } }
  for (const q of collections.quotes) { add(q.subject); if (!q.subject) add(q.meta?.hierarchyPath?.[0]); }
  for (const c of collections.cues) { add(c.subject); if (!c.subject) add(c.meta?.hierarchyPath?.[0]); }
  for (const d of collections.decks) { add(d.subject); if (!d.subject) add(d.deckPath?.[0]); }
  for (const c of collections.cards) { add(c.deck); if (!c.deck) add(c.deckPath?.[0]); }
  keys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const subjects = keys.map((key, order) => createSubjectRecord({ key, order }));
  const byKey = new Map(subjects.map((record) => [record.key.toLocaleLowerCase(), record.id]));
  const stamp = (record, owner, fallback) => {
    const key = collapseWhitespace(owner) || collapseWhitespace(fallback);
    const id = byKey.get(key.toLocaleLowerCase());
    return id ? { ...record, subjectId: id } : { ...record };
  };
  return {
    subjects,
    nodes: collections.nodes.map((r) => stamp(r, r.subject, r.meta?.hierarchyPath?.[0] || (r.type === "subject" ? r.name || r.title : ""))),
    quotes: collections.quotes.map((r) => stamp(r, r.subject, r.meta?.hierarchyPath?.[0])),
    cues: collections.cues.map((r) => stamp(r, r.subject, r.meta?.hierarchyPath?.[0])),
    cards: collections.cards.map((r) => stamp(r, r.deck, r.deckPath?.[0])),
    decks: collections.decks.map((r) => stamp(r, r.subject, r.deckPath?.[0]))
  };
}
