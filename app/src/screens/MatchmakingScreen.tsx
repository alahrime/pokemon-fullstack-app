import { useEffect, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { myMatches, opponentFriendCode, type Match } from '../lib/matchmaking';
import { myReport } from '../lib/matches';
import { listMyRecords, type RecordRow } from '../lib/records';
import { useChatDockRequest } from '../state/ChatDockContext';
import { MatchCard, matchStatus } from '../components/MatchCard';
import { useProfiles } from '../components/TrainerBits';

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
  const [records, setRecords] = useState<Map<string, RecordRow>>(new Map());
  // Only `reported` needs this: whether the one report in is yours decides who is waiting on whom.
  const [reportedByMe, setReportedByMe] = useState<Record<string, boolean>>({});
  const { requestMatchChannel } = useChatDockRequest();
  const profiles = useProfiles((matches ?? []).map((m) => m.opponentId));

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
  // Scores and per-match report state are extras on the card; failing to read them leaves the card without them.
  useEffect(() => {
    if (!matches || matches.length === 0) return;
    let live = true;
    void listMyRecords().then((rows) => live && setRecords(new Map(rows.map((r) => [r.matchId, r]))), () => {});
    for (const m of matches.filter((x) => x.state === 'reported')) {
      void myReport(m.id).then((r) => live && setReportedByMe((cur) => ({ ...cur, [m.id]: r !== null })), () => {});
    }
    return () => {
      live = false;
    };
  }, [matches]);

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
        <div className="match-groups">
          {notice && <p className="friend-notice" role="alert">{notice}</p>}
          {matches === null && !notice && <p className="text-faint">Reading your matches…</p>}
          {matches?.length === 0 && (
            <p className="text-muted">No matches yet. Challenge a friend from Friends or from their profile.</p>
          )}
          {matches && matches.length > 0 && (
            <>
              {[true, false].map((urgent) => {
                const group = matches.filter((m) => matchStatus(m.state, reportedByMe[m.id]).needsYou === urgent);
                if (group.length === 0) return null;
                return (
                  <section key={String(urgent)} className="match-group" aria-label={urgent ? 'Needs you' : 'History'}>
                    <h2 className="hud-label" data-urgent={urgent}>{urgent ? `Needs you · ${group.length}` : 'History'}</h2>
                    {group.map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        name={profiles.get(m.opponentId)?.displayName ?? 'Opponent'}
                        profile={profiles.get(m.opponentId)}
                        code={codes[m.opponentId]}
                        record={records.get(m.id)}
                        iReported={reportedByMe[m.id]}
                        // Carries the already-fetched `Match`: the match screen needs the whole row to render.
                        onOpen={() => patch({ screen: 'match', activeMatch: m })}
                        onChat={() => requestMatchChannel(m.id)}
                      />
                    ))}
                  </section>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
