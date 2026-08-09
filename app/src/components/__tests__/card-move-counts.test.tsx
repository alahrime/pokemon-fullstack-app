import { describe, it, expect } from 'vitest';
import { renderApp } from '../../test/render';
import { PokemonCard } from '../PokemonCard';
import { fastMoveCounts } from '../../lib/engine';
import { SPECIES_BY_ID, movesFor } from '../../lib/data';

/**
 * Charged moves on a full card carry how long they take.
 *
 * The card said what a Pokemon throws and what each throw is worth, and left
 * out how often it lands — which is the number that decides whether a 2.00 dpe
 * nuke is better than a 1.50 dpe spam move. It is not a constant either: the
 * first throw starts from empty and every one after begins with whatever
 * overflowed the last, so the sequence drifts down and cycles.
 *
 * The counts must agree with `fastMoveCounts` against the *rated* fast move,
 * because that is the set the card is standing for. Reading them against a
 * different fast move would be another Pokemon's number.
 */

/** The sequence a chip shows, read back off the rendered run. */
const seqOf = (chip: Element): number[] => {
  const run = chip.querySelector('.move-counts-run');
  if (!run) return [];
  return (run.textContent ?? '').split('-').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
};

const countsOn = (container: HTMLElement) =>
  [...container.querySelectorAll('.pc-move')].map((chip) => ({
    name: chip.querySelector('.pc-move-name')?.textContent ?? '',
    counts: seqOf(chip),
  }));

describe('a full card states how long each charged move takes', () => {
  it('matches fastMoveCounts for the rated set, move by move', () => {
    const sp = SPECIES_BY_ID.get('registeel')!;
    const rated = movesFor(sp, 'great');
    const { container } = renderApp(<PokemonCard refId="registeel" league="great" size="full" />);
    const rows = countsOn(container);

    for (const charge of rated.charges) {
      const row = rows.find((r) => r.name === charge.name);
      expect(row, `${charge.name} missing from the card`).toBeTruthy();
      expect(row!.counts).toEqual(fastMoveCounts(rated.fast, charge));
      expect(row!.counts.length).toBeGreaterThan(0);
    }
  });

  it('leaves the fast move as the denominator rather than counting it', () => {
    const { container } = renderApp(<PokemonCard refId="registeel" league="great" size="full" />);
    const fast = container.querySelector('.pc-move-fast')!;
    expect(fast.querySelectorAll('.move-counts-run')).toHaveLength(0);
    // And says so, since a bare sequence is meaningless without the unit.
    expect(fast.querySelector('.pc-move-denom')).toBeTruthy();
  });

  it('reflects the build a slot is carrying, not the rated one', () => {
    // A team slot can field a set the league does not rate, and the counts have
    // to follow it — the same charged move behind a different fast move is a
    // different wait.
    const sp = SPECIES_BY_ID.get('registeel')!;
    const rated = movesFor(sp, 'great');
    const other = sp.fastMoves.find((m) => m.energyGain !== rated.fast.energyGain);
    expect(other, 'need two fast moves of different gain').toBeTruthy();

    const { container } = renderApp(
      <PokemonCard
        refId="registeel"
        league="great"
        size="full"
        build={{ fast: other!, charges: rated.charges }}
      />,
    );
    const row = countsOn(container).find((r) => r.name === rated.charges[0].name)!;
    expect(row.counts).toEqual(fastMoveCounts(other!, rated.charges[0]));
    expect(row.counts).not.toEqual(fastMoveCounts(rated.fast, rated.charges[0]));
  });

  it('shows them wherever moves are shown at all', () => {
    // Compact is what the discovered-teams lists on both team screens render,
    // so gating the counts to `full` left them off the very lists they are
    // wanted on. The chip wraps the run onto its own line when a column is too
    // narrow for the name and the run together.
    const rated = movesFor(SPECIES_BY_ID.get('registeel')!, 'great');
    const compact = renderApp(<PokemonCard refId="registeel" league="great" size="compact" />).container;
    expect(compact.querySelectorAll('.move-counts-run')).toHaveLength(rated.charges.length);

    // Mini shows no moves at all, so there is nothing to time.
    const mini = renderApp(<PokemonCard refId="registeel" league="great" size="mini" />).container;
    expect(mini.querySelectorAll('.pc-move')).toHaveLength(0);
    expect(mini.querySelectorAll('.move-counts-run')).toHaveLength(0);
  });

  it('labels the run with both ends of the ratio', () => {
    const { container } = renderApp(<PokemonCard refId="registeel" league="great" size="full" />);
    const rated = movesFor(SPECIES_BY_ID.get('registeel')!, 'great');
    const chip = [...container.querySelectorAll('.pc-move')].find((c) =>
      c.querySelector('.pc-move-name')?.textContent === rated.charges[0].name,
    )!;
    const title = chip.querySelector('.move-counts-run')!.getAttribute('title') ?? '';
    // Which charged move, and what is throwing it — a bare sequence is
    // meaningless without the second half.
    expect(title).toContain(rated.fast.name);
    expect(title).toContain(rated.charges[0].name);
  });
});
