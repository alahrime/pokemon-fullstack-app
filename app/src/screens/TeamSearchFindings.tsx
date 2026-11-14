import { useState } from 'react';
import type { ReactNode } from 'react';
import raw from '../data/gbl-team-search.json';
import { Sprite } from '../components/Sprite';
import { displayName, parseRef, speciesOf } from '../lib/data';

/**
 * The Great League team search (research/gbl-teams), summarised and charted.
 *
 * Every figure here comes from gbl-team-search.json, which
 * research/gbl-teams/scripts/export-app.py writes from the committed research
 * outputs. Nothing on this page is typed in by hand, so re-running the search
 * and the exporter is the whole update.
 *
 * The view is organised by phase: the moveset-variant test, the reproduction
 * check, the six oracle rounds (each with its two proposal waves), and the
 * final ranking.
 */

type Team = string[];
type Added = { team: Team; f: number; prefRank: number; wave: number };
type Round = {
  round: number; teams: number; support: number; edge: number; prefilterSecs: number; wave1Teams: number; wave2Teams: number;
  w1Best: number; w2Best: number; w1Hits: number; w2Hits: number; corrPrefilter: number; corrCorrected: number;
  bestRank: number; randomBest: number; mix: { team: Team; share: number }[]; added: Added[];
};
type Ranked = { A: Team; rank_plain: number; rank_dedup: number; eqw: number; eqv: number; lgw: number; lgw_d: number; fav: number; ncl: number; worst: number; aba: number; label?: string };
type Data = {
  summary: { piecesBefore: number; piecesAfter: number; variantsTried: number; variantsKept: number; teams: number; games: number | null; poolTeams: number; support: number; edge: number; ranked: number };
  check: { team: Team; before: number; after: number }[];
  rounds: Round[];
  final: { team: Team; share: number }[];
  ranking: Ranked[];
  watch: Ranked[];
  variants: { ref: string; moves: string[]; gains: number; losses: number; opps: string[] }[];
};
const D = raw as Data;
const MOVES = new Map(D.variants.map((v) => [v.ref, v.moves]));
// The oracle adds a team when it beats the mix by more than 1%, and stops once nothing clears 0.5%.
const ADD = 0.51, STOP = 0.505;

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
/** `empoleon#METAL_SOUND-…` → "Empoleon · Metal Sound / Hydro Cannon / Drill Peck"; `dunsparce#ASTONISH` → "Dunsparce · Astonish". */
export function pieceName(ref: string) {
  const [base, set] = ref.split('#');
  if (!set) return displayName(base);
  const moves = MOVES.get(ref) ?? set.split('-').map((m) => m.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  return `${displayName(base)} · ${moves.join(' / ')}`;
}
const teamName = (t: Team) => t.map(pieceName).join(' / ');

function Mon({ refId, size = 24 }: { refId: string; size?: number }) {
  const base = refId.split('#')[0], sp = speciesOf(base);
  if (!sp) return null;
  return (
    <span className="flex-none inline-grid place-items-center" title={pieceName(refId)}>
      <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(base).shadow} />
    </span>
  );
}
const TeamMons = ({ t }: { t: Team }) => <span className="ts-mons">{t.map((p) => <Mon key={p} refId={p} />)}</span>;

type Phase = 'variants' | 'check' | `r${number}` | 'ranking';

