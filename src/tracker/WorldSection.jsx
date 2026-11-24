import React, { useMemo, useRef } from 'react';
import { useRPG } from '../core/RPGControl';
import styles from './WorldSection.module.css';
import { AutoGrowingTextArea } from '../utils';
import { formatWorldEventTime } from './WorldEventTimeLabel.js';
import { sortWorldEventsByTime } from '../core/WorldEventOrder.js';
import SortableList from '../editor/SortableList';
import { getCurrentTurnKey } from '../core/JSONTracker_Timeline.js';

const noEvents = [];

// Give old events without a unique stored ID a UI identity. Moving one must
// keep its open time editor and keyboard focus with the same event.
function useEventRows(events) {
  const transientIds = useRef(new WeakMap());
  const sequence = useRef(0);
  const rows = useMemo(() => {
    const counts = new Map();
    const reserved = new Set();
    for (const event of events) {
      if (transientIds.current.has(event)) reserved.add(transientIds.current.get(event));
      if (event?.id) counts.set(event.id, (counts.get(event.id) || 0) + 1);
    }
    const occurrences = new Map();
    return events.map((event, index) => {
      let id;
      if (event && typeof event === 'object') {
        id = transientIds.current.get(event);
        if (!id && counts.get(event.id) === 1) id = `saved:${event.id}`;
        if (!id) {
          id = `legacy:${++sequence.current}`;
          transientIds.current.set(event, id);
        }
      } else {
        let occurrence = occurrences.get(event) || 0;
        do { id = JSON.stringify([event, occurrence++]); } while (reserved.has(id));
        occurrences.set(event, occurrence);
      }
      return { id, event, name: event?.name || `Event ${index + 1}` };
    });
  }, [events]);
  return { rows, transientIds };
}

