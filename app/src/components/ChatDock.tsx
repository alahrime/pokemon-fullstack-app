import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { useChatDockRequest } from '../state/ChatDockContext';
import {
  humanTime,
  isChannelUnread,
  listChannelsWithActivity,
  withDisplayNames,
  type ChannelDisplay,
} from '../lib/channels';
import { ChatPane } from './ChatPane';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Kind → the plain word the rail's mono sub-line names it by, matching the
 * approved design canvas (`match · 19:04`, `group · 4 people`,
 * `direct · yesterday`). */
function kindWord(kind: ChannelDisplay['kind']): string {
  if (kind === 'match') return 'match';
  if (kind === 'group') return 'group';
  return 'direct';
}

/**
 * The rail row's mono sub-line: the kind, then either a human time (a `dm` or
 * `match`, which has no more useful second fact) or a member count (a
 * `group`, for which "4 people" says more than when the last message
 * landed — the approved design canvas's own call). Never the raw ISO string
 * `lastMessageAt` actually is.
 */
function subLine(c: ChannelDisplay): string {
  const kind = kindWord(c.kind);
  if (c.kind === 'group') {
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
function railAriaLabel(c: ChannelDisplay, unread: boolean): string {
  return `Open chat with ${c.displayTitle}${unread ? ', 1 unread' : ''}`;
}

/**
 * How long a closed conversation can sit before the rail notices a new
 * message in it. See this file's own doc comment on `ChatDock` for why this,
 * rather than a Realtime subscription per channel, is what drives it.
 */
const POLL_MS = 15_000;

/**
 * The persistent Messenger-style dock: a rail of every conversation this
 * viewer is in, anchored bottom-right on every screen, plus zero or more
 * panes opened from it sitting to its left.
 *
 * Mounted once in `App.tsx`, as a SIBLING of the `key={state.screen}` div
 * that remounts on every navigation — not inside it. That placement is the
 * one thing this whole component depends on: a dock mounted inside the
 * remounting subtree would lose every open pane, every draft, and every live
 * `subscribeToChannel` the instant the user clicked a different nav tab,
 * which defeats the entire product point of a dock that "rides on top of
 * whatever page you are on".
 *
 * Gated on `useSession().user` and returns `null` — not an empty shell — for
 * a signed-out visitor. `FriendsScreen` made the empty-shell mistake once
 * already (see its own doc comment); a persistent dock present on every
 * screen would repeat it on every screen at once if it rendered so much as
 * its own header while signed out.
 *
 * **Unread counts and the N+1 this avoids.** `listChannels()` already
 * returns each channel's `lastReadAt`; the one fact still missing is when the
 * last message in each one landed. `listChannelsWithActivity()`
 * (`lib/channels.ts`) answers that with ONE extra query for every channel at
 * once — `channel_id, created_at` for all of them, reduced client-side to a
 * `Map` of the latest per id — rather than a query per row, which is the
 * shape that would have made the rail's cost scale with how many
 * conversations someone is in.
 *
 * **How the rail learns about messages in a channel with no open pane.**
 * Each open `ChatPane` already runs its own `subscribeToChannel` for its own
 * transcript (required so panes update live, and covered by the "teardown is
 * idempotent" tests on `subscribeToChannel` itself) — but that only reaches
 * channels someone has actually opened a pane for. Extending the same
 * "subscribe to every channel" idea to the whole rail was the obvious next
 * step and was deliberately NOT taken: it means one live Realtime
 * subscription per conversation this viewer is in, all the time, on every
 * screen, whether or not anyone is looking at any of them — a cost that
 * grows with the size of someone's friend list and match history rather than
 * with how many conversations are actually open. Instead the rail polls
 * `listChannelsWithActivity()` on a fixed interval (`POLL_MS`), which costs
 * exactly one query regardless of how many channels exist. `ChatPane`
 * narrows that gap for anything already open: it reports every message it
 * sends or receives, and every successful `markRead`, back up through
 * `onActivity`/`onRead` below, so a conversation you have a pane open on
 * updates its badge immediately rather than waiting out the next poll — only
 * a channel with NO open pane ever waits the full `POLL_MS`.
 *
 * **Names, not uuids.** `withDisplayNames()` (`lib/channels.ts`) runs after
 * every `listChannelsWithActivity()` call — on the initial load and on every
 * `POLL_MS` refresh alike — and attaches a human `displayTitle` (a `dm`'s or
 * `match`'s other member, or a `group`'s own title) plus, for a `group`, a
 * `memberCount`. It costs exactly two more queries per refresh, same as
 * `listChannelsWithActivity`'s own extra query above: one `IN` query across
 * every channel's members, one more across the distinct set of names that
 * turns up — never a query per row. See its own doc comment for the RLS
 * facts that make this safe to run for someone else's member rows.
 */
export function ChatDock() {
  const { user } = useSession();
  const { requestedMatchId, clearRequestedMatchChannel } = useChatDockRequest();
  const [channels, setChannels] = useState<ChannelDisplay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());

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

  const openChannel = useCallback((id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setMinimizedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const closeChannel = useCallback((id: string) => {
    setOpenIds((prev) => prev.filter((x) => x !== id));
    setMinimizedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // `MatchScreen`'s "Open match chat" button, several components away in the
  // remounting screen tree, reaches this instance through `ChatDockContext`
  // rather than a prop — see that context's own doc comment. Waits for
  // `channels` to actually carry the match's channel (it may not have loaded
  // yet, or the poll that will carry it may not have landed) before acting,
  // and only clears the request once it has, so a request made before the
  // list loads is not silently dropped.
  useEffect(() => {
    if (!requestedMatchId || !channels) return;
    const match = channels.find((c) => c.kind === 'match' && c.matchId === requestedMatchId);
    if (match) {
      openChannel(match.id);
      clearRequestedMatchChannel();
    }
  }, [requestedMatchId, channels, openChannel, clearRequestedMatchChannel]);

  // Optimistic local bumps so a pane's own traffic (see this file's doc
  // comment above) moves the rail before the next poll, rather than only
  // ever changing what the rail shows once every `POLL_MS`.
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

  if (!user) return null;

  return (
    <div className="chat-dock">
      <div className="chat-dock-panes">
        {openIds.map((id) => {
          const c = channels?.find((x) => x.id === id);
          if (!c) return null;
          return (
            <ChatPane
              key={id}
              channel={c}
              minimized={minimizedIds.has(id)}
              onToggleMinimize={() => toggleMinimize(id)}
              onClose={() => closeChannel(id)}
              onActivity={bumpActivity}
              onRead={bumpRead}
            />
          );
        })}
      </div>

      <section className="chat-rail chamfer-9 panel" aria-label="Chat">
        <div className="chat-rail-header">
          <span className="hud-label">Chat</span>
          {totalUnread > 0 && (
            <span className="chat-rail-badge" aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? '' : 's'}`}>
              {totalUnread}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost chamfer-5 chat-rail-toggle"
            aria-expanded={!railCollapsed}
            aria-label={railCollapsed ? 'Expand chat list' : 'Collapse chat list'}
            onClick={() => setRailCollapsed((v) => !v)}
          >
            {railCollapsed ? '▴' : '▾'}
          </button>
        </div>

        {loadError && (
          <p className="friend-notice" role="alert">
            {loadError}
          </p>
        )}

        {!railCollapsed && (
          <ul className="chat-rail-list">
            {(channels ?? []).length === 0 && <li className="text-muted">No conversations yet.</li>}
            {(channels ?? []).map((c) => {
              const unread = isChannelUnread(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`chat-rail-row${openIds.includes(c.id) ? ' is-open' : ''}`}
                    data-kind={c.kind}
                    aria-label={railAriaLabel(c, unread)}
                    onClick={() => openChannel(c.id)}
                  >
                    <span className="chat-rail-title">{c.displayTitle}</span>
                    <span className="chat-rail-sub text-faint">{subLine(c)}</span>
                    {unread && (
                      <span className="chat-rail-unread-tag" aria-hidden="true">
                        Unread
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
