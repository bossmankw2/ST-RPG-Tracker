# World Event order and bulk field guidelines

Base 278d33a (1.4.0). Target 1.5.0. Approved on 2026-11-24 for commit and push to main.

- World Events supports manual drag, touch and keyboard. Both manual reordering
  and Sort by Time change the stored worldState.events sequence. Equal starts keep
  their relative order. Leave entries with incomparable timestamps in their slots.
- Suggest All fills empty Status, Profile and Relationship guidelines by default.
  Replacing all guides requires confirmation. Results are editable drafts for
  Save Changes or Save to Server. Guard concurrent edits, failed or stale requests.
- event_time_sort_core owns the time sort and tests. events_sort_ui owns the panel
  and shared sortable interactions. bulk_suggest_service and bulk_suggest_editor
  own AI service/tests and Prompt Editor. interaction_validation owns native QA.
- Resume by inspecting git status. Run npm test and npm run build, stage the new
  bundle in the local QA host, verify the controls and persistence there, update
  this checkpoint and the changelog. Push without force and compare remote main
  with the local release commit. Release validation and publication are pending.
