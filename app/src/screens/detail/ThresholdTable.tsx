import type { ThresholdRow } from '../../lib/engine';

export function ThresholdTable({ rows }: { rows: ThresholdRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Threshold</th>
            <th>Move</th>
            <th>Needs attack ≥</th>
            <th>Min IV spread</th>
            <th>Damage / turn</th>
            <th>Your roll</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={r.met ? { background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' } : undefined}
            >
              <td>
                <span className={r.kind === 'Bulkpoint' ? 'tag tag-neutral' : 'tag tag-accent'}>{r.kind}</span>
              </td>
              <td>{r.move}</td>
              <td className="font-(family-name:--font-head) font-extrabold">{r.needLabel}</td>
              <td className="text-muted">{r.spread}</td>
              <td>{r.dmgLabel}</td>
              <td
                style={{
                  fontSize: 12,
                  color: r.met ? 'var(--color-accent-700)' : r.near ? 'var(--color-neutral-700)' : 'var(--color-neutral-500)',
                  fontWeight: r.met ? 600 : undefined,
                }}
              >
                {r.met ? 'Reached' : r.near ? 'Just short' : 'Out of reach'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
