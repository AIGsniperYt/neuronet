as well as properly displaying all metadata and figure out why the references arent shown in metadata, how tf does it reference stuff without?
analysistool headings dont allow spaces
mindmaptool allow star topology or a general sidebar treebuilder sidebar allowing user to rearrange how parents are rendered and bonds are made visually, featuring a tag as the centre or in general allowing users to build their mindmap as they wish setting the innermost parent of the star a tag for example, and allowing only some nodes to be rendered etc in short a comprehensive visual engine

revive cloud backend: reactivate the Node/Express sync backend (currently stale/unused) OR decide to archive it. Original intent was "use my own cloud" instead of depending on third-party JSON/email transfer; JSON export/import flow is now the de-facto cross-device sync standard and is faster, so if the backend is revived it should add real value (e.g. proper conflict resolution / diff-merge rather than coarse overwrite, or push-style sync), not just mirror what the JSON flow already does.

duplicate export/import flows: there are now TWO import/export systems — the app-wide dataset import/export (main.js / launchpad) and the past-paper tracker's own export/import. Decide a consistent story: separate tracker export (fine to keep, it's self-contained for the cross-device past-paper sync) vs a single unified app-wide backup. Keep the tracker one since past-paper sync is device-to-device via email JSON and shouldn't drag the whole DB around; document the boundary so it doesn't get confusing.

semantic linking between flashcards/nodes influencing the flashcard superprogram algorithm to show common "clusters" or bias them to learn related information in batches - could have potential to upgrade and autonomously link for you semantically, but aside from that, we have advantage over anki in a way because owning the complete study ecosystem meant we can pull additional metadata like analysis docs references citations and the file the node is from, as well as the mindmap tool's links to build knowledge clusters for the superprogram to feed off and teach - i believe from what i remember that the superprogram already does teach in batches favouring small sections until you learn them, so this is likely a layer on top upgrade to that, biasing the cluster size and allowing it to be dynamic, not static (ie take as much as it needs to fit one semantic topic in one batch rather than a fixed count for all) - that would be valuable

define canonical importance/accuracy/recall fields across quotes, analyses and cues, then wire sorting/filtering, richer tooltips and per-subject summaries to those signals. Do not alter flashcard/SuperProgram behaviour. (The Graph | Library switch, card signal encoding, legend and browse view are done.)

fix the create new flashcards to have a proper flow into just making your flashcards and saving them asap - then on save it will save unlisted but can ask you if you have the time to organise it to your chosen subject, after which it can simply be added neatly - flashcards should also be groupable by layer hierarchial organisation - especially for a level when it gets massive - a "deck" maybe shouldnt be a subject, but a topic and a literal mere "deck" after all

add task management to neuronet to handle todos

the context rail is super garbage, that needs to be fixed, overall the memory tool is really unclean and unprofessional and all over the place and needs to be fixed - need a unified sidebar - preferably a way to view all cards at once (unless the mindmap tool can help by doing that, not memory)

inspired by bma portal: add a quick link option to your classroom to access easily from neuronet - OH MY WOW GOOGLE CLASSROOM HAS A REST API FOR DEVELOPERS LETS ABSOLUTELY GO, WE CAN GET ASSIGNMENTS AND STUFF!!!

clean up mindmap tool - the double sidebar is a red flag and a big no no - styling and usability issues, make the heap reordering drag and drop etc QoL updates, functionally sufficient tho - also QoL is memory tool which has FAR too many view modes in top right, this is bloat like i said above and is redundant and poor, the explore in stats sidebar could potentially be a redundant library, all this needs a good sitting down and cleanup, but atleast its all here and done

remove layers to replace with tags, cus cant they do everything layers do but better?

sort internal per deck by date created from oldest to newest or vice versa 

---

# Audit briefs for fresh agents

Read-only audits: investigate, critique, and return a spec. The agent must not
modify, commit, or push code, and should keep scripts/screenshots in
`/tmp/opencode`.

## Shared preamble

```text
You are a senior frontend/UX engineer doing a read-only product and code audit.
Do not modify, commit, or push anything. Do not install dependencies. Your job is
a critical, evidence-backed report, not an implementation.

Repository: /home/aigsniper/Documents/website/neuronet/frontend
Product: NeuroNet, a local-first study app. Vanilla JS, no framework. Each tool is
an HTML fragment loaded into index.html. IndexedDB lives in src/db.js. Demo data
is demo-data.json. Tests: node tests/run.mjs.

HOW TO RUN
  cd /home/aigsniper/Documents/website/neuronet/frontend
  python3 -m http.server 5500
  open http://127.0.0.1:5500/index.html
Click the profile card (bottom left) -> Import Demo Data, then open the tool.
puppeteer-core is in node_modules; Chrome is /usr/bin/google-chrome. Emulate an
iPad at 834x1194 with touch. Put scripts/screenshots in /tmp/opencode and leave
the repo untouched.

CONTEXT YOU MUST RESPECT
- iPad/Safari is the primary device. Touch behaviour matters more than desktop.
- The app shell is intentionally fixed (no page drag/zoom). Do not propose
  restoring page scrolling or pinch-zooming the shell.
- No new frameworks or dependencies. Prefer deleting and merging over adding.

DELIVERABLE (markdown, in chat)
- Verdict: 3-5 blunt sentences.
- Evidence: screenshots and/or code references (file:line) for major claims.
- Ranked findings: user impact, confidence, effort (S/M/L), and whether each is
  delete / merge / rework / add.
- Target model: a simple description or ASCII sketch of the intended screen,
  including what gets removed.
- Phased plan: 3-5 independently shippable slices. Slice 1 must be small.
- Open questions for the owner.
- Explicit "do not do" list: tempting changes that would add bloat.

RULES
No generic UX advice. No framework migration. No vague "improve consistency".
Every recommendation must name what to remove or merge, not just what to add.
If something is already fine, say so.
```

