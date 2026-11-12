# Session time estimate — design note

**Status:** Shelved for a dedicated design session. Do not implement yet.
**Scope:** Flashcard session ETA in the Memory tool (one of the QoL batch items).
**Created:** 2026-11-10

This note records the first design conversation so it can be picked up later
without losing the reasoning. The user wants to participate in the design and
revisit the trade-offs before any code is written.

---

## Why this is interesting

Estimating how long a flashcard session will take is an **online
decision-making under uncertainty** problem. The system has to give a useful
number now, without knowing future cards, pauses, mistakes, or how the
scheduler will react to them.

The impossible benchmark is the **clairvoyant / offline optimum**: an
algorithm that knows every future card, every pause, and every wrong answer in
advance. **Competitive analysis** measures how close an online algorithm gets
to that oracle. For session ETA, the worst-case ratio is unbounded — one card
can take two seconds or two minutes, and a failed card can re-enter the queue.
So exact prediction is not the goal.

The goal is a **calibrated estimate that learns from the session as it
unfolds**:

- **Online prediction** — update after each observation.
- **Calibration** — when we say “about 20 minutes”, real sessions should land
  in that range most of the time.
- **Survival / heavy-tail modelling** — review times are skewed; a few cards
  dominate. Means are unstable; medians and ranges are safer.
- **Branching processes** — failed cards create extra future reviews, so
  expected remaining work is not just `cards × average`.

---

## Proposed design direction

A calm, honest estimator rather than a countdown.

1. **Estimate remaining work, not exact time.**
   `remaining cards × expected time per card × expected repeat factor`.

2. **Blend a prior with observed pace.**
   Early in the session, use deck/global history. After a few cards, shift
   toward the user’s actual pace this session. This is Bayesian shrinkage in
   spirit: do not overreact to one slow card.

3. **Model repeats explicitly.**
   If a card is likely to be graded “again”, it adds expected extra reviews.
   Even a crude `P(again) × extra time` is better than pretending the queue is
   fixed.

4. **Show a range, not false precision.**
   e.g. “~18 min left (usually 14–24)”. Early on: “Still estimating — maybe
   20–30 min.” Later, tighten the range.

5. **Update smoothly.**
   Recompute after each card, but clamp jumps so the number does not flicker.
   Never show seconds.

6. **Separate study time from breaks.**
   “~20 min of study” is more truthful than implying wall-clock time.

7. **Cold start gracefully.**
   New user or new deck → global median, then deck median, then session pace.
   No scary “0 min” or “99 min” guesses.

8. **Validate it.**
   Log predicted vs actual at session end. Track MAE and whether the 80% range
   actually contains the truth. If it does not, the model is lying, not
   “approximately right”.

---

## The genuinely hard part

The scheduler and the ETA are coupled. If the scheduler injects extra cards,
shortens intervals, or reacts to mistakes, then **the future set of cards is
itself a random variable**. That is not just “predict duration”; it is
“predict the output of a control system whose future decisions depend on
future outcomes”.

Decide whether the ETA is:

- **A:** an estimate for the *current fixed queue*, or
- **B:** an estimate for *everything the session will actually make you do*.

B is more useful but much harder. Start with A and label it clearly, then
extend once real timing data exists.

---

## Open design questions

1. **Point or range?** Range is more honest; a single “~18 min” may feel
   calmer.
2. **Should failed cards visibly extend the estimate?** Likely yes — it
   teaches the user that the number is live, not a contract.
3. **Per-subject/deck learning or one global pace?** Per-deck is more accurate
   but needs more data. A hierarchy (global → subject → deck) is the principled
   answer.
4. **Does the estimate include the current card and any breaks?**
5. **Always visible, or power-user-only?** Product direction says comfort-ride
   default, power behind a voluntary door. A quiet “~18 min” fits; a ticking
   countdown does not.
6. **What is a “session” for this purpose?** Fixed queue at start, or the
   dynamic set the scheduler will actually serve?

---

## Next step when this is resumed

Do an **instrumentation pass** first:

- Check whether the Memory tool already records per-card review durations and
  outcomes.
- If it does, replay history and test estimators offline before touching the
  UI.
- If it does not, add local timing capture (start/finish per card, grade,
  session boundaries) before building the estimator.

That is the cheapest way to learn what “calibrated” actually looks like for
the real data.

---

## Conversation excerpt

> **User:** “i like a lot of these design points - i was thinking documenting
> this could be really sweet - honestly can we talk more after you do the other
> two? ... just shelve this maybe so i can really dig in a little later, i want
> all of this saved and picked up later, ill reread it then, literally save
> this message somewhere in a .md file - our endeavours recorded in a paper or
> something would be lovely”

> **Assistant:** The CS framing is online decision-making under uncertainty,
> with the clairvoyant/offline optimum as the impossible benchmark. The design
> target is a calibrated, self-correcting distribution — not a false-precision
> countdown.

---

# Session 2 — 2026-11-11

## Agreed direction

- **Keep `responseTimeMs` exactly as it is.** It measures time from card shown to
  flip — recognition / recall latency and a confidence hint — and feeds the
  SuperProgram. Do not redefine it.
- **Add a parallel `cardDurationMs`** (shown → grade) used only by the ETA. Any
  SuperProgram change — including using the new signal — needs a separate
  proposal and explicit approval.
