import { Fragment, useEffect, useRef, useState } from 'react';
import { TrainerAvatar, useProfiles } from './TrainerBits';
import { ChallengeCard } from './ChallengeCard';
import { useSession } from '../state/SessionContext';
import {
  canAnnounce,
  isTournamentOrganiser,
  setAnnounceOnly,
  listMessages,
  listPins,
  pinMessage,
  unpinMessage,
  markRead,
  reportMessage,
  sendMessage,
  subscribeToChannel,
  type ChannelDisplay,
  type Message,
} from '../lib/channels';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * How a message is named to a screen reader.
 *
 * These controls repeat once per message, so their accessible names have to
 * be distinct or a rotor lists a column of identical `Report`s. They used to
 * be disambiguated with `m.id` — which is unique and completely unreadable,
 * since a uuid is spoken out character by character. A short quotation of the
 * body is how a person would actually refer to a message, and it is unique in
 * practice among the handful of messages a pane holds at once.
 */
function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 32 ? `${flat.slice(0, 32)}…` : flat;
}

/**
 * The pane's `.hud-label` kind badge — the same three kinds the rail keys its
 * border colour off (`data-kind` in `ChatDock`), spelled out for a header
 * that has no adjoining sub-line to disambiguate what's chatting the way the
 * rail's `direct · 20:35` does. `match` reads `match chat` here rather than
 * the rail's bare `match`, matching the approved design canvas's pane header
 * (`DM` / `GROUP` / `MATCH CHAT` once CSS's `text-transform: uppercase`
 * runs). `dm`/`group` already equal their own uppercased kind, so only
 * `match` needs the extra word.
 */
/** Consecutive messages by one author within this gap read as one group. */
const GROUP_GAP_MS = 5 * 60_000;
const dayOf = (iso: string) => new Date(iso).toDateString();
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Where each message sits in its run: a new day, the first or last of an
 * author's group, and whether the "New" divider goes above it (the first
 * message from someone else after the read mark this pane opened with).
 */
export function layoutMessages(messages: readonly Message[], me: string | undefined, readMark: string | null) {
  let dividerPlaced = false;
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const joins = (a: Message | undefined, b: Message | undefined) =>
      !!a && !!b && a.authorId === b.authorId && a.kind !== 'challenge' && b.kind !== 'challenge'
      && dayOf(a.createdAt) === dayOf(b.createdAt) && Date.parse(b.createdAt) - Date.parse(a.createdAt) < GROUP_GAP_MS;
    const newDay = !prev || dayOf(prev.createdAt) !== dayOf(m.createdAt);
    const unread = !dividerPlaced && !!readMark && m.authorId !== me && m.createdAt > readMark;
    if (unread) dividerPlaced = true;
    return { m, newDay, unread, first: newDay || unread || !joins(prev, m), last: !joins(m, next) };
  });
}

