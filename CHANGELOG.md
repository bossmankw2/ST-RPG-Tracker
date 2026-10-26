# Changelog

## 1.3.1 — 2026-10-26

- Add **Suggest** beside Status, Profile and Relationship guidelines in Prompt Editor
  → Field Definitions. Generate a short guide through the configured AI connection/model.
- Place suggestions in the existing editable textbox as a draft. Save Changes applies
  the text; Cancel discards it. Keep guideline drafts separate when fields are renamed.
- Use only the selected field's metadata and current draft, without sending chat history
  or current character values. Keep output concise and preserve the draft on failures.
- Discard late suggestions after edits, import/clear, field or chat changes, and closing.
  Prevent overlapping AI requests and keep the controls usable on desktop and mobile.

## 1.3.0 — 2026-10-26

- Add **Scan / Update Tracker** beside the existing message actions on AI replies.
  It updates the current tracker from the selected reply's displayed swipe and can
  add new named characters with supplied stats, profile and other supported fields.
- Read explicit RPG_TRACKER JSON directly; extract narrative facts through an
  additional request using the configured SillyTavern connection/model.
- Preserve **Add/Edit Message Tracker**, manual snapshot contents, character IDs,
  and per-chat locks. Exclude manual snapshots and old recaps from scan input.
- Show accepted scan changes on the source reply while saving the updated current
  tracker at the current timeline position. Keep automatic deltas separate.
- Reject ambiguous character names and conflicting saved IDs before applying a scan.
- Keep scan deduplication intact when native or legacy manual snapshots are edited.
- Prevent concurrent/repeated scans, discard stale results after chat/swipe/source
  changes, validate model output, and verify saved scan data from the server.
- Preserve unrelated edits when a failed save is rolled back. Resolve identical-text
  swipes using the selected swipe ID when restoring history and displaying recaps.
- Align manifest, package and lockfile root versions at 1.3.0.

## Initial fork improvements — 2026-10-20

- Add drag sorting for Character List and Profile/Status fields, with touch and
  keyboard support, clearer Apply/Cancel actions and responsive editors.
- Store presets in the SillyTavern account on the server; migrate available legacy
  browser presets and retain browser copies as backups.
- Keep per-chat locks and protected values through swipe/regenerate, and report
  only accepted changes in recaps.
- Preserve stable character/field IDs and prevent a settings refresh from undoing
  pending editor changes.
- Add repeatable build commands and regression tests; rebuild the distributed bundle.
