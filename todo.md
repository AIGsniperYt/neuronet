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

RICH TEXT FRORMATTING IN FLASHCARDS !!! important for flashcards cus of bulleted mark schemes for example - thats really useful! we can just hook up our first party vendor lib md-format and embed it into that tool to call too!! yess!!

add estimated time to completion for flashcard sessions

maybe add a "dark mode" or "professional mode" for use outside when you dont want a comfy evergreen theme with my fav colour everywhere, and just want something clean, dark, and unnoticable to avoid drawing attraction or maybe more simply just removing distractions to let you study with focus

---

# Still open

- **Study All Subjects (WIP)**: the disabled launchpad button is intentional, not dead code. Keep it until the all-subjects study flow is built; do not delete it as "unused".
- **Icon cleanup (not now)**: do not mass-purge emoji/glyphs — several are liked. Revisit selectively later and judge each on whether it adds meaning; text labels are the default for controls.
- **Later refinement**: the per-tag / per-layer `Study` buttons in the deck control center stay visible for now; consider tucking them into a row `⋯` menu later.
- Real iPad/Safari pass: double-tap zoom, pinch, Lock mode ergonomics, toolbar crowding, heap drag-release feel.
- Mindmap layout is browser-local: no cross-device sync, no named snapshots.
- Locks made during the opening explosion persist after the settle timer, not immediately.

# Deliberately not doing (unless asked)

- Branch or subject locking, or a global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change. Filters point at nodes; the current physics behaviour is accepted. Revisit only if a filter visibly shoves nodes on a real device.


---

# Product direction

Canonical vision now lives in the private docs repo at `../backend/docs/project.md` §1.1 "Product Vision and UX Direction". In short: comfort-ride default, power behind a voluntary door, hide/defer/merge over add, deck-first card creation, and no capability removed to buy simplicity.

# Calm-default pass

Goal: make the default Memory flow feel simple and comfortable without removing capability.

Agreed direction:

- Deck row itself starts card study; a text `Options` button opens the existing control center.
- The control center keeps every mode, filter, scope toggle, and per-tag/layer shortcut.
- Stats is a real side-by-side panel that pushes the study area aside, not an overlay. Tablet shrinks the panel; phone keeps a full-screen sheet.

Done:

- [x] Read-only senior audit of the default flow.
- [x] Map the current path and count decisions/controls before the first card.
- [x] Identify what to hide, merge, or defer; nothing removed.
- [x] Decide open deck → Study immediately (no summary screen).
- [x] Deck row = study, `Options` = control center.
- [x] Stats = side-by-side column, not an overlay.
- [x] Card front/back authoring embeds the first-party md-format editor; card content renders Markdown (bold, italics, lists, quotes, code).
- [x] Analysis WYSIWYG headings keep spaces while typing (editor round-trip no longer eats a just-typed trailing space).
- [x] Demo dataset migrated once to schema 7; legacy meta, card origins and stale markdown quirks removed.
- [x] Dataset schema upgrade/migration code retired. Imports now reject non-current exports with a clear version error.
- [x] md-format stays generic; Neuronet-only markdown cleanup lives outside the library.

Still to consider:

- [ ] Stats default disclosure: keep Studied/Accuracy first and move Router/Inspect internals behind an explicit advanced view.
- [ ] Launchpad `Manage` grouping for Build Deck / Edit / Heaps, once it is worth the churn.
