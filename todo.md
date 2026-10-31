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

# Audit briefs for fresh agents

Read-only audits: investigate, critique, and return a spec. The agent must not
modify, commit, or push code, and should keep scripts/screenshots in
`/tmp/opencode`.

## Shared preamble

```text
You are a senior frontend/UX engineer doing a read-only product and code audit.
Do not modify, commit, or push anything. Do not install dependencies. Your job is
a critical, evidence-backed report, not an implementation.

Repository: /home/aigsniper/Documents/website/neuronet/frontend
Product: NeuroNet, a local-first study app. Vanilla JS, no framework. Each tool is
an HTML fragment loaded into index.html. IndexedDB lives in src/db.js. Demo data
is demo-data.json. Tests: node tests/run.mjs.

HOW TO RUN
  cd /home/aigsniper/Documents/website/neuronet/frontend
  python3 -m http.server 5500
  open http://127.0.0.1:5500/index.html
Click the profile card (bottom left) -> Import Demo Data, then open the tool.
puppeteer-core is in node_modules; Chrome is /usr/bin/google-chrome. Emulate an
iPad at 834x1194 with touch. Put scripts/screenshots in /tmp/opencode and leave
the repo untouched.

CONTEXT YOU MUST RESPECT
- iPad/Safari is the primary device. Touch behaviour matters more than desktop.
- The app shell is intentionally fixed (no page drag/zoom). Do not propose
  restoring page scrolling or pinch-zooming the shell.
- No new frameworks or dependencies. Prefer deleting and merging over adding.

DELIVERABLE (markdown, in chat)
- Verdict: 3-5 blunt sentences.
- Evidence: screenshots and/or code references (file:line) for major claims.
- Ranked findings: user impact, confidence, effort (S/M/L), and whether each is
  delete / merge / rework / add.
- Target model: a simple description or ASCII sketch of the intended screen,
  including what gets removed.
- Phased plan: 3-5 independently shippable slices. Slice 1 must be small.
- Open questions for the owner.
- Explicit "do not do" list: tempting changes that would add bloat.

RULES
No generic UX advice. No framework migration. No vague "improve consistency".
Every recommendation must name what to remove or merge, not just what to add.
If something is already fine, say so.
```

## Memory tool (recommended first)

Scope: `tools/memory.html`, `src/tools/memoryTool.js`, and their integration
with `index.html` and `src/db.js`.

```text
SCOPE: the Memory tool (flashcards).

AUDIT QUESTIONS
1. What is the Memory screen's primary job at each moment (create, organise,
   study, browse), and does the layout actually support it?
2. Inventory every view mode, panel, rail, and drawer. Which earn their space,
   which are redundant, which should be deleted or merged?
3. Is the context rail useful, or should it become part of a unified sidebar?
   What content genuinely belongs there?
4. How do decks, subjects, tags, and cards relate in the UI and the data model?
   Where does the user's mental model break?
5. Is the stats/Explore surface a duplicate library? What should happen to it?
6. iPad ergonomics: reachability, scroll traps, focus/keyboard behaviour, tap
   targets, visual density.
7. Code health: duplicated render paths, dead markup/CSS, state that fights
   itself. Cite file:line.
8. What is the smallest first slice that makes the screen feel coherent without
   a rewrite?

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- The context rail feels "garbage".
- The top-right view modes feel bloated and redundant.
- The stats "Explore" panel may duplicate the library.
```

## Mindmap interaction

Scope: `tools/mindmap.html` and `src/tools/mindmapTool.js`.

```text
SCOPE: Mindmap interaction. Do not propose a graph-engine rewrite.

AUDIT QUESTIONS
1. The double sidebar is the owner's biggest complaint. What is each sidebar
   for, where do they overlap, and what is the single-sidebar target?
2. Assess the heap drag-and-drop feel on touch: floating row vs drop line,
   gap/insertion feedback, release, auto-scroll, accidental drags.
3. Inspector vs library split: what belongs in Details / Connections / Heap,
   and what should disappear?
4. Lock ergonomics (per-node locks only; no branch or global lock-all). Is Lock
   mode discoverable, and does it fight normal selection?
5. Search, filters and view modes on an iPad: which controls are redundant or
   badly placed?
6. Touch targets, scroll traps, focus/keyboard behaviour, toolbar crowding.
7. Code health around these interactions. Cite file:line.
8. Smallest first slice that removes the double-sidebar smell without a rewrite.

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- The double sidebar is a "red flag and a big no no".
- Heap reordering feels "super clunky rather than modern intuitive".
- Styling and usability need QoL work; functionality is sufficient.
```

## Flashcard creation

Scope: the create / quick-add / mass-edit paths in `tools/memory.html` and
`src/tools/memoryTool.js`.

```text
SCOPE: flashcard creation flow.

AUDIT QUESTIONS
1. Measure time-to-first-save for a single card. Where does the flow add
   friction before the card exists?
2. Should saving happen first and organising after? Design that flow.
3. Decks vs subjects vs tags vs layers: what is the intended hierarchy, where
   does the UI contradict the data model, and what should be removed?
4. What does the builder force on the user that could be optional or deferred?
5. Bulk entry and mass edit: what is missing or overbuilt?
6. iPad ergonomics for typing-heavy flows: keyboard, focus, scrolling, tap
   targets.
7. Code health in these paths. Cite file:line.
8. Smallest first slice that makes creating a card feel fast.

OWNER'S CURRENT COMPLAINTS (verify, do not assume)
- Creating cards should save them immediately as unlisted, then offer to
  organise them into a subject/topic.
- A "deck" may be a topic rather than a subject; large sets need hierarchy.
```

## Compact open issues

- Real iPad/Safari pass still pending: double-tap zoom, pinch, Lock mode
  ergonomics, toolbar crowding, heap drag-release feel.
- Mindmap layout is browser-local: no cross-device sync, no named snapshots.
- Locks made during the opening explosion persist after the settle timer, not
  immediately.

## Deliberately not doing (unless asked)

- Branch or subject locking, or a global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change. Filters point at
  nodes; the current physics behaviour is accepted. Revisit only if a filter
  visibly shoves nodes on a real device.
