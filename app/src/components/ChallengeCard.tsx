import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { useAppState } from '../state/AppState';
import {
  challengeView, declineChallenge, fetchChallenges, subscribeToOffer, withdrawChallenge, type Challenge,
} from '../lib/challenges';
import { acceptOffer, confirmOffer } from '../lib/matchmaking';
import { resolveDisplayNames } from '../lib/channels';
import { ChallengeSheet } from './ChallengeSheet';
import { ChallengeAcceptSheet } from './ChallengeAcceptSheet';
import { myMatches } from '../lib/matches';
import { LEAGUE_BY_ID } from '../lib/data';

// Realtime does the work; this poll only covers a dropped socket (and clock-derived expiry is computed on render).
const POLL_MS = 60_000;
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
  const [accepting, setAccepting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countering, setCountering] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setChallenge((await fetchChallenges([offerId])).get(offerId) ?? null);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [offerId]);

  // Refetch the instant the offer row changes; poll slowly as a fallback. Both stop once the challenge is over.
  const view = user && challenge !== undefined ? challengeView(challenge, user.id, new Date()) : null;
  const terminal = view?.tone === 'dead' || view?.tone === 'done';
  useEffect(() => {
    void load();
    if (terminal) return;
    const stop = subscribeToOffer(offerId, () => void load());
    const id = setInterval(() => void load(), POLL_MS);
    return () => { stop(); clearInterval(id); };
  }, [load, terminal, offerId]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  async function openCounter() {
    if (!challenge) return;
    setError(null);
    try {
      const name = (await resolveDisplayNames([challenge.proposerId])).get(challenge.proposerId) ?? 'them';
      setCountering({ id: challenge.proposerId, name });
    } catch (e) {
      setError(messageOf(e));
    }
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setAccepting(true)}>Accept</button>
        )}
        {has('confirm') && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => confirmOffer(offerId))}>Confirm</button>
        )}
        {has('counter') && (
          <button type="button" className="btn" disabled={busy} onClick={() => void openCounter()}>Counter</button>
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
      {error && <p className="friend-notice" role="alert">{error}</p>}
      {accepting && challenge && (
        <ChallengeAcceptSheet
          league={challenge.league}
          size={challenge.rosterSize}
          onAccept={async (team) => { await acceptOffer(offerId, team); await load(); }}
          onClose={() => setAccepting(false)}
        />
      )}
      {countering && challenge && (
        <ChallengeSheet target={countering} counterOf={offerId} defaultLeague={challenge.league} onClose={() => setCountering(null)} />
      )}
    </div>
  );
}
