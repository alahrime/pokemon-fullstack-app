import type { IV } from '../lib/types';

const ROWS: [keyof IV, string][] = [
  ['a', 'Attack'],
  ['d', 'Defense'],
  ['s', 'HP'],
];

export function IVAdjuster({ iv, onBump, size = 34 }: { iv: IV; onBump: (key: keyof IV, delta: number) => void; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ROWS.map(([k, label]) => {
        const value = iv[k];
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="text-muted" style={{ width: 66, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {label}
            </span>
            <button className="btn btn-secondary" style={{ width: size, height: size, padding: 0, justifyContent: 'center' }} onClick={() => onBump(k, -1)}>
              –
            </button>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, width: 26, textAlign: 'center' }}>{value}</span>
            <button className="btn btn-secondary" style={{ width: size, height: size, padding: 0, justifyContent: 'center' }} onClick={() => onBump(k, 1)}>
              +
            </button>
            <div style={{ flex: 1, height: 6, background: 'var(--color-neutral-300)' }}>
              <div style={{ height: 6, background: 'var(--color-accent)', width: `${(value / 15) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
