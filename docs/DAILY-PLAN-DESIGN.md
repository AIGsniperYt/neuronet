# Daily plan and recurring commitments — design note

**Status:** Implemented. Slices 1–5 are complete (store/schema, pure models,
Tasks UI, launchpad Today panel, and auto-credit); only the real iPad/Safari
acceptance pass is outstanding.
**Scope:** Recurring commitments plus a task-first "Today" plan on the launchpad.
**Created:** 2026-11-12

The goal is a loop that is easy to trust:

> Log on → follow the plan → study → leave knowing you did the minimum that
> matters today.

This is deliberately **not** a calendar or time-slot planner. Days are the unit.
Tasks and commitments have due dates and weekday rules, never appointment times.
Minutes are a forecast, never a schedule.

---

## 1. Product shape

Three layers, only two of which the user manages:

1. **Tasks** — one-off things with an optional due date. Already shipped.
2. **Commitments** — recurring habits and responsibilities.
3. **Today** — a derived plan that combines due reviews, today's commitments,
   and tasks due today. The user does not maintain this list by hand.

The launchpad carries the daily plan. The Tasks tool owns creating and managing
both one-off tasks and recurring commitments. Two records, one surface.

### The promise of "done"

**Required for today**

- Due flashcard reviews and due analysis nodes (SRS work).
- Commitments scheduled for today.
- One-off tasks whose due date is today.

**Bonus, not required**

- Overdue tasks, oldest first.
- Optional head starts on upcoming work when today is otherwise clear.

**Done for today = Required is empty.** Not inbox zero. Overdue work does not
silently roll into Required, because that turns one missed day into an infinite
minimum. It stays visible in Tasks and as optional bonus work.

No automatic due-date rewriting. If the user wants to move an overdue task, the
UI offers "Move to today" or "Let it go"; it never does either silently.

---

## 2. Data model

### One-off tasks stay as they are

```js
{
  id, type: "task",
  title, notes, subject, subjectId,
  dueDate: "2026-11-14",       // local YYYY-MM-DD, or ""
  done: false, completedAt: null,
  source: "local" | "classroom",
  createdAt, updatedAt
}
```

### Commitments get their own store

A commitment is not a task with a repeat flag. It has a different lifecycle:
there is no single `done` state and no single due date. Keeping it separate
avoids overloading every task helper with a `kind` branch.

New IndexedDB store: `commitments`, key path `id`.

```js
{
  id, type: "commitment",
  title: "Biology revision",
  notes: "",
  subject: "Biology", subjectId: "subj_...",
  recurrence: {
    frequency: "weekly",       // "daily" | "weekly"
    weekdays: [1, 3, 5],       // 0 = Sunday; stored in JS getDay() order
    startDate: "2026-11-12",   // inclusive
    endDate: "2027-06-01"      // inclusive, or "" for open-ended
  },
  completions: {
    "2026-11-12": { completedAt: 1762..., via: "manual" | "memory" },
    "2026-11-10": { skipped: true, at: 1762... }
  },
  archivedAt: null,
  createdAt, updatedAt
}
```

Design history: the first draft embedded recurrence in the task record partly to
avoid a schema bump. That constraint is gone. A separate store is cleaner:
`done`/`dueDate` keep their single meaning, generic task code cannot accidentally
rewrite commitment history, and the planner merges two explicit sources instead
of guessing what a record is.

Still deliberately **no occurrence records**:

- Today's occurrence is derived from the rule.
- There is no daily generation step and no duplicate rows.
- The completion map is both the history and the adherence log.
- Editing a commitment edits one record, not a series of copies.
- Missing days are simply absent from the map; they do not become overdue tasks.

### Completion semantics

- **Complete** — `completions[todayKey] = { completedAt, via }`.
- **Skip** — `completions[todayKey] = { skipped: true, at }`. Hides the item for
  that day; reported separately from completed in stats.
- **Undo** — delete the date key; the occurrence reopens.
- **Archive** — `archivedAt` stops future occurrences while keeping history.
  Preferred over delete in the UI.
- **Delete** — removes the commitment and its history. Confirm first.

### Recurrence rules (v1)

