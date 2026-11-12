// tests/tasks.mjs — pure task-list helpers. No IndexedDB needed.
import {
  countOpenTasks,
  countOverdueTasks,
  formatDueLabel,
  groupTasks,
  taskBucket,
  toDateKey
} from "../src/tools/tasksModel.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

export async function run() {
const today = "2026-11-11";

// ---- Date keys -------------------------------------------------------------
eq("local date key pads month and day", toDateKey(new Date(2026, 10, 5)), "2026-11-05");
eq("date key is stable at midnight", toDateKey(new Date(2026, 0, 1, 0, 0, 0)), "2026-01-01");
eq("date key stays local just before midnight", toDateKey(new Date(2026, 10, 12, 23, 59, 59)), "2026-11-12");
eq("date key rolls over after local midnight", toDateKey(new Date(2026, 10, 13, 0, 0, 1)), "2026-11-13");

const tasks = [
  { id: "undated", title: "Undated", dueDate: "", done: false, createdAt: 50, subject: "Biology" },
  { id: "later", title: "Later", dueDate: "2026-11-20", done: false, createdAt: 20, subject: "Biology" },
  { id: "today", title: "Today", dueDate: "2026-11-11", done: false, createdAt: 30, subject: "Chemistry" },
  { id: "overdue", title: "Overdue", dueDate: "2026-11-01", done: false, createdAt: 40, subject: "Biology" },
  { id: "done-old", title: "Done old", dueDate: "2026-11-02", done: true, completedAt: 100, updatedAt: 100, subject: "Biology" },
  { id: "done-new", title: "Done new", dueDate: "2026-11-03", done: true, completedAt: 200, updatedAt: 200, subject: "Chemistry" }
];

// ---- Buckets ---------------------------------------------------------------
eq("past date is overdue", taskBucket(tasks[3], today), "overdue");
eq("same date is today", taskBucket(tasks[2], today), "today");
eq("future date is upcoming", taskBucket(tasks[1], today), "upcoming");
eq("missing date is undated", taskBucket(tasks[0], today), "none");
eq("done wins over due date", taskBucket(tasks[4], today), "done");

// ---- Grouping and ordering -------------------------------------------------
const open = groupTasks(tasks, { filter: "open", todayKey: today });
eq("open filter drops done and keeps bucket order", open.map((g) => g.id), ["overdue", "today", "upcoming", "none"]);
eq("open tasks sort by due date then creation", open.flatMap((g) => g.tasks.map((t) => t.id)), ["overdue", "today", "later", "undated"]);

const done = groupTasks(tasks, { filter: "done", todayKey: today });
eq("done filter has one bucket", done.map((g) => g.id), ["done"]);
eq("done tasks sort newest completion first", done[0].tasks.map((t) => t.id), ["done-new", "done-old"]);

const all = groupTasks(tasks, { filter: "all", todayKey: today });
eq("all filter still ends with done", all.map((g) => g.id), ["overdue", "today", "upcoming", "none", "done"]);

// ---- Subject scoping -------------------------------------------------------
const biology = groupTasks(tasks, { filter: "all", subject: "Biology", todayKey: today });
eq("subject filter keeps only that subject", biology.flatMap((g) => g.tasks.map((t) => t.id)), ["overdue", "later", "undated", "done-old"]);
eq("unknown subject is empty", groupTasks(tasks, { filter: "all", subject: "Physics", todayKey: today }), []);

// ---- Labels and counts -----------------------------------------------------
eq("today label", formatDueLabel("2026-11-11", today), "Today");
eq("tomorrow label", formatDueLabel("2026-11-12", today), "Tomorrow");
eq("yesterday label", formatDueLabel("2026-11-10", today), "Yesterday");
check("absolute label is not empty", formatDueLabel("2026-12-01", today).length > 0);
eq("blank due date has no label", formatDueLabel("", today), "");

eq("open count excludes done", countOpenTasks(tasks), 4);
eq("overdue count excludes done and undated", countOverdueTasks(tasks, today), 1);

return { passed, failed };
}
