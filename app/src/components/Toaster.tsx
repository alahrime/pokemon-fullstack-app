import { useEffect, useRef, useState } from 'react';
import { useNotificationsContext } from '../state/NotificationsContext';
import { useOpenNotice } from '../state/useNotifications';
import type { Notice } from '../lib/notifications';

const LIFE_MS = 6000;
const MAX = 3;

/** Transient toasts for notices that just arrived. */
export function Toaster() {
  const { fresh } = useNotificationsContext();
  const open = useOpenNotice();
  const [toasts, setToasts] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, number>());
  const drop = (id: string) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  };

  useEffect(() => {
    if (fresh.length === 0) return;
    setToasts((t) => [...t.filter((x) => !fresh.some((f) => f.id === x.id)), ...fresh].slice(-MAX));
    for (const n of fresh) {
      window.clearTimeout(timers.current.get(n.id));
      timers.current.set(n.id, window.setTimeout(() => drop(n.id), LIFE_MS));
    }
  }, [fresh]);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((id) => window.clearTimeout(id));
  }, []);

  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((n) => (
        <div key={n.id} className="toast" role="status">
          <button
            type="button"
            className="toast-body"
            onClick={() => { open(n); drop(n.id); }}
          >
            <span className="notification-item-title">{n.title}</span>
            <span className="notification-item-detail">{n.detail}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
