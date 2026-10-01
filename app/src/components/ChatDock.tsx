import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { useAppState } from '../state/AppState';
import { useChatDockRequest } from '../state/ChatDockContext';
import { useChannelList } from '../state/ChannelListContext';
import { isChannelUnread } from '../lib/channels';
import { railAriaLabel, subLine } from './chatRow';
import { ChatPane } from './ChatPane';
import { ChallengeSheet } from './ChallengeSheet';

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
 * `listChannelsWithActivity()` on a fixed interval (`POLL_MS`, in `ChannelListContext`), which costs
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
  const { requestedMatchId, clearRequestedMatchChannel, requestedChannelId, clearRequestedChannel } =
    useChatDockRequest();
  const [challengeTarget, setChallengeTarget] = useState<{ id: string; name: string } | null>(null);
  const { channels, loadError, refresh, bumpActivity, bumpRead, totalUnread } = useChannelList();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());

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
  // On the Chat screen the screen itself owns requests (it consumes
  // `requestedChannelId`), so the dock stands down entirely there.
  const { state } = useAppState();
  const onChat = state.screen === 'chat';
  useEffect(() => {
    if (onChat || !requestedMatchId || !channels) return;
    const match = channels.find((c) => c.kind === 'match' && c.matchId === requestedMatchId);
    if (match) {
      openChannel(match.id);
      clearRequestedMatchChannel();
    }
  }, [onChat, requestedMatchId, channels, openChannel, clearRequestedMatchChannel]);

  // The generic sibling: a caller that already holds a channel id (the
  // challenge sheet, right after `openDm`). A just-created DM is not in the
  // last poll, so when the id is absent from a loaded list, refresh once and
  // keep the request until it turns up. The refresh is keyed on the request
  // alone, so a channel that never appears cannot loop it.
  useEffect(() => {
    if (!onChat && requestedChannelId) refresh();
  }, [onChat, requestedChannelId, refresh]);
  useEffect(() => {
    if (onChat || !requestedChannelId || !channels) return;
    if (channels.some((c) => c.id === requestedChannelId)) {
      openChannel(requestedChannelId);
      clearRequestedChannel();
    }
  }, [onChat, requestedChannelId, channels, openChannel, clearRequestedChannel]);

  if (!user || onChat) return null;

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
              onChallenge={setChallengeTarget}
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
                    <span className="chat-rail-title max-w-full [overflow-wrap:anywhere]">{c.displayTitle}</span>
                    <span className="chat-rail-sub max-w-full text-faint [overflow-wrap:anywhere]">{subLine(c)}</span>
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
      {challengeTarget && <ChallengeSheet target={challengeTarget} onClose={() => setChallengeTarget(null)} />}
    </div>
  );
}
