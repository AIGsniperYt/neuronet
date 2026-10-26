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

**Goal:** cards are the first-class study unit; knowledge is optional context. Dots and Cards are card-first diagnostic surfaces. This pass adds the Graph ↔ Dots spatial morph and closes the demo/wipe gap that appeared when cards became the study source of truth.

### Shipped / committed
- Card model: `73d5c98` (`Make cards the first-class study unit`), with docs `7ba7433`, `574df8a`, `969e48d`, and deck-builder guard `9e18d88`.
- Dots card-first slice: `62ed19d` (`Make Dots a card-first diagnostic surface`).
- Cards/Grid card-first slice: `fbbc593` (`Make Cards a card-first deck grid`).
- Context rail: `b5be44b` (`Add an external knowledge context rail to Memory`).
- Graph ↔ Dots morph + demo/wipe card awareness: this pass.
- `cards` store at DB v9: `id`, `front`, `back`, `deck`, `deckPath`, `tags`, `priority`, `order`, `meta` (SRS), `links`, `origin`, `createdAt`, `updatedAt`. `deck` is a topic, not necessarily a subject.
- Quick Add writes cards only. Bulk paste accepts tab or pipe separators and stable orders. Manual cards start with `0.8` confidence; bulk imports default to `0.5` with a selectable initial confidence (`0.2`–`0.8`).
- Memory study queue, grading, priority editing, launchpad counts, middle UI, explorer, dashboard due counts, subject rename/delete, export, and import all use cards.
- Deck builder is card-aware and preserves card/SRS/tag/order state; legacy quote+cue pairs remain only for Analysis compatibility.
- JSON export/import is the canonical backup path and includes `cards`. Cloud sync remains legacy/optional with no cards endpoint.

### Dots + Cards behavior
- `buildCardSections()` groups cards by deck and sorts by stable `order`, then `createdAt`; both Dots and Cards use it. A deeper `deckPath` becomes a Grid sub-group.
- `isCardInScope()` and `resolveFocusSubject()` accept decks and any `deckPath` part, so Quick Add-only decks are visible and a card-only focus survives a refresh.
- Dots: border = importance; left half = recall; right half = accuracy. Solid five-bin palette (`#ff4d4d`, `#ff8a3d`, `#ffa500`, `#a8d95f`, `#3fd07d`); unknown is `#33443d`.
- Recall resolver: `lastGrade` → `L_phase` → `S`/`U` → `recentGrades` → `confidence` prior. Accuracy resolver: `recentGrades` → `meta.accuracy` → `lastGrade` → `confidence` prior.
- Cards/Grid uses the same five bins as solid `R`/`A` chips, with an importance border, deck sections, and a tooltip containing deck/priority/percentages/tags.
- Clicking a Grid card opens the shared read-only sidebar: front/back, no graph connections, no delete, **Open in Memory** routes to the deck.
- Card-mode stats show card/deck counts and hide knowledge-layer pills. Empty states and legends describe cards only.

### Graph ↔ Dots morph (this pass)
- Entering Dots snapshots the graph's world positions. Each card dot starts at the screen position of its linked quote/cue/analysis/source nodes (averaged), or its deck subject node / section centre when unlinked, then eases to its stable dot slot.
- Leaving Dots captures the live dot positions (including mid-animation) and reverses the mapping. Linked nodes start at their card's dot; remaining deck nodes start at the deck's dot cluster. Nodes ease back to the exact pre-Dots world positions.
- Physics and camera fitting pause during the return morph, then resume. `graphMorph` / `graphSnapshot` are cleared on Grid entry, data refresh, and completion.
- Dot slots themselves remain deterministic for a fixed card set and viewport; only entry/exit is animated.

