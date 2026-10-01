import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { resolveDisplayNames } from '../lib/channels';
import { listMyRecords, summarise, type RecordRow } from '../lib/records';
import { listPlayerGames, type PlayerGame } from '../lib/tournaments';
import { TeamGrid } from '../components/tournament/RosterCard';
import type { TeamMember } from '../tournament/roster';

/** One finished game: result, what it was, the score, and (folded) both sixes. */
function Line({ won, what, score, aTitle, a, bTitle, b }: {
  won: boolean; what: ReactNode; score: string; aTitle: string; a: readonly TeamMember[] | null; bTitle: string; b: readonly TeamMember[] | null;
}) {
  return (
    <li className="player-line">
      <span className={won ? 'records-win' : 'records-loss'}>{won ? 'W' : 'L'}</span>
      <span className="player-line-what">{what}</span>
      <span className="numeric">{score}</span>
      <details className="records-teams">
        <summary>Pokémon</summary>
        <div className="matchup-rosters">
          {a ? <TeamGrid title={aTitle} team={a} /> : <p className="text-muted">{aTitle}: not shown.</p>}
          {b ? <TeamGrid title={bTitle} team={b} /> : <p className="text-muted">{bTitle}: not shown.</p>}
        </div>
      </details>
    </li>
  );
}

/**
 * A player's profile: their tournament record (public to every signed-in user, with both sixes once
 * registration closed) and, for anyone but yourself, your own matches against them (free matches stay
 * private to the two players, so this is the only place a free match shows up on someone else's page).
 */
export function PlayerScreen() {
  const { state, patch } = useAppState();
  const { user } = useSession();
  const id = state.activePlayerId;
  const me = user?.id ?? null;
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [games, setGames] = useState<PlayerGame[] | null>(null);
  const [mine, setMine] = useState<RecordRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!me || !id) return;
    let live = true;
    setGames(null); setMine(null); setFailed(false);
    Promise.all([listPlayerGames(id), id === me ? Promise.resolve([] as RecordRow[]) : listMyRecords()])
      .then(async ([g, r]) => {
        const n = await resolveDisplayNames([id, ...g.map((x) => x.opponentId), ...r.filter((x) => x.opponentId === id).map((x) => x.opponentId)]);
        if (live) { setGames(g); setMine(r.filter((x) => x.opponentId === id)); setNames(n); }
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [me, id]);

  const sum = useMemo(() => {
    const w = (games ?? []).filter((g) => g.won).length;
    return { w, l: (games ?? []).length - w };
  }, [games]);
  const h2h = useMemo(() => summarise(mine ?? []), [mine]);
  const name = (uid: string) => names.get(uid) ?? 'Unknown player';
  const toRecords = () => patch({ screen: 'records', activePlayerId: null });
  const open = (uid: string) => patch({ screen: 'player', activePlayerId: uid });

  if (!user) {
    return (
      <div className="records-screen">
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see player profiles.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </div>
    );
  }
  if (!id) {
    return (
      <div className="records-screen">
        <p className="panel text-muted">No player selected.</p>
        <div><button type="button" className="btn" onClick={toRecords}>← Records</button></div>
      </div>
    );
  }

  return (
    <div className="records-screen">
      <div><button type="button" className="btn" onClick={toRecords}>← Records</button></div>
      <h2 className="player-name">{names.get(id) ?? (games === null && !failed ? 'Loading…' : 'Unknown player')}</h2>
      {failed && <p className="friend-notice" role="alert">Couldn't load this profile.</p>}
      {id === me && <p className="panel text-muted">This is you. Your full match history is on Records.</p>}

      {id !== me && mine && (
        <section className="panel chamfer-9 records-history" aria-label="Your matches">
          <h3 className="hud-label">Your matches against {name(id)}{mine.length > 0 && ` · ${h2h.wins}–${h2h.games - h2h.wins}`}</h3>
          {mine.length === 0 ? <p className="text-muted">You have not played them.</p> : (
            <ul>
              {mine.map((r) => (
                <Line key={r.matchId} won={r.won} score={`${r.myRounds}–${r.oppRounds}`}
                  what={<time dateTime={r.playedAt}>{new Date(r.playedAt).toLocaleDateString('en-CA')}</time>}
                  aTitle="You" a={r.myTeam} bTitle={name(id)} b={r.oppTeam} />
              ))}
            </ul>
          )}
        </section>
      )}

      {games && (
        <section className="panel chamfer-9 records-history" aria-label="Tournament games">
          <h3 className="hud-label">Tournament games{games.length > 0 && ` · ${sum.w}–${sum.l}`}</h3>
          {games.length === 0 ? <p className="text-muted">No finished tournament games.</p> : (
            <ul>
              {games.map((g, i) => (
                <Line key={`${g.tournamentId}-${g.round}-${i}`} won={g.won} score={`${g.myRounds}–${g.oppRounds}`}
                  what={<>
                    <button type="button" className="btn btn-ghost" onClick={() => patch({ screen: 'tournaments', activeTournamentId: g.tournamentId })}>{g.title}</button>
                    {' '}R{g.round} vs{' '}
                    <button type="button" className="btn btn-ghost" onClick={() => open(g.opponentId)}>{name(g.opponentId)}</button>
                  </>}
                  aTitle={name(id)} a={g.myRoster} bTitle={name(g.opponentId)} b={g.oppRoster} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
