import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from './SessionContext';
import { isChannelUnread, listChannelsWithActivity, withDisplayNames, type ChannelDisplay } from '../lib/channels';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * How long a closed conversation can sit before the rail notices a new
 * message in it. The list is polled (one `listChannelsWithActivity` plus
 * `withDisplayNames`, regardless of channel count) rather than subscribed
 * per channel; see `ChatDock`'s doc comment for why.
 */
export const POLL_MS = 15_000;

interface ChannelListValue {
  channels: ChannelDisplay[] | null;
  loadError: string | null;
  refresh: () => void;
  bumpActivity: (id: string, at: string) => void;
  bumpRead: (id: string, at: string) => void;
  totalUnread: number;
}

const ChannelListContext = createContext<ChannelListValue | null>(null);

/**
 * The one shared, polled channel list: the dock, the Chat screen and the bell
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
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [user, refresh]);

  // Optimistic local bumps so a pane's own traffic moves the rail before the
  // next poll, rather than only ever changing what it shows once every `POLL_MS`.
  const bumpActivity = useCallback((id: string, at: string) => {
    setChannels((prev) =>
      prev
        ? prev.map((c) => (c.id === id && (!c.lastMessageAt || at > c.lastMessageAt) ? { ...c, lastMessageAt: at } : c))
        : prev,
    );
  }, []);
  const bumpRead = useCallback((id: string, at: string) => {
    setChannels((prev) =>
      prev ? prev.map((c) => (c.id === id && (!c.lastReadAt || at > c.lastReadAt) ? { ...c, lastReadAt: at } : c)) : prev,
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
