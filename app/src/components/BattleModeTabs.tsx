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

/** The 1v1's pair, handed to the Matrix when the user switches to it: Pokémon 1 leads the left, Pokémon 2 the right. */
export interface CarriedMon { ref: string; fastIdx: number; chargeIds: string[]; iv: AppStateShape['ivA']; bestBuddy: boolean }
let carried: { league: string; left: CarriedMon; right: CarriedMon } | null = null;
/** Read (not consumed) by the Matrix as it mounts; it clears it once mounted, so a double render sees the same pair. */
export const peekCarried = () => carried;
export const clearCarried = () => { carried = null; };

export function BattleModeTabs() {
  const { state, patch } = useAppState();
  const pick = (id: AppStateShape['battleMode']) => {
    if (id === 'matrix' && state.battleMode === 'single') {
      carried = {
        league: state.league,
        left: { ref: state.battleA, fastIdx: state.fastA, chargeIds: state.chargeIdsA, iv: state.ivA, bestBuddy: state.bestBuddyA },
        right: { ref: state.battleB, fastIdx: state.fastB, chargeIds: state.chargeIdsB, iv: state.ivB, bestBuddy: state.bestBuddyB },
      };
    }
    patch({ battleMode: id });
  };
  return (
    <div className="viz-tabs bm-mode-tabs" role="tablist" aria-label="Battle mode">
      {MODES.map(({ id, label, hint, Icon }) => {
        const active = state.battleMode === id;
        return (
          <button key={id} type="button" role="tab" aria-selected={active}
            className={`viz-tab${active ? ' is-active' : ''}`} onClick={() => pick(id)}>
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
