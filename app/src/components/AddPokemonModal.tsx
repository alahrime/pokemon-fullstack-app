import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayName, movesFor, parseRef, speciesOf } from '../lib/data';
import { bestSpreadFor, chargesOf, defaultSpreadFor, getEntry, selectedCharges } from '../lib/engine';
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

/**
 * How tall the results list may be inside this panel.
 *
 * Derived from the panel's guaranteed floor rather than picked, and it has to
 * move whenever that floor does. `.modal-panel` now stands at least
 * `min(500px, 88vh)`; on the shortest viewport that matters (720) that is 500,
 * less the 46px head, the 51px foot, the body's 16px of padding above the
 * search, the 40px search box itself and 16px of clearance under the list —
 * which leaves 330 for a dropdown that spends 2 on its own border.
 *
 * Six rows at the 52px the search uses. Fewer than the nine the taller panel
 * held, which is the trade: the dialog no longer covers most of the screen.
 * Raising this past the space the panel has puts the last rows back under the
 * footer, out of reach — the bug the floor exists to prevent.
 */
export const MODAL_LIST_H = 328;

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
  // What the slot opens on: the same roll the cards and the rankings show, so
  // adding without touching anything matches what the rest of the app said this
  // Pokemon was. The Rank-1 button below still aims at rank 1, which is a
  // different spread wherever the two disagree.
  const opening = useMemo(
    () => (ref && sp ? defaultSpreadFor(ref, league, true) : null),
    [ref, sp, league],
  );

  // Picking a species resets the build: a fast-move index or charge id carried
  // over from the previous pick names a move the new species does not learn.
  // The same bug the nav search had (see App.tsx), in a place where it would be
  // even less visible.
  useEffect(() => {
    if (!sp || !rated || !opening) return;
    setFastIdx(Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)));
    setChargeIds(rated.charges.map((c) => c.id));
    setIv({ a: opening.a, d: opening.d, s: opening.s });
  }, [ref, sp, rated, opening]);

  /**
   * Escape closes; focus moves into the panel so the keyboard lands somewhere,
   * and goes back where it came from when the panel goes away.
   *
   * `preventScroll` is the whole point of both calls. The scrim is fixed and
   * the panel is centred in it, but a plain `.focus()` still scrolls the
   * document to bring the target into view: opening this from the slots on a
   * long team page jumped the page from the top to 2559px, and closing it left
   * you there. Focus should move; the page should not.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      // The "+" that opened this is gone once the slot is filled, so only
      // restore to something still on the page.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
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

  /*
   * Rendered into <body>, not where it is written.
   *
   * `position: fixed` is only fixed to the viewport while no ancestor holds a
   * transform, filter or perspective — any of those makes that ancestor the
   * containing block instead. The screen wrapper animates in on a transform,
   * so the scrim measured 1280x5639 and centred the panel 2709px down the
   * page: opening the dialog from the slots scrolled the whole page to it, and
   * closing it left you stranded there. That is the "focus jumps to the middle
   * of the page" report.
   *
   * A portal ends the whole class of bug rather than the one instance of it —
   * no ancestor of this component can contain it, whatever it is styled with
   * later.
   */
  return createPortal(
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
          <button className="btn btn-sm py-0.5 px-2" onClick={onClose} aria-label="Close">✕</button>
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
            listHeight={MODAL_LIST_H}
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
                  <div className="flex gap-1 my-1 mx-0 flex-wrap">{sp.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
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
    </div>,
    document.body,
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
