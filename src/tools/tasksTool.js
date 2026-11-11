import { dialog } from "./dialog.js";
import { compareSubjectRecords, subjectOptionLabel } from "../subjectModel.js";
import {
  countOpenTasks,
  countOverdueTasks,
  formatDueLabel,
  groupTasks,
  taskBucket,
  toDateKey
} from "./tasksModel.js";

// Local-first task board. The Classroom button is deliberately a disabled
// placeholder: OAuth and coursework import belong to a later backend pass, and
// this tool must stay useful offline in the meantime.
export async function initTasksTool(deps, context = {}) {
  const { getAllTasks, addTask, deleteTask, getSubjects, escapeHtml } = deps;
  const $ = (id) => document.getElementById(id);

  const el = {
    meta: $("tasksMeta"),
    quickAdd: $("tasksQuickAdd"),
    quickTitle: $("tasksQuickTitle"),
    quickDue: $("tasksQuickDue"),
    quickSubject: $("tasksQuickSubject"),
    filters: $("tasksFilters"),
    filterSubject: $("tasksSubjectFilter"),
    status: $("tasksStatus"),
    list: $("tasksList")
  };
  if (!el.list) return;

  const state = {
    tasks: [],
    subjects: [],
    filter: "open",
    subjectFilter: String(context.subject || ""),
    editingId: null
  };
  let statusTimer = null;

  function setStatus(message, isError = false) {
    if (!el.status) return;
    el.status.textContent = message;
    el.status.classList.toggle("error", isError);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (!el.status?.isConnected) return;
      el.status.textContent = "";
      el.status.classList.remove("error");
    }, 2600);
  }

  function subjectOptions(selectedKey = "", placeholder = "No subject") {
    const options = [`<option value=""${selectedKey ? "" : " selected"}>${escapeHtml(placeholder)}</option>`];
    for (const record of state.subjects) {
      const key = String(record.key || "");
      options.push(
        `<option value="${escapeHtml(key)}"${key === selectedKey ? " selected" : ""}>${escapeHtml(subjectOptionLabel(record))}</option>`
      );
    }
    return options.join("");
  }

  function subjectLabelFor(task) {
    const record = state.subjects.find((item) => (
      (task.subjectId && item.id === task.subjectId)
      || (task.subject && item.key === task.subject)
    ));
    return record ? subjectOptionLabel(record) : String(task.subject || "");
  }

  function replaceTask(updated) {
    const index = state.tasks.findIndex((task) => task.id === updated.id);
    if (index === -1) state.tasks.push(updated);
    else state.tasks[index] = updated;
  }

  function emptyMarkup() {
    const hasTasks = state.tasks.length > 0;
    const message = state.filter === "done"
      ? "No completed tasks yet."
      : state.subjectFilter
        ? "Nothing here for this subject."
        : hasTasks
          ? "Nothing open."
          : "No tasks yet.";
    const hint = state.filter === "done"
      ? "Finish a task and it will appear here."
      : hasTasks
        ? "Completed tasks are under Done."
        : "Add one above and it will show up here.";
    return `<div class="tasks-empty">
      <i class="fa-solid fa-list-check" aria-hidden="true"></i>
      <p>${escapeHtml(message)}</p>
      <span>${escapeHtml(hint)}</span>
    </div>`;
  }

  function renderTask(task, todayKey) {
    if (state.editingId === task.id) {
      return `<article class="task-row task-row-editing" data-task-id="${escapeHtml(task.id)}">
        <form class="task-edit-form" data-task-id="${escapeHtml(task.id)}">
          <input class="tasks-field task-edit-title" name="title" type="text" maxlength="200" value="${escapeHtml(task.title)}" aria-label="Task title">
          <div class="task-edit-fields">
            <input class="tasks-field" name="dueDate" type="date" value="${escapeHtml(task.dueDate || "")}" aria-label="Due date">
            <select class="tasks-field" name="subject" aria-label="Subject">${subjectOptions(task.subject)}</select>
            <button type="submit" class="tasks-add-btn">Save</button>
            <button type="button" class="tasks-ghost-btn" data-action="cancel">Cancel</button>
          </div>
        </form>
      </article>`;
    }

    const bucket = taskBucket(task, todayKey);
    const subject = subjectLabelFor(task);
    const due = formatDueLabel(task.dueDate, todayKey);
    const chips = [
      subject ? `<span class="task-chip subject">${escapeHtml(subject)}</span>` : "",
      due ? `<span class="task-chip task-due${bucket === "overdue" ? " overdue" : ""}"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i>${escapeHtml(due)}</span>` : "",
      task.source === "classroom" ? `<span class="task-chip classroom">Classroom</span>` : ""
    ].filter(Boolean).join("");

    return `<article class="task-row${task.done ? " done" : ""}" data-task-id="${escapeHtml(task.id)}">
      <button type="button" class="task-check" data-action="toggle" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}" aria-pressed="${task.done}">
        <i class="fa-solid fa-check" aria-hidden="true"></i>
      </button>
      <div class="task-body">
        <button type="button" class="task-title-btn" data-action="edit" title="Edit task">${escapeHtml(task.title)}</button>
        ${chips ? `<div class="task-meta">${chips}</div>` : ""}
      </div>
      <div class="task-row-actions">
        <button type="button" class="task-icon-btn" data-action="edit" title="Edit task" aria-label="Edit ${escapeHtml(task.title)}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
        <button type="button" class="task-icon-btn danger" data-action="delete" title="Delete task" aria-label="Delete ${escapeHtml(task.title)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    </article>`;
  }

  function render() {
    if (!el.list) return;
    const todayKey = toDateKey();
    const groups = groupTasks(state.tasks, {
      filter: state.filter,
      subject: state.subjectFilter,
      todayKey
    });
    const openCount = countOpenTasks(state.tasks);
    const overdueCount = countOverdueTasks(state.tasks, todayKey);

    if (el.meta) {
      el.meta.textContent = openCount
        ? `${openCount} open${overdueCount ? ` · ${overdueCount} overdue` : ""}`
        : "All clear";
    }
    el.filters?.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (el.filterSubject && el.filterSubject.value !== state.subjectFilter) {
      el.filterSubject.value = state.subjectFilter;
    }

    el.list.innerHTML = groups.length
      ? groups.map((group) => `<section class="tasks-group">
          <h2 class="tasks-group-title ${group.id}">${group.label}<span class="tasks-group-count">${group.tasks.length}</span></h2>
          <div class="tasks-group-list">${group.tasks.map((task) => renderTask(task, todayKey)).join("")}</div>
        </section>`).join("")
      : emptyMarkup();

    if (state.editingId) {
      const input = el.list.querySelector(".task-edit-title");
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  async function addFromQuickForm(event) {
    event.preventDefault();
    const title = String(el.quickTitle?.value || "").trim();
    if (!title) {
      setStatus("Give the task a name first.", true);
      el.quickTitle?.focus();
      return;
    }
    const subject = String(el.quickSubject?.value || "");
    const record = state.subjects.find((item) => item.key === subject);

    try {
      const task = await addTask({
        title,
        dueDate: String(el.quickDue?.value || ""),
        subject,
        subjectId: record?.id || ""
      });
      state.tasks.push(task);
      if (el.quickTitle) el.quickTitle.value = "";
      if (el.quickDue) el.quickDue.value = "";
      // Keep the new task visible: a done-only filter or a different subject
      // scope would otherwise swallow the row the user just created.
      if (state.filter === "done") state.filter = "open";
      if (state.subjectFilter && state.subjectFilter !== task.subject) state.subjectFilter = "";
      if (el.filterSubject) el.filterSubject.value = state.subjectFilter;
      render();
      setStatus("Task added.");
      el.quickTitle?.focus();
    } catch {
      setStatus("Could not add the task.", true);
    }
  }

  async function toggleTask(task) {
    const done = !task.done;
    try {
      const updated = await addTask({ ...task, done, completedAt: done ? Date.now() : null });
      replaceTask(updated);
      render();
      setStatus(done ? "Task completed." : "Task reopened.");
    } catch {
      setStatus("Could not update the task.", true);
    }
  }

  async function deleteTaskRow(task) {
    const ok = await dialog.confirm(`Delete "${task.title}"?`, "Delete", "danger");
    if (!ok) return;
    try {
      await deleteTask(task.id);
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      if (state.editingId === task.id) state.editingId = null;
      render();
      setStatus("Task deleted.");
    } catch {
      setStatus("Could not delete the task.", true);
    }
  }

  async function saveTaskRow(form) {
    const task = state.tasks.find((item) => item.id === form.dataset.taskId);
    if (!task) return;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) {
      setStatus("Give the task a name first.", true);
      form.querySelector('[name="title"]')?.focus();
      return;
    }
    const subject = String(data.get("subject") || "");
    const record = state.subjects.find((item) => item.key === subject);
    try {
      const updated = await addTask({
        ...task,
        title,
        dueDate: String(data.get("dueDate") || ""),
        subject,
        subjectId: record?.id || ""
      });
      replaceTask(updated);
      state.editingId = null;
      render();
      setStatus("Task updated.");
    } catch {
      setStatus("Could not save the task.", true);
    }
  }

  el.quickAdd?.addEventListener("submit", addFromQuickForm);

  el.filters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter || "all";
    render();
  });

  el.filterSubject?.addEventListener("change", () => {
    state.subjectFilter = el.filterSubject.value || "";
    render();
  });

  el.list.addEventListener("click", (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const row = actionEl.closest("[data-task-id]");
    if (!row) return;
    const task = state.tasks.find((item) => item.id === row.dataset.taskId);
    if (!task) return;

    const action = actionEl.dataset.action;
    if (action === "toggle") toggleTask(task);
    else if (action === "edit") {
      state.editingId = task.id;
      render();
    } else if (action === "cancel") {
      state.editingId = null;
      render();
    } else if (action === "delete") {
      deleteTaskRow(task);
    }
  });

  el.list.addEventListener("submit", (event) => {
    const form = event.target.closest(".task-edit-form");
    if (!form) return;
    event.preventDefault();
    saveTaskRow(form);
  });

  el.list.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.editingId) return;
    event.preventDefault();
    state.editingId = null;
    render();
  });

  try {
    const [tasks, subjects] = await Promise.all([getAllTasks(), getSubjects()]);
    state.tasks = tasks || [];
    state.subjects = (subjects || []).slice().sort(compareSubjectRecords);
    if (state.subjectFilter && !state.subjects.some((item) => item.key === state.subjectFilter)) {
      state.subjectFilter = "";
    }
    if (el.quickSubject) {
      el.quickSubject.innerHTML = subjectOptions(state.subjectFilter);
      el.quickSubject.value = state.subjectFilter;
    }
    if (el.filterSubject) {
      el.filterSubject.innerHTML = subjectOptions("", "All subjects");
      el.filterSubject.value = state.subjectFilter;
    }
    render();
  } catch {
    setStatus("Could not load tasks.", true);
  }
}
