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

---

## Agent Work Log — 2026-10-26 (current)

**Goal:** cards are the first-class study unit; knowledge is optional context. Dots is the card-first diagnostic surface for importance, recall, and accuracy. Grid/Cards is next.

### Shipped / committed
- Card model: `73d5c98` (`Make cards the first-class study unit`), with follow-up docs `7ba7433`, `574df8a`, `969e48d`, and deck-builder guard fix `9e18d88`.
- `cards` store at DB v9: `id`, `front`, `back`, `deck`, `deckPath`, `tags`, `priority`, `order`, `meta` (SRS), `links`, `origin`, `createdAt`, `updatedAt`. `deck` is a topic, not necessarily a subject.
- Quick Add writes cards only. Bulk paste accepts tab or pipe separators and stable orders. Manual cards start with `0.8` confidence; bulk imports default to `0.5` with a selectable initial confidence (`0.2`–`0.8`).
- Memory study queue, grading, priority editing, launchpad counts, middle UI, explorer, dashboard due counts, subject rename/delete, export, and import all use cards.
- Deck builder is card-aware and preserves card/SRS/tag/order state; legacy quote+cue pairs remain only for Analysis compatibility.
- JSON export/import is the canonical backup path and includes `cards`. Cloud sync remains legacy/optional with no cards endpoint.

### Dots slice — implemented, uncommitted
- `getAllCards` is passed into Mindmap and loaded in `refreshData()`.
- `buildDotSections()` groups cards by deck; `buildCardDotItem()` maps each card to the shared card item shape.
- `isCardInScope()` and `resolveFocusSubject()` accept decks and any `deckPath` part, so Quick Add-only decks are visible.
- Dot anatomy: border = importance; left half = recall; right half = accuracy. Solid five-bin palette (`#ff4d4d`, `#ff8a3d`, `#ffa500`, `#a8d95f`, `#3fd07d`); unknown is `#33443d`. Removed the accuracy arc, type centre pip, tints, and bars.
- `getItemRecall()` now returns numeric `score` plus label. Resolver: `lastGrade` → `L_phase` → `S`/`U` → `recentGrades` → `confidence` prior.
- `getItemAccuracy()` resolver: `recentGrades` → `meta.accuracy` → `lastGrade` → `confidence` prior; observed grades beat the creation prior.
- Dots uses stable `order`, then `createdAt`; no performance sorting in the browse view.
- Legend, hover tooltip, empty state, and Dots stats now describe cards/decks only. Dots stats show scoped card and deck counts.
- Bulk confidence selector added to Quick Add: default `0.5`, selectable `0.2`, `0.35`, `0.5`, `0.65`, `0.8`; single cards keep `0.8`.

### Test status
- Card model: 22/22. Deck builder: 28/28. New deck: 10/10. Bulk Quick Add: 6/6.
- Dots smoke test: 21/21 (legend anatomy, five bins, no arc/type pip, canvas colours, hover tooltip, deck focus stats).
- Bulk-confidence smoke test: 7/7 (default 50%, selectable 20%, single-card 80%, stable order).
- Screenshots checked: `/tmp/opencode/dots.png`, `/tmp/opencode/dots-hover.png`, `/tmp/opencode/dots-focused.png`.
- `node --check` passes for `src/main.js`, `src/tools/mindmapTool.js`, and `src/tools/memoryTool.js`.
- These are one-off checks in `/tmp/opencode/`, not a test suite.

### Next steps
1. **Grid/Cards**: consume the `cards` store with the same card item/score model, deck grouping, and solid score bins; update its legend, tooltip, and empty state.
2. Add the external knowledge-context rail in Memory study without placing it inside the card face.
3. Update `../project.md` after each slice. Keep this log replaced, not appended.
4. Optional later: batch-decreasing bulk confidence and a dim “show knowledge context” toggle in Dots.

### Problems / risks
- Grid/Cards still reads knowledge-layer records via `GRID_CARD_TYPES`/`getAllItems()`. A Quick Add-only deck is invisible there until the next slice.
- Cloud sync (`src/sync.js`) has no cards endpoint; cards are local-only. JSON export/import is the backup path.
- Legacy quote/cue records remain by design for source anchoring and Analysis.
- `custom-deck` can persist in old quote records and some legacy UI until those paths are cleaned up.
- Dots intentionally omits knowledge context. Context, when added, must stay visually external to the card face.


