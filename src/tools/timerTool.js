// Timer tool: the full-screen view over the shared timer store. The sidebar
// layout is owned by the shell controller, so choosing a mode here behaves the
// same as choosing it from the dock.
import {
  TIMER_MAX_MINUTES,
  TIMER_PRESETS,
  displayMsOf,
  formatClock,
  formatDuration,
  normalizeMinutes,
  progressOf,
  timerPhaseLabel,
  timerPrimaryLabel
} from "../timerEngine.js";
import { SIDEBAR_MODES } from "../sidebarMode.js";
import { playTimerChime, primeTimerSound } from "../timerSound.js";

const QUICK_MINUTES = [5, 10, 15, 25, 50];

function statusLine(state) {
  if (state.mode === "stopwatch") {
    if (state.status === "running") return "Counting up — no deadline";
    if (state.status === "paused") return "Stopwatch paused";
    return "Ready to count up";
  }
  if (state.status === "finished") {
    if (state.mode === "countdown") return "Time's up";
    if (state.phase === "focus") {
      const preset = TIMER_PRESETS.find((item) => item.id === state.presetId);
      const isLong = (preset?.rounds || 0) > 0 && state.cycleCount >= preset.rounds;
      return isLong ? "Focus complete — long break ready" : "Focus complete — break ready";
    }
    return "Break complete — focus ready";
  }
  if (state.status === "paused") return "Paused";
  if (state.status === "running") return state.phase === "break" ? "Break in progress" : "In progress";
  return "Ready";
}

