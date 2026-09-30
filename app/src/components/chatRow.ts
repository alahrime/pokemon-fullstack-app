import { humanTime, type ChannelDisplay } from '../lib/channels';

/** Kind → the plain word the rail's mono sub-line names it by, matching the
 * approved design canvas (`match · 19:04`, `group · 4 people`,
 * `direct · yesterday`). */
export function kindWord(kind: ChannelDisplay['kind']): string {
  if (kind === 'match') return 'match';
  if (kind === 'group') return 'group';
  if (kind === 'tournament') return 'tournament';
  return 'direct';
}

/**
 * The rail row's mono sub-line: the kind, then either a human time (a `dm` or
 * `match`, which has no more useful second fact) or a member count (a
 * `group`, for which "4 people" says more than when the last message
 * landed — the approved design canvas's own call). Never the raw ISO string
 * `lastMessageAt` actually is.
 */
export function subLine(c: ChannelDisplay): string {
  const kind = kindWord(c.kind);
  if (c.kind === 'group' || c.kind === 'tournament') {
    const n = c.memberCount ?? 0;
    return `${kind} · ${n === 1 ? '1 person' : `${n} people`}`;
  }
  return c.lastMessageAt ? `${kind} · ${humanTime(c.lastMessageAt)}` : `${kind} · no messages yet`;
}

/**
 * The rail button's whole accessible name — short and specific, never the
 * concatenation of every text node inside it (title, sub-line and the
 * "Unread" tag all read together, which is what an unlabelled button would
 * otherwise expose to a screen reader's rotor).
 */
export function railAriaLabel(c: ChannelDisplay, unread: boolean): string {
  return `Open chat with ${c.displayTitle}${unread ? ', 1 unread' : ''}`;
}
