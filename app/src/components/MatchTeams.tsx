import { useState, type CSSProperties } from 'react';
import { useMedia } from '../lib/usePhone';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { trainerUrl, type Profile } from '../lib/profile';
import type { PublicMember } from '../lib/teamCodec';
import { Sprite } from './Sprite';
import { LeagueEmblem } from './LeagueEmblem';
import type { LeagueId } from '../lib/types';
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
    <li className="@container chamfer-9 flex min-w-0 flex-col gap-1.5 border border-[var(--rule-hairline)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--t1,var(--color-accent))_14%,var(--surface-1)),var(--surface-1)_60%)] p-2" style={tint}>
      <div className={`flex items-center justify-between gap-2 border-b border-[var(--rule-hairline)] px-1 pb-1 ${mirror ? 'flex-row-reverse' : ''}`}>
        <span className={`${NARROW} min-w-0 text-base leading-tight [overflow-wrap:anywhere] @max-[14rem]:text-sm`}>{displayName(member.ref)}</span>
        <span className="flex shrink-0 gap-1">{sp?.types.map((t) => <TypeIcon key={t} type={t} size={20} />)}</span>
      </div>
      <div className={`flex items-stretch gap-2 ${mirror ? 'flex-row-reverse' : ''}`}>
        <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1 p-0" aria-label={`${displayName(member.ref)}'s moves`}>
          {moves.map((mv, i) => (
            <li key={`${mv.id}-${i}`}
              className="flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--rule-hairline)] bg-[color-mix(in_srgb,var(--mv,var(--surface-2))_22%,var(--surface-2))] px-2 py-0.5 text-sm font-semibold @max-[14rem]:gap-1 @max-[14rem]:px-1 @max-[14rem]:text-[13px]"
              style={mv.type ? ({ '--mv': typeVar(mv.type) } as CSSProperties) : undefined}>
              {mv.type ? <span className="flex shrink-0 @max-[14rem]:hidden"><TypeIcon type={mv.type} size={18} /></span> : <span className="size-[18px] @max-[14rem]:hidden" aria-hidden="true" />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{mv.name}</span>
            </li>
          ))}
        </ul>
        {/* Narrow cards (two columns on a ~1280px screen) take a smaller sprite; the move row's tint still says its type. */}
        <div className="grid w-20 shrink-0 place-items-center rounded-md border-2 @max-[14rem]:w-14 @max-[14rem]:[&>div]:!size-12 border-[color-mix(in_srgb,var(--t1,var(--color-accent))_55%,var(--rule-hairline))] bg-[var(--surface-2)]">
          {sp ? <Sprite sprite={sp.sprite} dex={sp.dex} size={72} shadow={shadow} /> : <span className="text-faint">?</span>}
        </div>
      </div>
    </li>
  );
}

/** A slot whose Pokémon its owner has hidden (a tournament's "Hide Pokémon"): it keeps its place, shows nothing. */
const HIDDEN_SLOT = 'chamfer-9 grid place-items-center border border-dashed border-[var(--rule-hairline)] bg-[var(--surface-1)] text-sm text-muted';

function Side({ title, label, profile, team, code, mirror, onOpen, hidden = false }: {
  title: string; label: string; profile: Profile | null | undefined; team: PublicMember[];
  code: string | null | undefined; mirror: boolean; onOpen: () => void; hidden?: boolean;
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
      {/* Two columns from 24rem, so a Show 6 is two columns of three and both twelve fit one screen under their
          banners (the user's ask; at one column only three per side showed). One column on a phone. The query
          container is this wrapper, not the section: containment would stop the section being a subgrid. */}
      <div className="@container">
        <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 @[24rem]:grid-cols-2">
          {team.map((m, i) => hidden
            ? <li key={i} className={`${HIDDEN_SLOT} min-h-28`}>Hidden</li>
            : <Card key={`${m.ref}-${i}`} member={m} mirror={mirror} />)}
        </ol>
      </div>
    </section>
  );
}

