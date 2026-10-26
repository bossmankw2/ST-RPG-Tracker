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

## Progress / resume

Implementation is in progress. Inspect git status and agent changes before editing.
No release commit/push yet. Do not assume tests passed from checkboxes or partial logs.
Build with npm run build, test with npm test, copy bundle to the staged local host
before browser checks. Host data/tools: /workspace/.rpg-tracker-onboarding (port8000).
Preserve CRLF in existing files; use git -c core.whitespace=cr-at-eol diff --check.

Previous desktop visibility report was resolved by Empty Cache and Hard Reload;
no source change was needed. Do not reintroduce unrelated startup/cache work here.