- `daily` — every day between `startDate` and `endDate`.
- `weekly` — on the selected weekdays.
- Start and end dates are inclusive date-only keys.
- An empty `endDate` means open-ended.
- A commitment can be paused (`archivedAt`) without losing history.
- Weekdays are stored `0 = Sunday … 6 = Saturday`; the UI displays Monday
  first. This must be tested explicitly.

Deferred: N-times-per-week quotas, monthly rules, every-N-days rules,
exceptions, and auto-generated subject habits. These are phase 2.

### Date handling

All plan logic uses the existing `toDateKey()` local-day helper. Do **not** use
`new Date().toISOString().slice(0, 10)`.

Two existing helpers currently use the UTC slice for activity/streak dates
(`logActivity()` and `renderStudyStreak()` in `src/main.js`). That is a latent
near-midnight bug and should be fixed as part of this work so the Today panel
and the streak agree on what "today" is.

### Data and migration policy

There is one user and no compatibility promise. Do not write migration shims.

- Bump `SCHEMA_VERSION` from 8 to 9 and add `commitments` to `COLLECTIONS`.
- Bump `DB_VERSION` from 13 to 14 and create the `commitments` store.
- Hand-edit `demo-data.json`: set `schemaVersion: 9`, add a `commitments` array,
  and seed one or two realistic examples.
- Update export/import to include `commitments` and to clear it before restore.
- Old exports are rejected by the existing `assertCurrentDataset` guard. That is
  the intended behaviour; do not add a migration path.
- Keep `APP_VERSION` at `v10` so the current local database upgrades in place.
  Bumping it would rename the IndexedDB database and start again from demo data.
  Say the word if a clean reset is preferred instead.
- Update the demo fixture tests and the import/export round-trip tests.

---

## 3. Planner

### Inputs

- All one-off tasks from `getAllTasks()`.
- All commitments from `getAllCommitments()`.
- Due card counts and due analysis-node counts per subject, using the same
  lookups as the current launchpad "Due for Review" panel.
- The ETA calibration history for an approximate review duration.
- `todayKey` from `toDateKey()`.
- Optional local skip/defer state for the day.

### Output

```js
{
  todayKey,
  required: {
    reviews: [{
      subject, subjectId, cards, nodes, estimatedMs
    }],
    commitments: [{
      commitment, estimatedMs: null
    }],
    tasksDueToday: [task]
  },
  bonus: {
    overdue: [task],
    upcoming: [task]
  },
  counts: { required, completed, remaining },
  estimatedReviewMs,
  isMinimumDone,
  isOverloaded,          // true when reviews alone exceed a soft threshold
  generatedAt
}
```

The output is derived, not stored. There is no plan record in the database and
no second source of truth. A tiny local-only latch may be added later if the day
re-opening after completion feels wrong; v1 can recompute live.

### Ordering

1. **Reviews** — they decay, so they come first. One row per subject, or one
   grouped row when there are several small subjects; the UI can decide.
2. **Today's commitments** — by subject, then title.
3. **Tasks due today** — by creation order, then title.
4. **Bonus** — overdue oldest first, then a small number of upcoming items.

The ordering is fixed and explainable. Every row states why it exists:
"Due today", "Repeats Mon/Wed/Fri", "24 cards due".

### Time estimates

Reuse the existing calibration records (`neuronet:memoryEtaSessions`, last 12
sessions). Add a small pure helper in `sessionEta.js`:

```js
estimateCardsMs({ cards, records, priorMs })
```

It takes the median of `actualMs / graded` from valid records, falls back to
`ETA_DEFAULT_PRIOR_MS`, and returns a rounded total. Do not show minutes when
the sample is too thin or the count is tiny; show "24 cards" instead.

Tasks and commitments have no invented minute estimates in v1. If later useful,
add an optional `estimateMin` field; it is still not a time slot.

### What the planner must never do

- Write to SRS state, intervals, card grades, or memory metadata.
- Change due dates or completion state on its own.
- Hide required work to make the day look smaller.
- Present a red "overdue" pile as part of today's minimum.

These are non-negotiable. Any SRS algorithm change needs its own proposal and
approval.

### Overload

If reviews alone exceed a soft threshold (proposed: ~45 minutes), show a calm
warning:

> That's a big review day — about 55 min. Start with the reviews; the rest can
> keep.

Do not silently trim. If the user wants a lighter day, they can explicitly
defer reviews or trim a commitment; the system records that choice rather than
pretending it did not happen.

