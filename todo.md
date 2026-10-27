improve mindmap tool by removing custom-deck tag visually - fix custom deck being visible in the app as a valid tag, it should be treated as an app reserved word metadata thing
as well as properly displaying all metadata and figure out why the references arent shown in metadata, how tf does it reference stuff without?
analysistool headings dont allow spaces
mindmaptool allow star topology or a general sidebar treebuilder sidebar allowing user to rearrange how parents are rendered and bonds are made visually, featuring a tag as the centre or in general allowing users to build their mindmap as they wish setting the innermost parent of the star a tag for example, and allowing only some nodes to be rendered etc in short a comprehensive visual engine

revive cloud backend: reactivate the Node/Express sync backend (currently stale/unused) OR decide to archive it. Original intent was "use my own cloud" instead of depending on third-party JSON/email transfer; JSON export/import flow is now the de-facto cross-device sync standard and is faster, so if the backend is revived it should add real value (e.g. proper conflict resolution / diff-merge rather than coarse overwrite, or push-style sync), not just mirror what the JSON flow already does.

duplicate export/import flows: there are now TWO import/export systems — the app-wide dataset import/export (main.js / launchpad) and the past-paper tracker's own export/import. Decide a consistent story: separate tracker export (fine to keep, it's self-contained for the cross-device past-paper sync) vs a single unified app-wide backup. Keep the tracker one since past-paper sync is device-to-device via email JSON and shouldn't drag the whole DB around; document the boundary so it doesn't get confusing.

semantic linking between flashcards/nodes influencing the flashcard superprogram algorithm to show common "clusters" or bias them to learn related information in batches - could have potential to upgrade and autonomously link for you semantically, but aside from that, we have advantage over anki in a way because owning the complete study ecosystem meant we can pull additional metadata like analysis docs references citations and the file the node is from, as well as the mindmap tool's links to build knowledge clusters for the superprogram to feed off and teach - i believe from what i remember that the superprogram already does teach in batches favouring small sections until you learn them, so this is likely a layer on top upgrade to that, biasing the cluster size and allowing it to be dynamic, not static (ie take as much as it needs to fit one semantic topic in one batch rather than a fixed count for all) - that would be valuable

mindmap grid view: add a Graph | Grid switch. Grid turns each subject node into a header/box and lays the subject's knowledge nodes out in grouped rows for an at-a-glance database view, for one focused subject or all subjects. Encode importance, accuracy/correctness and recall strength through card border colour, fill tint and a compact accuracy badge, with neutral styling and a clear legend when data is missing. Pending metadata update: define canonical importance/accuracy/recall fields across quotes, analyses and cues, then wire sorting/filtering, richer tooltips and per-subject summaries to those signals. Do not alter flashcard/SuperProgram behaviour as part of this.

fix the create new flashcards to have a proper flow into just making your flashcards and saving them asap - then on save it will save unlisted but can ask you if you have the time to organise it to your chosen subject, after which it can simply be added neatly - flashcards should also be groupable by layer hierarchial organisation - especially for a level when it gets massive - a "deck" maybe shouldnt be a subject, but a topic and a literal mere "deck" after all

fix the "custom deck" tag hacky approach

add task management to neuronet to handle todos

the context rail is super garbage, that needs to be fixed, overall the memory tool is really unclean and unprofessional and all over the place and needs to be fixed - need a unified sidebar - preferably a way to view all cards at once (unless the mindmap tool can help by doing that, not memory)

inspired by bma portal: add a quick link option to your classroom to access easily from neuronet - OH MY WOW GOOGLE CLASSROOM HAS A REST API FOR DEVELOPERS LETS ABSOLUTELY GO, WE CAN GET ASSIGNMENTS AND STUFF!!!


21: **Task 2 — Dots migration:** replace the stitched Graph↔Dots transition with one session-persistent card scene object per card. Each card owns one canonical `x/y`; Graph view renders cards as real scene objects clustered around their linked context/deck, Dots calculates target world positions from those objects (no separate graph/dot coordinate maps). Graph → Dots: non-card nodes fade out while cards simultaneously colour-morph and lerp to their dot slots. Dots → Graph: cards lerp back to their exact pre-Dots positions and colour-morph back first, then non-card nodes fade in. Session-only positions (reset on leaving the tool, never persisted). Aggressively optimise: cached anchors, no per-frame allocations/Maps, one global transition `t` with no stagger, solid fills only, physics/camera paused during morph, one renderer during transition. Do after the current legacy-shaped cleanup.

