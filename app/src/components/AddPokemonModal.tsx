import { useEffect, useMemo, useRef, useState } from 'react';
import { displayName, movesFor, parseRef, speciesOf } from '../lib/data';
import { bestSpreadFor, chargesOf, getEntry, selectedCharges } from '../lib/engine';
import { SpeciesSearch } from './SpeciesSearch';
import { Sprite } from './Sprite';
import { TypeBadge } from './TypeBadge';
import { IVAdjuster } from './IVAdjuster';
import type { IV, LeagueId } from '../lib/types';

/**
 * Add a Pokemon to a team, with its build.
 *
 * The slot's "+" opens this rather than dropping a species in at its rated set.
 * The search box beside the slots is still there and still the fast path — this
 * is for when the build matters, which on a team it usually does: §1d records
 * that the rated set is often not the played set, and a team of three is
 * exactly where that bites.
 *
 * Everything defaults to the rated set and the rank-1 spread, so committing
 * immediately gives the same result the search box would have. Nothing here has
 * to be touched for the fast path to stay fast.
 */

export interface AddPokemonChoice {
  ref: string;
  /** Empty means the league's rated set. */
  chargeIds: string[];
  fastIdx: number;
  iv: IV;
}

export function AddPokemonModal({
  league,
  restrictTo,
  onCommit,
  onClose,
}: {
  league: LeagueId;
  restrictTo?: ReadonlySet<string>;
  onCommit: (choice: AddPokemonChoice) => void;
  onClose: () => void;
}) {
  const [ref, setRef] = useState<string>('');
  const [fastIdx, setFastIdx] = useState(0);
  const [chargeIds, setChargeIds] = useState<string[]>([]);
  const [iv, setIv] = useState<IV>({ a: 0, d: 15, s: 15 });
  const panel = useRef<HTMLDivElement>(null);

  const sp = ref ? speciesOf(ref) : null;
  const rated = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  const best = useMemo(() => (ref && sp ? bestSpreadFor(ref, league, true) : null), [ref, sp, league]);

  // Picking a species resets the build: a fast-move index or charge id carried
  // over from the previous pick names a move the new species does not learn.
  // The same bug the nav search had (see App.tsx), in a place where it would be
  // even less visible.
  useEffect(() => {
    if (!sp || !rated || !best) return;
    setFastIdx(Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)));
    setChargeIds(rated.charges.map((c) => c.id));
    setIv({ a: best.a, d: best.d, s: best.s });
  }, [ref, sp, rated, best]);

  // Escape closes; focus moves into the panel so the keyboard lands somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entry = useMemo(() => (ref ? getEntry(ref, iv, league).entry : null), [ref, iv, league]);
  const allCharges = sp ? chargesOf(sp.chargeMove, sp.chargeMove2).concat(sp.chargeMoves) : [];
  const chargePool = useMemo(() => {
    const seen = new Set<string>();
    return allCharges.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [allCharges]);

  const toggleCharge = (id: string) =>
    setChargeIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id],
    );

  const commit = () => {
    if (!ref) return;
    onCommit({ ref, chargeIds, fastIdx, iv });
    onClose();
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Add a Pokémon to the team"
      >
        <div className="modal-head">
          <span className="hud-label">Add a Pokémon</span>
          <button className="btn btn-sm modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <SpeciesSearch
            id="modal-species"
            value={ref}
            onChange={setRef}
            placeholder="Search any Pokémon…"
            includeShadow
            restrictTo={restrictTo}
            className="modal-search"
          />

          {!sp && (
            <p className="text-faint modal-hint">
              Pick a Pokémon to choose its moves and roll. Both default to what the league rates, so
              adding one without touching anything matches the quick picker beside the slots.
            </p>
          )}

          {sp && rated && entry && (
            <>
              <div className="modal-id" style={{
                ['--t1' as string]: `var(--type-${sp.types[0]})`,
                ['--t2' as string]: `var(--type-${sp.types[1] ?? sp.types[0]})`,
              }}>
                <Sprite sprite={sp.sprite} dex={sp.dex} size={72} shadow={parseRef(ref).shadow} />
                <div className="min-w-0">
                  <div className="modal-name">{displayName(ref)}</div>
                  <div className="modal-types">{sp.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
                  <div className="numeric modal-stats">
                    <span><i>CP</i>{entry.cp}</span>
                    <span><i>LVL</i>{entry.lvl}</span>
                    <span><i>RANK</i>{entry.rank}</span>
                    <span><i>SP</i>{(entry.sp / 1e6).toFixed(2)}M</span>
                  </div>
                </div>
              </div>

              <div className="modal-section">
                <div className="hud-label">IVs</div>
                <IVAdjuster
                  iv={iv}
                  onBump={(k, d) => setIv((v) => ({ ...v, [k]: Math.max(0, Math.min(15, v[k] + d)) }))}
                  onSet={(k, val) => setIv((v) => ({ ...v, [k]: val }))}
                  size={28}
                />
                <button
                  className="btn btn-sm modal-reset"
                  onClick={() => best && setIv({ a: best.a, d: best.d, s: best.s })}
                  title="Back to the rank-1 roll for this league"
                >
                  Rank-1 roll
                </button>
              </div>

              <div className="modal-section">
                <div className="hud-label">Fast move</div>
                <div className="modal-moves">
                  {sp.fastMoves.map((m, i) => (
                    <button
                      key={m.id}
                      className={`btn chip-btn${i === fastIdx ? ' is-active' : ''}`}
                      onClick={() => setFastIdx(i)}
                      title={`${m.energyGain} energy over ${m.turns} turn${m.turns > 1 ? 's' : ''}`}
                    >
                      {m.name}
                      <span className="numeric modal-move-eco">
                        {(m.energyGain / m.turns).toFixed(1)}<i>e/t</i>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-section">
                <div className="hud-label">
                  Charged moves <span className="text-faint">— pick up to two</span>
                </div>
                <div className="modal-moves">
                  {chargePool.map((c) => (
                    <button
                      key={c.id}
                      className={`btn chip-btn${chargeIds.includes(c.id) ? ' is-active' : ''}`}
                      onClick={() => toggleCharge(c.id)}
                      title={`${c.energy} energy · ${(c.power / c.energy).toFixed(2)} damage per energy`}
                    >
                      {c.name}
                      <span className="numeric modal-move-eco">
                        {c.energy}<i>e</i>
                      </span>
                    </button>
                  ))}
                </div>
                {chargeIds.length === 0 && (
                  <p className="text-faint modal-hint">
                    A Pokémon with no charged move can still be added — it will simply never throw one.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm is-primary" onClick={commit} disabled={!ref}>
            Add to team
          </button>
        </div>
      </div>
    </div>
  );
}

/** Resolve a modal choice into the moves the engine should use. */
export function movesForChoice(choice: AddPokemonChoice, league: LeagueId) {
  const sp = speciesOf(choice.ref);
  if (!sp) return null;
  const rated = movesFor(sp, league);
  const fast = sp.fastMoves[Math.min(choice.fastIdx, sp.fastMoves.length - 1)] ?? rated.fast;
  const charges = choice.chargeIds.length ? selectedCharges(sp, choice.chargeIds) : rated.charges;
  return { fast, charges };
}
