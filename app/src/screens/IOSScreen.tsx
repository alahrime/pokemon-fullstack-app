import { useState } from 'react';
import { useAppState } from '../state/AppState';
import { SPECIES_BY_ID, OPPONENTS } from '../lib/data';
import { getEntry, verdictLine } from '../lib/engine';
import { IOSDevice } from '../components/frames/IOSDevice';
import { Sprite } from '../components/Sprite';
import { SegButton, SegGroup } from '../components/Seg';

type IOSFlow = 'share' | 'library' | 'auto';
const IOS_FLOWS: [IOSFlow, string][] = [
  ['share', 'Share sheet'],
  ['library', 'Batch import'],
  ['auto', 'Auto-detect'],
];

const IOS_NOTES = [
  { title: 'Share sheet — fastest', text: 'Screenshot, share, done. One extra tap over Android and no permissions, but it interrupts the catch streak.' },
  { title: 'Batch import — least interruption', text: 'Play a session, screenshot everything, rank the pile later. Best for raid days and community days.' },
  {
    title: 'Auto-detect — closest to the overlay',
    text: 'Photos access plus a background task: the verdict arrives as a notification seconds after the screenshot. Highest trust cost.',
  },
];

export function IOSScreen() {
  const { state, patch, beginner } = useAppState();
  const [flow, setFlow] = useState<IOSFlow>('share');
  const { league, species: speciesId, iv } = state;
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry } = getEntry(speciesId, iv, league);
  const dark = flow !== 'library';
  const bg = flow === 'library' ? 'var(--color-bg)' : '#12100f';

  const miniStats = [
    ['Attack', entry.atk.toFixed(1)],
    ['Defense', entry.def.toFixed(1)],
    ['HP', String(entry.hp)],
  ];

  const otherSpeciesIds = OPPONENTS[league].filter((id) => id !== speciesId);
  const shots = [
    { kind: 'CATCH', label: `${species.name} · CP ${entry.cp}`, ok: true, dex: species.dex },
    { kind: 'CATCH', label: `${SPECIES_BY_ID.get(otherSpeciesIds[0])?.name ?? 'Azumarill'} · CP 1487`, ok: true, dex: SPECIES_BY_ID.get(otherSpeciesIds[0])?.dex ?? 184 },
    { kind: 'CATCH', label: `${SPECIES_BY_ID.get(otherSpeciesIds[1])?.name ?? 'Registeel'} · CP 1495`, ok: false, dex: SPECIES_BY_ID.get(otherSpeciesIds[1])?.dex ?? 379 },
    { kind: 'MAP', label: 'Not a catch screen', ok: null as boolean | null, dex: 0 },
  ];

  const autoQueue = [
    { name: `${species.name} ${iv.a}/${iv.d}/${iv.s}`, rank: `#${entry.rank}`, dex: species.dex },
    { name: `${SPECIES_BY_ID.get(otherSpeciesIds[0])?.name ?? 'Azumarill'} 0/14/15`, rank: '#7', dex: SPECIES_BY_ID.get(otherSpeciesIds[0])?.dex ?? 184 },
    { name: `${SPECIES_BY_ID.get(otherSpeciesIds[1])?.name ?? 'Registeel'} 4/13/12`, rank: '#1204', dex: SPECIES_BY_ID.get(otherSpeciesIds[1])?.dex ?? 379 },
  ];

  return (
    <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div>
        <div style={{ marginBottom: 14 }}>
          <SegGroup>
            {IOS_FLOWS.map(([id, label]) => (
              <SegButton key={id} active={flow === id} onClick={() => setFlow(id)}>
                {label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <IOSDevice dark={dark}>
          <div style={{ position: 'relative', height: '100%', background: bg, overflow: 'hidden' }}>
            {flow === 'share' && (
              <>
                <div style={{ position: 'absolute', inset: 0, background: '#1b2420' }}>
                  <div
                    style={{
                      position: 'absolute',
                      top: 40,
                      left: 0,
                      right: 0,
                      textAlign: 'center',
                      color: 'rgba(255,255,255,0.25)',
                      fontSize: 11,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Screenshot preview
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: 80,
                      left: 60,
                      right: 60,
                      bottom: 330,
                      border: '2px solid rgba(255,255,255,0.14)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'rgba(255,255,255,0.2)',
                      fontSize: 11,
                      letterSpacing: '0.1em',
                    }}
                  >
                    CATCH SCREEN
                  </div>
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--color-bg)', borderTop: '4px solid var(--color-accent)', padding: '16px 18px 24px' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 10 }}>
                    Share sheet · Paragon extension
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Sprite dex={species.dex} size={56} />
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 44, lineHeight: 1, letterSpacing: '-0.04em' }}>
                        #{entry.rank}
                      </span>
                      <span className="text-muted" style={{ fontSize: 13 }}>
                        / 4096 · {species.name} {iv.a}/{iv.d}/{iv.s}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, margin: '4px 0 12px' }}>{verdictLine(entry.rank, beginner)}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '1px solid var(--color-divider)', marginBottom: 14 }}>
                    {miniStats.map(([label, value], i) => (
                      <div key={label} style={{ padding: '8px 10px', borderRight: i < 2 ? '1px solid var(--color-divider)' : undefined }}>
                        <div className="text-muted" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                          {label}
                        </div>
                        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 19 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1, minHeight: 48, justifyContent: 'flex-start' }}>
                      Save
                    </button>
                    <button className="btn btn-secondary" style={{ minHeight: 48 }} onClick={() => patch({ screen: 'detail' })}>
                      Open app
                    </button>
                  </div>
                </div>
              </>
            )}

            {flow === 'library' && (
              <div style={{ padding: '56px 18px 0' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Import</div>
                <h3 style={{ margin: '2px 0 12px' }}>Recent screenshots</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {shots.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setFlow('share')}
                      style={{
                        position: 'relative',
                        aspectRatio: '0.62',
                        background: '#1b2420',
                        border: `2px solid ${s.ok === true ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.22)', fontSize: 10, letterSpacing: '0.1em' }}>
                        {s.kind}
                      </span>
                      {s.dex > 0 && <Sprite dex={s.dex} size={64} style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)' }} />}
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          bottom: 0,
                          right: 0,
                          background: 'var(--color-text)',
                          color: 'var(--color-bg)',
                          fontSize: 10,
                          padding: '4px 6px',
                          textAlign: 'left',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {s.label}
                      </span>
                      {s.ok !== true && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            background: s.ok === false ? 'var(--color-accent)' : 'var(--color-neutral-600)',
                            color: 'var(--color-bg)',
                            fontSize: 9,
                            padding: '2px 5px',
                            letterSpacing: '0.06em',
                          }}
                        >
                          {s.ok === false ? 'CHECK' : 'SKIP'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary btn-block" style={{ minHeight: 48, marginTop: 16 }} onClick={() => setFlow('share')}>
                  Rank 2 selected →
                </button>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
                  Batch import reads every screenshot in one pass. Anything the parser is unsure of gets a red corner and lands in
                  a confirm queue.
                </p>
              </div>
            )}

            {flow === 'auto' && (
              <>
                <div style={{ position: 'absolute', inset: 0, background: '#1b2420' }}>
                  <div
                    style={{
                      position: 'absolute',
                      top: 150,
                      left: 0,
                      right: 0,
                      textAlign: 'center',
                      color: 'rgba(255,255,255,0.16)',
                      fontSize: 13,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Lock screen
                  </div>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 56,
                    left: 14,
                    right: 14,
                    background: 'var(--color-bg)',
                    borderLeft: '4px solid var(--color-accent)',
                    boxShadow: 'var(--shadow-lg)',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
                    <span>Paragon</span>
                    <span className="text-muted">now</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, lineHeight: 1 }}>#{entry.rank}</span>
                    <span style={{ fontSize: 13 }}>
                      {species.name} {iv.a}/{iv.d}/{iv.s}
                    </span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {verdictLine(entry.rank, beginner)}
                  </div>
                </div>
                <div style={{ position: 'absolute', top: 210, left: 14, right: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {autoQueue.map((q, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <Sprite dex={q.dex} size={28} />
                      <span style={{ flex: 1 }}>{q.name}</span>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--color-accent)' }}>{q.rank}</span>
                    </div>
                  ))}
                </div>
                <div style={{ position: 'absolute', left: 14, right: 14, bottom: 26 }}>
                  <p style={{ fontSize: 12, background: 'var(--color-bg)', padding: '10px 12px', margin: 0 }}>
                    Photos permission lets Paragon watch for new screenshots and rank them silently. No overlay, no app switch —
                    the answer arrives as a notification.
                  </p>
                </div>
              </>
            )}
          </div>
        </IOSDevice>
      </div>
      <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0 }}>iOS: three ways in</h3>
        <p style={{ fontSize: 13, margin: 0 }}>
          iOS forbids drawing over another app, so the screenshot is the input. Each flow trades speed for friction differently —
          pick one as primary and ship the other two as settings.
        </p>
        <hr className="hr" style={{ margin: 0 }} />
        {IOS_NOTES.map((n) => (
          <div key={n.title} style={{ borderLeft: '2px solid var(--color-divider)', paddingLeft: 12 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14 }}>{n.title}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {n.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
