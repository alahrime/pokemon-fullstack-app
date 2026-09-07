import { supabase } from './supabase';

export type ChannelKind = 'dm' | 'group' | 'match';

export interface Channel {
  id: string;
  kind: ChannelKind;
  title: string | null;
  matchId: string | null;
  lastReadAt: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    channelId: r.channel_id,
    authorId: r.author_id,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
  };
}

/**
 * `channel_members`' SELECT policy is `is_channel_member(channel_id)` — every
 * member of a channel can see every OTHER member's row, not just their own.
 * So the embedded `channel_members` join below comes back with one row per
 * member, in whatever order Postgres feels like, and taking `[0]` (the old
 * code) picked an arbitrary one of them — in a two-person DM, quite possibly
 * the other person's. `lastReadAt` was therefore wrong for essentially every
 * channel with more than one member, and any unread count built on it was
 * computed from someone else's read position.
 *
 * The fix: select `user_id` alongside `last_read_at` and pick the row whose
 * `user_id` matches the signed-in id — the only row with a read position that
 * means anything to THIS viewer. That makes `listChannels` a function of `me`
 * for the first time, so it gets the same `if (!me) return []` guard
 * `myMatches` (matches.ts) and `listFriends` (social.ts) carry: with `me`
 * undefined every row's `user_id` comparison would just be false, degrading
 * `lastReadAt` to `null` silently rather than a query built and sent with
 * `undefined` baked into it.
 */
export async function listChannels(): Promise<Channel[]> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('channels')
    .select('id, kind, title, match_id, channel_members(user_id, last_read_at)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      kind: ChannelKind;
      title: string | null;
      match_id: string | null;
      channel_members: { user_id: string; last_read_at: string | null }[];
    };
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      matchId: r.match_id,
      lastReadAt: r.channel_members.find((m) => m.user_id === me)?.last_read_at ?? null,
    };
  });
}

export async function listMessages(channelId: string, limit = 100): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  // Fetched newest-first so `.limit()` keeps the most RECENT messages rather
  // than the oldest ones, then reversed so the caller renders top-to-bottom
  // in the order a reader expects.
  return (data ?? []).map((r) => toMessage(r as unknown as MessageRow)).reverse();
}

/**
 * Returns the inserted row. Realtime will also deliver this same row to
 * every subscriber on this channel, THIS caller included once its own
 * `subscribeToChannel` handler fires — so the sender's UI sees the message
 * twice unless it de-duplicates. The row returned here and the row the
 * subscription delivers carry the same `id`, and that id is the intended key:
 * a caller (Task 7's screen) should append this return value to its list
 * optimistically and then, in `onMessage`, skip any payload whose `id` is
 * already present rather than trusting one source over the other.
 */
export async function sendMessage(channelId: string, body: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, body })
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .single();
  if (error) throw new Error(error.message);
  return toMessage(data as unknown as MessageRow);
}

