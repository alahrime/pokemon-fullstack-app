import { useEffect, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  adjudicatedRounds, myMatches, myReport, submitReport, toMatchTerms, toMyTerms,
  type Match, type MatchState,
} from '../lib/matches';

/** A best-of-N ends the moment one side reaches this many wins, not before. */
const needed = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/**
 * A round nobody has answered yet, as distinct from either claim. Kept as an
 * explicit third state (not an `undefined` hole in a sparse array) so that
 * "unanswered" is a value `.map`/`.some` see and can render or block on,
 * rather than an accident of array length.
 */
type RoundResult = boolean | null;

/**
 * Restates the database's `is_valid_scoreline` check constraint (see
 * `supabase/migrations/20260905124000_match_reports_and_rounds.sql`) so the
 * Submit button is not offered for a claim the server would refuse outright.
 * The database remains the sole authority on whether a scoreline is legal —
 * this only spares a round trip for the ordinary case of "you have not
 * finished playing yet".
 *
 * Blocks on any unanswered round first — a gap anywhere (not just at the end)
 * means the player has not told us the whole story, and treating a gap as a
 * loss (the old behaviour) is exactly the bug this type exists to prevent.
 * Once there are no gaps, a legal scoreline is exactly as long as the side
 * that won its LAST entry needed to clinch it (so it reached the win on that
 * round, not earlier), and the other side must hold strictly fewer.
 */
export function isCompleteScoreline(iWon: RoundResult[], bestOf: number): boolean {
  if (iWon.some((w) => w === null)) return false;
  const decided = iWon as boolean[];
  const win = needed(bestOf);
  if (decided.length < win || decided.length > bestOf) return false;
  const mine = decided.filter(Boolean).length;
  const theirs = decided.length - mine;
  const last = decided[decided.length - 1];
  const winner = last ? mine : theirs;
  const loser = last ? theirs : mine;
  return winner === win && loser < win;
}

/**
 * What to tell the player for each state `matches.state` can hold (see the
 * same migration's check constraint). `unverified` and `abandoned` are
 * described from `sweep_matches()`'s own rule — a match nobody finished
 * reporting inside 48 hours, or one that never became a real pairing at all.
 */
const HEADLINE: Record<Match['state'], string> = {
  paired: 'Play your rounds in Pokémon GO, then report the result.',
  reported: 'Reported. Waiting for your opponent.',
  confirmed: 'Confirmed. Both of you reported the same result.',
  mismatch: "Your scores don't match. Check your battle journal and amend if you got it wrong.",
  disputed: 'Disputed — the amend window closed while the reports still disagreed.',
  unverified: "This wasn't fully reported in time and does not count.",
  abandoned: 'Abandoned — this match will not be played.',
};

/**
 * Where a paired match goes: play the rounds in Pokémon GO, report who won
 * each one, and once both sides agree (or a dispute is adjudicated) see the
 * settled per-round result.
 *
 * Deliberately never reads or renders the OPPONENT's claim. That is not just
 * good manners — `match_reports`' own RLS policy seals a report to its
 * author until the match reaches `confirmed`, so a UI that tried to show it
 * earlier would just render nothing back from a query PostgREST already
 * refused. This screen only ever asks for "my report" (`myReport`) and the
 * already-adjudicated truth (`adjudicatedRounds`), so there is no path here
 * that could leak the other side's claim before it is safe to.
 */
