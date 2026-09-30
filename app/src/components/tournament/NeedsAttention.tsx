import { useState } from 'react';
import { isCounted, settlePairing, type Pairing } from '../../lib/tournaments';
import type { Run } from './hostRun';
import { playerName } from './playerName';

interface Props { pairings: readonly Pairing[]; names: ReadonlyMap<string, string>; me: string | null; now: Date; busy: boolean; run: Run }

const SCORES = [[2, 0], [2, 1], [1, 2], [0, 2]] as const;

function status(p: Pairing, who: (id: string) => string): string {
  const by = p.reportedBy ? ` by ${who(p.reportedBy)}` : '';
  const sc = p.scoreA !== null && p.scoreB !== null ? ` ${p.scoreA}–${p.scoreB}` : '';
  if (p.state === 'disputed') return `Disputed — reported${sc}${by}`;
  if (p.state === 'reported') return `Reported${sc}${by}, not yet final`;
  return 'No report';
}

/** Current-round games that still do not count, for the host to settle. Shown by the panel once the round's time is up. */
export function NeedsAttention({ pairings, names, me, now, busy, run }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const list = pairings.filter((p) => p.playerB !== null && !isCounted(p, now))
    .sort((a, b) => Number(b.state === 'disputed') - Number(a.state === 'disputed') || a.tableNo - b.tableNo);
  const who = (id: string) => playerName(names, id);
  const settle = async (p: Pairing, a: number, b: number) => {
    if (a === 0 && b === 0 && !window.confirm(`Record a double loss at table ${p.tableNo}? Neither player gets the win.`)) return;
    await run(() => settlePairing(p.id, a, b, (notes[p.id] ?? '').trim() || null));
  };
  return (
    <section className="host-section" aria-label="Needs attention">
      <div className="hud-label">Needs attention</div>
      <ul className="host-list">
        {list.map((p) => {
          const A = who(p.playerA); const B = who(p.playerB!);
          const value = pick[p.id] ?? '2,1';
          return (
            <li key={p.id}>
              <strong>Table {p.tableNo}: {A} vs {B}</strong>
              <span className="text-muted">{status(p, who)}</span>
              {p.playerA === me || p.playerB === me ? (
                <span className="text-muted">You are playing this game, so another host has to settle it.</span>
              ) : (
                <div className="host-actions">
                  <div className="field">
                    <label htmlFor={`host-note-${p.id}`}>Note for table {p.tableNo}</label>
                    <input id={`host-note-${p.id}`} className="input" value={notes[p.id] ?? ''} maxLength={200} placeholder="Optional"
                      onChange={(e) => setNotes((s) => ({ ...s, [p.id]: e.target.value }))} />
                  </div>
                  <button type="button" className="btn" disabled={busy} onClick={() => void settle(p, 2, 0)}>Award {A} the win</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void settle(p, 0, 2)}>Award {B} the win</button>
                  <button type="button" className="btn" disabled={busy} aria-label={`Double loss, table ${p.tableNo}`} onClick={() => void settle(p, 0, 0)}>Double loss</button>
                  <select className="input" aria-label={`Exact result for table ${p.tableNo}`} value={value} disabled={busy}
                    onChange={(e) => setPick((s) => ({ ...s, [p.id]: e.target.value }))}>
                    {SCORES.map(([a, b]) => <option key={`${a},${b}`} value={`${a},${b}`}>{A} {a}–{b} {B}</option>)}
                  </select>
                  <button type="button" className="btn" disabled={busy} aria-label={`Set result for table ${p.tableNo}`}
                    onClick={() => { const [a, b] = value.split(',').map(Number); void settle(p, a, b); }}>Set result</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
