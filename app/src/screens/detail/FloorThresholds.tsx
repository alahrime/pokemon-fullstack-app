import { useMemo, useState } from 'react';
import { ShieldIcon, SwordIcon } from '../../components/Icons';
import { Sprite } from '../../components/Sprite';
import { SPECIES_BY_ID, parseRef } from '../../lib/data';
import { statText, thresholdLadders, tierColor, type HeatPalette, type ThresholdLadder } from '../../lib/engine';

type Kind = 'break' | 'bulk';
const TABS: { id: Kind; label: string; hint: string; Icon: typeof SwordIcon }[] = [
  { id: 'break', label: 'Breakpoints', hint: 'Damage your attack floor guarantees', Icon: SwordIcon },
  { id: 'bulk', label: 'Bulkpoints', hint: 'Damage your defense floor caps', Icon: ShieldIcon },
];

/** How many steps of this ladder a floor at `v` is past. 0 is none: the floor buys nothing here. */
export const stepsCleared = (row: ThresholdLadder, v: number) => row.steps.filter((s) => s.from <= v).length - 1;

/**
 * What the stat floor buys, opponent by opponent.
 *
 * Each row is one opponent's damage across this species' whole stat range: a
 * thin whisker where the damage is at its worst, then a box of shaded steps,
 * one per breakpoint (or bulkpoint), each darker than the last. The floor is
 * the vertical line, so every box it reaches is a matchup it secured a step
 * in, and how far into the box it sits is how many of that opponent's steps it
 * has. Rows the floor has not reached are left out; the one it would reach
 * next is named instead.
 *
 * Rows are ordered by their first step, which stacks the boxes into a
 * staircase — the line cuts its lower edge, and the rows just above the cut
 * are the newest gains.
 */
export function FloorThresholds({ subject: ref, league, moveIdx, bestBuddy, floor, palette }: {
  subject: string;
  league: Parameters<typeof thresholdLadders>[1];
  moveIdx: number;
  bestBuddy: boolean;
  floor: { atk: number; def: number };
  palette: HeatPalette;
}) {
  const [kind, setKind] = useState<Kind>('break');
  const { lo, hi, rows } = useMemo(() => thresholdLadders(ref, league, moveIdx, kind, bestBuddy), [ref, league, moveIdx, kind, bestBuddy]);
  const v = kind === 'break' ? floor.atk : floor.def;
  const unit = kind === 'break' ? 'Atk' : 'Def';
  const pos = (x: number) => (hi === lo ? 0 : ((x - lo) / (hi - lo)) * 100);
  const gained = useMemo(
    () => rows.filter((r) => stepsCleared(r, v) > 0).sort((a, b) => a.steps[1].from - b.steps[1].from || a.rank - b.rank),
    [rows, v],
  );
  const next = useMemo(
    () => rows.filter((r) => r.steps[1].from > v).sort((a, b) => a.steps[1].from - b.steps[1].from || a.rank - b.rank)[0],
    [rows, v],
  );
  const species = SPECIES_BY_ID.get(parseRef(ref).id)!;
  const move = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];

  return (
    <section className="panel hud-frame ftc" aria-label="What the stat floor buys">
      <div className="panel-title">What your floor buys</div>
      <div className="viz-tabs" role="tablist" aria-label="Threshold kind">
        {TABS.map(({ id, label, hint, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={kind === id}
            className={`viz-tab${kind === id ? ' is-active' : ''}`} onClick={() => setKind(id)}>
            <span className="viz-tab-icon"><Icon size={20} /></span>
            <span className="min-w-0">
              <span className="viz-tab-label">{label}</span>
              <span className="viz-tab-hint">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-muted text-sm ftc-sum">
        {kind === 'break' ? `${move.name} into each opponent` : "Each opponent's fast move into you"} · {unit} ≥{' '}
        <b className="numeric">{statText(v)}</b> secures a step against <b className="numeric">{gained.length}</b> of {rows.length}
        {next && <> · next: <b className="numeric">{statText(next.steps[1].from)}</b> vs {next.info.name}</>}
      </p>
      {gained.length > 0 && (
        <div className="ftc-rows" style={{ ['--v' as string]: `${pos(v)}%` }}>
          <div className="ftc-row ftc-axis" aria-hidden="true">
            <span />
            <span className="ftc-plot numeric">
              <span>{statText(lo)}</span>
              <span className="ftc-axis-v">{unit} {statText(v)}</span>
              <span>{statText(hi)}</span>
            </span>
            <span />
          </div>
          {gained.map((r) => {
            const k = stepsCleared(r, v);
            const n = r.steps.length;
            return (
              <div key={r.info.id} className="ftc-row">
                <span className="ftc-mon">
                  <Sprite sprite={r.info.sprite} dex={r.info.dex} size={24} shadow={r.info.shadow} />
                  <span className="ftc-name">{r.info.name}</span>
                </span>
                <span className="ftc-plot">
                  <span className="ftc-whisker" style={{ left: 0, width: `${pos(r.steps[1].from)}%` }} />
                  {r.steps.slice(1).map((s, i) => {
                    const end = i + 2 < n ? r.steps[i + 2].from : hi;
                    return (
                      <span key={s.from} className="ftc-step"
                        style={{ left: `${pos(s.from)}%`, width: `${Math.max(0.6, pos(end) - pos(s.from))}%`, background: tierColor(i + 1, n, palette) }}
                        title={`${unit} ≥ ${statText(s.from)}: ${kind === 'break' ? 'deals' : 'takes'} ${s.dmg}`} />
                    );
                  })}
                  <span className="ftc-line" />
                </span>
                <span className="numeric ftc-gain" title={`${k} of ${n - 1} ${kind === 'break' ? 'breakpoints' : 'bulkpoints'}`}>
                  {r.steps[0].dmg}→{r.steps[k].dmg}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
