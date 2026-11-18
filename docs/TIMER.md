# Timer — design note

**Status:** Implemented; real iPad/Safari acceptance is outstanding.
**Scope:** A dockable Pomodoro/countdown/stopwatch timer with a dedicated Timer tool.
**Created:** 2026-11-17

The timer exists to make bounded work the default. Unbounded study drifts;
a deadline creates urgency and intent. It is also allowed to be stressful, so
every automatic behaviour (sound, auto-starting breaks, hiding the sidebar) is
off until the user turns it on. A stopwatch is included for people who want
time awareness without a deadline.

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
| Tab title | `document.title` | Shows the remaining (or elapsed) time so the tab stays useful in the background. |

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
- Stopwatch time uses `elapsedMs` plus an absolute `startedAt` while running.
  `pagehide` pauses it, so a reload cannot claim the minutes a closed tab spent
  idle. It never reaches a "finished" state.

### Presets

| Preset | Focus | Short break | Long break | Cadence |
| --- | --- | --- | --- | --- |
| Pomodoro | 25 min | 5 min | 15 min | every 4th break |
| Deep work | 50 min | 10 min | 20 min | every 4th break |
| Custom | 1–240 min | — | — | countdown, restarts at the same length |
| Stopwatch | count up | — | — | no finish, no chime |

A finished focus phase offers a break; it does not start one. `autoStart`
(off by default) starts focus → break automatically, but never break → focus.
A finished break always waits for the user.

The custom preset accepts 1–240 minutes with quick chips 5/10/15/25/50.
Presets are locked while running or paused; Reset is the deliberate unlock.
A stopwatch block is logged when it is explicitly finished, cleared, or when
the preset changes. Reset discards it. Blocks under 60 seconds are ignored.

## 3. Storage

The timer is device UI state, not study data. It lives in `localStorage` and is
deliberately absent from IndexedDB, JSON exports and the schema version.

| Key | Contents |
| --- | --- |
| `nn-timer-v1` | Current timer state (preset, phase, `endAt`/`startedAt`, status, cycle count) |
| `nn-timer-history-v1` | `{ days: { "YYYY-MM-DD": { sessions, ms } } }` |
| `nn-timer-settings-v1` | `sound`, `corner`, `size`, `autoStart` |

Settings are preferences, so **Delete all data** clears the timer state and
history but keeps them, exactly like theme and appearance. Cross-tab changes are
picked up through the `storage` event; coming back to a visible tab calls
`store.sync()`.

## 4. Dock

- Shell-level element (`#timerDock`) so it survives tool switches.
- Default corner is top-left. Corners are `tl`, `tr`, `bl`, `br`; drag the grip
  to snap to the nearest corner, or focus the grip and use the arrow keys.
- The visible row is deliberately small: grip, phase/time, size cycle,
  start/pause/resume, and a `⋯` options button.
- **Dock size** cycles `compact → standard → large`. The choice is persisted in
  timer settings and applied from the dock or the menu. Large adds a second row
  of quick-length chips; compact hides the size button but the menu still
  offers every size.
- The **options menu** holds everything else: size, label, preset, custom
  minutes, quick lengths, auto-start, sound, sidebar mode, today's total,
  Finish stopwatch (when relevant), Reset, Open timer and Clear. It opens below
  a top-corner dock and above a bottom-corner dock so it stays on screen.
- Finishing fires a toast with the relevant next action (start break, start
  focus, or again for a countdown). The dock itself is not a modal.
- Finishing also pulses the neural background (`triggerRadialPulse` plus
  `triggerRandomNodes`) so completion feels organic. The pulse respects the
  neural-background off switch and `prefers-reduced-motion`.
- `Minimise` in the tool returns to the previous tool, falling back to the
  launchpad when there is none.

## 5. Timer tool

The tool is intentionally just the timer: ring, clock, phase, label, setup and
today's total. No task list, no statistics dashboard.

When a block starts, the setup, label field, tally row and hint fade and
collapse away; the ring and pause/reset controls settle into the centre. The
label stays visible under the clock while focused. Pausing keeps this focused
layout. Finishing (or resetting) transitions the setup back into place. The
rules are CSS-only and disabled under `prefers-reduced-motion`.

Keyboard (ignored while typing in a field or when a modifier is held):

- `Space` — start / pause / resume
- `R` — reset the current preset
- `Escape` — tuck away a revealed sidebar

### Sidebar layout

Hiding the sidebar is **opt-in** and remembered per device by
`src/sidebarMode.js`. It is a layout choice, not a focus mode: hiding
navigation does not make anyone concentrate. Four modes are available:

1. Full sidebar (default)
2. Compact sidebar
3. Hidden · reveal full from the left edge
4. Hidden · reveal compact from the left edge

The same select appears in the Timer tool header and in the dock's `⋯` menu;
the shell's collapse button flips between the full and compact member of the
current family. The setting is neutralised on mobile, where the sidebar is a
drawer anyway. Hover modes reveal on pointer entry and hide shortly after the
pointer leaves; the left-edge hotzone is the fallback. See
`docs/APPEARANCE.md` for the storage key and migration from
`nn-sidebar-collapsed` / the old timer `hideSidebar` flag.

## 6. Sound

Off by default. Enabling it primes the `AudioContext` inside the click gesture
and previews the chime, so later finishes are allowed to make noise. The chime
is a short three-note figure in `src/timerSound.js`; blocked audio never breaks
the timer. The stopwatch has no completion sound.

## 7. Accessibility

- The clock is a `role="timer"` that is not live-announced every second.
- Status changes and the finish toast use polite live regions.
- Dock buttons carry labels that state the action (`Start`, `Pause`, `Resume`).
- The grip is keyboard-operable, and every control has a visible focus target.
- The focus layout hides setup with `visibility: hidden`, not just opacity, so
  it leaves the tab order.

## 8. Tests

- `tests/timer.mjs` — engine and store: formatting, clamping, transitions,
  long-break cadence, hydration/credit-once, settling a pause at zero, history,
  stopwatch elapsed/pause/hydration/logging, dock sizes, settings, sidebar mode
  normalization/migration, and `clearData`.
- Browser suites cover the dock sizes and menu, sidebar modes and reveal,
  corner dragging, stopwatch, focus-layout transition, finish toasts, the
  neural pulse, auto-start, minimise/restore and the mobile layout.

## 9. Out of scope

- Task timers tied to a specific task, and per-subject timing statistics.
  Revisit only with a concrete use case.
- Notification API / service-worker alarms. The tab-title and toast are enough
  while the app is open; a closed-app notification needs backend work.
- Syncing timer state across devices. It is UI state by design.
