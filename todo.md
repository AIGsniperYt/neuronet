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

---

# Pending manual test

- [ ] **Memory Focus-quick-look** — shipped `120684c`. Tap any row in the Focus-tab heap queue (including the current "on screen" card) to open a temporary Front/Back preview. Close with the X, tapping outside, or Escape; focus returns to the row. It is read-only: no session start, no grading, no queue movement, no SRS changes. Check desktop and real iPad/Safari.

# Still open

- Real iPad/Safari pass: double-tap zoom, pinch, Lock mode ergonomics, toolbar crowding, heap drag-release feel.
- Mindmap layout is browser-local: no cross-device sync, no named snapshots.
- Locks made during the opening explosion persist after the settle timer, not immediately.

# Deliberately not doing (unless asked)

- Branch or subject locking, or a global Lock all action.
- Redesigning the stat pills.
- A new test framework.
- Re-flowing the graph when search or type filters change. Filters point at nodes; the current physics behaviour is accepted. Revisit only if a filter visibly shoves nodes on a real device.

---

# Owner decisions (answers kept, agent prompts removed)

## 1. What is a deck?

**Your answer:** yes decks are a temporary collection of cards, which could be confusing - but take it as this analogy, your full cards set is absolute like a library, a deck is merely like a collection of books you can collect into a pile and take with you to study in a session, and even save them so you can instantly cash out the same pile or modify it without redoing it. a subject is the canonical owner of that card, if it has one, and its something like biology or whatever, a deck is simple something like exam questions, or fact recall, or biological molecules, cards arent exclusive to one deck, a deck is a pile of references to the actual books borrowed, not transferred ownership, its permanent in the sense it saves for users like an easy list to cash out without losing it over sessions, but its temporary in the sense its unassigned and is nothing but a name and a list of references for convenience, which the memory tool allows you to take inside to study using its machinery but letting you manual override the scheduling the srs algo does for you, instead picking which cards and what order you wanna do, however, it still takes your data and it counts as training, contributing to your stats

## 2. Which card browser is canonical?

**Your answer:** uh sure ur default seems right but i dont quite understand, talk to me about this one, but yeah i thought since mindmap is the tool to handle your database like an easy view layer with no intent to modify or use the data like analysis tool can analyse and highlight sources as its purpose or the memory tool purpose is to teach this into your memory, not primarily to let you view it, mindmap is purely for viewing and for basic CRUD operations on your database, nothing complex like the other tools, just seeing and handling your knowledge data

## 3. Which study modes do you actually use?

**Your answer:** idk - this i feel like is a bad question because the idea shouldnt be to delete this since we want our tool to be useful and super powerful with multiple ways to learn and drill things into memory, theres always something for everyone, so the biggest complaint was making the ux and the flow of the ui less bloated while preserving this level of capability, even if it is admittedly a stub, mainly only using cards - this model can be outdated and stale too since the big cards update where we made card objects their own thing, so its no longer the case of quote and analysis nodes together generating a card but yh, thats its whole discussion, but the bottom line point is to try to aim to remove ui and ux flow bloat, not functionality, though admittedly the other ones barely function cus ive not given them attention

## 4. Mindmap: Dots and stat pills

**Your answer:** once again terrible question, you cant remove a whole view, and yes its meant to be good imagine wanting to navigate all your flashcards before an exam and hammer in weak ones, dots is so much better than graph because it focuses only on cards and compactly shows so much info - this isnt a question to remove, youre right, maybe we can do something about it on ipad but no deletion

## 5. Mindmap: one heap surface

**Your answer:** not quite sure wat the q is - talk abt this

## 6. Context rail

**Your answer:** talk abt this w me - i just dontt like how out of place it is, it literally doesnt belong here naturally - serious design discussion
