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
const { getDataInsights } = await import("../src/dataInsights.js");

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
  assert.equal(insights.activityTrackingStarted, true);
  assert.ok(insights.activityEventsRetained >= 6);

  const removed = await db.clearActivityEvents();
  assert.equal(removed, 6);
  const afterClear = await db.getActivityEvents();
  assert.equal(afterClear.length, 0);
  const clearedInsights = await getDataInsights({ days: 7, includeInventory: true });
  assert.equal(clearedInsights.today.cardsCreated, 0);
  assert.equal(clearedInsights.activityEventsRetained, 0);
});