## Memory tool (recommended first)

Scope: `tools/memory.html`, `src/tools/memoryTool.js`, and their integration
with `index.html` and `src/db.js`.

```text
SCOPE: the Memory tool (flashcards).

AUDIT QUESTIONS
1. What is the Memory screen's primary job at each moment (create, organise,
   study, browse), and does the layout actually support it?
2. Inventory every view mode, panel, rail, and drawer. Which earn their space,
   which are redundant, which should be deleted or merged?
3. Is the context rail useful, or should it become part of a unified sidebar?
   What content genuinely belongs there?
4. How do decks, subjects, tags, and cards relate in the UI and the data model?
   Where does the user's mental model break?
5. Is the stats/Explore surface a duplicate library? What should happen to it?
6. iPad ergonomics: reachability, scroll traps, focus/keyboard behaviour, tap
   targets, visual density.
7. Code health: duplicated render paths, dead markup/CSS, state that fights
   itself. Cite file:line.
8. What is the smallest first slice that makes the screen feel coherent without
   a rewrite?

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- The context rail feels "garbage".
- The top-right view modes feel bloated and redundant.
- The stats "Explore" panel may duplicate the library.
```

## Mindmap interaction

Scope: `tools/mindmap.html` and `src/tools/mindmapTool.js`.

```text
SCOPE: Mindmap interaction. Do not propose a graph-engine rewrite.

AUDIT QUESTIONS
1. The double sidebar is the owner's biggest complaint. What is each sidebar
   for, where do they overlap, and what is the single-sidebar target?
2. Assess the heap drag-and-drop feel on touch: floating row vs drop line,
   gap/insertion feedback, release, auto-scroll, accidental drags.
3. Inspector vs library split: what belongs in Details / Connections / Heap,
   and what should disappear?
4. Lock ergonomics (per-node locks only; no branch or global lock-all). Is Lock
   mode discoverable, and does it fight normal selection?
5. Search, filters and view modes on an iPad: which controls are redundant or
   badly placed?
6. Touch targets, scroll traps, focus/keyboard behaviour, toolbar crowding.
7. Code health around these interactions. Cite file:line.
8. Smallest first slice that removes the double-sidebar smell without a rewrite.

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- The double sidebar is a "red flag and a big no no".
- Heap reordering feels "super clunky rather than modern intuitive".
- Styling and usability need QoL work; functionality is sufficient.
```

## Flashcard creation

Scope: the create / quick-add / mass-edit paths in `tools/memory.html` and
`src/tools/memoryTool.js`.

```text
SCOPE: flashcard creation flow.

AUDIT QUESTIONS
1. Measure time-to-first-save for a single card. Where does the flow add
   friction before the card exists?
2. Should saving happen first and organising after? Design that flow.
3. Decks vs subjects vs tags vs layers: what is the intended hierarchy, where
   does the UI contradict the data model, and what should be removed?
4. What does the builder force on the user that could be optional or deferred?
5. Bulk entry and mass edit: what is missing or overbuilt?
6. iPad ergonomics for typing-heavy flows: keyboard, focus, scrolling, tap
   targets.
7. Code health in these paths. Cite file:line.
8. Smallest first slice that makes creating a card feel fast.

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- Creating cards should save them immediately as unlisted, then offer to
  organise them into a subject/topic.
- A "deck" may be a topic rather than a subject; large sets need hierarchy.
```

## Compact open issues

- Real iPad/Safari pass still pending: double-tap zoom, pinch, Lock mode
  ergonomics, toolbar crowding, heap drag-release feel.
- Mindmap layout is browser-local: no cross-device sync, no named snapshots.
- Locks made during the opening explosion persist after the settle timer, not
  immediately.

## Deliberately not doing (unless asked)

- Branch or subject locking, or a global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change. Filters point at
  nodes; the current physics behaviour is accepted. Revisit only if a filter
  visibly shoves nodes on a real device.

---

# Agent audit — DeepSeek V4.1 Flash

_Appended 2026-10-31. Read-only audit of Memory, Mindmap interaction, and Flashcard creation. This audit did not change code; this append is the only write._

## NeuroNet frontend audit — Memory, Mindmap, Flashcard creation

**Scope:** read-only audit of `neuronet/frontend`, iPad-first with desktop regression checks. No code files were modified, no dependencies installed, nothing committed. Appending this section to `todo.md` is the only write.

**Method:** Chromium via `puppeteer-core`, isolated browser contexts, demo import. Viewports: iPad portrait `834×1194` touch, iPad landscape `1194×834`, desktop `1440×900`. Screenshots in `/tmp/opencode/shots`; measurements in `/tmp/opencode/*.json`.

**Limit:** this is Chromium emulation, not real Safari/iPadOS. I am not claiming Safari-engine bugs. Gesture findings are behavior-level and were verified through pointer events and persisted camera state.

**Priority scale:** P0 = breaks the task or trust; P1 = significant friction; P2 = polish/code health. Confidence is confidence in the finding, not in the fix.

---

### 0. Verdict and owner complaints

