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

---

# Mindmap: current state and next steps

Last updated 2026-10-30. The earlier audit and implementation logs were cleared
from this file; they remain available in git history (`git log -p -- todo.md`).
The product wishlist above is untouched.

## Working behaviour

- One tabbed inspector: Details / Connections / Heap. A normal tap opens
  Details; Lock mode temporarily changes taps to lock/unlock.
- Layout persists per browser/owner under `nn-mindmap-layout-v1:<owner>`:
  positions, camera, view mode, type filter, focus subject, and explicit locks
  (`version: 2`).
- Restored layouts are pinned so physics keeps the saved arrangement.
  Re-layout unpins, re-explodes, reframes the camera, and keeps locks fixed.
- `pinnedNodes` is an invisible session hold (restored layouts, drag grace).
  `lockedNodes` is an explicit, persisted user lock.
- Dragging moves a node. On drop it is held about 2 seconds so neighbours can
  settle, then physics reclaims it. Lock position / Lock mode hold it
  indefinitely.
- Lock visuals use node colour only: unlocked nodes are hollow, locked nodes
  fill and gain a brighter ring. Locking pulses one fading ring; unlocking
  shatters into particles. No padlocks.
- A red Unlock all pill appears only when locks exist. There is no lock-all by
  design; physics settles the map naturally.
- Graph stat pills double as type filters (stats-only in Library and Dots).
- Memory stats keeps the desktop drawer width on tablets; phones use a
  full-width sheet.
- The shell is pinned (`position: fixed`, fixed viewport height) so iPadOS cannot
  drag or rubber-band the whole document. Page pinch zoom is disabled with
  `touch-action: pan-x pan-y`; normal panel scrolling still works, and the
  Mindmap canvas owns its own pinch gesture.
- Form fields use `font-size: max(16px, …)`. iOS Safari zooms the page and
  leaves it off-centre when a focused field is under 16px.

## Verify before calling the mindmap done

- Emulated iPad (834×1194): shell height matches the viewport; every
  input/textarea/select across all five tools computes to at least 16px.
- Real iPad/Safari pass: double-tap zoom, pinch (including lifting one finger),
  Lock mode ergonomics and toolbar crowding, the 2-second drag-release feel.
- `node --check src/tools/mindmapTool.js`
- `node tests/run.mjs` (88 existing assertions)

## Known open issues, priority order

1. **Real device pass** — everything below is lower priority than what the iPad
   actually shows.
2. **Layout is browser-local.** No cross-device sync and no named snapshots.
3. **Locks made during the opening explosion persist after the settle timer**,
   not immediately. Acceptable unless it surprises real use.

## Deliberately not doing (unless asked)

- Branch or subject locking.
- A global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change. Filters point at
  nodes; the current physics behaviour is accepted. Revisit only if a filter
  visibly shoves nodes on a real device.
