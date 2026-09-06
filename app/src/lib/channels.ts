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
 */
export function subscribeToChannel(
  channelId: string,
  onMessage: (m: Message) => void,
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
    .subscribe();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    supabase.removeChannel(sub);
  };
}
