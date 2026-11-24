# World Event order and bulk field guidelines

Base 278d33a (1.4.0). Release 1.5.0. Implementation and publication to main
authorized on 2026-11-24. Initial checkpoint ee210c1.

- World Events supports drag by handle with mouse, touch or keyboard. Reordering
  and Sort by Time commit worldState.events to the active chat. Recall and
  subsequent tracker updates use that sequence. Equal starts keep their relative
  order and incomparable timestamps keep their slots. Numbered story days sort
  within their own calendar. Newly discovered events append.
- Preserve event identity through next updates for similarly punctuated titles
  and preserve the selected swipe when two replies contain identical text.
- Suggest All fills empty Status, Profile and Relationship guides by default.
  Regenerate all requires confirmation before replacing existing text. One AI
  call can return up to eight field guides. Only a full valid response set is
  applied to the draft. Both sides of a relationship are discoverable.
- Generated drafts and pending requests survive a settings refresh for the same
  field data and turn. Changed fields, typing, chat switches and closing the
  editor invalidate stale requests. Save Changes and Save to Server work on the
  edited guidelines.

## Validation

- Full suite: 160 tests passed, zero failures or skips.
- Production build: 71 modules, 728.49 kB (gzip 166.91 kB). Distributed bundle
  matches the staged SillyTavern 1.19.0 test installation.
- Native QA used isolated test chats and controlled AI responses. The main 15
  scenarios cover mouse/keyboard/touch sorting, server read-back, reload,
  subsequent scan, recall, batch generation, target-only guidelines, presets,
  confirmation, editing, stale results, settings refreshes, malformed responses,
  retry and mobile controls.
- Five additional browser scenarios covered duplicate swipe text, saved order
  after reload, an active drag through a routine settings refresh, cancellation
  after list replacement and editing/dragging duplicate legacy entries. All 20
  browser scenarios passed with zero page errors. The fixture was restored.
- Browser scripts, screenshots and results are under
  `/workspace/.rpg-tracker-onboarding/` (sort-bulk and sort-extra files).
- Before repeating publication, compare local HEAD with remote main. Use
  `git push origin HEAD:refs/heads/main` without force.