| Surface | Verdict |
|---|---|
| **Memory** | The study card itself is good. The surrounding system is not iPad-first: a subject/deck data-model conflation, three overlapping right-side surfaces, a stats drawer that re-renders every second, and a card browser trapped inside Stats. Needs structural deletion, not more UI. |
| **Mindmap** | The graph interaction is the strongest part of the frontend. Pan, pinch, drag, and keyboard all work. The chrome is overbuilt: 11 pills, 3 view modes, duplicated heap controls, and a covered toggle. Fix by deleting, not adding. |
| **Flashcard creation** | Functionally present, but the modal is not actually modal, creation is split across three entry points, and the deck description field collects data that is never saved. One sheet plus one edit screen would remove most of the friction. |

#### Owner complaints — verified, with nuance

| Complaint | Verdict | What is actually wrong |
|---|---|---|
| Context rail feels “garbage” | **Partly confirmed** | The content is sparse because most cards have no linked knowledge. The real defect is the presentation: a persistent 320px rail that becomes a 340px overlay on iPad, covers ~60% of the card, and duplicates the header “Knowledge” button with a second collapse control. |
| Top-right view modes feel bloated/redundant | **Confirmed** | Three icon-only modes on iPad, plus 11 stat pills, plus six header controls. Dots shows 14 identical dots and repeats Library metadata. It is redundancy, not just density. |
| Stats “Explore” may duplicate library | **Confirmed** | Explore is a card browser living inside Stats. It overlaps the middle filter screen and Mindmap Library, and on an empty deck it loops forever on “Loading cards…”. |

---

### 1. Memory

#### 1.1 What is already fine — do not touch

- **Desktop study layout is sound.** At `1440×900`, header is 73px, the card is ~775×634, grade buttons are 44px high, and the context rail docks at 320px without covering the card (`10-launchpad-desktop.png`, `12-study-desktop.png`).
- **iPad landscape is usable.** At `1194×834`, the card and grade bar are both visible; there is no page-level scroll trap (`20-study-landscape-ipad.png`, `95-study-landscape-clean.png`).
- **The card/grade loop works.** Flip, grade, next-card, and keyboard arrows are understandable. The card face is self-contained; context is optional by design.
- **The middle filter screen has a clear job.** Subject name, filters, and one Study CTA are readable (`02-middle-ipad.png`). The problem is that it is a separate screen from deck selection, not that it exists.

#### 1.2 Evidence summary

- iPad content area is **602px wide** after the fixed **232px** sidebar. Deck cards are **320×208** in a **single column**.
- Demo data produces **9 deck rows**, **8 of them with 0 items**. Macbeth has 29 cards and is the **7th row**. The list is roughly 2,000px tall on iPad; Macbeth is around `y=1717`.
- Stats drawer: `left 474`, `width 360`, `height 1194`, `top 0`. Context rail: `left 474`, `width 360`, `top 161`, `height 957`. **Overlap = 360px.** Stats `z-index: 20`; rail `z-index: 14`.
- Stats re-render produced **6 DOM mutations in 2.6s**; focus moved from the active filter button to `BODY` after **1.3s**.
- Empty-deck Explore remained on **“Loading cards…”** at 300ms, 1.8s, and 3.8s.
- Space on a focused `Stats` button **flipped the card** and did not activate the button. Enter then opened Stats.
- Closed stats drawer remained in tab order: collapse, priority, Reset Data, close, Focus, Router, Inspect, Explore.
- Tap sizes: stats close **31.3×28.2**, Reset Data **83.6×23.5**. Grade buttons are 44px and fine.

Screenshots: `01-launchpad-ipad.png`, `02-middle-ipad.png`, `03-study-front-ipad.png`, `04-study-back-ipad.png`, `05-stats-focus-ipad.png`, `06-stats-*.png`, `07-context-rail-ipad.png`, `91-stats-and-rail-ipad.png`, `92-empty-deck-explore-ipad.png`.

#### 1.3 Ranked findings

