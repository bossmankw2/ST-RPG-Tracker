import React, { useEffect, useId, useRef, useState } from 'react';
import { moveItemToIndex } from './SortOrder';
import styles from './SortableList.module.css';

const defaultGetId = item => item.id;
const defaultGetLabel = item => item.name || String(item.id);

export default function SortableList({
  items, onReorder, children, label, disabled = false,
  getId = defaultGetId, getLabel = defaultGetLabel,
}) {
  const instructionsId = useId();
  const listRef = useRef(null);
  const rows = useRef(new Map());
  const handles = useRef(new Map());
  const session = useRef(null);
  const animation = useRef(null);
  const latest = useRef(null);
  latest.current = { items, onReorder, getId, getLabel, disabled };
  const [drag, setDrag] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  const publish = () => {
    const current = session.current;
    setDrag(current?.active ? { ...current } : null);
  };

  const finish = (cancelled = false) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    cancelAnimationFrame(animation.current);
    animation.current = null;
    setDrag(null);
    const { items: currentItems, getId: identify, getLabel: name, onReorder: reorder } = latest.current;
    const fromIndex = currentItems.findIndex(item => identify(item) === current.id);
    if (fromIndex < 0 || !current.active) return;
    if (cancelled) {
      setAnnouncement(`Reordering ${name(currentItems[fromIndex])} cancelled.`);
    } else {
      const toIndex = Math.min(current.toIndex, currentItems.length - 1);
      const next = moveItemToIndex(currentItems, fromIndex, toIndex);
      if (next !== currentItems) reorder(next);
      setAnnouncement(`${name(currentItems[fromIndex])} moved to position ${toIndex + 1} of ${currentItems.length}.`);
    }
    if (current.mode === 'keyboard') {
      requestAnimationFrame(() => handles.current.get(current.id)?.focus());
    }
  };

  useEffect(() => {
    const updateDestination = () => {
      const current = session.current;
      if (!current?.active || current.mode !== 'pointer') return;
      const { items: currentItems, getId: identify } = latest.current;
      const fromIndex = currentItems.findIndex(item => identify(item) === current.id);
      if (fromIndex < 0) {
        finish(true);
        return;
      }
      let insertionIndex = currentItems.length;
      for (let index = 0; index < currentItems.length; index++) {
        const rect = rows.current.get(identify(currentItems[index]))?.getBoundingClientRect();
        if (rect && current.y < rect.top + rect.height / 2) {
          insertionIndex = index;
          break;
        }
      }
      current.toIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
      publish();
    };

    const scrollFrame = () => {
      const current = session.current;
      if (!current?.active || current.mode !== 'pointer') return;
      const scroller = current.scroller;
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const edge = Math.min(48, bounds.height / 4);
        let distance = 0;
        if (current.y < bounds.top + edge) distance = -Math.min(16, (bounds.top + edge - current.y) / 3);
        else if (current.y > bounds.bottom - edge) distance = Math.min(16, (current.y - bounds.bottom + edge) / 3);
        if (distance) {
          scroller.scrollTop += distance;
          updateDestination();
        }
      }
      animation.current = requestAnimationFrame(scrollFrame);
    };

    const pointerMove = event => {
      const current = session.current;
      if (current?.mode !== 'pointer' || current.pointerId !== event.pointerId) return;
      if (latest.current.disabled) {
        finish(true);
        return;
      }
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active) {
        if (Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
        current.active = true;
        setAnnouncement(`Moving ${current.name}. Release to place it, or press Escape to cancel.`);
        animation.current = requestAnimationFrame(scrollFrame);
      }
      event.preventDefault();
      updateDestination();
    };
    const pointerUp = event => {
      if (session.current?.mode === 'pointer' && session.current.pointerId === event.pointerId) finish();
    };
    const pointerCancel = event => {
      if (session.current?.pointerId === event.pointerId) finish(true);
    };
    const keyDown = event => {
      if (event.key === 'Escape' && session.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };
    const cancel = () => finish(true);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', cancel);
      cancelAnimationFrame(animation.current);
      session.current = null;
    };
  }, []);

  // Cancel a pending move if editing elsewhere removes or renames its identity.
  useEffect(() => {
    if (session.current && (disabled || !items.some(item => getId(item) === session.current.id))) finish(true);
  }, [items, getId, disabled]);

  const beginPointer = (event, item) => {
    if (disabled || items.length < 2 || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    if (session.current) finish(true);
    event.currentTarget.focus({ preventScroll: true });
    const id = getId(item);
    let scroller = listRef.current?.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    session.current = {
      mode: 'pointer', id, name: getLabel(item), active: false,
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
      toIndex: items.findIndex(candidate => getId(candidate) === id), scroller,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Blurring a rename input can replace its handle before capture occurs.
      // Window listeners still finish or cancel the move safely.
    }
  };

  const handleKey = (event, item) => {
    if (disabled || items.length < 2) return;
    const id = getId(item);
    const current = session.current;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (current?.mode === 'keyboard' && current.id === id) finish();
      else {
        if (current) finish(true);
        session.current = {
          mode: 'keyboard', id, name: getLabel(item), active: true,
          toIndex: items.findIndex(candidate => getId(candidate) === id),
        };
        publish();
        setAnnouncement(`Picked up ${getLabel(item)}. Use arrow keys to move, Space to place, or Escape to cancel.`);
      }
    } else if (event.key === 'Tab' && current?.mode === 'keyboard') {
      finish(true);
    } else if (current?.mode === 'keyboard' && current.id === id && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : current.toIndex + (event.key === 'ArrowUp' ? -1 : 1);
      current.toIndex = Math.max(0, Math.min(items.length - 1, next));
      publish();
      const target = items[current.toIndex];
      rows.current.get(getId(target))?.scrollIntoView({ block: 'nearest' });
      setAnnouncement(`${getLabel(item)}, position ${current.toIndex + 1} of ${items.length}.`);
    }
  };

  const sourceIndex = drag ? items.findIndex(item => getId(item) === drag.id) : -1;
  return (
    <div className={styles.list} ref={listRef} role="list" aria-label={label}>
      <span className={styles.srOnly} id={instructionsId}>
        Drag to reorder. With a keyboard, press Space to pick up, use arrow keys, then Space to place or Escape to cancel.
      </span>
      {items.map((item, index) => {
        const id = getId(item);
        const dropPosition = drag && drag.toIndex !== sourceIndex && index === drag.toIndex
          ? (drag.toIndex > sourceIndex ? 'after' : 'before') : undefined;
        const itemProps = {
          ref: node => { if (node) rows.current.set(id, node); else rows.current.delete(id); },
          role: 'listitem',
          'data-sortable-id': id,
          'data-dragging': drag?.id === id || undefined,
          'data-drop-position': dropPosition,
        };
        const dragHandle = (
          <button
            type="button"
            className={styles.handle}
            ref={node => { if (node) handles.current.set(id, node); else handles.current.delete(id); }}
            aria-label={`Reorder ${getLabel(item)}`}
            aria-describedby={instructionsId}
            aria-pressed={drag?.id === id}
            title={`Drag to reorder ${getLabel(item)}; keyboard: Space, arrows, Space`}
            disabled={disabled || items.length < 2}
            onPointerDown={event => beginPointer(event, item)}
            onKeyDown={event => handleKey(event, item)}
            onClick={event => event.preventDefault()}
          >
            <span aria-hidden="true">⠿</span>
          </button>
        );
        return <React.Fragment key={id}>{children(item, { itemProps, dragHandle, index })}</React.Fragment>;
      })}
      {drag?.mode === 'pointer' && (
        <div className={styles.preview} aria-hidden="true" style={{
          left: Math.min(drag.x + 12, window.innerWidth - 180),
          top: Math.min(drag.y + 12, window.innerHeight - 44),
        }}>{drag.name}</div>
      )}
      <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
}
