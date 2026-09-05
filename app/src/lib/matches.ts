import { supabase } from './supabase';

export type MatchState =
  | 'paired' | 'reported' | 'confirmed' | 'mismatch' | 'disputed' | 'unverified' | 'abandoned';

/** Which seat of the match row you are sitting in. */
export type Side = 'a' | 'b';

export interface Match {
  id: string;
  opponentId: string;
  mySide: Side;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  state: MatchState;
  ratingCounted: boolean;
  amendDeadline: string | null;
  source: 'queue' | 'offer';
  createdAt: string;
}

/**
 * The stored array names the winner of each round in MATCH terms. A player
 * thinks in "I won round 2". These two functions are the only place that
 * conversion happens — a flip applied twice, or in one caller and not its
 * neighbour, is a scoreline reported backwards.
 */
export function toMatchTerms(iWon: boolean[], mySide: Side): Side[] {
  const them: Side = mySide === 'a' ? 'b' : 'a';
  return iWon.map((won) => (won ? mySide : them));
}

export function toMyTerms(wins: Side[], mySide: Side): boolean[] {
  return wins.map((w) => w === mySide);
}

const COLUMNS =
  'id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, state, rating_counted, amend_deadline, source, created_at';

interface Row {
  id: string;
  player_a: string;
  player_b: string;
  format_version_id: string;
  rules_hash: string;
  data_rev: string;
  rounds: number;
  state: MatchState;
  rating_counted: boolean;
  amend_deadline: string | null;
  source: 'queue' | 'offer';
  created_at: string;
}

function toMatch(r: Row, me: string | undefined): Match {
  const mySide: Side = r.player_a === me ? 'a' : 'b';
  return {
    id: r.id,
    opponentId: r.player_a === me ? r.player_b : r.player_a,
    mySide,
    formatVersionId: r.format_version_id,
    rulesHash: r.rules_hash,
    dataRev: r.data_rev,
    rounds: r.rounds,
    state: r.state,
    ratingCounted: r.rating_counted,
    amendDeadline: r.amend_deadline,
    source: r.source,
    createdAt: r.created_at,
  };
}

/**
 * `getSession()`, not `getUser()`: `getUser()` is a network round trip that
 * revalidates the JWT and would abort this read on a transient error for an id
 * the caller already holds locally. `app/src/state/SessionContext.tsx` makes
 * the same choice for the same reason.
 */
async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

export async function myMatches(): Promise<Match[]> {
  const me = await myId();
  // The `matches` SELECT policy (`auth.uid() in (player_a, player_b)`) is
  // what actually keeps a signed-out or session-less caller from ever
  // reaching the map below with rows — an unauthenticated `select` here comes
  // back `[]` regardless. This early return exists anyway so that guarantee
  // is not the only thing standing between `toMatch` and a bug: `toMatch`
  // resolves `mySide` with `r.player_a === me ? 'a' : 'b'`, so a caller that
  // ever did reach it with `me` undefined would silently be told it is
  // player_b of every match — inverting the reported scoreline in
  // `toMatchTerms` without throwing or failing any constraint.
  if (!me) return [];
  const { data, error } = await supabase
    .from('matches')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toMatch(row as unknown as Row, me));
}

export async function submitReport(matchId: string, wins: Side[]): Promise<MatchState> {
  const { data, error } = await supabase.rpc('submit_report', {
    p_match_id: matchId,
    p_wins: wins,
  });
  if (error) throw new Error(error.message);
  return data as MatchState;
}

export async function myReport(
  matchId: string,
): Promise<{ wins: Side[]; amendCount: number } | null> {
  const me = await myId();
  if (!me) return null;
  const { data, error } = await supabase
    .from('match_reports')
    .select('wins, amend_count')
    .eq('match_id', matchId)
    .eq('reporter_id', me)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as { wins: Side[]; amend_count: number };
  return { wins: r.wins, amendCount: r.amend_count };
}

export async function adjudicatedRounds(
  matchId: string,
): Promise<{ roundNo: number; winner: string }[]> {
  const { data, error } = await supabase
    .from('match_rounds')
    .select('round_no, winner')
    .eq('match_id', matchId)
    .order('round_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as { round_no: number; winner: string };
    return { roundNo: r.round_no, winner: r.winner };
  });
}
