import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, displayName, parseRef, makeRef, LEAGUE_BY_ID } from '../lib/data';
import {
  ENERGY_CAP, STAGE_MAX, STAGE_MIN, bestBuddyEligible, bestSpreadFor, buffMultiplier, defaultSpreadFor, dmg, fastMoveCounts,
  getEntry, mkBattleMon, selectedCharges, shieldMatrix,
  type BaitMode, type Stages,
} from '../lib/engine';
import { BestBuddyToggle } from '../components/BestBuddyToggle';
import { MovesPanel } from '../components/MovesPanel';
import type { BattleMon, ChargeMove, FastMove, IV, LeagueId, Species } from '../lib/types';
import { Sprite } from '../components/Sprite';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { IVAdjuster } from '../components/IVAdjuster';
import { BattleTimeline, frameAt, type Frame } from '../components/BattleTimeline';
import { HudLabel } from '../components/Hud';
import { TypeBadge } from '../components/TypeBadge';
import { isPokemonType } from '../lib/pokemonTypes';

/** `+2`, `-1`, `0` — signed so a debuff is never mistaken for a buff. */
const fmtStage = (n: number): string => (n > 0 ? `+${n}` : String(n));

const SHIELD_LABELS = ['0 shields', '1 shield', '2 shields'];

const BAIT: { label: string; title: string }[] = [
  { label: 'Off', title: 'Never baits: always builds to its hardest-hitting move' },
  { label: 'Selective', title: 'Baits when the read pays off — PvPoke’s default' },
  { label: 'Always', title: 'Baits whenever shields are up, and the opponent shields every charged move it throws' },
];

/** `Water Pulse` → `WP`, `Psychic` → `Psy`: the label inside a charge bubble. */
const abbrev = (name: string): string => {
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 3) : name.slice(0, 3);
};

const typeVar = (type: string): CSSProperties =>
  isPokemonType(type) ? ({ ['--type' as string]: `var(--type-${type})` } as CSSProperties) : {};

