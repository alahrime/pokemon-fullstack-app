### Task 5: The match screen

Today a paired match renders as the words "Match paired" and a friend code (`MatchmakingScreen.tsx:709-724`) — the end of the road. This gives it somewhere to go.

`MatchmakingScreen.tsx` is 919 lines and is about getting into a match. This is a new screen rather than a tenth section of that one.

**Files:**
- Create: `app/src/screens/MatchScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Modify: `app/src/screens/MatchmakingScreen.tsx:709-724`
- Test: `app/src/screens/__tests__/match-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/matches.ts` (Task 4).
- Produces: a `match` screen id registered in `screens.ts`, reached with a `matchId`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/match-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
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

beforeEach(() => submitReport.mockReset().mockResolvedValue('reported'));

describe('match screen', () => {
  it('will not submit an impossible best-of-3 scoreline', async () => {
    render(<MatchScreen match={base} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /round 2: i won/i }));
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('sends the scoreline in match terms for the seat you are in', async () => {
    render(<MatchScreen match={{ ...base, mySide: 'b' }} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /round 1: i won/i }));
    await user.click(screen.getByRole('button', { name: /round 2: i won/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(submitReport).toHaveBeenCalledWith('m1', ['b', 'b']));
  });

  it('tells both sides they disagree without showing the opponent claim', async () => {
    render(<MatchScreen match={{ ...base, state: 'mismatch' }} onChanged={() => {}} />);
    expect(await screen.findByText(/scores don't match/i)).toBeInTheDocument();
    expect(screen.queryByText(/opponent reported/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/match-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../MatchScreen"`.

- [ ] **Step 3: Write the screen**

```tsx
// app/src/screens/MatchScreen.tsx
import { useEffect, useState } from 'react';
import {
  adjudicatedRounds, myReport, submitReport, toMatchTerms, toMyTerms,
  type Match, type Side,
} from '../lib/matches';

/** A best-of-N ends when one side reaches this many. */
const needed = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/**
 * The same rule `is_valid_scoreline` enforces in the database, so the Submit
 * button is not offered for a claim the server will refuse. The database is
 * still the authority — this only spares the round trip.
 */
export function isCompleteScoreline(iWon: boolean[], bestOf: number): boolean {
  if (iWon.length < needed(bestOf) || iWon.length > bestOf) return false;
  const mine = iWon.filter(Boolean).length;
  const theirs = iWon.length - mine;
  const last = iWon[iWon.length - 1];
  const winner = last ? mine : theirs;
  const loser = last ? theirs : mine;
  return winner === needed(bestOf) && loser < needed(bestOf);
}

const HEADLINE: Record<Match['state'], string> = {
  paired: 'Play your rounds in Pokémon GO, then report the result.',
  reported: 'Reported. Waiting for your opponent.',
  confirmed: 'Confirmed. Both of you reported the same result.',
  mismatch: "Your scores don't match. Check your battle journal and amend if you got it wrong.",
  disputed: 'Disputed — the amend window closed while the reports still disagreed.',
  unverified: 'Nobody reported in time. This one counts for nothing.',
  abandoned: 'Abandoned.',
};

export function MatchScreen({ match, onChanged }: { match: Match; onChanged: () => void }) {
  const [iWon, setIWon] = useState<boolean[]>([]);
  const [rounds, setRounds] = useState<{ roundNo: number; winner: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void myReport(match.id).then((r) => {
      if (live && r) setIWon(toMyTerms(r.wins, match.mySide));
    });
    void adjudicatedRounds(match.id).then((r) => {
      if (live) setRounds(r);
    });
    return () => {
      live = false;
    };
  }, [match.id, match.mySide]);

  const open = match.state === 'paired' || match.state === 'reported' || match.state === 'mismatch';
  const complete = isCompleteScoreline(iWon, match.rounds);

  function setRound(i: number, won: boolean) {
    setIWon((prev) => {
      const next = prev.slice(0, i);
      while (next.length < i) next.push(false);
      next[i] = won;
      return next;
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await submitReport(match.id, toMatchTerms(iWon, match.mySide));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="hud-label">Match</div>
      <p role="status">{HEADLINE[match.state]}</p>

      {open && (
        <ul className="round-list">
          {Array.from({ length: match.rounds }, (_, i) => (
            <li key={i} className="round-row">
              <span>Round {i + 1}</span>
              <button
                type="button"
                aria-pressed={iWon[i] === true}
                onClick={() => setRound(i, true)}
              >
                Round {i + 1}: I won
              </button>
              <button
                type="button"
                aria-pressed={iWon[i] === false && i < iWon.length}
                onClick={() => setRound(i, false)}
              >
                Round {i + 1}: they won
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <button type="button" disabled={!complete || busy} onClick={() => void send()}>
          {match.state === 'mismatch' ? 'Amend my report' : 'Submit my report'}
        </button>
      )}

      {error && <p className="error">{error}</p>}

      {rounds.length > 0 && (
        <ol className="adjudicated">
          {rounds.map((r) => (
            <li key={r.roundNo}>
              Round {r.roundNo}: {r.winner === match.opponentId ? 'they won' : 'you won'}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register the screen and link to it**

In `app/src/lib/screens.ts`, add a `match` entry beside the existing `matchmaking` one (id `'match'`, a title of `Match`, and a blurb of `Report the rounds you played and see the adjudicated result.`). In `MatchmakingScreen.tsx:709-724`, make each `<li className="match-row">` render a button that navigates to the `match` destination carrying `m.id`, keeping the friend code where it is.

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"; grep -E "Tests  " /tmp/app.log`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/MatchScreen.tsx app/src/lib/screens.ts app/src/screens/MatchmakingScreen.tsx app/src/screens/__tests__/match-screen.test.tsx
git commit -m "feat(matches): a screen where a paired match can be reported

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

