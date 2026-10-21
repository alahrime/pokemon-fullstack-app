import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from './SessionContext';
import { isChannelUnread, listChannelsWithActivity, withDisplayNames, type ChannelDisplay } from '../lib/channels';
import { subscribeToTables } from '../lib/realtime';
import { joinPresence } from '../lib/presence';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The fallback for a dropped socket. A new message anywhere the viewer can read refreshes the list at once through
 * one table-wide Realtime subscription (`subscribeToTables`), not one per channel; see `ChatDock`'s doc comment.
 * Each refresh is still one `listChannelsWithActivity` plus `withDisplayNames`, regardless of channel count.
 */
export const POLL_MS = 60_000;

interface ChannelListValue {
  channels: ChannelDisplay[] | null;
  loadError: string | null;
  refresh: () => void;
  bumpActivity: (id: string, at: string, preview?: { body: string; authorId: string }) => void;
  bumpRead: (id: string, at: string) => void;
  totalUnread: number;
}

const ChannelListContext = createContext<ChannelListValue | null>(null);

/**
 * The one shared, live channel list: the dock, the Chat screen and the bell
 * all read it, so they share one poll rather than each running the same three
 * queries. Mounted inside `SessionProvider` (it keys the poll on `user`).
 */
export function ChannelListProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [channels, setChannels] = useState<ChannelDisplay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listChannelsWithActivity()
      .then((cs) => withDisplayNames(cs))
      .then((cs) => {
        setChannels(cs);
        setLoadError(null);
      })
      .catch((e) => setLoadError(messageOf(e)));
  }, []);

  useEffect(() => {
    if (!user) {
      setChannels(null);
      return;
    }
    refresh();
    const stop = subscribeToTables(['messages'], refresh);
    // Presence rides along with the list: both live exactly as long as a session does.
    const leave = joinPresence(user.id);
    const id = setInterval(refresh, POLL_MS);
    return () => { stop(); leave(); clearInterval(id); };
  }, [user, refresh]);

  // Optimistic local bumps so a pane's own traffic moves the rail before the
  // next poll, rather than only ever changing what it shows once every `POLL_MS`.
  const bumpActivity = useCallback((id: string, at: string, preview?: { body: string; authorId: string }) => {
    setChannels((prev) =>
      prev
        // Every bump counts as unread until a `bumpRead` covers it — a pane's own send and an open pane's receipt both
        // follow with one at once; the next refresh recounts from the server either way.
        ? prev.map((c) => (c.id === id && (!c.lastMessageAt || at > c.lastMessageAt) ? { ...c, lastMessageAt: at, lastPreview: preview ?? null, unreadCount: (c.unreadCount ?? 0) + 1 } : c))
        : prev,
    );
  }, []);
  const bumpRead = useCallback((id: string, at: string) => {
    setChannels((prev) =>
      prev
        ? prev.map((c) => (c.id === id && (!c.lastReadAt || at > c.lastReadAt)
          ? { ...c, lastReadAt: at, unreadCount: c.lastMessageAt && c.lastMessageAt > at ? c.unreadCount : 0 }
          : c))
        : prev,
    );
  }, []);

  const totalUnread = useMemo(() => (channels ?? []).filter(isChannelUnread).length, [channels]);

  const value = useMemo(
    () => ({ channels, loadError, refresh, bumpActivity, bumpRead, totalUnread }),
    [channels, loadError, refresh, bumpActivity, bumpRead, totalUnread],
  );
  return <ChannelListContext.Provider value={value}>{children}</ChannelListContext.Provider>;
}

export function useChannelList(): ChannelListValue {
  const ctx = useContext(ChannelListContext);
  if (!ctx) throw new Error('useChannelList must be used within ChannelListProvider');
  return ctx;
}
