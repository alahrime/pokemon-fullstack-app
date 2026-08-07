import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { RankingsScreen } from '../RankingsScreen';
import { CoresScreen } from '../CoresScreen';
import { DiagnosticsScreen } from '../DiagnosticsScreen';
import { TeamBuilderScreen } from '../TeamBuilderScreen';
import { LandingScreen } from '../LandingScreen';
import { ReportScreen } from '../ReportScreen';
import { BattleScreen } from '../BattleScreen';

/**
 * Every screen must render against the real artefacts without throwing.
 *
 * This is the test that would have caught the Diagnostics white-screen: a field
 * renamed in the build but not in the reader arrived as undefined and took the
 * whole app down. Nothing in the gate noticed, because the JSON is cast rather
 * than parsed and tsc cannot see through that.
 */
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const screens: [string, () => ReactElement][] = [
  ['Landing', () => <LandingScreen />],
  ['Report', () => <ReportScreen />],
  ['Battle', () => <BattleScreen />],
  ['Rankings', () => <RankingsScreen />],
  ['Cores', () => <CoresScreen />],
  ['Diagnostics', () => <DiagnosticsScreen />],
  ['GBL Teams', () => <TeamBuilderScreen size={3} />],
  ['Show 6', () => <TeamBuilderScreen size={6} />],
];

describe('every screen renders', () => {
  for (const [name, El] of screens) {
    it(`${name} mounts without throwing`, () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderApp(<El />)).not.toThrow();
      // A React error boundary or a bad prop shows up here even when render
      // "succeeds", so an empty console is part of the assertion.
      const real = spy.mock.calls.filter((c) => !String(c[0]).includes('not wrapped in act'));
      expect(real, `${name} logged: ${JSON.stringify(real[0] ?? '')}`).toHaveLength(0);
    });

    it(`${name} paints something, not an empty shell`, () => {
      const { container } = renderApp(<El />);
      expect(container.textContent!.trim().length).toBeGreaterThan(20);
    });
  }
});

describe('Diagnostics degrades rather than crashing', () => {
  it('shows an explanatory header when the fit is unusable', async () => {
    const rankings = await import('../../lib/rankings');
    vi.spyOn(rankings, 'btFitFor').mockReturnValue(undefined);
    expect(() => renderApp(<DiagnosticsScreen />)).not.toThrow();
    expect(screen.getAllByText(/Diagnostics/i).length).toBeGreaterThan(0);
  });
});
