# Journal — design note

**Status:** MVP implemented (STUB storage).  
**Scope:** A private, local space for personal reflection — psychological realisations, philosophical thoughts, self-analysis and self-optimisation. Not an academic log, not a planner, not a habit tracker.

## Intent

Students (and people in general) often reflect a lot but struggle to *prove* it later: when asked for a concrete example of introspection, the feeling is familiar but the specifics are gone. This tool exists to give those thoughts a place to land so they can be revisited, quoted and built on.

Writing here is also a way to think: talking to yourself on the page can surface bottlenecks, clarify values, and turn vague discomfort into something workable. The journal is about improving as a person, not performing productivity.

## Principles

- **Unstructured by default.** No required fields, no schedules, no streaks, no goals, no moods. A rigid system turns reflection into homework.
- **Free entries.** Each thought gets its own entry with an optional title, created when inspiration hits. "Reflect" always opens a fresh page.
- **Retrievable.** Full-text search and a quiet **Insight** mark let you find the entries that mattered when you need evidence of your own thinking.
- **Private.** Entries live on this device. They are included in your JSON export/backup but never sent to cloud sync.

## MVP behaviour

- Markdown-capable editor (via the vendored `md-format`), large and quiet.
- One optional, dismissible "starting point" prompt on an empty entry — insertable, never blocking.
- Reverse-chronological list grouped by month, with snippet, word count and last-edited time.
- Autosave; explicit delete with confirmation.

## Storage — STUB

Entries are stored in the `journals` IndexedDB object store (schema v12) for now so the feature works today and survives browser resets through export/import. This is **stub storage**: the planned overhaul moves user-owned data to the PC/file system. The journal accessors in `src/db.js` are kept thin and the UI talks only to them, so migration should replace the persistence layer rather than the tool.

Out of scope for the MVP: file-system mode, tags/folders, templates, mood tracking, calendar heatmaps, attachments, encryption, AI summaries.
