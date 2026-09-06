import { useEffect, useRef, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import {
  listChannels,
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
 * What a channel row reads before its id is appended for uniqueness (see
 * the render below) — a group by its own title, and the two kinds that have
 * no title of their own by what they are.
 */
function labelOf(c: Channel): string {
  if (c.kind === 'group') return c.title ?? 'Group';
  if (c.kind === 'match') return 'Match chat';
  return 'Direct message';
}

/**
 * The chat screen: everything `lib/channels.ts` (Task 6) exposes about
 * direct messages, group chats and match channels, on one page.
 *
 * Deliberately gates on nothing from `useSession()` — `listChannels()` and
 * `markRead()` already refuse to do anything meaningful without a session
 * (see their own guards in `lib/channels.ts`), so a second gate here would
 * only duplicate that check for a signed-out visitor who already sees an
 * honest "No conversations yet." from an empty list, never someone else's
 * data.
 *
 * Selecting a channel loads its transcript with `listMessages` and opens
 * `subscribeToChannel` in an effect keyed on the channel id, so switching
 * channels tears the old subscription down before opening the new one.
 * Appended messages are de-duplicated by `id`: `sendMessage` returns the
 * inserted row AND the subscription delivers that same row, so appending
 * both unconditionally would show the sender their own message twice (see
 * `sendMessage`'s own doc comment in `lib/channels.ts`).
 *
 * `activeMatch` (set by `MatchScreen`'s "Open match chat" control, the same
 * state slot the match screen itself reads) drives a one-time jump straight
 * to that match's channel when this screen is the one just navigated to —
 * guarded by a ref rather than state so a later channel switch made by hand
 * is never undone by this effect running again.
 *
 * The Report control is never rendered for a message this viewer authored
 * (reporting yourself is meaningless) or one already soft-deleted (its body
 * is gone; there is nothing left for a moderator to act on) — `isOwn` below
 * compares `m.authorId` to `useSession().user?.id`, the same identity source
 * `FriendsScreen` and every other screen with a signed-in-only action reads.
 * `reportedIds` is local, per-mount UI state, not a fact the server
 * remembers, so it is cleared every time `selectedId` changes — otherwise a
 * message reported in one conversation would still read "Reported" after
 * switching to a different one that happens to reuse the same message id
 * ordering, which is a false claim about a channel this session never acted
 * on. The reason itself is collected by an inline form in the house
 * vocabulary (`.chat-report-form`, modelled on `FriendsScreen`'s
 * `.friend-search-row`) rather than `window.prompt()`, which is unstyled,
 * untestable with `fireEvent`, and suppressed entirely in some browser
 * contexts (an in-page iframe, some embedded webviews) — a control that can
 * silently do nothing is worse than one that is merely ugly.
 */
export function ChatScreen() {
  const { state } = useAppState();
  const { user } = useSession();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [reportingId, setReportingId] = useState<string | null>(null);
  // Which message's inline report form is open, if any — at most one at a
  // time, mirroring how only one channel's transcript is ever open.
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const autoOpened = useRef(false);

  useEffect(() => {
    void listChannels()
      .then(setChannels)
      .catch((e) => setLoadError(messageOf(e)));
  }, []);

  useEffect(() => {
    if (autoOpened.current || !channels || !state.activeMatch) return;
    const matchChannel = channels.find(
      (c) => c.kind === 'match' && c.matchId === state.activeMatch!.id,
    );
    if (matchChannel) {
      autoOpened.current = true;
      setSelectedId(matchChannel.id);
    }
  }, [channels, state.activeMatch]);

  // Keyed on the channel id: switching channels runs this cleanup (tearing
  // down the old subscription) before the effect body opens a new one.
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    setMessages([]);
    setThreadError(null);
    // Local UI state about a PREVIOUS conversation's messages must not leak
    // into this one — see this component's own doc comment.
    setReportedIds(new Set());
    setOpenReportId(null);
    setReportReason('');
    void listMessages(selectedId)
      .then((ms) => {
        if (live) setMessages(ms);
      })
      .catch((e) => {
        if (live) setThreadError(messageOf(e));
      });
    void markRead(selectedId);
    const stop = subscribeToChannel(selectedId, (m) => {
      if (!live) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    });
    return () => {
      live = false;
      stop();
    };
  }, [selectedId]);

  async function send() {
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(selectedId, body);
      // Same de-duplication as the subscription handler above: this call's
      // own return and the realtime delivery of the same insert both land
      // here, and only the first must stick.
      setMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [...prev, sent]));
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

  const selected = (channels ?? []).find((c) => c.id === selectedId) ?? null;

  return (
    <div className="chat-screen">
      <ScreenHeader
        title="Chat"
        blurb="Direct messages, group chats, and the channel for each of your matches."
      />

      {loadError && (
        <p className="friend-notice" role="alert">
          {loadError}
        </p>
      )}

      <div className="chat-layout">
        <section className="panel chat-channel-list">
          <div className="hud-label">Channels</div>
          {channels && channels.length === 0 && (
            <p className="text-muted">No conversations yet.</p>
          )}
          <ul className="match-list">
            {(channels ?? []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chat-channel-row${c.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  {labelOf(c)}
                  {/* Appended so two rows of the same kind (two DMs, two
                      groups sharing a title) never share one accessible
                      name — the same fix `FriendsScreen`'s rows needed. */}
                  <span className="text-faint"> · {c.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel chat-thread">
          {!selected && <p className="text-muted">Choose a conversation to open it.</p>}
          {selected && (
            <>
              <div className="hud-label">{labelOf(selected)}</div>

              {threadError && (
                <p className="friend-notice" role="alert">
                  {threadError}
                </p>
              )}

              <ul className="chat-transcript">
                {messages.map((m) => {
                  // Reporting yourself is meaningless, and a deleted message
                  // has no body left for a moderator to read — the control
                  // is not rendered for either case, rather than rendered
                  // and refused.
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
                <div className="hud-label">Message</div>
                <textarea
                  className="input"
                  aria-label="Message"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
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
      </div>
    </div>
  );
}