export function initTimerTool({ store, sidebarMode, onMinimise }) {
  const tool = document.getElementById("timerTool");
  if (!tool) return;

  const ring = document.getElementById("timerRing");
  const ringArc = document.getElementById("timerRingArc");
  const RING_CIRCUMFERENCE = 2 * Math.PI * 47;
  const phaseEl = document.getElementById("timerPhase");
  const clockEl = document.getElementById("timerClock");
  const statusEl = document.getElementById("timerStatus");
  const focusLabelEl = document.getElementById("timerFocusLabel");
  const labelInput = document.getElementById("timerLabelInput");
  const presetsEl = document.getElementById("timerPresets");
  const customEl = document.getElementById("timerCustom");
  const chipsEl = document.getElementById("timerChips");
  const minutesInput = document.getElementById("timerMinutes");
  const primaryBtn = document.getElementById("timerPrimary");
  const resetBtn = document.getElementById("timerReset");
  const finishBtn = document.getElementById("timerFinish");
  const cycleEl = document.getElementById("timerCycle");
  const metaEl = document.getElementById("timerMeta");
  const todayEl = document.getElementById("timerToday");
  const autoWrap = document.getElementById("timerAutoWrap");
  const autoInput = document.getElementById("timerAutoStart");
  const sidebarSelect = document.getElementById("timerSidebarMode");
  const soundBtn = document.getElementById("timerSoundBtn");
  const soundLabel = document.getElementById("timerSoundLabel");
  const minimiseBtn = document.getElementById("timerMinimiseBtn");

  let cleaned = false;
  let unsubscribe = () => {};
  let unsubscribeSidebar = () => {};
  let pipsSignature = "";
  let flash = null;
  let flashTimer = null;

  // ---------- presets ----------
  const presetButtons = new Map();
  for (const preset of TIMER_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timer-preset";
    button.dataset.preset = preset.id;
    const name = document.createElement("span");
    name.textContent = preset.name;
    const hint = document.createElement("small");
    hint.textContent = preset.hint;
    button.append(name, hint);
    button.addEventListener("click", () => {
      const minutes = preset.mode === "countdown"
        ? (normalizeMinutes(minutesInput.value) || Math.round(store.getState().durationMs / 60000) || 25)
        : undefined;
      store.configure({ presetId: preset.id, minutes });
      if (preset.mode === "countdown") minutesInput.value = String(minutes);
    });
    presetsEl?.appendChild(button);
    presetButtons.set(preset.id, button);
  }

  for (const minutes of QUICK_MINUTES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "timer-chip";
    chip.dataset.minutes = String(minutes);
    chip.textContent = String(minutes);
    chip.title = `${minutes} minutes`;
    chip.addEventListener("click", () => {
      if (minutesInput) minutesInput.value = String(minutes);
      store.configure({ presetId: "countdown", minutes });
    });
    chipsEl?.appendChild(chip);
  }

  if (sidebarSelect) {
    for (const option of SIDEBAR_MODES) {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent = option.label;
      sidebarSelect.appendChild(item);
    }
  }

  // ---------- flash feedback ----------
  function setFlash(text) {
    flash = { text, until: Date.now() + 4000 };
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = null;
      flashTimer = null;
      render(store.getState());
    }, 4000);
    render(store.getState());
  }

  // ---------- rendering ----------
  function render(state) {
    const now = Date.now();
    const running = state.status === "running";
    const stopped = state.status === "paused";
    // Setup fades away for the duration of a block and slides back when the
    // session ends. Pause keeps the focused layout so resuming is seamless.
    const focused = running || stopped;
    // Changing preset or length rebuilds the session, so keep it read-only
    // until the user resets deliberately.
    const locked = running || stopped;
    const finished = state.status === "finished";
    const clockMs = displayMsOf(state, now);

    tool.classList.toggle("is-running", running);
    tool.classList.toggle("is-paused", stopped);
    tool.classList.toggle("is-focused", focused);
    tool.classList.toggle("is-finished", finished);
    tool.dataset.status = state.status;

    const progress = state.mode === "stopwatch" ? 0 : Math.round(progressOf(state, now) * 1000) / 10;
    if (ringArc) ringArc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress / 100));
    ring?.classList.toggle("is-empty", progress === 0);
    ring?.classList.toggle("is-stopwatch", state.mode === "stopwatch");
    if (phaseEl) phaseEl.textContent = timerPhaseLabel(state);
    if (clockEl) clockEl.textContent = formatClock(clockMs);
    if (focusLabelEl) {
      const showLabel = focused && Boolean(state.label);
      focusLabelEl.hidden = !showLabel;
      focusLabelEl.textContent = showLabel ? state.label : "";
    }

    const flashed = flash && now < flash.until;
    if (statusEl) {
      statusEl.textContent = flashed ? flash.text : statusLine(state);
      statusEl.dataset.tone = flashed || finished ? "accent" : "";
    }

    if (primaryBtn) {
      primaryBtn.textContent = timerPrimaryLabel(state);
      primaryBtn.disabled = false;
    }
    if (finishBtn) {
      const canFinish = state.mode === "stopwatch" && clockMs > 0;
      finishBtn.hidden = !canFinish;
      finishBtn.title = clockMs < 60 * 1000
        ? "Blocks under a minute are not logged"
        : "Log this stopwatch block and reset";
    }

    if (labelInput && document.activeElement !== labelInput && labelInput.value !== state.label) {
      labelInput.value = state.label;
    }

    for (const [id, button] of presetButtons) {
      button.classList.toggle("active", state.presetId === id);
      button.disabled = locked;
      button.setAttribute("aria-pressed", String(state.presetId === id));
    }

    const isCountdown = state.mode === "countdown";
    if (customEl) customEl.hidden = !isCountdown;
    if (isCountdown && minutesInput && document.activeElement !== minutesInput) {
      const minutes = Math.round(state.durationMs / 60000);
      if (minutesInput.value !== String(minutes)) minutesInput.value = String(minutes);
    }
    if (minutesInput) {
      minutesInput.disabled = locked;
      minutesInput.max = String(TIMER_MAX_MINUTES);
    }
    chipsEl?.querySelectorAll(".timer-chip").forEach((chip) => {
      const minutes = Number(chip.dataset.minutes);
      const active = isCountdown && Math.round(state.durationMs / 60000) === minutes;
      chip.classList.toggle("active", active);
      chip.disabled = locked;
      chip.setAttribute("aria-pressed", String(active));
    });

    // Round pips are pomodoro-only. Ticks must not rebuild this subtree.
    if (cycleEl) {
      const preset = TIMER_PRESETS.find((item) => item.id === state.presetId);
      const rounds = preset?.rounds || 0;
      cycleEl.hidden = state.mode !== "pomodoro" || rounds === 0;
      const filled = Math.min(state.cycleCount, rounds);
      const signature = `${state.presetId}|${filled}|${state.status === "finished"}`;
      if (cycleEl.hidden) {
        pipsSignature = "";
      } else if (signature !== pipsSignature) {
        pipsSignature = signature;
        cycleEl.innerHTML = "";
        for (let index = 0; index < rounds; index += 1) {
          const pip = document.createElement("span");
          pip.className = "timer-pip";
          if (index < filled) pip.classList.add("filled");
          if (index === filled && state.status !== "finished") pip.classList.add("current");
          cycleEl.appendChild(pip);
        }
        const caption = document.createElement("span");
        caption.textContent = `Round ${Math.min(filled + (state.status === "finished" ? 0 : 1), rounds)} of ${rounds}`;
        caption.style.marginLeft = "6px";
        cycleEl.appendChild(caption);
      }
    }

    if (metaEl) metaEl.hidden = false;

    const today = store.today();
    if (todayEl) {
      todayEl.textContent = today.sessions
        ? `Today: ${today.sessions} ${today.sessions === 1 ? "session" : "sessions"} · ${formatDuration(today.ms)}`
        : "No focus sessions today yet";
    }

    if (autoWrap) autoWrap.hidden = state.mode !== "pomodoro";
    if (autoInput) autoInput.checked = store.getSettings().autoStart;

    renderSidebarSelect();
    renderSoundButton();
  }

  // ---------- controls ----------
  primaryBtn?.addEventListener("click", () => store.toggle());
  resetBtn?.addEventListener("click", () => store.reset());

  finishBtn?.addEventListener("click", () => {
    const ms = store.finishStopwatch();
    if (ms >= 60 * 1000) setFlash(`Logged ${formatDuration(ms)}`);
    else setFlash("Not logged — under a minute");
  });

  labelInput?.addEventListener("input", () => store.setLabel(labelInput.value));
  labelInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      labelInput.blur();
    }
  });

  function commitMinutes() {
    const minutes = normalizeMinutes(minutesInput?.value);
    if (!minutes) {
      minutesInput.value = String(Math.max(1, Math.round(store.getState().durationMs / 60000)));
      return;
    }
    if (minutesInput) minutesInput.value = String(minutes);
    store.configure({ presetId: "countdown", minutes });
  }

  minutesInput?.addEventListener("change", commitMinutes);
  minutesInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitMinutes();
      minutesInput.blur();
    }
  });

  soundBtn?.addEventListener("click", () => {
    const next = !store.getSettings().sound;
    if (next) {
      primeTimerSound();
      playTimerChime();
    }
    store.updateSettings({ sound: next });
  });

  autoInput?.addEventListener("change", () => {
    store.updateSettings({ autoStart: autoInput.checked });
  });

  // ---------- shared sidebar layout ----------
  function renderSidebarSelect() {
    if (!sidebarSelect || !sidebarMode) return;
    const mode = sidebarMode.getMode();
    if (sidebarSelect.value !== mode) sidebarSelect.value = mode;
    const option = SIDEBAR_MODES.find((item) => item.id === mode);
    sidebarSelect.title = option?.hint || "";
  }

  sidebarSelect?.addEventListener("change", () => {
    sidebarMode?.setMode(sidebarSelect.value);
  });

  function renderSoundButton() {
    const sound = store.getSettings().sound;
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", String(sound));
      soundBtn.title = sound ? "Turn the finish chime off" : "Play a chime when a timer finishes";
      const icon = soundBtn.querySelector("i");
      if (icon) icon.className = `fa-solid ${sound ? "fa-volume-high" : "fa-volume-xmark"}`;
    }
    if (soundLabel) soundLabel.textContent = sound ? "Sound on" : "Sound off";
  }

  // ---------- keyboard ----------
  function handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target?.closest?.("input, textarea, select, button, a, [contenteditable], [role='textbox']")) return;
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      store.toggle();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      store.reset();
    }
  }

  document.addEventListener("keydown", handleKeydown);

  // ---------- minimise / cleanup ----------
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    unsubscribe?.();
    unsubscribeSidebar?.();
    document.removeEventListener("keydown", handleKeydown);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = null;
    if (window.__neuronetTimerCleanup === cleanup) delete window.__neuronetTimerCleanup;
    if (window.__neuronetOnReturnToGlobal === returnHome) {
      window.__neuronetOnReturnToGlobal = previousReturnHome;
    }
  }

  minimiseBtn?.addEventListener("click", () => {
    cleanup();
    onMinimise?.();
  });

  const previousReturnHome = window.__neuronetOnReturnToGlobal;
  const returnHome = () => {
    previousReturnHome?.();
    cleanup();
  };
  window.__neuronetOnReturnToGlobal = returnHome;
  window.__neuronetTimerCleanup = cleanup;

  const unsubscribeStore = store.subscribe(render);
  unsubscribe = unsubscribeStore;
  if (sidebarMode?.subscribe) unsubscribeSidebar = sidebarMode.subscribe(() => render(store.getState()));
}