| # | Finding / evidence | Impact | Conf. | Effort | Action — remove or merge |
|---|---|---|---|---|---|
| **M1** | **Deck list is every subject, not every deck.** `getSubjects()` unions node subjects, quote subjects, and card deck names (`src/db.js:1462-1479`). There is no deck entity. Demo shows 9 rows, 8 empty; Macbeth is 7th. | High | High | L | **Remove subject-derived deck rows.** Make cards the source of truth for membership; add only a small deck-metadata record for name/description/order. Hide 0-card decks behind “Show empty”. Do not add a second taxonomy. |
| **M2** | **Stats and context rail can open simultaneously with identical geometry.** Both `left 474 / width 360`; overlap 360; stats z20 over rail z14. Stats overlays header, card, and grade controls (`91`). | High | High | M | **Remove the stats drawer.** Make Stats a separate view/route, unmounted when closed. Enforce one right-side surface at a time. |
| **M3** | **Explore is a third card browser and deadlocks on empty decks.** `renderExploreMode` writes “Loading cards…” then calls `loadExplorerCards`, which re-renders into the same branch (`src/tools/memoryTool.js:4106-4155`; `92` at 3.8s). | High | High | M | **Delete the Explore tab and its loader.** Keep one card browser (Library) and link to it. If Explore survives, fix the empty branch and remove the duplicate list UI. |
| **M4** | **Stats re-renders every second and destroys focus.** `setInterval(..., 1000)` calls `renderSidebar()` (`memoryTool.js:509-521`). Focus moved to `BODY` after 1.3s; 6 mutations/2.6s. | High | High | S | **Remove the interval.** Render on state change; pause when hidden. Preserve focus and scroll position. |
| **M5** | **Space on a focused button flips the card.** Global keydown ignores only `INPUT`/`TEXTAREA` (`memoryTool.js:1016-1063`). Space on Stats did not activate the button. | High | High | S | **Scope study shortcuts to the card/study surface.** Ignore `BUTTON`, `A`, `SELECT`, `[role=button]`, `[contenteditable]`; do not `preventDefault` Space on controls. |
| **M6** | **Closed drawer remains tabbable.** Tab reaches collapse, priority, Reset, close, and all four tabs while closed. | High | High | S | **Use `inert` + `aria-hidden` + `visibility:hidden` when closed.** Remove from tab order; do not rely on transform/off-canvas. |
| **M7** | **Context rail is a persistent 320px panel that becomes an overlay on iPad.** `memory.html:496-508`, `3494-3515`; `07` shows it covering ~60% of the 578px card. Two controls manage the same state: header “Knowledge” and rail “›”. | Med-High | High | M | **Merge to one Context button.** On iPad use a bottom/full-height sheet; on desktop keep a docked rail but default collapsed. Delete the always-on rail and the second collapse control. |
| **M8** | **Study header has six controls and a mode cycle.** Card, Back, Knowledge, mode, New Session, Stats (`memory.html:4-11`); mode is one button cycling six modes (`memoryTool.js:474-486`). | Med | High | M | **Keep Back + one primary action.** Move Stats, New Session, Knowledge into overflow. **Delete the mode cycle**; choose mode in study setup with a labeled select. |
| **M9** | **Launchpad is one 320px column at 602px width, and most rows are empty.** 8/9 rows are 0-item; six controls including disabled “Study All Subjects (WIP)” (`01`, `10`). | Med | High | S | **Use two columns at ≥560px or compact rows.** Show card count + last studied. **Remove the disabled WIP action and duplicate Add Cards entry.** Sort by last studied, not alphabetically. |
| **M10** | **Tap targets below 44px.** Stats close 31.3×28.2; Reset Data 83.6×23.5 (`measure.json`). | Med | High | S | **Raise to 44×44.** Move Reset Data out of the header into a danger zone. Replace the tiny close glyph with a 44px icon button. |

#### 1.4 Target model

**“Deck library → deck page → study” with one primary action per screen.**

- **Deck library:** real decks derived from cards, with card count, last studied, and one **Study** action. Empty pseudo-decks hidden by default. Add Cards is the only creation entry.
- **Deck page:** merge the launchpad and middle filter screen. Selecting a deck opens one page with its filters and one **Study** button. Delete the separate middle screen.
- **Study:** card + grade bar. Header is **Back** + one primary; everything else in overflow. Context is on demand as a sheet, not a permanent rail.
- **Stats:** separate view, mounted only when active. Tabs Focus/Inspect/Router can stay; **Explore is deleted** and card browsing lives in the Library. No 1-second interval.

#### 1.5 Shippable slices

| Slice | Ships | Removes | Effort |
|---|---|---|---|
| **M-S1: Delete the dead loop** | Remove Explore tab + `loadExplorerCards`/`renderExploreMode`; link card browsing to Library. Remove the 1s stats interval. | Duplicate card browser, infinite loading, focus churn. | S |
| **M-S2: Keyboard and focus correctness** | Scope shortcuts to study; inert closed drawers; 44px close/reset; visible focus. | Space-flips-button bug, tab-order leak, tiny targets. | S |
| **M-S3: One right-side surface** | Stats becomes a route/view; context becomes an on-demand sheet; one toggle; mutual exclusion. | Stats drawer, always-on rail, duplicate collapse control. | M |
| **M-S4: Deck model + launchpad** | Cards are source of truth; lightweight deck metadata; 0-card rows hidden; 2-column launchpad. | Subject-derived fake decks, 2,000px empty list, disabled WIP action. | L |
| **M-S5: Header simplification** | Back + primary + overflow; mode as setup select; remove mode cycle. | Six-button header, unlabeled mode cycling. | S |

---

### 2. Mindmap interaction

#### 2.1 What is already fine — do not touch

- **Gestures work.** One-finger pan changes the camera; pinch changed zoom from **0.45→1.04**; node drag persists layout; keyboard arrows and `+`/`−` work (`80`, `81`; `gesture-debug2.json`). No gesture bug found.
- **Per-node locks and no global lock-all are deliberate.** Keep them. The canvas is not the problem.
- **One tabbed inspector is the right architecture.** Keep one inspector. The problem is that Heap became a second control surface, not that the inspector exists.
- **Desktop is good.** At `1440×900`, all 11 pills fit in one row (`scrollWidth 1144 / clientWidth 1144`), the inspector docks beside the canvas at 320px, canvas remains 794px, and there is no backdrop (`86`, `87`, `88`). Do not degrade this to match iPad.
- **The graph itself is the strongest surface.** Do not rewrite physics or camera code as part of this cleanup.

#### 2.2 Ranked findings

