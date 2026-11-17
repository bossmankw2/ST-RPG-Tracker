import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createDefinitionPresetStorage, previewDefinitionPreset } from '../core/FieldDefinitionPresets';
import styles from './DefinitionPresetControls.module.css';

export default function DefinitionPresetControls({
  availableKeys, captureDraft, isDraftCurrent, onApply, suggestionBusy,
}) {
  const storage = useMemo(() => createDefinitionPresetStorage({ bridge: () => window.RPGBridge }), []);
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('refresh');
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('Loading field definition presets…');
  const mountedRef = useRef(true);
  const pendingRef = useRef(null);
  const initialReadRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    const request = {};
    pendingRef.current = request;
    let active = true;
    if (!initialReadRef.current) initialReadRef.current = storage.refresh();
    initialReadRef.current.then(result => {
      if (!active) return;
      setPresets(result.presets);
      setReady(true);
      setNotice(result.presets.length ? 'Choose a preset to load or update.' : 'No server presets yet. Name this draft and save it below.');
    }).catch(error => {
      if (active) setNotice(error?.message || 'Could not read server presets. Try Refresh.');
    }).finally(() => {
      if (active && pendingRef.current === request) {
        pendingRef.current = null;
        setBusy(null);
      }
    });
    return () => {
      active = false;
      mountedRef.current = false;
      pendingRef.current = null;
    };
  }, [storage]);

  const run = async (operation, action) => {
    if (pendingRef.current) return;
    const request = {};
    pendingRef.current = request;
    setBusy(operation);
    setNotice('');
    const active = () => mountedRef.current && pendingRef.current === request;
    try {
      await action(active);
    } catch (error) {
      if (active()) setNotice(error?.message || 'The server operation failed. Your draft was kept.');
    } finally {
      if (active()) {
        pendingRef.current = null;
        setBusy(null);
      }
    }
  };

  const refresh = () => run('refresh', async active => {
    const result = await storage.refresh();
    if (!active()) return;
    setPresets(result.presets);
    setReady(true);
    const selected = result.presets.find(preset => preset.id === selectedId);
    if (selected) setName(selected.name);
    else if (selectedId) {
      setSelectedId('');
      setName('');
    }
    setNotice('Server preset list refreshed. Your guideline draft was kept.');
  });

  const save = () => run('save', async active => {
    const presetName = name.trim();
    if (!presetName) throw new Error('Enter a preset name before saving.');
    const selected = presets.find(preset => preset.id === selectedId);
    if (selected && !window.confirm(`Replace server preset "${selected.name}" with the current guidelines, saved as "${presetName}"? This affects the preset available on your other devices.`)) {
      setNotice('Server preset kept.');
      return;
    }
    const draft = captureDraft();
    const result = await storage.save({
      id: selected?.id,
      name: presetName,
      definitions: draft.definitions,
      expectedPreset: selected || null,
    });
    if (!active()) return;
    setPresets(result.presets);
    setSelectedId(result.preset.id);
    setName(result.preset.name);
    setNotice(`Saved "${result.preset.name}" to this server account. ${isDraftCurrent(draft) ? 'Save Changes to also apply this draft to the chat.' : 'Your newer draft edits were kept; save again to include them in the preset.'}`);
  });

  const load = () => run('load', async active => {
    const draft = captureDraft();
    const result = await storage.load(selectedId);
    if (!active()) return;
    setPresets(result.presets);
    setName(result.preset.name);
    if (!isDraftCurrent(draft)) {
      setNotice('Load cancelled because the draft or chat changed. Your edits were kept; try loading again.');
      return;
    }
    const preview = previewDefinitionPreset(result.definitions, draft.definitions, availableKeys);
    if (!preview.matchedCount) {
      setNotice(`No matching fields in this chat. ${preview.skippedCount} guideline(s) remain in the server preset; no fields were added.`);
      return;
    }
    if (!preview.changedCount) {
      setNotice(`Matching guidelines are already in this draft. ${preview.skippedCount} unmatched guideline(s) skipped.`);
      return;
    }
    const question = `Load "${result.preset.name}" into this draft?\n\n${preview.matchedCount} matching guideline(s); ${preview.changedCount} change(s), including ${preview.overwriteCount} existing guideline(s) replaced.\n${preview.skippedCount} unmatched guideline(s) skipped. Other guides are kept.\n\nSave Changes applies the draft to this chat. Cancel in the editor discards the draft.`;
    if (!window.confirm(question)) {
      setNotice('Load cancelled. Your guideline draft was kept.');
      return;
    }
    if (!active() || !isDraftCurrent(draft)) {
      if (active()) setNotice('Load cancelled because the draft or chat changed. Your edits were kept.');
      return;
    }
    onApply(preview.definitions);
    setNotice(`Loaded "${result.preset.name}" into this editable draft. ${preview.skippedCount} unmatched guideline(s) skipped. Save Changes to apply to this chat.`);
  });

  const remove = () => run('delete', async active => {
    const selected = presets.find(preset => preset.id === selectedId);
    if (!selected) return;
    if (!window.confirm(`Delete server preset "${selected.name}" from this account? Your current guidelines and chat will be kept.`)) {
      setNotice('Server preset kept.');
      return;
    }
    const next = await storage.remove(selected.id, selected);
    if (!active()) return;
    setPresets(next);
    setSelectedId('');
    setName('');
    setNotice(`Deleted "${selected.name}" from the server. Your guideline draft was kept.`);
  });

  const selectPreset = event => {
    const id = event.target.value;
    setSelectedId(id);
    setName(presets.find(preset => preset.id === id)?.name || '');
    setNotice(id ? 'Load from Server reads this preset into the draft. Save to Server replaces the selected preset.' : 'Enter a name to save a new server preset.');
  };

  return (
    <section className={styles.panel} aria-label="Field definition server presets" aria-busy={Boolean(busy)}>
      <strong className={styles.title}>Server presets</strong>
      <p className={styles.hint}>Reuse guidelines across chats and devices on this SillyTavern account. Character values and field styles are not included.</p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Preset</span>
          <select aria-label="Field definition preset" value={selectedId} onChange={selectPreset} disabled={Boolean(busy) || !ready}>
            <option value="">New preset</option>
            {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Preset name</span>
          <input aria-label="Field definition preset name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Fantasy RPG" disabled={Boolean(busy)} />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="button" className="rpg-btn-sm" onClick={save} disabled={Boolean(busy) || !ready || suggestionBusy}>{busy === 'save' ? 'Saving…' : 'Save to Server'}</button>
        <button type="button" className="rpg-btn-sm" onClick={load} disabled={Boolean(busy) || !ready || !selectedId || suggestionBusy}>{busy === 'load' ? 'Loading…' : 'Load from Server'}</button>
        <button type="button" className="rpg-btn-sm" onClick={refresh} disabled={Boolean(busy)} aria-label="Refresh field definition presets">{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</button>
        <button type="button" className={`rpg-btn-sm ${styles.deleteButton}`} onClick={remove} disabled={Boolean(busy) || !ready || !selectedId} aria-label="Delete field definition preset">{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
      </div>
      <div className={styles.notice} role="status" aria-live="polite" aria-atomic="true">{notice}</div>
    </section>
  );
}
