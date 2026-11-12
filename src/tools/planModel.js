// Pure daily-plan builder.
//
// The plan is derived from three explicit sources: reviews that are currently
// due, commitments scheduled for today, and tasks whose due date is today.
// Overdue work is optional bonus work, so one missed day cannot turn into an
// ever-growing minimum. The planner never writes to SRS or changes task dates.
import { compareOpenTasks, toDateKey } from "./tasksModel.js";
import {
  commitmentsDueOn,
  compareCommitments,
  occurrenceStatus
} from "./commitmentsModel.js";

export const DEFAULT_REVIEW_OVERLOAD_MS = 45 * 60 * 1000;

function reviewRow(review = {}) {
  return {
    subject: String(review.subject || ""),
    subjectId: String(review.subjectId || ""),
    cards: Math.max(0, Number(review.cards) || 0),
    nodes: Math.max(0, Number(review.nodes) || 0),
    estimatedMs: Math.max(0, Number(review.estimatedMs) || 0)
  };
}

export function buildDailyPlan({
  tasks = [],
  commitments = [],
  reviews = [],
  todayKey = toDateKey(),
  upcomingLimit = 3,
  reviewOverloadMs = DEFAULT_REVIEW_OVERLOAD_MS,
  now = Date.now()
} = {}) {
  const reviewItems = (reviews || [])
    .map(reviewRow)
    .filter((review) => review.cards + review.nodes > 0);
  const estimatedReviewMs = reviewItems.reduce((sum, review) => sum + review.estimatedMs, 0);

  const commitmentRows = commitmentsDueOn(commitments, todayKey)
    .slice()
    .sort(compareCommitments)
    .map((commitment) => ({
      commitment,
      status: occurrenceStatus(commitment, todayKey),
      estimatedMs: 0
    }));

  // Commitments live in their own store, but filtering by type keeps the pure
  // helper safe if a caller passes a mixed collection.
  const taskList = (tasks || []).filter((task) => !task?.type || task.type === "task");
  const tasksDueToday = taskList
    .filter((task) => String(task.dueDate || "") === todayKey)
    .slice()
    .sort(compareOpenTasks)
    .map((task) => ({ task, status: task.done ? "done" : "due" }));

  const overdue = taskList
    .filter((task) => !task.done && task.dueDate && task.dueDate < todayKey)
    .slice()
    .sort(compareOpenTasks);

  const upcoming = taskList
    .filter((task) => !task.done && task.dueDate && task.dueDate > todayKey)
    .slice()
    .sort(compareOpenTasks);

  const remainingCommitments = commitmentRows.filter((row) => row.status === "due").length;
  const completedCommitments = commitmentRows.filter((row) => row.status === "done").length;
  const skippedCommitments = commitmentRows.filter((row) => row.status === "skipped").length;
  const completedTasks = tasksDueToday.filter((row) => row.status === "done").length;
  const remainingTasks = tasksDueToday.filter((row) => row.status === "due").length;

  const remaining = reviewItems.length + remainingCommitments + remainingTasks;
  const completed = completedCommitments + completedTasks;
  const skipped = skippedCommitments;
  const required = reviewItems.length + commitmentRows.length + tasksDueToday.length;
  const isMinimumDone = remaining === 0;
  const limit = Math.max(0, Math.floor(Number(upcomingLimit) || 0));

  return {
    todayKey,
    required: {
      reviews: reviewItems,
      commitments: commitmentRows,
      tasksDueToday
    },
    bonus: {
      overdue,
      // A head start is only suggested when today's required set is clear.
      upcoming: isMinimumDone ? upcoming.slice(0, limit) : []
    },
    counts: {
      required,
      completed,
      skipped,
      cleared: completed + skipped,
      remaining
    },
    estimatedReviewMs,
    isMinimumDone,
    isOverloaded: reviewOverloadMs > 0 && estimatedReviewMs >= reviewOverloadMs,
    generatedAt: Number(now) || Date.now()
  };
}