| # | Finding / evidence | Impact | Conf. | Effort | Action — remove or merge |
|---|---|---|---|---|---|
| **MM1** | **11 stat pills overflow on iPad.** `scrollWidth 1062` vs `clientWidth 578`; right-side pills are clipped. Global CSS hides every scrollbar (`tools/mindmap.html:11-17`), so there is no affordance. Pills are filters in Graph and disabled elsewhere (`mindmapTool.js:4926-5015`, `633-644`; `40`). | High | High | M | **Replace with one summary line** (“14 nodes · 9 decks · 29 cards · 12 links”) + a Stats sheet. Keep **one graph-type filter dropdown** in the canvas toolbar. **Delete 8 pills** and the hidden-scrollbar hack. |
| **MM2** | **Three view modes, icon-only on iPad.** Buttons are 36–40×40, labels hidden; Dots shows 14 identical dots and repeats Library metadata (`47`; `mindmap.html:2119-2128`). | High | High | M | **Delete Dots.** Keep **Graph** and **Library** as two labeled tabs. Remove the icon-only view-toggle CSS and the duplicate Dots legend. |
| **MM3** | **Heap state has three control surfaces and a covered toggle.** Library bar + inspector Heap tab + header toggle. `+Heap` is **57.9×27**. Creating a heap auto-opens the inspector; its backdrop/panel covers `#toggleHeapSidebarBtn`; `elementFromPoint` returns `.library-heap-item`, so pointer taps cannot close it (DOM `.click()` works) (`98`, `99`; `heap-check.json`; `createHeap` 2179-2206; toggle 5475-5495). | High | High | M | **Keep one heap bar in Library:** select, New, Add selected, Study, Delete (overflow). **Delete the header toggle and inspector mutators.** Do not auto-open the inspector on create; show the new heap selected + toast. If the inspector opens, relocate/raise the toggle or remove the backdrop. 44px targets. |
| **MM4** | **Header has six controls and duplicates canvas actions.** 3 view buttons + Connect Nodes + Re-layout + New Node. Connect/Re-layout are graph actions already conceptually belonging to the canvas (`40`, `86`). | Med | High | M | **Move Connect, Re-layout, Fit, Lock into one canvas toolbar.** Header keeps title + New Node + Graph/Library tabs. **Delete the duplicate header buttons.** |
| **MM5** | **Library spends 199px on chrome before the first card.** Legend 85px + toolbar 114px at iPad; toolbar holds search, sort, select, and heap controls (`48`). | Med | High | S | **Collapse the legend to one line or a help popover.** Merge sort/select into one row; move heap actions into one bar. **Remove duplicate labels and controls.** |
| **MM6** | **The same pills mean different things by view.** In Graph they filter; in Library/Dots they are disabled stats (`syncGraphFilterUI` 633-644). | Med | Med-High | S | **Separate stats from filters.** One filter control in Graph only; Stats sheet read-only. **Remove disabled pill states.** |

Screenshots: `40-mindmap-graph-ipad.png`, `41-inspector-details-ipad.png`, `43-inspector-heap-ipad.png`, `47-dots-ipad.png`, `48-library-ipad.png`, `82-library-heap-created-ipad.png`, `84-heap-toggle-open-ipad.png`, `98-heap-one-card-ipad.png`, `99-heap-inspector-real-ipad.png`, `86/87/88` desktop, `89/90` landscape.

#### 2.3 Target model

**“Graph + Library, one inspector, one heap control set.”**

- **Header:** title, **New Node**, **Graph / Library** tabs. Nothing else.
- **Canvas toolbar:** Fit, Lock mode, Re-layout, Connect (Graph only), plus one filter dropdown.
- **Stats:** one compact summary line; tap for a read-only sheet. No 11-pill row in the header.
- **Library:** search, sort, select, and **one** heap bar: select heap, New, Add selected, Study, Delete (overflow). Card `+ Heap` stays as the per-card action.
- **Inspector:** keep the single tabbed inspector. Make Heap a read-only summary or remove heap mutations from it. No second panel, no second toggle.
- **Keep:** per-node locks, no global unlock-all, existing pan/pinch/drag/keyboard behavior, desktop docking.

#### 2.4 Shippable slices

| Slice | Ships | Removes | Effort |
|---|---|---|---|
| **MM-S1: Delete Dots** | Two labeled view tabs, Graph/Library. Delete Dots code, markup, CSS, legend. | Third view, 14 identical dots, icon-only mode switch. | S |
| **MM-S2: Stats summary** | One summary line + Stats sheet; one graph filter dropdown. | 11-pill overflow, hidden scrollbars, dual-meaning pills. | M |
| **MM-S3: One heap surface** | Single Library heap bar; no auto-open; toggle reachable; 44px. | Header toggle, inspector mutators, backdrop-covered control. | M |
| **MM-S4: Canvas toolbar** | Connect/Re-layout/Fit/Lock in one canvas toolbar; header decluttered. | Six header controls and duplicated graph actions. | M |
| **MM-S5: Library density** | One-line legend, merged toolbar row, 44px card actions. | 199px of pre-card chrome, duplicate heap labels. | S |

---

### 3. Flashcard creation

#### 3.1 What is already fine — do not touch

- **Single card / Bulk paste is the right split.** The textareas are 576×60 on iPad, comfortably tappable.
- **Save & Next is the right primary loop.** It keeps the user in flow.
- **Escape and Ctrl/Cmd+Enter work.** The modal stops study shortcuts from leaking through (`memoryTool.js:881-900`). Keep that behavior when rebuilding the sheet.
- **Build Deck step 1 is simple.** Name/description and a 44px “Next: Add Cards” button. Do not add more wizard steps.
- **Desktop modal shape is good.** `858×519` with a 260px summary column; the problem is containment, not the desktop layout.

#### 3.2 Ranked findings

