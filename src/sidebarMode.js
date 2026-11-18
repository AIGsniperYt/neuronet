// Shared sidebar layout controller. The sidebar has always been able to
// collapse into a narrow rail; this module adds the opt-in hover-reveal modes
// and owns the one device preference every tool reads. Hiding navigation is a
// layout choice, never a "focus mode".

export const SIDEBAR_MODE_KEY = "nn-sidebar-mode";
export const LEGACY_SIDEBAR_KEY = "nn-sidebar-collapsed";
export const TIMER_SETTINGS_KEY = "nn-timer-settings-v1";

export const SIDEBAR_MODES = [
  {
    id: "full",
    label: "Full sidebar",
    short: "Full",
    hint: "Always show the full navigation."
  },
  {
    id: "compact",
    label: "Compact sidebar",
    short: "Compact",
    hint: "Always show the slim icon rail."
  },
  {
    id: "hover-full",
    label: "Hidden · reveal full",
    short: "Hidden · full",
    hint: "Tuck navigation away; hover the left edge to reveal the full panel."
  },
  {
    id: "hover-compact",
    label: "Hidden · reveal compact",
    short: "Hidden · compact",
    hint: "Tuck navigation away; hover the left edge to reveal the icon rail."
  }
];

export const DEFAULT_SIDEBAR_MODE = "full";

const MODE_IDS = SIDEBAR_MODES.map((mode) => mode.id);
const HOVER_HIDE_MS = 260;

// The settings panel asks one question: is the sidebar always there, or on
// demand? Which *flavour* of each answer applies depends on whether the chevron
// left the rail compact, so the two controls stay in their lanes.
export const SIDEBAR_VISIBILITIES = [
  {
    id: "shown",
    label: "Always show",
    hint: "Keep the navigation on screen."
  },
  {
    id: "hidden",
    label: "On demand",
    hint: "Tuck the navigation away; move to the left edge to reveal it."
  }
];

export function sidebarVisibilityMode(mode, visible) {
  const compact = isCompactMode(mode);
  if (visible) return compact ? "compact" : "full";
  return compact ? "hover-compact" : "hover-full";
}

export function normalizeSidebarMode(value) {
  return MODE_IDS.includes(value) ? value : DEFAULT_SIDEBAR_MODE;
}

export function isHoverMode(mode) {
  return normalizeSidebarMode(mode).startsWith("hover-");
}

export function isCompactMode(mode) {
  return normalizeSidebarMode(mode).endsWith("compact");
}

export function sidebarModeLabel(mode) {
  const id = normalizeSidebarMode(mode);
  return SIDEBAR_MODES.find((item) => item.id === id)?.short || "Full";
}

// The collapse button stays inside the sidebar; it flips between the full and
// compact version of whichever family the user chose.
export function toggleCollapseMode(mode) {
  switch (normalizeSidebarMode(mode)) {
    case "compact": return "full";
    case "hover-compact": return "hover-full";
    case "hover-full": return "hover-compact";
    default: return "compact";
  }
}

