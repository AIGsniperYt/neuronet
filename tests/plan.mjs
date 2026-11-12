// tests/plan.mjs — pure daily-plan composition. No IndexedDB.
import { buildDailyPlan, DEFAULT_REVIEW_OVERLOAD_MS } from "../src/tools/planModel.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const today = "2026-11-12"; // Thursday

const task = (overrides = {}) => ({
  id: "task",
  type: "task",
  title: "Task",
  dueDate: today,
  done: false,
  completedAt: null,
  subject: "",
  createdAt: 1,
  ...overrides
});

const commitment = (overrides = {}) => ({
  id: "commitment",
  type: "commitment",
  title: "Commitment",
  subject: "",
  recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-01", endDate: "" },
  completions: {},
  archivedAt: null,
  createdAt: 1,
  ...overrides
});

export async function run() {
  const tasks = [
    task({ id: "due-open", title: "Essay", subject: "English", createdAt: 30 }),
    task({ id: "due-done", title: "Homework", subject: "Maths", done: true, completedAt: 1, createdAt: 20 }),
    task({ id: "overdue-old", title: "Old task", dueDate: "2026-11-01", createdAt: 40 }),
    task({ id: "overdue-new", title: "Newer overdue", dueDate: "2026-11-05", createdAt: 10 }),
    task({ id: "overdue-done", title: "Done overdue", dueDate: "2026-11-02", done: true, completedAt: 2 }),
    task({ id: "upcoming-1", title: "Upcoming one", dueDate: "2026-11-20", createdAt: 5 }),
    task({ id: "upcoming-2", title: "Upcoming two", dueDate: "2026-11-18", createdAt: 6 }),
    task({ id: "undated", title: "Undated", dueDate: "" }),
    { id: "not-a-task", type: "commitment", title: "Not a task", dueDate: today, done: false }
  ];

  const commitments = [
    commitment({ id: "c-bio", title: "Biology recall", subject: "Biology" }),
    commitment({
      id: "c-chem",
      title: "Chemistry recall",
      subject: "Chemistry",
      recurrence: { frequency: "weekly", weekdays: [4], startDate: "2026-11-01", endDate: "" },
      completions: { [today]: { completedAt: 1 } }
    }),
    commitment({
      id: "c-math",
      title: "Maths recall",
      subject: "Maths",
      completions: { [today]: { skipped: true, at: 1 } }
    }),
    commitment({
      id: "c-fri",
      title: "Friday only",
      subject: "Physics",
      recurrence: { frequency: "weekly", weekdays: [5], startDate: "2026-11-01", endDate: "" }
    }),
    commitment({ id: "c-archived", title: "Archived", subject: "History", archivedAt: 1 }),
    commitment({
      id: "c-ended",
      title: "Ended",
      subject: "Geography",
      recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-01", endDate: "2026-11-11" }
    })
  ];

  const reviews = [
    { subject: "Biology", subjectId: "subj-bio", cards: 10, nodes: 2, estimatedMs: 60000 },
    { subject: "Maths", subjectId: "subj-math", cards: 0, nodes: 0, estimatedMs: 0 }
  ];

  const before = JSON.stringify({ tasks, commitments, reviews });
  const plan = buildDailyPlan({ tasks, commitments, reviews, todayKey: today, now: 999 });
  const after = JSON.stringify({ tasks, commitments, reviews });

  // ---- Required set ---------------------------------------------------------
  eq("only outstanding reviews are kept", plan.required.reviews.length, 1);
  eq("review row preserves counts", plan.required.reviews[0], {
    subject: "Biology", subjectId: "subj-bio", cards: 10, nodes: 2, estimatedMs: 60000
  });
  eq("review estimate is summed", plan.estimatedReviewMs, 60000);

  eq("today's commitments are included", plan.required.commitments.map((row) => row.commitment.id), ["c-bio", "c-chem", "c-math"]);
  eq("commitment statuses are explicit", plan.required.commitments.map((row) => row.status), ["due", "done", "skipped"]);
  eq("commitments sort by subject then title", plan.required.commitments.map((row) => row.commitment.subject), ["Biology", "Chemistry", "Maths"]);

  eq("tasks due today are included", plan.required.tasksDueToday.map((row) => row.task.id), ["due-done", "due-open"]);
  eq("task statuses are explicit", plan.required.tasksDueToday.map((row) => row.status), ["done", "due"]);
  eq("commitment-shaped records are not treated as tasks", plan.required.tasksDueToday.every((row) => row.task.type === "task"), true);

  // ---- Bonus set ------------------------------------------------------------
  eq("overdue tasks are bonus, not required", plan.bonus.overdue.map((item) => item.id), ["overdue-old", "overdue-new"]);
  eq("upcoming work is hidden while today is unresolved", plan.bonus.upcoming, []);

  // ---- Counts and state -----------------------------------------------------
  eq("required counts every row", plan.counts.required, 6);
  eq("completed counts done rows", plan.counts.completed, 2);
  eq("skipped counts cleared-but-not-done rows", plan.counts.skipped, 1);
  eq("cleared counts done plus skipped", plan.counts.cleared, 3);
  eq("remaining counts open required work", plan.counts.remaining, 3);
  eq("the minimum is not done while work remains", plan.isMinimumDone, false);
  eq("normal review load is not overload", plan.isOverloaded, false);
  eq("generated timestamp is injectable", plan.generatedAt, 999);
  eq("input collections are not mutated", after, before);

  // ---- Clear state ----------------------------------------------------------
  const clear = buildDailyPlan({
    tasks: [
      task({ id: "done-today", done: true, completedAt: 1 }),
      task({ id: "upcoming-1", dueDate: "2026-11-20", createdAt: 5 }),
      task({ id: "upcoming-2", dueDate: "2026-11-18", createdAt: 6 }),
      task({ id: "overdue", dueDate: "2026-11-01" })
    ],
    commitments: [commitment({
      id: "c-done",
      title: "Done commitment",
      completions: { [today]: { completedAt: 1 } }
    })],
    reviews: [],
    todayKey: today,
    upcomingLimit: 1
  });
  eq("a done required set clears the day", clear.isMinimumDone, true);
  eq("clear state counts no remaining work", clear.counts.remaining, 0);
  eq("clear state keeps overdue as bonus", clear.bonus.overdue.map((item) => item.id), ["overdue"]);
  eq("clear state offers a limited head start", clear.bonus.upcoming.map((item) => item.id), ["upcoming-2"]);

  const empty = buildDailyPlan({ todayKey: today });
  eq("an empty day is clear", empty.isMinimumDone, true);
  eq("an empty day has no required rows", empty.counts.required, 0);
  eq("an empty day has no review estimate", empty.estimatedReviewMs, 0);

  // ---- Overload -------------------------------------------------------------
  const heavy = buildDailyPlan({
    reviews: [{ subject: "Biology", cards: 100, estimatedMs: 50 * 60000 }],
    todayKey: today
  });
  eq("review-heavy day is flagged", heavy.isOverloaded, true);

  const custom = buildDailyPlan({
    reviews: [{ subject: "Biology", cards: 20, estimatedMs: 11 * 60000 }],
    todayKey: today,
    reviewOverloadMs: 10 * 60000
  });
  eq("overload threshold is configurable", custom.isOverloaded, true);
  eq("default overload threshold is 45 minutes", DEFAULT_REVIEW_OVERLOAD_MS, 45 * 60000);

  const disabled = buildDailyPlan({
    reviews: [{ subject: "Biology", cards: 100, estimatedMs: 100 * 60000 }],
    todayKey: today,
    reviewOverloadMs: 0
  });
  eq("zero threshold disables overload warnings", disabled.isOverloaded, false);

  return { passed, failed };
}
