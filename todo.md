mindmaptool allow star topology or a general sidebar treebuilder sidebar allowing user to rearrange how parents are rendered and bonds are made visually, featuring a tag as the centre or in general allowing users to build their mindmap as they wish setting the innermost parent of the star a tag for example, and allowing only some nodes to be rendered etc in short a comprehensive visual engine

revive cloud backend: reactivate the Node/Express sync backend (currently stale/unused) OR decide to archive it. Original intent was "use my own cloud" instead of depending on third-party JSON/email transfer; JSON export/import flow is now the de-facto cross-device sync standard and is faster, so if the backend is revived it should add real value (e.g. proper conflict resolution / diff-merge rather than coarse overwrite, or push-style sync), not just mirror what the JSON flow already does.

semantic linking between flashcards/nodes influencing the flashcard superprogram algorithm to show common "clusters" or bias them to learn related information in batches - could have potential to upgrade and autonomously link for you semantically, but aside from that, we have advantage over anki in a way because owning the complete study ecosystem meant we can pull additional metadata like analysis docs references citations and the file the node is from, as well as the mindmap tool's links to build knowledge clusters for the superprogram to feed off and teach - i believe from what i remember that the superprogram already does teach in batches favouring small sections until you learn them, so this is likely a layer on top upgrade to that, biasing the cluster size and allowing it to be dynamic, not static (ie take as much as it needs to fit one semantic topic in one batch rather than a fixed count for all) - that would be valuable

inspired by bma portal: add a quick link option to your classroom to access easily from neuronet - OH MY WOW GOOGLE CLASSROOM HAS A REST API FOR DEVELOPERS LETS ABSOLUTELY GO, WE CAN GET ASSIGNMENTS AND STUFF!!!

remove layers to replace with tags, cus cant they do everything layers do but better?

add estimated time to completion for flashcard sessions — shelved for a dedicated design session; see `docs/SESSION-ETA-DESIGN.md`

add catastrophic forgetting detection - MAJOR superprogram algorithm change - where if the user gets an "easy" or "important" question wrong, the system panics and treats it critically especially only if it detects a confident answer like typical fast speed knowledge OR ALTERNATIVELY WHICH IS ALSO VALID: if it detects a LONG PAUSE implying the user blanked - this should be raised to criticial like levels, and be thoroughly hammered short term and slowly long term too to ENSURE the user never makes such mistakes - limitations to discuss: the fact that only using 3 buttons and entirely on user trust (maybe add a dont know button?) this can be hard (not the blank one - time should be relatively easy - time + poor score - might be a good idea for the system to prioritise accurate confidence over knowledge accumulation - consistent streaks backing it off almost exponentially, since its useless to repeatedly test user on things they clearly can recall right now, however if they forget something they previously knew well - almost like a delta - difference between their confidence whether thats historical evidence of perceieved self confidence in their answer speed (time to flip card - PLUS measure time from flip to clicking button, that can say a lot like if they needed to read it deeply implying somethings off, this is all about just mapping out and interpreting every microsignal from user interactions brute forcing every possible outcome)) but yeah this was a shout i think

add desktop app mode and so neuronet task manager is a thing

add journalling

add timer full screen and minimisable dockable window for app for pomodoro and general time constrained tasks - encourage timer use to time yourself doing a question. I find when analysing myself that giving myself unbounded time tends to be less productive concentrated work compared to having tight deadlines to try finish by (its okay if you fail! a timer would be better than no timer - it makes you hurry and act with intent and purpose instead of drift endlessly, but if its too stressful for a particular day or reason users can always just turn it off :) )

additionally todo tasks could do with importance and estimated length of task or even subtasks - ideally or usually the user does this in their head, so this might be overhead and procrastination material, but some short stats might be good - though i must say this has risk of "feeling" productive neatly setting your tasks in an arbitrary app but you dont actually do anything but you feel like you did work spending time on this, maybe this can be cut to a mere estimated duration feature as well as a simple priority

---

# Open tasks

## Next

- Tune the study-signal thresholds (weak `<50%`, strong `≥80%`, important `4–5`) after a week of real sessions; change them before anything else builds on the current defaults.
- Real iPad/Safari pass: double-tap zoom, pinch, Lock mode ergonomics, toolbar crowding, heap drag-release feel.

## Later / low priority

- Delete orphaned `neuronet-v9`, `FlashcardDB` and `PastPapersDB` from DevTools when convenient; no code references them.
- Blurt-session ETA: needs its own design session. Typing speed and language handling make the timing signal different from flashcards; do not include blurt in the flashcard ETA.
- Import-time derivation: when importing JSON, rebuild `contentHtml` / `contentText` from `contentMarkdown` so owner-edited exports stay consistent. Normal in-app use does not need this.
- Per-tag / per-layer `Study` buttons: consider moving them into a `⋯` menu.
- Stats default disclosure: keep Studied/Accuracy first; move Router/Inspect internals behind an advanced view.
- Launchpad `Manage` grouping for Build Deck / Edit / Heaps, once it is worth the churn.

# Constraints

- Keep `Study All Subjects (WIP)` until the all-subjects study flow exists; it is intentional, not dead code.
- Do not mass-purge emoji/glyphs; text labels are the default for controls.
- Mindmap layout is browser-local: no cross-device sync, no named snapshots.

# Deliberately not doing (unless asked)

- Branch or subject locking, or a global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change.

# Product direction

Canonical vision lives in the private docs repo at `../backend/docs/project.md` §1.1 "Product Vision and UX Direction". In short: comfort-ride default, power behind a voluntary door, hide/defer/merge over add, deck-first card creation, and no capability removed to buy simplicity.
