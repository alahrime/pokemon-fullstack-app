import { GridIcon, SwordIcon } from './Icons';
import { useAppState, type AppStateShape } from '../state/AppState';

/**
 * The Battle screen's two modes, as tabs under its title: one matchup turn by turn, or the Matrix (PvPoke's
 * Battle → Single / Matrix). Drawn like the Analyze screen's view tabs, so a mode reads as a place, not a setting.
 */
const MODES: { id: AppStateShape['battleMode']; label: string; hint: string; Icon: typeof GridIcon }[] = [
  { id: 'single', label: '1v1', hint: 'One matchup, turn by turn', Icon: SwordIcon },
  { id: 'matrix', label: 'Matrix', hint: 'Many against many, and what each gains', Icon: GridIcon },
];

export function BattleModeTabs() {
  const { state, patch } = useAppState();
  return (
    <div className="viz-tabs bm-mode-tabs" role="tablist" aria-label="Battle mode">
      {MODES.map(({ id, label, hint, Icon }) => {
        const active = state.battleMode === id;
        return (
          <button key={id} type="button" role="tab" aria-selected={active}
            className={`viz-tab${active ? ' is-active' : ''}`} onClick={() => patch({ battleMode: id })}>
            <span className="viz-tab-icon"><Icon size={20} /></span>
            <span className="min-w-0">
              <span className="viz-tab-label">{label}</span>
              <span className="viz-tab-hint">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
