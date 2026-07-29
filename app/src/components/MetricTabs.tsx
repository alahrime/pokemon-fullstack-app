import { METRICS } from '../lib/metrics';
import { SegButton, SegGroup } from './Seg';
import type { ColorBy } from '../state/AppState';

/**
 * Metric selector. Sits above the matchup board rather than inside the
 * heatmap, because it governs all three of the heatmap ramp, which opponents
 * the scan surfaces, and the board's sort order — not one view of them.
 */
export function MetricTabs({ value, onChange }: { value: ColorBy; onChange: (c: ColorBy) => void }) {
  return (
    <SegGroup>
      {METRICS.map(({ id, label, hint, Icon }) => (
        <SegButton key={id} active={value === id} onClick={() => onChange(id)} title={hint}>
          <Icon />
          {label}
        </SegButton>
      ))}
    </SegGroup>
  );
}