export function nextSidebarMode(mode) {
  const id = normalizeSidebarMode(mode);
  return MODE_IDS[(MODE_IDS.indexOf(id) + 1) % MODE_IDS.length];
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

// Old builds stored the collapsed rail in one key and the timer's off-canvas
// choice in another. Fold both into the single new preference.
export function migrateSidebarMode({ stored, legacyCollapsed, timerSettings } = {}) {
  if (MODE_IDS.includes(stored)) return { mode: stored, migrated: false };
  const hidden = timerSettings && timerSettings.hideSidebar === true;
  const compact = legacyCollapsed === "1" || legacyCollapsed === true;
  if (hidden) return { mode: compact ? "hover-compact" : "hover-full", migrated: true };
  if (compact) return { mode: "compact", migrated: true };
  return { mode: DEFAULT_SIDEBAR_MODE, migrated: false };
}

export function loadSidebarMode(storage) {
  if (!storage) return { mode: DEFAULT_SIDEBAR_MODE, migrated: false };
  let stored = null;
  let legacyCollapsed = null;
  try {
    stored = storage.getItem(SIDEBAR_MODE_KEY);
    legacyCollapsed = storage.getItem(LEGACY_SIDEBAR_KEY);
  } catch {
    return { mode: DEFAULT_SIDEBAR_MODE, migrated: false };
  }
  const result = migrateSidebarMode({
    stored,
    legacyCollapsed,
    timerSettings: readJSON(storage, TIMER_SETTINGS_KEY)
  });
  if (result.migrated) {
    try {
      storage.setItem(SIDEBAR_MODE_KEY, result.mode);
      storage.removeItem(LEGACY_SIDEBAR_KEY);
    } catch {
      // Storage can be blocked; the layout still works for this session.
    }
  }
  return result;
}

// DOM controller. Every view talks to this rather than poking sidebar classes,
// so a mode chosen from the dock or the Timer tool is applied identically.
export function initSidebarMode({ storage = null, desktopQuery = null } = {}) {
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const query = desktopQuery || window.matchMedia?.("(min-width: 701px)") || null;
  const listeners = new Set();

  const loaded = loadSidebarMode(storage);
  let mode = loaded.mode;
  let hotzone = null;
  let hideTimer = null;

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(SIDEBAR_MODE_KEY, mode);
      storage.removeItem(LEGACY_SIDEBAR_KEY);
    } catch {
      // ignore blocked storage
    }
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener(mode);
      } catch (error) {
        console.error("[SIDEBAR] listener failed", error);
      }
    }
  }

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function reveal() {
    if (!sidebar || !isHoverMode(mode)) return;
    clearHideTimer();
    sidebar.classList.add("sidebar-revealed");
  }

  function scheduleHide() {
    if (!sidebar || !isHoverMode(mode)) return;
    clearHideTimer();
    hideTimer = setTimeout(() => {
      sidebar.classList.remove("sidebar-revealed");
      hideTimer = null;
    }, HOVER_HIDE_MS);
  }

  function ensureHotzone() {
    if (hotzone || !isHoverMode(mode)) return;
    hotzone = document.createElement("div");
    hotzone.id = "sidebarHoverHotzone";
    hotzone.setAttribute("aria-hidden", "true");
    hotzone.addEventListener("pointerenter", reveal);
    document.body.appendChild(hotzone);
  }

  function teardownHotzone() {
    if (hotzone) {
      hotzone.remove();
      hotzone = null;
    }
    clearHideTimer();
    sidebar?.classList.remove("sidebar-revealed");
  }

  function bindSidebarEvents() {
    if (sidebar?.dataset.sidebarModeBound === "1") return;
    if (sidebar) sidebar.dataset.sidebarModeBound = "1";
    sidebar?.addEventListener("pointerenter", reveal);
    sidebar?.addEventListener("pointerleave", scheduleHide);
    sidebar?.addEventListener("focusin", reveal);
    sidebar?.addEventListener("focusout", scheduleHide);
  }

  function renderCollapseButton() {
    if (!collapseBtn) return;
    const compact = isCompactMode(mode);
    const hover = isHoverMode(mode);
    collapseBtn.setAttribute("aria-expanded", String(!compact));
    collapseBtn.setAttribute("aria-label", compact ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn.setAttribute("title", hover
      ? (compact ? "Reveal the full sidebar" : "Reveal the compact sidebar")
      : (compact ? "Expand sidebar" : "Collapse sidebar"));
    collapseBtn.innerHTML = `<span aria-hidden="true">${compact ? "›" : "‹"}</span>`;
  }

  function apply() {
    const desktop = !query || query.matches;
    const hover = desktop && isHoverMode(mode);
    const compact = desktop && isCompactMode(mode);

    sidebar?.classList.toggle("collapsed", compact);
    app?.classList.toggle("sidebar-hover-hidden", hover);

    if (!desktop) {
      // On mobile the sidebar is already a drawer; hidden/rail modes are
      // neutralised without forgetting the desktop preference.
      teardownHotzone();
      sidebar?.classList.remove("sidebar-revealed");
    } else if (hover) {
      bindSidebarEvents();
      ensureHotzone();
    } else {
      teardownHotzone();
    }
    renderCollapseButton();
  }

  function setMode(next, { silent = false } = {}) {
    mode = normalizeSidebarMode(next);
    persist();
    apply();
    if (!silent) emit();
  }

  function toggleCollapse() {
    setMode(toggleCollapseMode(mode));
  }

  function handleKeydown(event) {
    if (event.key !== "Escape") return;
    if (!isHoverMode(mode)) return;
    clearHideTimer();
    sidebar?.classList.remove("sidebar-revealed");
  }

  function handleStorage(event) {
    if (event.key !== SIDEBAR_MODE_KEY) return;
    mode = normalizeSidebarMode(event.newValue);
    apply();
    emit();
  }

  const onMediaChange = () => apply();
  query?.addEventListener?.("change", onMediaChange);
  collapseBtn?.addEventListener("click", toggleCollapse);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("storage", handleStorage);
  bindSidebarEvents();
  apply();
  if (loaded.migrated) emit();

  return {
    getMode: () => mode,
    setMode,
    toggleCollapse,
    reveal,
    apply,
    modes: SIDEBAR_MODES,
    subscribe(listener) {
      listeners.add(listener);
      listener(mode);
      return () => listeners.delete(listener);
    },
    destroy() {
      query?.removeEventListener?.("change", onMediaChange);
      collapseBtn?.removeEventListener("click", toggleCollapse);
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("storage", handleStorage);
      teardownHotzone();
      listeners.clear();
    }
  };
}
