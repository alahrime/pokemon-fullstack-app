import { useCallback, useMemo, useRef } from 'react';
import { displayName, movesFor, parseRef, speciesOf } from '../lib/data';
import { bestSpreadFor } from '../lib/engine';
import { Sprite } from './Sprite';
import { TypeBadge } from './TypeBadge';
import type { LeagueId } from '../lib/types';

/**
 * One Pokemon as a card, at the exact spread and loadout the simulation used.
 *
 * Everything shown is read back from the same calls the engine made —
 * `bestSpreadFor` for the roll, `movesFor` for the set — rather than from
 * anything the display computed for itself. A card showing a different spread
 * than the one that earned the score would be worse than a card with less on it.
 *
 * THE TREATMENT
 *
 * The card is built out of the Pokemon's own two type colours, so a Steel/Fairy
 * card and a Water/Ghost card are recognisable across the room before either
 * name is read. Four layers, all CSS, all GPU-friendly:
 *
 *   1. a type-derived gradient wash, angled off the dual typing
 *   2. a foil sheen that tracks the pointer, using a conic gradient masked to
 *      the card and composited with `mix-blend-mode` so it lifts the artwork
 *      instead of greying it
 *   3. a parallax tilt — the whole card rotates a few degrees toward the
 *      cursor, with the sprite translated slightly further so it sits proud
 *   4. a rank foil for podium entries
 *
 * Pointer state travels as CSS custom properties rather than React state: a
 * `setState` per mousemove across ~75 cards would re-render the page on every
 * frame. Writing `--mx`/`--my` on the node keeps it entirely off the React
 * path, and the transform is composited.
 *
 * All of it is inert under `prefers-reduced-motion` — the tilt and sheen are
 * dropped in CSS, and the handler is never attached.
 */

export type CardSize = 'mini' | 'compact' | 'full';

const SPRITE: Record<CardSize, number> = { mini: 40, compact: 56, full: 88 };

/** Podium treatment for the first three of any ordered list. */
const RANK_CLASS = ['is-gold', 'is-silver', 'is-bronze'];

export function PokemonCard({
  refId,
  league,
  size = 'compact',
  metric,
  metricLabel,
  /** 0-based position in an ordered list; drives the podium foil. */
  rank,
  note,
  onClick,
  title,
  dim,
}: {
  refId: string;
  league: LeagueId;
  size?: CardSize;
  metric?: string | number;
  metricLabel?: string;
  rank?: number;
  note?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  dim?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const sp = speciesOf(refId);
  const { shadow } = parseRef(refId);
  const spread = useMemo(() => (sp ? bestSpreadFor(refId, league, true) : null), [sp, refId, league]);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);

  // Pointer position as 0..1 across the card, written straight to CSS vars.
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const node = el.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    node.style.setProperty('--mx', String((e.clientX - r.left) / r.width));
    node.style.setProperty('--my', String((e.clientY - r.top) / r.height));
  }, []);
  const onLeave = useCallback(() => {
    const node = el.current;
    if (!node) return;
    // Back to centre, so the card settles level rather than snapping.
    node.style.setProperty('--mx', '0.5');
    node.style.setProperty('--my', '0.5');
  }, []);

  if (!sp || !spread) return null;

  const t1 = sp.types[0];
  const t2 = sp.types[1] ?? sp.types[0];
  const podium = rank !== undefined && rank < 3 ? ` ${RANK_CLASS[rank]}` : '';

  // Bars read against a fixed ceiling rather than the pool's, so the shape of a
  // spread means the same thing in every league.
  const bar = (v: number, ceiling: number) => `${Math.min(100, (v / ceiling) * 100)}%`;

  return (
    <div
      ref={el}
      className={`pc pc-${size}${onClick ? ' is-clickable' : ''}${dim ? ' is-dim' : ''}${podium}`}
      style={{
        // Consumed by every layer below; see the CSS.
        ['--t1' as string]: `var(--type-${t1})`,
        ['--t2' as string]: `var(--type-${t2})`,
      }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={onClick}
      title={title ?? displayName(refId)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* Decorative layers. Ordered back to front and pointer-transparent so
          none of them steals the click from the card itself. */}
      <span className="pc-wash" aria-hidden="true" />
      <span className="pc-foil" aria-hidden="true" />
      <span className="pc-grid" aria-hidden="true" />

      <div className="pc-body">
        <div className="pc-head">
          <div className="pc-art">
            <span className="pc-halo" aria-hidden="true" />
            <Sprite sprite={sp.sprite} dex={sp.dex} size={SPRITE[size]} shadow={shadow} />
            {shadow && <span className="pc-shadow" title="Shadow">◆</span>}
          </div>
          <div className="pc-id">
            <div className="pc-name">{displayName(refId)}</div>
            <div className="pc-types">{sp.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
            {size !== 'mini' && (
              <div className="numeric pc-roll" title={`Rank-1 roll · level ${spread.lvl}`}>
                <span className="pc-iv">{spread.a}/{spread.d}/{spread.s}</span>
                <span className="pc-cp">{spread.cp}<i>CP</i></span>
                <span className="pc-lvl">L{spread.lvl}</span>
              </div>
            )}
          </div>
          {metric !== undefined && (
            <div className="pc-metric">
              <div className="numeric pc-metric-value">{metric}</div>
              {metricLabel && <div className="hud-label pc-metric-label">{metricLabel}</div>}
            </div>
          )}
        </div>

        {size === 'full' && (
          <div className="pc-stats">
            {([['ATK', spread.atk, 200], ['DEF', spread.def, 200], ['HP', spread.hp, 250]] as const).map(
              ([label, v, ceil]) => (
                <div className="pc-stat" key={label}>
                  <span className="hud-label">{label}</span>
                  <span className="pc-stat-bar">
                    <span style={{ width: bar(v, ceil) }} />
                  </span>
                  <span className="numeric pc-stat-value">{Math.round(v)}</span>
                </div>
              ),
            )}
          </div>
        )}

        {size !== 'mini' && moves && (
          <div className="pc-moves" title="The league's rated set — what was simulated">
            <span className="pc-move pc-move-fast">
              <span className="pc-move-name">{moves.fast.name}</span>
              {size === 'full' && (
                <span className="numeric pc-move-eco">
                  {(moves.fast.energyGain / moves.fast.turns).toFixed(1)}<i>e/t</i>
                </span>
              )}
            </span>
            {moves.charges.map((c) => (
              <span className="pc-move" key={c.id}>
                <span className="pc-move-name">{c.name}</span>
                {size === 'full' && (
                  <span className="numeric pc-move-eco">
                    {(c.power / c.energy).toFixed(2)}<i>dpe</i>
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {note && <div className="pc-note">{note}</div>}
      </div>
    </div>
  );
}

/** A team as a row of cards, sized to how many have to fit. */
export function TeamCards({
  refs,
  league,
  size,
  onPick,
}: {
  refs: string[];
  league: LeagueId;
  size?: CardSize;
  onPick?: (ref: string) => void;
}) {
  const density: CardSize = size ?? (refs.length > 3 ? 'mini' : 'compact');
  return (
    <div className={`pc-team pc-team-${refs.length}`}>
      {refs.map((r) => (
        <PokemonCard
          key={r}
          refId={r}
          league={league}
          size={density}
          onClick={onPick ? () => onPick(r) : undefined}
        />
      ))}
    </div>
  );
}
