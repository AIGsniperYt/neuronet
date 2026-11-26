mindmaptool allow star topology or a general sidebar treebuilder sidebar allowing user to rearrange how parents are rendered and bonds are made visually, featuring a tag as the centre or in general allowing users to build their mindmap as they wish setting the innermost parent of the star a tag for example, and allowing only some nodes to be rendered etc in short a comprehensive visual engine

revive cloud backend: reactivate the Node/Express sync backend (currently stale/unused) OR decide to archive it. Original intent was "use my own cloud" instead of depending on third-party JSON/email transfer; JSON export/import flow is now the de-facto cross-device sync standard and is faster, so if the backend is revived it should add real value (e.g. proper conflict resolution / diff-merge rather than coarse overwrite, or push-style sync), not just mirror what the JSON flow already does.

semantic linking between flashcards/nodes influencing the flashcard superprogram algorithm to show common "clusters" or bias them to learn related information in batches - could have potential to upgrade and autonomously link for you semantically, but aside from that, we have advantage over anki in a way because owning the complete study ecosystem meant we can pull additional metadata like analysis docs references citations and the file the node is from, as well as the mindmap tool's links to build knowledge clusters for the superprogram to feed off and teach - i believe from what i remember that the superprogram already does teach in batches favouring small sections until you learn them, so this is likely a layer on top upgrade to that, biasing the cluster size and allowing it to be dynamic, not static (ie take as much as it needs to fit one semantic topic in one batch rather than a fixed count for all) - that would be valuable

inspired by bma portal: add a quick link option to your classroom to access easily from neuronet - OH MY WOW GOOGLE CLASSROOM HAS A REST API FOR DEVELOPERS LETS ABSOLUTELY GO, WE CAN GET ASSIGNMENTS AND STUFF!!!

remove layers to replace with tags, cus cant they do everything layers do but better?

add triaging mode for todo dumping and ordering, use neuronet as the central task manager system

add a power off/logout button next to the profile icon - this is the safe way to terminate a session and remind the user to do the good things such as leave a good entry point for your next session, allow pasting of urls or something perhaps so on the launchpad on next visit it could give a quick link to help you jump in and really avoid that friction on a cold start - just integrate all the good study habits into the app

also another good atomic habit would be to have breaks every like 20 minutes - the app reminds you with a quieter toast to take a break, and if you do not idk, fulfil some criteria for "taking a break" - ie stepping away from the screen physically and forcing yourself to think for 5 minutes - then 5 minutes later (in total the max time is 25 mins therefore, because 20mins toast + 5 mins = 25) a large banner warning will forcibly request you to comply and step away and reflect, this is good because it realigns you from any tangents you got distracted in, and also lets you clear your mind for what matters, rather than be like an agent on a doom loop achieving nothing, frequent reminders are key, but also, maybe adding a settings menu for a way to toggle this off is also good, because like sometimes like in school or in public you dont want your app to un-discreetly block you with a timeout banner forcing you to leave, sometimes like in a study period you just have to stick through the full hour, or sometimes at home too when youre doing a long horizon task without much switching or overhead except raw processing, and also maybe this can manifest as a small automatic timer set at the top in the smallest preset just to let you know how much time youve spent (a stopwatch might be nice? or perhaps a timer? though a timer is awkward beause of the two phase nature of 20 mins -> toast, 25 mins (+5 from toast) = banner block with a "dismiss" or "bypass" button if you want manual override, though the app might feel its necessary to advice you to do this for the good reasons ive stated here aforementioned)

also i was considering making neuronet its own study centered browser, so users can truly open files, documents, websites alongside the central app itself which is integrated into the browser so their entire workflow there is study mode - ive also always wanted to make a browser

add estimated time to completion for flashcard sessions — shelved for a dedicated design session; see `docs/SESSION-ETA-DESIGN.md`

add catastrophic forgetting detection - MAJOR superprogram algorithm change - where if the user gets an "easy" or "important" question wrong, the system panics and treats it critically especially only if it detects a confident answer like typical fast speed knowledge OR ALTERNATIVELY WHICH IS ALSO VALID: if it detects a LONG PAUSE implying the user blanked - this should be raised to criticial like levels, and be thoroughly hammered short term and slowly long term too to ENSURE the user never makes such mistakes - limitations to discuss: the fact that only using 3 buttons and entirely on user trust (maybe add a dont know button?) this can be hard (not the blank one - time should be relatively easy - time + poor score - might be a good idea for the system to prioritise accurate confidence over knowledge accumulation - consistent streaks backing it off almost exponentially, since its useless to repeatedly test user on things they clearly can recall right now, however if they forget something they previously knew well - almost like a delta - difference between their confidence whether thats historical evidence of perceieved self confidence in their answer speed (time to flip card - PLUS measure time from flip to clicking button, that can say a lot like if they needed to read it deeply implying somethings off, this is all about just mapping out and interpreting every microsignal from user interactions brute forcing every possible outcome)) but yeah this was a shout i think

additionally todo tasks could do with importance and estimated length of task or even subtasks - ideally or usually the user does this in their head, so this might be overhead and procrastination material, but some short stats might be good - though i must say this has risk of "feeling" productive neatly setting your tasks in an arbitrary app but you dont actually do anything but you feel like you did work spending time on this, maybe this can be cut to a mere estimated duration feature as well as a simple priority

add desktop app mode and so neuronet task manager is a thing:
/btw can we make our app into a desktop app too, or atleast access parts of it on boot on my desktop cleanly (im on kubuntu linux) - like a nice panel to show todo tasks and quickly add new ones and dump the pressure off your mine - thatd be nice

exam builder - add pdfs and slice questions into questions to feed to the database by topic, and then you can build custom tests from selecting filters on which chapters youve done, and then it will keep track of which questions you flopped, etc, and can keep the ENTIRE database heatmap for you, while letting you find questions and revise, nice and simple addition, but might feature the custom OCR tool up and coming, that might be needed

---

# Open tasks

## Next

- Tune the study-signal thresholds (weak `<50%`, strong `≥80%`, important `4–5`) after a week of real sessions; change them before anything else builds on the current defaults.
- Real iPad/Safari pass: double-tap zoom, pinch, Lock mode ergonomics, toolbar crowding, heap drag-release feel, and the Timer tool/dock layout (size menu, stopwatch, focused-session transition, hover sidebar).

## Later / low priority

- Blurt-session ETA: needs its own design session. Typing speed and language handling make the timing signal different from flashcards; do not include blurt in the flashcard ETA.
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
