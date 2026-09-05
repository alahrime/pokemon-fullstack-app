import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { ThemeProvider } from '../../state/ThemeContext';
import { SessionProvider } from '../../state/SessionContext';
import { AppStateProvider } from '../../state/AppState';
import { MatchScreen } from '../MatchScreen';
import type { Match } from '../../lib/matches';

const base: Match = {
  id: 'm1', opponentId: 'opp', mySide: 'a', formatVersionId: 'fv1', rulesHash: 'aa',
  dataRev: 'rev1', rounds: 3, state: 'paired', ratingCounted: false, amendDeadline: null,
  source: 'queue', createdAt: '2026-09-05T00:00:00Z',
};

const submitReport = vi.fn();
const adjudicatedRounds = vi.fn();
vi.mock('../../lib/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/matches')>()),
  submitReport: (...args: unknown[]) => submitReport(...args),
  myReport: async () => null,
  adjudicatedRounds: (...args: unknown[]) => adjudicatedRounds(...args),
}));

// `@testing-library/user-event` is not a dependency of this project and no
// other test here uses it (see interactions.test.tsx, screen-leaves.test.tsx)
// — `fireEvent` is the house convention, so the brief's `userEvent.setup()`
// calls are replaced with it below. The assertions are unchanged.
beforeEach(() => {
  submitReport.mockReset().mockResolvedValue('reported');
  adjudicatedRounds.mockReset().mockResolvedValue([]);
});

/**
 * The exact wrapper `renderApp` builds, reused for `rerender()` calls. RTL's
 * `rerender` replaces the whole tree passed to `render`, not just the
 * component under test — passing a bare `<MatchScreen>` would tear down
 * these providers (and, with them, the very instance identity a same-mounted-
 * instance test is trying to observe) instead of updating it in place. Same
 * component types in the same positions is what keeps React from remounting.
 */
function wrapped(ui: ReactElement) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <AppStateProvider>{ui}</AppStateProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

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

  // FINDING 3: the brief requires "Amend my report" as the Submit label in
  // the `mismatch` state; nothing previously asserted the label itself.
  it('labels the submit control "Amend my report" while mismatched', async () => {
    renderApp(<MatchScreen match={{ ...base, state: 'mismatch' }} onChanged={() => {}} />);
    expect(await screen.findByRole('button', { name: /amend my report/i })).toBeInTheDocument();
  });

  // FINDING 1(a): clicking a later round first must not manufacture a claim
  // for the earlier, unclicked rounds. Before the fix, `setRound` backfilled
  // skipped rounds with `false` ("they won"), which pressed that round's
  // "they won" button and, since two rounds now "counted", could even leave
  // Submit enabled on a scoreline the player never actually reported.
  it('leaves earlier rounds visibly unanswered when a later round is clicked first, and blocks submission', async () => {
    renderApp(<MatchScreen match={base} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /round 3: i won/i }));

    const round1Won = screen.getByRole('button', { name: /round 1: i won/i });
    const round1Lost = screen.getByRole('button', { name: /round 1: they won/i });
    const round2Won = screen.getByRole('button', { name: /round 2: i won/i });
    const round2Lost = screen.getByRole('button', { name: /round 2: they won/i });

    // Neither button is pressed for rounds nobody has answered — in
    // particular, "they won" must NOT be pressed for round 1 or round 2.
    expect(round1Won).toHaveAttribute('aria-pressed', 'false');
    expect(round1Lost).toHaveAttribute('aria-pressed', 'false');
    expect(round2Won).toHaveAttribute('aria-pressed', 'false');
    expect(round2Lost).toHaveAttribute('aria-pressed', 'false');

    // A gap earlier in the sequence must block submission even though a
    // round beyond it has been answered.
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  // FINDING 1(b): the brief's concrete failure — true result 2-1 (won R1,
  // lost R2, won R3), reported out of order and then "corrected" — ends in
  // a clean, dishonest [true, true] under the old code. That exact literal
  // sequence (click Round 3, then click Round 1 to "correct" it) truncates
  // to index 0 either way `setRound` pads: `prev.slice(0, 0)` is `[]`
  // regardless of what filled the discarded slots, so after just those two
  // clicks the visible state is [true] under both the old and the fixed
  // code — editing round 1 wipes the backfill artifact along with
  // everything else, which is why test (a) above is what actually has to
  // catch the bug. This test instead corrects round 2 (not round 1) after
  // the same out-of-order first click: editing an index that is NOT 0
  // leaves round 1 inside the truncated array's bounds, so a false-`false`
  // leftover from the old backfill survives into the final, checkable
  // state — and, critically, resolves to a COMPLETE, submittable scoreline
  // ([false, false], a clean 2-0 loss the player never actually reported)
  // rather than a blocked one. This is the same class of defect the brief
  // describes ("a clean scoreline for a match they lost a round of"),
  // exercised through a sequence that a revert of the fix can actually be
  // shown to fail.
  it('a correction to a later round does not leave an earlier backfilled claim behind', async () => {
    renderApp(<MatchScreen match={base} onChanged={() => {}} />);

    // Click "Round 3: I won" first, without touching rounds 1-2.
    fireEvent.click(await screen.findByRole('button', { name: /round 3: i won/i }));
    // Answer round 2 honestly ("they won"). This does not touch round 1.
    fireEvent.click(screen.getByRole('button', { name: /round 2: they won/i }));

    // Round 1 must still read as unanswered — never silently "they won"
    // just because the player jumped ahead to round 3 first.
    expect(screen.getByRole('button', { name: /round 1: i won/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /round 1: they won/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // With round 1 genuinely unanswered, this must not resolve to the
    // complete-looking (and false) two-round 2-0 loss [they-won, they-won].
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(submitReport).not.toHaveBeenCalled();
  });

  // FINDING 2: `App.tsx` mounts this screen with a static key, so a state
  // transition re-renders the SAME instance rather than remounting it. The
  // effect must still notice and refetch — an unmount/remount test would not
  // exercise this at all, since a fresh mount would refetch regardless.
  it('refetches the adjudicated result when the same mounted instance transitions state', async () => {
    adjudicatedRounds.mockResolvedValueOnce([]);
    const { rerender } = renderApp(<MatchScreen match={{ ...base, state: 'mismatch' }} onChanged={() => {}} />);

    await screen.findByText(/scores don't match/i);
    expect(adjudicatedRounds).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Adjudicated result')).not.toBeInTheDocument();

    adjudicatedRounds.mockResolvedValueOnce([{ roundNo: 1, winner: 'opp' }, { roundNo: 2, winner: base.id }]);
    // Same wrapper, same component type/position, new props — this is what
    // `App.tsx` actually does via `onChanged`'s refetch-and-patch, not a
    // fresh `render()`.
    rerender(wrapped(<MatchScreen match={{ ...base, state: 'confirmed' }} onChanged={() => {}} />));

    await waitFor(() => expect(adjudicatedRounds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/confirmed\. both of you reported/i)).toBeInTheDocument();
    expect(await screen.findByText('Adjudicated result')).toBeInTheDocument();
    expect(screen.getByText(/round 1: they won/i)).toBeInTheDocument();
  });
});
