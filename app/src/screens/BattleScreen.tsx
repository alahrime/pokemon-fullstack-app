import { useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import { getEntry, mkBattleMon, shieldMatrix, verdictLine } from '../lib/engine';
import type { ChargeMove, IV, LeagueId } from '../lib/types';
import { Sprite } from '../components/Sprite';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { IVAdjuster } from '../components/IVAdjuster';
import { ChipButton } from '../components/Seg';

const SHIELD_LABELS = ['0 shields', '1 shield', '2 shields'];

function chargeOptionsFor(chargeMove: ChargeMove, chargeMove2: ChargeMove | null): ChargeMove[] {
  return chargeMove2 ? [chargeMove, chargeMove2] : [chargeMove];
}

function Side({
  label,
  speciesId,
  onSpecies,
  iv,
  onBump,
  fastIdx,
  onFast,
  chargeIdx,
  onCharge,
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
  chargeIdx: number;
  onCharge: (i: number) => void;
  shields: number;
  onShields: (n: number) => void;
  energy: number;
  onEnergy: (n: number) => void;
  league: LeagueId;
}) {
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry } = getEntry(speciesId, iv, league);
  const chargeOptions = chargeOptionsFor(species.chargeMove, species.chargeMove2);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>{label}</div>
      <SpeciesSearch id={`battle-${label}`} value={speciesId} onChange={onSpecies} placeholder="Search species…" />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Sprite dex={species.dex} size={64} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20 }}>{species.name}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '2px 0 4px' }}>
            {species.types.map((t) => (
              <span key={t} className="tag tag-neutral" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
                {t}
              </span>
            ))}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            CP {entry.cp} · L{entry.lvl} · #{entry.rank}/4096
          </div>
        </div>
      </div>

      <IVAdjuster iv={iv} onBump={onBump} size={30} />

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
          Charge move
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chargeOptions.map((m, i) => (
            <ChipButton key={m.id} active={chargeIdx === i} onClick={() => onCharge(i)}>
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

export function BattleScreen() {
  const { state, patch, beginner } = useAppState();
  const { league, battleA, battleB, ivA, ivB, fastA, fastB, chargeA, chargeB, shieldsA, shieldsB, energyA, energyB } = state;

  const speciesA = SPECIES_BY_ID.get(battleA)!;
  const speciesB = SPECIES_BY_ID.get(battleB)!;
  const { entry: entryA } = getEntry(battleA, ivA, league);
  const { entry: entryB } = getEntry(battleB, ivB, league);

  const monA = useMemo(() => {
    const fast = speciesA.fastMoves[Math.min(fastA, speciesA.fastMoves.length - 1)];
    const opts = chargeOptionsFor(speciesA.chargeMove, speciesA.chargeMove2);
    return mkBattleMon(entryA, fast, opts[Math.min(chargeA, opts.length - 1)]);
  }, [speciesA, entryA, fastA, chargeA]);

  const monB = useMemo(() => {
    const fast = speciesB.fastMoves[Math.min(fastB, speciesB.fastMoves.length - 1)];
    const opts = chargeOptionsFor(speciesB.chargeMove, speciesB.chargeMove2);
    return mkBattleMon(entryB, fast, opts[Math.min(chargeB, opts.length - 1)]);
  }, [speciesB, entryB, fastB, chargeB]);

  const matrix = useMemo(() => shieldMatrix(monA, monB, energyA, energyB), [monA, monB, energyA, energyB]);
  const current = matrix[shieldsA][shieldsB];
  const winCount = matrix.flat().filter((r) => r.win).length;

  const bumpA = (key: keyof IV, delta: number) => patch({ ivA: { ...ivA, [key]: Math.max(0, Math.min(15, ivA[key] + delta)) } });
  const bumpB = (key: keyof IV, delta: number) => patch({ ivB: { ...ivB, [key]: Math.max(0, Math.min(15, ivB[key] + delta)) } });

  const winner = current.win ? speciesA : speciesB;
  const loser = current.win ? speciesB : speciesA;
  const margin = Math.abs(current.margin);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Battle simulator</h3>
        <div className="text-muted" style={{ fontSize: 12 }}>
          {beginner
            ? 'Pick two Pokémon, their moves, and how many shields each side uses — see who wins and by how much.'
            : 'Head-to-head PvP simulation: independent movesets, starting energy, and shield counts per side, all nine shield combinations at a glance.'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '2px solid var(--color-divider)' }}>
        <div style={{ borderRight: '2px solid var(--color-divider)' }}>
          <Side
            label="Pokémon 1"
            speciesId={battleA}
            onSpecies={(id) => patch({ battleA: id, fastA: 0, chargeA: 0 })}
            iv={ivA}
            onBump={bumpA}
            fastIdx={fastA}
            onFast={(i) => patch({ fastA: i })}
            chargeIdx={chargeA}
            onCharge={(i) => patch({ chargeA: i })}
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
          onSpecies={(id) => patch({ battleB: id, fastB: 0, chargeB: 0 })}
          iv={ivB}
          onBump={bumpB}
          fastIdx={fastB}
          onFast={(i) => patch({ fastB: i })}
          chargeIdx={chargeB}
          onCharge={(i) => patch({ chargeB: i })}
          shields={shieldsB}
          onShields={(n) => patch({ shieldsB: n })}
          energy={energyB}
          onEnergy={(n) => patch({ energyB: n })}
          league={league}
        />
      </div>

      <div style={{ border: '2px solid var(--color-divider)', borderTop: 0, padding: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 'none', minWidth: 260 }}>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 800,
              fontSize: 22,
              color: 'var(--color-accent-700)',
            }}
          >
            {winner.name} beats {loser.name}
          </div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
            {margin.toFixed(0)}% HP margin at {SHIELD_LABELS[shieldsA].toLowerCase()} vs {SHIELD_LABELS[shieldsB].toLowerCase()}
            {current.cmpDecided ? ' · decided by CMP (simultaneous charge move, higher attack throws first)' : ''}
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>{winner.name} wins {winCount} of 9 shield-count combinations.</div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 10, maxWidth: '42ch' }}>
            {verdictLine(entryA.rank, beginner)} · {verdictLine(entryB.rank, beginner)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 8 }}>
            Every shield combination
          </div>
          <table className="table" style={{ width: 'auto' }}>
            <thead>
              <tr>
                <th></th>
                {SHIELD_LABELS.map((l) => (
                  <th key={l} style={{ textAlign: 'center' }}>
                    {loser === speciesB ? `P2 ${l}` : `P2 ${l}`}
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
            Click any cell to load that shield scenario above. Rows are Pokémon 1's shields, columns are Pokémon 2's — matching
            pvpoke's battle matrix, asymmetric counts included (e.g. P1 at 0 shields vs P2 at 2).
          </p>
        </div>
      </div>
    </>
  );
}
