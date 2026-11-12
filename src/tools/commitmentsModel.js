// Pure recurring-commitment helpers.
//
// A commitment is a rule plus a per-date completion map. There are no
// generated occurrence records: today's instance is always derived from the
// rule, so missing days stay missing instead of becoming overdue tasks.
import { formatDueLabel, toDateKey } from "./tasksModel.js";

// Storage order is JS getDay() order (0 = Sunday). UI order is Monday first.
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function dateFromKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(dateKey, days) {
  const date = dateFromKey(dateKey);
  if (!date) return "";
  date.setDate(date.getDate() + (Number(days) || 0));
  return toDateKey(date);
}

export function weekdayOf(dateKey) {
  const date = dateFromKey(dateKey);
  return date ? date.getDay() : -1;
}

// Monday-based week start. The returned key is always a local date.
export function startOfWeek(dateKey) {
  const day = weekdayOf(dateKey);
  if (day < 0) return "";
  return addDays(dateKey, -((day + 6) % 7));
}

function recurrenceOf(commitment) {
  return commitment?.recurrence || {};
}

export function occursOn(commitment, dateKey) {
  if (!commitment || commitment.archivedAt || !isDateKey(dateKey)) return false;
  const recurrence = recurrenceOf(commitment);
  const start = String(recurrence.startDate || "");
  const end = String(recurrence.endDate || "");
  if (start && dateKey < start) return false;
  if (end && dateKey > end) return false;

  if (recurrence.frequency === "daily") return true;
  if (recurrence.frequency !== "weekly") return false;

  const days = Array.isArray(recurrence.weekdays)
    ? recurrence.weekdays.map(Number)
    : [];
  return days.includes(weekdayOf(dateKey));
}

export function occurrenceStatus(commitment, dateKey) {
  if (!occursOn(commitment, dateKey)) return "none";
  const entry = commitment?.completions?.[dateKey];
  if (entry?.skipped) return "skipped";
  if (Number(entry?.completedAt) > 0) return "done";
  return "due";
}

export function completeOccurrence(commitment, dateKey, { at = Date.now(), via = "manual" } = {}) {
  const timestamp = Number(at) || Date.now();
  return {
    ...commitment,
    completions: {
      ...(commitment?.completions || {}),
      [dateKey]: {
        completedAt: timestamp,
        via: via === "memory" ? "memory" : "manual"
      }
    },
    updatedAt: timestamp
  };
}

export function skipOccurrence(commitment, dateKey, { at = Date.now() } = {}) {
  const timestamp = Number(at) || Date.now();
  return {
    ...commitment,
    completions: {
      ...(commitment?.completions || {}),
      [dateKey]: { skipped: true, at: timestamp }
    },
    updatedAt: timestamp
  };
}

export function undoOccurrence(commitment, dateKey) {
  const completions = { ...(commitment?.completions || {}) };
  delete completions[dateKey];
  return { ...commitment, completions, updatedAt: Date.now() };
}

export function nextOccurrenceDate(
  commitment,
  fromDateKey = toDateKey(),
  { skipCompleted = true, maxDays = 730 } = {}
) {
  if (!commitment || commitment.archivedAt) return "";
  const start = String(recurrenceOf(commitment).startDate || "");
  const end = String(recurrenceOf(commitment).endDate || "");
  let date = isDateKey(fromDateKey) ? fromDateKey : toDateKey();
  if (start && date < start) date = start;
  if (!date) return "";

  for (let i = 0; i <= maxDays; i += 1) {
    if (end && date > end) return "";
    if (occursOn(commitment, date)) {
      const status = occurrenceStatus(commitment, date);
      if (!skipCompleted || status === "due") return date;
    }
    date = addDays(date, 1);
    if (!date) return "";
  }
  return "";
}

export function compareCommitments(a, b) {
  return String(a?.subject || "").localeCompare(String(b?.subject || ""), undefined, { sensitivity: "base" })
    || String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" });
}

