import { useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, displayName, parseRef, LEAGUE_BY_ID } from '../lib/data';
import { bestBuddyEligible, chargesOf, getEntry, mkBattleMon, shieldMatrix, verdictLine } from '../lib/engine';
import { BestBuddyToggle } from '../components/BestBuddyToggle';
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
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HudLabel>{label}</HudLabel>
      <SpeciesSearch
        id={`battle-${label}`}
        value={speciesId}
        onChange={onSpecies}
        placeholder="Search species…"
        includeShadow
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Sprite sprite={species.sprite} dex={species.dex} size={64} shadow={isShadow} bestBuddy={entry.lvl > 50} className="sprite-holo" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20 }}>
            {species.name}
            {isShadow ? <span style={{ color: 'var(--shadow-aura)' }}> ⟡</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '2px 0 4px' }}>
            {species.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
          <div className="text-muted numeric" style={{ fontSize: 12 }}>
            CP {entry.cp} · L{entry.lvl} · #{entry.rank}/4096
          </div>
        </div>
      </div>

      <IVAdjuster iv={iv} onBump={onBump} size={30} />

      <BestBuddyToggle on={bestBuddy} eligible={bbEligible} onChange={onBestBuddy} />

      <div>
        <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Fast move
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {species.fastMoves.map((m, i) => (
            <ChipButton key={m.id} active={fastIdx === i} onClick={() => onFast(i)}>
              {m.name}
            </ChipButton>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Charge moves {chargeOptions.length > 1 ? '(both equipped — untoggle to test a single move)' : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chargeOptions.map((m) => (
            <ChipButton key={m.id} active={!disabledCharges.includes(m.id)} onClick={() => onToggleCharge(m.id)}>
              {m.name}
            </ChipButton>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Shields
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {SHIELD_LABELS.map((l, i) => (
            <ChipButton key={i} active={shields === i} onClick={() => onShields(i)}>
              {l}
            </ChipButton>
          ))}
        </div>
      </div>

      <div>
        <div className="text-muted" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Starting energy — {energy}%
        </div>
        <input type="range" min={0} max={100} step={10} value={energy} onChange={(e) => onEnergy(Number(e.target.value))} style={{ width: '100%' }} />
      </div>
    </div>
  );
}

function HpBar({ label, hp, maxHp, color }: { label: string; hp: number; maxHp: number; color: string }) {
  const pct = (hp / maxHp) * 100;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <span className="text-muted">{label}</span>
        <span className="numeric">
          {Math.round(hp)} / {maxHp} HP ({pct.toFixed(0)}%)
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--color-neutral-300)', marginTop: 3 }}>
        <div
          style={{
            height: 8,
            background: color,
            width: `${pct}%`,
            transition: 'width var(--dur-4) var(--ease-out)',
          }}
        />
      </div>
    </div>
  );
}

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
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 30ch', minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>Battle simulator</h3>
          <div className="text-muted" style={{ fontSize: 12 }}>
            Head-to-head PvP simulation: independent movesets, starting energy, and shield counts per side, with selective
            baiting when a mon carries two charge moves of different costs.
          </div>
          <HeldOutNote />
        </div>

        <div style={{ flex: 'none' }}>
          <div className="hud-label" style={{ marginBottom: 7 }}>
            <span>Charge timing</span>
          </div>
          <div className="form-toggle" role="group" aria-label="Charge move timing">
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
          <div className="text-muted" style={{ fontSize: 11, marginTop: 6, maxWidth: '34ch' }}>
            {state.optimizeTiming
              ? 'Holds each charge for the turn the opponent’s fast move registers — fewer free turns given away, but no longer comparable to PvPoke’s numbers.'
              : 'Throws the moment a move is charged, as PvPoke does. Not optimal play, but it is what published ratings are measured against.'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: 'var(--border-strong) solid var(--rule-strong)' }}>
        <div style={{ borderRight: 'var(--border-strong) solid var(--rule-strong)' }}>
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

      <div style={{ border: 'var(--border-strong) solid var(--rule-strong)', borderTop: 0, padding: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 'none', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <HudLabel live>Outcome</HudLabel>
            <div
              className="anim-rise"
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 22,
                color: 'var(--color-accent-700)',
                marginTop: 4,
              }}
            >
              {winner} beats {loser}
            </div>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
              {margin.toFixed(0)}% HP margin at {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
              {current.cmpDecided ? ' · decided by CMP (simultaneous charge move, higher attack throws first)' : ''}
            </div>
          </div>
          <HpBar label={nameA} hp={current.hpA} maxHp={Math.round(current.maxHpA)} color="var(--color-accent)" />
          <HpBar label={nameB} hp={current.hpB} maxHp={Math.round(current.maxHpB)} color="var(--color-neutral-500)" />
          <div style={{ fontSize: 12 }}>{winner} wins {winCount} of 9 shield-count combinations.</div>
          <div className="text-muted" style={{ fontSize: 11, maxWidth: '42ch' }}>
            {verdictLine(entryA.rank)} · {verdictLine(entryB.rank)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="panel-title">
            Every shield combination
          </div>
          <table className="table" style={{ width: 'auto' }}>
            <thead>
              <tr>
                <th></th>
                {SHIELD_LABELS.map((l) => (
                  <th key={l} style={{ textAlign: 'center' }}>
                    P2 {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, sA) => (
                <tr key={sA}>
                  <th style={{ textAlign: 'left' }}>P1 {SHIELD_LABELS[sA]}</th>
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
                        <div className="text-muted" style={{ fontSize: 10 }}>
                          {Math.abs(r.margin).toFixed(0)}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
            Click any cell to load that shield scenario. Rows are Pokémon 1's shields, columns are Pokémon 2's.
          </p>
        </div>
      </div>

      <div style={{ border: 'var(--border-strong) solid var(--rule-strong)', borderTop: 0, padding: 20 }}>
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

      <div style={{ border: 'var(--border-strong) solid var(--rule-strong)', borderTop: 0, padding: 20 }}>
        <div className="panel-title">
          Charge move log — {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
        </div>
        {current.log.filter((e) => e.kind === 'charge').length === 0 ? (
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
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
                    <td style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>{actorName}</td>
                    <td>{e.moveName}</td>
                    <td>
                      {e.bait && <span className="tag tag-neutral" style={{ marginRight: 6 }}>bait</span>}
                      {e.shielded ? (
                        <span style={{ fontSize: 12 }}>shielded — 1 dmg</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--color-accent-700)' }}>{e.damage} dmg</span>
                      )}
                    </td>
                    <td>{Math.round(e.hpA)}</td>
                    <td>{Math.round(e.hpB)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-muted" style={{ fontSize: 11, margin: '10px 0 0' }}>
          A shielded charge move always deals 1 damage regardless of which move is thrown, so a mon with two charge moves of
          different energy costs spends the cheaper one into a shield ("bait") and saves the pricier, harder-hitting move for
          when the opponent is out of shields.
        </p>
      </div>
    </>
  );
}
