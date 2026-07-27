import { useState } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import { bpRowsFor, buildHeatCells, getEntry, opponentInfo, verdictLine } from '../lib/engine';
import { AndroidDevice } from '../components/frames/AndroidDevice';
import { Sprite } from '../components/Sprite';
import { SegButton, SegGroup } from '../components/Seg';

type OverlayState = 'collapsed' | 'scan' | 'result';
const OVERLAY_STATES: [OverlayState, string][] = [
  ['collapsed', 'Bubble'],
  ['scan', 'Confirm scan'],
  ['result', 'Result sheet'],
];

const OVERLAY_NOTES = [
  'Bubble shows rank only. One glance, no reading — colour carries the verdict, the number confirms it.',
  "Sheet opens on the confirm step, not the result: OCR of appraisal bars is the weak link, so correction gets the biggest touch targets in the app.",
  "Everything above 60% of the screen height stays clear, so the game's own appraisal UI is never hidden while you check.",
  'Save writes to the collection and collapses back to the bubble — the next catch is one tap away.',
];

export function OverlayScreen() {
  const { state, patch, bumpIv, beginner } = useAppState();
  const [overlay, setOverlay] = useState<OverlayState>('collapsed');
  const { league, species: speciesId, iv, oppId } = state;
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry, table } = getEntry(speciesId, iv, league);
  const spPct = entry.sp / table.best.sp;
  const opp = opponentInfo(oppId, league);
  const bpRows = bpRowsFor(speciesId, iv, league, opp).filter((r) => r.kind === 'Breakpoint').slice(0, 3);
  const miniCells = buildHeatCells(speciesId, iv, league, opp, 0, 'rank');
  const ocrConfidence = 94;

  return (
    <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div>
        <div style={{ marginBottom: 14 }}>
          <SegGroup>
            {OVERLAY_STATES.map(([id, label]) => (
              <SegButton key={id} active={overlay === id} onClick={() => setOverlay(id)}>
                {label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <AndroidDevice dark>
          <div style={{ position: 'relative', height: '100%', background: '#1b2420', overflow: 'hidden' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'repeating-linear-gradient(0deg,rgba(255,255,255,0.035) 0 1px,transparent 1px 26px)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 18,
                left: 16,
                right: 16,
                display: 'flex',
                justifyContent: 'space-between',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              <span>Game capture (simulated)</span>
              <span>CP {entry.cp}</span>
            </div>
            <div
              style={{
                position: 'absolute',
                top: 120,
                left: 0,
                right: 0,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.22)',
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: '-0.02em',
              }}
            >
              {species.name}
            </div>
            <div
              style={{
                position: 'absolute',
                top: 186,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 150,
                height: 150,
                border: '2px solid rgba(255,255,255,0.16)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Sprite dex={species.dex} size={120} />
            </div>
            <div style={{ position: 'absolute', top: 360, left: 38, right: 38, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(['a', 'd', 's'] as const).map((k, i) => {
                const label = ['Attack', 'Defense', 'HP'][i];
                const value = iv[k];
                return (
                  <div key={k}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: 'rgba(255,255,255,0.45)',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        marginBottom: 3,
                      }}
                    >
                      <span>{label}</span>
                      <span>{value}/15</span>
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {Array.from({ length: 15 }, (_, pi) => (
                        <span key={pi} style={{ flex: 1, height: 8, background: pi < value ? 'rgba(236,48,19,0.85)' : 'rgba(255,255,255,0.14)' }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {overlay === 'collapsed' && (
              <>
                <button
                  onClick={() => setOverlay('scan')}
                  style={{
                    position: 'absolute',
                    right: 14,
                    bottom: 150,
                    width: 64,
                    height: 64,
                    background: 'var(--color-accent)',
                    color: '#fff',
                    border: 0,
                    boxShadow: 'var(--shadow-lg)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    padding: '0 0 0 8px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11, letterSpacing: '0.06em', opacity: 0.8 }}>RANK</span>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, lineHeight: 1 }}>#{entry.rank}</span>
                </button>
                <div
                  style={{
                    position: 'absolute',
                    right: 86,
                    bottom: 166,
                    background: 'var(--color-text)',
                    color: 'var(--color-bg)',
                    fontSize: 11,
                    padding: '5px 8px',
                    letterSpacing: '0.04em',
                  }}
                >
                  {beginner ? 'Tap for the verdict' : `#${entry.rank} · ${(spPct * 100).toFixed(1)}%`}
                </div>
              </>
            )}

            {overlay === 'scan' && (
              <>
                <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, #0d0f0e 55%, transparent)' }} />
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--color-bg)', borderTop: '4px solid var(--color-accent)', padding: '18px 18px 26px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
                      Scan · {ocrConfidence}% match
                    </span>
                    <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setOverlay('collapsed')}>
                      Dismiss
                    </button>
                  </div>
                  <h4 style={{ margin: '0 0 2px' }}>Confirm what I read</h4>
                  <p className="text-muted" style={{ fontSize: 12, margin: '0 0 14px' }}>
                    {beginner
                      ? 'I read these from the appraisal bars. Fix anything that looks wrong — one wrong number changes the rank a lot.'
                      : 'Parsed from appraisal bars at 94% confidence. Defense flagged: bar edge ambiguous between 14 and 15.'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(['a', 'd', 's'] as const).map((k, i) => {
                      const label = ['Attack', 'Defense', 'HP'][i];
                      const flagged = i === 1;
                      return (
                        <div
                          key={k}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            border: '1px solid var(--color-divider)',
                            padding: '6px 8px',
                            background: flagged ? 'var(--color-accent-100)' : 'transparent',
                          }}
                        >
                          <span style={{ flex: 1, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
                          <span className="text-muted" style={{ fontSize: 10, letterSpacing: '0.06em' }}>
                            {flagged ? 'low confidence' : 'read ok'}
                          </span>
                          <button className="btn btn-secondary" style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }} onClick={() => bumpIv(k, -1)}>
                            –
                          </button>
                          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20, width: 30, textAlign: 'center' }}>{iv[k]}</span>
                          <button className="btn btn-secondary" style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }} onClick={() => bumpIv(k, 1)}>
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn btn-primary btn-block" style={{ minHeight: 48 }} onClick={() => setOverlay('result')}>
                    Rank it →
                  </button>
                </div>
              </>
            )}

            {overlay === 'result' && (
              <>
                <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, #0d0f0e 55%, transparent)' }} />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'var(--color-bg)',
                    borderTop: '4px solid var(--color-accent)',
                    maxHeight: '78%',
                    overflow: 'auto',
                  }}
                >
                  <div style={{ padding: '16px 18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
                        {table.league.name}
                      </span>
                      <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setOverlay('collapsed')}>
                        Close
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Sprite dex={species.dex} size={56} />
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 46, lineHeight: 1, letterSpacing: '-0.04em' }}>
                          #{entry.rank}
                        </span>
                        <span className="text-muted" style={{ fontSize: 13 }}>
                          / 4096 · {(spPct * 100).toFixed(2)}% of rank 1
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, margin: '4px 0 12px' }}>{verdictLine(entry.rank, beginner)}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '1px solid var(--color-divider)', marginBottom: 12 }}>
                      {[
                        ['Attack', entry.atk.toFixed(1)],
                        ['Defense', entry.def.toFixed(1)],
                        ['HP', String(entry.hp)],
                      ].map(([label, value], i) => (
                        <div key={label} style={{ padding: '8px 10px', borderRight: i < 2 ? '1px solid var(--color-divider)' : undefined }}>
                          <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                            {label}
                          </div>
                          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 19 }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 6 }}>
                      Breakpoints vs {opp.species.name}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                      {bpRows.map((r, i) => (
                        <div
                          key={i}
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, borderBottom: '1px solid var(--color-divider)', paddingBottom: 5 }}
                        >
                          <span>
                            {r.move} — {r.dmgLabel} at {r.needLabel}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: r.met ? 'var(--color-accent-700)' : r.near ? 'var(--color-neutral-700)' : 'var(--color-neutral-500)',
                            }}
                          >
                            {r.met ? 'Reached' : r.near ? 'Just short' : 'Out of reach'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16,1fr)', gap: 1, border: '1px solid var(--color-divider)', padding: 2 }}>
                      {miniCells.map((c) => (
                        <div
                          key={`${c.a}-${c.d}`}
                          style={{ aspectRatio: '1', background: c.bg, outline: c.isYou ? '2px solid var(--color-text)' : undefined, zIndex: c.isYou ? 2 : undefined }}
                        />
                      ))}
                    </div>
                    <div className="text-muted" style={{ fontSize: 10, marginTop: 5, letterSpacing: '0.06em' }}>
                      ATK×DEF at HP IV {iv.s} — your cell outlined
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button className="btn btn-primary" style={{ flex: 1, minHeight: 48, justifyContent: 'flex-start' }} onClick={() => setOverlay('collapsed')}>
                        Save to collection
                      </button>
                      <button className="btn btn-secondary" style={{ minHeight: 48 }} onClick={() => patch({ screen: 'detail' })}>
                        Full report
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </AndroidDevice>
      </div>
      <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Android: overlay on the live game</h3>
        <p style={{ fontSize: 13, margin: 0 }}>
          A 64px square bubble parks over the game and shows the one number that matters. Tap it and the sheet rises from the
          bottom edge — thumb-reachable, never covering the appraisal bars it just read.
        </p>
        <hr className="hr" style={{ margin: 0 }} />
        {OVERLAY_NOTES.map((text, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--color-accent)', minWidth: 22 }}>{'0' + (i + 1)}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
