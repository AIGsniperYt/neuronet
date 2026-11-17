// tests/timer.mjs — timer state machine and persistence helpers.
// Pure functions only: no DOM, no localStorage, no ticking interval.
import {
  DEFAULT_TIMER_SETTINGS,
  TIMER_MAX_MINUTES,
  TIMER_PRESETS,
  configureTimerState,
  createTimerState,
  createTimerStore,
  dateKeyLocal,
  dismissTimerState,
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
  recordTimerSession,
  resetTimerState,
  startNextPhase,
  startTimerState,
  tickTimerState,
  todaySummary
} from "../src/timerEngine.js";

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
  eq("preset ids", TIMER_PRESETS.map((preset) => preset.id), ["pomodoro25", "deep50", "countdown"]);
  eq("unknown preset falls back", presetById("nope").id, "pomodoro25");

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

  return { passed, failed };
}
