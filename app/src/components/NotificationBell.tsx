import { useEffect, useId, useRef, useState } from 'react';
import { useNotificationsContext } from '../state/NotificationsContext';
import { useOpenNotice } from '../state/useNotifications';

/** The bell: a trigger plus an overlay list, mirroring `ThemeMenu`. */
export function NotificationBell() {
  const { notices } = useNotificationsContext();
  const open = useOpenNotice();
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShown(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setShown(false);
    };
    document.addEventListener('keydown', onKey);
    // Deferred, so the click that opened this does not immediately close it.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [shown]);

  return (
    <div className="notification-bell" ref={box}>
      <button
        type="button"
        className={`btn notification-bell-btn${shown ? ' is-open' : ''}`}
        aria-label={notices.length > 0 ? `Notifications, ${notices.length} waiting` : 'Notifications'}
        title="Notifications"
        aria-expanded={shown}
        aria-controls={panelId}
        onClick={() => setShown((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {notices.length > 0 && (
          <span className="notification-count" aria-hidden="true">
            {notices.length}
          </span>
        )}
      </button>
      {shown && (
        <div className="notification-panel" id={panelId} role="menu" aria-label="Notifications">
          {notices.length === 0 ? (
            <div className="notification-empty">You're all caught up</div>
          ) : (
            notices.map((n) => (
              <button
                key={n.id}
                type="button"
                role="menuitem"
                className="notification-item"
                onClick={() => { open(n); setShown(false); }}
              >
                <span className="notification-item-title">{n.title}</span>
                <span className="notification-item-detail">{n.detail}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
