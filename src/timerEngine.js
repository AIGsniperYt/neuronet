// Timer engine: one state machine shared by the shell dock and the Timer tool.
// Pure transition helpers live here so they can be tested without a DOM. The
// store persists to localStorage because a timer is device UI state, not study
// data: it is deliberately absent from JSON exports and IndexedDB.

export const TIMER_STATE_KEY = "nn-timer-v1";
export const TIMER_SETTINGS_KEY = "nn-timer-settings-v1";
export const TIMER_HISTORY_KEY = "nn-timer-history-v1";

export const TIMER_MAX_MINUTES = 240;
const TIMER_MAX_MS = TIMER_MAX_MINUTES * 60 * 1000;
const HISTORY_DAYS = 60;

export const TIMER_PRESETS = [
  {
    id: "pomodoro25",
    name: "Pomodoro",
    mode: "pomodoro",
    focusMs: 25 * 60 * 1000,
    breakMs: 5 * 60 * 1000,
    longBreakMs: 15 * 60 * 1000,
    rounds: 4,
    hint: "25 / 5"
  },
  {
    id: "deep50",
    name: "Deep work",
    mode: "pomodoro",
    focusMs: 50 * 60 * 1000,
    breakMs: 10 * 60 * 1000,
    longBreakMs: 20 * 60 * 1000,
    rounds: 4,
    hint: "50 / 10"
  },
  {
    id: "countdown",
    name: "Custom",
    mode: "countdown",
    focusMs: 25 * 60 * 1000,
    breakMs: 0,
    longBreakMs: 0,
    rounds: 0,
    hint: "any length"
  }
];

export const DEFAULT_TIMER_SETTINGS = Object.freeze({
  sound: false,       // off until the user turns it on
  corner: "tl",       // tl | tr | bl | br
  hideSidebar: false, // opt-in only
  autoStart: false    // focus -> break still needs a deliberate start
});

export function presetById(id) {
  return TIMER_PRESETS.find((preset) => preset.id === id) || TIMER_PRESETS[0];
}

export function formatClock(input) {
  const ms = Number.isFinite(input) ? Math.max(0, input) : 0;
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function normalizeMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return null;
  return Math.min(TIMER_MAX_MINUTES, Math.max(1, Math.round(minutes)));
}

