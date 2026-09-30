import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from './AppState';
import { useChannelList } from './ChannelListContext';
import { useChatDockRequest } from './ChatDockContext';
import { useSession } from './SessionContext';
import { myChallenges, type Challenge } from '../lib/challenges';
import { resolveDisplayNames } from '../lib/channels';
import { myTournamentActivity, type Pairing, type Tournament } from '../lib/tournaments';
import { listFriends, type Friend } from '../lib/social';
import { buildNotices, type Notice } from '../lib/notifications';

const POLL_MS = 15_000;
const NONE: Notice[] = [];

/** Polled like `useBadges`: a failed read keeps the last answer. `fresh` is
 *  what appeared since the previous evaluation, and only once everything has
 *  loaded once — so opening the app does not toast the backlog. */
export function useNotifications(): { notices: Notice[]; fresh: Notice[] } {
  const { user } = useSession();
  const { channels } = useChannelList();
  const [data, setData] = useState<{ c: Challenge[]; f: Friend[]; t: Tournament[]; p: Pairing[]; j: string[]; names: Map<string, string> } | null>(null);
  const [fresh, setFresh] = useState<Notice[]>(NONE);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }
    const me = user.id;
    let live = true;
    const load = () =>
      void Promise.all([myChallenges(), listFriends(), myTournamentActivity()])
        .then(async ([c, f, a]) => {
          // Only opponents in games of mine are named; a failed lookup falls back to "Someone".
          const opp = a.pairings.flatMap((p) => (p.playerA === me ? [p.playerB] : p.playerB === me ? [p.playerA] : [])).filter((x): x is string => !!x);
          const names = await resolveDisplayNames(opp).catch(() => new Map<string, string>());
          if (live) setData({ c, f, t: a.tournaments, p: a.pairings, j: a.judgeOf, names });
        })
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [user]);

  const notices = useMemo(
    () => (user ? buildNotices({ channels: channels ?? [], challenges: data?.c ?? [], friends: data?.f ?? [], me: user.id, now: new Date(), tournaments: data?.t, pairings: data?.p, judgeOf: data?.j, names: data?.names }) : NONE),
    [user, channels, data],
  );

  const loaded = !!user && !!data && channels !== null;
  useEffect(() => {
    if (!loaded) {
      seen.current = null;
      setFresh(NONE);
      return;
    }
    const prev = seen.current;
    seen.current = new Set(notices.map((n) => n.id));
    setFresh(prev ? notices.filter((n) => !prev.has(n.id)) : NONE);
  }, [loaded, notices]);

  return { notices, fresh };
}

/** Navigate to a notice's target, opening its channel in the dock for chat. */
export function useOpenNotice(): (n: Notice) => void {
  const { patch } = useAppState();
  const { requestChannel } = useChatDockRequest();
  return useCallback(
    (n: Notice) => {
      patch(n.target.tournamentId ? { screen: n.target.screen, activeTournamentId: n.target.tournamentId } : { screen: n.target.screen });
      if (n.target.screen === 'chat' && n.target.channelId) requestChannel(n.target.channelId);
    },
    [patch, requestChannel],
  );
}
