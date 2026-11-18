// tests/timer.mjs — timer state machine and persistence helpers.
// Pure functions only: no DOM, no localStorage, no ticking interval.
import {
  DEFAULT_TIMER_SETTINGS,
  TIMER_MAX_MINUTES,
  TIMER_PRESETS,
  TIMER_SIZES,
  configureTimerState,
  createTimerState,
  createTimerStore,
  dateKeyLocal,
  dismissTimerState,
  displayMsOf,
  elapsedOf,
  formatClock,
  formatDuration,
  hydrateTimerState,
  nextPhaseInfo,
  normalizeMinutes,
  normalizeTimerHistory,
  normalizeTimerSettings,
  pauseTimerState,
  presetById,
  progressOf,
  recordFocusTime,
  recordTimerSession,
  resetTimerState,
  startNextPhase,
  startTimerState,
  tickTimerState,
  todaySummary
} from "../src/timerEngine.js";
import {
  DEFAULT_SIDEBAR_MODE,
  SIDEBAR_VISIBILITIES,
  isCompactMode,
  isHoverMode,
  migrateSidebarMode,
  nextSidebarMode,
  normalizeSidebarMode,
  sidebarVisibilityMode,
  toggleCollapseMode
} from "../src/sidebarMode.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const start = 1_700_000_000_000;

// Complete a phase by starting it and ticking one millisecond past its end.
function finishPhase(state) {
  const running = startTimerState(state, start);
  return tickTimerState(running, running.endAt + 1).state;
}