export function formatDuration(ms) {
  const totalMinutes = Math.round(Math.max(0, ms) / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

// Shared labels keep the dock, the tool and toasts from drifting apart.
export function timerPhaseLabel(state) {
  if (state.status === "finished") return "Time's up";
  if (state.mode === "countdown") return "Countdown";
  return state.phase === "break" ? (state.breakLong ? "Long break" : "Break") : "Focus";
}

export function timerPrimaryLabel(state) {
  if (state.status === "running") return "Pause";
  if (state.status === "paused") return "Resume";
  if (state.status === "finished") {
    const info = nextPhaseInfo(state);
    if (!info) return "Start";
    if (info.phase === "break") return info.longBreak ? "Start long break" : "Start break";
    return info.label === "Again" ? "Start again" : "Start focus";
  }
  if (state.mode === "countdown") return "Start";
  return state.phase === "break" ? "Start break" : "Start focus";
}

function cleanLabel(label) {
  return typeof label === "string" ? label.trim().slice(0, 80) : "";
}

function clampMs(value, fallback) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(TIMER_MAX_MS, Math.max(1000, Math.round(ms)));
}

export function createTimerState({ presetId = "pomodoro25", minutes = null, label = "" } = {}) {
  const preset = presetById(presetId);
  const durationMs = preset.mode === "countdown"
    ? (normalizeMinutes(minutes) || 25) * 60 * 1000
    : preset.focusMs;
  return {
    version: 1,
    presetId: preset.id,
    mode: preset.mode,
    phase: "focus",
    label: cleanLabel(label),
    durationMs,
    remainingMs: durationMs,
    endAt: null,
    status: "idle",
    cycleCount: 0,
    breakLong: false,
    finishedAt: null
  };
}

export function configureTimerState(state, patch = {}) {
  const preset = presetById(patch.presetId || state.presetId);
  const label = patch.label !== undefined ? cleanLabel(patch.label) : state.label;
  const minutes = preset.mode === "countdown"
    ? (normalizeMinutes(patch.minutes) || Math.round((state.mode === "countdown" ? state.durationMs : preset.focusMs) / 60000) || 25)
    : null;
  const next = createTimerState({ presetId: preset.id, minutes, label });
  return next;
}

export function resetTimerState(state) {
  const durationMs = state.mode === "countdown"
    ? clampMs(state.durationMs, 25 * 60 * 1000)
    : presetById(state.presetId).focusMs;
  return {
    ...state,
    phase: "focus",
    durationMs,
    remainingMs: durationMs,
    endAt: null,
    status: "idle",
    cycleCount: 0,
    breakLong: false,
    finishedAt: null
  };
}

export function dismissTimerState(state) {
  const durationMs = state.mode === "countdown"
    ? clampMs(state.durationMs, 25 * 60 * 1000)
    : presetById(state.presetId).focusMs;
  return {
    ...state,
    phase: "focus",
    label: "",
    durationMs,
    remainingMs: durationMs,
    endAt: null,
    status: "idle",
    cycleCount: 0,
    breakLong: false,
    finishedAt: null
  };
}

export function startTimerState(state, now) {
  if (state.status === "running") return state;
  if (state.status === "finished") return startNextPhase(state, now);
  const remainingMs = state.remainingMs > 0 ? state.remainingMs : state.durationMs;
  return {
    ...state,
    status: "running",
    remainingMs,
    endAt: now + remainingMs,
    finishedAt: null
  };
}

export function pauseTimerState(state, now) {
  if (state.status !== "running") return state;
  const remainingMs = Math.max(0, state.endAt - now);
  if (remainingMs <= 0) return finishTimerState(state, state.endAt);
  return {
    ...state,
    status: "paused",
    remainingMs,
    endAt: null
  };
}

export function finishTimerState(state, finishedAt) {
  const next = {
    ...state,
    status: "finished",
    remainingMs: 0,
    endAt: null,
    finishedAt
  };
  if (state.mode === "pomodoro" && state.phase === "focus") {
    next.cycleCount = Math.min(99, state.cycleCount + 1);
  }
  return next;
}

export function tickTimerState(state, now) {
  if (state.status !== "running" || !Number.isFinite(state.endAt)) {
    return { state, finished: false, remainingMs: state.remainingMs };
  }
  const remainingMs = state.endAt - now;
  if (remainingMs > 0) {
    return { state: { ...state, remainingMs }, finished: false, remainingMs };
  }
  return {
    state: finishTimerState(state, state.endAt),
    finished: true,
    remainingMs: 0
  };
}

// What the "start" button should do from a finished state. Returns null when
// the timer is not finished.
export function nextPhaseInfo(state) {
  if (state.status !== "finished") return null;
  if (state.mode === "countdown") {
    return {
      phase: "focus",
      label: "Again",
      longBreak: false,
      durationMs: state.durationMs
    };
  }
  const preset = presetById(state.presetId);
  if (state.phase === "focus") {
    const longBreak = preset.rounds > 0 && state.cycleCount >= preset.rounds;
    return {
      phase: "break",
      label: longBreak ? "Long break" : "Break",
      longBreak,
      durationMs: longBreak ? preset.longBreakMs : preset.breakMs
    };
  }
  return {
    phase: "focus",
    label: "Focus",
    longBreak: false,
    durationMs: preset.focusMs
  };
}

export function startNextPhase(state, now) {
  const info = nextPhaseInfo(state);
  if (!info) return startTimerState(state, now);
  const cycleCount = info.phase === "focus" && state.breakLong ? 0 : state.cycleCount;
  return {
    ...state,
    phase: info.phase,
    breakLong: info.phase === "break" ? info.longBreak : false,
    cycleCount,
    durationMs: info.durationMs,
    remainingMs: info.durationMs,
    status: "running",
    endAt: now + info.durationMs,
    finishedAt: null
  };
}

// Repairs a persisted record. A timer that ran while the tab was closed comes
// back as finished, with its cycle credited exactly once.
export function hydrateTimerState(raw, now) {
  if (!raw || typeof raw !== "object") return null;
  const preset = presetById(raw.presetId);
  const statuses = ["idle", "running", "paused", "finished"];
  const status = statuses.includes(raw.status) ? raw.status : "idle";
  const phase = preset.mode === "countdown" ? "focus" : (raw.phase === "break" ? "break" : "focus");
  let state = {
    version: 1,
    presetId: preset.id,
    mode: preset.mode,
    phase,
    label: cleanLabel(raw.label),
    durationMs: clampMs(raw.durationMs, preset.focusMs),
    remainingMs: clampMs(raw.remainingMs, preset.focusMs),
    endAt: Number.isFinite(raw.endAt) ? raw.endAt : null,
    status,
    cycleCount: Math.max(0, Math.min(99, Math.floor(Number(raw.cycleCount) || 0))),
    breakLong: raw.breakLong === true,
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null
  };
  if (state.mode === "countdown") state.breakLong = false;
  if (state.status === "running" && !Number.isFinite(state.endAt)) {
    state = { ...state, status: "paused", endAt: null };
  }
  if (state.status !== "running") state.endAt = null;
  if (state.remainingMs > state.durationMs) state.remainingMs = state.durationMs;
  if (state.status === "running") {
    state = tickTimerState(state, now).state;
  }
  return state;
}

export function progressOf(state, now) {
  const remaining = state.status === "running" && Number.isFinite(state.endAt)
    ? Math.max(0, state.endAt - now)
    : Math.max(0, state.remainingMs);
  if (!state.durationMs) return 0;
  return Math.min(1, Math.max(0, 1 - remaining / state.durationMs));
}

export function dateKeyLocal(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeTimerHistory(raw) {
  const days = raw && typeof raw === "object" && raw.days && typeof raw.days === "object" ? raw.days : {};
  const entries = Object.entries(days)
    .filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === "object")
    .map(([key, value]) => [key, {
      sessions: Math.max(0, Math.floor(Number(value.sessions) || 0)),
      ms: Math.max(0, Math.round(Number(value.ms) || 0))
    }])
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, HISTORY_DAYS);
  return { days: Object.fromEntries(entries) };
}

