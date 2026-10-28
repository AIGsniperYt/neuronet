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

---

# Mindmap audit (senior review, appended after the checklist above)

Reviewed `tools/mindmap.html` (~1,790 lines) and `src/tools/mindmapTool.js` (~4,470 lines), plus how the tool is launched from `src/main.js` and `src/tools/memoryTool.js`.

## Reframing

The tool is currently three products in one:

1. a force-directed **knowledge graph** (subjects → layers → sources → quotes → analyses → cues → tags),
2. a **card deck browser** (`Library`),
3. a **manual study-set builder** (heaps).

That is why the layout, controls and terminology feel like they are fighting each other. The double sidebar is a symptom of not having decided which of those is the primary surface.

Mindmap is an **admin/navigation lens over the database**, not a processing tool. It should do CRUD plus make the data legible in different ways. The canvas is the primary surface; everything else belongs in one inspector.

## What is genuinely good

- Card signal language: priority border, split recall/accuracy dot, R/A labels, Library/Dots legends.
- The Graph → Dots morph reads as one surface changing shape.
- Card-first scoping works: a deck can exist with no knowledge nodes.
- Inspector source markdown rendering matches the Analysis tool.
- Empty states and narrow-screen handling show real thought.

## Critical issues

### 1. Connecting a card can corrupt the database

`findItemById()` returns cards as plain objects with `type: "card"` (`mindmapTool.js:3225`). `linkNodes()` falls through to the generic path and calls `addNode(item)` for anything that is not a quote or cue. So using **Connect Nodes** on a card writes a card record into the `nodes` store. `breakLink()` has the same bug. It is also invisible: `buildGraph()` never reads manual links from cards.

Fix: block cards in connect mode until a real card-link model exists.

### 2. Every database change resets the graph layout

`handleDBChange()` → `refreshData()` → `layoutRadial()`, which reassigns every non-card node to a random position in a tiny cluster near the centre (`mindmapTool.js:3166-3203`). Adding a tag, deleting a quote, reordering a heap — all restart the graph. Card positions survive; knowledge-node positions do not.

Fix: preserve existing positions across refreshes; seed only new nodes. Keep the re-explode as an explicit **Re-layout** action.

**Layout policy:** automatic reset on every DB change is the wrong default, but the reset animation is genuinely satisfying and worth keeping as a deliberate feature. Store positions canonically (persisted per node, not regenerated), and offer:
- normal refresh = positions are stable;
- explicit **Re-layout** = the current re-explode animation;
- later, optional saved layout snapshots for large graphs, so a user can return to a known arrangement.

Canonical storage means "position is data", not "position is a side effect of rendering". That is also what makes authored tree/star layouts possible later.

### 3. Drag is broken in several ways

- `dragOffset` is computed on mousedown but never applied on mousemove, so the dragged node snaps its centre to the cursor.
- `mouseleave` clears `draggingNodeId` but never unlocks the node, leaving permanently stuck locks.
- No pointer capture and no window-level release, so releasing outside the canvas is unreliable.
- Nodes unlock after 2 seconds and are then reset by issue #2. There is no persistent pin.

### 4. Dots cannot handle a large deck

Cells shrink to `DOT_MIN_CELL = 6`. If content still does not fit, the bottom sections are clipped. Dots has no scroll, zoom, or pan (wheel and mousedown return early). At 6px, dots are also smaller than a usable touch target.

Fix: fit-to-width scaling, vertical scroll/pagination, and a "show remaining in Library" fallback.

### 5. The double sidebar is a state-model problem

`libraryHeapSidebar` and `nodeSidebar` are independently toggled and can be open together. On wide screens they consume ~700px; at `<=1100px` they overlap as right-hand overlays with competing z-indexes.

Fix: one inspector with `Details / Connections / Heap` tabs, one open panel, one close button, drawer semantics on mobile.

### 6. Heap mutations cause a render and event storm

`saveHeapCardIds()` → `addHeap()` → `db-change` → `refreshData()` + full `renderGrid()`, while the same handler also re-renders directly. `renderGrid()` rebuilds the entire card DOM and replays the stagger animation. Also `getAllHeaps()` sorts by `updatedAt`, so every save makes the active heap jump to the top of the select.

Fix: optimistic local reorder, debounced persistence, no global refresh, stable heap ordering.

### 7. Metadata hides exactly what it should show

`formatMetadataHumanReadable()` reduces `analysis.quoteRefs` to a count, collapses arrays to `[n items]`, omits top-level card `links`, and drops `lastGrade`. For a knowledge graph, references are first-class data. Render structured sections: Identity, Organization, Signals, References (clickable), SRS, Raw.