export async function run() {
  // ---------- formatting ----------
  eq("clock: 25 minutes", formatClock(25 * 60 * 1000), "25:00");
  eq("clock: rounds partial seconds up", formatClock(61_001), "01:02");
  eq("clock: hours", formatClock(3_600_000), "1:00:00");
  eq("clock: zero", formatClock(0), "00:00");
  eq("clock: invalid input", formatClock(NaN), "00:00");
  eq("duration: minutes", formatDuration(50 * 60 * 1000), "50 min");
  eq("duration: mixed hours", formatDuration(80 * 60 * 1000), "1 hr 20 min");

  // ---------- minutes ----------
  eq("minutes: number", normalizeMinutes(25), 25);
  eq("minutes: string", normalizeMinutes("15"), 15);
  eq("minutes: zero clamps up", normalizeMinutes(0), 1);
  eq("minutes: over max clamps down", normalizeMinutes(999), TIMER_MAX_MINUTES);
  eq("minutes: fractional rounds", normalizeMinutes(7.6), 8);
  eq("minutes: blank is null", normalizeMinutes(""), null);
  eq("minutes: text is null", normalizeMinutes("soon"), null);
  check("minutes: max is four hours", TIMER_MAX_MINUTES === 240);

  // ---------- presets ----------
  eq("preset ids", TIMER_PRESETS.map((preset) => preset.id), ["pomodoro25", "deep50", "countdown", "stopwatch"]);
  eq("unknown preset falls back", presetById("nope").id, "pomodoro25");
  eq("dock sizes", TIMER_SIZES, ["compact", "standard", "large"]);

  // ---------- create / start / pause ----------
  let state = createTimerState({ label: "  Macbeth essay  " });
  eq("new timer is idle focus", [state.status, state.phase, state.mode], ["idle", "focus", "pomodoro"]);
  eq("new timer duration", state.durationMs, 25 * 60 * 1000);
  eq("label is trimmed", state.label, "Macbeth essay");

  const running = startTimerState(state, start);
  eq("start status", running.status, "running");
  eq("start endAt", running.endAt, start + 25 * 60 * 1000);

  const oneMinuteIn = tickTimerState(running, start + 60_000);
  check("tick is not finished", oneMinuteIn.finished === false);
  eq("tick remaining", oneMinuteIn.state.remainingMs, 24 * 60 * 1000);
  eq("progress after a minute", Math.round(progressOf(oneMinuteIn.state, start + 60_000) * 100), 4);

  const paused = pauseTimerState(oneMinuteIn.state, start + 90_000);
  eq("pause freezes remaining", paused.remainingMs, 24 * 60 * 1000 - 30_000);
  eq("pause clears endAt", paused.endAt, null);
  eq("paused timer no longer ticks", tickTimerState(paused, start + 999_999).finished, false);

  const resumed = startTimerState(paused, start + 100_000);
  eq("resume keeps remaining", resumed.endAt - (start + 100_000), paused.remainingMs);

  // ---------- finish ----------
  const finishedFocus = finishPhase(createTimerState());
  eq("finish status", finishedFocus.status, "finished");
  eq("finish zeroes remaining", finishedFocus.remainingMs, 0);
  eq("finish records the scheduled end", finishedFocus.finishedAt, start + 25 * 60 * 1000);
  eq("finish credits one round", finishedFocus.cycleCount, 1);
  eq("finished progress is full", progressOf(finishedFocus, start), 1);
  eq("idle progress is empty", progressOf(createTimerState(), start), 0);

  let plan = nextPhaseInfo(finishedFocus);
  eq("next phase after focus", [plan.phase, plan.label, plan.longBreak], ["break", "Break", false]);
  eq("short break duration", plan.durationMs, 5 * 60 * 1000);

  // ---------- pomodoro cadence ----------
  let cycle = createTimerState({ presetId: "deep50" });
  const seen = [];
  let longBreak = null;
  let nextRound = null;
  for (let round = 1; round <= 4; round += 1) {
    cycle = finishPhase(cycle);
    const info = nextPhaseInfo(cycle);
    seen.push(info.longBreak ? "long" : "short");
    cycle = startNextPhase(cycle, start); // enter the break
    if (round === 4) {
      longBreak = cycle;
      const afterLong = tickTimerState(longBreak, longBreak.endAt + 1).state;
      nextRound = startNextPhase(afterLong, start);
    } else {
      cycle = tickTimerState(cycle, cycle.endAt + 1).state; // finish the break
      eq(`round ${round} break credits a round`, cycle.cycleCount, round);
      cycle = startNextPhase(cycle, start); // enter the next focus
    }
  }
  eq("every fourth break is long", seen, ["short", "short", "short", "long"]);
  eq("long break uses preset duration", longBreak.durationMs, 20 * 60 * 1000);
  eq("long break resets the cycle", nextRound.cycleCount, 0);
  eq("next focus uses focus duration", nextRound.durationMs, 50 * 60 * 1000);

  // ---------- countdown ----------
  let countdown = createTimerState({ presetId: "countdown", minutes: 7 });
  eq("countdown mode", [countdown.mode, countdown.durationMs], ["countdown", 7 * 60 * 1000]);
  countdown = finishPhase(countdown);
  const again = nextPhaseInfo(countdown);
  eq("countdown restart label", again.label, "Again");
  eq("countdown restart keeps length", again.durationMs, 7 * 60 * 1000);
  const restarted = startNextPhase(countdown, start);
  eq("countdown restarts running", [restarted.status, restarted.endAt], ["running", start + 7 * 60 * 1000]);

  const reconfigured = configureTimerState(countdown, { presetId: "countdown", minutes: 12, label: "Past paper" });
  eq("custom minutes configure", [reconfigured.durationMs, reconfigured.label], [12 * 60 * 1000, "Past paper"]);
  eq("configure resets to idle", reconfigured.status, "idle");

  // ---------- stopwatch ----------
  let stopwatch = createTimerState({ presetId: "stopwatch", label: "Reading" });
  eq("stopwatch mode", [stopwatch.mode, stopwatch.durationMs, stopwatch.remainingMs], ["stopwatch", 0, 0]);
  eq("stopwatch label", stopwatch.label, "Reading");

  const swRunning = startTimerState(stopwatch, start);
  eq("stopwatch starts counting up", [swRunning.status, swRunning.startedAt, swRunning.endAt], ["running", start, null]);
  eq("stopwatch elapsed", elapsedOf(swRunning, start + 65_000), 65_000);
  eq("stopwatch display", displayMsOf(swRunning, start + 65_000), 65_000);
  check("stopwatch never auto-finishes", tickTimerState(swRunning, start + 3_600_000).finished === false);

  const swPaused = pauseTimerState(swRunning, start + 65_000);
  eq("stopwatch pause freezes elapsed", [swPaused.status, swPaused.elapsedMs, swPaused.startedAt], ["paused", 65_000, null]);
  eq("stopwatch stays frozen while paused", elapsedOf(swPaused, start + 500_000), 65_000);

  const swResumed = startTimerState(swPaused, start + 120_000);
  eq("stopwatch resume keeps earlier time", elapsedOf(swResumed, start + 125_000), 70_000);
  eq("stopwatch resume display", displayMsOf(swResumed, start + 125_000), 70_000);

  const swHydrated = hydrateTimerState(swResumed, start + 180_000);
  eq("stopwatch reload keeps elapsed", elapsedOf(swHydrated, start + 180_000), 125_000);
  eq("stopwatch hydrated is still running", swHydrated.status, "running");
  const swNoStart = hydrateTimerState({ ...swResumed, startedAt: null }, start + 180_000);
  eq("stopwatch without start becomes paused", swNoStart.status, "paused");
  const swFinishedRaw = hydrateTimerState({ ...swRunning, status: "finished" }, start + 180_000);
  eq("finished stopwatch hydrates as idle", swFinishedRaw.status, "idle");

  const swReset = resetTimerState(swResumed);
  eq("stopwatch reset clears time", [swReset.status, swReset.elapsedMs, swReset.startedAt], ["idle", 0, null]);
  const swDismissed = dismissTimerState({ ...swResumed, label: "Reading" });
  eq("stopwatch dismiss clears time and label", [swDismissed.status, swDismissed.elapsedMs, swDismissed.label], ["idle", 0, ""]);

  // ---------- stopwatch logging ----------
  const stopwatchDay = new Date(2026, 10, 18, 9, 0, 0).getTime();
  let swHistory = normalizeTimerHistory(null);
  swHistory = recordFocusTime(swHistory, 59_000, stopwatchDay);
  eq("sub-minute stopwatch blocks are ignored", swHistory.days, {});
  swHistory = recordFocusTime(swHistory, 90_000, stopwatchDay);
  eq("stopwatch blocks log as a session", swHistory.days[dateKeyLocal(stopwatchDay)], { sessions: 1, ms: 90_000 });

  // ---------- reset / dismiss ----------
  const reset = resetTimerState({ ...running, cycleCount: 3, phase: "break", label: "x" });
  eq("reset is idle focus", [reset.status, reset.phase], ["idle", "focus"]);
  eq("reset drops cycle progress", reset.cycleCount, 0);
  eq("reset keeps label", reset.label, "x");

  const dismissed = dismissTimerState({ ...running, cycleCount: 2, label: "x" });
  eq("dismiss is idle", dismissed.status, "idle");
  eq("dismiss clears label", dismissed.label, "");
  eq("dismiss keeps the chosen length", dismissed.durationMs, running.durationMs);

  // ---------- hydration ----------
  const saved = startTimerState(createTimerState(), start);
  const missed = hydrateTimerState(saved, start + 30 * 60 * 1000);
  eq("closed tab resolves to finished", missed.status, "finished");
  eq("closed tab credits the round once", missed.cycleCount, 1);
  const hydratedAgain = hydrateTimerState(missed, start + 90 * 60 * 1000);
  eq("finished state is not credited twice", hydratedAgain.cycleCount, 1);

  const broken = hydrateTimerState({ ...saved, endAt: null }, start);
  eq("running without endAt becomes paused", broken.status, "paused");
  const junk = hydrateTimerState({ status: "nonsense", presetId: "nope" }, start);
  eq("junk state falls back to idle", [junk.status, junk.presetId], ["idle", "pomodoro25"]);
  check("null hydration is rejected", hydrateTimerState(null, start) === null);

  // ---------- history ----------
  const day = new Date(2026, 10, 17, 12, 0, 0).getTime();
  const focusFinish = { ...finishedFocus, finishedAt: day };
  let history = normalizeTimerHistory(null);
  history = recordTimerSession(history, focusFinish);
  const breakFinish = { ...finishedFocus, phase: "break", finishedAt: day };
  history = recordTimerSession(history, breakFinish);
  eq("only focus sessions are recorded", history.days[dateKeyLocal(day)].sessions, 1);
  eq("recorded minutes", history.days[dateKeyLocal(day)].ms, 25 * 60 * 1000);
  eq("today summary", todaySummary(history, day), { sessions: 1, ms: 25 * 60 * 1000 });
  eq("empty day summary", todaySummary(history, day + 86_400_000), { sessions: 0, ms: 0 });
  eq("history rejects bad rows", normalizeTimerHistory({ days: { nope: { sessions: 4 } } }).days, {});

  // ---------- settings ----------
  eq("default settings are quiet and neutral", normalizeTimerSettings(null), DEFAULT_TIMER_SETTINGS);
  eq("settings ignore junk numbers", normalizeTimerSettings({ corner: "sideways", sound: "yes" }).corner, "tl");
  eq("settings accept a known corner", normalizeTimerSettings({ corner: "br", sound: true }).corner, "br");
  eq("settings default to standard size", normalizeTimerSettings({}).size, "standard");
  eq("settings accept a known size", normalizeTimerSettings({ size: "large" }).size, "large");
  eq("settings reject an unknown size", normalizeTimerSettings({ size: "huge" }).size, "standard");

  // ---------- sidebar modes ----------
  eq("sidebar defaults to full", normalizeSidebarMode(null), DEFAULT_SIDEBAR_MODE);
  eq("sidebar rejects junk", normalizeSidebarMode("floating"), "full");
  check("hover modes are detected", isHoverMode("hover-compact") && !isHoverMode("compact"));
  check("compact modes are detected", isCompactMode("compact") && isCompactMode("hover-compact") && !isCompactMode("full"));
  eq("collapse toggles the compact rail", toggleCollapseMode("full"), "compact");
  eq("collapse restores the full panel", toggleCollapseMode("hover-compact"), "hover-full");
  eq("sidebar modes cycle", [nextSidebarMode("full"), nextSidebarMode("compact"), nextSidebarMode("hover-full"), nextSidebarMode("hover-compact")],
    ["compact", "hover-full", "hover-compact", "full"]);
  eq("migration keeps an explicit mode", migrateSidebarMode({ stored: "hover-compact", legacyCollapsed: "1" }).mode, "hover-compact");
  eq("migration turns the old collapse into compact", migrateSidebarMode({ legacyCollapsed: "1" }).mode, "compact");
  eq("migration turns the old hidden sidebar into hover-full", migrateSidebarMode({ timerSettings: { hideSidebar: true } }).mode, "hover-full");
  eq("migration combines hidden and collapsed", migrateSidebarMode({ legacyCollapsed: "1", timerSettings: { hideSidebar: true } }).mode, "hover-compact");
  eq("migration defaults to full", migrateSidebarMode({}).mode, "full");
  eq("panel asks one question", SIDEBAR_VISIBILITIES.map((item) => item.id), ["shown", "hidden"]);
  eq("showing keeps the rail width", [sidebarVisibilityMode("full", true), sidebarVisibilityMode("compact", true)], ["full", "compact"]);
  eq("hiding keeps the rail width", [sidebarVisibilityMode("full", false), sidebarVisibilityMode("compact", false)], ["hover-full", "hover-compact"]);
  eq("visible again drops the hover prefix", [sidebarVisibilityMode("hover-full", true), sidebarVisibilityMode("hover-compact", true)], ["full", "compact"]);

  // ---------- store ----------
  const memoryStorage = () => {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear()
    };
  };

  let clock = start;
  const storage = memoryStorage();
  const store = createTimerStore({ storage, now: () => clock, tickMs: 10_000 });
  const events = [];
  store.subscribe((state, meta) => events.push(meta.type));
  store.start();
  clock = start + 25 * 60 * 1000;
  store.pause();
  eq("pause at the end still settles the session", store.getState().status, "finished");
  eq("pause at the end credits the session once", store.today(), { sessions: 1, ms: 25 * 60 * 1000 });
  check("pause at the end emits a finish event", events.includes("finish"));
  store.pause();
  eq("pausing a finished timer does not credit again", store.today().sessions, 1);
  store.dispose();

  clock = start;
  const autoStore = createTimerStore({ storage: memoryStorage(), now: () => clock, tickMs: 10_000 });
  autoStore.updateSettings({ autoStart: true });
  autoStore.start();
  clock = start + 25 * 60 * 1000;
  autoStore.pause();
  check("auto-start begins the break on a settling pause", (() => {
    const state = autoStore.getState();
    return state.status === "running" && state.phase === "break" && state.durationMs === 5 * 60 * 1000;
  })());
  autoStore.clearData();
  eq("clearData resets the timer", autoStore.getState().status, "idle");
  eq("clearData empties history", autoStore.today(), { sessions: 0, ms: 0 });
  eq("clearData keeps device preferences", autoStore.getSettings().autoStart, true);
  autoStore.dispose();

  clock = start;
  const swStore = createTimerStore({ storage: memoryStorage(), now: () => clock, tickMs: 10_000 });
  swStore.updateSettings({ size: "large" });
  swStore.configure({ presetId: "stopwatch", label: "Reading" });
  swStore.start();
  clock = start + 90_000;
  eq("store stopwatch display counts up", displayMsOf(swStore.getState(), clock), 90_000);
  eq("finishStopwatch returns the block", swStore.finishStopwatch(), 90_000);
  eq("finishStopwatch logs the block", swStore.today(), { sessions: 1, ms: 90_000 });
  eq("finishStopwatch resets the timer", swStore.getState().status, "idle");

  swStore.configure({ presetId: "stopwatch" });
  swStore.start();
  clock += 30_000;
  eq("short stopwatch finish returns zero", swStore.finishStopwatch(), 0);
  eq("short stopwatch is not logged", swStore.today(), { sessions: 1, ms: 90_000 });
  eq("short stopwatch still resets", swStore.getState().status, "idle");

  swStore.configure({ presetId: "stopwatch" });
  swStore.start();
  clock += 70_000;
  swStore.configure({ presetId: "pomodoro25" });
  eq("switching preset logs the stopwatch", swStore.today(), { sessions: 2, ms: 160_000 });
  eq("switching preset returns to pomodoro", swStore.getState().mode, "pomodoro");

  swStore.configure({ presetId: "stopwatch" });
  swStore.start();
  clock += 65_000;
  swStore.dismiss();
  eq("clearing a stopwatch logs the block", swStore.today(), { sessions: 3, ms: 225_000 });
  swStore.clearData();
  eq("clearData keeps the dock size", swStore.getSettings().size, "large");
  swStore.dispose();

  return { passed, failed };
}
