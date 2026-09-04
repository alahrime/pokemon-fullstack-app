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

export type OfferState = 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';

export interface Offer {
  id: string;
  proposerId: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null for the live board; a timestamp for a scheduled proposal. */
  scheduledFor: string | null;
  expiresAt: string;
  state: OfferState;
  acceptedBy: string | null;
  /**
   * Null until the coordinator has recomputed the hash — and `accept_offer`
   * raises `'this offer has not been verified yet'` for exactly that. The
   * coordinator ticks once a minute, so every offer spends its first minute
   * here: this is the normal beginning of an offer's life, not an edge case,
   * and a board that does not read this column offers an Accept button that
   * can only fail for a minute after every post.
   */
  verifiedHash: string | null;
  /**
   * How many members a roster accepting THIS offer needs — the length of the
   * roster the proposer posted, which they built under this offer's own
   * format. The accepter's own saved format has no say: `accept_offer` takes
   * no format argument, and the offer's `format_version_id` is what the match
   * is played under.
   *
   * Derived from `team` rather than from `format_versions.rules`, and that is
   * a real constraint rather than laziness: versions are readable only for a
   * format whose `visibility = 'public'` ("versions of a public format are
   * readable by anyone signed in"), and a saved format defaults to `private`.
   * Embedding the rules would hand back null for most offers on the board —
   * precisely for the strangers whose offers this number exists to size. The
   * team is readable under the same row policy that shows the offer at all.
   */
  rosterSize: number;
}

/**
 * An offer the signed-in person is party to. The extra field over `Offer` is
 * the match it became: an offer only carries one once it has been confirmed
 * (or, for a live offer, converted on acceptance), so a null `matchId` beside
 * `state = 'accepted'` is precisely the handshake still waiting on someone.
 */
export interface MyOffer extends Offer {
  matchId: string | null;
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
 * Filtered by the caller's own `user_id`, read from the local session —
 * `saves.ts`'s `deleteTeam` filters its delete with `.eq('id', id)` even
 * though its RLS policy also scopes correctly on its own, and that is this
 * codebase's established discipline for a DELETE: a redundant predicate that
 * matches what RLS already computes is ordinary defence in depth, not a
 * second source of truth the way a client-supplied owner on INSERT would be.
 * Without it, this call is literally "delete every queue entry you can see",
 * and its safety would rest entirely on one RLS policy staying exactly as
 * written across every future migration.
 *
 * `getSession()`, not `getUser()`: a local read of the already-verified
 * session, not a network round trip that revalidates the JWT against the
 * Auth server on every call — the same choice `SessionContext.tsx` makes and
 * explains.
 */
export async function leaveQueue(): Promise<void> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const userId = data.session?.user.id;
  if (!userId) throw new Error('you must be signed in to leave the queue');
  const { error } = await supabase.from('queue_entries').delete().eq('user_id', userId);
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
 * this reads the local session rather than trusting either column by
 * position.
 *
 * `getSession()`, not `getUser()`: `getUser()` is a real network round trip
 * that revalidates the JWT against the Auth server, and would abort this
 * whole read on a transient network error for an id the caller already has
 * locally. `SessionContext.tsx` makes the same choice for the same reason.
 */
export async function myMatches(): Promise<Match[]> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const me = sessionData.session?.user.id;
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
    .select(
      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, team',
    )
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
      state: OfferState;
      accepted_by: string | null;
      verified_hash: string | null;
      team: StoredMember[] | null;
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
      verifiedHash: r.verified_hash,
      // The count, not the members. `match_offers`' select policy is
      // whole-row, so the proposer's roster is legible to anyone who can see
      // the offer — but this screen has no business rendering it, and what
      // never leaves this function cannot be rendered by accident.
      rosterSize: (r.team ?? []).length,
    };
  });
}

/**
 * Every offer the signed-in person is party to — the ones they proposed AND
 * the ones they accepted — in every state, not just `open`.
 *
 * `listOpenOffers` cannot do this job and must not be widened to try. An
 * offer leaves `state = 'open'` the instant someone accepts it, so a proposer
 * whose only view of their own proposal was the open board loses sight of it
 * at exactly the moment it needs their confirmation — the offer then lapses
 * on its own expiry and the match is never created. The taker is stranded the
 * same way: their acceptance is a row they can no longer see. Both sides need
 * to rediscover the handshake on a fresh page load, from the database, which
 * is what this reads.
 *
 * `match_id` is selected here and nowhere else: it is the only thing that
 * distinguishes "confirmed, and here is the match it became" from a state
 * string alone.
 *
 * Both halves of the OR are already readable under the existing policies —
 * "an offer belongs to the person who proposed it" covers the proposer's own
 * rows in any state, and "a public offer is readable by anyone signed in"
 * covers the taker's. The filter is not what makes this safe; it is what
 * keeps the answer to "mine" from being "everyone's".
 *
 * `getSession()`, not `getUser()`: a local read of the already-verified
 * session, the same choice `leaveQueue` and `myMatches` make above.
 */
export async function myOffers(): Promise<MyOffer[]> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const me = sessionData.session?.user.id;
  if (!me) throw new Error('you must be signed in to list your offers');
  const { data, error } = await supabase
    .from('match_offers')
    .select(
      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, match_id, team',
    )
    .or(`proposer_id.eq.${me},accepted_by.eq.${me}`)
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
      state: OfferState;
      accepted_by: string | null;
      verified_hash: string | null;
      match_id: string | null;
      team: StoredMember[] | null;
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
      verifiedHash: r.verified_hash,
      matchId: r.match_id,
      rosterSize: (r.team ?? []).length,
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
