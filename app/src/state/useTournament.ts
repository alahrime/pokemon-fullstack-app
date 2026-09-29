import { useCallback, useEffect, useRef, useState } from 'react';
import type { Format } from '../rules';
import type { RosterMember } from '../tournament/roster';
import { resolveDisplayNames } from '../lib/channels';
import {
  effectiveState, getTournament, getTournamentFormat, listEntrants, listJudges, listPairings, listRosters,
  type Entrant, type Pairing, type Tournament, type TournamentState,
} from '../lib/tournaments';
import { useSession } from './SessionContext';

const POLL_MS = 15_000;
const LIVE_POLL_MS = 10_000;
const MAX_TIMEOUT = 2 ** 31 - 1;

export interface TournamentView {
  tournament: Tournament | null;
  entrants: Entrant[];
  pairings: Pairing[];
  rosters: Map<string, RosterMember[]>;
  judges: string[];
  names: Map<string, string>;
  format: { name: string; format: Format } | null;
  me: string | null;
  /** Derived from the clock on every render: a lapsed deadline reads as closed with no refetch. */
  state: TournamentState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface Data {
  tournament: Tournament | null; entrants: Entrant[]; pairings: Pairing[];
  rosters: Map<string, RosterMember[]>; judges: string[]; names: Map<string, string>;
}
const EMPTY: Data = { tournament: null, entrants: [], pairings: [], rosters: new Map(), judges: [], names: new Map() };

/**
 * One tournament, polled every 15 s (10 s while a round runs and I have a
 * pending pairing). A failed read keeps the last data and sets `error`; a
 * response for another id or a signed-out session is dropped. Nothing is read
 * while signed out.
 */
export function useTournament(id: string): TournamentView {
  const { user } = useSession();
  const uid = user?.id ?? null;
  const [data, setData] = useState<Data>(EMPTY);
  const [format, setFormat] = useState<TournamentView['format']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    setData(EMPTY);
    setFormat(null);
    setError(null);
    setLoading(!!uid);
    if (!uid) return;
    let live = true;
    getTournamentFormat(id).then((f) => live && setFormat(f)).catch(() => {});
    const load = () => {
      void (async () => {
        try {
          const [tournament, entrants, pairings, rosters, judges] = await Promise.all([
            getTournament(id), listEntrants(id), listPairings(id), listRosters(id), listJudges(id),
          ]);
          if (!live) return;
          // Names are cosmetic: a failed lookup must not discard the tournament.
          const who = [...(tournament ? [tournament.organiserId] : []), ...judges, ...entrants.map((e) => e.playerId)];
          const names = await resolveDisplayNames(who).catch(() => null);
          if (!live) return;
          setData((d) => ({ tournament, entrants, pairings, rosters, judges, names: names ?? d.names }));
          setError(null);
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (live) setLoading(false);
        }
      })();
    };
    loadRef.current = load;
    load();
    return () => {
      live = false;
      loadRef.current = () => {};
    };
  }, [id, uid]);

  const { tournament, pairings } = data;
  const hasPending = !!uid && !!tournament && tournament.state === 'running' && pairings.some(
    (p) => p.round === tournament.currentRound && p.state === 'pending' && (p.playerA === uid || p.playerB === uid),
  );
  const pollMs = hasPending ? LIVE_POLL_MS : POLL_MS;
  useEffect(() => {
    if (!uid) return;
    const t = setInterval(() => loadRef.current(), pollMs);
    return () => clearInterval(t);
  }, [id, uid, pollMs]);

  // Re-render when the registration deadline passes, poll or no poll.
  const closesAt = tournament?.state === 'registration' ? tournament.registrationClosesAt : null;
  useEffect(() => {
    if (!closesAt) return;
    const ms = Date.parse(closesAt) - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(ms + 50, MAX_TIMEOUT));
    return () => clearTimeout(t);
  }, [closesAt]);

  const refresh = useCallback(() => loadRef.current(), []);
  return {
    ...data, format, me: uid, loading, error, refresh,
    state: tournament ? effectiveState(tournament, new Date()) : null,
  };
}
