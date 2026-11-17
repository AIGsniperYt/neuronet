// Shell-level timer dock. Lives outside #toolContainer so it survives tool
// switches. The dock is a view over the shared timer store; it owns the tab
// title, the completion chime and the finish toast.
import { formatClock, nextPhaseInfo, progressOf, timerPhaseLabel, timerPrimaryLabel } from "./timerEngine.js";
import { playTimerChime } from "./timerSound.js";

const CORNERS = ["tl", "tr", "bl", "br"];

export function initTimerDock({ store, toast, openTool, isToolActive }) {
  const dock = document.getElementById("timerDock");
  if (!dock) return null;

  const main = document.getElementById("mainContent");
  const grip = document.getElementById("timerDockGrip");
  const body = document.getElementById("timerDockBody");
  const phaseEl = document.getElementById("timerDockPhase");
  const timeEl = document.getElementById("timerDockTime");
  const progressEl = document.getElementById("timerDockProgress");
  const toggleBtn = document.getElementById("timerDockToggle");
  const expandBtn = document.getElementById("timerDockExpand");
  const clearBtn = document.getElementById("timerDockClear");

  const baseTitle = document.title || "NeuroNet";
  let drag = null;

  function applyCorner() {
    const corner = store.getSettings().corner;
    dock.classList.remove(...CORNERS.map((value) => `corner-${value}`));
    dock.classList.add(`corner-${corner}`);
    grip?.setAttribute("title", `Move timer (docked ${cornerLabel(corner)})`);
  }

  function cornerLabel(corner) {
    return { tl: "top left", tr: "top right", bl: "bottom left", br: "bottom right" }[corner] || "top left";
  }

  function visible(state) {
    return state.status !== "idle" && !isToolActive();
  }

  function syncTitle(state) {
    let next = baseTitle;
    if (state.status === "running") {
      next = `${formatClock(state.remainingMs)} · ${timerPhaseLabel(state)} — ${baseTitle}`;
    } else if (state.status === "paused") {
      next = `Paused · ${formatClock(state.remainingMs)} — ${baseTitle}`;
    } else if (state.status === "finished") {
      next = `Time's up — ${baseTitle}`;
    }
    if (document.title !== next) document.title = next;
  }

  function render(state) {
    syncTitle(state);
    const show = visible(state);
    dock.hidden = !show;
    if (!show) return;

    const phase = timerPhaseLabel(state);
    const label = state.mode === "countdown" && state.label ? state.label : phase;
    if (phaseEl) phaseEl.textContent = label;
    if (timeEl) timeEl.textContent = formatClock(state.remainingMs);
    dock.classList.toggle("is-finished", state.status === "finished");
    dock.classList.toggle("is-paused", state.status === "paused");
    dock.dataset.status = state.status;
    dock.dataset.phase = state.phase;

    if (progressEl) {
      progressEl.style.width = `${Math.round(progressOf(state, Date.now()) * 1000) / 10}%`;
    }

    const action = timerPrimaryLabel(state);
    const hint = state.status === "finished"
      ? `${action} (${phase})`
      : `${action} — ${formatClock(state.remainingMs)} ${phase}`;
    body?.setAttribute("aria-label", `Open timer. ${hint}`);
    body?.setAttribute("title", `${label} — ${formatClock(state.remainingMs)}`);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", action);
      toggleBtn.setAttribute("title", action);
      toggleBtn.innerHTML = state.status === "running"
        ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    }
    if (expandBtn) {
      expandBtn.setAttribute("aria-label", "Open the Timer tool");
      expandBtn.setAttribute("title", "Open Timer");
    }
    if (clearBtn) {
      clearBtn.setAttribute("aria-label", "Clear timer");
      clearBtn.setAttribute("title", "Clear timer");
    }
  }

  function announceFinish(state, meta) {
    if (store.getSettings().sound) playTimerChime();
    if (!toast) return;

    if (meta?.autoStarted) {
      toast(`Break started — ${formatClock(state.remainingMs)}.`);
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

  function openTimer() {
    openTool?.("timer");
  }

  body?.addEventListener("click", openTimer);
  expandBtn?.addEventListener("click", openTimer);
  toggleBtn?.addEventListener("click", () => store.toggle());
  clearBtn?.addEventListener("click", () => store.dismiss());

  // Corner dragging. The grip is the only draggable surface so the buttons
  // keep their normal click behaviour.
  grip?.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
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
    if (meta.type === "settings") applyCorner();
  });

  applyCorner();
  render(store.getState());

  return { render, applyCorner };
}
