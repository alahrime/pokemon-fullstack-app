import { standings } from '../../tournament/swiss';
import { toGames, type Entrant, type Pairing } from '../../lib/tournaments';
import { playerName } from './playerName';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Counted games only; dropped players are ranked among themselves after everyone still in. */
export function Standings({ entrants, names, pairings, now }: {
  entrants: readonly Entrant[]; names: ReadonlyMap<string, string>; pairings: readonly Pairing[]; now: Date;
}) {
  const dropped = new Set(entrants.filter((e) => e.dropped).map((e) => e.playerId));
  const all = standings(entrants.map((e) => e.playerId), toGames(pairings, now));
  const rows = [...all.filter((s) => !dropped.has(s.id)), ...all.filter((s) => dropped.has(s.id))];
  if (rows.length === 0) return <p className="panel text-muted">No players yet</p>;
  return (
    <div className="standings-scroll">
      <table className="standings">
        <thead>
          <tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Record</th><th scope="col">OMW %</th><th scope="col">GWP %</th></tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id}>
              <td className="numeric">{i + 1}</td>
              <td className={dropped.has(s.id) ? 'is-dropped' : ''}>
                {playerName(names, s.id)}{dropped.has(s.id) && <span className="text-muted"> dropped</span>}
              </td>
              <td className="numeric">{s.matchWins}–{s.matches - s.matchWins}</td>
              <td className="numeric">{pct(s.omw)}</td>
              <td className="numeric">{pct(s.gwp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