- **One quiet, dismissible pill** near `#roundProgress`. Not a countdown, not a
  nag: a comfort signal that says roughly how long the remaining work takes.
- **The pill carries the whole answer**: main value ≈ time, the range next to
  it, and cards left. No need for a sophisticated predictor; a robust MVP is
  enough.
- **Promise the whole remaining session**, not just the initially visible queue
  (heap + expected re-queues + surprises), and label it as study time.
- **SuperProgram interpretation of the timing pair is a later proposal**, not
  part of the ETA build. The matrix below is the working model.

## Timer definitions

- `flipMs = revealedAt − shownAt` — existing `responseTimeMs`.
- `dwellMs = gradedAt − revealedAt` — new: reading the answer and choosing.
- `cardMs = gradedAt − shownAt` — minus hidden-tab time, with a per-card cap
  (e.g. 5 min) so a walk-away does not poison the average.
- Guard accidental input: `flipMs < 400` or `dwellMs < 300` → do not learn from
  that sample.

## Pill

- Main: `≈18 min (14–24)`; muted second line: `12 cards left`.
- Early: `Estimating…` with a deliberately wide range.
- Final card: `Last card`.
- `×` collapses to a small clock; restore from Stats; hide preference persists.
- Recompute per grade and move at most ~20–25% per update. Never show seconds at
  or above one minute; precision scales with magnitude instead of a fixed step:
  - under 1 min → 10-second steps (`~40 sec`)
  - 1–30 min → 1-minute steps (`~7 min`, `~14 min`)
  - 30–120 min → 5-minute steps (`~45 min`)
  - over 2 h → 10-minute steps (`~2 h 10 min`)
- Apply the same step to the range bounds and keep `high − low` at least two
  steps wide. Hide the range when it is already tight (< 2 min), so it does not
  add noise.
- Short sessions therefore keep their detail: `~3 min` stays `~3 min` instead of
  collapsing to `~5 min`, and the 10→5 jump disappears.

## MVP estimator

- Prior by card kind (`getExpectedTimeMs`), blended with queued cards'
  historical `avgTime`, shrinking toward this session's median as samples grow.
- `remaining` = unique cards not yet graded in this pass (heap + surprise pool +
  the current card), deduplicated by queue key.
- Repeat inflation from the session miss rate, capped around 2×.
- Range from session dispersion: prior-wide early, tighten as n grows.
- At session end log predicted vs actual; track MAE and whether the range
  actually contains the truth.

## Session boundary

`global_srs` deliberately re-inserts every graded card, so the raw heap size
stays at the deck size and a session never drains on its own. Counting heap
items would therefore freeze the pill at `14 cards left` forever.

The ETA therefore defines a session as **one pass through the queue's unique
cards**:

- A card counts as remaining until it has been graded once in this pass.
- Re-queued cards do not re-enter the count; their extra time is modelled by
  the miss-rate inflation instead.
- The estimate finishes (and calibration is logged) when every unique card has
  been graded once. Repeats after that are a new pass; the pill hides rather
  than restarting and contradicting itself.
- Manual heaps already study each card once, so the same rule applies without
  special-casing.

This keeps the promise honest: "cards left" is the actual first-pass workload,
and the time estimate still includes an allowance for expected repeats.

## Storage

- `neuronet:memoryEtaHidden` — the dismiss preference only.
- `neuronet:memoryEtaSessions` — the last 12 aggregate calibration records
  (predicted, range, actual, card count).
- Both are local-only and intentionally **not** part of the app-wide JSON backup;
  they are diagnostics, not study data. No raw per-card session history is kept.

## Signal interpretation matrix (proposal only — NOT wired into SRS yet)

| flip | dwell | grade | reading | action |
|---|---|---|---|---|
| fast | fast | easy | confident recall | none |
| fast | fast | poor | slip, misread, or guess | re-ask before concluding; one sample is weak |
| fast | slow | poor | **misplaced confidence** | critical: reinsert soon, hammer short-term |
| fast | slow | kinda | near-miss / mark-scheme wording / self-correction | soft flag + retrain, no punishment |
| fast | slow | easy | careful verification | none; counts as one pass |
| slow | fast | easy | effortful retrieval, solid once seen | none; perhaps spacing |
| slow | fast | kinda/poor | blanked / forgot | normal SRS shorten + reinsert |
| slow | slow | poor | genuine failure or blank | normal SRS |
| very fast | very fast | any | accidental / autopilot | discard the sample |
| — | — | — | tab hidden during card | exclude the gap |

**False-positive guards**

- Only call it misplaced confidence when the card had prior evidence of
  confidence (reviewCount ≥ 2, previous fast average, or an easy streak). A new
  card cannot be overconfident.
- One event is weak evidence; require a pattern or a strong deviation.
- `kinda` + near-miss is retraining, not punishment and not relaxation.
- Exclude hidden-tab gaps and accidental taps before interpreting anything.

## Open

- Does the pill's hidden state persist across sessions, or reset each session?
- Cards line: `12 cards left` (honest with a dynamic heap) or `card 7 · 12 left`?
- v1 mode scope: graded card/quote/analysis sessions only, or also blurt?
- Does the interpretation matrix become a later SuperProgram proposal?
