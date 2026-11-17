# Study signals

`src/tools/studyItem.js` is the one read model for anything the app can study.
It answers three questions for every record, in the same shape, no matter which
store the record came from.

## Why an adapter instead of one storage table

The stores are separate because the objects mean different things:

| Store | The text is… |
| --- | --- |
| `cards` | a prompt **you wrote** (`front`) plus its answer (`back`) |
| `quotes` | verbatim evidence pinned to `link.start` / `link.end` |
| `nodes` (`analysis`) | a heading (`title`) plus a document (`content`) |
| `cues` | a prompt attached to a quote or an analysis |

Renaming those fields to one vocabulary would either lose information or move
the type branching out of one file and into every component. So storage stays
normalised, and `toStudyItem()` performs the rename at read time. Nothing is
migrated, nothing is written, and the seam is reversible.

## The canonical shape

```js
toStudyItem(record) → {
  id, type, reviewable,
  title, body, subject, deck?, deckPath?,
  tags, links, meta, createdAt, updatedAt
}
```

`title` is the text the item is known by; `body` is supporting text. A quote's
title is its extracted text and has no body — it is not pretended to be a
question.

## The three signals

```js
getStudySignals(item, ctx) → {
  importance: { value: 1..5 | null, source },
  recall:     { score: 0..1 | null, level, label, derived, source },
  accuracy:   { score: 0..1 | null }
}
```

`null` means **no data**. It never means zero.

### Importance — "how much does this matter to me?"

Explicit user judgement only; never derived from SRS.

| Case | Source |
| --- | --- |
| `priority` set on the record | `user` |
| analysis → strongest linked quote | `linked` |
| cue → its quote, then its analysis | `linked` |
| source → strongest quote on that source | `source` |
| nothing to inherit | `none` |

Inheritance takes the **maximum**, not an average, so one important quote is not
diluted by weak neighbours. A stored `priority` always beats inheritance.

### Recall — "how retrievable is this right now?"

Precedence:

1. `meta.lastGrade`
2. `meta.L_phase` (`mastered` / `stable` / `stabilising` / `warming` / `new`)
3. `meta.S` + `meta.U`
4. `meta.recentGrades`
5. linked item — analysis takes the **weakest** linked quote; cue takes its
   linked quote or analysis (`derived: true`)
6. `meta.confidence` creation prior
7. `null`

### Accuracy — "when tested, how often are you right?"

`recentGrades` → `meta.accuracy` → `meta.lastGrade` → `meta.confidence` →
past-paper attempt percentages → `null`.

## Context

Derivation needs lookups, supplied by the caller so the module stays pure:

```js
const ctx = {
  findById: (id) => map.get(id),
  quotesForSource: (sourceId) => quotes.filter(…)   // optional
};
```

Mindmap passes its own in-memory graph index. Tests pass a plain `Map`.

## Tags

Tags are first-class on every study record. `promoteTags()` in `db.js` folds
the old `meta.tags` location and deletes it on write, so the invariant holds
for every record the app stores. `itemTags()` reads `tags` only.

There is no in-place data migration for old profiles: the committed
`demo-data.json` is the distribution dataset, and a device moves to the
current shape by using **Delete all data → Import demo**. Database version
bumps therefore only add or change object stores and indexes.

## What this layer must never do

- Write, schedule or modify SRS state
- Change what is due, or SuperProgram batching
- Invent a default importance of 3 (that would hide inheritance)

## Known gaps (deliberate)

- `deck` vs `subject` is the same concept with two names on cards. It is
  entangled with the unshipped deck UI, so it stays until that work happens.
- Quotes and analyses can still be reviewed directly, so they keep their own
  `meta.nextReview`. Moving SRS to cards only is a separate, deliberate change.

## Adding a type

1. Add the type to `STUDY_TYPES` (and `REVIEWABLE_TYPES` if it is scheduled).
2. Add a `case` in `toStudyItem()` mapping its own fields onto `title` / `body`
   / `links`.
3. Decide its inheritance rule in `importanceOf()` and `itemRecall()`; return
   `null` rather than a guess when there is nothing to inherit.
