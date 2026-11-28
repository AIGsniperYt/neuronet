import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

globalThis.window = {
  DEMO_MODE: true,
  APP_VERSION: "data-insights-tests"
};
globalThis.document = {
  dispatchEvent() {}
};

const db = await import("../src/db.js");
const { getDataInsights, getActivitySummarySince, localDayKey } = await import("../src/dataInsights.js");

async function insertOldActivityEvent(event) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("neuronet-data-insights-tests");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(["activityEvents", "syncState"], "readwrite");
      tx.objectStore("activityEvents").put(event);
      tx.objectStore("syncState").put({
        key: "activityLastPrunedAt",
        value: 0,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => {
        database.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        database.close();
        reject(tx.error);
      };
    };
  });
}

test("activity events distinguish card content changes, SRS reviews and task completion", async () => {
  await db.initDB();

  const card = {
    id: "insight-card-1",
    front: "Question",
    back: "Answer",
    tags: ["biology"],
    meta: { repetitions: 0, nextReview: 0 }
  };
  await db.addCard(card);

  // Routine SRS metadata changes must not count as content revisions.
  await db.addCard({
    ...card,
    meta: { repetitions: 1, nextReview: Date.now() + 86400000 }
  });

  // A real content change is one revised card for this local day.
  const revised = {
    ...card,
    front: "Rewritten question",
    meta: { repetitions: 1, nextReview: Date.now() + 86400000 }
  };
  await db.addCard(revised);

  // Review attempts are separate events, even when they concern one card.
  await db.addCard({
    ...revised,
    meta: { repetitions: 2, nextReview: Date.now() + 172800000 }
  }, { activity: "review" });
  await db.addCard({
    ...revised,
    meta: { repetitions: 3, nextReview: Date.now() + 259200000 }
  }, { activity: "review" });

  await db.addCards([{
    id: "insight-card-2",
    front: "Bulk question",
    back: "Bulk answer",
    tags: []
  }]);

  await db.addTask({
    id: "insight-task-1",
    title: "Finish homework",
    done: false
  });
  await db.addTask({
    id: "insight-task-1",
    title: "Finish homework",
    done: true
  });
  // Saving an already-completed task again must not double-count it.
  await db.addTask({
    id: "insight-task-1",
    title: "Finish homework",
    done: true
  });

  const events = await db.getActivityEvents();
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  const todayEvents = events.filter((event) => event.day === todayKey);

  assert.equal(todayEvents.filter((event) => event.kind === "card-created").length, 2);
  assert.equal(todayEvents.filter((event) => event.kind === "card-revised").length, 1);
  assert.equal(todayEvents.filter((event) => event.kind === "card-reviewed").length, 2);
  assert.equal(todayEvents.filter((event) => event.kind === "task-completed").length, 1);

  // Activity records contain identifiers and event metadata only, never the
  // user's actual learning material or task title.
  const serialisedEvents = JSON.stringify(events);
  assert.equal(serialisedEvents.includes("Rewritten question"), false);
  assert.equal(serialisedEvents.includes("Bulk answer"), false);
  assert.equal(serialisedEvents.includes("Finish homework"), false);

  const insights = await getDataInsights({ days: 7, includeInventory: true });
  assert.equal(insights.today.cardsCreated, 2);
  assert.equal(insights.today.cardsRevised, 1);
  assert.equal(insights.today.cardsReviewed, 2);
  assert.equal(insights.today.tasksCompleted, 1);
  assert.equal(insights.totals.cardsCreated, 2);
  assert.equal(insights.inventory.cards.count, 2);
  assert.equal(insights.inventory.tasks.count, 1);
  assert.ok(insights.sync.pending >= 3);
  assert.equal(insights.sync.ready, insights.sync.pending);
  assert.equal(insights.sync.blocked, 0);
  assert.equal(insights.sync.conflicts, 0);
  const sessionSummary = await getActivitySummarySince(Date.now() - 86400000);
  assert.equal(sessionSummary.cardsCreated, 2);
  assert.equal(sessionSummary.cardsRevised, 1);
  assert.equal(sessionSummary.cardsReviewed, 2);
  assert.equal(sessionSummary.tasksCompleted, 1);
  assert.equal(insights.activityTrackingStarted, true);
  assert.ok(insights.activityEventsRetained >= 6);

  // Retention is bounded to 90 days and pruning never touches study records.
  const oldTimestamp = Date.now() - 91 * 24 * 60 * 60 * 1000;
  await insertOldActivityEvent({
    id: "expired-activity-event",
    day: localDayKey(oldTimestamp),
    kind: "card-reviewed",
    recordId: "old-card-id",
    occurredAt: oldTimestamp,
    timezoneOffsetMinutes: new Date(oldTimestamp).getTimezoneOffset()
  });
  const afterRetention = await getDataInsights({ days: 7, includeInventory: true });
  assert.equal(afterRetention.activityEventsRetained, 6);
  assert.equal((await db.getActivityEvents()).some((event) => event.id === "expired-activity-event"), false);
  assert.equal((await db.getAllCards()).length, 2);
  assert.equal((await db.getAllTasks()).length, 1);

  const removed = await db.clearActivityEvents();
  assert.equal(removed, 6);
  const afterClear = await db.getActivityEvents();
  assert.equal(afterClear.length, 0);
  const clearedInsights = await getDataInsights({ days: 7, includeInventory: true });
  assert.equal(clearedInsights.today.cardsCreated, 0);
  assert.equal(clearedInsights.activityEventsRetained, 0);
});
