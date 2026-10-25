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

## Agent Work Log — 2026-10-25

**Goal:** make flashcard creation card-first and discipline-neutral. Analysis becomes optional context, not the required entry path.

### Done
- Added a Quick Add modal to `tools/memory.html`: deck input with existing-deck suggestions, front/back, priority pills, tags, Save & Next, Save & Close, bulk paste tab, and keyboard hint.
- Wired Quick Add in `src/tools/memoryTool.js`: persists each card immediately as a legacy quote + cue pair, writes `meta.deckOrder` for stable ordering, always adds the reserved `custom-deck` tag, and refreshes the deck list on close.
- Added entry points: dashboard “Make Flashcards” now opens Quick Add (`src/main.js`), Memory launchpad has “Add Cards +”, the header has “+ Card”, and each deck card has a “+” button.
- Neutralized the empty-state copy (“No decks yet. Add a card to start one — no source or analysis needed.”).
- Bulk paste accepts `front<TAB>back` or `front | back`, one card per line.
- `node --check` passes for `memoryTool.js` and `main.js`.

### Current / next
- Quick Add browser smoke test passed 17/17 (persistence, tags, stable deck order, bulk import, new deck appearing on the Memory launchpad). Test lives at `/tmp/opencode/quickadd_smoke2.mjs`; it is a one-off check, not a suite.
- Fixed a launchpad race found by the test: `showLaunchpad()` was clearing a tool that opened during its 350 ms exit animation. Also added `pointer-events: none` to `.launchpad.exiting` so the fading launchpad cannot swallow clicks.
- Committing this as the Phase 1 bridge checkpoint. Next: the real card-first model (first-class `cards` store, decks/topics, migration, Memory queue reading cards directly), then an incremental `../project.md` audit.

### Thoughts / risks
- Quick Add currently uses the legacy quote + cue stores. That is intentional: Memory works immediately with no DB migration. A real `cards` store can come later.
- `meta.deckOrder` is written but no view consumes it yet. Mindmap Dots still sorts by priority/title; changing that default to stable deck order is a separate follow-up.
- Quick Add suppresses `db-change` refreshes while open, then reloads the deck list on close. This avoids the study view reloading mid-entry.
- Reserved `custom-deck` tag is still a visible tag in some UI. The user already flagged this; Quick Add keeps writing it for compatibility but it should become metadata-only later.
- Reused the existing Anki import parser (`processAnkiImport`) via a shared `parseAnkiCards` helper instead of keeping a second bulk parser. Both the deck builder and Quick Add now accept tab-separated or `front | back` rows.

### Architecture note — what is actually “new”
- **Legacy bridge (what Quick Add writes today):** `quotes` store holds the answer, `cues` store holds the front/prompt, linked by `quoteId`. This shape exists for source-anchored analysis. `custom-deck` + `hierarchyPath` are hacks that make a quote/cue pair behave like a deck card. It is only there so the existing Memory engine works immediately.
- **New core model (still to build):** a first-class card record is the unit of study. It owns front/back, deck/topic grouping, tags, priority, stable order, and its own SRS state. It can exist with no source, excerpt, quote, or analysis. The knowledge layer links to cards optionally; it does not create them.
- **Consequence:** the real migration is not “add a modal”; it is moving SRS ownership from quote/cue to card, making decks/topics first-class (a deck is not necessarily a subject), and teaching the Memory queue to read cards directly. The current Quick Add is deliberately Phase 1 only.


