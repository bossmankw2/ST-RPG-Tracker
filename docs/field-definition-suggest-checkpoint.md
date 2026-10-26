# Field definition suggestions checkpoint

## Requested behavior

Add **Suggest** beside each AI guideline in Prompt Editor → Field Definitions.
Use the configured SillyTavern AI connection/model to write a short, clear guide for
that field. Populate the editable textbox; apply only through **Save Changes**.
This generates field guidance, not character values. Existing Add/Edit Message
Tracker and Scan / Update Tracker continue to work.

Base: acb71085fa4608aae92090ceb83a10870cd06307 (1.3.0).
Planned version: 1.3.1. Follow the user's established version/changelog/checkpoint
and GitHub publication workflow after validation.

## Ownership

- Root: native bridge/model integration, generation overlap guard, native browser
  validation, release metadata/docs and publication.
- field_suggest_service: new FieldDefinitionSuggestion.js and service tests.
- field_suggest_ui: PromptEditor.jsx/CSS and optional editor component.

## Guardrails

- Input contains only field metadata and its existing draft, no chat history or
  character values. Return concise editable plain text.
- One request at a time; do not overlap scans, manual updates or story generation.
- Failures preserve the existing draft. Discard a late result after edits,
  rename/remove, import/clear/reset, chat change or closing the editor.
- Suggestions stay local until Save Changes; Cancel leaves tracker definitions alone.

## Validation and resume

Validation completed on 2026-10-26 for version **1.3.1**.

- Full automated suite: **121 passed**, zero failures/skips.
- Production build: passed, 65 modules; tracked bundle matches staged host.
- Native SillyTavern 1.19.0 browser checks: **11 scenarios passed**, zero page errors.
  Covered all field categories, configured model and narrow prompt input, editable
  drafts, Save Changes plus server read-back, Cancel, edits during requests,
  duplicate/overlapping calls, invalid/network errors, clear/import, closing,
  rename without autosaving the guide, and a 430px mobile layout.
- Provider HTTP responses were controlled fixtures; no live provider was tested.
- Review separated guide drafts from the editor's existing immediate field
  rename/style saves. Renaming moves saved and draft guide keys independently.
- Git whitespace check passed. Existing CRLF line endings were retained.

Initial checkpoint: b0a9b46. Feature code, tests, release metadata, changelog and README
are ready together. Native browser script and final results are saved under
`/workspace/.rpg-tracker-onboarding/field-suggest-browser.cjs` and
`field-suggest-results.json`; the run cleaned its QA chat and restored settings.

On resume, inspect git status before editing. Publication uses
`git push origin HEAD:refs/heads/main` without force. Compare `git rev-parse HEAD`
with `git ls-remote origin refs/heads/main` before repeating a push.

Previous desktop visibility report was resolved by Empty Cache and Hard Reload;
no source change was needed. Do not reintroduce unrelated startup/cache work here.
