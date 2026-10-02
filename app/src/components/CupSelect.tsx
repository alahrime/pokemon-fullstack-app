import { LeagueSelect, type LeagueOption } from './LeagueSelect';
import { LIMITED_CUPS } from '../lib/presetFormats';
import { leaguePatch, useAppState } from '../state/AppState';

const CUP_OPTIONS: LeagueOption[] = LIMITED_CUPS.map((p) => ({
  value: p.key, label: p.name, league: p.base, types: p.cup.include?.types, palette: p.palette,
  note: p.base === 'master' ? 'No cap' : `${p.base === 'great' ? 1500 : 2500} CP`,
}));

/**
 * The limited-cup picker, for the screens that rank or list a cup's Pokémon (Rankings). A cup is played under its
 * league's cap, so choosing one moves the league with it; the league tabs clear it again.
 */
export function CupSelect() {
  const { state, patch } = useAppState();
  return (
    <div className="cup-select">
      <LeagueSelect
        id="cup-select"
        label="Limited cup"
        value={state.cup ?? ''}
        options={[{ value: '', label: 'No cup', league: state.league, note: 'Standard rules' }, ...CUP_OPTIONS]}
        onChange={(k) => {
          const c = LIMITED_CUPS.find((p) => p.key === k);
          patch(leaguePatch(c ? c.base : state.league, c?.key ?? null));
        }}
      />
    </div>
  );
}
