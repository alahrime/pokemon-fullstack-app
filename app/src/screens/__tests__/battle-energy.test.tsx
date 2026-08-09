import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { BattleScreen, EnergyControl } from '../BattleScreen';
import { ENERGY_CAP } from '../../lib/engine';
import { SPECIES_BY_ID } from '../../lib/data';

/**
 * Starting energy, stepped in fast moves.
 *
 * The slider works in tens of a percent, which is not a unit anyone plays in —
 * energy arrives one fast move at a time. The steppers move by exactly one
 * throw of the move that side is carrying, and the interesting cases are the
 * edges: snapping off-grid slider values onto the grid, and the ceiling, which
 * is the last whole throw that fits under the cap rather than the cap itself.
 */

/** One side's controls. `within` was wrong here — it returns queries, not a node. */
const side = (container: HTMLElement, n: 0 | 1) =>
  [...container.querySelectorAll('.bt-side')][n] as HTMLElement;

const energyOf = (container: HTMLElement, n: 0 | 1) =>
  Number((side(container, n).querySelector('.bt-range') as HTMLInputElement).value);

const press = (container: HTMLElement, n: 0 | 1, dir: '+' | '−') => {
  const btns = [...side(container, n).querySelectorAll('.bt-energy-step')] as HTMLButtonElement[];
  fireEvent.click(dir === '+' ? btns[1] : btns[0]);
};

