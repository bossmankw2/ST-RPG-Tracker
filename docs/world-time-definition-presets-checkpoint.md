# World event time and field definition presets checkpoint

## Scope and authorization

User approved implementation, version/changelog update, commit and GitHub push on
2026-11-17. Only this extension repository and local QA fixtures are modified;
no access or changes to the user's SillyTavern VPS are involved.
Base: 24ea373 (1.3.1). Target release: 1.4.0.

- Keep existing World Event names/descriptions and merge behavior. Add optional
  in-story startDate/startTime/endDate/endTime, editable on each event. Preserve
  recorded starts on AI updates; do not stamp old events with today's/current
  World State date. Include timing in model recall, scan and snapshots/recaps.
- Add named Field Definitions presets in the authenticated SillyTavern account
  settings. Save guideline drafts only; load matching existing keys into editor
  drafts. Save Changes applies to chat; Cancel discards loaded drafts. Explicit
  overwrite review, fresh server reads, conflict/error handling and read-back.
- Same server/account supports PC or VPS and multiple devices. Presets live in
  account data, not the extension install folder; migration requires ST data.
- Preserve per-chat locks, existing Suggest, scan and manual snapshot actions.

## Ownership and work in progress

- world_event_core: patcher, migration, prompts, selected-reply scan, core tests.
- world_event_ui: WorldSection UI, timestamp formatter, snapshot/recap display.
- definition_preset_storage: field-only preset service, shared native storage
  bridge queue and storage tests.
- definition_preset_ui: Prompt Editor controls and async draft protections.
- upgrade_browser_validation: native ST 1.19.0 QA harness outside repository.
- root: bridge/default settings integration, review, release docs/build and push.

## Resume

Inspect git status and this file before editing. Agents share the same workspace.
Run npm test and npm run build after integration; stage built dist/bundle.js into
/workspace/.rpg-tracker-onboarding/extension/dist/bundle.js for native QA.
Record final checks here before committing. Push without force using
`git push origin HEAD:refs/heads/main`; compare local HEAD with remote main.

Validation and publication are pending. Desktop cache previously needed DevTools
Empty Cache and Hard Reload; do not add unrelated startup/cache changes here.
