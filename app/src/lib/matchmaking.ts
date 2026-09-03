import { supabase } from './supabase';
import { DATA_REV } from './data';
import { rulesHash, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';

export interface QueueEntry {
  id: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null until the coordinator has recomputed the hash. Render as "checking…". */
  verifiedHash: string | null;
  expiresAt: string;
}

export interface Match {
  id: string;
  opponentId: string;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  source: 'queue' | 'offer';
  createdAt: string;
}

export interface Offer {
  id: string;
  proposerId: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null for the live board; a timestamp for a scheduled proposal. */
  scheduledFor: string | null;
  expiresAt: string;
  state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
  acceptedBy: string | null;
}

/**
 * `user_id` is never sent from here, same rule as `saves.ts`: it defaults to
 * `auth.uid()` in the database, so a client-supplied owner is never a second
 * source of truth the policy has to agree with.
 *
 * `claimed_hash` is computed here with `rulesHash`, never accepted as a
 * caller-supplied value — the coordinator recomputes it independently and
 * writes `verified_hash`, and only a verified entry is eligible to pair. A
 * hash this function trusted a caller for would be a hash the coordinator
 * could never have caught a lie in.
 */
export async function joinQueue(a: {
  league: LeagueId;
  formatVersionId: string;
  format: Format;
  team: StoredMember[];
}): Promise<string> {
  const { data, error } = await supabase
    .from('queue_entries')
    .insert({
      league: a.league,
      format_version_id: a.formatVersionId,
      claimed_hash: await rulesHash(a.format),
      team: a.team,
      data_rev: DATA_REV,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * No filter is sent — `queue_entries_one_per_user` guarantees at most one row
 * is even visible to this user under RLS, so an unscoped delete removes that
 * one row and nothing belonging to anyone else.
 */
export async function leaveQueue(): Promise<void> {
  const { error } = await supabase.from('queue_entries').delete();
  if (error) throw new Error(error.message);
}

export async function myQueueEntry(): Promise<QueueEntry | null> {
  const { data, error } = await supabase
    .from('queue_entries')
    .select('id, league, format_version_id, verified_hash, expires_at');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    id: string;
    league: LeagueId;
    format_version_id: string;
    verified_hash: string | null;
    expires_at: string;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    league: row.league,
    formatVersionId: row.format_version_id,
    verifiedHash: row.verified_hash,
    expiresAt: row.expires_at,
  };
}

/**
 * `matches` has no `opponent_id` column — only `player_a`/`player_b`, since a
 * match row is symmetric and belongs to neither side more than the other.
 * Working out which one is "the opponent" needs to know who is signed in, so
 * this reads the live session rather than trusting either column by position.
 */
export async function myMatches(): Promise<Match[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const me = userData.user?.id;
  const { data, error } = await supabase
    .from('matches')
    .select('id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, source, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      player_a: string;
      player_b: string;
      format_version_id: string;
      rules_hash: string;
      data_rev: string;
      rounds: number;
      source: 'queue' | 'offer';
      created_at: string;
    };
    return {
      id: r.id,
      opponentId: r.player_a === me ? r.player_b : r.player_a,
      formatVersionId: r.format_version_id,
      rulesHash: r.rules_hash,
      dataRev: r.data_rev,
      rounds: r.rounds,
      source: r.source,
      createdAt: r.created_at,
    };
  });
}

export async function listOpenOffers(league: LeagueId): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('match_offers')
    .select('id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by')
    .eq('league', league)
    .eq('state', 'open')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      proposer_id: string;
      league: LeagueId;
      format_version_id: string;
      scheduled_for: string | null;
      expires_at: string;
      state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
      accepted_by: string | null;
    };
    return {
      id: r.id,
      proposerId: r.proposer_id,
      league: r.league,
      formatVersionId: r.format_version_id,
      scheduledFor: r.scheduled_for,
      expiresAt: r.expires_at,
      state: r.state,
      acceptedBy: r.accepted_by,
    };
  });
}

/**
 * `proposer_id` is never sent, same rule as `user_id` above. Checked BEFORE
 * any network call: a scheduled offer in the past is refused here so the
 * caller learns why without a round trip, and before the database's own
 * `match_offers_scheduled_future` constraint would say the same thing less
 * legibly.
 */
export async function createOffer(a: {
  league: LeagueId;
  formatVersionId: string;
  format: Format;
  team: StoredMember[];
  scheduledFor?: Date;
}): Promise<string> {
  if (a.scheduledFor && a.scheduledFor <= new Date()) {
    throw new Error('a scheduled offer cannot be in the past');
  }
  const { data, error } = await supabase
    .from('match_offers')
    .insert({
      league: a.league,
      format_version_id: a.formatVersionId,
      claimed_hash: await rulesHash(a.format),
      team: a.team,
      data_rev: DATA_REV,
      scheduled_for: a.scheduledFor ? a.scheduledFor.toISOString() : null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Goes through `accept_offer(p_offer, p_team)`, never a client UPDATE: the
 * function holds the row lock while it checks state, and a taker permitted to
 * write this row directly would be a taker permitted to edit the terms they
 * are agreeing to. `p_team` is the taker's own roster — `matches.team_b` is
 * NOT NULL for a live offer, and there is no column policy that would let a
 * taker stage it any other way.
 *
 * Returns the new match id for a live offer, or null for a scheduled one —
 * that offer is `accepted`, not yet a match, until the proposer confirms.
 */
export async function acceptOffer(id: string, team: StoredMember[]): Promise<string | null> {
  const { data, error } = await supabase.rpc('accept_offer', { p_offer: id, p_team: team });
  if (error) throw new Error(error.message);
  return data as string | null;
}

/** Goes through `confirm_offer(p_offer)`, the proposer's half of the same handshake. */
export async function confirmOffer(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_offer', { p_offer: id });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Readable only once a match pairs the two of you — see the "an opponent may
 * read your friend code while you have a match" policy on `friend_codes`. No
 * `.single()`: a profile with no code on file yet is zero rows, not an error.
 */
export async function opponentFriendCode(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.from('friend_codes').select('code').eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { code: string }[];
  return rows[0]?.code ?? null;
}
