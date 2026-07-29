import { ShieldIcon, SwordIcon, TrophyIcon } from '../components/Icons';
import type { ColorBy } from '../state/AppState';

/**
 * The metric everything on the report is read against.
 *
 * It decides the heatmap ramp, which opponents the relevance scan surfaces,
 * and how the matchup board is sorted — so it lives in one place rather than
 * being redeclared per view.
 *
 * Kept out of MetricTabs.tsx so that file only exports components, which is
 * what React Fast Refresh needs.
 */
export const METRICS: {
  id: ColorBy;
  label: string;
  hint: string;
  /** How the sort control describes this ordering. */
  sortLabel: string;
  Icon: typeof TrophyIcon;
}[] = [
  { id: 'rank', label: 'Rank', hint: 'Stat product standing within the 4096', sortLabel: 'league rank', Icon: TrophyIcon },
  { id: 'break', label: 'Breakpoints', hint: 'Damage you deal', sortLabel: 'damage dealt', Icon: SwordIcon },
  { id: 'bulk', label: 'Bulkpoints', hint: 'Damage you take', sortLabel: 'damage taken', Icon: ShieldIcon },
];

export function metricSortLabel(id: ColorBy): string {
  return METRICS.find((m) => m.id === id)?.sortLabel ?? 'rank';
}
