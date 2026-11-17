// Timer tool: the full-screen view over the shared timer store. It also owns
// the optional off-canvas sidebar, which is opt-in and restores on tool switch.
import {
  TIMER_MAX_MINUTES,
  TIMER_PRESETS,
  formatClock,
  formatDuration,
  normalizeMinutes,
  progressOf,
  timerPhaseLabel,
  timerPrimaryLabel
} from "../timerEngine.js";
import { playTimerChime, primeTimerSound } from "../timerSound.js";

const QUICK_MINUTES = [5, 10, 15, 25, 50];

function statusLine(state) {
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

export function initTimerTool({ store, onMinimise }) {
  const tool = document.getElementById("timerTool");
  if (!tool) return;

  const ring = document.getElementById("timerRing");
  const phaseEl = document.getElementById("timerPhase");
  const clockEl = document.getElementById("timerClock");
  const statusEl = document.getElementById("timerStatus");
  const labelInput = document.getElementById("timerLabelInput");
  const presetsEl = document.getElementById("timerPresets");
  const customEl = document.getElementById("timerCustom");
  const chipsEl = document.getElementById("timerChips");
  const minutesInput = document.getElementById("timerMinutes");
  const primaryBtn = document.getElementById("timerPrimary");
  const resetBtn = document.getElementById("timerReset");
  const cycleEl = document.getElementById("timerCycle");
  const metaEl = document.getElementById("timerMeta");
  const todayEl = document.getElementById("timerToday");
  const autoWrap = document.getElementById("timerAutoWrap");
  const autoInput = document.getElementById("timerAutoStart");
  const sidebarBtn = document.getElementById("timerSidebarBtn");
  const sidebarLabel = document.getElementById("timerSidebarLabel");
  const soundBtn = document.getElementById("timerSoundBtn");
  const soundLabel = document.getElementById("timerSoundLabel");
  const minimiseBtn = document.getElementById("timerMinimiseBtn");

  let hotzone = null;
  let revealTimer = null;
  let cleaned = false;
  let unsubscribe = () => {};
  let pipsSignature = "";

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

  // ---------- rendering ----------
  function render(state) {
    const running = state.status === "running";
    // Changing preset or length rebuilds the session, so keep it read-only
    // until the user resets deliberately.
    const locked = running || state.status === "paused";
    const finished = state.status === "finished";
    tool.classList.toggle("is-running", running);
    tool.classList.toggle("is-finished", finished);
    tool.dataset.status = state.status;

    const progress = Math.round(progressOf(state, Date.now()) * 1000) / 10;
    ring?.style.setProperty("--timer-progress", String(progress));
    ring?.classList.toggle("is-empty", progress === 0);
    if (phaseEl) phaseEl.textContent = timerPhaseLabel(state);
    if (clockEl) clockEl.textContent = formatClock(state.remainingMs);
    if (statusEl) {
      statusEl.textContent = statusLine(state);
      statusEl.dataset.tone = finished ? "accent" : "";
    }

    if (primaryBtn) {
      primaryBtn.textContent = timerPrimaryLabel(state);
      primaryBtn.disabled = false;
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

    renderSidebarButton();
    renderSoundButton();
  }

  // ---------- controls ----------
  primaryBtn?.addEventListener("click", () => store.toggle());
  resetBtn?.addEventListener("click", () => store.reset());

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

  // ---------- optional off-canvas sidebar ----------
  function revealSidebar() {
    if (cleaned) return;
    document.getElementById("sidebar")?.classList.add("timer-sidebar-revealed");
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  function scheduleHideSidebar() {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      document.getElementById("sidebar")?.classList.remove("timer-sidebar-revealed");
      revealTimer = null;
    }, 260);
  }

  function ensureHotzone() {
    if (hotzone) return;
    hotzone = document.createElement("div");
    hotzone.id = "timerSidebarHotzone";
    hotzone.setAttribute("aria-hidden", "true");
    hotzone.addEventListener("pointerenter", revealSidebar);
    document.body.appendChild(hotzone);

    const sidebar = document.getElementById("sidebar");
    sidebar?.addEventListener("pointerenter", revealSidebar);
    sidebar?.addEventListener("pointerleave", scheduleHideSidebar);
    sidebar?.addEventListener("focusin", revealSidebar);
    sidebar?.addEventListener("focusout", scheduleHideSidebar);
  }

  function teardownSidebar() {
    document.getElementById("app")?.classList.remove("timer-sidebar-hidden");
    document.getElementById("sidebar")?.classList.remove("timer-sidebar-revealed");
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    if (hotzone) {
      hotzone.remove();
      hotzone = null;
    }
    const sidebar = document.getElementById("sidebar");
    sidebar?.removeEventListener("pointerenter", revealSidebar);
    sidebar?.removeEventListener("pointerleave", scheduleHideSidebar);
    sidebar?.removeEventListener("focusin", revealSidebar);
    sidebar?.removeEventListener("focusout", scheduleHideSidebar);
  }

  function applySidebar(hidden) {
    const app = document.getElementById("app");
    app?.classList.toggle("timer-sidebar-hidden", hidden);
    if (hidden) {
      ensureHotzone();
    } else {
      teardownSidebar();
    }
    renderSidebarButton();
  }

  function renderSidebarButton() {
    const hidden = store.getSettings().hideSidebar;
    if (sidebarBtn) {
      sidebarBtn.setAttribute("aria-pressed", String(hidden));
      sidebarBtn.title = hidden
        ? "Show the sidebar again"
        : "Hide the sidebar and reveal it from the left edge";
    }
    if (sidebarLabel) sidebarLabel.textContent = hidden ? "Show sidebar" : "Hide sidebar";
  }

  sidebarBtn?.addEventListener("click", () => {
    const next = !store.getSettings().hideSidebar;
    store.updateSettings({ hideSidebar: next });
    applySidebar(next);
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
    } else if (event.key === "Escape") {
      document.getElementById("sidebar")?.classList.remove("timer-sidebar-revealed");
    }
  }

  document.addEventListener("keydown", handleKeydown);

  // ---------- minimise / cleanup ----------
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    unsubscribe?.();
    document.removeEventListener("keydown", handleKeydown);
    teardownSidebar();
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
  applySidebar(store.getSettings().hideSidebar);
}
