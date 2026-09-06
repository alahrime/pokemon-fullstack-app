import { supabase } from './supabase';

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friend {
  otherId: string;
  status: FriendshipStatus;
  /** True when the OTHER person sent the request, i.e. it is yours to accept. */
  theyAsked: boolean;
  createdAt: string;
}

/**
 * `getSession()`, not `getUser()`: `getUser()` is a network round trip that
 * revalidates the JWT and would abort this read on a transient error for an id
 * the caller already holds locally. `app/src/state/SessionContext.tsx` and
 * `app/src/lib/matches.ts` make the same choice for the same reason.
 */
async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

/**
 * `friendships` stores one row per PAIR, canonically ordered as
 * (user_lo, user_hi) — not one row per direction. So which id is "the other
 * person", and whether "I" am the one who asked, are both derived from `me`
 * rather than read off a column. Get this backwards and a request you sent
 * yourself shows up as one you can accept.
 */
export async function listFriends(): Promise<Friend[]> {
  const me = await myId();
  // The `friendships` SELECT policy (`to authenticated`, no `anon` grant) is
  // what actually keeps a signed-out or session-less caller from ever
  // reaching the map below with rows — an unauthenticated `select` here comes
  // back `[]` regardless, in production today. This early return exists
  // anyway so that guarantee is not the only thing standing between the map
  // below and a bug: with `me` undefined, `r.user_lo === me` is false for
  // every row, which collapses `otherId` to always `r.user_lo` and makes
  // `theyAsked` (`r.requested_by !== me`) always true — every request,
  // including one's own outgoing ones, would render as incoming with an
  // Accept button. `app/src/lib/matches.ts`'s `myMatches()` carries the same
  // guard for the identical reason (see its comment).
  if (!me) return [];
  const { data, error } = await supabase
    .from('friendships')
    .select('user_lo, user_hi, requested_by, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      user_lo: string;
      user_hi: string;
      requested_by: string;
      status: FriendshipStatus;
      created_at: string;
    };
    return {
      otherId: r.user_lo === me ? r.user_hi : r.user_lo,
      status: r.status,
      theyAsked: r.requested_by !== me,
      createdAt: r.created_at,
    };
  });
}

/**
 * The RPC raises one uninterpretable sentence — "that person cannot be sent a
 * friend request" — for blocked-in-either-direction, no-such-profile, and
 * yourself alike. That is deliberate: a distinguishable error would let a
 * caller detect a block. `error.message` is surfaced verbatim here and must
 * never be mapped to anything more specific or more helpful.
 */
export async function requestFriendship(targetId: string): Promise<FriendshipStatus> {
  const { data, error } = await supabase.rpc('request_friendship', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as FriendshipStatus;
}

export async function respondToFriendship(
  otherId: string,
  accept: boolean,
): Promise<'accepted' | 'removed'> {
  const { data, error } = await supabase.rpc('respond_to_friendship', {
    p_other: otherId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  return data as 'accepted' | 'removed';
}

export async function removeFriendship(otherId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('remove_friendship', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function blockUser(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function listBlocks(): Promise<string[]> {
  const { data, error } = await supabase.from('blocks').select('blocked_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as unknown as { blocked_id: string }).blocked_id);
}

export async function unblockUser(targetId: string): Promise<void> {
  const { error } = await supabase.from('blocks').delete().eq('blocked_id', targetId);
  if (error) throw new Error(error.message);
}
