import { dialog } from "./dialog.js";
import { compareSubjectRecords, subjectOptionLabel } from "../subjectModel.js";
import {
  TASK_BUCKETS,
  countOpenTasks,
  countOverdueTasks,
  formatDueLabel,
  groupTasks,
  taskBucket,
  toDateKey
} from "./tasksModel.js";
import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  activeCommitments,
  compareCommitments,
  completeOccurrence,
  countDueCommitments,
  formatCadence,
  nextOccurrenceLabel,
  occurrenceStatus,
  skipOccurrence,
  summarizeCommitment,
  summarizeWeek,
  undoOccurrence,
  weekdayOf
} from "./commitmentsModel.js";

// Local-first task board. The Classroom button is deliberately a disabled
// placeholder: OAuth and coursework import belong to a later backend pass, and
// this tool must stay useful offline in the meantime.
//
// One-off tasks and recurring commitments share this page but not a store. The
// quick-add Repeat control routes a form submission to the commitment store;
// the list below merges today's commitment occurrences back into Today/Done so
// the user never has to think about the split.
export async function initTasksTool(deps, context = {}) {
  const {
    getAllTasks,
    addTask,
    deleteTask,
    getAllCommitments,
    addCommitment,
    deleteCommitment,
    getSubjects,
    escapeHtml
  } = deps;
  const $ = (id) => document.getElementById(id);

  const el = {
    meta: $("tasksMeta"),
    quickAdd: $("tasksQuickAdd"),
    quickTitle: $("tasksQuickTitle"),
    quickRepeat: $("tasksQuickRepeat"),
    quickDue: $("tasksQuickDue"),
    quickSubject: $("tasksQuickSubject"),
    quickSubmitLabel: $("tasksQuickSubmitLabel"),
    quickRepeatOptions: $("tasksQuickRepeatOptions"),
    quickWeekdays: $("tasksQuickWeekdays"),
    quickEnd: $("tasksQuickEnd"),
    quickRepeatHint: $("tasksQuickRepeatHint"),
    filters: $("tasksFilters"),
    filterSubject: $("tasksSubjectFilter"),
    status: $("tasksStatus"),
    list: $("tasksList"),
    recurring: $("tasksRecurring"),
    recurringList: $("tasksRecurringList"),
    recurringCount: $("tasksRecurringCount")
  };
  if (!el.list) return;

  const state = {
    tasks: [],
    commitments: [],
    subjects: [],
    filter: "open",
    subjectFilter: String(context.subject || ""),
    editingTaskId: null,
    editingCommitmentId: null
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

  function subjectLabelFor(record) {
    const subject = state.subjects.find((item) => (
      (record.subjectId && item.id === record.subjectId)
      || (record.subject && item.key === record.subject)
    ));
    return subject ? subjectOptionLabel(subject) : String(record.subject || "");
  }

  function replaceTask(updated) {
    const index = state.tasks.findIndex((task) => task.id === updated.id);
    if (index === -1) state.tasks.push(updated);
    else state.tasks[index] = updated;
  }

  function replaceCommitment(updated) {
    const index = state.commitments.findIndex((commitment) => commitment.id === updated.id);
    if (index === -1) state.commitments.push(updated);
    else state.commitments[index] = updated;
  }

  // ---- Weekday chips -------------------------------------------------------
  // Kept as plain buttons rather than inputs so a click never submits the form.
  // The active class is the source of truth when a form is saved.
  function weekdayChips(selected = []) {
    const days = new Set((selected || []).map(Number));
    return WEEKDAY_ORDER.map((day) => {
      const active = days.has(day);
      return `<button type="button" class="tasks-weekday${active ? " active" : ""}" data-weekday="${day}" aria-pressed="${active}" aria-label="${WEEKDAY_LABELS[day]}">${WEEKDAY_LABELS[day]}</button>`;
    }).join("");
  }

  function setChipActive(chip, active) {
    if (!chip) return;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  }

  function toggleChip(chip) {
    if (!chip) return;
    setChipActive(chip, !chip.classList.contains("active"));
  }

  function readWeekdays(container) {
    if (!container) return [];
    return [...container.querySelectorAll(".tasks-weekday.active")]
      .map((chip) => Number(chip.dataset.weekday))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  }

  function seedWeekday(container, dateKey) {
    if (!container) return;
    const day = weekdayOf(dateKey);
    setChipActive(container.querySelector(`[data-weekday="${day}"]`), true);
  }

  // ---- Quick add -----------------------------------------------------------
  function updateQuickRepeatUi({ seed = false } = {}) {
    const mode = String(el.quickRepeat?.value || "none");
    const recurring = mode !== "none";
    el.quickAdd?.classList.toggle("recurring", recurring);
    if (el.quickDue) el.quickDue.hidden = recurring;
    if (el.quickRepeatOptions) el.quickRepeatOptions.hidden = !recurring;
    if (el.quickWeekdays) el.quickWeekdays.hidden = mode !== "weekly";
    if (el.quickRepeatHint) {
      el.quickRepeatHint.textContent = mode === "weekly"
        ? "Pick at least one day."
        : mode === "daily"
          ? "Appears on Today every day."
          : "";
    }
    if (el.quickSubmitLabel) el.quickSubmitLabel.textContent = recurring ? "Add repeat" : "Add task";
    if (el.quickTitle) {
      el.quickTitle.placeholder = recurring
        ? "Add a repeat — e.g. Biology recall"
        : "Add a task — e.g. Finish Macbeth essay";
    }
    if (seed && mode === "weekly" && el.quickWeekdays && !readWeekdays(el.quickWeekdays).length) {
      seedWeekday(el.quickWeekdays, toDateKey());
    }
  }

  function resetQuickForm() {
    if (el.quickTitle) el.quickTitle.value = "";
    if (el.quickDue) el.quickDue.value = "";
    if (el.quickEnd) el.quickEnd.value = "";
    if (el.quickRepeat) el.quickRepeat.value = "none";
    el.quickWeekdays?.querySelectorAll(".tasks-weekday").forEach((chip) => setChipActive(chip, false));
    updateQuickRepeatUi();
    el.quickTitle?.focus();
  }

  function keepNewRecordVisible(subject) {
    // A done-only filter or a different subject scope would otherwise swallow
    // the row the user just created.
    if (state.filter === "done") state.filter = "open";
    if (state.subjectFilter && state.subjectFilter !== subject) state.subjectFilter = "";
    if (el.filterSubject) el.filterSubject.value = state.subjectFilter;
  }

  async function addFromQuickForm(event) {
    event.preventDefault();
    const title = String(el.quickTitle?.value || "").trim();
    if (!title) {
      setStatus("Give it a name first.", true);
      el.quickTitle?.focus();
      return;
    }
    const subject = String(el.quickSubject?.value || "");
    const record = state.subjects.find((item) => item.key === subject);
    const todayKey = toDateKey();
    const mode = String(el.quickRepeat?.value || "none");

    if (mode === "weekly" && !readWeekdays(el.quickWeekdays).length) {
      setStatus("Pick at least one repeat day.", true);
      return;
    }
    const endDate = String(el.quickEnd?.value || "");
    if (mode !== "none" && endDate && endDate < todayKey) {
      setStatus("The repeat cannot end before today.", true);
      return;
    }

    try {
      if (mode === "none") {
        const task = await addTask({
          title,
          dueDate: String(el.quickDue?.value || ""),
          subject,
          subjectId: record?.id || ""
        });
        state.tasks.push(task);
        keepNewRecordVisible(task.subject);
        resetQuickForm();
        render();
        setStatus("Task added.");
        return;
      }

      const commitment = await addCommitment({
        title,
        subject,
        subjectId: record?.id || "",
        recurrence: {
          frequency: mode,
          weekdays: mode === "weekly" ? readWeekdays(el.quickWeekdays) : [],
          startDate: todayKey,
          endDate
        }
      });
      state.commitments.push(commitment);
      keepNewRecordVisible(commitment.subject);
      resetQuickForm();
      // Open the management section so the new repeat is visibly created.
      if (el.recurring) el.recurring.open = true;
      render();
      setStatus("Repeat added.");
    } catch {
      setStatus(mode === "none" ? "Could not add the task." : "Could not add the repeat.", true);
    }
  }

  // ---- Task rows -----------------------------------------------------------
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
        : "Add one above, or set a repeat for something you do every week.";
    return `<div class="tasks-empty">
      <i class="fa-solid fa-list-check" aria-hidden="true"></i>
      <p>${escapeHtml(message)}</p>
      <span>${escapeHtml(hint)}</span>
    </div>`;
  }

  function renderTask(task, todayKey) {
    if (state.editingTaskId === task.id) {
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

  // ---- Commitment rows in the combined Today/Done list ---------------------
  function renderCommitmentRow(commitment, status) {
    const subject = subjectLabelFor(commitment);
    const done = status === "done";
    const dueLabel = done ? "Done today" : "Due today";
    const chips = [
      subject ? `<span class="task-chip subject">${escapeHtml(subject)}</span>` : "",
      `<span class="task-chip repeat"><i class="fa-solid fa-rotate" aria-hidden="true"></i>${escapeHtml(formatCadence(commitment.recurrence))}</span>`,
      `<span class="task-chip ${done ? "done" : ""}">${escapeHtml(dueLabel)}</span>`
    ].filter(Boolean).join("");

    return `<article class="task-row commitment-row${done ? " done" : ""}" data-commitment-id="${escapeHtml(commitment.id)}">
      <button type="button" class="task-check" data-action="toggle-commitment" aria-label="${done ? "Undo today's completion" : "Mark done for today"}" aria-pressed="${done}">
        <i class="fa-solid fa-check" aria-hidden="true"></i>
      </button>
      <div class="task-body">
        <span class="task-title-static">${escapeHtml(commitment.title)}</span>
        ${chips ? `<div class="task-meta">${chips}</div>` : ""}
      </div>
      <div class="task-row-actions">
        ${done ? "" : `<button type="button" class="task-icon-btn" data-action="skip-commitment" title="Skip today" aria-label="Skip ${escapeHtml(commitment.title)} today"><i class="fa-solid fa-forward-step" aria-hidden="true"></i></button>`}
      </div>
    </article>`;
  }

  // ---- Recurring management cards -----------------------------------------
  function renderCommitmentEdit(commitment) {
    const recurrence = commitment.recurrence || {};
    const frequency = recurrence.frequency === "weekly" ? "weekly" : "daily";
    return `<article class="commitment-card" data-commitment-id="${escapeHtml(commitment.id)}">
      <form class="task-edit-form task-edit-form-commitment commitment-edit-form" data-commitment-id="${escapeHtml(commitment.id)}">
        <input class="tasks-field task-edit-title commitment-edit-title" name="title" type="text" maxlength="200" value="${escapeHtml(commitment.title)}" aria-label="Commitment title">
        <div class="task-edit-fields">
          <select class="tasks-field" name="repeat" data-commitment-repeat aria-label="Repeats">
            <option value="daily"${frequency === "daily" ? " selected" : ""}>Every day</option>
            <option value="weekly"${frequency === "weekly" ? " selected" : ""}>Chosen days</option>
          </select>
          <div class="tasks-weekdays" data-commitment-weekdays${frequency === "weekly" ? "" : " hidden"}>
            ${weekdayChips(recurrence.weekdays || [])}
          </div>
          <label class="tasks-until">
            <span>Until</span>
            <input class="tasks-field" name="endDate" type="date" value="${escapeHtml(recurrence.endDate || "")}" aria-label="Repeat until">
          </label>
          <select class="tasks-field" name="subject" aria-label="Subject">${subjectOptions(commitment.subject)}</select>
          <button type="submit" class="tasks-add-btn">Save</button>
          <button type="button" class="tasks-ghost-btn" data-action="cancel-commitment">Cancel</button>
        </div>
      </form>
    </article>`;
  }

  function renderCommitmentCard(commitment, todayKey) {
    if (state.editingCommitmentId === commitment.id) return renderCommitmentEdit(commitment);

    const archived = !!commitment.archivedAt;
    const status = occurrenceStatus(commitment, todayKey);
    const week = summarizeWeek(commitment, todayKey);
    const rolling = summarizeCommitment(commitment, { todayKey, windowDays: 28 });
    const subject = subjectLabelFor(commitment);

    const chips = [
      subject ? `<span class="task-chip subject">${escapeHtml(subject)}</span>` : "",
      `<span class="task-chip repeat">${escapeHtml(formatCadence(commitment.recurrence))}</span>`,
      archived ? `<span class="task-chip paused">Paused</span>` : "",
      status === "done" ? `<span class="task-chip done">Done today</span>` : "",
      status === "skipped" ? `<span class="task-chip skipped">Skipped today</span>` : ""
    ].filter(Boolean).join("");

    const stats = [
      `<span>Next: ${escapeHtml(nextOccurrenceLabel(commitment, todayKey))}</span>`,
      `<span>${week.completed} of ${week.scheduled} this week</span>`,
      week.missed ? `<span class="commitment-missed">${week.missed} missed</span>` : "",
      rolling.lastCompletedDate
        ? `<span>Last done ${escapeHtml(formatDueLabel(rolling.lastCompletedDate, todayKey))}</span>`
        : `<span>Not done yet</span>`
    ].filter(Boolean).join("");

    const actions = [];
    if (!archived && status === "due") {
      actions.push(`<button type="button" class="tasks-ghost-btn" data-action="complete-commitment"><i class="fa-solid fa-check" aria-hidden="true"></i> Done</button>`);
      actions.push(`<button type="button" class="tasks-ghost-btn" data-action="skip-commitment">Skip today</button>`);
    } else if (!archived && (status === "done" || status === "skipped")) {
      actions.push(`<button type="button" class="tasks-ghost-btn" data-action="undo-commitment">Undo</button>`);
    }
    actions.push(`<button type="button" class="tasks-ghost-btn" data-action="edit-commitment"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</button>`);
    actions.push(`<button type="button" class="tasks-ghost-btn" data-action="archive-commitment">${archived ? "Resume" : "Pause"}</button>`);
    actions.push(`<button type="button" class="tasks-ghost-btn danger" data-action="delete-commitment"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>`);

    return `<article class="commitment-card${archived ? " paused" : ""}" data-commitment-id="${escapeHtml(commitment.id)}">
      <div class="commitment-card-main">
        <div class="commitment-card-head">
          <h3>${escapeHtml(commitment.title)}</h3>
          ${chips}
        </div>
        <div class="commitment-card-stats">${stats}</div>
      </div>
      <div class="commitment-card-actions">${actions.join("")}</div>
    </article>`;
  }

  function renderRecurring(todayKey) {
    if (!el.recurringList) return;
    if (el.recurringCount) {
      el.recurringCount.textContent = String(activeCommitments(state.commitments, todayKey).length);
    }
    const ordered = state.commitments.slice().sort((a, b) => (
      Number(!!a.archivedAt) - Number(!!b.archivedAt)
      || compareCommitments(a, b)
    ));
    el.recurringList.innerHTML = ordered.length
      ? ordered.map((commitment) => renderCommitmentCard(commitment, todayKey)).join("")
      : `<p class="tasks-recurring-empty">No repeats yet. Choose Every day or Chosen days above to add one.</p>`;

    if (state.editingCommitmentId) {
      if (el.recurring) el.recurring.open = true;
      const input = el.recurringList.querySelector(".commitment-edit-title");
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  // ---- Combined list -------------------------------------------------------
  function mergedGroups(todayKey) {
    const groups = groupTasks(state.tasks, {
      filter: state.filter,
      subject: state.subjectFilter,
      todayKey
    }).map((group) => ({ ...group, commitments: [] }));
    const byId = new Map(groups.map((group) => [group.id, group]));
    const ensureGroup = (id) => {
      if (!byId.has(id)) {
        const bucket = TASK_BUCKETS.find((item) => item.id === id);
        if (bucket) byId.set(id, { ...bucket, tasks: [], commitments: [] });
      }
      return byId.get(id);
    };

    const rows = state.commitments
      .filter((commitment) => !commitment.archivedAt)
      .filter((commitment) => !state.subjectFilter || commitment.subject === state.subjectFilter)
      .map((commitment) => ({ commitment, status: occurrenceStatus(commitment, todayKey) }))
      .filter((row) => row.status === "due" || row.status === "done")
      .filter((row) => {
        if (state.filter === "open") return row.status === "due";
        if (state.filter === "done") return row.status === "done";
        return true;
      })
      .sort((a, b) => compareCommitments(a.commitment, b.commitment));

    for (const row of rows) {
      ensureGroup(row.status === "due" ? "today" : "done")
        .commitments.push(row.commitment);
    }

    return TASK_BUCKETS
      .map((bucket) => byId.get(bucket.id))
      .filter(Boolean)
      .filter((group) => group.tasks.length || group.commitments.length);
  }

  function render() {
    if (!el.list) return;
    const todayKey = toDateKey();
    const groups = mergedGroups(todayKey);
    const openCount = countOpenTasks(state.tasks);
    const overdueCount = countOverdueTasks(state.tasks, todayKey);
    const dueRepeats = countDueCommitments(state.commitments, todayKey);

    if (el.meta) {
      const parts = [];
      if (openCount) parts.push(`${openCount} open`);
      if (dueRepeats) parts.push(`${dueRepeats} repeat${dueRepeats === 1 ? "" : "s"} today`);
      if (overdueCount) parts.push(`${overdueCount} overdue`);
      el.meta.textContent = parts.length ? parts.join(" · ") : "All clear";
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
      ? groups.map((group) => {
          const rows = [
            ...group.commitments.map((commitment) => renderCommitmentRow(commitment, group.id === "done" ? "done" : "due")),
            ...group.tasks.map((task) => renderTask(task, todayKey))
          ].join("");
          return `<section class="tasks-group">
            <h2 class="tasks-group-title ${group.id}">${group.label}<span class="tasks-group-count">${group.tasks.length + group.commitments.length}</span></h2>
            <div class="tasks-group-list">${rows}</div>
          </section>`;
        }).join("")
      : emptyMarkup();

    if (state.editingTaskId) {
      const input = el.list.querySelector(".task-edit-title");
      if (input) {
        input.focus();
        input.select();
      }
    }

    renderRecurring(todayKey);
  }

  // ---- Task actions --------------------------------------------------------
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
      if (state.editingTaskId === task.id) state.editingTaskId = null;
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
      state.editingTaskId = null;
      render();
      setStatus("Task updated.");
    } catch {
      setStatus("Could not save the task.", true);
    }
  }

  // ---- Commitment actions --------------------------------------------------
  async function completeCommitmentRow(commitment) {
    try {
      const updated = await addCommitment(completeOccurrence(commitment, toDateKey()));
      replaceCommitment(updated);
      render();
      setStatus("Done for today.");
    } catch {
      setStatus("Could not update the repeat.", true);
    }
  }

  async function skipCommitmentRow(commitment) {
    try {
      const updated = await addCommitment(skipOccurrence(commitment, toDateKey()));
      replaceCommitment(updated);
      render();
      setStatus("Skipped today. It will be back next time.");
    } catch {
      setStatus("Could not skip the repeat.", true);
    }
  }

  async function undoCommitmentRow(commitment) {
    try {
      const updated = await addCommitment(undoOccurrence(commitment, toDateKey()));
      replaceCommitment(updated);
      render();
      setStatus("Reopened for today.");
    } catch {
      setStatus("Could not reopen the repeat.", true);
    }
  }

  async function toggleArchiveCommitment(commitment) {
    try {
      const updated = await addCommitment({
        ...commitment,
        archivedAt: commitment.archivedAt ? null : Date.now()
      });
      replaceCommitment(updated);
      render();
      setStatus(updated.archivedAt ? "Repeat paused." : "Repeat resumed.");
    } catch {
      setStatus("Could not update the repeat.", true);
    }
  }

  async function deleteCommitmentRow(commitment) {
    const ok = await dialog.confirm(
      `Delete "${commitment.title}"? Its completion history will be lost. Pause it instead if you only want to stop it.`,
      "Delete",
      "danger"
    );
    if (!ok) return;
    try {
      await deleteCommitment(commitment.id);
      state.commitments = state.commitments.filter((item) => item.id !== commitment.id);
      if (state.editingCommitmentId === commitment.id) state.editingCommitmentId = null;
      render();
      setStatus("Repeat deleted.");
    } catch {
      setStatus("Could not delete the repeat.", true);
    }
  }

  async function saveCommitmentRow(form) {
    const commitment = state.commitments.find((item) => item.id === form.dataset.commitmentId);
    if (!commitment) return;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) {
      setStatus("Give the repeat a name first.", true);
      form.querySelector('[name="title"]')?.focus();
      return;
    }

    const frequency = String(data.get("repeat") || "daily") === "weekly" ? "weekly" : "daily";
    const weekdays = frequency === "weekly"
      ? readWeekdays(form.querySelector("[data-commitment-weekdays]"))
      : [];
    if (frequency === "weekly" && !weekdays.length) {
      setStatus("Pick at least one repeat day.", true);
      return;
    }

    const recurrence = {
      ...commitment.recurrence,
      frequency,
      weekdays,
      endDate: String(data.get("endDate") || "")
    };
    if (!recurrence.startDate) recurrence.startDate = toDateKey();
    if (recurrence.endDate && recurrence.endDate < recurrence.startDate) {
      setStatus("The repeat cannot end before it starts.", true);
      return;
    }

    const subject = String(data.get("subject") || "");
    const record = state.subjects.find((item) => item.key === subject);
    try {
      const updated = await addCommitment({
        ...commitment,
        title,
        subject,
        subjectId: record?.id || "",
        recurrence
      });
      replaceCommitment(updated);
      state.editingCommitmentId = null;
      render();
      setStatus("Repeat updated.");
    } catch {
      setStatus("Could not save the repeat.", true);
    }
  }

  function handleCommitmentAction(action, commitmentId) {
    const commitment = state.commitments.find((item) => item.id === commitmentId);
    if (!commitment) return Promise.resolve();

    if (action === "complete-commitment") return completeCommitmentRow(commitment);
    if (action === "skip-commitment") return skipCommitmentRow(commitment);
    if (action === "undo-commitment") return undoCommitmentRow(commitment);
    if (action === "toggle-commitment") {
      const status = occurrenceStatus(commitment, toDateKey());
      return status === "done" || status === "skipped"
        ? undoCommitmentRow(commitment)
        : completeCommitmentRow(commitment);
    }
    if (action === "archive-commitment") return toggleArchiveCommitment(commitment);
    if (action === "delete-commitment") return deleteCommitmentRow(commitment);
    if (action === "edit-commitment") {
      state.editingTaskId = null;
      state.editingCommitmentId = commitment.id;
      render();
    } else if (action === "cancel-commitment") {
      state.editingCommitmentId = null;
      render();
    }
    return Promise.resolve();
  }

  // ---- Events --------------------------------------------------------------
  el.quickAdd?.addEventListener("submit", addFromQuickForm);

  el.quickRepeat?.addEventListener("change", () => updateQuickRepeatUi({ seed: true }));

  el.quickWeekdays?.addEventListener("click", (event) => {
    const chip = event.target.closest(".tasks-weekday");
    if (chip) toggleChip(chip);
  });

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

    const commitmentRow = actionEl.closest("[data-commitment-id]");
    if (commitmentRow) {
      handleCommitmentAction(actionEl.dataset.action, commitmentRow.dataset.commitmentId);
      return;
    }

    const row = actionEl.closest("[data-task-id]");
    if (!row) return;
    const task = state.tasks.find((item) => item.id === row.dataset.taskId);
    if (!task) return;

    const action = actionEl.dataset.action;
    if (action === "toggle") toggleTask(task);
    else if (action === "edit") {
      state.editingCommitmentId = null;
      state.editingTaskId = task.id;
      render();
    } else if (action === "cancel") {
      state.editingTaskId = null;
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
    if (event.key !== "Escape" || !state.editingTaskId) return;
    event.preventDefault();
    state.editingTaskId = null;
    render();
  });

  el.recurringList?.addEventListener("click", (event) => {
    const chip = event.target.closest(".tasks-weekday");
    if (chip) {
      toggleChip(chip);
      return;
    }
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const card = actionEl.closest("[data-commitment-id]");
    if (!card) return;
    handleCommitmentAction(actionEl.dataset.action, card.dataset.commitmentId);
  });

  el.recurringList?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-commitment-repeat]");
    if (!select) return;
    const form = select.closest("form");
    const chips = form?.querySelector("[data-commitment-weekdays]");
    if (!chips) return;
    chips.hidden = select.value !== "weekly";
    if (select.value === "weekly" && !readWeekdays(chips).length) {
      seedWeekday(chips, toDateKey());
    }
  });

  el.recurringList?.addEventListener("submit", (event) => {
    const form = event.target.closest(".commitment-edit-form");
    if (!form) return;
    event.preventDefault();
    saveCommitmentRow(form);
  });

  el.recurringList?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.editingCommitmentId) return;
    event.preventDefault();
    state.editingCommitmentId = null;
    render();
  });

  try {
    const [tasks, commitments, subjects] = await Promise.all([
      getAllTasks(),
      getAllCommitments(),
      getSubjects()
    ]);
    state.tasks = tasks || [];
    state.commitments = commitments || [];
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
    if (el.quickWeekdays) el.quickWeekdays.innerHTML = weekdayChips([]);
    updateQuickRepeatUi();
    render();
  } catch {
    setStatus("Could not load tasks.", true);
  }
}