| # | Finding / evidence | Impact | Conf. | Effort | Action — remove or merge |
|---|---|---|---|---|---|
| **C1** | **The modal is not modal to the app shell.** Overlay spans only `left 232 → right 834`; the sidebar stays bright and clickable (`elementFromPoint` at sidebar center = `SPAN`). Panel uses `--panel-bg` alpha 0.6 (`index.html:41`), so deck cards bleed through (`93`; `30`, `31`, `32`). | High | High | S | **Portal the modal to `body` with `position:fixed; inset:0`.** Use an opaque `--panel-strong` or solid surface. Make the background `inert` and trap focus. Keep Esc/Ctrl+Enter. |
| **C2** | **Three creation entry points.** Launchpad “Add Cards +” (`quickAddLaunchBtn`), header “+ Card” (`quickAddHeaderBtn`), and Build Deck’s “Add New Card” (`addNewCardBtn`). Build Deck adds a fourth screen with steps 1–3 (`createDeckBtn`, `finishDeckBtn`). | High | High | L | **Create one “Add Cards” sheet:** destination deck, Single/Bulk, Save & Next, Done. **Delete the header +Card or the launchpad Add Cards** — keep one. **Reduce Build Deck to “Edit Deck”**: name, description, reorder, delete. Remove step 2 from creation. |
| **C3** | **Finish Deck is available with 0 cards, then only alerts.** `saveDeckToDB` rejects at `deckBuilderState.cards.length === 0` (`memoryTool.js:4936-4944`). No visible count or disabled state. | Med | High | S | **Disable Finish at 0 and show “0 cards”.** Make Save Card primary. Or add an explicit “Create empty deck” secondary. **Remove the alert-only dead end.** |
| **C4** | **Deck description is collected but never persisted.** Assigned at `memoryTool.js:719`, reset at `4630-4636`, never written to DB. | Med | High | S | **Persist it in deck metadata or delete the field.** Do not collect data that is discarded. |
| **C5** | **iPad step 2 collapses the deck summary to 576×84.** The form is 576×623; name/description disappear while adding cards (`create.json`; `32`). | Med | High | S | **Keep a one-line sticky summary** (deck name + card count) above the form. **Remove the collapsing sidebar** at this breakpoint. |
| **C6** | **Actions and tabs are below 44px.** Quick Add tabs 35px; Save/Finish actions 40px; Build Deck actions 40px (`create.json`). | Med | High | S | **Raise to 44px.** Use one primary action per row. **Remove duplicate Save & Close / Finish Deck hierarchy** and make “Done” secondary. |

Screenshots: `30-quickadd-ipad.png`, `31-builddeck-step1-ipad.png`, `32-builddeck-step2-ipad.png`, `93-quickadd-overlay-bounds-ipad.png`; desktop: `30-quickadd-desktop.png`, `31/32-*-desktop.png`.

#### 3.3 Target model

**One “Add Cards” sheet, one “Edit Deck” screen.**

- **Add Cards sheet:** destination deck, Single/Bulk, Save & Next, Done. Full viewport overlay, opaque, focus-trapped. On iPad, full-height sheet with 16px margins.
- **Edit Deck:** name, description, card order, delete. No creation wizard step 2.
- **Deck metadata:** persist name/description in one place; do not keep a description field that is not saved.
- **Zero-card state:** explicit count; Finish disabled; no alert dead end.
- **Remove:** header +Card or launchpad Add Cards (keep one), Quick Add modal duplication, collapsing step-2 sidebar.

#### 3.4 Shippable slices

| Slice | Ships | Removes | Effort |
|---|---|---|---|
| **C-S1: Contain the modal** | Fixed full-viewport overlay, opaque panel, inert background, focus trap. | Sidebar bleed, transparent panel, background clicks. | S |
| **C-S2: One Add Cards entry** | Single sheet with destination + Single/Bulk + Save & Next. | Header +Card / duplicate Quick Add entry. | M |
| **C-S3: Edit Deck** | Build Deck reduced to name/description/reorder/delete; description persisted. | Creation wizard step 2 and dead description field. | M |
| **C-S4: Zero-card + action hierarchy** | Finish disabled at 0; count visible; Save Card primary; Done secondary. | Alert-only dead end, duplicate primary actions. | S |
| **C-S5: Targets and iPad layout** | 44px tabs/actions; 16px sheet margins; sticky deck summary. | 35–40px controls, flush-to-sidebar modal, collapsing summary. | S |

---

### 4. Cross-cutting code health

| # | Finding / evidence | Impact | Conf. | Effort | Action |
|---|---|---|---|---|---|
| **X1** | **Two monoliths.** `memoryTool.js` is **6,038 lines / 164 functions**; `mindmapTool.js` is **6,216 lines / 175 functions**. State, rendering, DB writes, and gestures all live in one scope. | Med | High | L | Split by surface **after** deleting duplicate code. Do not introduce a new state library; extract the surviving views into modules. |
| **X2** | **Duplicate scheduling helpers.** `computeBasePriority`, `computeOverdueBoost`, `computePhaseBoost` exist at `memoryTool.js:4077-4093` and again at `4284-4300`. In the same module scope, the later declaration wins and the earlier is dead. | Med | High | S | **Delete one set.** Keep one canonical implementation; add a single test fixture for priority ordering. |
| **X3** | **Duplicate `getMemoryStateFromMeta`.** `memoryTool.js:1687` and `:4094` have different clamping/defaults; one is effectively dead. | Med | High | S | **Delete the unused version.** Keep one canonical schema conversion. |
| **X4** | **Duplicate CSS.** Explorer CSS at `memory.html:3012-3150` vs `3383-3450`; stats-tab CSS at `:1247-1274` vs `:3157-3190`. | Low-Med | High | S | **Keep one block per component.** Delete the duplicate cascade so future edits cannot diverge. |
| **X5** | **No shared modal/overlay primitive.** Deck builder and Quick Add each define overlay/panel styles; `src/tools/dialog.js` already exists for dialogs. | Med | High | S | **Merge onto one overlay primitive** with shared opaque panel, focus trap, and inert background. Do not add a UI framework. |
| **X6** | **Deck/subject conflation is structural.** `getSubjects()` at `db.js:1462-1479` is the root cause of fake decks and the 2,000px empty launchpad. | High | High | L | **Fix the data model once** (see M1). Do not paper over it with list virtualization. |

