import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { useAppState } from '../state/AppState';
import {
  challengeView, declineChallenge, fetchChallenges, withdrawChallenge, type Challenge,
} from '../lib/challenges';
import { acceptOffer, confirmOffer } from '../lib/matchmaking';
import { myMatches } from '../lib/matches';
import { listTeams, type SavedTeam } from '../lib/saves';
import { LEAGUE_BY_ID } from '../lib/data';

const POLL_MS = 10_000;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A live challenge, drawn from the offer row itself (never from the message
 * body, which the proposer can edit). Buttons are only what `challengeView`
 * returns for this viewer.
 */
export function ChallengeCard({ offerId }: { offerId: string }) {
  const { user } = useSession();
  const { patch } = useAppState();
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(undefined); // undefined = loading
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChallenge((await fetchChallenges([offerId])).get(offerId) ?? null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [offerId]);

  // Poll only while the challenge can still change.
  const view = user && challenge !== undefined ? challengeView(challenge, user.id, new Date()) : null;
  const terminal = view?.tone === 'dead' || view?.tone === 'done';
  useEffect(() => {
    void load();
    if (terminal) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load, terminal]);

  // Teams the accepter can bring: same size as the proposer's, same league.
  const wantsTeam = !!challenge && !!user && challenge.targetId === user.id && challenge.state === 'open';
  useEffect(() => {
    if (!wantsTeam || !challenge) return;
    const size = challenge.rosterSize;
    if (size !== 3 && size !== 6) return; // only sizes the app can save
    void listTeams(size).then((ts) => {
      const ok = ts.filter((t) => t.league === challenge.league);
      setTeams(ok);
      setTeamId((cur) => (ok.some((t) => t.id === cur) ? cur : ok[0]?.id ?? ''));
    }).catch((e) => setError(messageOf(e)));
  }, [wantsTeam, challenge]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  async function openMatch() {
    if (!challenge?.matchId) return;
    setError(null);
    try {
      const m = (await myMatches()).find((x) => x.id === challenge.matchId);
      if (m) patch({ activeMatch: m, screen: 'match' });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (challenge === undefined || !view || !user) {
    return error
      ? <p className="friend-notice" role="alert">{error}</p>
      : <p className="text-faint">Loading challenge…</p>;
  }

  const has = (a: (typeof view.actions)[number]) => view.actions.includes(a);
  const live = challenge?.state === 'open' || challenge?.state === 'accepted';

  return (
    <div className={`challenge-card chamfer-9 tone-${view.tone}`}>
      <span className="hud-label">Challenge</span>
      {challenge && (
        <p>
          {challenge.formatName ?? 'an unnamed format'} · {LEAGUE_BY_ID.get(challenge.league)?.name ?? challenge.league} ·{' '}
          {challenge.scheduledFor ? new Date(challenge.scheduledFor).toLocaleString() : 'now'}
          {live && ` · expires ${new Date(challenge.expiresAt).toLocaleString()}`}
        </p>
      )}
      <p>{view.label}</p>
      <div className="challenge-card-actions">
        {has('accept') && (
          <>
            {teams.length > 0 && (
              <select className="input" aria-label="Team to bring" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !teamId}
              onClick={() => void run(() => acceptOffer(offerId, teams.find((t) => t.id === teamId)!.members))}
            >
              Accept
            </button>
          </>
        )}
        {has('confirm') && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => confirmOffer(offerId))}>Confirm</button>
        )}
        {has('decline') && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => declineChallenge(offerId))}>Decline</button>
        )}
        {has('withdraw') && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => withdrawChallenge(offerId))}>Withdraw</button>
        )}
        {challenge?.state === 'converted' && (
          <button type="button" className="btn" disabled={busy} onClick={() => void openMatch()}>Open match</button>
        )}
      </div>
      {has('accept') && teams.length === 0 && challenge && (
        <p className="text-faint">Save a team of {challenge.rosterSize} in Teams first</p>
      )}
      {error && <p className="friend-notice" role="alert">{error}</p>}
    </div>
  );
}
