import type { Screen } from '../state/AppState';
import type { Challenge } from './challenges';
import { isChannelUnread, type ChannelDisplay } from './channels';
import type { Friend } from './social';

export interface Notice {
  id: string;
  kind: 'message' | 'challenge' | 'confirm' | 'friend';
  title: string;
  detail: string;
  target: { screen: Screen; channelId?: string };
}

const live = (c: Challenge, now: Date) => new Date(c.expiresAt) > now;

/** What needs the viewer's attention right now. Pure. */
export function buildNotices(i: {
  channels: ChannelDisplay[];
  challenges: Challenge[];
  friends: Friend[];
  me: string;
  now: Date;
}): Notice[] {
  const name = (id: string) => i.channels.find((c) => c.otherId === id)?.displayTitle ?? 'Someone';
  const cc: Notice[] = [];
  for (const c of i.challenges) {
    if (!live(c, i.now)) continue;
    if (c.state === 'open' && c.targetId === i.me) {
      const dm = i.channels.find((x) => x.otherId === c.proposerId);
      cc.push({
        id: 'co:' + c.id, kind: 'challenge', title: name(c.proposerId), detail: 'Challenged you to a match',
        target: dm ? { screen: 'chat', channelId: dm.id } : { screen: 'chat' },
      });
    } else if (c.state === 'accepted' && c.proposerId === i.me) {
      const dm = i.channels.find((x) => x.otherId === c.targetId);
      cc.push({
        id: 'cc:' + c.id, kind: 'confirm', title: name(c.targetId), detail: 'Accepted — confirm to lock it in',
        target: dm ? { screen: 'chat', channelId: dm.id } : { screen: 'chat' },
      });
    }
  }
  const friends: Notice[] = i.friends
    .filter((f) => f.status === 'pending' && f.theyAsked)
    .map((f) => ({
      id: 'fr:' + f.otherId, kind: 'friend', title: name(f.otherId), detail: 'Friend request',
      target: { screen: 'friends' },
    }));
  const messages: Notice[] = i.channels.filter(isChannelUnread).map((c) => ({
    id: 'ch:' + c.id, kind: 'message', title: c.displayTitle, detail: 'New message',
    target: { screen: 'chat', channelId: c.id },
  }));
  return [...cc, ...friends, ...messages];
}