function kindLabel(kind: ChannelDisplay['kind']): string {
  if (kind === 'match') return 'match chat';
  return kind;
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
 *
 * `channel` is a `ChannelDisplay`, not a bare `Channel` — `ChatDock` already
 * resolved every open channel's `displayTitle` once, up front, for the rail
 * (`withDisplayNames` in `lib/channels.ts`), and passes that same object down
 * here rather than this pane re-resolving or re-querying anything of its own.
 * The header below reads `channel.displayTitle` directly, so a DM pane names
 * itself "Ally" exactly when the rail row for the same channel does, and
 * degrades to the identical honest fallback ("Direct message") — never a
 * uuid — when `withDisplayNames` itself couldn't resolve one.
 */
export function ChatPane({
  channel,
  minimized,
  onToggleMinimize,
  onClose,
  onActivity,
  onRead,
  onChallenge,
  embedded = false,
}: {
  channel: ChannelDisplay;
  minimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
  onActivity: (channelId: string, at: string, preview?: { body: string; authorId: string }) => void;
  onRead: (channelId: string, at: string) => void;
  onChallenge?: (target: { id: string; name: string }) => void;
  /** Fills its parent (the Chat screen): no minimize/close, never collapsed. */
  embedded?: boolean;
}) {
  const { user } = useSession();
  if (embedded) minimized = false;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The read mark as it stood when the pane opened, before this pane's own markRead moves it.
  const [readMark] = useState(channel.lastReadAt);
  const flat = channel.kind === 'group' || channel.kind === 'tournament';
  const profiles = useProfiles([...new Set(messages.map((m) => m.authorId)), ...(channel.otherId ? [channel.otherId] : [])]);
  const authorName = (id: string) => (id === user?.id ? 'You' : profiles.get(id)?.displayName ?? (channel.kind === 'dm' ? channel.displayTitle : 'Unknown trainer'));
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Organisers and judges of a tournament's channel may flag a message as an announcement.
  const [mayAnnounce, setMayAnnounce] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [organiser, setOrganiser] = useState(false);
  const [announceOnly, setAnnounceOnlyFlag] = useState(channel.announceOnly === true);
  // Pins are read by every member; only the people who run the tournament may change them.
  const [pins, setPins] = useState<Message[]>([]);
  useEffect(() => {
    if (channel.kind !== 'tournament') return;
    let live = true;
    canAnnounce(channel.id).then((ok) => live && setMayAnnounce(ok)).catch(() => {});
    isTournamentOrganiser(channel.id).then((ok) => live && setOrganiser(ok)).catch(() => {});
    listPins(channel.id).then((p) => live && setPins(p)).catch(() => {});
    return () => { live = false; };
  }, [channel.id, channel.kind]);
  async function flipAnnounceOnly() {
    setSendError(null);
    try {
      setAnnounceOnlyFlag(await setAnnounceOnly(channel.id, !announceOnly));
    } catch (e) {
      setSendError(messageOf(e));
    }
  }
  async function togglePin(m: Message) {
    setSendError(null);
    try {
      if (pins.some((p) => p.id === m.id)) {
        await unpinMessage(m.id);
        setPins((prev) => prev.filter((p) => p.id !== m.id));
      } else {
        await pinMessage(m.id);
        setPins((prev) => [m, ...prev]);
      }
    } catch (e) {
      setSendError(messageOf(e));
    }
  }
  const [sendError, setSendError] = useState<string | null>(null);
  // Newest message in view: on open, and whenever one arrives or is sent.
  const endRef = useRef<HTMLLIElement>(null);
  const logRef = useRef<HTMLUListElement>(null);
  // Follow new messages only while the reader is at the bottom; scrolled up, they pile into a "new" count instead.
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const seenCount = useRef(0);
  useEffect(() => {
    const added = messages.length - seenCount.current;
    seenCount.current = messages.length;
    const mineLast = messages[messages.length - 1]?.authorId === user?.id;
    if (atBottom.current || mineLast || added === messages.length) {
      endRef.current?.scrollIntoView?.({ block: 'nearest' });
      setUnseen(0);
    } else if (added > 0) setUnseen((n) => n + added);
  }, [messages.length, minimized]);
  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setUnseen(0);
  }
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
      })
      .finally(() => live && setLoaded(true));
    void markRead(channel.id).then(() => {
      if (live) onRead(channel.id, new Date().toISOString());
    });
    const stop = subscribeToChannel(channel.id, (m) => {
      if (!live) return;
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        onActivity(channel.id, m.createdAt, { body: m.body, authorId: m.authorId });
        // "Focused" for a docked pane means visibly expanded — there is no
        // single OS-level focus target across several panes sitting side by
        // side, so an open, un-minimised pane is treated as being looked at.
        if (!minimizedRef.current) {
          // Synchronously, beside `onActivity`: waiting for `markRead` to
          // resolve leaves the channel "unread" for a network round trip, and
          // the notification toaster would announce a message being read.
          onRead(channel.id, m.createdAt);
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
      const sent = announce ? await sendMessage(channel.id, body, 'announcement') : await sendMessage(channel.id, body);
      // Same de-duplication `ChatScreen` used: this call's own return and the
      // realtime delivery of the same insert both land here, and only the
      // first must stick.
      setMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [...prev, sent]));
      onActivity(channel.id, sent.createdAt, { body: sent.body, authorId: sent.authorId });
      onRead(channel.id, sent.createdAt);
      // Your own message cannot leave your own conversation "unread" —
      // without this, sending bumps `lastMessageAt` past whatever
      // `lastReadAt` this pane last recorded, and the rail would light up a
      // badge for a message you just wrote yourself.
      void markRead(channel.id).then(() => onRead(channel.id, new Date().toISOString()));
      setDraft('');
      setAnnounce(false);
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

  const label = channel.displayTitle;

  return (
    <section className={`chat-pane chamfer-9 panel${minimized ? ' is-minimized' : ''}${embedded ? ' is-embedded' : ''}`}>
      <div className="chat-pane-header">
        {channel.otherId && <TrainerAvatar profile={profiles.get(channel.otherId)} name={label} size={32} />}
        <span className="chat-pane-heading">
          <span className="chat-pane-title">{label}</span>
          <span className="hud-label chat-pane-kind">{kindLabel(channel.kind)}</span>
        </span>
        <div className="chat-pane-controls">
          {onChallenge && channel.kind === 'dm' && channel.otherId && (
            <button
              type="button"
              className="btn btn-ghost chamfer-5"
              aria-label={`Challenge ${label}`}
              onClick={() => onChallenge({ id: channel.otherId!, name: label })}
            >
              Challenge
            </button>
          )}
          {/* "chat with <name>" rather than a trailing `· ${channel.id}` — with
              two panes open side by side, a resolved `displayTitle` already
              distinguishes them (the same assumption `ChatDock`'s own
              `railAriaLabel` makes for the rail row), and reads far better on
              a screen reader's rotor than the raw uuid the old fallback-label
              version needed to stay unique. */}
          {!embedded && (
            <>
          <button
            type="button"
            className="btn btn-ghost chamfer-5"
            aria-label={`${minimized ? 'Expand' : 'Minimize'} chat with ${label}`}
            onClick={onToggleMinimize}
          >
            {minimized ? '▴' : '▾'}
          </button>
          <button
            type="button"
            className="btn btn-ghost chamfer-5"
            aria-label={`Close chat with ${label}`}
            onClick={onClose}
          >
            ✕
          </button>
            </>
          )}
        </div>
      </div>

      {!minimized && (
        <>
          {threadError && (
            <p className="friend-notice" role="alert">
              {threadError}
            </p>
          )}

          {pins.length > 0 && (
            <section className="chat-pins" aria-label="Pinned messages">
              <span className="hud-label">Pinned</span>
              <ul>{pins.map((p) => <li key={p.id}>{p.body}</li>)}</ul>
            </section>
          )}

          {!loaded && !threadError && <p className="text-muted chat-loading" role="status">Loading messages…</p>}
          {loaded && messages.length === 0 && !threadError && <p className="text-muted chat-loading">No messages yet. Say hello.</p>}
          <ul className="chat-transcript" ref={logRef} onScroll={onLogScroll} role="log" aria-live="polite" aria-label={`Messages with ${label}`} data-layout={flat ? 'flat' : 'bubbles'}>
            {layoutMessages(messages, user?.id, readMark).map(({ m, newDay, unread, first, last }) => {
              const isOwn = !!user && m.authorId === user.id;
              const canReport = !isOwn && !m.deletedAt;
              return (
                <Fragment key={m.id}>
                {newDay && <li className="chat-divider" aria-hidden="true"><span>{dayLabel(m.createdAt)}</span></li>}
                {unread && <li className="chat-divider is-unread"><span>New</span></li>}
                <li
                  className={`chat-message${isOwn ? ' is-own' : ''}${m.deletedAt ? ' is-deleted' : ''}${m.kind === 'announcement' && !m.deletedAt ? ' is-announcement' : ''}`}
                  data-first={first || undefined}
                  data-last={last || undefined}
                >
                  {flat && first && (
                    <div className="chat-message-head">
                      <TrainerAvatar profile={profiles.get(m.authorId)} name={authorName(m.authorId)} size={32} />
                      <strong>{authorName(m.authorId)}</strong>
                      <time className="text-faint numeric" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
                    </div>
                  )}
                  {m.kind === 'challenge' && m.offerId && !m.deletedAt ? (
                    <ChallengeCard offerId={m.offerId} />
                  ) : (
                    <p className="chat-message-body" title={clock(m.createdAt)}>
                      {m.kind === 'announcement' && !m.deletedAt && <strong className="hud-label chat-announcement-tag">Announcement </strong>}
                      {m.deletedAt ? 'Message deleted' : m.body}
                    </p>
                  )}
                  <div className="chat-message-tools">
                  {!flat && last && (
                    <time className="chat-message-time text-faint numeric" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
                  )}
                  {mayAnnounce && !m.deletedAt && (
                    <button type="button" className="btn btn-ghost" aria-label={`${pins.some((p) => p.id === m.id) ? 'Unpin' : 'Pin'} message “${snippetOf(m.body)}”`} onClick={() => void togglePin(m)}>
                      {pins.some((p) => p.id === m.id) ? 'Unpin' : 'Pin'}
                    </button>
                  )}
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
                        aria-label={`Reason for reporting “${snippetOf(m.body)}”`}
                        placeholder="Why are you reporting this message?"
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        aria-label={`Submit report for “${snippetOf(m.body)}”`}
                        disabled={!reportReason.trim() || reportingId === m.id}
                      >
                        {reportingId === m.id ? 'Reporting…' : 'Report'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Cancel reporting “${snippetOf(m.body)}”`}
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
                      aria-label={`Report message “${snippetOf(m.body)}”`}
                      onClick={() => {
                        setOpenReportId(m.id);
                        setReportReason('');
                      }}
                    >
                      Report
                    </button>
                  )}
                  </div>
                </li>
                </Fragment>
              );
            })}
            <li ref={endRef} aria-hidden="true" className="chat-end" />
          </ul>
          {unseen > 0 && (
            <button type="button" className="btn chamfer-5 chat-jump" onClick={() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); setUnseen(0); }}>
              {unseen} new {unseen === 1 ? 'message' : 'messages'} ↓
            </button>
          )}

          {organiser && (
            <label className="chat-announce">
              <input type="checkbox" checked={announceOnly} onChange={() => void flipAnnounceOnly()} /> Announce-only (only hosts can post)
            </label>
          )}

          {announceOnly && !mayAnnounce ? (
            <p className="text-muted chat-readonly">Only the hosts can post here.</p>
          ) : (
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              className="input"
              aria-label={`Message to ${label}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // Enter sends, Shift+Enter is a new line.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
            />
            {mayAnnounce && (
              <label className="chat-announce">
                <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Send as announcement
              </label>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              aria-label={`Send message to ${label}`}
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
          )}
        </>
      )}
    </section>
  );
}
