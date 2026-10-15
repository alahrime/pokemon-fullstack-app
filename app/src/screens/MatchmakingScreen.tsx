import { useEffect, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { myMatches, opponentFriendCode, type Match } from '../lib/matchmaking';

/**
 * The Matches screen: every match you are in, each a way back into its Match
 * screen.
 *
 * Matches come from challenges (Friends, profiles) and tournaments. The blind
 * queue and the open offer board that used to share this screen were removed
 * 2026-10-15 along with the coordinator that verified and paired them; their
 * tables and SQL functions remain, unused, for when matchmaking between
 * strangers is revisited. The screen keeps its `matchmaking` id so links and
 * the section rail are unchanged.
 */
const BLURB = 'Every match you are in. Challenge a friend from Friends or a profile to start one.';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function MatchmakingScreen() {
  const { patch } = useAppState();
  const { user } = useSession();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [codes, setCodes] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setMatches(null);
      setCodes({});
      return;
    }
    let live = true;
    void myMatches()
      .then((m) => {
        if (live) setMatches(m);
      })
      .catch((e: unknown) => {
        if (live) setNotice(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [user]);

  // Friend codes are readable only once a match pairs two people — fetched
  // once matches are known, one call per opponent, never guessed at.
  useEffect(() => {
    if (!matches || matches.length === 0) return;
    let live = true;
    void Promise.all(
      matches.map((m) => opponentFriendCode(m.opponentId).then((code) => [m.opponentId, code] as const)),
    ).then((pairs) => {
      if (live) setCodes(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [matches]);

  return (
    <div className="matchmaking-screen">
      <ScreenHeader title="Matches" blurb={BLURB} />
      {!user ? (
        <div className="panel text-muted">Sign in to see your matches.</div>
      ) : (
        <div className="panel">
          <div className="hud-label">Your matches</div>
          {notice && <p className="friend-notice" role="alert">{notice}</p>}
          {matches === null && !notice && <p className="text-faint">Reading your matches…</p>}
          {matches?.length === 0 && (
            <p className="text-muted">No matches yet. Challenge a friend from Friends or from their profile.</p>
          )}
          {matches && matches.length > 0 && (
            <ul className="match-list">
              {matches.map((m) => (
                <li key={m.id} className="match-row">
                  {/* Carries the already-fetched `Match` rather than just
                      `m.id`: the match screen needs the whole row (rounds,
                      which side you sit in, the current state) to render
                      anything, and this list just read it from the server. */}
                  <button type="button" className="btn chip-btn match-open" onClick={() => patch({ screen: 'match', activeMatch: m })}>
                    Open match
                  </button>
                  <span className="friend-code">
                    {codes[m.opponentId] === undefined
                      ? 'Loading friend code…'
                      : codes[m.opponentId]
                        ? `Friend code: ${codes[m.opponentId]}`
                        : 'No friend code on file for this opponent.'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
