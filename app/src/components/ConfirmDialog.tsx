import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

export interface ConfirmOptions {
  title: string;
  /** What happens if they go ahead, in a sentence or two. */
  body: string;
  /** Names the action ("Delete team"), never a bare "OK". */
  confirmLabel: string;
  cancelLabel?: string;
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', onDone }: ConfirmOptions & { onDone: (ok: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Focus lands on Cancel: Enter or a stray double-click must not destroy anything.
    cancel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [onDone]);
  return (
    <div className="modal-scrim confirm-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false); }}>
      <div className="modal-panel confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <div className="modal-head">
          <span className="hud-label" id="confirm-title">{title}</span>
        </div>
        <p className="confirm-body" id="confirm-body">{body}</p>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" ref={cancel} onClick={() => onDone(false)}>{cancelLabel}</button>
          <button type="button" className="btn btn-primary" onClick={() => onDone(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The app's "are you sure?" for anything that removes a team. Resolves true only on the named action; Cancel,
 * Escape and a click outside all resolve false. Mounted in its own root on <body> so any handler can await it
 * without threading state through the screen — the drop-in for `window.confirm`, which renders as browser chrome
 * and is easy to wave through.
 */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      // Unmounted after the click that answered it has finished, not from inside it.
      queueMicrotask(() => { root.unmount(); host.remove(); });
    };
    root.render(<ConfirmDialog {...o} onDone={done} />);
  });
}
