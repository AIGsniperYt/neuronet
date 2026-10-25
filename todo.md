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

## Agent Work Log — 2026-10-25 (current)

**Goal:** card-first, discipline-neutral study. A card can exist without a source, quote, excerpt, analysis, or multi-step deck wizard. Analysis is optional context, not the entry point.

### Shipped / committed
- Card model committed as `85f4692` (`Make cards the first-class study unit`).
- Phase 1 bridge is committed as `bc84565` (`Add card-first Quick Add bridge for Memory`).
- Quick Add lives in `tools/memory.html` + `src/tools/memoryTool.js`: deck input with suggestions, front/back, priority, tags, Save & Next, Save & Close, bulk paste (`front<TAB>back` or `front | back`), Ctrl/Cmd+Enter.
- Entry points: dashboard “Make Flashcards”, Memory “Add Cards +”, header “+ Card”, and each deck card’s “+”.
- Fixed a launchpad race: `showLaunchpad()` no longer wipes a tool opened during its 350 ms exit animation, and `.launchpad.exiting` is `pointer-events: none` so the fading overlay cannot swallow clicks.

### Current phase — real card model (implemented and committed)
- `cards` store is live at DB v9. A card owns `id`, `front`, `back`, `deck`, `deckPath`, `tags`, `priority`, `order`, `meta` (SRS), `links`, `origin`, `createdAt`, `updatedAt`.
- `deck` is a topic string, not necessarily a subject. `deckPath` carries hierarchy. Deck lists are derived from cards plus legacy subjects; there is still no separate deck store.
- `custom-deck` is stripped when cards are normalised, so new cards never carry it as a user tag.
- `syncCardsFromLegacy()` idempotently backfills cards from existing quote + cue pairs. It creates missing cards, refreshes content only when the legacy record is newer, and never overwrites card-owned SRS or stable order. Runs at startup, after cloud merge, and after legacy-style writes.
- Quick Add now writes a card only — no quote, no cue. Old Quick Add quote+cue pairs are migrated automatically on the next startup.
- Memory’s study queue, grading, priority editing, launchpad counts, middle-UI filters, explorer, dashboard due counts, subject rename/delete, export, and import all read/write cards.
- The deck builder is card-aware: `openDeckEditor()` lists cards in stable `order`, `saveFlashcard()` preserves `cardId`/`cueId`/`quoteId`/SRS/links, and `saveDeckToDB()` writes cards directly (no reliance on the sync bridge), assigns orders to new cards, and deletes removed cards plus their legacy pairs. Legacy quote+cue records are still written for Analysis compatibility, but they no longer create duplicate cards.
- New deck-builder cards append after the deck’s current max `order`; edited cards keep their existing order and SRS.

### Test status
- Card-model Puppeteer smoke test: 22/22 (legacy migration, Quick Add card-only persistence, study/grade card SRS, reload persistence).
- Deck-builder Puppeteer smoke test: 28/28 (edit a Quick Add card, add a card, delete a card, preserve SRS/tags/order, no duplicate cards, legacy pairs still written, reload coherence).
- New-deck creation Puppeteer smoke test: 10/10 (Build Deck step 1 → add card → success screen → study immediately → reload without duplicates).
- `node --check` passes for `src/db.js`, `src/main.js`, and `src/tools/memoryTool.js`.
- These are one-off checks in `/tmp/opencode/`, not a test suite.

### Backup / cloud decision
- **JSON export/import is the canonical cross-device backup path.** It now includes `cards`; older exports rebuild cards from legacy quote+cue pairs after import.
- **Cloud sync is explicitly legacy/optional and does not yet carry cards.** Rather than revive the stale backend just to mirror JSON, cards stay local-first until there is a concrete reason to add a cards collection/endpoints (for example, true diff-merge sync). Documented in `../project.md` Known Issues and Sync Philosophy.
- Spec audit applied in `../project.md`: two-layer model, card-first philosophy, `cards` store + indexes, card CRUD, Quick Add, deck-builder card ownership, stable order vs performance sorting, Analysis-secondary framing, and the cloud/Mindmap card gaps.

### Next steps
1. If cloud sync becomes a priority, add a cards collection/endpoints or rebuild cards from synced legacy pairs on login. Do not build it just to duplicate JSON export.
2. Follow-up: make other views (Mindmap Grid/Dots, etc.) consume the `cards` store where appropriate. Stable order should be the default browse order; performance sorting stays an explicit utility.
3. Consider surfacing optional knowledge context (linked quote/analysis) in the study card back, now that cards can exist without it.
4. Keep `todo.md` as the mailbox: replace this log rather than appending indefinitely.

### Problems / risks
- Cloud sync (`src/sync.js`) has no cards endpoint. Cards are local-only until sync is extended; JSON export/import is the current backup path.
- Legacy quote/cue records remain by design for source anchoring and Analysis. The deck builder keeps writing them so analysis references still resolve.
- `custom-deck` remains in old quote records and some legacy UI until those paths are cleaned up.
- Quick Add writes cards with no legacy link, so any old code path that only understands quotes will not see them. All known study/dashboard/export paths have been migrated.
- Mindmap Dots still sorts by its own signals; stable card order is not consumed there yet.


