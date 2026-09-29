import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState';
import { opponentFriendCode, myMatches, type Match } from '../lib/matchmaking';
import { blockUser } from '../lib/social';
import type { ChannelDisplay } from '../lib/channels';

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
