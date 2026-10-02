import { displayName, parseRef, speciesOf } from '../lib/data';
import { decodeMember, type StoredMember } from '../lib/teamCodec';
import { movesForChoice } from './AddPokemonModal';
import { Sprite } from './Sprite';

function Roster({ title, team, code }: { title: string; team: StoredMember[]; code: string | null | undefined }) {
  return (
    <section className="match-team" aria-label={title}>
      <div className="hud-label">{title}</div>
      <p className="text-muted">Friend code: <span className="numeric">{code === undefined ? '…' : code ?? 'not set'}</span></p>
      <ol className="ct-slots">
        {team.map((m, i) => {
          const { choice } = decodeMember(m);
          const sp = speciesOf(choice.ref);
          // League only picks moves for a member stored with none; every roster here stores its moves.
          const moves = movesForChoice(choice, 'great');
          return (
            <li key={i} className="ct-slot">
              <div className="ct-slot-id">
                {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={44} shadow={parseRef(choice.ref).shadow} />}
                <div className="min-w-0">
                  <div className="ct-slot-name">{displayName(choice.ref)}</div>
                  <div className="text-faint ct-slot-moves">
                    {moves ? [moves.fast.name, ...moves.charges.map((c) => c.name)].join(' · ') : 'Unknown Pokémon'}
                  </div>
                </div>
              </div>
              <div className="ct-chips">
                <span className="ct-chip numeric">{m.iv_attack}/{m.iv_defense}/{m.iv_stamina}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Your team against theirs, each with its player's friend code (`undefined` = still loading). */
export function MatchTeams({ myTeam, oppTeam, myCode, oppCode, oppName }: {
  myTeam?: StoredMember[]; oppTeam?: StoredMember[];
  myCode: string | null | undefined; oppCode: string | null | undefined; oppName: string;
}) {
  if (!myTeam?.length || !oppTeam?.length) return null;
  return (
    <div className="match-teams">
      <Roster title="Your team" team={myTeam} code={myCode} />
      <Roster title={`${oppName}'s team`} team={oppTeam} code={oppCode} />
    </div>
  );
}
