import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { LEAGUE_BY_ID } from '../lib/data';
import {
  RANKED_LEAGUES, MIN_GAMES, MAX_RD, getLeaderboard, getMyRating, gateStatus, listSeasons, seasonLabel,
  type BoardRow, type MyRating, type RankedLeague, type Season,
} from '../lib/ranked';

const POLL_MS = 60_000;

export function RankedScreen() {
  const { patch } = useAppState();
  const { user } = useSession();
  const uid = user?.id ?? null;
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [league, setLeague] = useState<RankedLeague>('great');
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [mine, setMine] = useState<MyRating | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    listSeasons()
      .then((s) => live && (setSeasons(s), setSeasonId((cur) => cur ?? s[0]?.id ?? null)))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [uid]);

  useEffect(() => {
    if (!uid || !seasonId) return;
    setBoard(null);
    setMine(null);
    let live = true;
    const load = () =>
      void Promise.all([getLeaderboard(seasonId, league), getMyRating(seasonId, league, uid)])
        .then(([b, m]) => live && (setBoard(b), setMine(m), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    const id = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [uid, seasonId, league]);

  if (!user) {
    return (
      <div className="ranked-screen">
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see the ladder.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </div>
    );
  }

  const gate = mine ? gateStatus(mine) : null;
  return (
    <div className="ranked-screen">
      <div className="tournaments-bar">
        <div className="seg-group" role="tablist" aria-label="League">
          {RANKED_LEAGUES.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={league === l}
              className={`btn seg-btn${league === l ? ' is-active' : ''}`} onClick={() => setLeague(l)}>
              {LEAGUE_BY_ID.get(l)?.label ?? l}
            </button>
          ))}
        </div>
        {seasons && seasons.length > 0 && (
          <select aria-label="Season" value={seasonId ?? ''} onChange={(e) => setSeasonId(e.target.value)}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{seasonLabel(s)}</option>)}
          </select>
        )}
      </div>

      {failed && board === null && <p className="friend-notice" role="alert">Couldn't load the ladder.</p>}
      {seasons && seasons.length === 0 && <p className="panel text-muted">No rated games this season yet.</p>}

      {mine && gate && !gate.listed && (
        <p className="panel chamfer-9 ranked-provisional" data-testid="provisional">
          You: {Math.round(mine.rating)} ± {Math.round(mine.rd)} · {mine.games} of {MIN_GAMES} games
          {gate.gamesLeft === 0 && gate.needsRd ? ` — rating still settling (needs ± ${MAX_RD} or less)` : ''}
        </p>
      )}

      {board && board.length === 0 && seasons && seasons.length > 0 && (
        <p className="panel text-muted">Nobody has cleared the gate yet.</p>
      )}
      {board && board.length > 0 && (
        <div className="panel chamfer-9 ranked-board">
          <table>
            <caption className="sr-only">{LEAGUE_BY_ID.get(league)?.label ?? league} ladder</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Rating</th><th scope="col">W–L</th></tr></thead>
            <tbody>
              {board.map((r) => (
                <tr key={r.userId} className={r.userId === uid ? 'is-me' : undefined}>
                  <td>{r.pos}</td>
                  <td>{r.name}</td>
                  <td>{r.rating} ± {r.rd}</td>
                  <td>{r.wins}–{r.games - r.wins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