### Defer and skip

- A commitment row offers "Skip today". It writes `{ skipped: true }` for the
  date and removes the row from Required.
- A review row offers "Not today" only behind a deliberate action, and records
  a local deferral for the date. This avoids trapping the user on a huge
  backlog while keeping the choice honest.
- Skipped/deferred items remain visible in the relevant history/stat view.
  Today does not nag about them.

---

## 4. UX

### Launchpad: merge the streak panel into Today

The current Study Streak panel is the launchpad's greeting. Replace it with a
single **Today** panel that keeps the streak as a sub-line. This avoids stacking
two competing cards at the top of the page.

```
TODAY · Thu 12 Nov                          [streak dots / 6-day streak]

3 things · 24 cards · ~14 min

○ Memory review        24 cards across 3 subjects · ~9 min      [Start]
○ Biology revision     Repeats Mon/Wed/Fri                      [Done]
○ Essay draft          Due today                                [Done]

This is the minimum. Anything else is a bonus.
▸ 2 overdue tasks
```

States:

1. **Active** — required rows, one clear starting point.
2. **Clear** — "Minimum done ✓ You're clear for today." + streak + collapsed
   bonus.
3. **Nothing required** — "Nothing required today." + "Set a weekly revision
   habit" / "Add a task".
4. **After a break** — no guilt copy, no avalanche. Reviews are shown honestly
   with an estimate; commitments are only today's.

The primary action opens the relevant tool directly. No modal takeover on
login; the panel is prominent enough.

Mobile: the panel stacks normally. All action targets are at least 44 px. The
panel must not depend on absolute positioning.

### Tasks tool

The tool becomes two sections sharing one page:

- **Tasks** — the existing one-off list.
- **Recurring commitments** — the new habits/responsibilities.

Quick add and edit gain a **Repeats** control:

- Never
- Daily
- Weekly + weekday chips (Mon–Sun)
- Optional "until" date

When a repeat is selected, the form routes to `addCommitment()` instead of
`addTask()` and hides/disables the due-date field: a commitment has a schedule,
not a single deadline. The user should not need to know there are two stores.

The Recurring section lists commitments with:

- cadence and next scheduled day
- recent adherence (e.g. "5 of 7 this week", "last done Tue")
- edit, pause/archive, delete

Combined Today view:

- A commitment due today renders in **Today** with a repeat icon.
- A commitment completed today renders in **Done** for that day only, with the
  same icon.
- A commitment not due today does not appear in the normal buckets; it lives in
  the Recurring section.
- Archived commitments never appear in Today or the normal buckets.
- `countOpenTasks()` stays task-only; the Tasks page meta count adds today's
  unfinished commitments explicitly. Do not count one per future day.

This keeps the list honest without flooding Done with a daily habit.

### Auto-credit

When a Memory session crosses the credit threshold (or exhausts its first pass), the Memory tool emits a lightweight event once for that session:

```js
window.dispatchEvent(new CustomEvent("neuronet:study-complete", {
  detail: { subject, subjectId, graded, firstPassComplete }
}));
```

The launchpad listens and credits a matching commitment for today only if:

- it is scheduled today and not archived,
- it targets the same subject (or has no subject restriction),
- it is not already completed or skipped today,
- `firstPassComplete` is true **or** at least 5 cards were graded.

Credit sets `completions[todayKey] = { completedAt, via: "memory" }` and shows a
toast: "“Biology recall” done — credited from study." with an Undo action. Undo
only removes a credit that is still tagged `via: "memory"`. The done row stays
on Today for the rest of the day with its own durable Undo.

This is an observer only. It does not alter the session, the queue, grading,
`responseTimeMs`, or SRS state. A manual check-off always remains available.

### Copy and tone

- "Minimum today", not "To-do".
- "Clear for today", not "All done" or "You're behind".
- "Anything else is a bonus."
- Missed commitments are shown only inside the recurring item's stats, never as
  red failures on the launchpad.

---

## 5. Edge cases

- **Midnight rollover** — recompute `todayKey` on `visibilitychange` and when
  the launchpad is re-shown. Do not cache a date key for the lifetime of the
  page.
- **Start/end dates** — inclusive; a commitment starting today is due today. A
  commitment ending yesterday disappears from Today but keeps history.