Also note: synthetic pinch produced `setPointerCapture` page errors in the harness. Real pointer gestures worked and persisted. That is a test artifact, not a product finding.

---

### 5. Suggested sequence

**Phase 1 — Delete and stabilize (days).**  
M-S1, M-S2, MM-S1, C-S1, C-S4, X2, X3, X4. Low-risk removals and correctness fixes. This phase alone removes the infinite Explore spinner, the 1-second focus theft, the Space-on-button bug, Dots, the transparent modal, and duplicate code.

**Phase 2 — Consolidate surfaces (about a week).**  
M-S3, MM-S2, MM-S3, MM-S4, C-S2. One stats surface, one context surface, one heap bar, one canvas toolbar, one Add Cards entry.

**Phase 3 — Data and layout (1–2 weeks).**  
M-S4, M-S5, MM-S5, C-S3, C-S5, X1. Deck metadata, launchpad density, Edit Deck, library density, and the module split. Do this only after the deletions, so the split does not preserve dead code.

---

### 6. Open questions

1. **What is a deck, semantically?** A user-created container, or a view of a subject? Can a deck be empty? When a deck is deleted, do cards get deleted or just unassigned?
2. **Should empty subjects appear in Memory at all?** If yes, as a separate “Subjects with no cards” section, not as studyable decks.
3. **Which card browser is canonical?** Memory middle screen, Stats Explore, or Mindmap Library? Pick one and link the other two to it.
4. **Is Dots used for anything?** If it is not an active review/analytics workflow, delete it. If it is, it needs a distinct job, not a second Library.
5. **Is deck description used by export, AI, or study?** If no, delete the field. If yes, persist it in deck metadata.
6. **Does Stats need real-time refresh?** If not, render on open and on explicit refresh. The 1-second interval has no user value demonstrated.
7. **Are heaps global or deck-scoped?** The UI implies global/cross-deck. Confirm before consolidating the heap bar.
8. **What is the minimum desktop width?** The desktop dock is good at 1440; define what happens at 1024–1280 before removing the iPad overlay behavior.
9. **Real Safari/iPadOS verification:** run the same flows on device, especially keyboard focus, `inert`, backdrop hit-testing, and pointer capture. The Chromium results are strong but not a Safari substitute.
10. **Migration tolerance:** can empty subject-derived decks be dropped without user complaint? If not, label them explicitly as “subject, no cards” rather than “deck.”

---

### 7. Do not do

- **Do not add a new framework, state library, or dependency** to solve layout/state. The problems are duplication and missing hierarchy.
- **Do not add a global “unlock all” or change per-node locks.** That is deliberate and out of scope.
- **Do not add a second inspector, more drawers, or more tabs.** The fix is fewer surfaces, not better-organized ones.
- **Do not rewrite graph physics, pan, pinch, drag, or keyboard camera controls.** They work.
- **Do not build a third card browser.** Delete or merge the existing ones first.
- **Do not add onboarding, tooltips, or coach marks to explain clutter.** Remove the clutter.
- **Do not virtualize the deck list before fixing the deck model.** It would make a 2,000px list of fake decks faster.
- **Do not hide overflow with `scrollbar-width: none`.** That is already why the 11-pill bar fails silently.
- **Do not run a destructive deck migration without an export/backup path.**
- **Do not “fix” iPad by degrading desktop.** Keep the desktop dock, 44px grade targets, and one-row stats where they fit.
- **Do not use native `confirm`/`prompt`/`alert`.** Use the existing `dialog.js` primitive.
- **Do not remove keyboard shortcuts.** Scope them so buttons and inputs work normally.

**Bottom line:** delete the duplicate surfaces first — Memory’s Explore/stat drawer/persistent rail, Mindmap’s Dots/pills/duplicate heap controls, and the extra creation entry points. Then fix the deck model and the modal containment. The graph interaction and the desktop study layout are already good; preserve them.

---

# Owner decisions — reply inline

_I'm working on the safe engineering pile now; nothing below blocks that. This
section is yours. Add your answers under each question and tell me when you're
done — I won't edit this section until then._

## What I'm doing now (no product decisions)

- Fix the Explore empty-deck infinite loop, without deleting Explore yet.
- Remove the 1-second Stats re-render and its focus theft.
- Scope study keyboard shortcuts so Space/arrows don't hijack buttons, links,
  selects, or editable fields.
- Make closed Stats/context drawers inert and untabbable.
- Contain the Add Cards / deck modals to the viewport with an opaque panel.
- Disable Finish at zero cards and show the count.
- Delete the duplicate priority helpers and duplicate
  `getMemoryStateFromMeta`.
