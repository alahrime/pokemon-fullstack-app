import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { FloorThresholds, stepsCleared } from '../detail/FloorThresholds';
import { paletteFor, thresholdLadders } from '../../lib/engine';
import { SPECIES_BY_ID } from '../../lib/data';

// Structure only — jsdom lays nothing out. One row per opponent the floor clears a step against.
describe('FloorThresholds', () => {
  const props = { subject: 'medicham', league: 'great' as const, moveIdx: 0, bestBuddy: false, palette: paletteFor(SPECIES_BY_ID.get('medicham')!) };
  const { lo, hi, rows } = thresholdLadders('medicham', 'great', 0, 'break');
  const mid = Number(((lo + hi) / 2).toFixed(1));

  it('lists exactly the opponents the attack floor clears, and switches to bulkpoints', () => {
    expect(rows.filter((r) => stepsCleared(r, mid) > 0).length).toBeGreaterThan(0);
    const { container } = renderApp(<FloorThresholds {...props} floor={{ atk: mid, def: 0 }} />);
    expect(container.querySelectorAll('.ftc-row:not(.ftc-axis)')).toHaveLength(rows.filter((r) => stepsCleared(r, mid) > 0).length);
    fireEvent.click(screen.getByRole('tab', { name: /Bulkpoints/ }));
    // A defense floor of 0 clears nothing: no rows, and the next step is named.
    expect(container.querySelector('.ftc-rows')).toBeNull();
    expect(container.textContent).toContain('next:');
  });
});