- **Weekday mapping** — 0 = Sunday everywhere internally; UI order is Monday
  first. Test Sunday and Monday explicitly.
- **Editing a commitment** — affects today onward. Past completions stay as
  recorded. Changing the subject does not retroactively re-credit anything.
- **Archiving** — removes from Today/upcoming immediately; history remains.
- **Deleting** — confirm; history is lost. Prefer archive in the UI.
- **Skip then complete** — completing overwrites the skip entry for that date.
- **Undo completion** — deleting the date key reopens the occurrence.
- **Multiple tabs** — last write wins per date key; no generated records means
  no duplicate occurrences.
- **Export/import** — the payload gains a `commitments` array; export includes
  it, import clears and restores it. Round-trip must be tested.
- **Demo mode** — seed one or two example commitments in `demo-data.json` so the
  feature is discoverable, and update the demo fixture tests.
- **Database upgrade** — `DB_VERSION` 14 creates the store. Existing tasks,
  cards and subjects are untouched.
- **No tasks and no reviews** — the empty state must not look broken; offer the
  habit setup.

---

## 6. Test plan

Pure-model tests:

- New `tests/commitments.mjs`:
  - `occursOn()` for daily and weekly rules.
  - Weekday mapping: Sunday, Monday, Saturday; Monday-first UI order.
  - Start/end date inclusivity.
  - Month boundary, leap day, DST transition.
  - Complete, uncomplete, skip, complete after skip.
  - Archive behaviour and adherence counts.
  - Next-scheduled-date formatting.
- New `tests/plan.mjs`:
  - Required vs bonus sets; done state; overload flag.
  - Ordering and stable output.
  - Auto-credit matching by subject/subjectId and the graded threshold.
  - Planner never mutates SRS-looking fields.
- Schema/import tests:
  - `SCHEMA_VERSION` is 9 and `commitments` is a required collection.
  - Old schema 8 exports are rejected.
  - Export/import round-trip preserves recurrence and completions.
- Date regression:
  - Near-midnight local time must not use UTC's day.
- Existing `tests/tasks.mjs` stays valid for one-off tasks.

Existing suites must stay green: unit, demo fixture, e2e tracker.

Manual acceptance:

1. Create a Mon/Wed/Fri commitment; verify it appears only on those days.
2. Complete it manually; verify Today clears it and Done shows it for the day.
3. Study the matching subject in Memory; verify auto-credit and toast.
4. Add a task due today and one overdue task; verify only the due-today task is
   Required and the overdue one is Bonus.
5. Reach the clear state; verify the copy and that the bonus section stays
   available.
6. Reload, export, re-import, and reload again; verify the commitment and
   history survive.
7. Check on a narrow mobile viewport and on the iPad/Safari pass.

---

## 7. Implementation slices

1. **Store and schema** — add the `commitments` store and CRUD in `db.js`;
   bump `DB_VERSION` to 14; bump `SCHEMA_VERSION` to 9; add `commitments` to
   `COLLECTIONS`; wire export/import; hand-migrate `demo-data.json`; update
   tests.
2. **Pure models** — new `commitmentsModel.js` for cadence/occurrence/stats;
   new `planModel.js` for the daily plan; `estimateCardsMs()` in
   `sessionEta.js`; tests.
3. **Tasks UI** — repeat controls, Recurring section, combined Today/Done view,
   skip/undo, meta counts, archive.
4. **Launchpad** — Today panel, states, deep links, bonus section, merge the
   streak display, fix local date keys.
5. **Auto-credit** — study-complete event, subject matching, toast, undo.
6. **Polish** — demo seed, empty states, docs, mobile/iPad check.

No new dependencies. No SRS algorithm change. No `APP_VERSION` bump. We do bump
the schema and database versions and deprecate old exports rather than carrying
compatibility code.

---

## 8. Open details for the build

These do not block approval; they can be settled during implementation:

- Exact soft threshold for the overload warning (proposed 45 min).
- Whether the review row is one grouped row or one per subject.
- Auto-credit threshold (proposed: first pass complete, or 5 graded cards).
- Whether to add the local "day already cleared" latch in v1 or wait for real
  use.
- Whether skipped days are labelled "skipped" or simply absent in the adherence
  summary (proposed: tracked separately, never shown as a failure).
