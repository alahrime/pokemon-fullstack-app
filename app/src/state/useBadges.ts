import { useEffect, useState } from 'react';
import { useSession } from './SessionContext';
import { listFriends } from '../lib/social';
import { myOffers } from '../lib/matchmaking';
import { computeBadges, type Badges } from '../lib/badges';

const POLL_MS = 30_000;

/** Polled, like the chat dock's unread count — same cadence, same failure
 *  mode: a failed read leaves the last answer rather than clearing it. */
export function useBadges(): Badges {
  const { user } = useSession();
  const [badges, setBadges] = useState<Badges>({});

  useEffect(() => {
    if (!user) {
      setBadges({});
      return;
    }
    let live = true;
    const load = () =>
      void Promise.all([listFriends(), myOffers()])
        .then(([f, o]) => live && setBadges(computeBadges(f, o, user.id)))
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [user]);

  return badges;
}
