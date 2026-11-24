import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRPG } from '../core/RPGControl';
import styles from './PromptEditor.module.css';
import statusStyles from './StatusEditor.module.css';
import {
  DEFAULT_PROMPT_HEADER_MERGED,
  DEFAULT_PROMPT_FOOTER_MERGED,
  DEFAULT_PROMPT_HEADER_SEP,
  DEFAULT_PROMPT_FOOTER_SEP,
  DEFAULT_READONLY_CONTEXT_HEADER,
  getDefaultCharacters,
  DEFAULT_GUIDE_PROMPTS,
  DEFAULT_ADD_CHAR_PROMPT,
  DEFAULT_ADD_PLAYER_CHAR_PROMPT,
  DEFAULT_CYOA_PROMPT,
  DEFAULT_WEATHER_PROMPT,
  DEFAULT_WORLD_EVENTS_PROMPT
} from '../core/PromptSchema';
import { getDynamicSchemaExample } from '../core/ActivePrompt';
import { ToggleSwitch, AccordionArrow, AutoGrowingTextArea } from '../utils';
import { StatusSpecConfig } from './StatusSpecsTab';
import { RelationMetricConfig } from './RelationsTab';
import DefinitionPresetControls from './DefinitionPresetControls';

import { getCurrentTurnKey } from '../core/JSONTracker_Timeline.js';