/** One side's Pokémon in a phone pair: sprite and name, then its three moves, mirrored for the opponent. */
function PairCell({ member, mirror, open, onToggle }: { member: PublicMember | undefined; mirror: boolean; open: boolean; onToggle: () => void }) {
  if (!member) return <div aria-hidden="true" />;
  const { sp, moves } = movesOf(member);
  const tint = sp ? ({ '--t1': typeVar(sp.types[0]) } as CSSProperties) : undefined;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      aria-label={`${displayName(member.ref)}: ${moves.map((m) => m.name).join(', ')}`}
      className={`chamfer-9 flex min-w-0 flex-col gap-1 border bg-[linear-gradient(135deg,color-mix(in_srgb,var(--t1,var(--color-accent))_14%,var(--surface-1)),var(--surface-1)_60%)] p-1.5 text-left ${open ? 'border-[var(--color-accent)]' : 'border-[var(--rule-hairline)]'} ${mirror ? 'items-end text-right' : ''}`} style={tint}>
      <span className={`flex w-full min-w-0 items-center gap-1.5 ${mirror ? 'flex-row-reverse' : ''}`}>
        {sp && <span className="shrink-0"><Sprite sprite={sp.sprite} dex={sp.dex} size={28} shadow={parseRef(member.ref).shadow} /></span>}
        <span className={`${NARROW} min-w-0 text-sm leading-tight [overflow-wrap:anywhere]`}>{displayName(member.ref)}</span>
      </span>
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        {moves.map((mv, i) => (
          <span key={`${mv.id}-${i}`} className={`flex min-w-0 items-center gap-1 rounded-sm bg-[color-mix(in_srgb,var(--mv,var(--surface-2))_22%,var(--surface-2))] px-1 text-[11px] font-semibold leading-[15px] ${mirror ? 'flex-row-reverse' : ''}`}
            style={mv.type ? ({ '--mv': typeVar(mv.type) } as CSSProperties) : undefined}>
            {mv.type && <span className="flex shrink-0"><TypeIcon type={mv.type} size={12} /></span>}
            <span className="min-w-0 [overflow-wrap:anywhere]">{mv.name}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * Phones and screens under 1280px: the two teams as six pairs, yours left and theirs right, so both sixes and every move fit one screen
 * (stacked, the opponent's started ~1,400px down). A tapped Pokémon opens its full card under its row.
 */
function PairedTeams({ me, opp, myTeam, oppTeam, myCode, oppCode, onOpenMe, onOpenOpp, league, format, hideMine = false }: Parameters<typeof MatchTeams>[0]) {
  const [open, setOpen] = useState<string | null>(null);
  const mine = myTeam ?? [];
  const theirs = oppTeam ?? [];
  const rows = Math.max(mine.length, theirs.length);
  const who = (p: Profile | null | undefined, code: string | null | undefined, onOpen: () => void, mirror: boolean, label: string) => {
    const name = p?.displayName ?? (p === undefined ? '…' : 'Unknown trainer');
    return (
      <div className={`flex min-w-0 items-center gap-1.5 ${mirror ? 'flex-row-reverse text-right' : ''}`}>
        {p?.avatar ? <img src={trainerUrl(p.avatar)} alt="" width={36} height={36} className="size-9 shrink-0 object-contain [image-rendering:pixelated]" /> : null}
        <div className={`flex min-w-0 flex-col ${mirror ? 'items-end' : 'items-start'}`}>
          <span className="font-mono text-[length:var(--text-2xs)] tracking-widest text-muted">{label}</span>
          <button type="button" className={`btn btn-ghost min-h-0 px-0 py-0 text-base ${NARROW} [overflow-wrap:anywhere]`} onClick={onOpen}>{name}</button>
          <span className="numeric font-mono text-[10px] text-muted">{code === undefined ? '…' : code ?? 'no code'}</span>
        </div>
      </div>
    );
  };
  return (
    <section className="panel flex flex-col gap-1.5 p-2" aria-label="Versus">
      <div className="grid grid-cols-2 gap-2">
        {who(me, myCode, onOpenMe, false, 'YOU')}
        {who(opp, oppCode, onOpenOpp, true, 'OPPONENT')}
      </div>
      <div className="flex items-center justify-center gap-2 font-mono text-[length:var(--text-2xs)] uppercase tracking-wider text-muted">
        {league && <LeagueEmblem league={league} size={18} />}
        <span className="font-extrabold text-accent">VS</span>
        {format && <span>{format}</span>}
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {Array.from({ length: rows }, (_, i) => {
          const a = `a${i}`, b = `b${i}`;
          const openMember = open === a ? mine[i] : open === b ? theirs[i] : undefined;
          return (
            <li key={i} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {hideMine && mine[i]
                  ? <div className={`${HIDDEN_SLOT} min-h-16`}>Hidden</div>
                  : <PairCell member={mine[i]} mirror={false} open={open === a} onToggle={() => setOpen(open === a ? null : a)} />}
                <PairCell member={theirs[i]} mirror open={open === b} onToggle={() => setOpen(open === b ? null : b)} />
              </div>
              {openMember && <ul className="m-0 list-none p-0"><Card member={openMember} mirror={open === b} /></ul>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Both sides of a match, facing each other: each trainer's banner over their team, the opponent's mirrored. Species
 * and moves only — the server never sends either side's IVs.
 */
export function MatchTeams({ me, opp, myTeam, oppTeam, myCode, oppCode, onOpenMe, onOpenOpp, league, format, hideMine = false }: {
  me: Profile | null | undefined; opp: Profile | null | undefined;
  myTeam?: PublicMember[]; oppTeam?: PublicMember[];
  myCode: string | null | undefined; oppCode: string | null | undefined;
  onOpenMe: () => void; onOpenOpp: () => void;
  /** The league's emblem and the format's label, between the two banners. */
  league?: LeagueId; format?: string | null;
  /** Your own side as hidden slots (a tournament's "Hide Pokémon"), so theirs keep their places. */
  hideMine?: boolean;
}) {
  // Below 1280px the three-column layout leaves each side ~280px (one card across, six deep), so the paired rows
  // phones use are the better fit there too: both sixes on one screen.
  const paired = useMedia('(max-width: 1279px)');
  if (paired) return <PairedTeams me={me} opp={opp} myTeam={myTeam} oppTeam={oppTeam} myCode={myCode} oppCode={oppCode} onOpenMe={onOpenMe} onOpenOpp={onOpenOpp} league={league} format={format} hideMine={hideMine} />;
  const oppTitle = opp?.displayName ? `${opp.displayName}'s team` : 'Their team';
  return (
    <section className="panel grid grid-cols-1 items-start gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" aria-label="Versus">
      {/* Two rows, shared by both sides through subgrid: the banners, then the teams. VS sits in the banner row, centred on it. */}
      <Side title="Your team" label="YOU" profile={me} team={myTeam ?? []} code={myCode} mirror={false} onOpen={onOpenMe} hidden={hideMine} />
      <div className="flex flex-col items-center gap-1 self-center justify-self-center text-center lg:col-start-2 lg:row-start-1">
        {league && <LeagueEmblem league={league} size={34} />}
        <span className="font-mono text-3xl font-extrabold tracking-widest text-accent" aria-hidden="true">VS</span>
        {format && <span className="max-w-40 font-mono text-[length:var(--text-2xs)] uppercase tracking-wider text-muted">{format}</span>}
      </div>
      <Side title={oppTitle} label="OPPONENT" profile={opp} team={oppTeam ?? []} code={oppCode} mirror onOpen={onOpenOpp} />
    </section>
  );
}
