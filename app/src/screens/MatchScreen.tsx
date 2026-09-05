import { useEffect, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  adjudicatedRounds, myReport, submitReport, toMatchTerms, toMyTerms,
  type Match,
} from '../lib/matches';

/** A best-of-N ends the moment one side reaches this many wins, not before. */
const needed = (bestOf: number) => Math.floor(bestOf / 2) + 1;

/**
 * Restates the database's `is_valid_scoreline` check constraint (see
 * `supabase/migrations/20260905120000_match_reports_and_rounds.sql`) so the
 * Submit button is not offered for a claim the server would refuse outright.
 * The database remains the sole authority on whether a scoreline is legal —
 * this only spares a round trip for the ordinary case of "you have not
 * finished playing yet".
 *
 * A legal scoreline is exactly as long as the side that won its LAST entry
 * needed to clinch it (so it reached the win on that round, not earlier), and
 * the other side must hold strictly fewer.
 */
export function isCompleteScoreline(iWon: boolean[], bestOf: number): boolean {
  const win = needed(bestOf);
  if (iWon.length < win || iWon.length > bestOf) return false;
  const mine = iWon.filter(Boolean).length;
  const theirs = iWon.length - mine;
  const last = iWon[iWon.length - 1];
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
  const [iWon, setIWon] = useState<boolean[]>([]);
  const [rounds, setRounds] = useState<{ roundNo: number; winner: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-loads whenever the match identity changes — including `mySide`, since
  // that is what `toMyTerms` needs to read a stored report back correctly.
  // `live` guards both requests against setting state after either this
  // component unmounts or a newer match arrives while the older one's
  // requests are still in flight.
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

  // The three states `submit_report` will still accept a call for — see the
  // same migration's sealing-policy comment, which lists exactly these plus
  // `disputed` as states a report can still exist against. `disputed` is
  // left out here because the amend window that made a resubmission possible
  // has already closed by the time a match reaches it.
  const open = match.state === 'paired' || match.state === 'reported' || match.state === 'mismatch';
  const complete = isCompleteScoreline(iWon, match.rounds);

  /**
   * Records round `i` as won or lost, filling any earlier round nobody
   * clicked with a loss. `submitReport` sends one contiguous entry per round
   * actually played, so clicking straight to "Round 3: I won" without
   * touching 1 and 2 has to mean *something* rather than leaving a hole —
   * a round that was played and lost is the only claim consistent with
   * having moved on to the next one.
   */
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
      // `toMatchTerms` is the one place `iWon` (this player's own terms)
      // becomes the `Side[]` the row actually stores (match terms) — see its
      // doc comment in lib/matches.ts. Passing `iWon` straight through here
      // would be a scoreline reported backwards for whichever side is `b`.
      await submitReport(match.id, toMatchTerms(iWon, match.mySide));
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
        <p role="status">{HEADLINE[match.state]}</p>

        {open && (
          <ul className="match-list round-list">
            {Array.from({ length: match.rounds }, (_, i) => {
              const decided = i < iWon.length;
              const iWonThis = decided && iWon[i];
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
                    className={`btn seg-btn${decided && !iWonThis ? ' is-active' : ''}`}
                    aria-pressed={decided && !iWonThis}
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
            {busy ? 'Working…' : match.state === 'mismatch' ? 'Amend my report' : 'Submit my report'}
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
