import type { ReactNode } from 'react';
import { displayName, parseRef, speciesOf } from '../../lib/data';
import type { RosterMember } from '../../tournament/roster';
import { Sprite } from '../Sprite';
import { TypeBadge } from '../TypeBadge';

/** One Pokémon of a roster. `hidden` (a viewer covering their own team) shows nothing about it. */
export function RosterCard({ member, hidden = false, onRemove }: { member: RosterMember; hidden?: boolean; onRemove?: () => void }) {
  const s = speciesOf(member.ref);
  const shadow = parseRef(member.ref).shadow;
  const name = displayName(member.ref);
  if (hidden) {
    return <div className="roster-card roster-card-hidden text-muted">Hidden</div>;
  }
  const moves = [
    ...(s?.fastMoves.filter((m) => m.id === member.fast) ?? []),
    ...member.charges.flatMap((id) => s?.chargeMoves.filter((m) => m.id === id) ?? []),
  ];
  return (
    <div className="roster-card">
      {s && <Sprite sprite={s.sprite} dex={s.dex} size={48} shadow={shadow} bestBuddy={member.bestBuddy} />}
      <div className="roster-card-body">
        <div className="roster-card-name">{name}</div>
        <div className="roster-card-badges">
          {shadow && <span className="roster-badge">Shadow</span>}
          {member.bestBuddy && <span className="roster-badge">Best Buddy</span>}
        </div>
        <div className="numeric text-muted">CP {member.cp}</div>
        <ul className="roster-card-moves">
          {moves.map((m) => (
            <li key={m.id}><TypeBadge type={m.type} /> <span>{m.name}</span></li>
          ))}
        </ul>
      </div>
      {onRemove && (
        <button type="button" className="btn roster-card-remove" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
      )}
    </div>
  );
}

/** A player's six, under their name and record. */
export function PlayerRoster({ name, record, roster, hidden = false, dropped = false, action }: {
  name: string; record?: string; roster: readonly RosterMember[]; hidden?: boolean; dropped?: boolean; action?: ReactNode;
}) {
  return (
    <section className="panel chamfer-9 player-roster">
      <h3 className="player-roster-head">
        <span className={dropped ? 'player-dropped' : undefined}>{name}</span>
        {dropped && <span className="text-muted">dropped</span>}
        {record && <span className="numeric text-muted">{record}</span>}
      </h3>
      {action}
      <div className="roster-grid">
        {roster.map((m, i) => <RosterCard key={i} member={m} hidden={hidden} />)}
      </div>
    </section>
  );
}