export default function WorldSection() {
  const { trackerData, updateTrackerData, patchWorldField } = useRPG();
  
  const worldState = trackerData.worldState || { date: '', time: '', location: '', weather: '', events: [] };
  const worldStateLocks = trackerData.worldStateLocks || { date: false, time: false, location: false, weather: false };
  const events = Array.isArray(worldState.events) ? worldState.events : noEvents;
  const { rows, transientIds } = useEventRows(events);
  const turnKey = getCurrentTurnKey(window.RPGBridge);
  const rowOrder = useMemo(() => JSON.stringify(rows.map(row => row.id)), [rows]);

  const guidePrompts = trackerData.guidePrompts || [];
  const isEnabled = (id) => {
    const guide = guidePrompts.find(g => g.id === id);
    return guide ? guide.enabled : true;
  };

  const safeStr = (val) => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      if (val.name) return String(val.name);
      if (val.desc) return String(val.desc);
      if (val.status) return String(val.status);
      return '';
    }
    const str = String(val);
    if (str === '[object Object]') return '';
    return str;
  };

  const saveEventOrder = next => {
    const bridge = window.RPGBridge;
    if (turnKey !== getCurrentTurnKey(bridge) || bridge?.currentTrackerData?.worldState?.events !== events) return;
    if (next !== events) patchWorldField(['events'], next);
  };

  const handleSortByTime = () => {
    const ordered = sortWorldEventsByTime(events);
    if (ordered === events) {
      window.toastr?.info('No events moved. Events with comparable start dates and times are already in order.');
      return;
    }
    saveEventOrder(ordered);
  };

  const handleToggleLock = (key) => {
    if (updateTrackerData) {
      updateTrackerData({
        ...trackerData,
        worldStateLocks: {
          ...worldStateLocks,
          [key]: !worldStateLocks[key]
        }
      });
    }
  };

  const handleAddEvent = () => {
    const newEvent = { id: `event_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, name: '', desc: '' };
    patchWorldField(['events'], [...events, newEvent]);
  };

  const handleEventChange = (index, key, value) => {
    const newEvents = [...events];
    const current = typeof newEvents[index] === 'string'
      ? { name: '', desc: newEvents[index] }
      : (newEvents[index] || {});
    newEvents[index] = { ...current, [key]: value };
    if (!current.id || transientIds.current.has(current)) transientIds.current.set(newEvents[index], rows[index].id);
    patchWorldField(['events'], newEvents);
  };

  const handleDeleteEvent = (index) => {
    const newEvents = events.filter((_, i) => i !== index);
    patchWorldField(['events'], newEvents);
  };

  return (
    <div className={styles.container}>

      {/* World State Section */}
      <div>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>World State</span>
        </div>

        <div className={styles.stateGrid}>
          {isEnabled('world_date') && (
            <div className={styles.rowField}>
              <button
                type="button"
                className={styles.lockBtn}
                onClick={() => handleToggleLock('date')}
                title={worldStateLocks.date ? 'Unlock Date' : 'Lock Date'}
              >
                <i className={`fa-solid ${worldStateLocks.date ? 'fa-lock' : 'fa-lock-open'}`} />
              </button>
              <span className={styles.fieldLabel}>Date</span>
              <AutoGrowingTextArea
                value={safeStr(worldState.date)}
                onChange={(val) => patchWorldField(['date'], val)}
                className={styles.stateTextarea}
                disabled={worldStateLocks.date}
                placeholder=""
              />
            </div>
          )}

          {isEnabled('world_time') && (
            <div className={styles.rowField}>
              <button
                type="button"
                className={styles.lockBtn}
                onClick={() => handleToggleLock('time')}
                title={worldStateLocks.time ? 'Unlock Time' : 'Lock Time'}
              >
                <i className={`fa-solid ${worldStateLocks.time ? 'fa-lock' : 'fa-lock-open'}`} />
              </button>
              <span className={styles.fieldLabel}>Time</span>
              <AutoGrowingTextArea
                value={safeStr(worldState.time)}
                onChange={(val) => patchWorldField(['time'], val)}
                className={styles.stateTextarea}
                disabled={worldStateLocks.time}
                placeholder=""
              />
            </div>
          )}

          {isEnabled('world_weather') && (
            <div className={styles.rowField}>
              <button
                type="button"
                className={styles.lockBtn}
                onClick={() => handleToggleLock('weather')}
                title={worldStateLocks.weather ? 'Unlock Weather' : 'Lock Weather'}
              >
                <i className={`fa-solid ${worldStateLocks.weather ? 'fa-lock' : 'fa-lock-open'}`} />
              </button>
              <span className={styles.fieldLabel}>Weather</span>
              <AutoGrowingTextArea
                value={safeStr(worldState.weather)}
                onChange={(val) => patchWorldField(['weather'], val)}
                className={styles.stateTextarea}
                disabled={worldStateLocks.weather}
                placeholder=""
              />
            </div>
          )}

          {isEnabled('world_location') && (
            <div className={styles.rowField}>
              <button
                type="button"
                className={styles.lockBtn}
                onClick={() => handleToggleLock('location')}
                title={worldStateLocks.location ? 'Unlock Location' : 'Lock Location'}
              >
                <i className={`fa-solid ${worldStateLocks.location ? 'fa-lock' : 'fa-lock-open'}`} />
              </button>
              <span className={styles.fieldLabel}>Location</span>
              <AutoGrowingTextArea
                value={safeStr(worldState.location)}
                onChange={(val) => patchWorldField(['location'], val)}
                className={styles.stateTextarea}
                disabled={worldStateLocks.location}
                placeholder=""
              />
            </div>
          )}
        </div>
      </div>

      {/* World Events Section */}
      {isEnabled('world_events') && (
        <div className={styles.eventsSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.eventsSectionTitle}>World Events</span>
            <div className={styles.eventActions}>
              <button type="button" className="rpg-btn-sm" disabled={events.length < 2}
                title="Order by in-story start date and time. Events without a comparable start stay in place."
                onClick={handleSortByTime}>
                Sort by Time
              </button>
              <button type="button" className="rpg-btn-sm" onClick={handleAddEvent}>
                + Add Event
              </button>
            </div>
          </div>

          <div className={styles.eventsList}>
            {events.length === 0 ? (
              <p className={styles.emptyPlaceholder}>No recorded events.</p>
            ) : (
              <SortableList key={turnKey} label="World Events" items={rows} sessionKey={rowOrder}
                onReorder={ordered => saveEventOrder(ordered.map(row => row.event))}>
                {({ event: storedEvent }, { itemProps, dragHandle, index: idx }) => {
                  const evtObj = typeof storedEvent === 'string'
                    ? { name: '', desc: storedEvent }
                    : (storedEvent || {});
                  const eventTime = formatWorldEventTime(evtObj);
                  return (
                    <div {...itemProps} className={styles.eventBlock} data-world-event-index={idx}>
                      <div className={styles.eventHeaderRow}>
                        {dragHandle}
                        <span className={styles.eventNumber}>Event {idx + 1}</span>
                        <button
                          type="button"
                          className="rpg-btn-del-text"
                          onClick={() => handleDeleteEvent(idx)}
                          title="Remove Event"
                        >
                          ×
                        </button>
                      </div>

                      <input
                        type="text"
                        className={styles.eventTitleInput}
                        value={evtObj.name || ''}
                        onChange={(e) => handleEventChange(idx, 'name', e.target.value)}
                        placeholder="Event Title..."
                      />

                      <details className={styles.eventTimeDetails}>
                        <summary className={styles.eventTimeSummary}>
                          <span className={styles.eventTimeLabel}>In-story time</span>
                          <span className={styles.eventTimeValue} data-world-event-time>
                            {eventTime || 'Add date / time'}
                          </span>
                        </summary>
                        <div className={styles.eventTimeFields}>
                          {[
                            ['startDate', 'Start date', '2025-12-17 or story date'],
                            ['startTime', 'Start time', '10:02 AM'],
                            ['endDate', 'End date', '2025-12-17 or story date'],
                            ['endTime', 'End time', '11:30 AM'],
                          ].map(([key, label, placeholder]) => (
                            <label key={key} className={styles.eventTimeField}>
                              <span>{label}</span>
                              <input
                                type="text"
                                className={styles.eventTimeInput}
                                aria-label={`Event ${idx + 1} ${label.toLowerCase()}`}
                                value={typeof evtObj[key] === 'string' ? evtObj[key] : ''}
                                onChange={e => handleEventChange(idx, key, e.target.value)}
                                placeholder={placeholder}
                              />
                            </label>
                          ))}
                        </div>
                        <p className={styles.eventTimeHint}>Use the story's calendar and time. Leave unknown details blank; an end time is optional.</p>
                      </details>

                      <AutoGrowingTextArea
                        className={styles.eventDescTextarea}
                        value={evtObj.desc || ''}
                        onChange={(text) => handleEventChange(idx, 'desc', text)}
                        placeholder="Describe event..."
                      />
                    </div>
                  );
                }}
              </SortableList>
            )}
          </div>
        </div>
      )}

    </div>
  );
}