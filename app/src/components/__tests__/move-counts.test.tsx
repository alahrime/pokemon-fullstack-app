import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { MoveCounts } from '../MoveCounts';
import { PokemonCard } from '../PokemonCard';
import { RankingsScreen } from '../../screens/RankingsScreen';
import { CoresScreen } from '../../screens/CoresScreen';
import { TeamBuilderScreen } from '../../screens/TeamBuilderScreen';
import { BattleScreen } from '../../screens/BattleScreen';
import { fastMoveCounts } from '../../lib/engine';
import { SPECIES_BY_ID, movesFor } from '../../lib/data';

/**
 * One presentation of the count sequence, everywhere.
 *
 * There were four: boxed cells on the team cards, different cells in the moves
 * panel, a third style in the cores detail, and nothing at all in the
 * rankings. The same fact should not change shape depending on which screen it
 * is read from, so every one of them renders `MoveCounts` now.
 *
 * The format is a dashed run — `5 - 5 - 5 - 5` — rather than separate cells,
 * because the sequence is a single reading. Florges throwing Fairy Wind takes
 * five of them to reach Chilling Water, every time.
 */

const runsIn = (c: HTMLElement) => [...c.querySelectorAll('.move-counts-run')];
const digits = (el: Element) =>
  (el.textContent ?? '').split('-').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));

describe('the sequence itself', () => {
  it('is the Florges case, written as a run', () => {
    const sp = SPECIES_BY_ID.get('florges')!;
    const fairyWind = sp.fastMoves.find((m) => m.name === 'Fairy Wind')!;
    const chilling = sp.chargeMoves.find((c) => c.name === 'Chilling Water')!;
    // 9 energy a throw into a 45-energy move divides exactly, so it never drifts.
    expect(fastMoveCounts(fairyWind, chilling)).toEqual([5, 5, 5, 5]);

    const { container } = renderApp(<MoveCounts fast={fairyWind} charge={chilling} />);
    const run = container.querySelector('.move-counts-run')!;
    expect(digits(run)).toEqual([5, 5, 5, 5]);
    // Three separators for four numbers — a run, not four boxes.
    expect(run.querySelectorAll('.move-counts-sep')).toHaveLength(3);
  });

  it('still shows the drift where there is drift', () => {
    const sp = SPECIES_BY_ID.get('florges')!;
    const fairyWind = sp.fastMoves.find((m) => m.name === 'Fairy Wind')!;
    const moonblast = sp.chargeMoves.find((c) => c.name === 'Moonblast')!;
    const { container } = renderApp(<MoveCounts fast={fairyWind} charge={moonblast} />);
    expect(digits(container.querySelector('.move-counts-run')!)).toEqual([7, 7, 6, 7]);
  });

  it('says so rather than showing nothing when a move cannot be charged', () => {
    const sp = SPECIES_BY_ID.get('florges')!;
    const zero = { ...sp.fastMoves[0], energyGain: 0 };
    const { container } = renderApp(<MoveCounts fast={zero} charge={sp.chargeMoves[0]} />);
    const run = container.querySelector('.move-counts-run')!;
    expect(run.classList.contains('is-empty')).toBe(true);
    expect(run.getAttribute('title')).toMatch(/no energy/i);
  });
});

describe('every screen that lists a moveset uses it', () => {
  it('the team cards do', () => {
    const { container } = renderApp(<PokemonCard refId="florges" league="great" size="full" />);
    const rated = movesFor(SPECIES_BY_ID.get('florges')!, 'great');
    expect(runsIn(container)).toHaveLength(rated.charges.length);
  });

  it('the rankings do', () => {
    const { container } = renderApp(<RankingsScreen />);
    expect(runsIn(container).length).toBeGreaterThan(0);
    // And in the card language, not a bespoke pill.
    expect(container.querySelector('.rank-moves.pc-moves')).toBeTruthy();
    expect(container.querySelector('.rank-move')).toBeNull();
  });

  it('the team builders do — on the discovered lists, which is what they show', () => {
    // These render `compact` cards. Gating the counts to `full` put them on the
    // team slots, which are empty until you pick something, and left them off
    // the lists that are on screen from the moment the page loads.
    for (const size of [3, 6] as const) {
      const { container } = renderApp(<TeamBuilderScreen size={size} />);
      const member = container.querySelector('.bt-members .pc');
      expect(member, `size ${size}: no discovered member card`).toBeTruthy();
      expect(runsIn(member as HTMLElement).length, `size ${size}`).toBeGreaterThan(0);
    }
  });

  it('the cores rows do, without needing to be opened', () => {
    const { container } = renderApp(<CoresScreen />);
    const side = container.querySelector('.core-side')!;
    expect(runsIn(side as HTMLElement).length).toBeGreaterThan(0);
  });

  it('the battle screen does', () => {
    const { container } = renderApp(<BattleScreen />);
    expect(runsIn(container).length).toBeGreaterThan(0);
  });

  it('the cores screen does, once a row is opened', () => {
    const { container } = renderApp(<CoresScreen />);
    fireEvent.click(container.querySelector('.core-row')!);
    expect(runsIn(container).length).toBeGreaterThan(0);
  });

  it('leaves no earlier presentation behind', () => {
    // The four that existed before, by the class each used.
    const { container: card } = renderApp(<PokemonCard refId="florges" league="great" size="full" />);
    const { container: cores } = renderApp(<CoresScreen />);
    fireEvent.click(cores.querySelector('.core-row')!);
    for (const [c, name] of [[card, 'card'], [cores, 'cores']] as const) {
      expect(c.querySelectorAll('.pc-move-count'), name).toHaveLength(0);
      expect(c.querySelectorAll('.core-timing-n'), name).toHaveLength(0);
      expect(c.querySelectorAll('.move-count'), name).toHaveLength(0);
    }
  });
});