export async function openDm(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_dm', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_title: title,
    p_members: memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function addToGroup(channelId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('add_to_group', {
    p_channel: channelId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function reportMessage(messageId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('report_message', {
    p_message: messageId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * `getSession()`, not `getUser()`: `getUser()` is a network round trip that
 * revalidates the JWT and would abort this write on a transient error for an
 * id the caller already holds locally. `app/src/state/SessionContext.tsx`,
 * `app/src/lib/matches.ts` and `app/src/lib/social.ts` all make the same
 * choice for the same reason.
 *
 * `me` is derived here purely to pick which `channel_members` row to stamp,
 * so the guard below is not standing in front of a fabricated-identity bug
 * the way `myMatches`'s and `listFriends`'s were — an `undefined` `me` would
 * just filter to a row that matches nothing rather than mislabel someone
 * else's read position. It returns early anyway, on principle: a query built
 * with `user_id=eq.undefined` is a bug sitting quietly rather than one caught
 * at the boundary, and this codebase now guards every `me`-derived function
 * the same way regardless of how the specific failure would present.
 */
export async function markRead(channelId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return;
  const { error } = await supabase
    .from('channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', me);
  if (error) throw new Error(error.message);
}

/** A channel plus the one extra fact the dock's rail needs that `listChannels`
 * does not already carry: when the last message in it landed. */
export interface ChannelActivity extends Channel {
  /** `null` for a channel nobody has posted in yet. */
  lastMessageAt: string | null;
}

/**
 * `profiles` by id, batched into ONE `IN` query no matter how many ids are
 * passed — never one query per id. `profiles`' SELECT policy is "readable by
 * anyone signed in" (`to authenticated using (true)`), so this succeeds for a
 * fellow channel member, a friend, a stranger, or anyone else with a row in
 * that table. `withDisplayNames` below and `FriendsScreen` both resolve names
 * through this one function — the same helper, so a person is a display name
 * in both places, never the uuid `channel_members`/`friendships` actually
 * stores.
 *
 * A duplicate id in the input is queried once. An id with no matching row (a
 * deleted profile, say) is simply absent from the returned map — this
 * function invents no fallback of its own; that is each caller's call to make
 * about what "unknown" should say in its own context.
 */
export async function resolveDisplayNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', unique);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as { id: string; display_name: string }[]).map((r) => [r.id, r.display_name]),
  );
}

/** Honest, human fallback for a channel whose name cannot be resolved — never
 * the raw channel uuid the rail used to fall back to before this existed. */
const FALLBACK_TITLE: Record<ChannelKind, string> = {
  dm: 'Direct message',
  group: 'Group',
  match: 'Match chat',
};

export interface ChannelDisplay extends ChannelActivity {
  /** Who or what the conversation is: the OTHER member's display name for a
   * `dm`/`match`, the channel's own `title` for a `group`, or
   * `FALLBACK_TITLE` when that cannot be resolved. Never a uuid. */
  displayTitle: string;
  /** Total member count — the one extra fact a `group`'s sub-line shows
   * instead of a timestamp (see the approved design canvas). `null` for a
   * `dm`/`match`. */
  memberCount: number | null;
}

/**
 * Attaches a human `displayTitle` (and, for a `group`, a `memberCount`) to
 * every channel passed in — everything `ChatDock`'s rail needs to stop
 * rendering a raw channel uuid as if it were somebody's identity, and to stop
 * a `dm` row saying nothing more specific than "Direct message".
 *
 * Two queries TOTAL, regardless of how many channels are passed in: one `IN`
 * query across every one of THEIR members at once (`channel_members`' SELECT
 * policy already lets a member see every fellow member's row — the same fact
 * `listChannels`'s own doc comment leans on for `lastReadAt`), then
 * `resolveDisplayNames`'s own single `IN` query across the distinct set of
 * OTHER member ids that turns up. Never one query per channel — that is the
 * exact N+1 shape `listChannelsWithActivity` already exists to avoid for
 * unread state, and a name lookup done per-row would repeat the very mistake
 * this file was written to rule out.
 *
 * A `dm`/`match` channel's "other" member is whichever row in its member list
 * is not `me` — the same two-person-channel assumption `create_match_channel`
 * (see the migration) bakes in when it seeds a match channel with exactly the
 * two players. A channel that somehow has no resolvable other member (no
 * session, or a profile that no longer exists) degrades to `FALLBACK_TITLE`,
 * never to the uuid.
 */
export async function withDisplayNames(channels: ChannelActivity[]): Promise<ChannelDisplay[]> {
  if (channels.length === 0) return [];
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;

  const { data: memberRows, error: memberError } = await supabase
    .from('channel_members')
    .select('channel_id, user_id')
    .in('channel_id', channels.map((c) => c.id));
  if (memberError) throw new Error(memberError.message);

  const membersByChannel = new Map<string, string[]>();
  for (const row of (memberRows ?? []) as { channel_id: string; user_id: string }[]) {
    const list = membersByChannel.get(row.channel_id);
    if (list) list.push(row.user_id);
    else membersByChannel.set(row.channel_id, [row.user_id]);
  }

  const otherIds: string[] = [];
  for (const c of channels) {
    if (c.kind === 'group') continue;
    for (const id of membersByChannel.get(c.id) ?? []) {
      if (id !== me) otherIds.push(id);
    }
  }
  const names = await resolveDisplayNames(otherIds);

  return channels.map((c) => {
    const members = membersByChannel.get(c.id) ?? [];
    if (c.kind === 'group') {
      return { ...c, displayTitle: c.title ?? FALLBACK_TITLE.group, memberCount: members.length };
    }
    const other = members.find((id) => id !== me);
    const displayTitle = (other && names.get(other)) || FALLBACK_TITLE[c.kind];
    return { ...c, displayTitle, memberCount: null };
  });
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * A timestamp the way a person would say it, never the raw ISO-8601 string
 * Postgres hands back — the rail used to print that string, microseconds and
 * all, straight into the sub-line. `now` is an explicit second argument
 * (defaulting to the real clock) purely so a test can pin "today" instead of
 * racing whatever moment it happens to run at.
 *
 * Four buckets, in order: a clock time (`19:04`) for today, the word
 * `yesterday`, a weekday name (`Tuesday`) for anything from two to six
 * calendar days back, and otherwise a short date (`Sep 1`). Calendar days,
 * not a raw 24-hour divide — a message at 23:59 and a read at 00:01 the next
 * day are less than an hour apart but are "yesterday" in wall-clock terms,
 * and the reverse (two calendar days, under 48 raw hours) is just as real.
 */
export function humanTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (sameCalendarDay(then, now)) {
    return `${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameCalendarDay(then, yesterday)) return 'yesterday';

  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const dayDiff = Math.round((startOfNow - startOfThen) / (24 * 60 * 60 * 1000));

  if (dayDiff > 0 && dayDiff < 7) return WEEKDAYS[then.getDay()];
  return `${MONTHS[then.getMonth()]} ${then.getDate()}`;
}

/**
 * `listChannels()` plus, for each of those channels, when the last message in
 * it landed — everything `ChatDock`'s rail needs to sort by recency and to
 * decide which rows are unread (`lastMessageAt` newer than the channel's own
 * `lastReadAt`).
 *
 * One extra query for every channel at once, not one per channel: a rail with
 * N conversations open would otherwise fire N queries just to paint unread
 * dots, which is the N+1 shape this function exists to avoid. `channel_id,
 * created_at` ordered newest-first is enough to reduce client-side down to
 * one row per channel — the first row this loop sees for a given id IS that
 * channel's latest, because the query already sorted by `created_at desc`.
 *
 * A channel with no messages at all (a group just created, say) never
 * appears in this second query's result, so it is left `lastMessageAt: null`
 * rather than silently dropped — the `.map` below runs over `listChannels()`'s
 * own array, not over what came back here.
 */
export async function listChannelsWithActivity(): Promise<ChannelActivity[]> {
  const channels = await listChannels();
  if (channels.length === 0) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('channel_id, created_at')
    .in('channel_id', channels.map((c) => c.id))
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<string, string>();
  for (const row of (data ?? []) as { channel_id: string; created_at: string }[]) {
    if (!latest.has(row.channel_id)) latest.set(row.channel_id, row.created_at);
  }
  return channels.map((c) => ({ ...c, lastMessageAt: latest.get(c.id) ?? null }));
}

/**
 * A channel is unread when it has a message this viewer's own `lastReadAt`
 * does not yet cover — including a channel `lastReadAt` has never been
 * stamped on at all (`null`), which reads as "everything in it is unread"
 * rather than as "nothing to compare, so call it read". Both timestamps are
 * ISO 8601 strings straight off Postgres, which sort lexicographically in the
 * same order they sort chronologically, so a plain string compare is exact —
 * no `Date` parsing needed for what is otherwise just "is A before B".
 */
export function isChannelUnread(c: ChannelActivity): boolean {
  if (!c.lastMessageAt) return false;
  if (!c.lastReadAt) return true;
  return c.lastMessageAt > c.lastReadAt;
}

/**
 * The four states Supabase's own `.subscribe()` callback can report. Passed
 * through verbatim from `@supabase/realtime-js`'s `REALTIME_SUBSCRIBE_STATES`
 * rather than importing that type, so this module does not have to chase a
 * dependency's internal type export across a version bump for four string
 * literals it already knows.
 */
export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

/**
 * Returns its own teardown, and the teardown is IDEMPOTENT.
 *
 * StrictMode mounts an effect, tears it down and mounts it again. A teardown
 * that removes "the subscription for channel X" rather than the specific
 * subscription it opened will, on the second call, remove the one the second
 * mount just created — leaving a live component wired to nothing. `useFormats`
 * shipped exactly this bug in a different costume; see the M1b notes in
 * docs/superpowers/HANDOFF.md.
 *
 * Each call opens a channel with a fresh, random suffix (rather than a name
 * derived only from `channelId`) so two overlapping subscriptions to the same
 * chat — StrictMode's extra mount, or two components watching the same
 * channel at once — never collide on one Realtime channel name. The teardown
 * closes over the specific subscription object THIS call created and a local
 * `stopped` flag, so calling it again is a no-op no matter what has opened or
 * closed since.
 *
 * `onStatus`, an optional third argument, is `.subscribe()`'s own status
 * callback surfaced to the caller — `SUBSCRIBED`, `CHANNEL_ERROR`,
 * `TIMED_OUT` or `CLOSED`. Optional and additive rather than a change to the
 * return shape, so a caller's `const stop = subscribeToChannel(...)` (see
 * `components/ChatPane.tsx`, the docked pane that reads this module now)
 * keeps working with no change: a caller that does not need to know when the
 * join completes never has to think about it. Before this, nothing could
 * tell a caller when the subscription was actually live —
 * `app/tools/m3b-roundtrip.ts`'s check 3
 * (the only thing in the project proving the `supabase_realtime` publication
 * is wired) slept a fixed 1500ms before sending and hoped the join had
 * finished, which produced a false FAILURE after `db:reset` restarts the
 * realtime container and could in principle produce a false PASS the other
 * way. That check now awaits this callback's first `SUBSCRIBED` instead.
 */
export function subscribeToChannel(
  channelId: string,
  onMessage: (m: Message) => void,
  onStatus?: (status: ChannelStatus) => void,
): () => void {
  const sub = supabase
    .channel(`messages:${channelId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      },
      (payload: { new: MessageRow }) => onMessage(toMessage(payload.new)),
    )
    .subscribe((status: string) => {
      onStatus?.(status as ChannelStatus);
    });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    supabase.removeChannel(sub);
  };
}
