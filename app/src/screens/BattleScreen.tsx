import { useMemo } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, displayName, parseRef, LEAGUE_BY_ID } from '../lib/data';
import { bestBuddyEligible, chargesOf, getEntry, mkBattleMon, shieldMatrix, verdictLine } from '../lib/engine';
import { BestBuddyToggle } from '../components/BestBuddyToggle';
import { MovePicker } from '../components/MovePicker';
import { HeldOutNote } from '../components/HeldOutNote';
import type { IV, LeagueId } from '../lib/types';
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
  fastIdx,
  onFast,
  disabledCharges,
  onToggleCharge,
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
  fastIdx: number;
  onFast: (i: number) => void;
  disabledCharges: string[];
  onToggleCharge: (moveId: string) => void;
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
  const chargeOptions = chargesOf(species.chargeMove, species.chargeMove2);

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
          <div className="battle-mon-bars">
            {([['ATK', entry.atk, 200], ['DEF', entry.def, 200], ['HP', entry.hp, 250]] as const).map(
              ([lab, v, ceil]) => (
                <span className="battle-mon-bar" key={lab} title={`${lab} ${v.toFixed(1)}`}>
                  <i>{lab}</i>
                  <span><span style={{ width: `${Math.min(100, (v / ceil) * 100)}%` }} /></span>
                  <b className="numeric">{Math.round(v)}</b>
                </span>
              ),
            )}
          </div>
        </div>
      </div>

      <IVAdjuster iv={iv} onBump={onBump} size={30} />

      <BestBuddyToggle on={bestBuddy} eligible={bbEligible} onChange={onBestBuddy} />

      <div>
        <div className="text-muted text-xs tracking-[0.08em] uppercase mb-1.5">
          Fast move
        </div>
        {/* One fast move is equipped, so past one option the pool belongs in a
            picker rather than a wall of chips — Smeargle learns 82 and Unown
            16, which flooded this panel and pushed everything below it away.
            Same component the report screen uses, so the two behave alike. */}
        {species.fastMoves.length > 1 ? (
          <>
            <div className="bt-chips">
              <ChipButton active onClick={() => undefined}>
                {species.fastMoves[Math.min(fastIdx, species.fastMoves.length - 1)].name}
              </ChipButton>
            </div>
            <MovePicker
              count={species.fastMoves.length}
              moves={species.fastMoves}
              isActive={(m) => m.id === species.fastMoves[Math.min(fastIdx, species.fastMoves.length - 1)].id}
              onPick={(m) => onFast(species.fastMoves.findIndex((x) => x.id === m.id))}
            />
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {species.fastMoves.map((m, i) => (
              <ChipButton key={m.id} active={fastIdx === i} onClick={() => onFast(i)}>
                {m.name}
              </ChipButton>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-muted text-xs tracking-[0.08em] uppercase mb-1.5">
          Charge moves {chargeOptions.length > 1 ? '(both equipped — untoggle to test a single move)' : ''}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chargeOptions.map((m) => (
            <ChipButton key={m.id} active={!disabledCharges.includes(m.id)} onClick={() => onToggleCharge(m.id)}>
              {m.name}
            </ChipButton>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted text-xs tracking-[0.08em] uppercase mb-1.5">
          Shields
        </div>
        <div className="bt-shield-row">
          {SHIELD_LABELS.map((l, i) => (
            <ChipButton key={i} active={shields === i} onClick={() => onShields(i)}>
              {l}
            </ChipButton>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted text-xs tracking-[0.08em] uppercase mb-1.5">
          Starting energy — {energy}%
        </div>
        <input type="range" min={0} max={100} step={10} value={energy} onChange={(e) => onEnergy(Number(e.target.value))} className="bt-range" />
      </div>
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
  const { league, battleA, battleB, ivA, ivB, fastA, fastB, disabledChargesA, disabledChargesB, shieldsA, shieldsB, energyA, energyB, bestBuddyA, bestBuddyB } = state;

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
    const charges = chargesOf(speciesA.chargeMove, speciesA.chargeMove2).filter((c) => !disabledChargesA.includes(c.id));
    return mkBattleMon(entryA, fast, charges.length ? charges : [speciesA.chargeMove], speciesA.types);
  }, [speciesA, entryA, fastA, disabledChargesA]);

  const monB = useMemo(() => {
    const fast = speciesB.fastMoves[Math.min(fastB, speciesB.fastMoves.length - 1)];
    const charges = chargesOf(speciesB.chargeMove, speciesB.chargeMove2).filter((c) => !disabledChargesB.includes(c.id));
    return mkBattleMon(entryB, fast, charges.length ? charges : [speciesB.chargeMove], speciesB.types);
  }, [speciesB, entryB, fastB, disabledChargesB]);

  const matrix = useMemo(
    () => shieldMatrix(monA, monB, energyA, energyB, state.optimizeTiming),
    [monA, monB, energyA, energyB, state.optimizeTiming],
  );
  const current = matrix[shieldsA][shieldsB];
  const winCount = matrix.flat().filter((r) => r.win).length;

  const bumpA = (key: keyof IV, delta: number) => patch({ ivA: { ...ivA, [key]: Math.max(0, Math.min(15, ivA[key] + delta)) } });
  const bumpB = (key: keyof IV, delta: number) => patch({ ivB: { ...ivB, [key]: Math.max(0, Math.min(15, ivB[key] + delta)) } });
  const toggleChargeA = (moveId: string) =>
    patch({ disabledChargesA: disabledChargesA.includes(moveId) ? disabledChargesA.filter((id) => id !== moveId) : [...disabledChargesA, moveId] });
  const toggleChargeB = (moveId: string) =>
    patch({ disabledChargesB: disabledChargesB.includes(moveId) ? disabledChargesB.filter((id) => id !== moveId) : [...disabledChargesB, moveId] });

  const winner = current.win ? nameA : nameB;
  const loser = current.win ? nameB : nameA;
  const margin = Math.abs(current.margin);

  return (
    <>
      <ScreenHeader
        title="Battle"
        blurb="Head-to-head PvP simulation: independent movesets, starting energy and shield counts per side, with selective baiting when a mon carries two charge moves of different costs."
        aside={<HeldOutNote compact />}
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
            onSpecies={(id) => patch({ battleA: id, fastA: 0, disabledChargesA: [], bestBuddyA: false })}
            iv={ivA}
            onBump={bumpA}
            fastIdx={fastA}
            onFast={(i) => patch({ fastA: i })}
            disabledCharges={disabledChargesA}
            bestBuddy={bestBuddyA}
            onBestBuddy={(v) => patch({ bestBuddyA: v })}
            onToggleCharge={toggleChargeA}
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
          onSpecies={(id) => patch({ battleB: id, fastB: 0, disabledChargesB: [], bestBuddyB: false })}
          iv={ivB}
          onBump={bumpB}
          fastIdx={fastB}
          onFast={(i) => patch({ fastB: i })}
          disabledCharges={disabledChargesB}
          bestBuddy={bestBuddyB}
          onBestBuddy={(v) => patch({ bestBuddyB: v })}
          onToggleCharge={toggleChargeB}
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
                      {e.bait && <span className="tag tag-neutral bt-bait-tag">bait</span>}
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