### 8. The graph has no way to find anything

No search, type filter, subject filter, fit-to-view, or graph legend. The eight stat pills are passive. For a graph containing every subject/source/quote/analysis/cue/tag/past paper/card, this is the biggest usability gap after the sidebar.

### 9. Graph-only actions are available in card-only views

`Connect Nodes` and `New Node` are always visible. In Library/Dots, connection mode is cancelled but the buttons remain; New Node creates nodes the current view cannot show.

Fix: contextual toolbar actions per view.

### 10. No touch support

The canvas only listens to mouse events. There are zero `touch*` or `pointer*` handlers. Pan, zoom and drag are impossible on a tablet. The CSS even has a `pointer: coarse` layout and an iPad-specific click-suppression hack, so touch is clearly an expected target.

Fix: Pointer Events, `setPointerCapture`, pinch-zoom, window-level up/cancel.

### 11. Creating nodes from Mindmap is poor CRUD

`createNewNode()` chains modal prompts with no title/tag/source context, falls back to `"General"`, and can leave floating unconnected nodes. Either route creation to Analysis/Memory with context or build one proper form.

### 12. Performance and maintainability

- `renderScene()` writes stats and empty-state DOM every frame.
- `perf.enabled = true`; two marks plus a measure per physics frame; `logPerf()` outputs nothing.
- `computeForces()` is O(n²); the existing `QuadTree` is dead code.
- `addEdge()` de-dupe is O(E²).
- `findItemById()` rebuilds an array on every call, inside loops.
- One 4,470-line file plus a second override `<style>` block.

### 13. Accessibility and polish

- Canvas has no role, label, keyboard navigation, or screen-reader alternative.
- Hover-only Dots tooltips are inaccessible to keyboard and touch.
- Inspector does not manage focus; no dialog semantics.
- Grid card is a `div role="button"` containing a real `<button>` (invalid nesting).
- No `prefers-reduced-motion`.
- Global scrollbar hiding removes scroll affordances.
- Labels at 0.82rem and 0.42–0.55 alpha are likely below comfortable contrast.
- Connection titles are injected into `innerHTML` unescaped.
- Canvas ignores `devicePixelRatio`.
- No Mindmap tests.

## Touch usability audit (iPad / touch)

Concrete failures when driving the current build on a touch device:

1. **Pan is impossible.** Pan starts on `mousedown` only. A finger drag produces no `mousedown`. The graph cannot be moved.
2. **Node drag is impossible.** Node selection and dragging also start on `mousedown`. Tapping fires a synthetic `click`, so nodes can be selected, but not moved.
3. **Zoom is impossible.** Zoom is `wheel` only. There is no pinch gesture and no touch-aware zoom control.
4. **Dots is unusable.** Dots suppresses wheel/pan/drag, and 6px minimum cells fall below the ~44px recommended touch target. Hover tooltips never appear on touch, so the only information channel is unavailable.
5. **Tap-to-connect is fragile.** Connection mode relies on click; combined with the first-run click suppression and the graph's own click handling, taps can be swallowed or select the wrong thing.
6. **Drag releases can stick.** There is no `pointercancel`/`touchend` handling, so a finger leaving the canvas mid-gesture can leave a node locked.
7. **Double sidebar overlays collide.** On an iPad-width viewport both sidebars become overlays; the second one covers the first, and the close affordance can end up behind another layer.
8. **Touch targets are too small.** View-toggle buttons, connection-row actions, dot cells, and some icon buttons are below comfortable finger size.
9. **No pull-to-refresh / scroll containment.** Global scrollbar hiding plus `overflow: hidden` on the shell makes it unclear whether the inspector or grid can scroll; on iOS this can also trigger page rubber-banding.
10. **Blurry canvas on Retina.** Canvas backing store ignores DPR, so lines and text are soft on iPad.
11. **No `touch-action` policy.** Without `touch-action: none` on the canvas, iOS may claim drags for scrolling or page zoom while the user is trying to pan the graph.
12. **Text selection / callout on long-press.** Missing `user-select: none` and `-webkit-touch-callout: none` on interactive canvas regions can interrupt dragging.

Fix direction: one pointer-event gesture layer (single pointer = pan or node drag, two pointers = pinch zoom), persistent node drag, `touch-action: none` on the canvas, minimum 44px controls, and a touch-accessible replacement for hover-only Dots info.

## Recommended order

