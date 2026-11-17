# Timer — design note

**Status:** Implemented; real iPad/Safari acceptance is outstanding.
**Scope:** A dockable Pomodoro/countdown timer with a dedicated Timer tool.
**Created:** 2026-11-17

The timer exists to make bounded work the default. Unbounded study drifts;
a deadline creates urgency and intent. It is also allowed to be stressful, so
every automatic behaviour (sound, auto-starting breaks, hiding the sidebar) is
off until the user turns it on.

This is deliberately **not** a planner. Recurring commitments and tasks stay in
the todo system, days are the unit of planning, and nothing here stores a time
slot. The timer only measures a session the user is already doing.

---

## 1. Three views, one engine

There is exactly one timer. It is never duplicated per view.

| View | Where | Purpose |
| --- | --- | --- |
| Global dock | Shell, outside `#toolContainer` | Survives tool switches. Hidden while idle and while the Timer tool is open. |
| Timer tool | `tools/timer.html` | The full-screen timer: ring, presets, label, today's count. |
| Tab title | `document.title` | Shows the remaining time so the tab stays useful when the app is in the background. |

`src/timerEngine.js` owns the state machine, persistence and subscribers.
Views only render what the store gives them. The engine is pure enough to test
without a DOM (`tests/timer.mjs`).

## 2. Time model

- Every run resolves from an absolute `endAt` timestamp. Reload, sleep, tab
  close and clock drift cannot accumulate error.
- A timer that finishes while the app is closed is credited **once** when the
  store hydrates. A finished state is never credited twice.
- `remainingMs` is the source of truth while paused; `endAt` is the source of
  truth while running. Progress is derived, never stored.
- Focus sessions are recorded in `nn-timer-history-v1` by local date (60 days
  retained). Breaks are not sessions.

### Presets

| Preset | Focus | Short break | Long break | Cadence |
| --- | --- | --- | --- | --- |
| Pomodoro | 25 min | 5 min | 15 min | every 4th break |
| Deep work | 50 min | 10 min | 20 min | every 4th break |
| Custom | 1–240 min | — | — | countdown, restarts at the same length |

A finished focus phase offers a break; it does not start one. `autoStart`
(off by default) starts focus → break automatically, but never break → focus.
A finished break always waits for the user.

The custom preset accepts 1–240 minutes with quick chips 5/10/15/25/50.
Presets are locked while running; pause to change the setup.

## 3. Storage

The timer is device UI state, not study data. It lives in `localStorage` and is
deliberately absent from IndexedDB, JSON exports and the schema version.

| Key | Contents |
| --- | --- |
| `nn-timer-v1` | Current timer state (preset, phase, `endAt`, status, cycle count) |
| `nn-timer-history-v1` | `{ days: { "YYYY-MM-DD": { sessions, ms } } }` |
| `nn-timer-settings-v1` | `sound`, `corner`, `hideSidebar`, `autoStart` |

Settings are preferences, so **Delete all data** clears the timer state and
history but keeps them, exactly like theme and appearance. Cross-tab changes are
picked up through the `storage` event; coming back to a visible tab calls
`store.sync()`.

## 4. Dock

- Shell-level element (`#timerDock`) so it survives tool switches.
- Default corner is top-left. Corners are `tl`, `tr`, `bl`, `br`; drag the grip
  to snap to the nearest corner, or focus the grip and use the arrow keys.
- Shows phase, remaining time, progress bar, start/pause/resume, open and clear.
- Finishing fires a toast with the relevant next action (start break, start
  focus, or again for a countdown). The dock itself is not a modal.
- `Minimise` in the tool returns to the previous tool, falling back to the
  launchpad when there is none.

## 5. Timer tool

The tool is intentionally just the timer: ring, clock, phase, label, setup and
today's total. No task list, no statistics dashboard.

Keyboard (ignored while typing in a field or when a modifier is held):

- `Space` — start / pause / resume
- `R` — reset the current preset
- `Escape` — tuck away a revealed sidebar

### Optional off-canvas sidebar

Hiding the sidebar is **opt-in** and remembered per device. It is a layout
choice, not a focus mode: hiding navigation does not make anyone concentrate.
Left-edge hotzone reveals the panel; it hides shortly after the pointer leaves.
The setting is neutralised on mobile, where the sidebar is a drawer anyway, and
is turned off automatically when another tool loads.

## 6. Sound

Off by default. Enabling it primes the `AudioContext` inside the click gesture
and previews the chime, so later finishes are allowed to make noise. The chime
is a short three-note figure in `src/timerSound.js`; blocked audio never breaks
the timer.

## 7. Accessibility

- The clock is a `role="timer"` that is not live-announced every second.
- Status changes and the finish toast use polite live regions.
- Dock buttons carry labels that state the action (`Start`, `Pause`, `Resume`).
- The grip is keyboard-operable, and every control has a visible focus target.

## 8. Tests

- `tests/timer.mjs` — engine and store: formatting, clamping, transitions,
  long-break cadence, hydration/credit-once, settling a pause at zero, history,
  settings and `clearData`.
- Browser suites cover the dock, minimise/restore, corner dragging, sidebar
  reveal, finish toasts, auto-start, immersive cleanup on tool switch, and the
  mobile layout.

## 9. Out of scope

- Stopwatch mode, task timers tied to a specific task, and per-subject timing
  statistics. Revisit only with a concrete use case.
- Notification API / service-worker alarms. The tab-title and toast are enough
  while the app is open; a closed-app notification needs backend work.
- Syncing timer state across devices. It is UI state by design.
