// Shell-level timer dock. Lives outside #toolContainer so it survives tool
// switches. The dock is a view over the shared timer store; it owns the tab
// title, the completion chime and the finish toast.
import {
  TIMER_PRESETS,
  TIMER_SIZES,
  displayMsOf,
  formatClock,
  formatDuration,
  nextPhaseInfo,
  normalizeMinutes,
  progressOf,
  timerPhaseLabel,
  timerPrimaryLabel
} from "./timerEngine.js";
import { SIDEBAR_MODES } from "./sidebarMode.js";
import { playTimerChime, primeTimerSound } from "./timerSound.js";

const CORNERS = ["tl", "tr", "bl", "br"];
const QUICK_MINUTES = [5, 10, 15, 25, 50];
const SIZE_LABELS = { compact: "Compact", standard: "Standard", large: "Large" };

function dockPhaseLabel(state) {
  if (state.mode === "stopwatch") return state.label || "Stopwatch";
  if (state.mode === "countdown" && state.label) return state.label;
  return timerPhaseLabel(state);
}

function nextSize(size) {
  const index = TIMER_SIZES.indexOf(size);
  return TIMER_SIZES[(index + 1) % TIMER_SIZES.length];
}

export function initTimerDock({ store, toast, openTool, isToolActive, sidebarMode }) {
  const dock = document.getElementById("timerDock");
  if (!dock) return null;

  const main = document.getElementById("mainContent");
  const grip = document.getElementById("timerDockGrip");
  const body = document.getElementById("timerDockBody");
  const phaseEl = document.getElementById("timerDockPhase");
  const timeEl = document.getElementById("timerDockTime");
  const progressEl = document.getElementById("timerDockProgress");
  const toggleBtn = document.getElementById("timerDockToggle");
  const sizeBtn = document.getElementById("timerDockSize");
  const moreBtn = document.getElementById("timerDockMore");
  const menu = document.getElementById("timerDockMenu");
  const chipsEl = document.getElementById("timerDockChips");
  const chipsInlineEl = document.getElementById("timerDockChipsInline");
  const quickSectionEl = document.getElementById("timerDockQuickSection");
  const labelInput = document.getElementById("timerDockLabel");
  const presetsEl = document.getElementById("timerDockPresets");
  const customEl = document.getElementById("timerDockCustom");
  const minutesInput = document.getElementById("timerDockMinutes");
  const autoInput = document.getElementById("timerDockAuto");
  const soundBtn = document.getElementById("timerDockSound");
  const sidebarSelect = document.getElementById("timerDockSidebar");
  const todayEl = document.getElementById("timerDockToday");
  const resetBtn = document.getElementById("timerDockReset");
  const openBtn = document.getElementById("timerDockOpen");
  const clearBtn = document.getElementById("timerDockClear");
  const finishBtn = document.getElementById("timerDockFinish");

  const baseTitle = document.title || "NeuroNet";
  let drag = null;
  let unsubscribeSidebar = () => {};
  // The dock normally hides while idle. When the user configures a timer from
  // the dock menu, keep it around so they can press Start instead of watching
  // it vanish mid-setup. Clear (or opening the tool) releases it.
  let idlePinned = false;

  function configureFromDock(patch) {
    idlePinned = true;
    store.configure(patch);
  }

  // ---------- menu controls ----------
  const presetButtons = new Map();
  for (const preset of TIMER_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timer-menu-chip";
    button.dataset.preset = preset.id;
    button.textContent = preset.name;
    button.title = preset.hint;
    button.addEventListener("click", () => {
      const minutes = preset.mode === "countdown"
        ? (normalizeMinutes(minutesInput?.value) || Math.round(store.getState().durationMs / 60000) || 25)
        : undefined;
      configureFromDock({ presetId: preset.id, minutes });
      if (minutesInput && minutes) minutesInput.value = String(minutes);
    });
    presetsEl?.appendChild(button);
    presetButtons.set(preset.id, button);
  }

  for (const minutes of QUICK_MINUTES) {
    const action = () => {
      if (minutesInput) minutesInput.value = String(minutes);
      configureFromDock({ presetId: "countdown", minutes });
    };
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "timer-dock-chip";
    chip.dataset.minutes = String(minutes);
    chip.textContent = `${minutes}m`;
    chip.addEventListener("click", action);
    chipsEl?.appendChild(chip);

    const menuChip = document.createElement("button");
    menuChip.type = "button";
    menuChip.className = "timer-menu-chip timer-menu-chip-quiet";
    menuChip.dataset.minutes = String(minutes);
    menuChip.textContent = `${minutes}m`;
    menuChip.addEventListener("click", action);
    chipsInlineEl?.appendChild(menuChip);
  }

  if (sidebarSelect) {
    for (const option of SIDEBAR_MODES) {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent = option.label;
      sidebarSelect.appendChild(item);
    }
  }

  menu?.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => store.updateSettings({ size: button.dataset.size }));
  });

  // ---------- menu open/close ----------
  function menuOpen() {
    return menu ? !menu.hidden : false;
  }

  function setMenu(open) {
    if (!menu) return;
    menu.hidden = !open;
    dock.classList.toggle("menu-open", open);
    moreBtn?.setAttribute("aria-expanded", String(open));
    if (open) {
      // Keep the menu inside the viewport on short screens.
      const corner = store.getSettings().corner;
      dock.classList.toggle("menu-above", corner.startsWith("b"));
    }
  }

  function closeMenu() {
    if (menuOpen()) setMenu(false);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!menuOpen()) return;
    if (menu?.contains(event.target) || moreBtn?.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen()) closeMenu();
  });

  // ---------- corners ----------
  function cornerLabel(corner) {
    return { tl: "top left", tr: "top right", bl: "bottom left", br: "bottom right" }[corner] || "top left";
  }

  function applyCorner() {
    const corner = store.getSettings().corner;
    dock.classList.remove(...CORNERS.map((value) => `corner-${value}`));
    dock.classList.add(`corner-${corner}`);
    dock.classList.toggle("menu-above", corner.startsWith("b"));
    grip?.setAttribute("title", `Move timer (docked ${cornerLabel(corner)})`);
  }

  function applySize() {
    const size = store.getSettings().size;
    dock.classList.remove(...TIMER_SIZES.map((value) => `size-${value}`));
    dock.classList.add(`size-${size}`);
    if (sizeBtn) {
      sizeBtn.setAttribute("title", `Timer size: ${SIZE_LABELS[size]}. Click for ${SIZE_LABELS[nextSize(size)].toLowerCase()}.`);
      sizeBtn.setAttribute("aria-label", `Timer size ${SIZE_LABELS[size]}. Change size.`);
    }
    menu?.querySelectorAll("[data-size]").forEach((button) => {
      const active = button.dataset.size === size;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function visible(state) {
    if (isToolActive()) return false;
    return state.status !== "idle" || idlePinned || menuOpen();
  }

  function syncTitle(state) {
    let next = baseTitle;
    const clock = formatClock(displayMsOf(state, Date.now()));
    if (state.status === "running") {
      next = `${clock} · ${timerPhaseLabel(state)} — ${baseTitle}`;
    } else if (state.status === "paused") {
      next = `Paused · ${clock} — ${baseTitle}`;
    } else if (state.status === "finished") {
      next = `Time's up — ${baseTitle}`;
    }
    if (document.title !== next) document.title = next;
  }

  // ---------- rendering ----------
  function render(state) {
    syncTitle(state);
    const show = visible(state);
    const running = state.status === "running";

    // Keep the state classes truthful even while hidden, so a dock that was
    // reset or dismissed never comes back wearing stale "running" styling.
    dock.classList.toggle("is-finished", state.status === "finished");
    dock.classList.toggle("is-paused", state.status === "paused");
    dock.classList.toggle("is-running", running);
    dock.classList.toggle("is-stopwatch", state.mode === "stopwatch");
    dock.dataset.status = state.status;
    dock.dataset.phase = state.phase;

    dock.hidden = !show;
    if (!show) {
      closeMenu();
      return;
    }

    const clockMs = displayMsOf(state, Date.now());
    const phase = timerPhaseLabel(state);
    const locked = running || state.status === "paused";
    const settings = store.getSettings();

    const label = dockPhaseLabel(state);
    if (phaseEl) phaseEl.textContent = label;
    if (timeEl) timeEl.textContent = formatClock(clockMs);

    if (progressEl) {
      const progress = state.mode === "stopwatch" ? 0 : progressOf(state, Date.now());
      progressEl.style.width = `${Math.round(progress * 1000) / 10}%`;
    }

    const action = timerPrimaryLabel(state);
    const hint = state.status === "finished"
      ? `${action} (${phase})`
      : `${action} — ${formatClock(clockMs)} ${phase}`;
    body?.setAttribute("aria-label", `Open timer. ${hint}`);
    body?.setAttribute("title", `${label} — ${formatClock(clockMs)}`);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", action);
      toggleBtn.setAttribute("title", action);
      toggleBtn.innerHTML = running
        ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    }
    moreBtn?.setAttribute("title", "Timer options");
    moreBtn?.setAttribute("aria-label", "Timer options");

    // Menu setup state
    for (const [id, button] of presetButtons) {
      const active = state.presetId === id;
      button.classList.toggle("active", active);
      button.disabled = locked;
      button.setAttribute("aria-pressed", String(active));
    }

    const isCountdown = state.mode === "countdown";
    if (customEl) customEl.hidden = !isCountdown;
    if (isCountdown && minutesInput && document.activeElement !== minutesInput) {
      const minutes = Math.round(state.durationMs / 60000);
      if (minutesInput.value !== String(minutes)) minutesInput.value = String(minutes);
    }
    if (minutesInput) minutesInput.disabled = locked;
    if (quickSectionEl) quickSectionEl.hidden = locked;
    dock.querySelectorAll("[data-minutes]").forEach((chip) => {
      const minutes = Number(chip.dataset.minutes);
      const active = isCountdown && Math.round(state.durationMs / 60000) === minutes;
      chip.classList.toggle("active", active);
      chip.disabled = locked;
      chip.setAttribute("aria-pressed", String(active));
    });

    if (labelInput && document.activeElement !== labelInput && labelInput.value !== state.label) {
      labelInput.value = state.label;
    }
    if (autoInput) autoInput.checked = settings.autoStart;
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", String(settings.sound));
      soundBtn.textContent = settings.sound ? "Sound on" : "Sound off";
      soundBtn.title = settings.sound ? "Mute the finish chime" : "Play a chime when a timer finishes";
    }
    if (sidebarSelect && sidebarMode) {
      const mode = sidebarMode.getMode();
      if (sidebarSelect.value !== mode) sidebarSelect.value = mode;
      sidebarSelect.title = SIDEBAR_MODES.find((item) => item.id === mode)?.hint || "";
    }

    const today = store.today();
    if (todayEl) {
      todayEl.textContent = today.sessions
        ? `Today · ${today.sessions} ${today.sessions === 1 ? "session" : "sessions"} · ${formatDuration(today.ms)}`
        : "No focus sessions today";
    }

    if (finishBtn) {
      const canFinish = state.mode === "stopwatch" && clockMs > 0;
      finishBtn.hidden = !canFinish;
      finishBtn.title = clockMs < 60 * 1000
        ? "Blocks under a minute are not logged"
        : "Log this stopwatch block and reset";
    }

    applySize();
  }

  function announceFinish(state, meta) {
    if (store.getSettings().sound) playTimerChime();
    if (!toast) return;

    if (meta?.autoStarted) {
      toast(`Break started — ${formatClock(displayMsOf(state, Date.now()))}.`);
      return;
    }
    if (state.mode === "countdown") {
      toast("Timer finished.", {
        action: { label: "Again", onClick: () => store.start() }
      });
      return;
    }
    if (state.phase === "focus") {
      const isLong = nextPhaseInfo(state)?.longBreak === true;
      toast(isLong ? "Focus round complete. Long break is ready." : "Focus session complete.", {
        action: { label: isLong ? "Start long break" : "Start break", onClick: () => store.start() }
      });
      return;
    }
    toast("Break over — ready for another focus?", {
      action: { label: "Start focus", onClick: () => store.start() }
    });
  }

  // ---------- actions ----------
  function openTimer() {
    idlePinned = false;
    closeMenu();
    openTool?.("timer");
  }

  body?.addEventListener("click", openTimer);
  toggleBtn?.addEventListener("click", () => store.toggle());
  moreBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenu(!menuOpen());
  });
  sizeBtn?.addEventListener("click", () => {
    store.updateSettings({ size: nextSize(store.getSettings().size) });
  });

  resetBtn?.addEventListener("click", () => {
    idlePinned = true;
    store.reset();
    closeMenu();
    render(store.getState());
  });
  openBtn?.addEventListener("click", openTimer);
  clearBtn?.addEventListener("click", () => {
    idlePinned = false;
    store.dismiss();
    closeMenu();
    render(store.getState());
  });
  finishBtn?.addEventListener("click", () => {
    const ms = store.finishStopwatch();
    closeMenu();
    if (!toast) return;
    if (ms >= 60 * 1000) toast(`Stopwatch logged — ${formatDuration(ms)}.`);
    else toast("Stopwatch cleared. Blocks under a minute are not logged.");
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

  sidebarSelect?.addEventListener("change", () => {
    sidebarMode?.setMode(sidebarSelect.value);
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
      if (minutesInput) minutesInput.value = String(Math.max(1, Math.round(store.getState().durationMs / 60000)));
      return;
    }
    if (minutesInput) minutesInput.value = String(minutes);
    configureFromDock({ presetId: "countdown", minutes });
  }

  minutesInput?.addEventListener("change", commitMinutes);
  minutesInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitMinutes();
      minutesInput.blur();
    }
  });

  // ---------- dragging ----------
  grip?.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    closeMenu();
    const mainRect = main?.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    if (!mainRect) return;
    drag = {
      id: event.pointerId,
      offsetX: event.clientX - dockRect.left,
      offsetY: event.clientY - dockRect.top,
      width: dockRect.width,
      height: dockRect.height
    };
    dock.classList.add("dragging");
    dock.classList.remove(...CORNERS.map((value) => `corner-${value}`));
    dock.style.left = `${dockRect.left - mainRect.left}px`;
    dock.style.top = `${dockRect.top - mainRect.top}px`;
    try { grip.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    event.preventDefault();
  });

  grip?.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = main?.getBoundingClientRect();
    if (!rect) return;
    const maxLeft = Math.max(0, rect.width - drag.width);
    const maxTop = Math.max(0, rect.height - drag.height);
    const left = Math.min(maxLeft, Math.max(0, event.clientX - rect.left - drag.offsetX));
    const top = Math.min(maxTop, Math.max(0, event.clientY - rect.top - drag.offsetY));
    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
  });

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const rect = main?.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    if (rect) {
      const centerX = dockRect.left + dockRect.width / 2 - rect.left;
      const centerY = dockRect.top + dockRect.height / 2 - rect.top;
      const corner = `${centerY < rect.height / 2 ? "t" : "b"}${centerX < rect.width / 2 ? "l" : "r"}`;
      store.updateSettings({ corner });
    }
    drag = null;
    dock.classList.remove("dragging");
    dock.style.left = "";
    dock.style.top = "";
    applyCorner();
    try { grip.releasePointerCapture(event?.pointerId); } catch { /* ignore */ }
  }

  grip?.addEventListener("pointerup", endDrag);
  grip?.addEventListener("pointercancel", endDrag);

  grip?.addEventListener("keydown", (event) => {
    const corner = store.getSettings().corner;
    let next = corner;
    if (event.key === "ArrowLeft") next = `${corner[0]}l`;
    else if (event.key === "ArrowRight") next = `${corner[0]}r`;
    else if (event.key === "ArrowUp") next = `t${corner[1]}`;
    else if (event.key === "ArrowDown") next = `b${corner[1]}`;
    if (next !== corner && CORNERS.includes(next)) {
      event.preventDefault();
      store.updateSettings({ corner: next });
      applyCorner();
      grip.setAttribute("title", `Move timer (docked ${cornerLabel(next)})`);
    }
  });

  document.addEventListener("neuronet-tool-changed", () => render(store.getState()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") store.sync();
  });

  store.subscribe((state, meta) => {
    render(state);
    if (meta.type === "finish") announceFinish(state, meta);
    if (meta.type === "settings") {
      applyCorner();
      applySize();
    }
  });

  if (sidebarMode?.subscribe) unsubscribeSidebar = sidebarMode.subscribe(() => render(store.getState()));

  applyCorner();
  applySize();
  render(store.getState());

  return {
    render,
    applyCorner,
    closeMenu,
    destroy() {
      unsubscribeSidebar();
    }
  };
}