- Raise the tiny Stats close / Reset Data targets to 44px.

Files in play: `src/tools/memoryTool.js`, `tools/memory.html`, possibly
`index.html`. I will not touch Mindmap during this pass.

## What I'm not touching until you decide

Deck model, Memory header restructure, context rail, Mindmap pills/Dots, canvas
toolbar, module split. Those are the questions below.

## Comments before you answer

- Your "too many view modes in the top right" complaint maps to **M8 in
  Memory**, not Mindmap: `+ Card`, Back, Knowledge, a single `modeSelect`
  button cycling six modes, New Session, Stats. The audit's Mindmap pill/Dots
  recommendations (MM1/MM2) are separate observations.
- MM1/MM2 still have real evidence (pills clip on iPad; Dots repeats Library),
  but the *removal* is a product choice. Treat them as evidence, not a mandate.
- MM3's "delete inspector heap mutators" should mean delete the duplicate
  header toggle and auto-open, **not** the heap list. The list is the good part.
- The audit's demo data makes Memory look worse than real use might: 8 of 9
  decks are empty. The structural issue is real, but don't size the redesign
  off that number alone.

## 1. What is a deck?

Is a deck a real container separate from a subject? Can a deck be empty? When a
deck is deleted, should its cards be deleted or just unassigned?

My default: decks are first-class; cards are the source of truth; empty decks
are allowed but hidden behind "Show empty"; deleting a deck unassigns cards.

**Your answer:** yes decks are a temporary collection of cards, which could be confusing - but take it as this analogy, your full cards set is absolute like a library, a deck is merely like a collection of books you can collect into a pile and take with you to study in a session, and even save them so you can instantly cash out the same pile or modify it without redoing it. a subject is the canonical owner of that card, if it has one, and its something like biology or whatever, a deck is simple something like exam questions, or fact recall, or biological molecules, cards arent exclusive to one deck, a deck is a pile of references to the actual books borrowed, not transferred ownership, its permanent in the sense it saves for users like an easy list to cash out without losing it over sessions, but its temporary in the sense its unassigned and is nothing but a name and a list of references for convenience, which the memory tool allows you to take inside to study using its machinery but letting you manual override the scheduling the srs algo does for you, instead picking which cards and what order you wanna do, however, it still takes your data and it counts as training, contributing to your stats

## 2. Which card browser is canonical?

Memory library, Stats → Explore, or Mindmap Library? Pick one; the other two
link to it.

My default: Memory library is canonical; Explore is deleted; Mindmap Library
stays a different lens, not a replacement.

**Your answer:**uh sure ur default seems right but i dont quite understand, talk to me about this one, but yeah i thought since mindmap is the tool to handle your database like an easy view layer with no intent to modify or use the data like analysis tool can analyse and highlight sources as its purpose or the memory tool purpose is to teach this into your memory, not primarily to let you view it, mindmap is purely for viewing and for basic CRUD operations on your database, nothing complex like the other tools, just seeing and handling your knowledge data 

## 3. Which study modes do you actually use?

Card, Quote, Analysis, Evidence Matching, Blurt, Manual.

My default: keep Card/Quote/Analysis, hide the rest if unused, replace the
cycle button with a labelled select in study setup.

**Your answer:** idk - this i feel like is a bad question because the idea shouldnt be to delete this since we want our tool to be useful and super powerful with multiple ways to learn and drill things into memory, theres always something for everyone, so the biggest complaint was making the ux and the flow of the ui less bloated while preserving this level of capability, even if it is admittedly a stub, mainly only using cards - this model can be outdated and stale too since the big cards update where we made card objects their own thing, so its no longer the case of quote and analysis nodes together generating a card but yh, thats its whole discussion, but the bottom line point is to try to aim to remove ui and ux flow bloat, not functionality, though admittedly the other ones barely function cus ive not given them attention 

## 4. Mindmap: Dots and stat pills

Do you use Dots? Do you use the 11 pills as filters?

My default: keep Dots if you use it; keep pills but fix the iPad overflow with
a summary line or a proper scroll affordance, rather than deleting them.

**Your answer:**once again terrible question, you cant remove a whole view, and yes its meant to be good imagine wanting to navigate all your flashcards before an exam and hammer in weak ones, dots is so much better than graph because it focuses only on cards and compactly shows so much info - this isnt a question to remove, youre right, maybe we can do something about it on ipad but no deletion

## 5. Mindmap: one heap surface

Keep the inspector Heap tab as the one list (the drag work stays) and remove
the header toggle + auto-open? Or move the heap controls to the Library bar?

My default: keep the inspector list, remove the duplicate toggle/auto-open.

**Your answer:**not quite sure wat the q is - talk abt this

## 6. Context rail

Docked on desktop + sheet on iPad, or collapsed by default everywhere?

My default: docked on desktop, sheet on iPad, one toggle.

**Your answer:** talk abt this w me - i just dontt like how out of place it is, it literally doesnt belong here naturally - serious design discussion

## 7. Appetite

Should I keep going with the safe pile, then bring you a one-page Memory target
before any structural edit?

**Your answer:** you alr began work, this q is stale and im ignoring it

## Screens worth opening

Audit screenshots are in `/tmp/opencode/shots`. The ones that matter most:
`91-stats-and-rail-ipad.png`, `92-empty-deck-explore-ipad.png`,
`98-heap-one-card-ipad.png`, `99-heap-inspector-real-ipad.png`,
`30-quickadd-ipad.png`, `32-builddeck-step2-ipad.png`.

