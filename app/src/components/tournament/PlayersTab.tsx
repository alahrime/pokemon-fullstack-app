import { useRef, useState } from 'react';
import { ROSTERS_VISIBLE, toGames, type Entrant, type Pairing, type TournamentState } from '../../lib/tournaments';
import type { RosterMember } from '../../tournament/roster';
import { PlayerRoster } from './RosterCard';
import { playerName } from './playerName';

interface Props {
  entrants: readonly Entrant[]; rosters: ReadonlyMap<string, readonly RosterMember[]>;
  names: ReadonlyMap<string, string>; state: TournamentState; isHost: boolean; me: string | null;
  organiserId: string; hideMine?: boolean; onRemove?: (playerId: string) => void | Promise<void>; onProfile?: (playerId: string) => void; pairings: readonly Pairing[]; now: Date;
}

export function PlayersTab({ entrants, rosters, names, state, isHost, me, organiserId, hideMine = false, onRemove, onProfile, pairings, now }: Props) {
  const open = ROSTERS_VISIBLE.includes(state);
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const remove = async (id: string) => {
    const running = state === 'running';
    if (removingRef.current || !window.confirm(`Remove ${playerName(names, id)} from this tournament? ${running ? 'Any unfinished game this round is forfeited.' : 'They will be removed from the tournament.'}`)) return;
    removingRef.current = true;
    setRemoving(true);
    try { await onRemove?.(id); } finally { removingRef.current = false; setRemoving(false); }
  };
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const g of toGames(pairings, now)) {
    if (g.b === null) { bump(wins, g.a); continue; }
    if (g.scoreA === g.scoreB) { bump(losses, g.a); bump(losses, g.b); continue; } // double loss, as standings() counts it
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
        const canRemove = isHost && !!onRemove && id !== organiserId && !e.dropped && state !== 'complete' && state !== 'cancelled';
        return (
          <PlayerRoster key={id} name={playerName(names, id)} dropped={e.dropped} hidden={hideMine && id === me} roster={rosters.get(id)!}
            record={`Wins: ${wins.get(id) ?? 0} - Losses: ${losses.get(id) ?? 0}`}
            action={(onProfile || canRemove) ? (
              <div className="player-roster-actions">
                {onProfile && <button type="button" className="btn" onClick={() => onProfile(id)}>View profile</button>}
                {canRemove && <button type="button" className="btn" disabled={removing} onClick={() => void remove(id)}>Remove player</button>}
              </div>
            ) : undefined} />
        );
      })}
    </div>
  );
}
