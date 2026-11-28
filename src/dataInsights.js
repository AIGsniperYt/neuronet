import {
  getActivityEvents,
  pruneActivityEvents,
  getSyncState,
  getSyncOverview,
  getAllNodes,
  getAllQuotes,
  getAllCues,
  getAllCards,
  getAllHeaps,
  getAllDecks,
  getAllSubjects,
  getAllTasks,
  getAllCommitments,
  getAllJournals,
  getAllTags,
  getPinnedTools
} from "./db.js";

const METRICS = Object.freeze([
  ["cardsCreated", "card-created"],
  ["cardsRevised", "card-revised"],
  ["cardsReviewed", "card-reviewed"],
  ["tasksCompleted", "task-completed"]
]);

let lastActivityPruneCheckAt = 0;

async function pruneActivityIfDue() {
  const now = Date.now();
  // Dashboard refreshes can be frequent. The database also enforces its own
  // once-per-day retention marker; this throttle avoids opening a write
  // transaction on every render in the same tab.
  if (lastActivityPruneCheckAt > 0 && now - lastActivityPruneCheckAt < 60_000) return;
  lastActivityPruneCheckAt = now;
  try {
    await pruneActivityEvents();
  } catch (error) {
    lastActivityPruneCheckAt = 0;
    throw error;
  }
}

export function localDayKey(value = Date.now()) {
  const date = new Date(Number(value) || Date.now());
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function emptyCounts(day) {
  return {
    day,
    cardsCreated: 0,
    cardsRevised: 0,
    cardsReviewed: 0,
    tasksCompleted: 0
  };
}

function addEvent(counts, event) {
  const metric = METRICS.find(([, kind]) => kind === event.kind)?.[0];
  if (metric) counts[metric] += 1;
}

function estimateBytes(records) {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const record of records || []) {
    try { bytes += encoder.encode(JSON.stringify(record)).byteLength; }
    catch { /* an unserialisable row contributes no estimate */ }
  }
  return bytes;
}

export async function getActivitySummarySince(timestamp) {
  await pruneActivityIfDue();
  const since = Number(timestamp) || Date.now();
  const events = await getActivityEvents({ sinceDay: localDayKey(since) });
  const summary = emptyCounts("session");
  for (const event of events) {
    if (Number(event.occurredAt || 0) >= since) addEvent(summary, event);
  }
  return summary;
}

/**
 * Shared local read model for Launchpad progress and the future Data
 * Observatory. Activity events contain IDs and action metadata only; this
 * function never exposes card text, task titles or journal content.
 */
export async function getDataInsights({ days = 7, now = Date.now(), includeInventory = false } = {}) {
  await pruneActivityIfDue();
  const dayCount = Math.max(1, Math.min(90, Math.floor(Number(days) || 7)));
  const today = localDayKey(now);
  const todayDate = new Date(Number(now) || Date.now());
  const startDate = new Date(
    todayDate.getFullYear(),
    todayDate.getMonth(),
    todayDate.getDate() - dayCount + 1
  );
  const startDay = localDayKey(startDate.getTime());

  const [activityRows, trackingStartedAt, sync, collectionRows] = await Promise.all([
    getActivityEvents(includeInventory ? {} : { sinceDay: startDay }),
    getSyncState("activityTrackingStartedAt"),
    getSyncOverview(),
    includeInventory
      ? Promise.all([
          getAllNodes(),
          getAllQuotes(),
          getAllCues(),
          getAllCards(),
          getAllHeaps(),
          getAllDecks(),
          getAllSubjects(),
          getAllTasks(),
          getAllCommitments(),
          getAllJournals(),
          getAllTags(),
          getPinnedTools()
        ])
      : Promise.resolve([])
  ]);
  const [
    nodes = [],
    quotes = [],
    cues = [],
    cards = [],
    heaps = [],
    decks = [],
    subjects = [],
    tasks = [],
    commitments = [],
    journals = [],
    tags = [],
    pinnedTools = []
  ] = collectionRows;
  const events = activityRows.filter((event) => String(event.day) >= startDay);

  const daily = [];
  const byDay = new Map();
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + offset
    );
    const day = localDayKey(date.getTime());
    const counts = emptyCounts(day);
    daily.push(counts);
    byDay.set(day, counts);
  }

  for (const event of events) {
    const counts = byDay.get(String(event.day));
    if (counts) addEvent(counts, event);
  }

  const totals = emptyCounts("period");
  for (const day of daily) {
    for (const [metric] of METRICS) totals[metric] += day[metric];
  }
  const todayCounts = byDay.get(today) || emptyCounts(today);

  const collections = {
    nodes,
    quotes,
    cues,
    cards,
    heaps,
    decks,
    subjects,
    tasks,
    commitments,
    journals,
    tags,
    pinnedTools
  };
  const inventory = {};
  let totalRecords = 0;
  let estimatedPayloadBytes = 0;
  for (const [name, records] of Object.entries(collections)) {
    const count = records.length;
    const bytes = estimateBytes(records);
    inventory[name] = { count, estimatedPayloadBytes: bytes };
    totalRecords += count;
    estimatedPayloadBytes += bytes;
  }

  return {
    generatedAt: Number(now) || Date.now(),
    scope: "this-device",
    today: todayCounts,
    daily,
    totals,
    inventory,
    totalRecords,
    estimatedPayloadBytes,
    activityEventsRetained: includeInventory ? activityRows.length : undefined,
    activityHistoryStartDay: includeInventory ? (activityRows[0]?.day || null) : undefined,
    recentActivityEvents: includeInventory ? activityRows.slice(-12).reverse() : undefined,
    activityTrackingStarted: Number(trackingStartedAt) > 0,
    trackingStartedAt: Number(trackingStartedAt) || 0,
    sync
  };
}
