import { useMemo } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, displayName, parseRef, LEAGUE_BY_ID } from '../lib/data';
import { ENERGY_CAP, bestBuddyEligible, bestSpreadFor, getEntry, mkBattleMon, selectedCharges, shieldMatrix, verdictLine } from '../lib/engine';
import { BestBuddyToggle } from '../components/BestBuddyToggle';
import { MovesPanel } from '../components/MovesPanel';
import type { FastMove, IV, LeagueId } from '../lib/types';
import { Sprite } from '../components/Sprite';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { IVAdjuster } from '../components/IVAdjuster';
import { ChipButton } from '../components/Seg';
import { BattleTimeline } from '../components/BattleTimeline';
import { HudLabel } from '../components/Hud';
import { TypeBadge } from '../components/TypeBadge';

const SHIELD_LABELS = ['0 shields', '1 shield', '2 shields'];

function Side({
  label,
  speciesId,
  onSpecies,
  iv,
  onBump,
  onIv,
  fastIdx,
  onFast,
  chargeIds,
  onChargeIds,
  bestBuddy,
  onBestBuddy,
  shields,
  onShields,
  energy,
  onEnergy,
  league,
}: {
  label: string;
  speciesId: string;
  onSpecies: (id: string) => void;
  iv: IV;
  onBump: (key: keyof IV, delta: number) => void;
  onIv: (iv: IV) => void;
  fastIdx: number;
  onFast: (i: number) => void;
  chargeIds: string[];
  onChargeIds: (ids: string[]) => void;
  bestBuddy: boolean;
  onBestBuddy: (on: boolean) => void;
  shields: number;
  onShields: (n: number) => void;
  energy: number;
  onEnergy: (n: number) => void;
  league: LeagueId;
}) {
  // speciesId is a ref, so it may carry a `_shadow` suffix.
  const { id: baseId, shadow: isShadow } = parseRef(speciesId);
  const species = SPECIES_BY_ID.get(baseId)!;
  const bbEligible = bestBuddyEligible(species, LEAGUE_BY_ID.get(league)!);
  const { entry } = getEntry(speciesId, iv, league, bestBuddy && bbEligible);
  // The move the energy stepper counts in. Same clamp the simulation uses, so
  // the two never disagree about which move this side is throwing.
  const fast = species.fastMoves[Math.min(fastIdx, species.fastMoves.length - 1)];
  // Same Best Buddy state the entry above is priced at, so the target roll and
  // the rank beside it are computed under one level cap rather than two.
  const best = bestSpreadFor(speciesId, league, bestBuddy && bbEligible);
  const isBest = iv.a === best.a && iv.d === best.d && iv.s === best.s;

  return (
    <div className="bt-side">
      <HudLabel>{label}</HudLabel>
      <SpeciesSearch
        id={`battle-${label}`}
        value={speciesId}
        onChange={onSpecies}
        placeholder="Search species…"
        includeShadow
      />

      <div className="battle-mon">
        <span className="battle-mon-art">
          <Sprite sprite={species.sprite} dex={species.dex} size={104} shadow={isShadow} bestBuddy={entry.lvl > 50} className="sprite-holo" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="battle-mon-name">
            {species.name}
            {isShadow ? <span className="bt-shadow-mark"> ⟡</span> : null}
          </div>
          <div className="my-1 flex flex-wrap gap-1">
            {species.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
          {/* The spread, spelled out rather than abbreviated — this is the
              screen where the exact roll decides the outcome. */}
          <div className="numeric battle-mon-stats">
            <span><i>IV</i>{iv.a}/{iv.d}/{iv.s}</span>
            <span><i>CP</i>{entry.cp}</span>
            <span><i>LVL</i>{entry.lvl}</span>
            <span><i>RANK</i>{entry.rank}</span>
          </div>
          <div className="flex flex-col gap-[3px] mt-2">
            {/* The stat, not the damage figure: Shadow multiplies damage, it
                does not change Attack or Defense. The bar shows the stat and
                marks the multiplier's effect as a second segment. */}
            {([['ATK', entry.statAtk, entry.atk, 200], ['DEF', entry.statDef, entry.def, 200], ['HP', entry.hp, entry.hp, 250]] as const).map(
              ([lab, stat, effective, ceil]) => {
                const pct = (v: number) => Math.max(0, Math.min(100, (v / ceil) * 100));
                const lo = Math.min(pct(stat), pct(effective));
                const hi = Math.max(pct(stat), pct(effective));
                const gain = effective > stat;
                return (
                  <span
                    className="battle-mon-bar"
                    key={lab}
                    title={
                      Math.abs(effective - stat) > 0.05
                        ? `${lab} ${stat.toFixed(1)} — Shadow ${gain ? 'deals' : 'takes'} damage as if ${effective.toFixed(1)}`
                        : `${lab} ${stat.toFixed(1)}`
                    }
                  >
                    <i>{lab}</i>
                    <span>
                      <span style={{ width: `${lo}%` }} />
                      {hi - lo > 0.05 && (
                        <span
                          className={`battle-mon-shadow${gain ? ' is-gain' : ' is-loss'}`}
                          style={{ left: `${lo}%`, width: `${hi - lo}%` }}
                        />
                      )}
                    </span>
                    <b className="numeric">{Math.round(stat)}</b>
                  </span>
                );
              },
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <IVAdjuster iv={iv} onBump={onBump} size={30} />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Rank is of stat product within the 4096, so "rank 1" is the
              bulkiest legal roll under this league's cap — which in Great and
              Ultra is usually a *low* attack IV, and in Master is 15/15/15
              because nothing is capped. Reads the same call the rest of the
              app prices spreads with, so the button cannot disagree with the
              rank shown beside it. */}
          <button
            className="btn btn-sm bt-iv-best"
            onClick={() => onIv({ a: best.a, d: best.d, s: best.s })}
            disabled={isBest}
            title={
              isBest
                ? 'Already on the rank-1 roll for this league'
                : `Set to the rank-1 roll for this league — ${best.a}/${best.d}/${best.s}`
            }
          >
            Rank-1 roll
          </button>
          <span className="numeric bt-iv-rank">
            {isBest ? 'rank 1' : `rank ${entry.rank.toLocaleString()}`}
            <i>of 4,096</i>
          </span>
        </div>
      </div>

      <BestBuddyToggle on={bestBuddy} eligible={bbEligible} onChange={onBestBuddy} />

      {/* The same panel the report uses. It was two bespoke controls here: a
          fast-move picker, and chips that could only switch the two RATED
          charged moves off — so a non-default charged move could not be
          fielded at all. Sharing the component also shares its rule that a
          Pokemon is never left with nothing to throw. */}
      <MovesPanel
        species={species}
        moveIdx={fastIdx}
        onMoveIdx={onFast}
        chargeIds={chargeIds}
        onChargeIds={onChargeIds}
      />

      <div>
        <div className="text-muted text-xs tracking-[0.08em] uppercase mb-1.5">
          Shields
        </div>
        <div className="flex gap-1.5">
          {SHIELD_LABELS.map((l, i) => (
            <ChipButton key={i} active={shields === i} onClick={() => onShields(i)}>
              {l}
            </ChipButton>
          ))}
        </div>
      </div>

      <EnergyControl energy={energy} onEnergy={onEnergy} fast={fast} />
    </div>
  );
}

/**
 * Starting energy, counted in fast moves.
 *
 * A percentage is the wrong unit for this. Energy is not spent or gained
 * continuously — it arrives one fast move at a time, and what a player knows
 * is "two Counters in" rather than "24%". The slider stays for a free hand,
 * but the steppers move by exactly one throw of the move this side is
 * actually carrying, so the values they land on are the ones reachable in a
 * real fight.
 *
 * Stepping snaps as well as moves: from an off-grid value the buttons go to
 * the nearest whole throw in that direction, so a slider drag followed by a
 * click lands somewhere real. The ceiling is the last whole throw at or below
 * the 100 cap — a thirteenth 8-energy Counter would overflow it, so twelve is
 * where the button stops even though the slider can still reach 100.
 */
export function EnergyControl({
  energy,
  onEnergy,
  fast,
}: {
  energy: number;
  onEnergy: (n: number) => void;
  fast: FastMove;
}) {
  const gain = fast.energyGain;
  const countable = gain > 0;
  const moves = countable ? energy / gain : 0;
  const maxMoves = countable ? Math.floor(ENERGY_CAP / gain) : 0;
  const step = (dir: 1 | -1) => {
    if (!countable) return;
    // The epsilon keeps an exact multiple from being treated as off-grid by
    // floating-point noise — energy/gain is rarely clean.
    const next = dir > 0 ? Math.floor(moves + 1e-9) + 1 : Math.ceil(moves - 1e-9) - 1;
    onEnergy(Math.max(0, Math.min(maxMoves, next)) * gain);
  };

  return (
    <div className="bt-energy">
      <div className="flex items-baseline justify-between gap-2">
        <HudLabel>Starting energy</HudLabel>
        <span className="numeric bt-energy-read">
          {Math.round(energy)}
          <i>/{ENERGY_CAP}</i>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-sm bt-energy-step"
          onClick={() => step(-1)}
          disabled={!countable || moves <= 0}
          title={countable ? `One ${fast.name} less (${gain} energy)` : 'This move gains no energy'}
          aria-label={`Remove one ${fast.name}`}
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={ENERGY_CAP}
          // 1, not 10. The steppers land on multiples of the move's gain — 8,
          // 16, 24 for a Shadow Claw — and a slider that can only represent
          // tens put its thumb at 20 while the readout said 24. One control,
          // one state: the thumb has to be able to sit where the value is.
          step={1}
          value={energy}
          onChange={(e) => onEnergy(Number(e.target.value))}
          className="bt-range"
          aria-label="Starting energy"
        />
        <button
          type="button"
          className="btn btn-sm bt-energy-step"
          onClick={() => step(1)}
          disabled={!countable || moves >= maxMoves}
          title={countable ? `One ${fast.name} more (${gain} energy)` : 'This move gains no energy'}
          aria-label={`Add one ${fast.name}`}
        >
          +
        </button>
      </div>

      {countable && (
        <div className="bt-energy-moves">
          <span className="numeric bt-energy-count">
            {Number.isInteger(moves) ? moves : moves.toFixed(1)}
          </span>
          <span className="bt-energy-x">x</span>
          <span className="bt-energy-move">{fast.name}</span>
          <span className="text-faint bt-energy-gain numeric">{gain}<i>e</i> each</span>
        </div>
      )}
    </div>
  );
}

function HpBar({ label, hp, maxHp, color }: { label: string; hp: number; maxHp: number; color: string }) {
  const pct = (hp / maxHp) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs tracking-[0.06em] uppercase">
        <span className="text-muted">{label}</span>
        <span className="numeric">
          {Math.round(hp)} / {maxHp} HP ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="mt-[3px] h-2 bg-(--color-neutral-300)">
        <div
          className="h-2 transition-[width] duration-(--dur-4) ease-(--ease-out) motion-reduce:transition-none"
          style={{ background: color, width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** `+2`, `-1`, `0` — signed so a debuff is never mistaken for a buff. */
const fmtStage = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function BattleScreen() {
  const { state, patch } = useAppState();
  const { league, battleA, battleB, ivA, ivB, fastA, fastB, chargeIdsA, chargeIdsB, shieldsA, shieldsB, energyA, energyB, bestBuddyA, bestBuddyB } = state;

  // battleA / battleB are refs and may be Shadow variants, so resolve the base
  // form for stats and movepool but label with the Shadow-aware display name.
  const speciesA = SPECIES_BY_ID.get(parseRef(battleA).id)!;
  const speciesB = SPECIES_BY_ID.get(parseRef(battleB).id)!;
  const nameA = displayName(battleA);
  const nameB = displayName(battleB);
  // Shadow multipliers are already baked into these entries by getTable.
  // Eligibility is per species and league; an ineligible mon ignores the flag
  // rather than being blocked, matching how the report screen treats it.
  const bbA = bestBuddyA && bestBuddyEligible(speciesA, LEAGUE_BY_ID.get(league)!);
  const bbB = bestBuddyB && bestBuddyEligible(speciesB, LEAGUE_BY_ID.get(league)!);
  const { entry: entryA } = getEntry(battleA, ivA, league, bbA);
  const { entry: entryB } = getEntry(battleB, ivB, league, bbB);

  const monA = useMemo(() => {
    const fast = speciesA.fastMoves[Math.min(fastA, speciesA.fastMoves.length - 1)];
    const charges = selectedCharges(speciesA, chargeIdsA);
    return mkBattleMon(entryA, fast, charges.length ? charges : [speciesA.chargeMove], speciesA.types);
  }, [speciesA, entryA, fastA, chargeIdsA]);

  const monB = useMemo(() => {
    const fast = speciesB.fastMoves[Math.min(fastB, speciesB.fastMoves.length - 1)];
    const charges = selectedCharges(speciesB, chargeIdsB);
    return mkBattleMon(entryB, fast, charges.length ? charges : [speciesB.chargeMove], speciesB.types);
  }, [speciesB, entryB, fastB, chargeIdsB]);

  const matrix = useMemo(
    () => shieldMatrix(monA, monB, energyA, energyB, state.optimizeTiming),
    [monA, monB, energyA, energyB, state.optimizeTiming],
  );
  const current = matrix[shieldsA][shieldsB];
  const winCount = matrix.flat().filter((r) => r.win).length;

  const bumpA = (key: keyof IV, delta: number) => patch({ ivA: { ...ivA, [key]: Math.max(0, Math.min(15, ivA[key] + delta)) } });
  const bumpB = (key: keyof IV, delta: number) => patch({ ivB: { ...ivB, [key]: Math.max(0, Math.min(15, ivB[key] + delta)) } });
  const setChargesA = (ids: string[]) => patch({ chargeIdsA: ids });
  const setChargesB = (ids: string[]) => patch({ chargeIdsB: ids });

  const winner = current.win ? nameA : nameB;
  const loser = current.win ? nameB : nameA;
  const margin = Math.abs(current.margin);

  return (
    <>
      <ScreenHeader
        title="Battle"
        blurb="Head-to-head PvP simulation: independent movesets, starting energy and shield counts per side, with selective baiting when a mon carries two charge moves of different costs."
      />
      {/* One strip rather than a stacked column. Label, control and the
          consequence of the choice sit on a single baseline, so the setting
          costs one row instead of three and the horizontal space it was
          already occupying carries the explanation. */}
      <div className="battle-timing">
        <span className="hud-label battle-timing-label">Charge timing</span>
        <div className="form-toggle flex-none" role="group" aria-label="Charge move timing">
          <button
            type="button"
            className={`form-opt form-opt-normal${!state.optimizeTiming ? ' is-active' : ''}`}
            aria-pressed={!state.optimizeTiming}
            onClick={() => patch({ optimizeTiming: false })}
            title="Throw as soon as the move is available — matches PvPoke"
          >
            Immediate
          </button>
          <button
            type="button"
            className={`form-opt form-opt-buddy${state.optimizeTiming ? ' is-active' : ''}`}
            aria-pressed={state.optimizeTiming}
            onClick={() => patch({ optimizeTiming: true })}
            title="Hold until the release lands on the opponent's registration turn"
          >
            Optimised
          </button>
        </div>
        <p className="battle-timing-note text-muted">
          {state.optimizeTiming
            ? 'Holds each charge for the turn the opponent’s fast move registers — fewer free turns given away, but no longer comparable to PvPoke’s numbers.'
            : 'Throws the moment a move is charged, as PvPoke does. Not optimal play, but it is what published ratings are measured against.'}
        </p>
      </div>

      <div className="bt-pair">
        <div className="bt-pair-left">
          <Side
            label="Pokémon 1"
            speciesId={battleA}
            onSpecies={(id) => patch({ battleA: id, fastA: 0, chargeIdsA: [], bestBuddyA: false })}
            iv={ivA}
            onBump={bumpA}
            onIv={(v) => patch({ ivA: v })}
            fastIdx={fastA}
            onFast={(i) => patch({ fastA: i })}
            chargeIds={chargeIdsA}
            bestBuddy={bestBuddyA}
            onBestBuddy={(v) => patch({ bestBuddyA: v })}
            onChargeIds={setChargesA}
            shields={shieldsA}
            onShields={(n) => patch({ shieldsA: n })}
            energy={energyA}
            onEnergy={(n) => patch({ energyA: n })}
            league={league}
          />
        </div>
        <Side
          label="Pokémon 2"
          speciesId={battleB}
          onSpecies={(id) => patch({ battleB: id, fastB: 0, chargeIdsB: [], bestBuddyB: false })}
          iv={ivB}
          onBump={bumpB}
          onIv={(v) => patch({ ivB: v })}
          fastIdx={fastB}
          onFast={(i) => patch({ fastB: i })}
          chargeIds={chargeIdsB}
          bestBuddy={bestBuddyB}
          onBestBuddy={(v) => patch({ bestBuddyB: v })}
          onChargeIds={setChargesB}
          shields={shieldsB}
          onShields={(n) => patch({ shieldsB: n })}
          energy={energyB}
          onEnergy={(n) => patch({ energyB: n })}
          league={league}
        />
      </div>

      <div className="bt-result">
        <div className="bt-verdict">
          <div>
            <HudLabel live>Outcome</HudLabel>
            <div className="anim-rise bt-winner">
              {winner} beats {loser}
            </div>
            <div className="text-muted bt-margin">
              {margin.toFixed(0)}% HP margin at {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
              {current.cmpDecided ? ' · decided by CMP (simultaneous charge move, higher attack throws first)' : ''}
            </div>
          </div>
          <HpBar label={nameA} hp={current.hpA} maxHp={Math.round(current.maxHpA)} color="var(--color-accent)" />
          <HpBar label={nameB} hp={current.hpB} maxHp={Math.round(current.maxHpB)} color="var(--color-neutral-500)" />
          <div className="text-sm">{winner} wins {winCount} of 9 shield-count combinations.</div>
          <div className="text-muted bt-rank-note">
            {verdictLine(entryA.rank)} · {verdictLine(entryB.rank)}
          </div>
        </div>

        <div className="bt-matrix-col">
          <div className="panel-title">
            Every shield combination
          </div>
          <div className="table-scroll">
            <table className="table bt-matrix">
              <thead>
                <tr>
                  <th></th>
                  {SHIELD_LABELS.map((l) => (
                    <th key={l} className="bt-matrix-head">
                      P2 {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, sA) => (
                  <tr key={sA}>
                    <th className="text-left">P1 {SHIELD_LABELS[sA]}</th>
                    {row.map((r, sB) => {
                      const active = sA === shieldsA && sB === shieldsB;
                      return (
                        <td
                          key={sB}
                          onClick={() => patch({ shieldsA: sA, shieldsB: sB })}
                          style={{
                            textAlign: 'center',
                            cursor: 'pointer',
                            background: active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : undefined,
                            outline: active ? '2px solid var(--color-accent)' : undefined,
                            outlineOffset: -2,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: 'var(--font-heading)',
                              fontWeight: 800,
                              fontSize: 13,
                              color: r.win ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
                            }}
                          >
                            {r.win ? 'P1' : 'P2'}
                          </div>
                          <div className="text-muted text-2xs">
                            {Math.abs(r.margin).toFixed(0)}%
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted text-xs mt-2.5">
            Click any cell to load that shield scenario. Rows are Pokémon 1's shields, columns are Pokémon 2's.
          </p>
        </div>
      </div>

      <div className="border-2 border-t-0 border-(--rule-strong) p-5">
        <div className="panel-title">
          HP &amp; energy progression — {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
        </div>
        <BattleTimeline
          log={current.log}
          maxHpA={Math.round(current.maxHpA)}
          maxHpB={Math.round(current.maxHpB)}
          startEnergyA={energyA}
          startEnergyB={energyB}
          nameA={nameA}
          nameB={nameB}
        />
      </div>

      <div className="border-2 border-t-0 border-(--rule-strong) p-5">
        <div className="panel-title">
          Charge move log — {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
        </div>
        {current.log.filter((e) => e.kind === 'charge').length === 0 ? (
          <p className="text-muted bt-no-charge">
            Neither side reaches a charge move before the fight ends at this energy/shield setting.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Pokémon</th>
                  <th>Move</th>
                  <th>Outcome</th>
                  <th>Stat stages</th>
                  <th>{nameA} HP</th>
                  <th>{nameB} HP</th>
                </tr>
              </thead>
              <tbody>
                {current.log
                  .filter((e) => e.kind === 'charge')
                  .map((e, i) => {
                  const actorName = e.actor === 'A' ? nameA : nameB;
                  return (
                    <tr key={i}>
                      <td className="text-muted">{(e.turn * 0.5).toFixed(1)}s</td>
                      <td className="font-(family-name:--font-head) font-extrabold">{actorName}</td>
                      <td>{e.moveName}</td>
                      <td>
                        {e.bait && <span className="tag tag-neutral mr-1.5">bait</span>}
                        {e.shielded ? (
                          <span className="text-sm">shielded — 1 dmg</span>
                        ) : (
                          <span className="bt-dmg">{e.damage} dmg</span>
                        )}
                      </td>
                      {/* Stage state after this throw resolved. The buff text
                          appears on the throw that caused it; the running totals
                          below say where both sides stand from then on. */}
                      <td className="numeric battle-stages">
                        {e.buffText && <span className="battle-stage-hit">{e.buffText}</span>}
                        <span className="text-faint">
                          {nameA} {fmtStage(e.atkStageA)}/{fmtStage(e.defStageA)}
                          {' · '}
                          {nameB} {fmtStage(e.atkStageB)}/{fmtStage(e.defStageB)}
                        </span>
                      </td>
                      <td>{Math.round(e.hpA)}</td>
                      <td>{Math.round(e.hpB)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted text-xs mt-2.5">
          A shielded charge move always deals 1 damage regardless of which move is thrown, so a mon with two charge moves of
          different energy costs spends the cheaper one into a shield ("bait") and saves the pricier, harder-hitting move for
          when the opponent is out of shields. Stat-changing moves — Superpower, Acid Spray, Night Slash and
          around ninety others — apply their attack or defence stage on every throw that lands its chance,
          <strong> including when shielded</strong>, since a shield blocks damage and not the secondary effect.
          Every damage figure after that point, and the CMP tiebreak, uses the changed stat.
        </p>
      </div>
    </>
  );
}
