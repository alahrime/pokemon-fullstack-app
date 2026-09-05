import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { MatchScreen } from '../MatchScreen';
import type { Match } from '../../lib/matches';

const base: Match = {
  id: 'm1', opponentId: 'opp', mySide: 'a', formatVersionId: 'fv1', rulesHash: 'aa',
  dataRev: 'rev1', rounds: 3, state: 'paired', ratingCounted: false, amendDeadline: null,
  source: 'queue', createdAt: '2026-09-05T00:00:00Z',
};

const submitReport = vi.fn();
vi.mock('../../lib/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/matches')>()),
  submitReport: (...args: unknown[]) => submitReport(...args),
  myReport: async () => null,
  adjudicatedRounds: async () => [],
}));

// `@testing-library/user-event` is not a dependency of this project and no
// other test here uses it (see interactions.test.tsx, screen-leaves.test.tsx)
// — `fireEvent` is the house convention, so the brief's `userEvent.setup()`
// calls are replaced with it below. The assertions are unchanged.
beforeEach(() => submitReport.mockReset().mockResolvedValue('reported'));

describe('match screen', () => {
  it('will not submit an impossible best-of-3 scoreline', async () => {
    renderApp(<MatchScreen match={base} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /round 2: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('sends the scoreline in match terms for the seat you are in', async () => {
    renderApp(<MatchScreen match={{ ...base, mySide: 'b' }} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    fireEvent.click(screen.getByRole('button', { name: /round 2: i won/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(submitReport).toHaveBeenCalledWith('m1', ['b', 'b']));
  });

  it('tells both sides they disagree without showing the opponent claim', async () => {
    renderApp(<MatchScreen match={{ ...base, state: 'mismatch' }} onChanged={() => {}} />);
    expect(await screen.findByText(/scores don't match/i)).toBeInTheDocument();
    expect(screen.queryByText(/opponent reported/i)).not.toBeInTheDocument();
  });
});
