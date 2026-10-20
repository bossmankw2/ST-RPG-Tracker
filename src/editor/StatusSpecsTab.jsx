import React, { useState } from 'react';
import styles from './StatusEditor.module.css';
import { AccordionArrow, ToggleSwitch } from '../utils';
import SortableList from './SortableList';
import { replaceGroupOrder } from './SortOrder';

// Status 필드 세부 속성 설정 폼 (PromptEditor와 공용으로 사용)
export function StatusSpecConfig({
  type = 'consumable',
  min = 0,
  max = 100,
  color = '#e74c3c',
  disabled = false,
  onChange
}) {
  return (
    <div className={styles.itemFields}>
      <div className={styles.inlineRow}>
        <label>Type</label>
        <select
          value={type}
          disabled={disabled}
          onChange={(e) => onChange && onChange('type', e.target.value)}
          className="rpg-select-custom"
        >
          <option value="consumable">Consumable (Max ➔ 0)</option>
          <option value="stacking">Stacking (0 ➔ Max)</option>
          <option value="integer">Integer</option>
          <option value="text">Text</option>
        </select>
      </div>

      {type !== 'text' && (
        <>
          <div className={styles.inlineRow}>
            <label>Min Limit</label>
            <input
              type="number"
              disabled={disabled}
              value={min !== undefined && min !== null ? min : 0}
              onChange={(e) => onChange && onChange('min', Number(e.target.value))}
            />
          </div>
          <div className={styles.inlineRow}>
            <label>Max Limit</label>
            <input
              type="number"
              disabled={disabled}
              value={max !== undefined && max !== null ? max : 100}
              onChange={(e) => onChange && onChange('max', Number(e.target.value))}
            />
          </div>
        </>
      )}

      {['consumable', 'stacking'].includes(type) && (
        <div className={styles.inlineRow}>
          <label>Visual Color</label>
          <input
            type="color"
            disabled={disabled}
            value={color || (type === 'stacking' ? '#3498db' : '#e74c3c')}
            onChange={(e) => onChange && onChange('color', e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

export default function StatusSpecsTab({
  charId,
  targetChar,
  localCharacters,
  setLocalCharacters,
  expandedIds,
  setExpandedIds,
  updateSchemaField,
  handleUpdateNestedField
}) {
  const [gaugePreset, setGaugePreset] = useState('0~100');
  const [gaugeMin, setGaugeMin] = useState(0);
  const [gaugeMax, setGaugeMax] = useState(100);

  const [integerPreset, setIntegerPreset] = useState('0~100');
  const [integerMin, setIntegerMin] = useState(0);
  const [integerMax, setIntegerMax] = useState(100);

  const targetSchema = (targetChar.statusSchema || []).filter(s => s.type !== 'relation_schema');

  const getGroupedFields = (schema) => ({
    gauge: schema.filter(item => ['stacking', 'consumable'].includes(item.type)),
    integer: schema.filter(item => item.type === 'integer'),
    text: schema.filter(item => item.type === 'text')
  });

  const toggleAccordion = (id) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddStat = (type, customMin = 0, customMax = 100) => {
    const existingIds = (targetChar?.statusSchema || []).map(s => s.id);
    let baseName = 'NewField';
    let statId = baseName;
    let counter = 1;
    while (existingIds.includes(statId)) {
      statId = `${baseName}_${counter}`;
      counter++;
    }

    const newField = {
      id: statId,
      name: statId === baseName ? 'NewField' : `NewField ${counter - 1}`,
      type,
      min: type !== 'text' ? customMin : null,
      max: type !== 'text' ? customMax : null,
      color: type === 'stacking' ? '#3498db' : (type === 'consumable' ? '#e74c3c' : undefined),
      isLocked: false,
      isInject: true
    };

    setLocalCharacters(localCharacters.map(c =>
      c.id === charId
        ? {
          ...c,
          statusSchema: [...(c.statusSchema || []), newField],
          status: { ...c.status, [statId]: type === 'text' ? '' : 0 }
        }
        : c
    ));
    setExpandedIds(prev => ({ ...prev, [statId]: true }));
  };

  const handleSchemaNameBlur = (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setLocalCharacters(prevChars => prevChars.map(c => {
      if (c.id !== charId) return c;
      const duplicate = (c.statusSchema || []).some(s => s.id !== id
        && (s.name || s.id).trim().toLowerCase() === trimmed.toLowerCase());
      if (duplicate) {
        alert(`The status field name "${trimmed}" already exists.`);
      }
      // A display-name edit must not change the identity used by locks and ordering.
      return {
        ...c,
        statusSchema: (c.statusSchema || []).map(s => s.id === id
          ? { ...s, name: duplicate ? id : trimmed } : s)
      };
    }));
  };

  const removeField = (id) => {
    setLocalCharacters(localCharacters.map(c => {
      if (c.id !== charId) return c;
      const nextStatus = { ...c.status };
      delete nextStatus[id];
      return {
        ...c,
        statusSchema: (c.statusSchema || []).filter(s => s.id !== id),
        status: nextStatus
      };
    }));
  };

  const handleReorderStats = (orderedFields) => {
    setLocalCharacters(prev => prev.map(c => c.id === charId ? {
      ...c,
      statusSchema: replaceGroupOrder(c.statusSchema || [], orderedFields)
    } : c));
  };

  const handleReorderProfile = (orderedKeys) => {
    setLocalCharacters(prev => prev.map(c => c.id === charId ? {
      ...c,
      profile: Object.fromEntries(orderedKeys.map(key => [key, c.profile[key]]))
    } : c));
  };

  const groupedStatus = getGroupedFields(targetSchema);
  const profileKeys = targetChar.profile ? Object.keys(targetChar.profile) : ['race', 'height', 'hair', 'eye', 'personality'];

  return (
    <div className={styles.statEditorDetail}>
      {/* Consumables & Stackings */}
      <div className={styles.sectionWrapper}>
        <div className={styles.sectionHeaderLine}>
          <h5>Consumables & Stackings</h5>
          <div className={styles.flexCenterGroup}>
            <select
              value={gaugePreset}
              onChange={e => {
                setGaugePreset(e.target.value);
                if (e.target.value !== 'custom') { setGaugeMin(0); setGaugeMax(100); }
              }}
              className="rpg-select-custom"
            >
              <option value="0~100">0~100</option>
              <option value="custom">custom</option>
            </select>
            <div className={styles.metricLimitWrapper}>
              <span className={styles.metricLimitLabel}>min</span>
              <input
                type="number"
                value={gaugeMin}
                disabled={gaugePreset !== 'custom'}
                onChange={e => setGaugeMin(Number(e.target.value))}
                className={styles.limitInput}
              />
              <span className={styles.metricLimitLabel}>max</span>
              <input
                type="number"
                value={gaugeMax}
                disabled={gaugePreset !== 'custom'}
                onChange={e => setGaugeMax(Number(e.target.value))}
                className={styles.limitInput}
              />
            </div>
            <button
              type="button"
              className="rpg-btn-sm"
              onClick={() => handleAddStat('consumable', gaugeMin, gaugeMax)}
            >
              +Add
            </button>
          </div>
        </div>

        {groupedStatus.gauge.length === 0 ? (
          <p className={styles.emptySectionText}>No gauge fields defined.</p>
        ) : (
          <SortableList items={groupedStatus.gauge} onReorder={handleReorderStats} label="Gauge fields">
          {(item, { itemProps, dragHandle }) => (
            <div {...itemProps} className={`${styles.schemaItem} ${expandedIds[item.id] ? styles.itemExpanded : ''}`}>
              <div className={styles.itemHeader}>
                <div className={styles.headerLeftZone}>
                  {dragHandle}
                  <AccordionArrow
                    isExpanded={!!expandedIds[item.id]}
                    onClick={() => toggleAccordion(item.id)}
                  />
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateSchemaField(item.id, 'name', e.target.value)}
                    onBlur={e => handleSchemaNameBlur(item.id, e.target.value)}
                    className={styles.nameInput}
                  />
                  <span className={styles.fixedBadge}>{item.type.toUpperCase()}</span>
                </div>
                <div className={styles.headerRightZone}>
                  <ToggleSwitch
                    label="Inject"
                    checked={item.isInject !== false}
                    onChange={checked => updateSchemaField(item.id, 'isInject', checked)}
                    title="Toggle Prompt Injection"
                  />
                  <button
                    type="button"
                    className="rpg-btn-del"
                    onClick={() => removeField(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>

              {expandedIds[item.id] && (
                <StatusSpecConfig
                  type={item.type}
                  min={item.min}
                  max={item.max}
                  color={item.color}
                  onChange={(key, val) => updateSchemaField(item.id, key, val)}
                />
              )}
            </div>
          )}
          </SortableList>
        )}
      </div>

      {/* Integer */}
      <div className={styles.sectionWrapper}>
        <div className={styles.sectionHeaderLine}>
          <h5>Integer</h5>
          <div className={styles.flexCenterGroup}>
            <select
              value={integerPreset}
              onChange={e => {
                setIntegerPreset(e.target.value);
                if (e.target.value === '0~25') { setIntegerMin(0); setIntegerMax(25); }
                else if (e.target.value === '0~100') { setIntegerMin(0); setIntegerMax(100); }
              }}
              className="rpg-select-custom"
            >
              <option value="0~25">0~25</option>
              <option value="0~100">0~100</option>
              <option value="custom">custom</option>
            </select>
            <div className={styles.metricLimitWrapper}>
              <span className={styles.metricLimitLabel}>min</span>
              <input
                type="number"
                value={integerMin}
                disabled={integerPreset !== 'custom'}
                onChange={e => setIntegerMin(Number(e.target.value))}
                className={styles.limitInput}
              />
              <span className={styles.metricLimitLabel}>max</span>
              <input
                type="number"
                value={integerMax}
                disabled={integerPreset !== 'custom'}
                onChange={e => setIntegerMax(Number(e.target.value))}
                className={styles.limitInput}
              />
            </div>
            <button
              type="button"
              className="rpg-btn-sm"
              onClick={() => handleAddStat('integer', integerMin, integerMax)}
            >
              +Add
            </button>
          </div>
        </div>

        {groupedStatus.integer.length === 0 ? (
          <p className={styles.emptySectionText}>No integer fields defined.</p>
        ) : (
          <SortableList items={groupedStatus.integer} onReorder={handleReorderStats} label="Integer fields">
          {(item, { itemProps, dragHandle }) => (
            <div {...itemProps} className={`${styles.schemaItem} ${expandedIds[item.id] ? styles.itemExpanded : ''}`}>
              <div className={styles.itemHeader}>
                <div className={styles.headerLeftZone}>
                  {dragHandle}
                  <AccordionArrow
                    isExpanded={!!expandedIds[item.id]}
                    onClick={() => toggleAccordion(item.id)}
                  />
                  <input
                    type="text"
                    value={item.name}
                    placeholder="Field Name"
                    onChange={e => updateSchemaField(item.id, 'name', e.target.value)}
                    onBlur={e => handleSchemaNameBlur(item.id, e.target.value)}
                    className={styles.nameInput}
                  />
                  <span className={styles.fixedBadge}>INT</span>
                </div>
                <div className={styles.headerRightZone}>
                  <ToggleSwitch
                    label="Inject"
                    checked={item.isInject !== false}
                    onChange={checked => updateSchemaField(item.id, 'isInject', checked)}
                    title="Toggle Prompt Injection"
                  />
                  <button
                    type="button"
                    className="rpg-btn-del"
                    onClick={() => removeField(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>

              {expandedIds[item.id] && (
                <StatusSpecConfig
                  type={item.type}
                  min={item.min}
                  max={item.max}
                  color={item.color}
                  onChange={(key, val) => updateSchemaField(item.id, key, val)}
                />
              )}
            </div>
          )}
          </SortableList>
        )}
      </div>

      {/* Text */}
      <div className={styles.sectionWrapper}>
        <div className={styles.sectionHeaderLine}>
          <h5>Text</h5>
          <button
            type="button"
            className="rpg-btn-sm"
            onClick={() => handleAddStat('text')}
          >
            + Add Text
          </button>
        </div>

        {groupedStatus.text.length === 0 ? (
          <p className={styles.emptySectionText}>No custom text fields defined.</p>
        ) : (
          <SortableList items={groupedStatus.text} onReorder={handleReorderStats} label="Text fields">
          {(item, { itemProps, dragHandle }) => (
            <div {...itemProps} className={styles.schemaItem}>
              <div className={styles.itemHeader}>
                <div className={styles.headerLeftZone}>
                  {dragHandle}
                  <input
                    type="text"
                    value={item.name}
                    placeholder="Field Name"
                    onChange={e => updateSchemaField(item.id, 'name', e.target.value)}
                    onBlur={e => handleSchemaNameBlur(item.id, e.target.value)}
                    className={styles.nameInput}
                  />
                  <span className={styles.fixedBadge}>TEXT</span>
                </div>
                <div className={styles.headerRightZone}>
                  <ToggleSwitch
                    label="Inject"
                    checked={item.isInject !== false}
                    onChange={checked => updateSchemaField(item.id, 'isInject', checked)}
                    title="Toggle Prompt Injection"
                  />
                  <button
                    type="button"
                    className="rpg-btn-del"
                    onClick={() => removeField(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}
          </SortableList>
        )}
      </div>

      {/* Profile */}
      <div className={styles.sectionWrapper}>
        <div className={styles.sectionHeaderLine}>
          <h5>Profile</h5>
          <button
            type="button"
            className="rpg-btn-sm"
            onClick={() => {
              const prof = targetChar.profile || {};
              let baseKey = 'NewField';
              let newKey = baseKey;
              let counter = 1;
              while (prof[newKey] !== undefined) {
                newKey = `${baseKey}_${counter}`;
                counter++;
              }
              handleUpdateNestedField('profile', newKey, '');
            }}
          >
            + Add Field
          </button>
        </div>

        <div className={styles.appearanceSection}>
          {profileKeys.length === 0 ? (
            <p className={styles.emptySectionText}>No profile fields defined.</p>
          ) : (
            <SortableList items={profileKeys} getId={key => key} getLabel={key => key}
              onReorder={handleReorderProfile} label="Profile fields">
            {(key, { itemProps, dragHandle }) => (
              <div {...itemProps} className={styles.schemaItem}>
                <div className={styles.itemHeader}>
                  <div className={styles.headerLeftZone}>
                  {dragHandle}
                    <input
                      type="text"
                      defaultValue={key}
                      placeholder="Field Name"
                      onBlur={e => {
                        const newKey = e.target.value.trim();
                        if (!newKey) { e.target.value = key; return; }
                        if (newKey !== key && targetChar.profile?.[newKey] !== undefined) {
                          alert(`The profile field name "${newKey}" already exists.`);
                          e.target.value = key;
                          return;
                        }
                        if (newKey !== key) {
                          const prof = { ...(targetChar.profile || {}) };
                          const pLocks = { ...(targetChar.profileLocks || {}) };
                          const pInjects = { ...(targetChar.profileInjects || {}) };

                          const keys = Object.keys(prof);
                          const newProf = {};
                          const newLocks = {};
                          const newInjects = {};

                          keys.forEach(k => {
                            if (k === key) {
                              newProf[newKey] = prof[key];
                              newLocks[newKey] = pLocks[key];
                              newInjects[newKey] = pInjects[key];
                            } else {
                              newProf[k] = prof[k];
                              newLocks[k] = pLocks[k];
                              newInjects[k] = pInjects[k];
                            }
                          });
                          setLocalCharacters(localCharacters.map(c => c.id === charId ? { ...c, profile: newProf, profileLocks: newLocks, profileInjects: newInjects } : c));
                        }
                      }}
                      className={styles.nameInput}
                    />
                    <span className={styles.fixedBadge}>TEXT</span>
                  </div>
                  <div className={styles.headerRightZone}>
                    <ToggleSwitch
                      label="Inject"
                      checked={targetChar.profileInjects?.[key] !== false}
                      onChange={checked => {
                        const injects = { ...(targetChar.profileInjects || {}) };
                        injects[key] = checked;
                        handleUpdateNestedField('profileInjects', null, injects);
                      }}
                      title="Toggle Prompt Injection"
                    />
                    <button
                      type="button"
                      className="rpg-btn-del"
                      onClick={() => {
                        const prof = { ...(targetChar.profile || {}) };
                        const pLocks = { ...(targetChar.profileLocks || {}) };
                        const pInjects = { ...(targetChar.profileInjects || {}) };
                        delete prof[key];
                        delete pLocks[key];
                        delete pInjects[key];
                        setLocalCharacters(localCharacters.map(c => c.id === charId ? { ...c, profile: prof, profileLocks: pLocks, profileInjects: pInjects } : c));
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )}
            </SortableList>
          )}
        </div>
      </div>
    </div>
  );
}