export default function PromptEditor({ onClose }) {
  const { trackerData, updateTrackerData } = useRPG();
  const [activeTab, setActiveTab] = useState('system');

  const [localMergedHeader, setLocalMergedHeader] = useState('');
  const [localMergedFooter, setLocalMergedFooter] = useState('');
  const [localReadOnlyPrompt, setLocalReadOnlyPrompt] = useState('');
  const [localSepHeader, setLocalSepHeader] = useState('');
  const [localSepFooter, setLocalSepFooter] = useState('');

  const [localAddCharPrompt, setLocalAddCharPrompt] = useState('');
  const [localAddPlayerCharPrompt, setLocalAddPlayerCharPrompt] = useState('');
  const [localCyoaPrompt, setLocalCyoaPrompt] = useState('');
  const [localWeatherPrompt, setLocalWeatherPrompt] = useState('');
  const [localWorldEventsPrompt, setLocalWorldEventsPrompt] = useState('');

  const [isEditMerged, setIsEditMerged] = useState(false);
  const [isEditReadOnly, setIsEditReadOnly] = useState(false);
  const [isEditSep, setIsEditSep] = useState(false);

  const [isEditAddChar, setIsEditAddChar] = useState(false);
  const [isEditAddPlayerChar, setIsEditAddPlayerChar] = useState(false);
  const [isEditCyoa, setIsEditCyoa] = useState(false);
  const [isEditWeather, setIsEditWeather] = useState(false);
  const [isEditWorldEvents, setIsEditWorldEvents] = useState(false);

  const [isMergedOpen, setIsMergedOpen] = useState(false);
  const [isReadOnlyOpen, setIsReadOnlyOpen] = useState(false);
  const [isSepOpen, setIsSepOpen] = useState(false);

  const [isSchemaOpen, setIsSchemaOpen] = useState(true);
  const [isAddCharOpen, setIsAddCharOpen] = useState(false);
  const [isAddPlayerCharOpen, setIsAddPlayerCharOpen] = useState(false);
  const [isCyoaOpen, setIsCyoaOpen] = useState(false);
  const [isWeatherOpen, setIsWeatherOpen] = useState(false);
  const [isWorldEventsOpen, setIsWorldEventsOpen] = useState(false);

  const [localGuidePrompts, setLocalGuidePrompts] = useState([]);
  const [localDefObj, setLocalDefObj] = useState({});
  const [localWorldSchema, setLocalWorldSchema] = useState({});

  const [suggestionScope, setSuggestionScope] = useState('empty');
  const [suggestingKey, setSuggestingKey] = useState(null);
  const [suggestionFeedback, setSuggestionFeedback] = useState('');
  const definitionsRef = useRef(localDefObj);
  const definitionEditsRef = useRef({});
  const definitionEpochRef = useRef(0);
  const suggestionRef = useRef(null);
  const mountedRef = useRef(true);
  const definitionSourceRef = useRef(null);
  const previousDefinitionSourceRef = useRef(null);
  const ownDefinitionUpdateRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      definitionEpochRef.current += 1;
    };
  }, []);

  const replaceDefinitions = (definitions) => {
    definitionEpochRef.current += 1;
    definitionsRef.current = definitions;
    setLocalDefObj(definitions);
    setSuggestionFeedback('');
  };

  const captureDefinitionDraft = () => ({
    definitions: definitionsRef.current,
    epoch: definitionEpochRef.current,
    source: definitionSourceRef.current,
    turn: getCurrentTurnKey(window.RPGBridge),
  });

  const isDefinitionSourceCurrent = draft => mountedRef.current
    && definitionEpochRef.current === draft.epoch
    && definitionSourceRef.current === draft.source
    && getCurrentTurnKey(window.RPGBridge) === draft.turn;

  const isDefinitionDraftCurrent = draft => isDefinitionSourceCurrent(draft)
    && definitionsRef.current === draft.definitions;

  const handleDefinitionChange = (fullKey, value) => {
    definitionEditsRef.current[fullKey] = (definitionEditsRef.current[fullKey] || 0) + 1;
    const next = { ...definitionsRef.current, [fullKey]: value };
    definitionsRef.current = next;
    setLocalDefObj(next);
  };

  // Field names/styles keep their existing immediate save behavior. Guide text
  // stays in the editor draft until Save Changes, even through those own updates.
  const persistFieldStructure = (updatedCharacters, savedDefinitions = trackerData.globalDefinitions) => {
    definitionEpochRef.current += 1;
    ownDefinitionUpdateRef.current = {
      characters: updatedCharacters,
      definitions: savedDefinitions,
      turn: getCurrentTurnKey(window.RPGBridge),
    };
    updateTrackerData({
      ...trackerData,
      characters: updatedCharacters,
      globalDefinitions: savedDefinitions,
    });
  };

  const closeEditor = () => {
    definitionEpochRef.current += 1;
    onClose();
  };

  const suggestionField = (category, item) => ({
    category, id: item.id, name: item.name || item.id,
    type: category === 'profile' ? 'text' : category === 'relation' ? (localWorldSchema.relationsFieldType || 'integer') : item.type,
    min: item.min, max: item.max,
    definition: String(definitionsRef.current[`${category}_${item.id}`] ?? ''),
  });

  const suggestGuidelines = async (fields, bulk = false) => {
    if (suggestionRef.current || !fields.length) return;
    const suggest = bulk ? window.RPGBridge?.suggestFieldDefinitions : window.RPGBridge?.suggestFieldDefinition;
    if (typeof suggest !== 'function') {
      setSuggestionFeedback('The AI suggestion service is not ready. Refresh the page and try again.');
      return;
    }
    if (bulk && suggestionScope === 'all') {
      const existingCount = fields.filter(field => field.definition.trim()).length;
      if (existingCount && !window.confirm(`Generate guides for all ${fields.length} fields and replace ${existingCount} existing guidelines in this draft?`)) return;
    }
    const field = fields[0];
    const key = bulk ? 'all' : `${field.category}_${field.id}`;
    const draft = captureDefinitionDraft();
    const priorEdit = definitionEditsRef.current[key] || 0;
    const isCurrent = () => {
      if (!mountedRef.current || suggestionRef.current !== draft) return false;
      if (bulk) return isDefinitionDraftCurrent(draft);
      return isDefinitionSourceCurrent(draft) && (definitionEditsRef.current[key] || 0) === priorEdit;
    };
    suggestionRef.current = draft;
    setSuggestingKey(key);
    setSuggestionFeedback(bulk ? `Suggesting guides for ${fields.length} fields…` : `Suggesting a short guide for ${field.name}…`);
    try {
      const result = bulk ? await suggest(fields, { isCurrent }) : await suggest(field);
      if (!isCurrent()) throw new Error('Draft changed');
      if (bulk) {
        // The service returns the complete validated set only after every batch succeeds.
        replaceDefinitions({ ...draft.definitions, ...result });
        setSuggestionFeedback(`Suggested ${fields.length} field guides. Edit them as needed, then Save Changes.`);
      } else {
        handleDefinitionChange(key, result);
        setSuggestionFeedback(`Suggested guide for ${field.name}. Edit it as needed, then Save Changes.`);
      }
    } catch (error) {
      if (mountedRef.current) setSuggestionFeedback(isCurrent()
        ? (error?.message || 'Could not suggest guidelines. Your draft was kept. Please try again.')
        : 'Suggestion discarded because the field or draft changed. Your edits were kept.');
    } finally {
      if (suggestionRef.current === draft) {
        suggestionRef.current = null;
        if (mountedRef.current) setSuggestingKey(null);
      }
    }
  };

  const renderDefinitionGuide = (category, item) => {
    const fullKey = `${category}_${item.id}`;
    const working = suggestingKey === fullKey;
    return (
      <div className={styles.definitionGuideRow} data-field-key={fullKey}>
        <AutoGrowingTextArea
          className={styles.defInput}
          value={localDefObj[fullKey] || ''}
          onChange={(value) => handleDefinitionChange(fullKey, value)}
          placeholder={`AI Guide for ${item.name || item.id}...`}
        />
        <button
          type="button"
          className={`rpg-btn-sm ${styles.suggestButton}`}
          aria-label={`Suggest guide for ${item.name || item.id}`}
          aria-busy={working}
          disabled={Boolean(suggestingKey)}
          title="Suggest a clear guide in 1–2 sentences using one AI request. You can edit the result before saving."
          onClick={() => suggestGuidelines([suggestionField(category, item)])}
        >
          {working ? 'Suggesting…' : 'Suggest'}
        </button>
      </div>
    );
  };

  const [expandedDefIds, setExpandedDefIds] = useState({});
  const [globalSyncToggles, setGlobalSyncToggles] = useState({});

  const characters = (trackerData.characters && trackerData.characters.length > 0)
    ? trackerData.characters
    : getDefaultCharacters();

  const getUniqueFields = () => {
    const statusMap = new Map();
    const profileMap = new Map();
    const relationMap = new Map();

    characters.forEach(char => {
      (char.statusSchema || []).forEach(s => {
        const idKey = s.id || s.name;
        if (idKey && !statusMap.has(idKey)) {
          statusMap.set(idKey, {
            id: s.id || idKey,
            name: s.name || idKey,
            type: s.type || 'consumable',
            color: s.color || (s.type === 'stacking' ? '#3498db' : '#e74c3c'),
            min: s.min !== undefined ? s.min : 0,
            max: s.max !== undefined ? s.max : 100
          });
        }
      });

      if (char.profile) {
        Object.keys(char.profile).forEach(k => {
          if (!profileMap.has(k)) {
            profileMap.set(k, { id: k, name: k });
          }
        });
      }
    });

    // Keep the same metadata for existing guides when a reverse metric shares its name.
    for (const side of ['values', 'targetValues']) {
      for (const char of characters) {
        for (const relation of Object.values(char.relations || {})) {
          for (const [name, metric] of Object.entries(relation?.[side] || {})) {
            if (relationMap.has(name)) continue;
            relationMap.set(name, {
              id: name, name,
              min: metric?.min ?? -100, max: metric?.max ?? 100,
              colorPositive: metric?.colorPositive || '#2ecc71',
              colorNegative: metric?.colorNegative || '#e74c3c'
            });
          }
        }
      }
    }

    const TYPE_PRIORITY = {
      consumable: 0,
      stacking: 1,
      integer: 2,
      text: 3
    };

    const sortStatus = (a, b) => {
      const pA = TYPE_PRIORITY[a.type] !== undefined ? TYPE_PRIORITY[a.type] : 99;
      const pB = TYPE_PRIORITY[b.type] !== undefined ? TYPE_PRIORITY[b.type] : 99;
      if (pA !== pB) {
        return pA - pB;
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    };

    const sortById = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });

    return {
      status: Array.from(statusMap.values()).sort(sortStatus),
      profiles: Array.from(profileMap.values()).sort(sortById),
      relations: Array.from(relationMap.values()).sort(sortById)
    };
  };

  const uniqueFields = useMemo(getUniqueFields, [characters]);
  // Settings refreshes can rehydrate a fresh tracker object for the same turn.
  // Only a change to the actual saved guides, field schema, or turn resets the draft.
  const definitionSource = useMemo(() => {
    const saved = trackerData.globalDefinitions || {};
    return JSON.stringify([uniqueFields, trackerData.worldSchema?.relationsFieldType || 'integer',
      Object.keys(saved).sort().map(key => [key, saved[key]])]);
  }, [uniqueFields, trackerData.globalDefinitions, trackerData.worldSchema?.relationsFieldType]);
  definitionSourceRef.current = definitionSource;
  const definitionTurn = getCurrentTurnKey(window.RPGBridge);
  const suggestionFields = [
    ...uniqueFields.status.map(item => suggestionField('status', item)),
    ...uniqueFields.profiles.map(item => suggestionField('profile', item)),
    ...uniqueFields.relations.map(item => suggestionField('relation', item)),
  ];
  const emptyFields = suggestionFields.filter(field => !field.definition.trim());
  const bulkFields = suggestionScope === 'all' ? suggestionFields : emptyFields;

  useEffect(() => {
    setLocalMergedHeader(trackerData.systemPromptHeader_merged ?? DEFAULT_PROMPT_HEADER_MERGED);
    setLocalMergedFooter(trackerData.systemPromptFooter_merged ?? DEFAULT_PROMPT_FOOTER_MERGED);
    setLocalReadOnlyPrompt(trackerData.systemPrompt_readonly ?? DEFAULT_READONLY_CONTEXT_HEADER);
    setLocalSepHeader(trackerData.systemPromptHeader_separated ?? DEFAULT_PROMPT_HEADER_SEP);
    setLocalSepFooter(trackerData.systemPromptFooter_separated ?? DEFAULT_PROMPT_FOOTER_SEP);

    setLocalAddCharPrompt(trackerData.addCharPrompt ?? DEFAULT_ADD_CHAR_PROMPT);
    setLocalAddPlayerCharPrompt(trackerData.addPlayerCharPrompt ?? DEFAULT_ADD_PLAYER_CHAR_PROMPT);
    setLocalCyoaPrompt(trackerData.cyoaPrompt ?? DEFAULT_CYOA_PROMPT);
    setLocalWeatherPrompt(trackerData.weatherPrompt ?? DEFAULT_WEATHER_PROMPT);
    setLocalWorldEventsPrompt(trackerData.worldEventsPrompt ?? DEFAULT_WORLD_EVENTS_PROMPT);

    let savedGuides = trackerData.guidePrompts ? [...trackerData.guidePrompts] : JSON.parse(JSON.stringify(DEFAULT_GUIDE_PROMPTS));

    DEFAULT_GUIDE_PROMPTS.forEach(defaultGuide => {
      if (!savedGuides.find(g => g.id === defaultGuide.id)) {
        savedGuides.push(defaultGuide);
      }
    });

    setLocalGuidePrompts(savedGuides);
    const ownUpdate = ownDefinitionUpdateRef.current;
    const previous = previousDefinitionSourceRef.current;
    const sameSource = previous?.source === definitionSource && previous.turn === definitionTurn;
    const ownFieldEdit = ownUpdate?.turn === definitionTurn
      && ownUpdate.characters === trackerData.characters
      && ownUpdate.definitions === trackerData.globalDefinitions;
    previousDefinitionSourceRef.current = { source: definitionSource, turn: definitionTurn };
    ownDefinitionUpdateRef.current = null;
    if (!sameSource && !ownFieldEdit) replaceDefinitions(trackerData.globalDefinitions || {});
    setLocalWorldSchema(trackerData.worldSchema || {
      dateSelect: '1', dateCustom: 'yyyy-mm-dd',
      timeSelect: '1', timeCustom: '14:30',
      weatherSelect: '1', weatherCustom: 'Clear/Cloudy/Rain/Snow',
      locationSelect: '1', locationCustom: 'Current Location',
      relationsFieldType: 'integer'
    });
  }, [trackerData, definitionSource, definitionTurn]);

  const DATE_OPTS = [
    { v: '1', l: 'Year/Month/Day', ex: 'yyyy-mm-dd' },
    { v: '2', l: 'Year/Month/Day (Weekday)', ex: 'yyyy-mm-dd (Day)' },
    { v: '3', l: 'Weekday only', ex: 'Monday' },
    { v: '4', l: 'Day 1, Day 2...', ex: 'Day 1' },
    { v: 'custom', l: 'Custom', ex: '' }
  ];
  const TIME_OPTS = [
    { v: '1', l: '24:00 Format', ex: '14:30' },
    { v: '2', l: '12-hour AM/PM', ex: '02:30 PM' },
    { v: '3', l: 'Dawn/Morning...', ex: 'Dawn/Morning/Noon/Evening/Night' },
    { v: 'custom', l: 'Custom', ex: '' }
  ];
  const WEATHER_OPTS = [
    { v: '1', l: 'Text', ex: 'Clear/Cloudy/Rain/Snow' },
    { v: '2', l: 'Emoji only', ex: '☀️/⛅/🌧️/❄️' },
    { v: '3', l: 'Emoji + Text', ex: '☀️ Clear / ⛅ Cloudy / 🌧️ Rain / ❄️ Snow' },
    { v: 'custom', l: 'Custom', ex: '' }
  ];

  const handleWorldSchemaChange = (key, value, typeOpts) => {
    if (key === 'relationsFieldType') definitionEpochRef.current += 1;
    let updates = { [key]: value };
    if (typeOpts) {
      const opt = typeOpts.find(o => o.v === value);
      if (opt && value !== 'custom') {
        updates[key.replace('Select', 'Custom')] = opt.ex;
      }
    }
    setLocalWorldSchema(prev => ({ ...prev, ...updates }));
  };

  const handleToggleGlobalSync = (fieldKey, checked) => {
    setGlobalSyncToggles(prev => ({ ...prev, [fieldKey]: checked }));
  };

  const handleRenameFieldUnified = (category, oldId, newNameRaw) => {
    const trimmed = newNameRaw.trim();
    if (!trimmed || trimmed === oldId) return;

    const cleanNewId = trimmed.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!cleanNewId) return;

    const updatedCharacters = characters.map(char => {
      const cloned = JSON.parse(JSON.stringify(char));

      if (category === 'status') {
        if (Array.isArray(cloned.statusSchema)) {
          cloned.statusSchema = cloned.statusSchema.map(s =>
            (s.id === oldId || s.name === oldId) ? { ...s, id: cleanNewId, name: trimmed } : s
          );
        }
        if (cloned.status && cloned.status[oldId] !== undefined) {
          cloned.status[cleanNewId] = cloned.status[oldId];
          delete cloned.status[oldId];
        }
      } else if (category === 'profile') {
        if (cloned.profile && cloned.profile[oldId] !== undefined) {
          const nextProf = {}; const nextLocks = {}; const nextInjects = {};
          Object.keys(cloned.profile).forEach(k => {
            const targetKey = (k === oldId) ? cleanNewId : k;
            nextProf[targetKey] = cloned.profile[k];
            if (cloned.profileLocks) nextLocks[targetKey] = cloned.profileLocks[k];
            if (cloned.profileInjects) nextInjects[targetKey] = cloned.profileInjects[k];
          });
          cloned.profile = nextProf; cloned.profileLocks = nextLocks; cloned.profileInjects = nextInjects;
        }
      } else if (category === 'relation') {
        if (cloned.relations) {
          Object.values(cloned.relations).forEach(rData => {
            if (rData.values && rData.values[oldId] !== undefined) {
              rData.values[cleanNewId] = rData.values[oldId];
              delete rData.values[oldId];
            }
            if (rData.targetValues && rData.targetValues[oldId] !== undefined) {
              rData.targetValues[cleanNewId] = rData.targetValues[oldId];
              delete rData.targetValues[oldId];
            }
          });
        }
      }

      return cloned;
    });

    const oldGuideKey = `${category}_${oldId}`;
    const newGuideKey = `${category}_${cleanNewId}`;
    const renameDefinitionKey = (definitions) => {
      const next = { ...definitions };
      if (oldGuideKey !== newGuideKey && next[oldGuideKey] !== undefined) {
        next[newGuideKey] = next[oldGuideKey];
        delete next[oldGuideKey];
      }
      return next;
    };
    const nextDraft = renameDefinitionKey(definitionsRef.current);
    const nextSaved = renameDefinitionKey(trackerData.globalDefinitions);

    replaceDefinitions(nextDraft);
    persistFieldStructure(updatedCharacters, nextSaved);

    setExpandedDefIds(prev => {
      const next = { ...prev };
      if (next[oldGuideKey] !== undefined) {
        next[newGuideKey] = next[oldGuideKey];
        delete next[oldGuideKey];
      }
      return next;
    });

    setGlobalSyncToggles(prev => {
      const next = { ...prev };
      if (next[oldGuideKey] !== undefined) {
        next[newGuideKey] = next[oldGuideKey];
        delete next[oldGuideKey];
      }
      return next;
    });
  };

  const handleUpdateStatusProperty = (fieldId, propKey, value) => {
    const isGlobalSyncOn = globalSyncToggles[`status_${fieldId}`] === true;
    if (!isGlobalSyncOn) return;

    const updatedCharacters = characters.map(char => {
      const cloned = JSON.parse(JSON.stringify(char));
      if (Array.isArray(cloned.statusSchema)) {
        cloned.statusSchema = cloned.statusSchema.map(s => {
          if (s.id === fieldId || s.name === fieldId) {
            return { ...s, [propKey]: value };
          }
          return s;
        });
      }
      return cloned;
    });

    persistFieldStructure(updatedCharacters);
  };

  const handleUpdateRelationProperty = (metricId, propKey, value) => {
    const isGlobalSyncOn = globalSyncToggles[`relation_${metricId}`] === true;
    if (!isGlobalSyncOn) return;

    const updatedCharacters = characters.map(char => {
      const cloned = JSON.parse(JSON.stringify(char));
      if (cloned.relations) {
        Object.values(cloned.relations).forEach(rData => {
          if (rData.values && rData.values[metricId]) {
            const old = rData.values[metricId];
            const currentObj = typeof old === 'object' && old !== null ? old : { value: old || 0 };
            rData.values[metricId] = { ...currentObj, [propKey]: value };
          }
          if (rData.targetValues && rData.targetValues[metricId]) {
            const old = rData.targetValues[metricId];
            const currentObj = typeof old === 'object' && old !== null ? old : { value: old || 0 };
            rData.targetValues[metricId] = { ...currentObj, [propKey]: value };
          }
        });
      }
      return cloned;
    });

    persistFieldStructure(updatedCharacters);
  };

  const handleSave = () => {
    updateTrackerData({
      ...trackerData,
      systemPromptHeader_merged: localMergedHeader,
      systemPromptFooter_merged: localMergedFooter,
      systemPrompt_readonly: localReadOnlyPrompt,
      systemPromptHeader_separated: localSepHeader,
      systemPromptFooter_separated: localSepFooter,
      guidePrompts: localGuidePrompts,
      globalDefinitions: localDefObj,
      worldSchema: localWorldSchema,
      addCharPrompt: localAddCharPrompt,
      addPlayerCharPrompt: localAddPlayerCharPrompt,
      cyoaPrompt: localCyoaPrompt,
      weatherPrompt: localWeatherPrompt,
      worldEventsPrompt: localWorldEventsPrompt
    });
    alert("Prompt configurations and field definitions saved successfully.");
    closeEditor();
  };

  const handleExport = () => {
    const exportData = {
      systemPromptHeader_merged: localMergedHeader,
      systemPromptFooter_merged: localMergedFooter,
      systemPrompt_readonly: localReadOnlyPrompt,
      systemPromptHeader_separated: localSepHeader,
      systemPromptFooter_separated: localSepFooter,
      guidePrompts: localGuidePrompts,
      globalDefinitions: localDefObj,
      worldSchema: localWorldSchema,
      addCharPrompt: localAddCharPrompt,
      addPlayerCharPrompt: localAddPlayerCharPrompt,
      cyoaPrompt: localCyoaPrompt,
      weatherPrompt: localWeatherPrompt,
      worldEventsPrompt: localWorldEventsPrompt
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rpg-tracker-prompt-settings.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    document.getElementById('prompt-import-file')?.click();
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (importedData && typeof importedData === 'object') {
          definitionEpochRef.current += 1;
          if (importedData.systemPromptHeader_merged !== undefined) setLocalMergedHeader(importedData.systemPromptHeader_merged);
          if (importedData.systemPromptFooter_merged !== undefined) setLocalMergedFooter(importedData.systemPromptFooter_merged);
          if (importedData.systemPrompt_readonly !== undefined) setLocalReadOnlyPrompt(importedData.systemPrompt_readonly);
          if (importedData.systemPromptHeader_separated !== undefined) setLocalSepHeader(importedData.systemPromptHeader_separated);
          if (importedData.systemPromptFooter_separated !== undefined) setLocalSepFooter(importedData.systemPromptFooter_separated);
          if (Array.isArray(importedData.guidePrompts)) setLocalGuidePrompts(importedData.guidePrompts);
          if (importedData.globalDefinitions && typeof importedData.globalDefinitions === 'object') replaceDefinitions(importedData.globalDefinitions);
          if (importedData.worldSchema && typeof importedData.worldSchema === 'object') setLocalWorldSchema(importedData.worldSchema);
          if (importedData.addCharPrompt !== undefined) setLocalAddCharPrompt(importedData.addCharPrompt);
          if (importedData.addPlayerCharPrompt !== undefined) setLocalAddPlayerCharPrompt(importedData.addPlayerCharPrompt);
          if (importedData.cyoaPrompt !== undefined) setLocalCyoaPrompt(importedData.cyoaPrompt);
          if (importedData.weatherPrompt !== undefined) setLocalWeatherPrompt(importedData.weatherPrompt);
          if (importedData.worldEventsPrompt !== undefined) setLocalWorldEventsPrompt(importedData.worldEventsPrompt);

          alert("Prompt configurations imported successfully. Click 'Save Changes' to apply.");
        } else {
          alert("Invalid file format. Please import a valid RPG Tracker prompt settings JSON file.");
        }
      } catch (err) {
        console.error("Failed to import settings:", err);
        alert("Failed to parse settings file. Make sure it is a valid JSON.");
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleGuideToggle = (id, checked) => {
    setLocalGuidePrompts(prev => prev.map(g => g.id === id ? { ...g, enabled: checked } : g));
  };

  const clearDefinitions = () => {
    if (window.confirm("Clear all field guidelines? (Field styles and values are preserved)")) {
      replaceDefinitions({});
    }
  };

  const toggleDefAccordion = (fullKey) => {
    setExpandedDefIds(prev => ({ ...prev, [fullKey]: !prev[fullKey] }));
  };

  const previewSchema = getDynamicSchemaExample({ guidePrompts: localGuidePrompts, characters, worldSchema: localWorldSchema });

  return (
    <div className="rpg-modal-overlay">
      <div className="rpg-modal-container" onClick={e => e.stopPropagation()}>
        <header className="rpg-modal-header">
          <h4>Prompt Editor</h4>
          <button type="button" className="rpg-modal-close-btn" onClick={closeEditor}>×</button>
        </header>

        <div className="rpg-tab-nav">
          <button
            type="button"
            className={`rpg-tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            System Prompt
          </button>
          <button
            type="button"
            className={`rpg-tab-btn ${activeTab === 'addons' ? 'active' : ''}`}
            onClick={() => setActiveTab('addons')}
          >
            Add-ons
          </button>
          <button
            type="button"
            className={`rpg-tab-btn ${activeTab === 'definitions' ? 'active' : ''}`}
            onClick={() => setActiveTab('definitions')}
          >
            Field Definitions
          </button>
        </div>

        <div className="rpg-modal-body">
          {/* SYSTEM PROMPT TAB */}
          {activeTab === 'system' && (
            <div className={styles.sectionStack}>
              {/* 1. MERGED MODE */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsMergedOpen(!isMergedOpen)}>
                    <AccordionArrow isExpanded={isMergedOpen} />
                    <strong>System Prompt (Merged Mode)</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => { setLocalMergedHeader(DEFAULT_PROMPT_HEADER_MERGED); setLocalMergedFooter(DEFAULT_PROMPT_FOOTER_MERGED); }}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditMerged ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditMerged(!isEditMerged)}>
                      {isEditMerged ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isMergedOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '140px', opacity: isEditMerged ? 1 : 0.7 }}
                      value={localMergedHeader}
                      onChange={e => setLocalMergedHeader(e.target.value)}
                      readOnly={!isEditMerged}
                    />
                    <div className={styles.slotNotice}>[Hybrid State & Schema JSON will be injected here]</div>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '140px', opacity: isEditMerged ? 1 : 0.7 }}
                      value={localMergedFooter}
                      onChange={e => setLocalMergedFooter(e.target.value)}
                      readOnly={!isEditMerged}
                    />
                  </div>
                )}
              </div>

              {/* 2. SEPARATED MODE */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsReadOnlyOpen(!isReadOnlyOpen)}>
                    <AccordionArrow isExpanded={isReadOnlyOpen} />
                    <strong>System Prompt (Separated Mode)</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalReadOnlyPrompt(DEFAULT_READONLY_CONTEXT_HEADER)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditReadOnly ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditReadOnly(!isEditReadOnly)}>
                      {isEditReadOnly ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isReadOnlyOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '160px', opacity: isEditReadOnly ? 1 : 0.7 }}
                      value={localReadOnlyPrompt}
                      onChange={e => setLocalReadOnlyPrompt(e.target.value)}
                      readOnly={!isEditReadOnly}
                    />
                    <div className={styles.slotNotice}>[Live RPG Status (Values only) will be appended here]</div>
                  </div>
                )}
              </div>

              {/* 3. MANUAL UPDATE MODE */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsSepOpen(!isSepOpen)}>
                    <AccordionArrow isExpanded={isSepOpen} />
                    <strong>System Prompt (Manual Update Mode)</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => { setLocalSepHeader(DEFAULT_PROMPT_HEADER_SEP); setLocalSepFooter(DEFAULT_PROMPT_FOOTER_SEP); }}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditSep ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditSep(!isEditSep)}>
                      {isEditSep ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isSepOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '140px', opacity: isEditSep ? 1 : 0.7 }}
                      value={localSepHeader}
                      onChange={e => setLocalSepHeader(e.target.value)}
                      readOnly={!isEditSep}
                    />
                    <div className={styles.slotNotice}>[Hybrid State & Schema JSON will be injected here]</div>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '140px', opacity: isEditSep ? 1 : 0.7 }}
                      value={localSepFooter}
                      onChange={e => setLocalSepFooter(e.target.value)}
                      readOnly={!isEditSep}
                    />
                  </div>
                )}
              </div>

              {/* SCHEMA PROMPT PREVIEW */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsSchemaOpen(!isSchemaOpen)}>
                    <AccordionArrow isExpanded={isSchemaOpen} />
                    <strong>Schema Prompt Preview</strong>
                  </div>
                </div>
                {isSchemaOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '180px', opacity: 0.8, fontFamily: 'monospace', fontSize: '11px' }}
                      value={previewSchema.trim()}
                      readOnly={true}
                    />
                  </div>
                )}

                {/* SWITCHES */}
                <div className={styles.switchesContainer}>
                  {['status', 'profile'].map(guideId => {
                    const guide = localGuidePrompts.find(g => g.id === guideId);
                    if (!guide) return null;
                    return (
                      <div key={guideId} className={styles.switchCardRow}>
                        <span className={styles.switchTitle}>Update {guideId.charAt(0).toUpperCase() + guideId.slice(1)}</span>
                        <ToggleSwitch
                          checked={guide.enabled}
                          onChange={(checked) => handleGuideToggle(guideId, checked)}
                        />
                      </div>
                    );
                  })}

                  {(() => {
                    const guide = localGuidePrompts.find(g => g.id === 'relations');
                    if (!guide) return null;
                    return (
                      <div className={styles.relationsConfigCard}>
                        <div className={styles.switchCardRow} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                          <span className={styles.switchTitle}>Update Relations</span>
                          <ToggleSwitch
                            checked={guide.enabled}
                            onChange={(checked) => handleGuideToggle('relations', checked)}
                          />
                        </div>
                        <div className={styles.inlineFormRow}>
                          <span className={styles.formSubLabel}>Field type</span>
                          <select
                            className="rpg-select-custom"
                            style={{ flex: 1, height: '28px' }}
                            value={localWorldSchema.relationsFieldType || 'integer'}
                            onChange={e => handleWorldSchemaChange('relationsFieldType', e.target.value)}
                          >
                            <option value="none">none</option>
                            <option value="integer">integer</option>
                            <option value="stacking">stacking</option>
                          </select>
                        </div>
                      </div>
                    );
                  })()}

                  {['inventory', 'quests'].map(guideId => {
                    const guide = localGuidePrompts.find(g => g.id === guideId);
                    if (!guide) return null;
                    return (
                      <div key={guideId} className={styles.switchCardRow}>
                        <span className={styles.switchTitle}>Update {guideId.charAt(0).toUpperCase() + guideId.slice(1)}</span>
                        <ToggleSwitch
                          checked={guide.enabled}
                          onChange={(checked) => handleGuideToggle(guideId, checked)}
                        />
                      </div>
                    );
                  })}

                  <div className={styles.worldStateGroupCard}>
                    <div className={styles.groupCardHeader}>World State</div>

                    {[
                      { id: 'world_date', name: 'Update Date', selectKey: 'dateSelect', customKey: 'dateCustom', opts: DATE_OPTS },
                      { id: 'world_time', name: 'Update Time', selectKey: 'timeSelect', customKey: 'timeCustom', opts: TIME_OPTS },
                      { id: 'world_weather', name: 'Update Weather', selectKey: 'weatherSelect', customKey: 'weatherCustom', opts: WEATHER_OPTS }
                    ].map(f => {
                      const guide = localGuidePrompts.find(g => g.id === f.id);
                      if (!guide) return null;
                      return (
                        <div key={f.id} className={styles.worldStateSubRow}>
                          <div className={styles.switchCardRow} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                            <span className={styles.switchTitle}>{f.name}</span>
                            <ToggleSwitch
                              checked={guide.enabled}
                              onChange={(checked) => handleGuideToggle(f.id, checked)}
                            />
                          </div>
                          <div className={styles.inlineFormRow}>
                            <select
                              className="rpg-select-custom"
                              style={{ flex: 1, height: '28px' }}
                              value={localWorldSchema[f.selectKey] || '1'}
                              onChange={e => handleWorldSchemaChange(f.selectKey, e.target.value, f.opts)}
                            >
                              {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                            <input
                              type="text"
                              className={styles.defInput}
                              style={{ flex: 2, height: '28px' }}
                              value={localWorldSchema[f.customKey] || ''}
                              onChange={e => handleWorldSchemaChange(f.customKey, e.target.value)}
                              readOnly={localWorldSchema[f.selectKey] !== 'custom'}
                              placeholder="Format Example"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {(() => {
                      const guide = localGuidePrompts.find(g => g.id === 'world_location');
                      if (!guide) return null;
                      return (
                        <div className={styles.switchCardRow} style={{ padding: '4px 0', background: 'transparent', border: 'none' }}>
                          <span className={styles.switchTitle}>Update Location</span>
                          <ToggleSwitch
                            checked={guide.enabled}
                            onChange={(checked) => handleGuideToggle('world_location', checked)}
                          />
                        </div>
                      );
                    })()}

                    {(() => {
                      const guide = localGuidePrompts.find(g => g.id === 'world_events');
                      if (!guide) return null;
                      return (
                        <div className={styles.switchCardRow} style={{ padding: '4px 0', background: 'transparent', border: 'none' }}>
                          <span className={styles.switchTitle}>Update Events</span>
                          <ToggleSwitch
                            checked={guide.enabled}
                            onChange={(checked) => handleGuideToggle('world_events', checked)}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ADD-ONS TAB */}
          {activeTab === 'addons' && (
            <div className={styles.sectionStack}>
              {/* 1. BASE NPC GENERATION PROMPT */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsAddCharOpen(!isAddCharOpen)}>
                    <AccordionArrow isExpanded={isAddCharOpen} />
                    <strong>NPC Generation Base Prompt</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalAddCharPrompt(DEFAULT_ADD_CHAR_PROMPT)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditAddChar ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditAddChar(!isEditAddChar)}>
                      {isEditAddChar ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isAddCharOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '100px', opacity: isEditAddChar ? 1 : 0.7 }}
                      value={localAddCharPrompt}
                      onChange={e => setLocalAddCharPrompt(e.target.value)}
                      readOnly={!isEditAddChar}
                    />
                  </div>
                )}
              </div>

              {/* 2. BASE PLAYER GENERATION PROMPT */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsAddPlayerCharOpen(!isAddPlayerCharOpen)}>
                    <AccordionArrow isExpanded={isAddPlayerCharOpen} />
                    <strong>Player Generation Base Prompt</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalAddPlayerCharPrompt(DEFAULT_ADD_PLAYER_CHAR_PROMPT)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditAddPlayerChar ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditAddPlayerChar(!isEditAddPlayerChar)}>
                      {isEditAddPlayerChar ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isAddPlayerCharOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '100px', opacity: isEditAddPlayerChar ? 1 : 0.7 }}
                      value={localAddPlayerCharPrompt}
                      onChange={e => setLocalAddPlayerCharPrompt(e.target.value)}
                      readOnly={!isEditAddPlayerChar}
                    />
                  </div>
                )}
              </div>

              {/* 3. WORLD EVENTS ADDON PROMPT */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsWorldEventsOpen(!isWorldEventsOpen)}>
                    <AccordionArrow isExpanded={isWorldEventsOpen} />
                    <strong>World Events Instruction</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalWorldEventsPrompt(DEFAULT_WORLD_EVENTS_PROMPT)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditWorldEvents ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditWorldEvents(!isEditWorldEvents)}>
                      {isEditWorldEvents ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isWorldEventsOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '80px', opacity: isEditWorldEvents ? 1 : 0.7 }}
                      value={localWorldEventsPrompt}
                      onChange={e => setLocalWorldEventsPrompt(e.target.value)}
                      readOnly={!isEditWorldEvents}
                    />
                  </div>
                )}
              </div>

              {/* 4. DYNAMIC WEATHER ADDON PROMPT */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsWeatherOpen(!isWeatherOpen)}>
                    <AccordionArrow isExpanded={isWeatherOpen} />
                    <strong>Dynamic Weather Instruction</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalWeatherPrompt(DEFAULT_WEATHER_PROMPT)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditWeather ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditWeather(!isEditWeather)}>
                      {isEditWeather ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isWeatherOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '80px', opacity: isEditWeather ? 1 : 0.7 }}
                      value={localWeatherPrompt}
                      onChange={e => setLocalWeatherPrompt(e.target.value)}
                      readOnly={!isEditWeather}
                    />
                  </div>
                )}
              </div>

              {/* 5. CYOA MODE ADDON PROMPT */}
              <div className={styles.promptCard}>
                <div className={styles.promptCardHeader}>
                  <div className={styles.accordionHeader} onClick={() => setIsCyoaOpen(!isCyoaOpen)}>
                    <AccordionArrow isExpanded={isCyoaOpen} />
                    <strong>CYOA Mode Instruction</strong>
                  </div>
                  <div className={styles.buttonGroup}>
                    <button type="button" className="rpg-btn" onClick={() => setLocalCyoaPrompt(DEFAULT_CYOA_PROMPT)}>Reset</button>
                    <button type="button" className={`rpg-btn ${isEditCyoa ? 'rpg-btn-primary' : ''}`} onClick={() => setIsEditCyoa(!isEditCyoa)}>
                      {isEditCyoa ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>
                {isCyoaOpen && (
                  <div className={styles.textareaStack}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: '80px', opacity: isEditCyoa ? 1 : 0.7 }}
                      value={localCyoaPrompt}
                      onChange={e => setLocalCyoaPrompt(e.target.value)}
                      readOnly={!isEditCyoa}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FIELD DEFINITIONS TAB */}
          {activeTab === 'definitions' && (
            <div className={styles.section} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <label className={styles.label} style={{ margin: 0, fontSize: '13.5px' }}>
                  Field Definitions & Global Guidelines
                </label>
                <button
                  type="button"
                  className="rpg-btn-sm"
                  onClick={clearDefinitions}
                  title="Clear all AI guidelines"
                >
                  Clear Guidelines
                </button>
              </div>

              <div style={{ fontSize: '11px', opacity: 0.7, margin: 0, color: 'var(--rpg-text)', lineHeight: '1.4' }}>
                <div>Edit AI suggestions before saving. Large selections use multiple AI requests.</div>
                <div>※ Turn on 'Global' switch only when you want to overwrite styles and types to all characters.</div>
              </div>

              <div className={styles.bulkSuggestions}>
                <select
                  aria-label="Suggest All scope"
                  value={suggestionScope}
                  onChange={event => setSuggestionScope(event.target.value)}
                  disabled={Boolean(suggestingKey)}
                >
                  <option value="empty">Empty fields only ({emptyFields.length})</option>
                  <option value="all">Regenerate all fields ({suggestionFields.length})</option>
                </select>
                <button
                  type="button"
                  className="rpg-btn-sm"
                  aria-label="Suggest All"
                  aria-busy={suggestingKey === 'all'}
                  disabled={Boolean(suggestingKey) || !bulkFields.length}
                  onClick={() => suggestGuidelines(bulkFields, true)}
                >
                  {suggestingKey === 'all' ? 'Suggesting…' : 'Suggest All'}
                </button>
              </div>
              <div className={styles.suggestionFeedback} role="status" aria-live="polite" aria-atomic="true">{suggestionFeedback}</div>

              <DefinitionPresetControls
                availableKeys={suggestionFields.map(field => `${field.category}_${field.id}`)}
                captureDraft={captureDefinitionDraft}
                isDraftCurrent={isDefinitionDraftCurrent}
                onApply={replaceDefinitions}
                suggestionBusy={Boolean(suggestingKey)}
              />

              {/* 1. STATUS GROUP */}
              {uniqueFields.status.length > 0 && (
                <div className={styles.defGroup}>
                  <h5 className={styles.defGroupTitle}>Status Fields</h5>
                  {uniqueFields.status.map(item => {
                    const fullKey = `status_${item.id}`;
                    const isExpanded = !!expandedDefIds[fullKey];
                    const isGlobalOn = globalSyncToggles[fullKey] || false;

                    return (
                      <div key={fullKey} className={`${statusStyles.schemaItem} ${isExpanded ? statusStyles.itemExpanded : ''}`}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', background: 'rgba(0, 0, 0, 0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                              <AccordionArrow
                                isExpanded={isExpanded}
                                onClick={() => toggleDefAccordion(fullKey)}
                              />
                              <input
                                type="text"
                                className={statusStyles.nameInput}
                                style={{ width: '140px', fontWeight: 'bold', color: 'var(--rpg-highlight)' }}
                                defaultValue={item.name || item.id}
                                placeholder="Field Name"
                                onBlur={(e) => handleRenameFieldUnified('status', item.id, e.target.value)}
                              />
                            </div>

                            <ToggleSwitch
                              label="Global"
                              checked={isGlobalOn}
                              onChange={(checked) => handleToggleGlobalSync(fullKey, checked)}
                              title="When enabled, edits to style/type below will overwrite all characters"
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', width: '100%', paddingLeft: '22px', boxSizing: 'border-box' }}>
                            {renderDefinitionGuide('status', item)}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className={statusStyles.itemFields} style={{ opacity: isGlobalOn ? 1 : 0.65 }}>
                            <StatusSpecConfig
                              type={item.type}
                              min={item.min}
                              max={item.max}
                              color={item.color}
                              disabled={!isGlobalOn}
                              onChange={(propKey, value) => handleUpdateStatusProperty(item.id, propKey, value)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. PROFILE GROUP */}
              {uniqueFields.profiles.length > 0 && (
                <div className={styles.defGroup}>
                  <h5 className={styles.defGroupTitle}>Profile Fields</h5>
                  {uniqueFields.profiles.map(item => {
                    const fullKey = `profile_${item.id}`;
                    return (
                      <div key={fullKey} className={statusStyles.schemaItem}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', background: 'rgba(0, 0, 0, 0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <span style={{ width: '18px', textAlign: 'center', opacity: 0.4, fontSize: '10px' }}>•</span>
                            <input
                              type="text"
                              className={statusStyles.nameInput}
                              style={{ width: '140px', fontWeight: 'bold', color: 'var(--rpg-highlight)' }}
                              defaultValue={item.name || item.id}
                              placeholder="Field Name"
                              onBlur={(e) => handleRenameFieldUnified('profile', item.id, e.target.value)}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', width: '100%', paddingLeft: '18px', boxSizing: 'border-box' }}>
                            {renderDefinitionGuide('profile', item)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 3. RELATIONS GROUP */}
              {uniqueFields.relations.length > 0 && (
                <div className={styles.defGroup}>
                  <h5 className={styles.defGroupTitle}>Relationship Metrics</h5>
                  {uniqueFields.relations.map(item => {
                    const fullKey = `relation_${item.id}`;
                    const isExpanded = !!expandedDefIds[fullKey];
                    const isGlobalOn = globalSyncToggles[fullKey] || false;

                    return (
                      <div key={fullKey} className={`${statusStyles.schemaItem} ${isExpanded ? statusStyles.itemExpanded : ''}`}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', background: 'rgba(0, 0, 0, 0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                              <AccordionArrow
                                isExpanded={isExpanded}
                                onClick={() => toggleDefAccordion(fullKey)}
                              />
                              <input
                                type="text"
                                className={statusStyles.nameInput}
                                style={{ width: '140px', fontWeight: 'bold', color: 'var(--rpg-highlight)' }}
                                defaultValue={item.name || item.id}
                                placeholder="Metric Name"
                                onBlur={(e) => handleRenameFieldUnified('relation', item.id, e.target.value)}
                              />
                            </div>

                            <ToggleSwitch
                              label="Global"
                              checked={isGlobalOn}
                              onChange={(checked) => handleToggleGlobalSync(fullKey, checked)}
                              title="When enabled, metric colors/ranges will overwrite all characters"
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', width: '100%', paddingLeft: '22px', boxSizing: 'border-box' }}>
                            {renderDefinitionGuide('relation', item)}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className={statusStyles.itemFields} style={{ opacity: isGlobalOn ? 1 : 0.65, padding: '8px 10px' }}>
                            <RelationMetricConfig
                              colorNegative={item.colorNegative}
                              colorPositive={item.colorPositive}
                              min={item.min}
                              max={item.max}
                              disabled={!isGlobalOn}
                              onChange={(propKey, value) => handleUpdateRelationProperty(item.id, propKey, value)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="rpg-modal-footer">
          <div className="rpg-modal-footer-left">
            <button type="button" className="rpg-modal-btn" onClick={handleExport}>Export</button>
            <button type="button" className="rpg-modal-btn" onClick={handleImportClick}>Import</button>
            <input
              type="file"
              id="prompt-import-file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
          <div className="rpg-modal-footer-right">
            <button type="button" className="rpg-modal-btn" onClick={closeEditor}>Cancel</button>
            <button type="button" className="rpg-modal-btn save" onClick={handleSave}>Save Changes</button>
          </div>
        </footer>
      </div>
    </div>
  );
}