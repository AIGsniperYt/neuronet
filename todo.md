---

## Agent Work Log — 2026-10-27 (current)

**Goal:** finish the card-first migration and make backup/export/demo data carry the new shape without manual repair. Cards are the only study unit; quotes, cues, analyses, sources, and tags are optional knowledge context.

### Shipped / current pass
- **Deck builder is card-first end to end.** The form is Front / Back / Priority / Tags; the layer editor and `layerPillState` are gone. `persistDeckCards()` writes only the `cards` store and preserves SRS, stable order, deckPath, links, origin, and creation time. It updates in-memory card IDs after save so a second save cannot duplicate cards.
- **Mass edit is card-first.** It edits front/back/priority/tags, tracks removals, saves through `persistDeckCards()`, and no longer writes quote/cue records.
- **Anki import is card-first.** Imported rows become `{cardId, front, back, priority, tags, isExisting}`; no `cueId`, `quoteId`, `cueFront`, `quoteBack`, or `layers`.
- **Quick Add never blocks on organisation.** A blank deck saves to **Unsorted** for both single and bulk capture. The deck field is labelled optional and focus starts on the card front.
- **Middle UI opens in Cards.** Clicking a deck resets `currentMode` to `card-learning` and `renderMiddleUI()` syncs the active pill. Cards is first; Quotes, Analysis, Evidence, and Blurt remain optional knowledge modes.
- **Quotes mode works without cues.** It builds a plain recall queue from the deck's quote records and never reads or writes legacy cue pairs.
- **`custom-deck` is retired.** Startup and import strip it from quote metadata and the `tags` store. Analysis tag sync and card/Grid tag helpers filter it. The old custom-deck display branches and dead layer/custom-deck CSS were removed.
- **Legacy fallback pairs are read-only context.** The builder may link an unbackfilled quote/cue once, but never rewrites either record. Deleting a card deletes only the card.
- **Legacy sync now has clear ownership.** `syncCardsFromLegacy()` only refreshes cards with `origin: "legacy"` whose `legacyUpdatedAt` is older than the legacy record; user-authored cards linked to quotes are never overwritten. Saving a legacy-origin card bumps `legacyUpdatedAt`, so builder edits survive the next startup sync. Cue-less quotes get a section-aware completion prompt instead of duplicating the quote on both faces.
- **Demo data is card-first.** `demo-data.json` ships 14 explicit cards (`origin: "demo"`) with authored fronts/backs, quote/source links, and theme tags. Importing demo data now exercises the same path as user data; legacy backfill does not duplicate those cards.
- **The tag store is a derived index.** Export omits it; import clears and rebuilds it from the final nodes, quotes, and cards. Startup reconciles it only when it disagrees with those records, removing orphaned/stale tags without rewriting a healthy index.
- **Demo detection is identity-based.** It compares explicit demo card IDs/count, with a legacy-only fallback for older payloads. Studying demo cards changes SRS but not identity, so the demo/wipe path stays stable.

### Test status
- `node --check` passes for every `src/**/*.js` touched in this pass.
- Migration round-trip Puppeteer smoke: **25/25**. Covers dirty legacy startup self-heal, section-aware fallback prompts, reserved-tag stripping, demo import replacement, stale-tag removal, demo detection, JSON export/import, derived-tag rebuild, and legacy-sync ownership.
- Legacy card edit smoke: **6/6**. Covers startup refresh, `legacyUpdatedAt`, builder edit survival across reload, link preservation, and no rewrite of the legacy quote.
- Existing legacy cleanup smoke: **15/15**.
- `tests/demo_data_fixture.mjs`: **57 passed, 0 failed** with the explicit demo cards.
- Scripts: `/tmp/opencode/migration_roundtrip_smoke.mjs`, `/tmp/opencode/legacy_card_edit_check.mjs`, `/tmp/opencode/legacy_cleanup_smoke.mjs`. One-off checks, not a test suite.

### Next steps
1. **Task 2 — Dots migration** (queued as item 21 above): one session-persistent card scene object per card, canonical `x/y`, simultaneous Graph → Dots morph, reverse-first Dots → Graph morph, aggressively optimised.
2. Keep `../project.md` updated after each slice; replace this log rather than appending.

### Problems / risks
- Cloud sync (`src/sync.js`) still has no cards endpoint; JSON export/import is the complete card backup path.
- The middle UI still exposes a path filter built from `deckPath` for existing nested decks, even though new cards start at `[deck]`. This is data compatibility, not a creation flow.
- The knowledge context rail is read-only and only appears in Cards mode.
- The shipped demo set is authored around the Macbeth material; adding another subject means adding explicit demo cards, not relying on legacy backfill.