### Phase 0 — correctness
1. Block cards from Connect Nodes.
2. Preserve knowledge-node positions across refreshes; add explicit Re-layout.
3. Fix drag: offset, pointer capture, release handling, stuck locks, touch/pointer support.
4. Fix Dots overflow and touch target sizes.
5. Render real references in metadata.
6. Escape connection titles.

### Phase 1 — unify the layout
7. One inspector with `Details / Connections / Heap` tabs; one open panel; mobile drawer.
8. Contextual toolbar; hide Graph-only actions outside Graph.
9. Heap drag-and-drop reorder with optimistic save and no full-grid rerender.
10. Stable heap ordering; remove duplicate Study Heap controls.
11. Library search, sort, collapsible deck sections, multi-select, add-selected-to-heap.

### Phase 2 — visual engine
12. Graph search, type/subject filters, legend, fit/reset camera, persistent view state.
13. Authored layout mode (tree/star, explicit root including a tag) as a separate algorithm.
14. Accessibility, focus management, reduced motion, DPR, visible scrollbars.
15. Performance cleanup: remove profiler, spatial index or reduce O(n²), dedupe edges, split modules and CSS.
16. Tests for pure geometry/state functions only.

## Deliberately out of scope

- Card-to-card / connectable card links: separate debate (tags may already cover it).
- Terminology cleanup (`subject` vs `deck` vs `library` vs `heap`): discuss separately.
- Star/tree authored layout: build after the position model is stable.

---

# Response to the review

## On the graph resetting

I stand by canonical position storage, but not by "never animate". The distinction is between **incidental** resets and **intentional** ones.

- Incidental reset: you add a tag, reorder a heap, delete a quote, and the graph silently re-explodes. That is the bug. It destroys any arrangement the user made and makes the map feel like it has no memory.
- Intentional reset: the user presses **Re-layout** and watches the graph re-explode. That is a feature and it is worth keeping exactly because it is satisfying.

So the plan is:

1. Position is stored per node and survives ordinary data changes. New nodes get seeded near their parent; existing nodes do not move.
2. `Re-layout` remains an explicit control that replays the current radial explosion. It is the "cool reset" on demand.
3. Later, if large graphs become the norm, add optional named layout snapshots. That gives a user a known arrangement to return to without taking the reset away.

If the reset stays automatic, no authored tree/star mode can work, because any authored arrangement is wiped by the next database write. Canonical storage is therefore a prerequisite, not a nice-to-have.

## On Mindmap's identity

Agreed: Mindmap is a **navigation/admin lens** over the database. It is not a processing tool, and it is not the owner of card authoring. That means:

- the canvas stays the primary surface;
- card browsing can live here so long as it is clearly a view, not a second product;
- creating knowledge records from Mindmap should eventually route to the owning tool or use one proper form, not chained prompts.

## On connectable cards

Agreed that this is a separate debate and that tags may already cover most of it. I have not implemented card links. I have only stopped cards from entering `Connect Nodes`, because the current code would copy a card into the `nodes` store. The broader question (manual card-to-card edges vs tag clusters vs an indexer/reference system) is left open for discussion.

## On the single inspector

Yes. The two sidebars were the mistake. The implementation now moves to one inspector with `Details / Connections / Heap` tabs and one open panel maximum.

## On terminology

`priority` is the user-facing term. The deeper `subject`/`deck`/`library`/`heap` discussion is deferred, so the code keeps its existing internal field names to avoid a risky rename in the middle of the cleanup.

## On ordering and process

P0 correctness first, then layout, then visual engine. One task per commit. The audit is above; this response is here so it can be read without the chat.

## Risks and doubts (to revisit)

- **Inspector refactor risk:** `mindmap.html` has two competing `<style>` blocks. The unified inspector touches DOM, CSS and JS together. I will remove the override block rather than stack a third one.
- **Pointer events risk:** replacing mouse handlers with pointer handlers is the highest-risk change for desktop regressions. I will keep click semantics and only route drag/pan/zoom through pointers.
- **Position persistence risk:** positions are currently in-memory only. Persisting them changes the data model. I will first preserve in-memory positions across refresh, then decide whether persistence belongs in `meta` or a separate layout store.
- **Dots overflow:** a true fit/scroll solution needs a design decision (scale vs scroll vs paginate). I will implement a safe fallback for now and flag the design choice.
- **Testing:** I am not building a new test framework. I will use `node --check` and the existing `tests/run.mjs` where relevant.
- **Existing uncommitted files** (`.github/workflows/pages.yml`, `scripts/build-showcase.mjs`, `SNAPSHOTS.md`, `scripts/showcase-seed.template.js`) are unrelated and will stay out of Mindmap commits.
