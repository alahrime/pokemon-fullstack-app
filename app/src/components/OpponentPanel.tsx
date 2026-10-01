import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState';
import { opponentFriendCode, myMatches, type Match } from '../lib/matchmaking';
import { blockUser } from '../lib/social';
import { useSession } from '../state/SessionContext';
import { challengeView, liveChallengesWith, type Challenge } from '../lib/challenges';
import { LEAGUE_BY_ID } from '../lib/data';
import type { ChannelDisplay } from '../lib/channels';

const OPEN_POLL_MS = 15_000;

/** Who you are talking to: their friend code, your history, and the two
 * actions that only make sense against one person. A match channel gets a
 * single shortcut back to its match instead. */
export function OpponentPanel({
  channel,
  onChallenge,
}: {
  channel: ChannelDisplay;
  onChallenge: (target: { id: string; name: string }) => void;
}) {
  const { patch } = useAppState();
  const { user } = useSession();
  const [open, setOpen] = useState<Challenge[] | null>(null);
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const { otherId, matchId } = channel;
  const isDm = channel.kind === 'dm' && !!otherId;

  useEffect(() => {
    let live = true;
    setError(null);
    setCode(undefined);
    setMatches(null);
    if (isDm) {
      void opponentFriendCode(otherId!)
        .then((c) => live && setCode(c))
        .catch((e) => live && fail(e));
    }
    void myMatches()
      .then((m) => live && setMatches(m))
      .catch(() => live && setMatches(null));
    return () => {
      live = false;
    };
  }, [isDm, otherId, channel.id]);

  // The live challenges between you. Cards in the conversation do the answering; this is the summary, so it only reads.
  useEffect(() => {
    setOpen(null);
    if (!isDm || !user) return;
    let live = true;
    const load = () => void liveChallengesWith(otherId!).then((c) => live && setOpen(c)).catch(() => live && setOpen((cur) => cur ?? []));
    load();
    const id = setInterval(load, OPEN_POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [isDm, otherId, channel.id, user?.id]);

  if (!isDm) {
    const match = matchId ? matches?.find((m) => m.id === matchId) : undefined;
    return (
      <aside className="opponent-panel panel chamfer-9" aria-label="Opponent">
        <button
          type="button"
          className="btn chamfer-5"
          disabled={!match}
          onClick={() => match && patch({ activeMatch: match, screen: 'match' })}
        >
          Open match
        </button>
        {error && <p className="friend-notice" role="alert">{error}</p>}
      </aside>
    );
  }

  const together = (matches ?? []).filter((m) => m.opponentId === otherId).length;
  const name = channel.displayTitle;
  return (
    <aside className="opponent-panel panel chamfer-9" aria-label="Opponent">
      <span className="hud-label">Opponent</span>
      <h2 className="opponent-panel-name">{name}</h2>
      <p className="opponent-panel-code text-faint">
        {code === undefined ? '…' : code ?? 'No friend code shared'}
      </p>
      <p className="text-muted">{together} {together === 1 ? 'match' : 'matches'} together</p>
      {open && open.length > 0 && (
        <section aria-label="Open challenges" className="opponent-panel-open">
          <span className="hud-label">Open challenges</span>
          <ul>
            {open.map((c) => (
              <li key={c.id}>
                <span>{c.proposerId === user?.id ? 'You challenged' : 'They challenged'}</span>
                {' · '}{c.formatName ?? 'an unnamed format'} · {LEAGUE_BY_ID.get(c.league)?.name ?? c.league}
                {' · '}{c.scheduledFor ? new Date(c.scheduledFor).toLocaleString() : 'now'}
                <span className="text-muted"> — {user ? challengeView(c, user.id, new Date()).label : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button type="button" className="btn chamfer-5" onClick={() => onChallenge({ id: otherId!, name })}>
        Challenge
      </button>
      <button
        type="button"
        className="btn btn-ghost chamfer-5"
        onClick={() => {
          if (!window.confirm(`Block ${name}? They will no longer be able to message you.`)) return;
          blockUser(otherId!).catch(fail);
        }}
      >
        Block
      </button>
      {error && <p className="friend-notice" role="alert">{error}</p>}
    </aside>
  );
}
