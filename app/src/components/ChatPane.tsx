import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/SessionContext';
import {
  listMessages,
  markRead,
  reportMessage,
  sendMessage,
  subscribeToChannel,
  type Channel,
  type Message,
} from '../lib/channels';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * What a pane's header (and a rail row, which imports this too) reads for a
 * channel — a group by its own title, and the two kinds that have no title of
 * their own by what they are. Lifted from the old full-page `ChatScreen`
 * unchanged; see `git log` on that file for its history.
 */
export function channelLabel(c: Channel): string {
  if (c.kind === 'group') return c.title ?? 'Group';
  if (c.kind === 'match') return 'Match chat';
  return 'Direct message';
}

/**
 * One open conversation, docked. This is `ChatScreen`'s old thread panel —
 * transcript, composer, and the inline report control — lifted out so it can
 * be mounted more than once at a time (one per open pane, side by side) and
 * driven by an explicit `channel` prop instead of a `selectedId` the old
 * screen owned itself.
 *
 * Two behaviours here go beyond what `ChatScreen` did, both because a docked
 * pane can stay open while its rail sibling keeps tracking unread state for
 * every OTHER channel: `onActivity` fires with this channel's id and a
 * message's `createdAt` any time one is sent or received here, and `onRead`
 * fires whenever this pane marks the channel read — on open, and again on a
 * message that arrives while the pane is not minimised (see the effects
 * below). `ChatDock` uses both to keep its own copy of `lastMessageAt` /
 * `lastReadAt` current between its periodic re-fetches, rather than making
 * the rail wait out a whole poll interval to notice a conversation you are
 * actively looking at.
 *
 * The Report control is never rendered for a message this viewer authored
 * (reporting yourself is meaningless) or one already soft-deleted (its body
 * is gone; there is nothing left for a moderator to act on) — `isOwn` below
 * compares `m.authorId` to `useSession().user?.id`, the same identity source
 * `FriendsScreen` and every other screen with a signed-in-only action reads.
 * `reportedIds` is local, per-mount UI state, not a fact the server
 * remembers, so it lives and dies with this pane exactly as it did with
 * `ChatScreen`'s per-channel state.
 */
