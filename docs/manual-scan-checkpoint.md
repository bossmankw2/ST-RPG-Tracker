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
- [x] Regression tests and browser checks, including existing snapshot editing.
- [x] Version, changelog, final build and clean diff review.
- Publication: push release HEAD to `origin/main`, then compare remote/local SHAs.
  Repeat this check on resume before assuming the release needs another push.

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

Release validation completed on 2026-10-26 for **1.3.0**.

- Full regression suite: **113 passed**, zero failures/skips.
- Production build: passed, 65 modules; tracked bundle matches the staged host.
- Native SillyTavern 1.19.0 browser checks: **11 scenarios passed**, zero page errors.
  Covered selected older reply extraction, locks/new characters, accepted recaps,
  current timeline persistence, existing manual snapshot edit/reopen, deduplication
  after reload, invalid/network responses, busy controls, stale swipe/chat results,
  direct JSON extraction, failed-save rollback/retry and a 430px mobile layout.
- Model HTTP responses were controlled test fixtures. No live provider was tested.
- Earlier standalone button DOM smoke also passed.
- Final review fixed generated-ID/name collisions and manual snapshot comment
  wrappers that could otherwise bypass scan deduplication. Regression tests cover both.
- Native saveChatConditional swallows failures; captured-chat read-back verification
  detects them, and rollback preserves unrelated concurrent metadata edits.

Implementation was checkpointed in `cc9be41`; final release includes the review fixes,
verifier tests, README usage, CHANGELOG and aligned 1.3.0 version metadata.
The isolated browser harness is `/workspace/.rpg-tracker-onboarding/manual-scan-browser.cjs`;
its final results are in `manual-scan-results.json` beside it. A stale test-host process
was restarted during validation. The browser fixture now initializes explicit false
lock flags just as the native loader does; this avoids mistaking normalization for a
rollback data change. The final harness cleaned up its QA chats and restored settings.

Publication uses `git push origin HEAD:refs/heads/main` without force. Compare
`git rev-parse HEAD` with `git ls-remote origin refs/heads/main` to verify publication.
If interrupted, inspect those SHAs and `git status` before repeating work.
