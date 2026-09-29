import { createContext, useContext, type ReactNode } from 'react';
import { useNotifications } from './useNotifications';

type Value = ReturnType<typeof useNotifications>;
const NotificationsContext = createContext<Value | null>(null);

/** Runs the notification poll once; the bell and the toaster both read it. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  return <NotificationsContext.Provider value={useNotifications()}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsContext(): Value {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotificationsContext must be used within NotificationsProvider');
  return ctx;
}
