import { supabase } from './supabase';
import { DATA_REV } from './data';
import type { LeagueId } from './types';
import type { PublicMember, StoredMember } from './teamCodec';

/**
 * The row shape lives in `matches.ts` now, alongside everything else about
 * what happens inside a match (reporting, adjudication, the perspective
 * conversion). Re-exported here so `MatchmakingScreen.tsx` — which only lists
 * your matches — keeps importing both from this module.
 */
export { myMatches, type Match } from './matches';

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
   * Null unless something recomputed the hash. Nothing does since the
   * coordinator was removed (2026-10-15): challenges skip the check in
   * `accept_offer`, and the public board that needed it is gone.
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
   * a real constraint rather than laziness: versions are readable for a
   * format whose `visibility = 'public'` ("versions of a public format are
   * readable by anyone signed in") and, for a PRIVATE format, only by its
   * owner and by the target/taker of a challenge or offer on that one
   * version — and a saved format defaults to `private`.
   * Embedding the rules would hand back null for most offers on the board —
   * precisely for the strangers whose offers this number exists to size. The
   * team is readable under the same row policy that shows the offer at all.
   */
  rosterSize: number;
  /**
   * The members themselves, in the order they were posted — and carrying them
   * here is a REVERSAL of an earlier decision, taken deliberately.
   *
   * Both mappers below used to reduce `team` to its length and drop the rest,
   * on the reasoning that a screen with no business rendering the roster
   * cannot render it by accident if it never receives it. That was sound while
   * the board was a list of timestamps. It is not sound now: the board's whole
   * job is deciding whether to accept an offer, and a row that will not say
   * who you would be playing against cannot be used to decide that. Rendering
   * the roster is the point, so the roster comes through.
   *
   * Both fields, never one instead of the other. `rosterSize` is what
   * `canAccept` compares your own roster's length against and what
   * `unacceptableReason` refuses a roster-less offer on; `roster` is what the
   * row draws. Recomputing the count from `roster.length` at those call sites
   * instead would put the accept gate at the mercy of a rendering concern.
   *
   * `[]`, never null, for a row with no team — a shape the screen can map over
   * unconditionally, the same rule `rosterSize`'s zero follows.
   *
   * This discloses nothing new. `match_offers`' select policy is whole-row, so
   * the proposer's roster was always legible to anyone who could see the
   * offer; what changes is only whether this app looks at it.
   */
  roster: PublicMember[];
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
 * session, the same choice `leaveQueue` makes above and `myMatches` makes in
 * `app/src/lib/matches.ts`, where it now lives.
 */
export async function myOffers(): Promise<MyOffer[]> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const me = sessionData.session?.user.id;
  if (!me) throw new Error('you must be signed in to list your offers');
  const { data, error } = await supabase
    .from('match_offers')
    .select(
      'id, proposer_id, league, format_version_id, scheduled_for, expires_at, state, accepted_by, verified_hash, match_id, team_public',
    )
    .or(`proposer_id.eq.${me},accepted_by.eq.${me}`)
    // Aimed offers are challenges, read through lib/challenges.ts; they must never reach the board or the Matches screen's own lists.
    .is('target_id', null)
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
      team_public: PublicMember[] | null;
    };
    // Same coalesce as `listOpenOffers`. Two mappers is where a field gets
    // carried in one and forgotten in the other, and the tests hold both.
    const team = r.team_public ?? [];
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
      rosterSize: team.length,
      roster: team,
    };
  });
}

/**
 * Goes through `accept_offer(p_offer, p_team, p_data_rev)`, never a client
 * UPDATE: the function holds the row lock while it checks state, and a taker
 * permitted to write this row directly would be a taker permitted to edit the
 * terms they are agreeing to — and, as the branch review measured, to forge an
 * acceptance in someone else's name. `p_team` is the taker's own roster —
 * `matches.team_b` is NOT NULL for a live offer, and there is no column policy
 * that would let a taker stage it any other way.
 *
 * `p_data_rev` is `DATA_REV`, this build's data revision, and it is not
 * optional: the function refuses an offer posted on a different build.
 * `joinQueue` and `createOffer` both write `DATA_REV` into their own row and
 * `pair_queue_entries` refuses to pair across builds; accepting is the third
 * way into a match and has to answer the same question. Sent as an argument
 * rather than read from the offer, because the whole point is that the two
 * might disagree.
 *
 * Returns the new match id for a live offer, or null for a scheduled one —
 * that offer is `accepted`, not yet a match, until the proposer confirms.
 */
export async function acceptOffer(id: string, team: StoredMember[]): Promise<string | null> {
  const { data, error } = await supabase.rpc('accept_offer', {
    p_offer: id,
    p_team: team,
    p_data_rev: DATA_REV,
  });
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