export function recordTimerSession(history, finishedState) {
  if (!finishedState || !Number.isFinite(finishedState.finishedAt)) return history;
  const isFocus = finishedState.mode === "countdown" || finishedState.phase === "focus";
  if (!isFocus) return history;
  const key = dateKeyLocal(finishedState.finishedAt);
  const previous = history.days[key] || { sessions: 0, ms: 0 };
  return normalizeTimerHistory({
    days: {
      ...history.days,
      [key]: {
        sessions: previous.sessions + 1,
        ms: previous.ms + Math.max(0, finishedState.durationMs)
      }
    }
  });
}

export function todaySummary(history, now = Date.now()) {
  const entry = history.days[dateKeyLocal(now)] || { sessions: 0, ms: 0 };
  return { sessions: entry.sessions, ms: entry.ms };
}

export function normalizeTimerSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  return {
    sound: input.sound === true,
    corner: ["tl", "tr", "bl", "br"].includes(input.corner) ? input.corner : "tl",
    hideSidebar: input.hideSidebar === true,
    autoStart: input.autoStart === true
  };
}

function readJSON(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(storage, key, value) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage area must never break the timer.
  }
}

// The store owns ticking, persistence and subscriber notification. Views only
// render what they are given. `onFinish` stays optional so the engine remains
// usable from tests.
export function createTimerStore({ storage = null, now = () => Date.now(), tickMs = 250 } = {}) {
  const rawState = readJSON(storage, TIMER_STATE_KEY);
  let state = hydrateTimerState(rawState, now()) || createTimerState();
  let settings = normalizeTimerSettings(readJSON(storage, TIMER_SETTINGS_KEY));
  let history = normalizeTimerHistory(readJSON(storage, TIMER_HISTORY_KEY));
  const listeners = new Set();
  let ticker = null;

  // A running timer persisted by a closed tab may have finished in the
  // meantime. Credit that session once and save the resolved state.
  if (rawState && rawState.status === "running" && state.status === "finished") {
    history = recordTimerSession(history, state);
    writeJSON(storage, TIMER_HISTORY_KEY, history);
    writeJSON(storage, TIMER_STATE_KEY, state);
  }

  function persistState() {
    writeJSON(storage, TIMER_STATE_KEY, state);
  }

  function persistSettings() {
    writeJSON(storage, TIMER_SETTINGS_KEY, settings);
  }

  function emit(type, detail = {}) {
    // Running ticks are derived from `endAt`, so writing four times a second
    // would only churn localStorage.
    if (type !== "tick") persistState();
    ensureTicker();
    for (const listener of [...listeners]) {
      try {
        listener(state, { type, ...detail });
      } catch (error) {
        console.error("[TIMER] listener failed", error);
      }
    }
  }

  function ensureTicker() {
    const shouldTick = state.status === "running";
    if (shouldTick && !ticker) {
      ticker = setInterval(handleTick, tickMs);
    } else if (!shouldTick && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function completeSession(finishedState) {
    const before = history;
    history = recordTimerSession(history, finishedState);
    if (history !== before) writeJSON(storage, TIMER_HISTORY_KEY, history);
  }

  function settleFinish(finishedState, at) {
    completeSession(finishedState);
    const canAutoStart = settings.autoStart
      && finishedState.mode === "pomodoro"
      && finishedState.phase === "focus";
    state = canAutoStart ? startNextPhase(finishedState, at) : finishedState;
    emit("finish", { autoStarted: canAutoStart, finishedPhase: finishedState.phase });
  }

  function handleTick() {
    if (state.status !== "running") return;
    const at = now();
    const result = tickTimerState(state, at);
    if (!result.finished) {
      state = result.state;
      emit("tick");
      return;
    }
    settleFinish(result.state, at);
  }

  function sync() {
    const raw = readJSON(storage, TIMER_STATE_KEY);
    const hydrated = hydrateTimerState(raw, now());
    settings = normalizeTimerSettings(readJSON(storage, TIMER_SETTINGS_KEY));
    history = normalizeTimerHistory(readJSON(storage, TIMER_HISTORY_KEY));
    if (hydrated) state = hydrated;
    emit("sync");
  }

  const store = {
    getState: () => state,
    getSettings: () => ({ ...settings }),
    getHistory: () => normalizeTimerHistory(history),
    today: () => todaySummary(history, now()),
    subscribe(listener) {
      listeners.add(listener);
      listener(state, { type: "init" });
      return () => listeners.delete(listener);
    },
    start() {
      const at = now();
      state = state.status === "finished"
        ? startNextPhase(state, at)
        : startTimerState(state, at);
      emit("change");
    },
    pause() {
      const at = now();
      const wasRunning = state.status === "running";
      state = pauseTimerState(state, at);
      // Pausing in the last tick window must still settle the session exactly
      // once instead of silently marking it finished without credit.
      if (wasRunning && state.status === "finished") {
        settleFinish(state, at);
        return;
      }
      emit("change");
    },
    toggle() {
      if (state.status === "running") {
        store.pause();
      } else {
        store.start();
      }
    },
    reset() {
      state = resetTimerState(state);
      emit("change");
    },
    dismiss() {
      state = dismissTimerState(state);
      emit("change");
    },
    configure(patch) {
      state = configureTimerState(state, patch);
      emit("change");
    },
    setLabel(label) {
      const next = cleanLabel(label);
      if (next === state.label) return;
      state = { ...state, label: next };
      emit("change");
    },
    updateSettings(patch) {
      settings = normalizeTimerSettings({ ...settings, ...patch });
      persistSettings();
      emit("settings");
    },
    sync,
    // Delete-all clears timer data but leaves the device preferences (corner,
    // sound, sidebar choice) exactly like theme preferences survive.
    clearData() {
      state = createTimerState();
      history = { days: {} };
      writeJSON(storage, TIMER_STATE_KEY, state);
      writeJSON(storage, TIMER_HISTORY_KEY, history);
      emit("change");
    },
    dispose() {
      if (ticker) clearInterval(ticker);
      ticker = null;
      listeners.clear();
    }
  };

  // Pick up a timer started or stopped in another tab.
  if (storage && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key === TIMER_STATE_KEY || event.key === TIMER_SETTINGS_KEY || event.key === TIMER_HISTORY_KEY) {
        sync();
      }
    });
  }

  ensureTicker();
  return store;
}