export function MatchScreen({ match, onChanged }: { match: Match; onChanged: () => void }) {
  const [iWon, setIWon] = useState<RoundResult[]>([]);
  const [rounds, setRounds] = useState<{ roundNo: number; winner: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The state actually rendered from. Seeded from the `match` prop, but not
  // trusted to stay current on its own — see the effect below.
  const [liveState, setLiveState] = useState<MatchState>(match.state);

  // Re-loads whenever the match identity changes — including `mySide`, since
  // that is what `toMyTerms` needs to read a stored report back correctly —
  // and whenever `match.state` changes, so a transition (e.g. a submit that
  // flips `mismatch` to `confirmed`) refetches on the SAME mounted instance
  // rather than going stale. That matters because `App.tsx` renders this
  // screen with a static `key="match"`: `onChanged` there re-fetches the
  // match and patches it back into the same slot of state, which re-renders
  // this component with new props instead of remounting it, so nothing but
  // this dependency array would ever notice the transition happened.
  //
  // `match.state` alone only fixes staleness for a transition this same
  // instance lives through. It does nothing for a match opened once, left,
  // and returned to later without this instance remounting with fresh
  // props — clicking a nav tab back to `match` reuses whatever `activeMatch`
  // was last set to, which nothing refreshes on its own. So this also calls
  // `myMatches()` on every run (including the initial mount) and reconciles
  // `liveState` to whatever it reports for this id, independent of how stale
  // the `match` prop itself was when this instance last rendered.
  //
  // `live` guards every request against setting state after either this
  // component unmounts or a newer match arrives while the older one's
  // requests are still in flight.
  useEffect(() => {
    let live = true;
    setLiveState(match.state);
    void myMatches().then((list) => {
      const fresh = list.find((m) => m.id === match.id);
      if (live && fresh) setLiveState(fresh.state);
    });
    void myReport(match.id).then((r) => {
      if (live && r) setIWon(toMyTerms(r.wins, match.mySide));
    });
    void adjudicatedRounds(match.id).then((r) => {
      if (live) setRounds(r);
    });
    return () => {
      live = false;
    };
  }, [match.id, match.mySide, match.state]);

  // Mirrors `submit_report`'s own guard (`20260905124100_submit_report.sql`,
  // ~line 21: `if m.state not in ('paired', 'reported', 'mismatch') then
  // raise exception`) — a report submitted against any other state is
  // rejected there, so the form is only offered for the three states the
  // server will actually accept it for. `disputed` is deliberately absent:
  // by the time a match reaches it, the amend window that made a
  // resubmission possible has already closed.
  const open = liveState === 'paired' || liveState === 'reported' || liveState === 'mismatch';
  const complete = isCompleteScoreline(iWon, match.rounds);

  /**
   * Records round `i` as won or lost, and truncates everything AFTER `i` —
   * the story from that point changed, so any later claim already on record
   * no longer means anything. Earlier rounds are left exactly as they were,
   * including ones nobody has answered yet: those are padded with explicit
   * `null` ("unanswered"), never backfilled with `false` ("they won"). A
   * round nobody has clicked is not a claim that the opponent won it — it is
   * a gap, and `isCompleteScoreline` blocks submission on any gap.
   */
  function setRound(i: number, won: boolean) {
    setIWon((prev) => {
      const next = prev.slice(0, i);
      while (next.length < i) next.push(null);
      next[i] = won;
      return next;
    });
  }

  async function send() {
    // Defensive: the button is disabled unless `complete`, which already
    // guarantees no `null` entries remain, so this filter cannot change the
    // array's content — it only lets TypeScript see the narrowed type.
    const wins = iWon.filter((w): w is boolean => w !== null);
    setBusy(true);
    setError(null);
    try {
      // `toMatchTerms` is the one place `iWon` (this player's own terms)
      // becomes the `Side[]` the row actually stores (match terms) — see its
      // doc comment in lib/matches.ts. Passing `iWon` straight through here
      // would be a scoreline reported backwards for whichever side is `b`.
      await submitReport(match.id, toMatchTerms(wins, match.mySide));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="match-screen">
      <ScreenHeader
        title="Match"
        blurb="Report the rounds you played and see the adjudicated result."
      />
      <div className="panel">
        <p role="status">{HEADLINE[liveState]}</p>

        {open && (
          <ul className="match-list round-list">
            {Array.from({ length: match.rounds }, (_, i) => {
              // Neither button is pressed for an unanswered round: `iWon[i]`
              // is `null` for a round nobody has clicked, and `undefined`
              // (not `=== true`/`=== false`) for one past the end of the
              // array — both render as neither claim, not as "they won".
              const iWonThis = iWon[i] === true;
              const theyWonThis = iWon[i] === false;
              return (
                <li key={i} className="match-row round-row">
                  <span>Round {i + 1}</span>
                  <button
                    type="button"
                    className={`btn seg-btn${iWonThis ? ' is-active' : ''}`}
                    aria-pressed={iWonThis}
                    onClick={() => setRound(i, true)}
                  >
                    Round {i + 1}: I won
                  </button>
                  <button
                    type="button"
                    className={`btn seg-btn${theyWonThis ? ' is-active' : ''}`}
                    aria-pressed={theyWonThis}
                    onClick={() => setRound(i, false)}
                  >
                    Round {i + 1}: they won
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {open && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!complete || busy}
            onClick={() => void send()}
          >
            {busy ? 'Working…' : liveState === 'mismatch' ? 'Amend my report' : 'Submit my report'}
          </button>
        )}

        {error && (
          <p className="match-alert" role="alert">
            {error}
          </p>
        )}

        {rounds.length > 0 && (
          <>
            <div className="hud-label">Adjudicated result</div>
            <ol className="match-list">
              {rounds.map((r) => (
                <li key={r.roundNo} className="match-row">
                  Round {r.roundNo}: {r.winner === match.opponentId ? 'they won' : 'you won'}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
