# Appearance

The Appearance panel (profile menu → **Appearance**) controls three device-local
settings. None of them touch IndexedDB or the exported JSON; they live in
`localStorage` and follow the browser profile rather than the study data.

| Setting | Key | Values |
| --- | --- | --- |
| Palette | `neuronet:theme` | `forest`, `graphite`, `midnight`, `ember` |
| Surface | `neuronet:mode` | `dark`, `light` |
| Neural background | `neuronet:neural` | `on`, `off` |

## Sidebar layout

The sidebar's layout is a separate device preference, stored under
`nn-sidebar-mode` and managed by `src/sidebarMode.js`. It is not a theme, but
it follows the same local-only rules.

| Mode | Effect |
| --- | --- |
| `full` | Always show the full navigation (default). |
| `compact` | Always show the slim icon rail. |
| `hover-full` | Hide the sidebar; the left edge reveals the full panel. |
| `hover-compact` | Hide the sidebar; the left edge reveals the icon rail. |

The Timer tool header and the timer dock's `⋯` menu both edit this value. The
shell's collapse button flips between full and compact inside the current
family. Hover modes are neutralised below 701px, where the sidebar is already a
drawer.

Older builds used `nn-sidebar-collapsed` for the rail and the timer setting
`hideSidebar` for the off-canvas panel. On first load the controller folds both
into `nn-sidebar-mode` (`hideSidebar` + collapsed → `hover-compact`, one or the
other → its matching mode) and removes the legacy key.


## How it is wired

- `index.html` defines the token system in `:root` (dark Forest) plus one block
  per alternate palette and light-mode blocks. Components should use the
  tokens instead of hardcoded palette colours:
  - surfaces: `--bg-*`, `--surface-rgb`, `--surface-deep-rgb`, `--panel-*`,
    `--glass-*`, `--field-surface*`
  - ink: `--text-main`, `--text-rgb`, `--text-muted`
  - accent: `--accent`, `--accent-rgb`, `--accent-light`, `--accent-deep`,
    `--accent-contrast`, `--accent-soft`, `--accent-glow`
  - semantic: `--info`, `--info-soft`, `--info-cyan`, `--success`,
    `--warning`, `--tag`, `--quote`
  - alpha overlays: `--overlay-rgb` (white in dark, ink in light)
  - canvas: `--node-rgb`, `--node-soft-rgb`, `--node-bright-rgb`
- A small inline script in `<head>` applies the saved palette, mode and neural
  state before first paint, so refreshes never flash the default green theme.
  It also updates the `theme-color` meta tag.
- `src/main.js` owns the modal, persistence, cross-tab sync and the
  `neuronet-theme-change` / `neuronet-neural-change` events.
- `src/canvas.js` and `src/tools/mindmapTool.js` cannot resolve CSS variables
  inside canvas drawing code, so they cache the active RGB channels and refresh
  them on `neuronet-theme-change`.
- Turning the neural background off pauses the animation loop and hides the
  canvas. The body falls back to a calm two-tone wash.

## Adding another palette

1. Add a `:root[data-theme="<id>"]` block with the dark tokens and a
   `:root[data-mode="light"][data-theme="<id>"]` block with light overrides.
2. Add the palette to the inline pre-paint script's `themes` map.
3. Add the same id, name, description, chrome colours and swatches to `THEMES`
   in `src/main.js`.

Keep accents readable on both surfaces. Light mode usually needs a deeper
accent and darker semantic colours; error, warning and tag hues are tuned in
the base light block.
