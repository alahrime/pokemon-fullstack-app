import { supabase } from './supabase';
import { DATA_REV } from './data';
import { rulesHash, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';
import type { OfferState } from './matchmaking';

export type ChallengeState = OfferState | 'declined';

export interface Challenge {
  id: string;
  proposerId: string;
  targetId: string;
  league: LeagueId;
  state: ChallengeState;
  scheduledFor: string | null;
  expiresAt: string;
  /** Null for the first minute: the coordinator has not recomputed the hash yet. */
  verifiedHash: string | null;
  matchId: string | null;
  /** Length of the proposer's team — what the accepter's roster must match. */
  rosterSize: number;
  formatName: string | null;
}

export type ChallengeAction = 'accept' | 'decline' | 'confirm' | 'withdraw';
export interface ChallengeView {
  label: string;
  tone: 'open' | 'wait' | 'done' | 'dead';
  actions: ChallengeAction[];
}

/** What a card says and offers, for one viewer at one moment. Pure. */
export function challengeView(c: Challenge | null, me: string, now: Date): ChallengeView {
  if (!c) return { label: 'Withdrawn', tone: 'dead', actions: [] };
  if (c.state === 'converted') return { label: 'Match on — open it', tone: 'done', actions: [] };
  if (c.state === 'declined') return { label: 'Declined', tone: 'dead', actions: [] };
  const live = c.state === 'open' || c.state === 'accepted';
  if (c.state === 'lapsed' || (live && new Date(c.expiresAt) <= now)) {
    return { label: 'Expired', tone: 'dead', actions: [] };
  }
  const mine = c.proposerId === me;
  const theirs = c.targetId === me;
  if (c.state === 'open') {
    if (theirs) {
      return c.verifiedHash
        ? { label: 'Waiting for you', tone: 'open', actions: ['accept', 'decline'] }
        : { label: 'Verifying the format…', tone: 'wait', actions: ['decline'] };
    }
    if (mine) {
      return {
        label: c.verifiedHash ? 'Waiting for them' : 'Verifying the format…',
        tone: 'wait',
        actions: ['withdraw'],
      };
    }
  }
  if (c.state === 'accepted') {
    if (mine) return { label: 'They accepted — confirm to lock it in', tone: 'open', actions: ['confirm', 'withdraw'] };
    if (theirs) return { label: 'Accepted — waiting for them to confirm', tone: 'wait', actions: [] };
  }
  return { label: 'Pending', tone: 'wait', actions: [] };
}

export async function createChallenge(a: {
  targetId: string;
  league: LeagueId;
  formatVersionId: string;
  format: Format;
  team: StoredMember[];
  scheduledFor?: Date;
}): Promise<string> {
  if (a.scheduledFor && a.scheduledFor <= new Date()) {
    throw new Error('a scheduled challenge cannot be in the past');
  }
  const { data, error } = await supabase.rpc('create_challenge', {
    p_target: a.targetId,
    p_format_version: a.formatVersionId,
    p_claimed_hash: await rulesHash(a.format),
    p_league: a.league,
    p_team: a.team,
    p_data_rev: DATA_REV,
    p_scheduled_for: a.scheduledFor ? a.scheduledFor.toISOString() : null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function declineChallenge(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('decline_challenge', { p_offer: id });
  if (error) throw new Error(error.message);
  return data as boolean;
}

/** The proposer's own row, deleted under the existing "an offer belongs to the person who proposed it" policy. */
export async function withdrawChallenge(id: string): Promise<void> {
  const { error } = await supabase.from('match_offers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

const COLS =
  'id, proposer_id, target_id, league, state, scheduled_for, expires_at, verified_hash, match_id, team, format_versions(formats(name))';

interface Row {
  id: string;
  proposer_id: string;
  target_id: string;
  league: LeagueId;
  state: ChallengeState;
  scheduled_for: string | null;
  expires_at: string;
  verified_hash: string | null;
  match_id: string | null;
  team: unknown[] | null;
  // PostgREST returns an embedded to-one as an object, but the generated
  // types say array; read both.
  format_versions?: { formats?: { name: string } | { name: string }[] | null } | { formats?: { name: string } | { name: string }[] | null }[] | null;
}

function nameOf(fv: Row['format_versions']): string | null {
  const v = Array.isArray(fv) ? fv[0] : fv;
  const f = Array.isArray(v?.formats) ? v?.formats[0] : v?.formats;
  return f?.name ?? null;
}

function toChallenge(r: Row): Challenge {
  return {
    id: r.id,
    proposerId: r.proposer_id,
    targetId: r.target_id,
    league: r.league,
    state: r.state,
    scheduledFor: r.scheduled_for,
    expiresAt: r.expires_at,
    verifiedHash: r.verified_hash,
    matchId: r.match_id,
    rosterSize: (r.team ?? []).length,
    formatName: nameOf(r.format_versions),
  };
}

/** Keyed by id; an id with no row (withdrawn, or not yours) is simply absent. */
export async function fetchChallenges(ids: string[]): Promise<Map<string, Challenge>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('match_offers').select(COLS).in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [(r as unknown as Row).id, toChallenge(r as unknown as Row)]));
}

/** Challenges I sent or received, newest first — the bell's raw material. */
export async function myChallenges(): Promise<Challenge[]> {
  const { data: s, error: se } = await supabase.auth.getSession();
  if (se) throw new Error(se.message);
  const me = s.session?.user.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('match_offers')
    .select(COLS)
    .not('target_id', 'is', null)
    .or(`proposer_id.eq.${me},target_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toChallenge(r as unknown as Row));
}

/**
 * Calls `onChange` whenever the offer row `offerId` is updated or deleted, so a card can refetch at once.
 * The payload is ignored on purpose: the card needs the joined view, and a refetch goes through RLS.
 * `id=eq.` is a primary-key filter, which Realtime supports for deletes as well as updates.
 *
 * The teardown is idempotent and each call opens a uniquely named channel, for the same StrictMode reasons
 * as `subscribeToChannel` in channels.ts.
 */
export function subscribeToOffer(offerId: string, onChange: () => void): () => void {
  const sub = supabase
    .channel(`offer:${offerId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_offers', filter: `id=eq.${offerId}` }, () => onChange())
    .subscribe();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    supabase.removeChannel(sub);
  };
}