---

## Agent Work Log — 2026-10-27 (current)

**Goal:** finish the card-first Graph/Library/Dots work with named Heap-based manual study, then verify and document it.

### Shipped / current pass
- **Graph cards are real scene objects.** Each card has one session-only `state.cardScene` entry with canonical `x/y`; that same object is its `nodePositions` entry. Graph cards now match knowledge nodes in size, hollow-circle styling, label size/threshold, and camera framing. They use cyan `#22d3ee`; priority borders and score fills appear only in Dots. Camera fitting ignores cards so the knowledge graph keeps its own min/max framing, with a card-only fallback.
- **Graph ↔ Dots morph kept.** Non-card nodes fade while cards colour-morph and lerp to cached dot slots; the return trip lands cards at their exact pre-Dots `homeX/homeY` first, then fades knowledge back in. Physics/camera fitting pause during the morph. No separate Graph/Dots coordinate maps and no position persistence.
- **Library replaces the Cards/Grid label.** The card browser is now **Library**. It keeps stable browse order, deck sub-groups, score chips, and the shared card sidebar. **Delete Card** removes only the card; its linked quote/source survive. **Open in Memory** targets the exact card, and opening a tool with a subject now syncs the shell's subject pill.
- **Heaps are first-class metadata.** `DB_VERSION = 10` adds a `heaps` store (`name`, ordered `cardIds`, timestamps; index `updatedAt`) with `addHeap`, `addHeaps`, `getAllHeaps`, `getHeap`, `deleteHeap`, and `clearHeaps`. Heaps are included in JSON export/import, demo reset, and wipe. They are not decks, tags, or card copies; missing card IDs are skipped.
- **Library heap workflow.** The Library toolbar has an active-heap selector, `+ New Heap`, `Study Heap`, and a heap sidebar toggle. Every card has `+ Heap` / `✓ In Heap`. The sidebar lists the heap in study order with up/down reorder, remove, Study Heap, and Delete Heap. It is positioned below the toolbar so Study Heap stays clickable. Deleting a heap never deletes cards.
- **Memory Manual mode.** The launchpad exposes **Heaps**; Manual mode lists saved heaps with counts, supports **+ New Heap**, **Open Library**, and **Study Heap**, and shows the heap picker instead of filters. Creating a heap opens the Library with it active.
- **Manual study semantics.** Manual uses the `manual_heap` route and its own `state.manualHeaps`/`state.manualHeapId`, never the SRS `state.session.heap` identity. It studies cards in saved order, bypasses SRS route selection, interleaving, surprise cards, and re-insertion, but grading still writes normal SRS memory state. Empty/deleted-card heaps cannot start.
- **Legacy card migration removed.** `syncCardsFromLegacy()` and `buildFallbackCue()` are gone from `src/db.js` and all callers/imports. There is no startup backfill and no “cardless quote” marker; cards come from Quick Add, the deck builder, imports, or explicit demo data.

### Test status
- `node --check` passes for `src/db.js`, `src/main.js`, `src/tools/memoryTool.js`, and `src/tools/mindmapTool.js`.
- `/tmp/opencode/heap_smoke.mjs` passed: Library renders 14 demo cards, heap create/persist, add/reorder/remove, Manual study starts and advances in saved order without reinsertion, SRS `reviewCount` increments, heap survives reload, Memory lists it.
- `/tmp/opencode/heap_focused_smoke.mjs` passed: exact-card Open in Memory, subject-pill sync, Memory new-heap → Library active heap, heap deletion from Library, cards survive heap deletion.
- `/tmp/opencode/mindmap_task2_delete_smoke.mjs` passed: Delete Card cancel/confirm, linked quote survives, reload persistence (14 → 13 cards).
- One-off Puppeteer checks, not a test suite.

### Next steps
1. Defer heap drag-and-drop and heap sharing; current MVP uses up/down reorder and local persistence.
2. Keep `../project.md` updated after each slice; replace this log rather than appending.
3. If cloud sync is revived, add cards and heaps endpoints.

### Problems / risks
- Heap drag-and-drop and cross-device heap sharing are not implemented; JSON export/import is the sharing path.
- Cloud sync (`src/sync.js`) still has no cards/heaps endpoint; JSON export/import is the complete backup path.
- The demo database may need a reset after schema changes; `DB_VERSION` is 10 and the demo DB name remains `neuronet-v9`.
- Manual mode intentionally ignores filters and SRS ordering; it is a separate study surface, not a replacement for card-learning sessions.
