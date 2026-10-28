import { SegButton, SegGroup } from './Seg';
import { useAppState } from '../state/AppState';

/** Single head-to-head or Matrix, the Battle screen's two modes (PvPoke's Battle → Single / Matrix). */
export function BattleModeSwitch() {
  const { state, patch } = useAppState();
  return (
    <div role="group" aria-label="Battle mode">
      <SegGroup>
        <SegButton active={state.battleMode === 'single'} onClick={() => patch({ battleMode: 'single' })}
          title="One Pokémon against another, turn by turn">Single</SegButton>
        <SegButton active={state.battleMode === 'matrix'} onClick={() => patch({ battleMode: 'matrix' })}
          title="Every Pokémon on one side against every one on the other">Matrix</SegButton>
      </SegGroup>
    </div>
  );
}
