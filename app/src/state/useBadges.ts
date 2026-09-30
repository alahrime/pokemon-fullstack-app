import { useEffect, useMemo, useState } from 'react';
import { useChannelList } from './ChannelListContext';
import { useNotificationsContext } from './NotificationsContext';
import { useSession } from './SessionContext';
import { listFriends, type Friend } from '../lib/social';
import { myOffers, type MyOffer } from '../lib/matchmaking';
import { computeBadges, type Badges } from '../lib/badges';

const POLL_MS = 30_000;

/** Polled, like the chat dock's unread count — same cadence, same failure
 *  mode: a failed read leaves the last answer rather than clearing it. */
export function useBadges(): Badges {
  const { user } = useSession();
  const { totalUnread } = useChannelList();
  const { notices } = useNotificationsContext();
  const liveRounds = notices.filter((n) => n.kind === 'round' || n.kind === 'report' || n.kind === 'attention').length;
  const [data, setData] = useState<{ f: Friend[]; o: MyOffer[] }>({ f: [], o: [] });

  useEffect(() => {
    if (!user) {
      setData({ f: [], o: [] });
      return;
    }
    let live = true;
    const load = () =>
      void Promise.all([listFriends(), myOffers()])
        .then(([f, o]) => live && setData({ f, o }))
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [user]);

  return useMemo(
    () => (user ? computeBadges(data.f, data.o, user.id, totalUnread, liveRounds) : {}),
    [user, data, totalUnread, liveRounds],
  );
}
