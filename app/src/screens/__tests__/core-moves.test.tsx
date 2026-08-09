import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { CoresScreen } from '../CoresScreen';
import { fastMoveCounts } from '../../lib/engine';
import { SPECIES_BY_ID, movesFor } from '../../lib/data';

/**
 * How a core states its members' builds.
 *
 * The row used to run the moveset together as names — "Rollout · Body Slam /
 * Earthquake" — which says what the set is and nothing about what it costs.
 * It now uses the same chips the Show 6 and GBL cards use, and the expanded
 * detail carries the timing: how many fast moves each charged move takes.
 *
 * That count is the thing worth testing, because it is not a constant. The
 * first throw starts from empty and every one after begins with whatever
 * overflowed the last, so the sequence drifts down and cycles.
 */

describe('fast-move counts are the timing the reference shows', () => {
  it('reproduces the Lickilicky case exactly, for both of its fast moves', () => {
    // The worked example in `fastMoveCounts`, and the one in the reference
    // screenshots this display was asked to match: the same charged move is a
    // different proposition behind a different fast move.
    const sp = SPECIES_BY_ID.get('lickilicky')!;
    const lick = sp.fastMoves.find((m) => m.name === 'Lick')!;
    const rollout = sp.fastMoves.find((m) => m.name === 'Rollout')!;
    expect(lick.energyGain).toBe(3);
    expect(rollout.energyGain).toBe(13);

    const by = (name: string) => sp.chargeMoves.find((c) => c.name === name)!;
    expect(fastMoveCounts(lick, by('Body Slam'))).toEqual([12, 12, 11, 12]);
    expect(fastMoveCounts(lick, by('Shadow Ball'))).toEqual([17, 17, 16, 17]);
    expect(fastMoveCounts(lick, by('Earthquake'))).toEqual([22, 22, 21, 22]);
    expect(fastMoveCounts(lick, by('Hyper Beam'))).toEqual([27, 27, 26, 27]);

    expect(fastMoveCounts(rollout, by('Body Slam'))).toEqual([3, 3, 3, 2]);
    expect(fastMoveCounts(rollout, by('Shadow Ball'))).toEqual([4, 4, 4, 4]);
    expect(fastMoveCounts(rollout, by('Earthquake'))).toEqual([5, 5, 5, 5]);
    expect(fastMoveCounts(rollout, by('Hyper Beam'))).toEqual([7, 6, 6, 6]);
  });
});

describe('the cores screen states a build the way the team screens do', () => {
  it('shows each member’s moves as chips, not as a run-on line of names', () => {
    const { container } = renderApp(<CoresScreen />);
    const row = container.querySelector('.core-row');
    expect(row).toBeTruthy();
    // The same classes the Show 6 and GBL cards use, so the two cannot drift.
    const chips = row!.querySelectorAll('.pc-moves .pc-move');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    expect(row!.querySelectorAll('.pc-move-fast')).toHaveLength(2);
    // And each chip carries its ratio, which the plain names never did.
    expect(row!.querySelectorAll('.pc-move-eco').length).toBe(chips.length);
  });

  it('gives the timing for both members when a row is opened', () => {
    const { container } = renderApp(<CoresScreen />);
    expect(container.querySelector('.core-timing')).toBeNull();
    fireEvent.click(container.querySelector('.core-row')!);
    const cards = container.querySelectorAll('.core-timing');
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.querySelector('.core-timing-who')!.textContent!.trim().length).toBeGreaterThan(0);
      expect(c.querySelectorAll('.core-timing-row').length).toBeGreaterThan(0);
    }
  });

  it('counts in each member’s own rated fast move', () => {
    // A core is a claim about two builds, so the two sides are denominated
    // separately — reading one member's count against the other's fast move
    // would be a different Pokemon's number.
    const { container } = renderApp(<CoresScreen />);
    fireEvent.click(container.querySelector('.core-row')!);
    const card = container.querySelector('.core-timing')!;
    const who = card.querySelector('.core-timing-who')!.textContent!.trim();
    const sp = [...SPECIES_BY_ID.values()].find((s) => who.startsWith(s.name));
    expect(sp, `no species for "${who}"`).toBeTruthy();
    const rated = movesFor(sp!, 'great');
    expect(card.querySelector('.core-timing-fast')!.textContent).toContain(rated.fast.name);

    const first = card.querySelector('.core-timing-row')!;
    const move = first.querySelector('.core-timing-move')!.textContent!.trim();
    const charge = sp!.chargeMoves.find((c) => c.name === move)!;
    const shown = (first.querySelector('.move-counts-run')!.textContent ?? '')
      .split('-').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
    expect(shown).toEqual(fastMoveCounts(rated.fast, charge));
  });

  it('closes again, so the detail is opt-in', () => {
    const { container } = renderApp(<CoresScreen />);
    const row = container.querySelector('.core-row')!;
    fireEvent.click(row);
    expect(container.querySelectorAll('.core-timing')).toHaveLength(2);
    fireEvent.click(row);
    expect(container.querySelectorAll('.core-timing')).toHaveLength(0);
  });
});
