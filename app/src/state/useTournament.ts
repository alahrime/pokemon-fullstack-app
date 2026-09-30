import { useCallback, useEffect, useRef, useState } from 'react';
import type { Format } from '../rules';
import type { RosterMember } from '../tournament/roster';
import { resolveDisplayNames } from '../lib/channels';
import {
  effectiveState, getTournament, isLivePairing, getTournamentFormat, listEntrants, listJudges, listPairings, listRosters,
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
  const [settledId, setSettledId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    setData(EMPTY);
    setFormat(null);
    setError(null);
    setSettledId(null);
    if (!uid) return;
    let live = true;
    let seq = 0;
    let haveFormat = false;
    const load = () => {
      const mine = ++seq;
      void (async () => {
        try {
          // The rules are read again on every load until one read lands.
          const [tournament, entrants, pairings, rosters, judges, fmt] = await Promise.all([
            getTournament(id), listEntrants(id), listPairings(id), listRosters(id), listJudges(id),
            haveFormat ? Promise.resolve(null) : getTournamentFormat(id).catch(() => null),
          ]);
          // Only the latest started load may write: an older one landing late is stale.
          if (!live || mine !== seq) return;
          if (fmt) { haveFormat = true; setFormat(fmt); }
          // Names are cosmetic: a failed lookup must not discard the tournament.
          const who = [...(tournament ? [tournament.organiserId] : []), ...judges, ...entrants.map((e) => e.playerId)];
          const names = await resolveDisplayNames(who).catch(() => null);
          if (!live || mine !== seq) return;
          setData((d) => ({ tournament, entrants, pairings, rosters, judges, names: names ?? d.names }));
          setError(null);
        } catch (e) {
          if (live && mine === seq) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (live && mine === seq) setSettledId(id);
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
  const hasPending = !!tournament && tournament.state === 'running' && pairings.some((p) => isLivePairing(p, tournament, uid));
  const pollMs = hasPending ? LIVE_POLL_MS : POLL_MS;
  useEffect(() => {
    if (!uid) return;
    const t = setInterval(() => loadRef.current(), pollMs);
    return () => clearInterval(t);
  }, [id, uid, pollMs]);

  // Re-render when the next deadline passes (registration close, round end, a
  // report's finality), poll or no poll. `tick` makes the effect re-arm for the
  // one after.
  const nowMs = Date.now();
  const deadlines = [
    tournament?.state === 'registration' ? tournament.registrationClosesAt : null,
    tournament?.state === 'running' ? tournament.roundEndsAt : null,
    ...(tournament?.state === 'running' ? pairings.map((p) => (p.state === 'reported' ? p.finalAt : null)) : []),
  ].map((d) => (d ? Date.parse(d) : NaN)).filter((t) => t > nowMs);
  const next = deadlines.length ? Math.min(...deadlines) : null;
  useEffect(() => {
    if (next === null) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(next - Date.now(), 0) + 50, MAX_TIMEOUT));
    return () => clearTimeout(t);
  }, [next]);

  const refresh = useCallback(() => loadRef.current(), []);
  return {
    ...data, format, me: uid, loading: !!uid && settledId !== id, error, refresh,
    state: tournament ? effectiveState(tournament, new Date()) : null,
  };
}
