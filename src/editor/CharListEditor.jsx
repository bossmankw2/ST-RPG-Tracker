import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRPG } from '../core/RPGControl';
import styles from './CharListEditor.module.css';
import { getDefaultCharacters } from '../core/PromptSchema';
import { GearIcon } from '../Icons';
import SortableList from './SortableList';
import StatusEditor from './StatusEditor';
import {
  createPresetId, createPresetStorage, getPresetLocation, isPackagedPreset, validatePresetCharacters,
} from '../core/PresetStorage';

const copy = value => JSON.parse(JSON.stringify(value));

export default function CharListEditor({ onClose }) {
  const { trackerData, updateTrackerData, settings } = useRPG();
  const [localCharacters, setLocalCharacters] = useState(() =>
    trackerData.characters?.length ? copy(trackerData.characters) : getDefaultCharacters());
  const [showDropdown, setShowDropdown] = useState(false);
  const [packagedPresets, setPackagedPresets] = useState([]);
  const [library, setLibrary] = useState(() => copy(Array.isArray(settings.presets) ? settings.presets : []));
  const [currentPresetId, setCurrentPresetId] = useState(trackerData.currentPresetId || '');
  const [currentPresetName, setCurrentPresetName] = useState(trackerData.currentPresetName || 'New Preset');
  const [editingCharacterId, setEditingCharacterId] = useState(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState({ kind: 'info', text: 'Loading presets from your SillyTavern account…' });
  const [serverReady, setServerReady] = useState(false);
  const inputRef = useRef(null);
  const initializeRef = useRef(null);
  const mountedRef = useRef(true);
  const sourceRef = useRef('account');
  const browserStorage = useMemo(() => {
    try { return window.localStorage; } catch { return null; }
  }, []);
  const presetStorage = useMemo(() => createPresetStorage({
    bridge: () => window.RPGBridge, storage: browserStorage,
  }), [browserStorage]);
  const characters = localCharacters;

  const showRefreshResult = result => {
    setLibrary(result.presets);
    setServerReady(true);
    if (result.migrationError) {
      setNotice({ kind: 'error', text: `Could not move browser presets to the server: ${result.migrationError} Your browser copies are unchanged.` });
    } else if (result.issues.length) {
      const names = result.issues.map(issue => issue.name).join(', ');
      setNotice({
        kind: 'info',
        text: `${result.migratedCount ? `Moved ${result.migratedCount} preset(s) to the server. ` : ''}Presets needing their original browser or an exported backup: ${names}.`,
      });
    } else {
      setNotice({
        kind: 'success',
        text: result.migratedCount
          ? `Moved ${result.migratedCount} preset(s) to your SillyTavern account. Browser copies were kept as backups.`
          : 'Presets saved on this server are available on your other devices with the same account.',
      });
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    if (!initializeRef.current) initializeRef.current = presetStorage.refresh();
    initializeRef.current.then(result => {
      if (active) showRefreshResult(result);
    }).catch(error => {
      if (active) setNotice({ kind: 'error', text: error.message });
    }).finally(() => {
      if (active) setBusy(false);
    });
    const controller = new AbortController();
    const folderPath = window.RPGBridge?.extensionFolderPath || 'scripts/extensions/third-party/rpg-tracker-for-sillytavern';
    fetch(`/${folderPath}/presets.json`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : [])
      .then(data => {
        if (active && Array.isArray(data)) setPackagedPresets(data.filter(preset => preset?.id && preset?.name).map(preset => ({ ...preset, type: 'file' })));
      })
      .catch(error => {
        if (error.name !== 'AbortError') console.warn('[RPG Tracker] Packaged presets could not be loaded.');
      });
    return () => {
      active = false;
      mountedRef.current = false;
      controller.abort();
    };
  }, [presetStorage]);

  const runOperation = async action => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (mountedRef.current) setNotice({ kind: 'error', text: error.message || 'The operation failed. Your changes have not been confirmed saved.' });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const refreshPresets = () => runOperation(async () => showRefreshResult(await presetStorage.refresh()));

  const handleNameChange = (id, newName) => {
    // IDs identify locks, card bindings and draggable rows; renaming must not change them.
    setLocalCharacters(previous => previous.map(character => character.id === id ? { ...character, name: newName } : character));
  };

  const handleDelete = id => {
    if (characters.length <= 1) {
      setNotice({ kind: 'error', text: 'At least one character must remain in the list.' });
      return;
    }
    if (window.confirm('Remove this character from the draft? It will take effect when you apply to chat.')) {
      setLocalCharacters(previous => previous.filter(character => character.id !== id));
    }
  };

  const handleAddCharacter = () => {
    const newChar = copy(getDefaultCharacters()[0]);
    newChar.id = `char_${createPresetId()}`;
    const names = new Set(characters.map(character => character.name));
    let name = 'New Character';
    for (let count = 2; names.has(name); count++) name = `New Character ${count}`;
    newChar.name = name;
    newChar.activePlayer = false;
    newChar.activeInjection = true;
    setLocalCharacters(previous => previous.length === 1 && previous[0].id === 'char_user' && previous[0].name === 'New'
      ? [newChar] : [...previous, newChar]);
  };

  const handleSavePreset = () => runOperation(async () => {
    const name = currentPresetName.trim();
    if (!name) throw new Error('Enter a preset name before saving.');
    const duplicate = (sourceRef.current === 'account' && library.find(preset => preset.id === currentPresetId))
      || library.find(preset => preset.name?.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate && !window.confirm(`Overwrite preset "${duplicate.name}" on this SillyTavern account?`)) return;
    const result = await presetStorage.save({
      id: duplicate?.id, name, data: characters, expectedPreset: duplicate || null,
    });
    setLibrary(result.presets);
    setCurrentPresetId(result.preset.id);
    setCurrentPresetName(result.preset.name);
    sourceRef.current = 'account';
    setNotice({ kind: 'success', text: `Preset "${result.preset.name}" saved on this server. The active chat has not been changed.` });
  });

  const handleLoadPreset = preset => runOperation(async () => {
    if (!window.confirm(`Load "${preset.name}" into this editor? This replaces the draft. Apply to Chat when you are ready.`)) return;
    let loaded;
    if (preset.packaged || isPackagedPreset(preset)) {
      const folderPath = window.RPGBridge?.extensionFolderPath || 'scripts/extensions/third-party/rpg-tracker-for-sillytavern';
      const filename = preset.file || `${preset.id}.json`;
      if (!/^[^/\\]+\.json$/i.test(filename) || filename.includes('..')) throw new Error('This packaged preset has an invalid filename.');
      const response = await fetch(`/${folderPath}/presets/${encodeURIComponent(filename)}`);
      if (!response.ok) throw new Error(`Could not load packaged preset "${preset.name}".`);
      loaded = { preset, data: validatePresetCharacters(await response.json()) };
      sourceRef.current = 'packaged';
    } else {
      loaded = await presetStorage.load(preset.id);
      setLibrary(loaded.presets);
      sourceRef.current = 'account';
    }
    setCurrentPresetId(loaded.preset.id);
    setCurrentPresetName(loaded.preset.name);
    setLocalCharacters(loaded.data);
    setShowDropdown(false);
    setNotice({ kind: 'info', text: `Loaded "${loaded.preset.name}" into the draft. Apply to Chat to use it.` });
  });

  const handleDeletePreset = preset => runOperation(async () => {
    if (!window.confirm(`Delete preset "${preset.name}" from this SillyTavern account? Your current draft and chat are kept.`)) return;
    setLibrary(await presetStorage.remove(preset.id, library.find(item => item.id === preset.id)));
    if (currentPresetId === preset.id) {
      setCurrentPresetId('');
      sourceRef.current = 'account';
    }
    setNotice({ kind: 'success', text: `Preset "${preset.name}" deleted from the server.` });
  });

  const handleResetToDefault = () => {
    if (window.confirm('Reset the draft character list? Apply to Chat to replace the current characters, including their locks.')) {
      setLocalCharacters(getDefaultCharacters());
      setCurrentPresetId('');
      setCurrentPresetName('New Preset');
      sourceRef.current = 'account';
      setNotice({ kind: 'info', text: 'Draft reset. The current chat is unchanged until you apply.' });
    }
  };

  const handleImportLocalFile = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    runOperation(async () => {
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
      const characters = validatePresetCharacters(data);
      const name = file.name.replace(/\.[^/.]+$/, '').trim() || 'Imported Preset';
      const duplicate = library.find(preset => preset.name?.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      if (duplicate && !window.confirm(`Importing this file will overwrite preset "${duplicate.name}" on the server. Continue?`)) return;
      const result = await presetStorage.save({
        id: duplicate?.id, name, data: characters, expectedPreset: duplicate || null,
      });
      setLibrary(result.presets);
      setLocalCharacters(characters);
      setCurrentPresetId(result.preset.id);
      setCurrentPresetName(result.preset.name);
      sourceRef.current = 'account';
      setNotice({ kind: 'success', text: `Imported "${result.preset.name}" and saved it on the server. Apply to Chat to use it here.` });
    });
  };

  const handleExportLocalFile = () => {
    const blob = new Blob([JSON.stringify(localCharacters, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${currentPresetName.trim().replace(/[/\\?%*:|"<>. ]/g, '_') || 'rpg_preset'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleApply = () => {
    try {
      validatePresetCharacters(characters);
      updateTrackerData({ ...trackerData, currentPresetId, currentPresetName, characters: copy(characters) });
      onClose();
    } catch (error) {
      setNotice({ kind: 'error', text: error.message });
    }
  };

  const totalPresets = [
    ...packagedPresets.map(preset => ({ ...preset, packaged: true })),
    ...library.filter(preset => preset?.id && preset?.name).map(preset => ({ ...preset, packaged: false })),
  ];

  if (editingCharacterId) {
    return <StatusEditor charId={editingCharacterId} characters={localCharacters} onUpdateCharacters={setLocalCharacters} onClose={() => setEditingCharacterId(null)} />;
  }

  return (
    <div className="rpg-modal-overlay">
      <div className="rpg-modal-container rpg-editor-modal" role="dialog" aria-modal="true" aria-label="Character List" onClick={event => event.stopPropagation()} aria-busy={busy}>
        <header className="rpg-modal-header">
          <h4>Character List</h4>
          <button type="button" className="rpg-modal-close-btn" aria-label="Cancel character list changes" disabled={busy} onClick={onClose}>×</button>
        </header>

        <div className={styles.presetBar}>
          <label className={styles.presetInputContainer}>
            <span className={styles.fieldLabel}>Preset name</span>
            <input type="text" className={styles.presetNameInput} value={currentPresetName} disabled={busy} onChange={event => setCurrentPresetName(event.target.value)} placeholder="Name this preset" />
          </label>
          <button type="button" className="rpg-modal-btn" disabled={busy || !serverReady} onClick={handleSavePreset}>Save Preset</button>
          <button type="button" className="rpg-modal-btn" disabled={busy} aria-expanded={showDropdown} onClick={() => setShowDropdown(previous => !previous)}>Load Preset</button>
        </div>

        <div className={`${styles.notice} ${notice.kind === 'error' ? styles.noticeError : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span>{busy ? 'Working… ' : ''}{notice.text}</span>
          <button type="button" disabled={busy} className={styles.refreshButton} onClick={refreshPresets}>Refresh presets</button>
        </div>

        {showDropdown && (
          <div className={styles.presetDropdown} aria-label="Saved presets">
            {totalPresets.length === 0 ? <div className={styles.presetDropdownEmpty}>No presets saved yet.</div> : totalPresets.map(preset => (
              <div key={`${preset.packaged ? 'packaged' : 'account'}:${preset.id}`} className={styles.presetDropdownItem}>
                <button type="button" className={styles.presetDropdownItemLoadArea} disabled={busy} onClick={() => handleLoadPreset(preset)}>
                  <span className={styles.presetItemName}>{preset.name}</span>
                  <span className={styles.charIdBadge}>{getPresetLocation(preset, browserStorage)}</span>
                </button>
                {!preset.packaged && !isPackagedPreset(preset) && (
                  <button type="button" className="rpg-btn-del-text" disabled={busy} title={`Delete preset ${preset.name}`} aria-label={`Delete preset ${preset.name}`} onClick={() => handleDeletePreset(preset)}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rpg-modal-body">
          <p className={styles.listHint}>Drag a handle to reorder. Changes apply to this chat when you choose Apply to Chat.</p>
          <SortableList items={characters} getId={character => character.id} getLabel={character => character.name} onReorder={setLocalCharacters} label="Characters" disabled={busy}>
            {(character, { itemProps, dragHandle }) => (
              <div {...itemProps} className={styles.charItem}>
                {dragHandle}
                <input type="text" className={styles.nameInput} value={character.name} disabled={busy} aria-label={`Character name: ${character.name}`} onChange={event => handleNameChange(character.id, event.target.value)} />
                <div className={styles.actions}>
                  <button type="button" className="rpg-btn-icon" disabled={busy} title="Edit Character" aria-label={`Edit ${character.name}`} onClick={() => setEditingCharacterId(character.id)}><GearIcon /></button>
                  <button type="button" className="rpg-btn-del" disabled={busy} title="Delete Character" aria-label={`Delete ${character.name}`} onClick={() => handleDelete(character.id)}>×</button>
                </div>
              </div>
            )}
          </SortableList>
          <button type="button" className="rpg-btn-dashed" disabled={busy} onClick={handleAddCharacter}>+ Add Character</button>
        </div>

        <footer className="rpg-modal-footer">
          <div className="rpg-modal-footer-left">
            <button type="button" className="rpg-modal-btn reset" disabled={busy} onClick={handleResetToDefault}>Reset</button>
          </div>
          <input ref={inputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportLocalFile} />
          <div className="rpg-modal-footer-right">
            <button type="button" className="rpg-modal-btn" disabled={busy} onClick={handleExportLocalFile}>Export</button>
            <button type="button" className="rpg-modal-btn" disabled={busy || !serverReady} onClick={() => inputRef.current?.click()}>Import</button>
            <button type="button" className="rpg-modal-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="button" className="rpg-modal-btn save" disabled={busy} onClick={handleApply}>Apply to Chat</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