### Context rail — what “rail” means
- “Rail” is a UI term for a narrow side strip, not a database concept. In Memory Cards study, `#studyContextRail` sits beside the flashcard, outside both faces, and shows the current card's optional linked quote, analysis, and source.
- It exists to keep cards self-contained: the prompt/answer never contains knowledge context, so cards remain usable without a source. The rail makes the optional knowledge layer visible without turning it into part of the card.
- Wide screens: 320px rail beside the card; collapse to a 46px strip with a chevron. `<=1000px`: overlay drawer controlled by the header **Context** button. It is hidden on the launchpad and outside Cards study, and async lookups are token-guarded.
- Unlinked cards show a muted empty state (“No linked knowledge context”); deleted links show “Linked context is unavailable”.

### Schema / demo data
- The context rail did not change the schema. `DB_VERSION` remains 9; the `cards` store/indexes came from `73d5c98`.
- Existing databases self-migrate at startup: `upgradeStoredDatabaseIfNeeded()` then `syncCardsFromLegacy()` (idempotent). Older JSON exports without cards are backfilled on import. No manual migration or demo re-import is required.
- Re-importing demo data is only for restoring pristine demo content, and it overwrites the current DB; back up first.
- Demo detection now considers cards: a pristine demo must have exactly the legacy-backfilled card count and every card must be `origin: "legacy"`. A card-only DB now triggers the overwrite warning before demo import.
- `wipeDatabase()` now clears `cards` and `tags` as well as nodes/quotes/cues, so “delete all data” leaves no orphan study records.

### Test status
- Card model: 22/22. Deck builder: 28/28. New deck: 10/10. Bulk Quick Add: 6/6.
- Dots: 21/21. Cards/Grid: 21/21. Bulk confidence: 7/7.
- Context rail: 23/23.
- Graph ↔ Dots morph: 9/9 (dot starts at linked graph node, reaches stable slot, graph node reappears at dot, returns to pre-Dots position).
- Demo/wipe: 9/9 (card-only import warning, demo backfill, pristine demo delete path, user card breaks fingerprint, full caution flow, wipe clears nodes/quotes/cues/cards/tags).
- Screenshots checked: `/tmp/opencode/context-rail.png`, `/tmp/opencode/context-rail-narrow.png`, `/tmp/opencode/dots.png`, `/tmp/opencode/dots-hover.png`, `/tmp/opencode/dots-focused.png`, `/tmp/opencode/grid-cards.png`, `/tmp/opencode/morph-graph.png`, `/tmp/opencode/morph-dots-start.png`, `/tmp/opencode/morph-dots-end.png`, `/tmp/opencode/morph-graph-start.png`, `/tmp/opencode/morph-graph-end.png`.
- `node --check` passes for `src/main.js`, `src/db.js`, `src/tools/memoryTool.js`, and `src/tools/mindmapTool.js`.
- These are one-off checks in `/tmp/opencode/`, not a test suite.

### Next steps
1. Optional: persist dot slot assignments across card-set changes (current layout is deterministic for a fixed set, but adding/removing cards reflows sections).
2. Optional: batch-decreasing bulk confidence and a dim “show knowledge context” toggle in Dots/Grid.
3. Keep `../project.md` updated after each slice; replace this log rather than appending.

### Problems / risks
- The card sidebar is intentionally read-only; editing/deleting still lives in Memory.
- Cloud sync (`src/sync.js`) has no cards endpoint; cards are local-only. JSON export/import is the backup path.
- Legacy quote/cue records remain by design for source anchoring and Analysis.
- `custom-deck` can persist in old quote records and some legacy UI until those paths are cleaned up.
- The context rail is read-only and only appears in Cards mode; it is not a general knowledge browser.
- Dots/Grid intentionally omit knowledge context; the graph remains the knowledge-network surface.
- Demo detection is still a heuristic: it checks legacy content + card count/origin, not card SRS edits. Studying pristine demo cards keeps the easy-delete path.
- `importPayload()` clears cards and legacy stores but not the `tags` store; tags are re-synced when Analysis initializes. `wipeDatabase()` does clear tags.
