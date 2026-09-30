import { ROSTERS_VISIBLE, toGames, type Entrant, type Pairing, type TournamentState } from '../../lib/tournaments';
import type { RosterMember } from '../../tournament/roster';
import { PlayerRoster } from './RosterCard';
import { playerName } from './playerName';

interface Props {
  entrants: readonly Entrant[]; rosters: ReadonlyMap<string, readonly RosterMember[]>;
  names: ReadonlyMap<string, string>; state: TournamentState; isHost: boolean; me: string | null;
  organiserId: string; onRemove?: (playerId: string) => void; pairings: readonly Pairing[]; now: Date;
}

export function PlayersTab({ entrants, rosters, names, state, isHost, me, organiserId, onRemove, pairings, now }: Props) {
  const open = ROSTERS_VISIBLE.includes(state);
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const g of toGames(pairings, now)) {
    if (g.b === null) { bump(wins, g.a); continue; }
    if (g.scoreA === g.scoreB) continue;
    const [w, l] = g.scoreA > g.scoreB ? [g.a, g.b] : [g.b, g.a];
    bump(wins, w); bump(losses, l);
  }
  const list = entrants.filter((e) => rosters.has(e.playerId) && (open || e.playerId === me));
  return (
    <div className="players-tab">
      {!open && <p className="text-muted">Teams are hidden until registration closes</p>}
      {open && list.length === 0 && <p className="text-muted">No teams yet</p>}
      {list.map((e) => {
        const id = e.playerId;
        const canRemove = isHost && !!onRemove && id !== organiserId;
        return (
          <PlayerRoster key={id} name={playerName(names, id)} dropped={e.dropped} roster={rosters.get(id)!}
            record={`Wins: ${wins.get(id) ?? 0} - Losses: ${losses.get(id) ?? 0}`}
            action={canRemove ? (
              <button type="button" className="btn" onClick={() => {
                if (window.confirm(`Remove ${playerName(names, id)} from this tournament?`)) onRemove(id);
              }}>Remove player</button>
            ) : undefined} />
        );
      })}
    </div>
  );
}
