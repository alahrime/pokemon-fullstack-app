import type { CSSProperties } from 'react';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { trainerUrl, type Profile } from '../lib/profile';
import type { PublicMember } from '../lib/teamCodec';
import { Sprite } from './Sprite';
import { TypeIcon } from './TypeBadge';

const NARROW = "[font-family:'Archivo_Narrow',var(--font-heading)] font-bold uppercase tracking-wide";
const typeVar = (t: string) => `var(--type-${t.toLowerCase()})`;

/** Species and moves as the data names them; a move this build lacks is shown by its id rather than dropped. */
function movesOf(m: PublicMember) {
  const sp = speciesOf(m.ref);
  const fast = sp?.fastMoves.find((x) => x.id === m.fast_move);
  const charges = m.charge_moves.map((id) => sp?.chargeMoves.find((x) => x.id === id) ?? { id, name: id, type: '' });
  return { sp, moves: [fast ?? { id: m.fast_move, name: m.fast_move, type: '' }, ...charges] };
}

/**
 * One Pokémon as a broadcast card: a name bar with its types, its moves down one side, the sprite framed on the
 * other. `mirror` puts the sprite on the outside edge for the right-hand side, so the two teams face each other.
 */
function Card({ member, mirror }: { member: PublicMember; mirror: boolean }) {
  const { sp, moves } = movesOf(member);
  const shadow = parseRef(member.ref).shadow;
  const tint = sp ? ({ '--t1': typeVar(sp.types[0]), '--t2': typeVar(sp.types[1] ?? sp.types[0]) } as CSSProperties) : undefined;
  return (
    <li className="chamfer-9 flex flex-col gap-2 border border-[var(--rule-hairline)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--t1,var(--color-accent))_14%,var(--surface-1)),var(--surface-1)_60%)] p-2" style={tint}>
      <div className={`flex items-center justify-between gap-2 border-b border-[var(--rule-hairline)] px-1 pb-1.5 ${mirror ? 'flex-row-reverse' : ''}`}>
        <span className={`${NARROW} min-w-0 text-lg leading-tight [overflow-wrap:anywhere]`}>{displayName(member.ref)}</span>
        <span className="flex shrink-0 gap-1">{sp?.types.map((t) => <TypeIcon key={t} type={t} size={22} />)}</span>
      </div>
      <div className={`flex items-stretch gap-2 ${mirror ? 'flex-row-reverse' : ''}`}>
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0" aria-label={`${displayName(member.ref)}'s moves`}>
          {moves.map((mv, i) => (
            <li key={`${mv.id}-${i}`}
              className="flex min-h-8 items-center gap-2 rounded-md border border-[var(--rule-hairline)] bg-[color-mix(in_srgb,var(--mv,var(--surface-2))_22%,var(--surface-2))] px-2 py-1 text-sm font-semibold"
              style={mv.type ? ({ '--mv': typeVar(mv.type) } as CSSProperties) : undefined}>
              {mv.type ? <TypeIcon type={mv.type} size={20} /> : <span className="size-5" aria-hidden="true" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{mv.name}</span>
            </li>
          ))}
        </ul>
        <div className="grid w-24 shrink-0 place-items-center rounded-md border-2 border-[color-mix(in_srgb,var(--t1,var(--color-accent))_55%,var(--rule-hairline))] bg-[var(--surface-2)] sm:w-28">
          {sp ? <Sprite sprite={sp.sprite} dex={sp.dex} size={88} shadow={shadow} /> : <span className="text-faint">?</span>}
        </div>
      </div>
    </li>
  );
}

function Side({ title, label, profile, team, code, mirror, onOpen }: {
  title: string; label: string; profile: Profile | null | undefined; team: PublicMember[];
  code: string | null | undefined; mirror: boolean; onOpen: () => void;
}) {
  const name = profile?.displayName ?? (profile === undefined ? '…' : 'Unknown trainer');
  return (
    <section className={`flex min-w-0 flex-col gap-3 lg:row-span-2 lg:row-start-1 lg:grid lg:grid-rows-subgrid ${mirror ? 'lg:col-start-3' : 'lg:col-start-1'}`} aria-label={title}>
      <header className={`chamfer-9 flex items-center gap-3 border border-[var(--rule-strong)] bg-[var(--surface-2)] px-3 py-2 ${mirror ? 'flex-row-reverse text-right' : ''}`}>
        {profile?.avatar
          ? <img src={trainerUrl(profile.avatar)} alt="" width={80} height={80} className="size-16 shrink-0 object-contain [image-rendering:pixelated]" />
          : <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center text-3xl font-extrabold text-muted">{name.slice(0, 1).toUpperCase()}</span>}
        <div className={`flex min-w-0 flex-1 flex-col ${mirror ? 'items-end' : 'items-start'}`}>
          <span className="rounded border border-[var(--rule-strong)] px-1.5 font-mono text-[length:var(--text-2xs)] tracking-widest">{label}</span>
          {/* Both names are links, so the two banners share one box model and stay level. */}
          <button type="button" className={`btn btn-ghost px-0 text-2xl ${NARROW} [overflow-wrap:anywhere]`} onClick={onOpen}>{name}</button>
          <span className="font-mono text-[length:var(--text-2xs)] text-muted">Friend code: <span className="numeric">{code === undefined ? '…' : code ?? 'not set'}</span></span>
        </div>
      </header>
      {/* Two columns once the side is wide enough to keep a card's moves on one line; one otherwise. The query
          container is this wrapper, not the section: containment would stop the section being a subgrid. */}
      <div className="@container">
        <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 @[40rem]:grid-cols-2">
          {team.map((m, i) => <Card key={`${m.ref}-${i}`} member={m} mirror={mirror} />)}
        </ol>
      </div>
    </section>
  );
}

/**
 * Both sides of a match, facing each other: each trainer's banner over their team, the opponent's mirrored. Species
 * and moves only — the server never sends either side's IVs.
 */
export function MatchTeams({ me, opp, myTeam, oppTeam, myCode, oppCode, onOpenMe, onOpenOpp }: {
  me: Profile | null | undefined; opp: Profile | null | undefined;
  myTeam?: PublicMember[]; oppTeam?: PublicMember[];
  myCode: string | null | undefined; oppCode: string | null | undefined;
  onOpenMe: () => void; onOpenOpp: () => void;
}) {
  const oppName = opp?.displayName ?? 'Their';
  return (
    <section className="panel grid grid-cols-1 items-start gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" aria-label="Versus">
      {/* Two rows, shared by both sides through subgrid: the banners, then the teams. VS sits in the banner row, centred on it. */}
      <Side title="Your team" label="YOU" profile={me} team={myTeam ?? []} code={myCode} mirror={false} onOpen={onOpenMe} />
      <span className="self-center justify-self-center font-mono text-3xl font-extrabold tracking-widest text-accent lg:col-start-2 lg:row-start-1" aria-hidden="true">VS</span>
      <Side title={`${oppName}'s team`} label="OPPONENT" profile={opp} team={oppTeam ?? []} code={oppCode} mirror onOpen={onOpenOpp} />
    </section>
  );
}
