import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearOrder, loadOrder, reorder, saveOrder } from '../lib/layout';

/**
 * A stack of panels the user can reorder, with the order persisted.
 *
 * Blocks are passed as data rather than as children, so the board can reorder
 * them without introspecting the element tree — reading ids off `children` is
 * the kind of thing that works until someone wraps a panel in a fragment.
 *
 * Two ways to move a panel, deliberately:
 *
 *   drag      the obvious one, and the one that feels like the product
 *   arrows    the one that works with a keyboard, on a touchpad someone finds
 *             fiddly, and with a screen reader
 *
 * Drag alone would have made the feature unusable for anyone who cannot
 * comfortably drag, and it is the same two lines of state either way.
 *
 * Reordering only exists in edit mode. A page whose panels shuffle whenever a
 * click lands slightly wrong is worse than one that cannot be rearranged at
 * all, so the drag affordance is off until asked for.
 */

export interface Block {
  /** Stable across releases — this is what gets persisted. */
  id: string;
  /** Shown on the drag handle in edit mode, and to screen readers. */
  label: string;
  node: ReactNode;
}

export function Board({
  storageKey,
  blocks,
  editing,
  className,
}: {
  storageKey: string;
  blocks: Block[];
  editing: boolean;
  className?: string;
}) {
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const [order, setOrder] = useState<string[]>(() => loadOrder(storageKey, ids));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Reconcile when the set of panels changes (a viz switch adds or removes
  // one). Comparing joined ids keeps this from firing on every render.
  const idKey = ids.join('|');
  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(ids);
      const kept = prev.filter((id) => known.has(id));
      const missing = ids.filter((id) => !kept.includes(id));
      for (const id of missing) kept.splice(ids.indexOf(id), 0, id);
      return kept.join('|') === prev.join('|') ? prev : kept;
    });
  }, [idKey, ids]);

  const commit = useCallback(
    (next: string[]) => {
      setOrder(next);
      saveOrder(storageKey, next);
    },
    [storageKey],
  );

  const move = useCallback(
    (id: string, delta: number) => {
      const from = order.indexOf(id);
      commit(reorder(order, from, Math.max(0, Math.min(order.length - 1, from + delta))));
    },
    [order, commit],
  );

  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const ordered = order.map((id) => byId.get(id)).filter((b): b is Block => !!b);

  /**
   * Auto-scroll while dragging near a viewport edge.
   *
   * HTML5 drag and drop does not scroll the page reliably, and this board sits
   * under a sticky nav — so a panel taller than the viewport could not be
   * dragged past its own height, and a drop target hidden under the nav could
   * not be reached at all. Both were reported as "arrange does not work", which
   * is accurate: the interaction was unfinishable, not merely awkward.
   *
   * `dragover` fires irregularly and stops entirely when the pointer is still,
   * so the scrolling runs on its own timer and the event only records where the
   * pointer is. That also makes a held-at-the-edge drag keep scrolling, which
   * is what every other sortable list does.
   *
   * A timer rather than requestAnimationFrame, deliberately: several browsers
   * suspend rAF for the duration of an HTML5 drag, which is precisely when this
   * needs to run. An interval keeps ticking, and at 16ms the motion is
   * indistinguishable.
   *
   * The top edge zone starts BELOW the sticky nav, measured rather than
   * hardcoded: the nav wraps to two rows on a narrow viewport, so a constant
   * would be wrong exactly when the screen is smallest.
   */
  const pointerY = useRef<number | null>(null);
  useEffect(() => {
    if (!editing || !dragId) return;
    const EDGE = 110;
    const MAX_SPEED = 22;
    let timer = 0;

    const navBottom = () => {
      const nav = document.querySelector('.nav');
      return nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
    };
    const onDragOver = (e: DragEvent) => { pointerY.current = e.clientY; };
    const step = () => {
      const y = pointerY.current;
      if (y !== null) {
        const top = navBottom();
        let dy = 0;
        if (y < top + EDGE) dy = -((top + EDGE - y) / EDGE) * MAX_SPEED;
        else if (y > window.innerHeight - EDGE) dy = ((y - (window.innerHeight - EDGE)) / EDGE) * MAX_SPEED;
        if (dy) window.scrollBy(0, dy);
      }
    };

    window.addEventListener('dragover', onDragOver);
    timer = window.setInterval(step, 16);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.clearInterval(timer);
      pointerY.current = null;
    };
  }, [editing, dragId]);

  const onDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) return;
      commit(reorder(order, order.indexOf(dragId), order.indexOf(targetId)));
      setDragId(null);
      setOverId(null);
    },
    [dragId, order, commit],
  );

  return (
    <div className={`board${editing ? ' is-editing' : ''}${className ? ' ' + className : ''}`}>
      {ordered.map((b, i) => (
        <section
          key={b.id}
          className={`board-slot${dragId === b.id ? ' is-dragging' : ''}${overId === b.id && dragId !== b.id ? ' is-over' : ''}`}
          draggable={editing}
          onDragStart={(e) => {
            setDragId(b.id);
            e.dataTransfer.effectAllowed = 'move';
            // Firefox will not start a drag without data set.
            e.dataTransfer.setData('text/plain', b.id);
          }}
          onDragEnd={() => { setDragId(null); setOverId(null); }}
          onDragOver={(e) => { if (editing && dragId) { e.preventDefault(); setOverId(b.id); } }}
          onDragLeave={() => setOverId((o) => (o === b.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); onDrop(b.id); }}
        >
          {editing && (
            <div className="board-grip">
              <span className="board-grip-dots" aria-hidden="true" />
              <span className="board-grip-label">{b.label}</span>
              <span className="board-grip-pos numeric">{i + 1}/{ordered.length}</span>
              <button
                className="btn btn-sm board-grip-btn"
                disabled={i === 0}
                onClick={() => move(b.id, -1)}
                aria-label={`Move ${b.label} up`}
                title="Move up"
              >
                ↑
              </button>
              <button
                className="btn btn-sm board-grip-btn"
                disabled={i === ordered.length - 1}
                onClick={() => move(b.id, 1)}
                aria-label={`Move ${b.label} down`}
                title="Move down"
              >
                ↓
              </button>
            </div>
          )}
          <div className="board-body">{b.node}</div>
        </section>
      ))}
    </div>
  );
}

/**
 * The edit toggle and its reset, kept next to the board it drives.
 *
 * Reset clears the stored order rather than writing the default back, so a
 * later release that changes the default is picked up instead of being
 * permanently overridden by a layout someone reset once.
 */
export function BoardControls({
  storageKey,
  editing,
  onEditing,
  onReset,
}: {
  storageKey: string;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="board-controls" ref={ref}>
      {editing && (
        <button
          className="btn btn-sm"
          onClick={() => { clearOrder(storageKey); onReset(); }}
          title="Restore the default panel order"
        >
          Reset
        </button>
      )}
      <button
        className={`btn btn-sm board-edit-btn${editing ? ' is-on' : ''}`}
        onClick={() => onEditing(!editing)}
        title={editing ? 'Stop rearranging' : 'Drag panels into the order you want'}
      >
        {editing ? 'Done' : 'Arrange'}
      </button>
    </div>
  );
}