describe('the battle screen steps energy in fast moves', () => {
  it('offers a stepper either side of the slider', () => {
    const { container } = renderApp(<BattleScreen />);
    expect(container.querySelectorAll('.bt-side .bt-energy').length).toBe(2);
    expect(side(container, 0).querySelectorAll('.bt-energy-step')).toHaveLength(2);
  });

  it('starts at zero, with nothing to take away', () => {
    const { container } = renderApp(<BattleScreen />);
    expect(energyOf(container, 0)).toBe(0);
    const minus = side(container, 0).querySelector('.bt-energy-step') as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
  });

  it('adds exactly one throw of the move that side is carrying', () => {
    const { container } = renderApp(<BattleScreen />);
    // The gain is read off the rendered control rather than assumed, since the
    // opening matchup is a seeded random draw.
    const gainText = side(container, 0).querySelector('.bt-energy-gain')!.textContent!;
    const gain = Number(gainText.match(/\d+/)![0]);
    expect(gain).toBeGreaterThan(0);
    press(container, 0, '+');
    expect(energyOf(container, 0)).toBe(gain);
    press(container, 0, '+');
    expect(energyOf(container, 0)).toBe(gain * 2);
    press(container, 0, '−');
    expect(energyOf(container, 0)).toBe(gain);
  });

  it('snaps an off-grid slider value onto a whole throw', () => {
    // A drag leaves 30; one press should land on a real number of throws, not
    // on 30 plus a gain.
    const { container } = renderApp(<BattleScreen />);
    const range = side(container, 0).querySelector('.bt-range') as HTMLInputElement;
    const gain = Number(side(container, 0).querySelector('.bt-energy-gain')!.textContent!.match(/\d+/)![0]);
    fireEvent.change(range, { target: { value: '30' } });
    expect(energyOf(container, 0)).toBe(30);
    press(container, 0, '+');
    const after = energyOf(container, 0);
    expect(after % gain).toBe(0);
    expect(after).toBeGreaterThan(30);
    expect(after).toBeLessThan(30 + gain);
  });

  it('stops at the last whole throw that fits under the cap', () => {
    const { container } = renderApp(<BattleScreen />);
    const gain = Number(side(container, 0).querySelector('.bt-energy-gain')!.textContent!.match(/\d+/)![0]);
    const maxMoves = Math.floor(ENERGY_CAP / gain);
    for (let i = 0; i < maxMoves + 4; i++) press(container, 0, '+');
    expect(energyOf(container, 0)).toBe(maxMoves * gain);
    expect(energyOf(container, 0)).toBeLessThanOrEqual(ENERGY_CAP);
    const plus = [...side(container, 0).querySelectorAll('.bt-energy-step')][1] as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
  });

  it('never drops below empty however hard the button is pressed', () => {
    const { container } = renderApp(<BattleScreen />);
    press(container, 0, '+');
    for (let i = 0; i < 6; i++) press(container, 0, '−');
    expect(energyOf(container, 0)).toBe(0);
  });

  it('keeps the two sides independent', () => {
    const { container } = renderApp(<BattleScreen />);
    press(container, 0, '+');
    expect(energyOf(container, 0)).toBeGreaterThan(0);
    expect(energyOf(container, 1)).toBe(0);
  });

  it('counts in the move actually selected, not the first in the pool', () => {
    // Every fast move in the game gains energy, so the count is always
    // meaningful — assert that rather than leaving the zero-gain branch
    // unexamined.
    const gains = [...SPECIES_BY_ID.values()].flatMap((sp) => sp.fastMoves.map((m) => m.energyGain));
    expect(gains.length).toBeGreaterThan(100);
    expect(Math.min(...gains)).toBeGreaterThan(0);
  });

  it('names the throw it steps by, for a pointer and a screen reader alike', () => {
    const { container } = renderApp(<BattleScreen />);
    const plus = [...side(container, 0).querySelectorAll('.bt-energy-step')][1] as HTMLButtonElement;
    const move = side(container, 0).querySelector('.bt-energy-move')!.textContent!.trim();
    expect(plus.getAttribute('aria-label')!.toLowerCase()).toContain(move.toLowerCase());
    expect(plus.getAttribute('title')).toMatch(/energy/i);
  });

  it('names the throw it steps by, and follows the move that is selected', () => {
    // Driven directly rather than through the picker: the fast grid shows only
    // a subset of a movepool and the rest sit behind an overlay, so a UI-driven
    // version of this test was pinned to whichever species the seeded draw gave
    // — and the first attempt silently asserted nothing, because `.move-tile`
    // is also the charged tile and every charged tile carries the text
    // "<fast> to charge", so filtering tiles by name matched all of them.
    const registeel = SPECIES_BY_ID.get('registeel')!;
    expect(registeel.fastMoves.length, 'need two moves to tell them apart').toBeGreaterThan(1);
    const [one, two] = registeel.fastMoves;
    expect(one.energyGain).not.toBe(two.energyGain);

    const read = (move: typeof one) => {
      const { container } = renderApp(<EnergyControl energy={0} onEnergy={() => {}} fast={move} />);
      return {
        move: container.querySelector('.bt-energy-move')!.textContent!.trim(),
        gain: container.querySelector('.bt-energy-gain')!.textContent!.trim(),
      };
    };
    const a = read(one);
    const b = read(two);
    expect(a.move).toBe(one.name);
    expect(b.move).toBe(two.name);
    expect(a.gain).not.toBe(b.gain);
  });

  it('reports the count in throws, fractional only when the slider left it so', () => {
    const move = SPECIES_BY_ID.get('registeel')!.fastMoves[0];
    const whole = renderApp(
      <EnergyControl energy={move.energyGain * 3} onEnergy={() => {}} fast={move} />,
    ).container;
    expect(whole.querySelector('.bt-energy-count')!.textContent).toBe('3');
    const part = renderApp(
      <EnergyControl energy={move.energyGain * 3 + 1} onEnergy={() => {}} fast={move} />,
    ).container;
    expect(part.querySelector('.bt-energy-count')!.textContent).toMatch(/^3\.\d$/);
  });

  it('steps to whole throws from wherever the slider left it', () => {
    const move = SPECIES_BY_ID.get('registeel')!.fastMoves[0];
    const g = move.energyGain;
    const at = (energy: number) => {
      const seen: number[] = [];
      const { container } = renderApp(
        <EnergyControl energy={energy} onEnergy={(n) => seen.push(n)} fast={move} />,
      );
      const [minus, plus] = [...container.querySelectorAll('.bt-energy-step')] as HTMLButtonElement[];
      fireEvent.click(plus);
      fireEvent.click(minus);
      return seen;
    };
    // On grid: one throw either way.
    expect(at(g * 3)).toEqual([g * 4, g * 2]);
    // Off grid: snaps to the neighbouring whole throw in each direction.
    const off = at(g * 3 + 1);
    expect(off[0]).toBe(g * 4);
    expect(off[1]).toBe(g * 3);
  });

});

describe('the energy control degrades safely', () => {
  it('renders without throwing for every species in the pool', () => {
    // Guards the clamp on fastIdx: a species with fewer moves than the stored
    // index must not read past the end of its movepool.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderApp(<BattleScreen />);
    expect(container.querySelectorAll('.bt-energy').length).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