/** −1 / value / +1, clamped. Stat stages share it with nothing else, so it stays here. */
function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="bt-stepper" role="group" aria-label={label}>
      <i>{label}</i>
      <button type="button" className="btn btn-sm" aria-label={`Lower ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <b className="numeric">{fmtStage(value)}</b>
      <button type="button" className="btn btn-sm" aria-label={`Raise ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

/**
 * Everything PvPoke keeps behind its Options fold, folded the same way. A
 * `<details>` overlaying the panel rather than growing it — opening it moves
 * nothing — and it stays open while the timeline beneath it re-simulates, so a
 * setting can be swept and its effect watched. The summary names whatever is
 * off its default, so a closed fold never hides a live setting.
 */
function BattleOptions({ fast, energy, onEnergy, hp, maxHp, onHp, bait, onBait, stages, onStages }: {
  fast: FastMove; energy: number; onEnergy: (n: number) => void;
  hp: number | null; maxHp: number; onHp: (n: number | null) => void;
  bait: BaitMode; onBait: (b: BaitMode) => void;
  stages: Stages; onStages: (s: Stages) => void;
}) {
  const curHp = Math.min(hp ?? maxHp, maxHp);
  const set = [
    curHp < maxHp && `${curHp} HP`,
    energy > 0 && `${Math.round(energy)} energy`,
    bait !== 1 && `bait ${BAIT[bait].label.toLowerCase()}`,
    (stages.atk || stages.def) && `${fmtStage(stages.atk)}/${fmtStage(stages.def)}`,
  ].filter(Boolean);
  return (
    <details className="bt-opts">
      <summary className="bt-opts-sum">
        <span>Options</span>
        {set.length > 0 && <span className="bt-opts-set numeric">{set.join(' · ')}</span>}
      </summary>
      <div className="bt-opts-panel">
        <EnergyControl energy={energy} onEnergy={onEnergy} fast={fast} />

        <div className="bt-opt">
          <div className="flex items-baseline justify-between gap-2">
            <HudLabel>Starting HP</HudLabel>
            <span className="numeric bt-energy-read">{curHp}<i>/{maxHp}</i></span>
          </div>
          <div className="flex items-center gap-2">
            <input type="range" min={1} max={maxHp} step={1} value={curHp} className="bt-hp-range" aria-label="Starting HP"
              onChange={(e) => onHp(Number(e.target.value) >= maxHp ? null : Number(e.target.value))} />
            <button type="button" className="btn btn-sm" disabled={curHp >= maxHp} onClick={() => onHp(null)}>Full</button>
          </div>
        </div>

        <div className="bt-opt">
          <HudLabel>Shield baiting</HudLabel>
          <div className="bt-seg" role="group" aria-label="Shield baiting">
            {BAIT.map((b, i) => (
              <button key={b.label} type="button" className={`chip-btn${bait === i ? ' is-active' : ''}`} aria-pressed={bait === i} title={b.title}
                onClick={() => onBait(i as BaitMode)}>{b.label}</button>
            ))}
          </div>
        </div>

        <div className="bt-opt">
          <HudLabel>Stat stages</HudLabel>
          <div className="flex gap-3 flex-wrap">
            <Stepper label="Atk" value={stages.atk} min={STAGE_MIN} max={STAGE_MAX} onChange={(atk) => onStages({ ...stages, atk })} />
            <Stepper label="Def" value={stages.def} min={STAGE_MIN} max={STAGE_MAX} onChange={(def) => onStages({ ...stages, def })} />
          </div>
        </div>
      </div>
    </details>
  );
}

function Side({
  label,
  speciesId,
  onSpecies,
  onForm,
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
  hp,
  onHp,
  bait,
  onBait,
  stages,
  onStages,
  league,
}: {
  label: string;
  speciesId: string;
  onSpecies: (id: string) => void;
  /** Normal / Shadow: the same species, so moves and roll carry over. */
  onForm: (ref: string) => void;
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
  hp: number | null;
  onHp: (n: number | null) => void;
  bait: BaitMode;
  onBait: (b: BaitMode) => void;
  stages: Stages;
  onStages: (s: Stages) => void;
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
      <div className="bt-side-head">
        <HudLabel>{label}</HudLabel>
        <SpeciesSearch
          id={`battle-${label}`}
          value={speciesId}
          onChange={onSpecies}
          placeholder="Search species…"
          includeShadow
        />
      </div>

      <div className="battle-mon">
        <span className="battle-mon-art">
          <Sprite sprite={species.sprite} dex={species.dex} size={64} shadow={isShadow} bestBuddy={entry.lvl > 50} className="sprite-holo" sparkle sparkleKey={league} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="battle-mon-title">
            <div className="battle-mon-name">
              {species.name}
              {isShadow ? <span className="bt-shadow-mark"> ⟡</span> : null}
            </div>
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

      <div className="bt-iv">
        <IVAdjuster iv={iv} onBump={onBump} size={24} />
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

      {/* The same panel the report uses, compacted to the equipped moves with
          every list behind its picker. Sharing the component also shares its
          rule that a Pokemon is never left with nothing to throw. */}
      <MovesPanel
        species={species}
        moveIdx={fastIdx}
        onMoveIdx={onFast}
        chargeIds={chargeIds}
        onChargeIds={onChargeIds}
        compact
      />

      <div className="bt-side-toggles">
        <div className="bt-seg bt-shields" role="group" aria-label="Shields">
          {SHIELD_LABELS.map((l, i) => (
            <button key={i} type="button" className={`chip-btn${shields === i ? ' is-active' : ''}`} aria-pressed={shields === i}
              aria-label={l} title={l} onClick={() => onShields(i)}>
              <span className="bt-shield-glyph" aria-hidden="true">⬢</span>{i}
            </button>
          ))}
        </div>
        {species.shadowEligible && (
          <div className="form-toggle" role="group" aria-label="Form">
            <button type="button" className={`form-opt${isShadow ? '' : ' is-active'}`} aria-pressed={!isShadow}
              onClick={() => onForm(makeRef(baseId, false))}>Normal</button>
            <button type="button" className={`form-opt form-opt-shadow${isShadow ? ' is-active' : ''}`} aria-pressed={isShadow}
              onClick={() => onForm(makeRef(baseId, true))}>Shadow</button>
          </div>
        )}
        <BestBuddyToggle on={bestBuddy} eligible={bbEligible} onChange={onBestBuddy} />
      </div>

      <BattleOptions fast={fast} energy={energy} onEnergy={onEnergy} hp={hp} maxHp={entry.hp} onHp={onHp}
        bait={bait} onBait={onBait} stages={stages} onStages={onStages} />
    </div>
  );
}

/**
 * One side's live readout in the console: HP, energy, shields left, and a
 * bubble per charged move that fills toward its cost — all as of the turn the
 * timeline is showing. Each bubble carries what the move does to this
 * opponent, which is what PvPoke's hover card answers.
 */
function SideStatus({ side, name, frame, maxHp, mon, foe, stages, foeStages }: {
  side: 'a' | 'b'; name: string; frame: Frame; maxHp: number; mon: BattleMon; foe: BattleMon; stages: Stages; foeStages: Stages;
}) {
  const hp = side === 'a' ? frame.hpA : frame.hpB;
  const energy = side === 'a' ? frame.energyA : frame.energyB;
  const shields = side === 'a' ? frame.shieldsA : frame.shieldsB;
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const atk = mon.atk * buffMultiplier(stages.atk);
  const def = foe.def * buffMultiplier(foeStages.def);
  return (
    <div className={`bt-status is-${side}`}>
      <div className="bt-status-name">{name}</div>
      <div className={`bt-hp${pct <= 25 ? ' is-low' : pct <= 50 ? ' is-mid' : ''}`} role="meter" aria-label={`${name} HP`} aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={Math.round(hp)}>
        <span style={{ width: `${pct}%` }} />
        <b className="numeric">{Math.round(hp)} / {Math.round(maxHp)}</b>
      </div>
      <div className="bt-status-row">
        {mon.charges.map((c: ChargeMove) => {
          const d = dmg(atk, def, c, foe.types);
          const fill = Math.min(1, energy / c.energy);
          const counts = fastMoveCounts(mon.fast, c);
          const tip = [
            c.name,
            `${d} damage (${((d / foe.hp) * 100).toFixed(1)}%)`,
            `${c.energy} energy · ${(d / c.energy).toFixed(2)} dpe`,
            counts.length ? `${counts.join('-')} ${mon.fast.name}` : `${mon.fast.name} gains no energy`,
          ].join('\n');
          return (
            <span key={c.id} className={`bt-bubble${fill >= 1 ? ' is-ready' : ''}`} tabIndex={0} data-tip={tip} aria-label={tip.replace(/\n/g, ', ')}
              style={{ ...typeVar(c.type), ['--fill' as string]: `${fill * 100}%` }}>
              {abbrev(c.name)}
            </span>
          );
        })}
        <span className="bt-status-energy numeric">{Math.round(energy)}<i>energy</i></span>
        <span className="bt-status-shields" aria-label={`${shields} shields left`}>
          {Array.from({ length: shields }, (_, i) => <span key={i} aria-hidden="true">⬢</span>)}
        </span>
      </div>
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

/** One side of the phone versus strip: who, at what roll, and its HP at the turn shown. Tapping it edits that side. */
function VersusMon({ side, refId, sprite, dex, cp, iv, hp, maxHp, won, editing, onEdit }: {
  side: '1' | '2'; refId: string; sprite: string; dex: number; cp: number; iv: IV; hp: number; maxHp: number; won: boolean; editing: boolean; onEdit: () => void;
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <button type="button" className={`bt-vs-mon is-p${side}${won ? ' is-winner' : ''}`} aria-pressed={editing} onClick={onEdit}
      aria-label={`Edit Pokémon ${side}, ${displayName(refId)}: ${won ? 'wins' : 'loses'}, ${Math.round(pct)}% HP`}>
      <Sprite sprite={sprite} dex={dex} size={44} shadow={parseRef(refId).shadow} />
      <span className="bt-vs-text">
        <span className="bt-vs-name">{displayName(refId)}</span>
        <span className="bt-vs-meta numeric">{cp} CP</span>
        <span className="bt-vs-meta numeric">{iv.a}/{iv.d}/{iv.s}</span>
        {won && <span className="bt-vs-tag">Wins</span>}
      </span>
      <span className="bt-vs-hp" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
    </button>
  );
}

/** The three numbers a spread contributes to state, without the rest of it. */
const ivOf = (e: { a: number; d: number; s: number }): IV => ({ a: e.a, d: e.d, s: e.s });

/** Replay speed against real time: PvPoke's default is 8x. */
const REPLAY_SPEED = 8;

const monFor = (species: Species, entry: Parameters<typeof mkBattleMon>[0], fastIdx: number, chargeIds: string[]) => {
  const fast = species.fastMoves[Math.min(fastIdx, species.fastMoves.length - 1)];
  const charges = selectedCharges(species, chargeIds);
  return mkBattleMon(entry, fast, charges.length ? charges : [species.chargeMove], species.types);
};

export function BattleScreen() {
  const { state, patch } = useAppState();
  const {
    league, battleA, battleB, ivA, ivB, fastA, fastB, chargeIdsA, chargeIdsB, shieldsA, shieldsB, energyA, energyB,
    bestBuddyA, bestBuddyB, startHpA, startHpB, baitA, baitB, stagesA, stagesB,
  } = state;

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

  const monA = useMemo(() => monFor(speciesA, entryA, fastA, chargeIdsA), [speciesA, entryA, fastA, chargeIdsA]);
  const monB = useMemo(() => monFor(speciesB, entryB, fastB, chargeIdsB), [speciesB, entryB, fastB, chargeIdsB]);
  // A starting HP is clamped to the roll's, so an IV change that lowers HP cannot leave it above full.
  const hpA = startHpA === null ? undefined : Math.min(startHpA, entryA.hp);
  const hpB = startHpB === null ? undefined : Math.min(startHpB, entryB.hp);

  const matrix = useMemo(
    () => shieldMatrix(monA, monB, energyA, energyB, state.optimizeTiming, hpA, hpB, { baitA, baitB, stagesA, stagesB }),
    [monA, monB, energyA, energyB, state.optimizeTiming, hpA, hpB, baitA, baitB, stagesA, stagesB],
  );
  const current = matrix[shieldsA][shieldsB];
  const winCount = matrix.flat().filter((r) => r.win).length;
  const total = current.log.length ? current.log[current.log.length - 1].turn : 0;

  // The turn on show. A pin belongs to the fight it was set on, so any change
  // that re-simulates drops it back to the end — the outcome — without an
  // effect to reset it. A preview (hovering the timeline) overrides the pin.
  const [pin, setPin] = useState<{ log: unknown; turn: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const turn = preview ?? (pin?.log === current.log ? pin.turn : total);
  const start: Frame = { hpA: hpA ?? entryA.hp, hpB: hpB ?? entryB.hp, energyA, energyB, shieldsA, shieldsB };
  const frame = frameAt(current.log, turn, start);

  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const replay = () => {
    cancelAnimationFrame(raf.current);
    const log = current.log;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(total, Math.floor(((now - t0) * REPLAY_SPEED) / 500));
      setPin({ log, turn: t });
      if (t < total) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const moveOf = (side: 'A' | 'B', name: string) => {
    const sp = side === 'A' ? speciesA : speciesB;
    return sp.fastMoves.find((m) => m.name === name) ?? sp.chargeMoves.find((m) => m.name === name);
  };

  const bumpA = (key: keyof IV, delta: number) => patch({ ivA: { ...ivA, [key]: Math.max(0, Math.min(15, ivA[key] + delta)) } });
  const bumpB = (key: keyof IV, delta: number) => patch({ ivB: { ...ivB, [key]: Math.max(0, Math.min(15, ivB[key] + delta)) } });
  // Shadow cannot keep Return; the rest of the moveset carries across forms.
  const noReturn = (ids: string[]) => ids.filter((id) => id !== 'RETURN');

  // Phones show one side's controls at a time (CSS); desktop shows both.
  const [editing, setEditing] = useState<'a' | 'b'>('a');
  const edit = (side: 'a' | 'b') => {
    setEditing(side);
    // Bring the editor's top up under the strip, where the strip will be once
    // pinned (its sticky offset plus its height), not where it is right now.
    const sw = document.querySelector('.bt-edit-switch');
    const vs = document.querySelector<HTMLElement>('.bt-versus');
    if (sw && vs) {
      const pinnedBottom = parseFloat(getComputedStyle(vs).top) + vs.offsetHeight;
      window.scrollTo({ top: sw.getBoundingClientRect().top + window.scrollY - pinnedBottom - 8 });
    }
  };

  const winner = current.win ? nameA : nameB;
  const loser = current.win ? nameB : nameA;
  const margin = Math.abs(current.margin);

  return (
    <>
      <ScreenHeader
        title="Battle"
        blurb="Head-to-head PvP simulation. Point at the timeline to scrub through the fight; Options holds starting HP, energy, baiting and stat stages."
      />
      {/* Phones only (CSS), pinned under the slim nav: both Pokémon and how
          the battle stands at the turn shown stay in view while either side is
          edited below. */}
      <div className="bt-versus" role="group" aria-label="Matchup">
        <VersusMon side="1" refId={battleA} sprite={speciesA.sprite} dex={speciesA.dex} cp={entryA.cp} iv={ivA}
          hp={frame.hpA} maxHp={current.maxHpA} won={current.win} editing={editing === 'a'} onEdit={() => edit('a')} />
        <div className="bt-vs-mid">
          <span className="bt-vs-vs">VS</span>
          <span className="numeric">{margin.toFixed(0)}%</span>
          <span className="bt-vs-shields numeric" title="Shields, Pokémon 1 v Pokémon 2">{shieldsA}v{shieldsB}</span>
        </div>
        <VersusMon side="2" refId={battleB} sprite={speciesB.sprite} dex={speciesB.dex} cp={entryB.cp} iv={ivB}
          hp={frame.hpB} maxHp={current.maxHpB} won={!current.win} editing={editing === 'b'} onEdit={() => edit('b')} />
      </div>

      <div className="bt-arena">
        <div className="seg-group bt-edit-switch" role="group" aria-label="Pokémon to edit">
          {(['a', 'b'] as const).map((k, i) => (
            <button key={k} type="button" className={`seg-btn${editing === k ? ' is-active' : ''}`} aria-pressed={editing === k} onClick={() => setEditing(k)}>
              Pokémon {i + 1} · {i === 0 ? nameA : nameB}
            </button>
          ))}
        </div>

        <div className={`bt-pair is-editing-${editing}`}>
          <div className="bt-pair-left">
            <Side
              label="Pokémon 1"
              speciesId={battleA}
              // The roll is species-specific, so it resets with the species —
              // the same rule the moves follow. Carried over, one species' rank-1
              // roll is an arbitrary mid-table one on the next.
              onSpecies={(id) => patch({ battleA: id, fastA: 0, chargeIdsA: [], bestBuddyA: false, startHpA: null, ivA: ivOf(defaultSpreadFor(id, league)) })}
              onForm={(ref) => patch({ battleA: ref, chargeIdsA: noReturn(chargeIdsA) })}
              iv={ivA}
              onBump={bumpA}
              onIv={(v) => patch({ ivA: v })}
              fastIdx={fastA}
              onFast={(i) => patch({ fastA: i })}
              chargeIds={chargeIdsA}
              onChargeIds={(ids) => patch({ chargeIdsA: ids })}
              bestBuddy={bestBuddyA}
              onBestBuddy={(v) => patch({ bestBuddyA: v })}
              shields={shieldsA}
              onShields={(n) => patch({ shieldsA: n })}
              energy={energyA}
              onEnergy={(n) => patch({ energyA: n })}
              hp={startHpA}
              onHp={(n) => patch({ startHpA: n })}
              bait={baitA}
              onBait={(b) => patch({ baitA: b })}
              stages={stagesA}
              onStages={(s) => patch({ stagesA: s })}
              league={league}
            />
          </div>
          <div className="bt-pair-right">
            <Side
              label="Pokémon 2"
              speciesId={battleB}
              onSpecies={(id) => patch({ battleB: id, fastB: 0, chargeIdsB: [], bestBuddyB: false, startHpB: null, ivB: ivOf(defaultSpreadFor(id, league)) })}
              onForm={(ref) => patch({ battleB: ref, chargeIdsB: noReturn(chargeIdsB) })}
              iv={ivB}
              onBump={bumpB}
              onIv={(v) => patch({ ivB: v })}
              fastIdx={fastB}
              onFast={(i) => patch({ fastB: i })}
              chargeIds={chargeIdsB}
              onChargeIds={(ids) => patch({ chargeIdsB: ids })}
              bestBuddy={bestBuddyB}
              onBestBuddy={(v) => patch({ bestBuddyB: v })}
              shields={shieldsB}
              onShields={(n) => patch({ shieldsB: n })}
              energy={energyB}
              onEnergy={(n) => patch({ energyB: n })}
              hp={startHpB}
              onHp={(n) => patch({ startHpB: n })}
              bait={baitB}
              onBait={(b) => patch({ baitB: b })}
              stages={stagesB}
              onStages={(s) => patch({ stagesB: s })}
              league={league}
            />
          </div>
        </div>

        {/* The console: both sides' state at the turn shown, the outcome, the
            timeline that picks the turn, and the controls that re-run it. */}
        <section className="bt-console" aria-label="Battle">
          <div className="bt-console-head">
            <SideStatus side="a" name={nameA} frame={frame} maxHp={current.maxHpA} mon={monA} foe={monB} stages={stagesA} foeStages={stagesB} />
            <div className="bt-verdict">
              <div className="bt-verdict-text">
                <HudLabel live>Outcome</HudLabel>
                <div className="anim-rise bt-winner">
                  {winner} beats {loser}
                </div>
                <div className="text-muted bt-margin">
                  {margin.toFixed(0)}% HP margin at {shieldsA}v{shieldsB} shields
                  {current.cmpDecided ? ' · CMP decided' : ''}
                </div>
                <div className="bt-matrix-note">{nameA} wins {winCount} of 9</div>
              </div>
              <div className="table-scroll">
                <table className="bt-matrix" aria-label="Every shield combination: rows are Pokémon 1's shields, columns Pokémon 2's">
                  <thead>
                    <tr>
                      <th scope="col"><abbr title="Pokémon 1 shields (rows) v Pokémon 2 shields (columns)">P1\P2</abbr></th>
                      {[0, 1, 2].map((n) => <th key={n} scope="col" className="bt-matrix-head">{n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, sA) => (
                      <tr key={sA}>
                        <th scope="row">{sA}</th>
                        {row.map((r, sB) => (
                          <td key={sB} className={`${r.win ? 'is-win' : 'is-loss'}${sA === shieldsA && sB === shieldsB ? ' is-active' : ''}`}
                            onClick={() => patch({ shieldsA: sA, shieldsB: sB })}
                            title={`${SHIELD_LABELS[sA]} v ${SHIELD_LABELS[sB]}: ${r.win ? nameA : nameB} by ${Math.abs(r.margin).toFixed(0)}%`}>
                            {Math.abs(r.margin).toFixed(0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <SideStatus side="b" name={nameB} frame={frame} maxHp={current.maxHpB} mon={monB} foe={monA} stages={stagesB} foeStages={stagesA} />
          </div>

          <BattleTimeline
            log={current.log}
            turn={turn}
            onPreview={setPreview}
            onPin={(t) => {
              cancelAnimationFrame(raf.current);
              setPin({ log: current.log, turn: t });
            }}
            moveOf={moveOf}
            maxHpA={current.maxHpA}
            maxHpB={current.maxHpB}
            nameA={nameA}
            nameB={nameB}
          />

          <div className="bt-console-foot">
            <button type="button" className="btn btn-sm bt-replay" onClick={replay} aria-label={`Replay at ${REPLAY_SPEED}x`}>
              ▶ Replay
            </button>
            <span className="numeric bt-clock">{(turn * 0.5).toFixed(1)}s<i> / {(total * 0.5).toFixed(1)}s</i></span>
            <div className="battle-timing">
              <span className="hud-label battle-timing-label">Charge timing</span>
              <div className="form-toggle flex-none" role="group" aria-label="Charge move timing">
                <button
                  type="button"
                  className={`form-opt form-opt-normal${!state.optimizeTiming ? ' is-active' : ''}`}
                  aria-pressed={!state.optimizeTiming}
                  onClick={() => patch({ optimizeTiming: false })}
                  title="Throws the moment a move is charged, handing the opponent free turns. Simpler, but not how PvPoke’s engine plays."
                >
                  Immediate
                </button>
                <button
                  type="button"
                  className={`form-opt form-opt-buddy${state.optimizeTiming ? ' is-active' : ''}`}
                  aria-pressed={state.optimizeTiming}
                  onClick={() => patch({ optimizeTiming: true })}
                  title="Holds each charge for the turn the opponent’s fast move registers, so fewer free turns are given away. PvPoke’s engine times its throws this way by default."
                >
                  Optimised
                </button>
              </div>
            </div>
          </div>
        </section>
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