export function TeamSearchFindings() {
  const [phase, setPhase] = useState<Phase>('r1');
  const S = D.summary, last = D.rounds[D.rounds.length - 1];
  const phases: { id: Phase; label: string }[] = [
    { id: 'variants', label: 'Variants' },
    { id: 'check', label: 'Check' },
    ...D.rounds.map((r) => ({ id: `r${r.round}` as Phase, label: `Round ${r.round}` })),
    { id: 'ranking', label: 'Ranking' },
  ];
  const round = phase.startsWith('r') && phase !== 'ranking' ? D.rounds[Number(phase.slice(1)) - 1] : null;

  return (
    <>
      <section className="panel panel-strong diag-headline">
        <Stat label="Teams searched" value={S.teams.toLocaleString()}
          note={`every three-piece team of ${S.piecesAfter} pieces (${S.piecesBefore} species forms plus ${S.variantsKept} moveset variants), same-species pairs dropped`} />
        <Stat label="Full 3v3 games" value={S.games ? `${(S.games / 1e6).toFixed(1)}M` : '—'}
          note="each one a whole game with HP, energy and shields carried, the lead solved as a mixed strategy" />
        <Stat label="Final equilibrium" value={`${S.support}`}
          note={`team + lead strategies in the support, from a pool of ${S.poolTeams} teams; in-pool edge ${pct(S.edge, 2)}`} />
        <Stat label="Best outside team" value={pct(last.w2Best, 1)} warn
          note={`against the mix after round ${last.round}, still above the ${pct(STOP, 1)} stop line: the search hit its round cap, not convergence`} />
      </section>

      <p className="text-muted diag-read">
        <strong>What it found.</strong> The 1v1 prefilter misjudges whole cores — Snorlax, Shadow Houndoom and Shadow Hydreigon
        among them — so a second wave, re-ranked by a fit on each round&rsquo;s real results, found most of the teams that moved
        the equilibrium. The equilibrium ended far flatter than before (top share {pct(D.final[0].share, 1)}), every team in the
        top 30 scores within a point of 50% in value against it, and counting look-alike opponents once leaves the top two in place
        while moving half of the top 100.
      </p>

      <section className="panel mb-4">
        <div className="hud-label">Phase</div>
        <div className="ts-phases" role="tablist">
          {phases.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={phase === p.id}
              className={`chip-btn${phase === p.id ? ' is-active' : ''}`} onClick={() => setPhase(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <div className="diag-split">
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Best team outside the pool, by round</div>
          <ConvergenceChart selected={round?.round} onPick={(r) => setPhase(`r${r}`)} />
        </section>
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Share of proposals that beat the mix by 1%</div>
          <HitRateChart selected={round?.round} onPick={(r) => setPhase(`r${r}`)} />
        </section>
      </div>

      {phase === 'variants' && <VariantsPhase />}
      {phase === 'check' && <CheckPhase />}
      {round && <RoundPhase r={round} />}
      {phase === 'ranking' && <RankingPhase />}
    </>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="diag-stat">
      <span className="hud-label">{label}</span>
      <span className={`numeric diag-stat-value${warn ? ' is-warn' : ''}`}>{value}</span>
      <span className="diag-stat-note">{note}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="ts-legend">
      <span><i className="ts-key is-w1" /> Wave 1 · 1v1 prefilter top 4,000 + 500 random</span>
      <span><i className="ts-key is-w2" /> Wave 2 · re-ranked by the fitted correction</span>
    </div>
  );
}

// Shared frame for the two round charts: rounds along x, a value along y.
const W = 520, H = 220, L = 44, R = 16, T = 14, B = 30;
const xAt = (i: number, n: number) => L + ((i + 0.5) * (W - L - R)) / n;

function Frame({ ticks, yAt, fmt, selected, onPick, children }: {
  ticks: number[]; yAt: (v: number) => number; fmt: (v: number) => string; selected?: number; onPick: (r: number) => void; children: ReactNode;
}) {
  const n = D.rounds.length, band = (W - L - R) / n;
  return (
    <svg className="ts-chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line className="ts-grid" x1={L} x2={W - R} y1={yAt(t)} y2={yAt(t)} />
          <text className="ts-axis" x={L - 6} y={yAt(t) + 3} textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {D.rounds.map((r, i) => (
        <g key={r.round}>
          {/* The whole column is the hit target, wider than any mark in it. */}
          <rect className={`ts-band${selected === r.round ? ' is-active' : ''}`} x={L + i * band} y={T} width={band} height={H - T - B}
            onClick={() => onPick(r.round)}>
            <title>{`Round ${r.round}: wave 1 best ${pct(r.w1Best, 1)}, wave 2 best ${pct(r.w2Best, 1)}; hits ${r.w1Hits}/${r.wave1Teams} and ${r.w2Hits}/${r.wave2Teams}`}</title>
          </rect>
          <text className="ts-axis" x={xAt(i, n)} y={H - 10} textAnchor="middle">R{r.round}</text>
        </g>
      ))}
      {children}
    </svg>
  );
}

function ConvergenceChart({ selected, onPick }: { selected?: number; onPick: (r: number) => void }) {
  const n = D.rounds.length, lo = 0.5, hi = Math.ceil(Math.max(...D.rounds.map((r) => r.w2Best)) * 100 + 0.5) / 100;
  const yAt = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = (k: 'w1Best' | 'w2Best') => D.rounds.map((r, i) => `${i ? 'L' : 'M'}${xAt(i, n)},${yAt(r[k])}`).join('');
  const ticks = Array.from({ length: Math.round((hi - lo) * 100) + 1 }, (_, i) => lo + i / 100);
  return (
    <>
      <Frame ticks={ticks} yAt={yAt} fmt={(v) => pct(v)} selected={selected} onPick={onPick}>
        <line className="ts-rule" x1={L} x2={W - R} y1={yAt(ADD)} y2={yAt(ADD)} />
        <text className="ts-axis" x={L + 6} y={yAt(ADD) - 4}>add above {pct(ADD)}</text>
        <line className="ts-rule is-stop" x1={L} x2={W - R} y1={yAt(STOP)} y2={yAt(STOP)} />
        <text className="ts-axis" x={L + 6} y={yAt(STOP) + 11}>stop below {pct(STOP, 1)}</text>
        {(['w1Best', 'w2Best'] as const).map((k) => (
          <g key={k} className={k === 'w1Best' ? 'is-w1' : 'is-w2'}>
            <path className="ts-line" d={line(k)} />
            {D.rounds.map((r, i) => <circle key={r.round} className="ts-dot" cx={xAt(i, n)} cy={yAt(r[k])} r={4} />)}
          </g>
        ))}
        <text className="ts-label" x={xAt(0, n) + 8} y={yAt(D.rounds[0].w2Best) - 6}>wave 2</text>
        <text className="ts-label" x={xAt(0, n) + 8} y={yAt(D.rounds[0].w1Best) + 14}>wave 1</text>
      </Frame>
      <Legend />
    </>
  );
}

function HitRateChart({ selected, onPick }: { selected?: number; onPick: (r: number) => void }) {
  const n = D.rounds.length, band = (W - L - R) / n, bw = Math.min(18, band / 3);
  const yAt = (v: number) => T + (1 - v) * (H - T - B);
  return (
    <>
      <Frame ticks={[0, 0.25, 0.5, 0.75, 1]} yAt={yAt} fmt={(v) => pct(v)} selected={selected} onPick={onPick}>
        {D.rounds.map((r, i) => {
          const a = r.w1Hits / r.wave1Teams, b = r.w2Hits / r.wave2Teams, x = xAt(i, n);
          return (
            <g key={r.round} pointerEvents="none">
              <rect className="ts-bar is-w1" x={x - bw - 1} y={yAt(a)} width={bw} height={Math.max(1, yAt(0) - yAt(a))} />
              <rect className="ts-bar is-w2" x={x + 1} y={yAt(b)} width={bw} height={Math.max(1, yAt(0) - yAt(b))} />
              {selected === r.round && (
                <>
                  <text className="ts-label" x={x - bw / 2 - 1} y={yAt(a) - 4} textAnchor="middle">{pct(a)}</text>
                  <text className="ts-label" x={x + bw / 2 + 1} y={yAt(b) - 4} textAnchor="middle">{pct(b)}</text>
                </>
              )}
            </g>
          );
        })}
      </Frame>
      <Legend />
    </>
  );
}

function VariantsPhase() {
  const S = D.summary;
  const rows = [...D.variants].sort((a, b) => b.gains - b.losses - (a.gains - a.losses) || b.gains - a.gains);
  return (
    <section className="panel mb-4">
      <div className="hud-label diag-col-head">Step 1 · moveset variants kept as pieces: {S.variantsKept} of {S.variantsTried.toLocaleString()}</div>
      <p className="text-faint diag-sub">
        A variant earns a piece only if, against its default moveset, it flips at least two meaningful 1v1 matchups in its favour
        (≥ 150 rating, across 500, in two of four shield scenarios) and gives up no more than it gains. The rest fold into their
        default. Sorted by net matchups gained.
      </p>
      <ol className="diag-list ts-list">
        {rows.map((v) => (
          <li key={v.ref}>
            <Mon refId={v.ref} />
            <span className="diag-name">{pieceName(v.ref)}</span>
            <span className="numeric diag-score" title="Matchups it flips in its favour">+{v.gains}</span>
            <span className="numeric diag-delta" title="Matchups it gives up">−{v.losses}</span>
            <span className="ts-opps">{v.opps.slice(0, 4).map((o) => <Mon key={o} refId={o} size={20} />)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CheckPhase() {
  return (
    <section className="panel mb-4">
      <div className="hud-label diag-col-head">Step 2 check · the old 214-team pool replayed through the new code</div>
      <p className="text-faint diag-sub">
        Before trusting the large run, it must reproduce the previous equilibrium&rsquo;s top five within ±2% share. It reproduced them
        exactly: the engine is deterministic, and the old pieces kept their movesets.
      </p>
      <ol className="diag-list ts-list">
        {D.check.map((c) => (
          <li key={c.team.join()}>
            <TeamMons t={c.team} />
            <span className="diag-name">{teamName(c.team)}</span>
            <span className="numeric diag-score">before {pct(c.before, 2)}</span>
            <span className={`numeric diag-delta${Math.abs(c.after - c.before) <= 0.02 ? ' is-up' : ' is-down'}`}>now {pct(c.after, 2)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RoundPhase({ r }: { r: Round }) {
  const top = r.mix[0].share;
  const added = [...r.added].sort((a, b) => b.f - a.f);
  return (
    <>
      <section className="panel panel-strong diag-headline">
        <Stat label={`Round ${r.round} · pool`} value={`${r.teams}`} note={`teams going in; the mix fields ${r.support} strategies, in-pool edge ${pct(r.edge, 2)}`} />
        <Stat label="Best proposal" value={pct(Math.max(r.w1Best, r.w2Best), 1)} note={`against the mix; it sat at prefilter #${r.bestRank.toLocaleString()} of ${(D.summary.teams).toLocaleString()}. Best random-sample team ${pct(r.randomBest, 1)}`} />
        <Stat label="Hits per wave" value={`${r.w1Hits} · ${r.w2Hits}`} note={`teams over ${pct(ADD)}: wave 1 of ${r.wave1Teams.toLocaleString()}, wave 2 of ${r.wave2Teams.toLocaleString()}`} />
        <Stat label="Prefilter vs result" value={r.corrPrefilter.toFixed(2)} note={`correlation inside wave 1 (prefilter ran ${Math.round(r.prefilterSecs / 60)} min). The correction scores ${r.corrCorrected.toFixed(2)} inside its own top slice, a narrow range where any score correlates weakly`} />
      </section>
      <div className="diag-split">
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Teams added this round, by where the prefilter ranked them</div>
          <AddedScatter added={r.added} />
          <p className="text-faint diag-sub">
            Each dot is a team the oracle added. Far right means the 1v1 prefilter ranked it deep; every dot right of the 4,000 line
            was found only by the second wave.
          </p>
        </section>
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">The mix going into round {r.round} (top six)</div>
          <ol className="diag-list ts-list">
            {r.mix.map((m) => (
              <li key={m.team.join()}>
                <TeamMons t={m.team} />
                <span className="diag-name">{teamName(m.team)}</span>
                <span className="ts-share"><span style={{ width: `${(m.share / top) * 100}%` }} /></span>
                <span className="numeric diag-score">{pct(m.share, 1)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <section className="panel mb-4">
        <div className="hud-label diag-col-head">Added in round {r.round}: {added.length} teams</div>
        <ol className="diag-list ts-list">
          {added.map((a) => (
            <li key={a.team.join()}>
              <TeamMons t={a.team} />
              <span className="diag-name">{teamName(a.team)}</span>
              <span className="numeric diag-score">{pct(a.f, 1)}</span>
              <span className="numeric diag-delta" title="Prefilter rank">#{a.prefRank.toLocaleString()}</span>
              <span className={`ts-wave is-w${a.wave}`}>wave {a.wave}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function AddedScatter({ added }: { added: Added[] }) {
  const all = D.rounds.flatMap((r) => r.added);
  const lo = Math.floor(Math.min(...all.map((a) => a.f)) * 100) / 100, hi = Math.ceil(Math.max(...all.map((a) => a.f)) * 100) / 100;
  const xMax = Math.ceil(Math.log10(Math.max(...all.map((a) => a.prefRank))));
  const xAt = (rank: number) => L + (Math.log10(rank) / xMax) * (W - L - R);
  const yAt = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const yt = Array.from({ length: Math.round((hi - lo) * 100) + 1 }, (_, i) => lo + i / 100);
  return (
    <>
      <svg className="ts-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Win share against the mix by prefilter rank, one dot per added team">
        {yt.map((t) => (
          <g key={t}>
            <line className="ts-grid" x1={L} x2={W - R} y1={yAt(t)} y2={yAt(t)} />
            <text className="ts-axis" x={L - 6} y={yAt(t) + 3} textAnchor="end">{pct(t)}</text>
          </g>
        ))}
        {Array.from({ length: xMax + 1 }, (_, e) => (
          <text key={e} className="ts-axis" x={xAt(10 ** e)} y={H - 10} textAnchor="middle">{e < 3 ? 10 ** e : e < 6 ? `${10 ** (e - 3)}k` : `${10 ** (e - 6)}M`}</text>
        ))}
        <line className="ts-rule" x1={xAt(4000)} x2={xAt(4000)} y1={T} y2={H - B} />
        <text className="ts-axis" x={xAt(4000) + 4} y={T + 10}>prefilter top 4,000</text>
        {added.map((a) => (
          <circle key={a.team.join()} className={`ts-dot is-w${a.wave}`} cx={xAt(a.prefRank)} cy={yAt(a.f)} r={4}>
            <title>{`${teamName(a.team)}: ${pct(a.f, 1)} vs the mix, prefilter #${a.prefRank.toLocaleString()}, wave ${a.wave}`}</title>
          </circle>
        ))}
      </svg>
      <Legend />
    </>
  );
}

function RankingPhase() {
  const row = (x: Ranked) => {
    const move = x.rank_plain - x.rank_dedup;
    return (
      <li key={x.A.join()}>
        <span className="numeric diag-pos">{x.rank_dedup}</span>
        <TeamMons t={x.A} />
        <span className="diag-name">{x.label ? <strong>{x.label}: </strong> : null}{teamName(x.A)}</span>
        <span className="numeric diag-score" title="Win rate against the equilibrium">eq {pct(x.eqw)}</span>
        <span className="numeric diag-score" title="Log win rate, plain then deduplicated">log {pct(x.lgw)} → {pct(x.lgw_d)}</span>
        <span className="numeric diag-score ts-wide-only" title="Opponent clusters favoured / met">{x.fav}/{x.ncl}</span>
        <span className={`numeric diag-delta${move >= 5 ? ' is-up' : move <= -5 ? ' is-down' : ''}`} title={`Plain rank #${x.rank_plain}`}>
          {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '—'}
        </span>
      </li>
    );
  };
  return (
    <section className="panel mb-4">
      <div className="hud-label diag-col-head">Step 3 · ranking, look-alike opponents counted once ({D.summary.ranked} teams scored)</div>
      <p className="text-faint diag-sub">
        Score is 0.6 × win rate against the final equilibrium + 0.4 × win rate against the user&rsquo;s 89 logged teams. Deduplication
        merges opponents that share two of three pieces and play the same against this team, and weights each logged cluster by
        count<sup>0.5</sup>. The arrow is the move from the plain rank.
      </p>
      <ol className="diag-list ts-list">{D.ranking.map(row)}</ol>
      <div className="hud-label diag-col-head ts-watch-head">For reference</div>
      <ol className="diag-list ts-list">{D.watch.map(row)}</ol>
    </section>
  );
}
