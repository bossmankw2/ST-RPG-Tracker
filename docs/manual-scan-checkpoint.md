# Manual message scan work checkpoint

## Scope and authorization

The user approved a new manual **Scan / Update Tracker** action on assistant replies,
version/changelog updates, and a push to the fork's `main`. Keep **Add/Edit Message
Tracker** and its editable snapshot behavior unchanged. No OOC automation.

Starting commit: `91e0593c6d31ace9bbe7e2322741f9120603d900`.
Target release: **1.3.0** (manifest, package, and lockfile root version).

## Implementation contract

- Scan the selected message's displayed swipe, never a later reply or the entire chat.
- Apply supported supplied character information to the current chat tracker; add new
  named characters, preserve IDs and per-chat locks, omit missing/unknown values.
- Explicit tracker JSON can be read directly; prose uses an additional model request
  through the configured SillyTavern connection/model. Do not parse manual `<rpgmt>`
  snapshots as source content. Model responses are validated before applying.
- Bind requests to chat, message identity, swipe, content, and history revision.
  Discard stale results after navigation, editing, deletion, or new generation.
- Only one scan may run at a time. Persist processed content per source swipe so
  repeat clicks/reloads do not reapply it. Failed or cancelled requests remain retryable.
- Store a scan's accepted-change recap separately from the existing automatic delta.
  Save the updated current state at the current timeline position, without copying
  later state into an old source reply or changing the manual snapshot payload.
- Existing automatic updates, manual Update, character generation, and scan requests
  must not overlap or accidentally process extraction output as a story response.

## Ownership during implementation

- Root: scan coordinator, native bridge/lifecycle/observer integration, recap wiring,
  persistence, regression/browser validation, release docs/version, commits/push.
- `scan_input`: MessageScanInput.js, ModelManager.js, input/model tests.
- `scan_button`: MessageScanButtonManager.js, UI tests if feasible.

## Progress

- [x] Baseline clean; origin/main verified at the starting commit.
- [x] Inspect existing message toolbar, model calls, patcher, locks and timeline.
- [x] Implement and integrate scanner + separate toolbar action.
- [ ] Regression tests and browser checks, including existing snapshot editing.
- [ ] Version, changelog, final build and clean diff review.
- [ ] Commit and push, then verify remote main matches release commit.

## Resume instructions

Read this file and `git status` before editing. Inspect current agent changes; do not
overwrite unfinished files or assume a checkbox means validation passed. Run `npm test`
and `npm run build` from the repository. Native modules are served directly; the
tracked bundle must also be built. No live model API credentials are required for the
controlled-response browser tests; do not claim live-provider validation.

Local test host/tools from the previous task are under
`/workspace/.rpg-tracker-onboarding/`. Processes may need restarting. Port 8000 uses
the staged extension with symlinked native source and a separate bundle copy; after
build copy `dist/bundle.js` to `extension/dist/bundle.js` there. Port 8001 is an older
clean-install fixture, so do not assume it contains working-tree changes.

Do not push incomplete implementation. Record test failures and the next concrete
step below before pausing or ending work.

## Last verified state / next step

Implementation checkpoint (2026-10-26): coordinator, strict input/model extraction,
separate message button, observer/lifecycle integration and recap display are present.
Full regression suite: **100 passed**, no failures/skips. Standalone DOM button
smoke passed. Production build passed (65 modules), staged on port 8000.
Native browser integration and additional verifier tests are running.

Review found native saveChatConditional swallows errors. Added captured-chat read-back
verification and scanner-owned-field rollback so unrelated concurrent metadata edits
survive failure. Scoped rollback tests passed. Agent `scan_input` owns extra verifier tests;
`browser_validation` is running isolated host tests, including chat-save failure.
No feature commit pushed. Next: inspect browser results, finish verifier tests,
update versions/changelog and review the final release before pushing.
