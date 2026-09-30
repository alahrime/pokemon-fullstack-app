import type { Screen } from '../state/AppState';
import type { Challenge } from './challenges';
import { isChannelUnread, type ChannelDisplay } from './channels';
import type { Friend } from './social';
import { isCounted, type Pairing, type Tournament } from './tournaments';

export interface Notice {
  id: string;
  kind: 'message' | 'challenge' | 'confirm' | 'friend' | 'round' | 'report' | 'attention';
  title: string;
  detail: string;
  target: { screen: Screen; channelId?: string; tournamentId?: string };
}

const live = (c: Challenge, now: Date) => new Date(c.expiresAt) > now;

/** What needs the viewer's attention right now. Pure. */
export function buildNotices(i: {
  channels: ChannelDisplay[];
  challenges: Challenge[];
  friends: Friend[];
  me: string;
  now: Date;
  tournaments?: Tournament[];
  /** The viewer's own current-round pairings, plus every one in tournaments they run. */
  pairings?: Pairing[];
  judgeOf?: string[];
  /** Opponent display names, resolved by the poll. */
  names?: Map<string, string>;
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
  const { me, now } = i;
  const who = (id: string) => i.names?.get(id) ?? 'Someone';
  const running = new Map((i.tournaments ?? []).filter((t) => t.state === 'running').map((t) => [t.id, t]));
  const attention: Notice[] = [];
  const play: Notice[] = [];
  const report: Notice[] = [];
  for (const t of running.values()) {
    if (!(t.organiserId === me || i.judgeOf?.includes(t.id)) || !t.roundEndsAt || now < new Date(t.roundEndsAt)) continue;
    const n = (i.pairings ?? []).filter(
      (p) => p.tournamentId === t.id && p.round === t.currentRound && p.playerB !== null
        && p.playerA !== me && p.playerB !== me && !isCounted(p, now),
    ).length;
    if (n) attention.push({
      id: `ta:${t.id}:${t.currentRound}`, kind: 'attention', title: t.title,
      detail: n === 1 ? '1 pairing needs attention' : `${n} pairings need attention`,
      target: { screen: 'tournaments', tournamentId: t.id },
    });
  }
  for (const p of i.pairings ?? []) {
    const t = p.tournamentId ? running.get(p.tournamentId) : undefined;
    if (!t || p.round !== t.currentRound || p.playerB === null || (p.playerA !== me && p.playerB !== me)) continue;
    const opp = who(p.playerA === me ? p.playerB : p.playerA);
    const target = { screen: 'tournaments' as const, tournamentId: t.id };
    if (p.state === 'pending') play.push({ id: 'tr:' + p.id, kind: 'round', title: t.title, detail: `Round ${p.round}: you play ${opp}`, target });
    else if (p.state === 'reported' && p.reportedBy !== me && (!p.finalAt || new Date(p.finalAt) > now)) {
      report.push({ id: 'tp:' + p.id, kind: 'report', title: t.title, detail: `${opp} reported — confirm or dispute`, target });
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
  // Actionable first (attention, challenge, confirm, report, round), then friends, then messages.
  return [...attention, ...cc, ...report, ...play, ...friends, ...messages];
}
