import { FlipIcon, GridIcon, RulerIcon, TableIcon } from './Icons';
import type { Viz } from '../state/AppState';

/**
 * The four ways of reading the 4096.
 *
 * These were a cramped segmented control sharing a row with a paragraph of
 * explanatory text. With that text gone the tabs get the full width, which is
 * room enough to say what each view actually answers — the names alone don't
 * distinguish "damage ruler" from "threshold table", and that ambiguity was
 * doing more harm than the removed paragraph was doing good.
 */
const TABS: { id: Viz; label: string; hint: string; Icon: typeof GridIcon }[] = [
  { id: 'heat', label: '4096 heatmap', hint: 'Every roll at a glance', Icon: GridIcon },
  { id: 'ruler', label: 'Damage ruler', hint: 'Where the thresholds sit', Icon: RulerIcon },
  { id: 'table', label: 'Threshold table', hint: 'Exact breakpoint values', Icon: TableIcon },
  { id: 'flip', label: 'Matchup flips', hint: 'Which rolls change the result', Icon: FlipIcon },
];

export function VizTabs({ value, onChange }: { value: Viz; onChange: (v: Viz) => void }) {
  return (
    <div className="viz-tabs" role="tablist" aria-label="Analysis view">
      {TABS.map(({ id, label, hint, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`viz-tab${active ? ' is-active' : ''}`}
            onClick={() => onChange(id)}
          >
            <span className="viz-tab-icon">
              <Icon size={20} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="viz-tab-label">{label}</span>
              <span className="viz-tab-hint">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
