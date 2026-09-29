import type { Screen } from '../state/AppState';
import type { Friend } from './social';
import type { MyOffer } from './matchmaking';

export type Badges = Partial<Record<Screen, number>>;

/** What is waiting on ME, per rail item. Zeros are left out. */
export function computeBadges(friends: Friend[], offers: MyOffer[], me: string, unreadChannels = 0): Badges {
  const requests = friends.filter((x) => x.status === 'pending' && x.theyAsked).length;
  const toConfirm = offers.filter(
    (x) => x.proposerId === me && x.state === 'accepted' && x.matchId === null,
  ).length;
  const out: Badges = {};
  if (requests) out.friends = requests;
  if (toConfirm) out.matchmaking = toConfirm;
  if (unreadChannels) out.chat = unreadChannels;
  return out;
}