export function ChatPane({
  channel,
  minimized,
  onToggleMinimize,
  onClose,
  onActivity,
  onRead,
}: {
  channel: Channel;
  minimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
  onActivity: (channelId: string, at: string) => void;
  onRead: (channelId: string, at: string) => void;
}) {
  const { user } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');

  // Read inside the subscription's handler, which closes over the render it
  // was created in — the effect below intentionally does not depend on
  // `minimized` (re-subscribing on every minimise/expand would tear down and
  // reopen the Realtime channel for no reason), so the handler reads whether
  // THIS pane is currently minimised through a ref that a separate effect
  // keeps current instead.
  const minimizedRef = useRef(minimized);
  useEffect(() => {
    minimizedRef.current = minimized;
  }, [minimized]);

  // Marks the channel read again on the transition INTO expanded — catching
  // up whatever arrived while this pane sat minimised — but not on the
  // initial mount, which the effect below already covers on its own.
  const wasMinimized = useRef(minimized);
  useEffect(() => {
    if (wasMinimized.current && !minimized) {
      void markRead(channel.id).then(() => onRead(channel.id, new Date().toISOString()));
    }
    wasMinimized.current = minimized;
    // `onRead` is a fresh closure from `ChatDock` every render; only the pane
    // identity and the minimised transition itself should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized, channel.id]);

  // Keyed on the channel id, which is stable for the lifetime of one pane —
  // `ChatDock` mounts a fresh `ChatPane` per open id (`key={id}`) rather than
  // reusing one instance across channels, so this never has to tear down a
  // subscription and open another the way `ChatScreen`'s single-panel
  // version did when `selectedId` changed.
  useEffect(() => {
    let live = true;
    void listMessages(channel.id)
      .then((ms) => {
        if (live) setMessages(ms);
      })
      .catch((e) => {
        if (live) setThreadError(messageOf(e));
      });
    void markRead(channel.id).then(() => {
      if (live) onRead(channel.id, new Date().toISOString());
    });
    const stop = subscribeToChannel(channel.id, (m) => {
      if (!live) return;
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        onActivity(channel.id, m.createdAt);
        // "Focused" for a docked pane means visibly expanded — there is no
        // single OS-level focus target across several panes sitting side by
        // side, so an open, un-minimised pane is treated as being looked at.
        if (!minimizedRef.current) {
          void markRead(channel.id).then(() => onRead(channel.id, new Date().toISOString()));
        }
        return [...prev, m];
      });
    });
    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(channel.id, body);
      // Same de-duplication `ChatScreen` used: this call's own return and the
      // realtime delivery of the same insert both land here, and only the
      // first must stick.
      setMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [...prev, sent]));
      onActivity(channel.id, sent.createdAt);
      // Your own message cannot leave your own conversation "unread" —
      // without this, sending bumps `lastMessageAt` past whatever
      // `lastReadAt` this pane last recorded, and the rail would light up a
      // badge for a message you just wrote yourself.
      void markRead(channel.id).then(() => onRead(channel.id, new Date().toISOString()));
      setDraft('');
    } catch (e) {
      setSendError(messageOf(e));
    } finally {
      setSending(false);
    }
  }

  async function submitReport(id: string) {
    const reason = reportReason.trim();
    if (!reason) return;
    setReportingId(id);
    setSendError(null);
    try {
      await reportMessage(id, reason);
      setReportedIds((prev) => new Set(prev).add(id));
      setOpenReportId(null);
      setReportReason('');
    } catch (e) {
      setSendError(messageOf(e));
    } finally {
      setReportingId(null);
    }
  }

  const label = channelLabel(channel);

  return (
    <section className={`chat-pane chamfer-9 panel${minimized ? ' is-minimized' : ''}`}>
      <div className="chat-pane-header">
        <span className="hud-label chat-pane-kind">{channel.kind}</span>
        <span className="chat-pane-title">{label}</span>
        <div className="chat-pane-controls">
          <button
            type="button"
            className="btn btn-ghost chamfer-5"
            aria-label={`${minimized ? 'Expand' : 'Minimize'} ${label} · ${channel.id}`}
            onClick={onToggleMinimize}
          >
            {minimized ? '▴' : '▾'}
          </button>
          <button
            type="button"
            className="btn btn-ghost chamfer-5"
            aria-label={`Close ${label} · ${channel.id}`}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {threadError && (
            <p className="friend-notice" role="alert">
              {threadError}
            </p>
          )}

          <ul className="chat-transcript">
            {messages.map((m) => {
              const isOwn = !!user && m.authorId === user.id;
              const canReport = !isOwn && !m.deletedAt;
              return (
                <li
                  key={m.id}
                  className={`chat-message${m.deletedAt ? ' is-deleted' : ''}`}
                >
                  <p className="chat-message-body">
                    {m.deletedAt ? 'Message deleted' : m.body}
                  </p>
                  {canReport && reportedIds.has(m.id) && (
                    <span className="text-faint">Reported</span>
                  )}
                  {canReport && !reportedIds.has(m.id) && openReportId === m.id && (
                    <form
                      className="chat-report-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitReport(m.id);
                      }}
                    >
                      <input
                        type="text"
                        className="input"
                        aria-label={`Report reason for message ${m.id}`}
                        placeholder="Why are you reporting this message?"
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        aria-label={`Submit report for message ${m.id}`}
                        disabled={!reportReason.trim() || reportingId === m.id}
                      >
                        {reportingId === m.id ? 'Reporting…' : 'Report'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Cancel report for message ${m.id}`}
                        onClick={() => {
                          setOpenReportId(null);
                          setReportReason('');
                        }}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                  {canReport && !reportedIds.has(m.id) && openReportId !== m.id && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-label={`Report message ${m.id}`}
                      onClick={() => {
                        setOpenReportId(m.id);
                        setReportReason('');
                      }}
                    >
                      Report
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              className="input"
              aria-label={`Message · ${label} · ${channel.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              aria-label={`Send · ${label} · ${channel.id}`}
              disabled={!draft.trim() || sending}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
            {sendError && (
              <p className="friend-notice" role="alert">
                {sendError}
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
