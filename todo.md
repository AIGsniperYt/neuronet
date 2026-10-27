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

21: **Task 2 — Dots migration:** replace the stitched Graph↔Dots transition with one session-persistent card scene object per card. Each card owns one canonical `x/y`; Graph view renders cards as real scene objects clustered around their linked context/deck, Dots calculates target world positions from those objects (no separate graph/dot coordinate maps). Graph → Dots: non-card nodes fade out while cards simultaneously colour-morph and lerp to their dot slots. Dots → Graph: cards lerp back to their exact pre-Dots positions and colour-morph back first, then non-card nodes fade in. Session-only positions (reset on leaving the tool, never persisted). Aggressively optimise: cached anchors, no per-frame allocations/Maps, one global transition `t` with no stagger, solid fills only, physics/camera paused during morph, one renderer during transition. Do after the current legacy-shaped cleanup.

---

## Agent Work Log — 2026-10-27 (current)

**Goal:** finish the card-first migration. Cards are the only study unit; quotes, cues, analyses, sources, and tags are optional knowledge context. No creation flow may write legacy quote/cue pairs or expose `custom-deck` as a user tag.

### Shipped / current pass
- **Deck builder is card-first end to end.** The form is Front / Back / Priority / Tags; the layer editor and `layerPillState` are gone. `persistDeckCards()` writes only the `cards` store and preserves SRS, stable order, deckPath, links, origin, and creation time. It updates in-memory card IDs after save so a second save cannot duplicate cards.
- **Mass edit is card-first.** It edits front/back/priority/tags, tracks removals, saves through `persistDeckCards()`, and no longer writes quote/cue records.
- **Anki import is card-first.** Imported rows become `{cardId, front, back, priority, tags, isExisting}`; no `cueId`, `quoteId`, `cueFront`, `quoteBack`, or `layers`.
- **Quick Add never blocks on organisation.** A blank deck saves to **Unsorted** for both single and bulk capture. The deck field is labelled optional and focus starts on the card front.
- **Middle UI opens in Cards.** Clicking a deck resets `currentMode` to `card-learning` and `renderMiddleUI()` syncs the active pill. Cards is first; Quotes, Analysis, Evidence, and Blurt remain optional knowledge modes.
- **Quotes mode works without cues.** It builds a plain recall queue from the deck's quote records and never reads or writes legacy cue pairs.
- **`custom-deck` is retired.** Startup and import strip it from quote metadata and the `tags` store. Analysis tag sync and card/Grid tag helpers filter it. The old custom-deck display branches and dead layer/custom-deck CSS were removed.
- **Legacy fallback pairs are read-only context.** The builder may link an unbackfilled quote/cue once, but never rewrites either record. Deleting a card deletes only the card.

### Test status
- `node --check` passes for `src/main.js`, `src/tools/memoryTool.js`, and `src/tools/analysisTool.js`.
- Focused Puppeteer smoke: **15/15**. Covers blank-deck Quick Add → Unsorted, card-only saves, tags, Anki import without legacy fields, mass-edit update/delete, middle UI Cards mode, Quotes mode without cues, and startup stripping of `custom-deck` from quotes and the tag store.
- Script: `/tmp/opencode/legacy_cleanup_smoke.mjs`. These are one-off checks, not a test suite.
- Earlier Dots, Grid, knowledge-sidebar, bulk-confidence, morph, and demo/wipe checks remain valid for unchanged surfaces.

### Next steps
1. **Task 2 — Dots migration** (queued as item 21 above): one session-persistent card scene object per card, canonical `x/y`, simultaneous Graph → Dots morph, reverse-first Dots → Graph morph, aggressively optimised.
2. Keep `../project.md` updated after each slice; replace this log rather than appending.

### Problems / risks
- Cloud sync (`src/sync.js`) still has no cards endpoint; JSON export/import is the backup path.
- The middle UI still exposes a path filter built from `deckPath` for existing nested decks, even though new cards start at `[deck]`. This is data compatibility, not a creation flow.
- The knowledge context rail is read-only and only appears in Cards mode.
- Demo detection remains a heuristic based on legacy content plus card count/origin; SRS edits to demo cards are not detected.
- `importPayload()` clears cards and legacy stores but not the `tags` store; the startup/import reserved-tag cleanup and Analysis re-sync keep it consistent.