export function commitmentsDueOn(commitments = [], dateKey = toDateKey()) {
  return (commitments || [])
    .filter((commitment) => occursOn(commitment, dateKey))
    .slice()
    .sort(compareCommitments);
}

export function countDueCommitments(commitments = [], dateKey = toDateKey()) {
  return (commitments || []).filter((commitment) => occurrenceStatus(commitment, dateKey) === "due").length;
}

export function isCommitmentActive(commitment, todayKey = toDateKey()) {
  if (!commitment || commitment.archivedAt) return false;
  const end = String(recurrenceOf(commitment).endDate || "");
  return !end || end >= todayKey;
}

export function activeCommitments(commitments = [], todayKey = toDateKey()) {
  return (commitments || []).filter((commitment) => isCommitmentActive(commitment, todayKey));
}

function orderedWeekdays(recurrence) {
  const days = [...new Set(
    (Array.isArray(recurrence?.weekdays) ? recurrence.weekdays : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )];
  return days.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
}

export function formatCadence(recurrence) {
  if (recurrence?.frequency === "daily") return "Every day";
  if (recurrence?.frequency !== "weekly") return "No schedule";
  const days = orderedWeekdays(recurrence);
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No days set";
  if (days.length === 1) return `Every ${WEEKDAY_LABELS[days[0]]}`;
  return days.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

export function nextOccurrenceLabel(commitment, todayKey = toDateKey()) {
  if (!commitment || commitment.archivedAt) return "Paused";
  const next = nextOccurrenceDate(commitment, todayKey);
  if (next) return formatDueLabel(next, todayKey);
  const end = String(recurrenceOf(commitment).endDate || "");
  if (end && end < todayKey) return "Ended";
  return "No upcoming dates";
}

function summarizeWindow(commitment, startDate, endDate, todayKey) {
  let scheduled = 0;
  let expectedSoFar = 0;
  let expectedPast = 0;
  let completed = 0;
  let completedPast = 0;
  let skipped = 0;
  let skippedPast = 0;
  let missed = 0;

  for (let date = startDate; date && date <= endDate; date = addDays(date, 1)) {
    if (!occursOn(commitment, date)) continue;
    scheduled += 1;
    const status = occurrenceStatus(commitment, date);
    if (status === "done") completed += 1;
    else if (status === "skipped") skipped += 1;

    if (date <= todayKey) expectedSoFar += 1;
    if (date < todayKey) {
      expectedPast += 1;
      if (status === "done") completedPast += 1;
      if (status === "skipped") skippedPast += 1;
      if (status === "due") missed += 1;
    }
  }

  return {
    scheduled,
    expectedSoFar,
    expectedPast,
    completed,
    completedPast,
    skipped,
    skippedPast,
    missed,
    adherence: expectedPast ? completedPast / expectedPast : 0
  };
}

// Current Monday-to-Sunday view, useful for "2 of 3 this week".
export function summarizeWeek(commitment, todayKey = toDateKey()) {
  const startDate = startOfWeek(todayKey);
  if (!startDate) {
    return {
      startDate: "", endDate: "", ...summarizeWindow(commitment, "", "", todayKey)
    };
  }
  const endDate = addDays(startDate, 6);
  return { startDate, endDate, ...summarizeWindow(commitment, startDate, endDate, todayKey) };
}

// Rolling adherence window, excluding today's still-open occurrence from the
// denominator so an unfinished today never reads as a miss.
export function summarizeCommitment(commitment, { todayKey = toDateKey(), windowDays = 28 } = {}) {
  const days = Math.min(Math.max(1, Number(windowDays) || 28), 3650);
  const startDate = addDays(todayKey, -(days - 1));
  const summary = summarizeWindow(commitment, startDate, todayKey, todayKey);

  let lastCompletedDate = "";
  for (const [date, entry] of Object.entries(commitment?.completions || {})) {
    if (Number(entry?.completedAt) > 0 && isDateKey(date) && date > lastCompletedDate) {
      lastCompletedDate = date;
    }
  }

  return {
    windowDays: days,
    startDate,
    endDate: todayKey,
    ...summary,
    lastCompletedDate
  };
}
