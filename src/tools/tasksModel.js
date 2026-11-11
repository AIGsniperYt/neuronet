// Pure task-list helpers shared by the Tasks tool and its tests.
// Tasks are date-only: a due date is a local YYYY-MM-DD key, never a timestamp,
// so "today" cannot drift with the time of day or timezone.

export const TASK_BUCKETS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "none", label: "No due date" },
  { id: "done", label: "Done" }
];

export function toDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (part) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function taskBucket(task, todayKey = toDateKey()) {
  if (task?.done) return "done";
  const dueDate = String(task?.dueDate || "");
  if (!dueDate) return "none";
  if (dueDate < todayKey) return "overdue";
  if (dueDate === todayKey) return "today";
  return "upcoming";
}

export function compareOpenTasks(a, b) {
  // Undated tasks sink to the bottom but keep creation order between themselves.
  const aDue = a?.dueDate || "9999-12-31";
  const bDue = b?.dueDate || "9999-12-31";
  return aDue.localeCompare(bDue)
    || (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0)
    || String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" });
}

export function compareDoneTasks(a, b) {
  return (Number(b?.completedAt) || 0) - (Number(a?.completedAt) || 0)
    || (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
}

export function groupTasks(tasks = [], { filter = "all", subject = "", todayKey = toDateKey() } = {}) {
  const visible = (tasks || []).filter((task) => {
    if (subject && task?.subject !== subject) return false;
    if (filter === "open") return !task?.done;
    if (filter === "done") return !!task?.done;
    return true;
  });

  const buckets = new Map(TASK_BUCKETS.map((bucket) => [bucket.id, []]));
  for (const task of visible) {
    buckets.get(taskBucket(task, todayKey)).push(task);
  }
  for (const [id, list] of buckets) {
    list.sort(id === "done" ? compareDoneTasks : compareOpenTasks);
  }
  return TASK_BUCKETS
    .map((bucket) => ({ ...bucket, tasks: buckets.get(bucket.id) }))
    .filter((bucket) => bucket.tasks.length > 0);
}

export function formatDueLabel(dueDate, todayKey = toDateKey()) {
  if (!dueDate) return "";
  if (dueDate === todayKey) return "Today";
  const today = new Date(`${todayKey}T00:00:00`);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return due.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(due.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
  });
}

export function countOpenTasks(tasks = []) {
  return (tasks || []).filter((task) => !task?.done).length;
}

export function countOverdueTasks(tasks = [], todayKey = toDateKey()) {
  return (tasks || []).filter((task) => !task?.done && task?.dueDate && task.dueDate < todayKey).length;
}
