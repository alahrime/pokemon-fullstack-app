import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState';
import { opponentFriendCode, myMatches, type Match } from '../lib/matchmaking';
import { blockUser } from '../lib/social';
import { useSession } from '../state/SessionContext';
import { challengeFormatLabel, challengeView, liveChallengesWith, type Challenge } from '../lib/challenges';
import type { ChannelDisplay } from '../lib/channels';
import { confirmDialog } from './ConfirmDialog';
import { listMyRecords, type RecordRow } from '../lib/records';
import { CopyCode, MiniTeam, TrainerAvatar, TrainerChips, useProfiles } from './TrainerBits';
import { ResultPips, headToHead } from './FriendCard';

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
  const profile = useProfiles(otherId ? [otherId] : []).get(otherId ?? '');
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  useEffect(() => {
    if (!isDm) return;
    let live = true;
    void listMyRecords().then((r) => live && setRecords(r), () => {});
    return () => { live = false; };
  }, [isDm]);

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
  const vs = records ? headToHead(records, otherId!) : null;
  return (
    <aside className="opponent-panel panel chamfer-9" aria-label="Opponent">
      <header className="opponent-panel-head">
        <TrainerAvatar profile={profile} name={name} size={80} />
        <h2 className="opponent-panel-name">{name}</h2>
        <TrainerChips profile={profile} />
        {profile?.specialty && <span className="text-muted opponent-panel-sub">{profile.specialty}</span>}
      </header>
      <section className="opponent-panel-block" aria-label="Friend code">
        <span className="hud-label">Friend code</span>
        {code ? <CopyCode code={code} name={name} /> : <p className="opponent-panel-code text-faint">{code === undefined ? '…' : 'No friend code shared'}</p>}
      </section>
      <section className="opponent-panel-block" aria-label="Head to head">
        <span className="hud-label">Head to head</span>
        {vs && vs.wins + vs.losses > 0 && (
          <span className="opponent-panel-h2h numeric"><span data-won="true">{vs.wins}</span>–{vs.losses}</span>
        )}
        {vs && <ResultPips results={vs.last5} />}
        <p className="text-muted">{together} {together === 1 ? 'match' : 'matches'} together</p>
      </section>
      {profile && profile.favoritePokemon.length > 0 && (
        <section className="opponent-panel-block" aria-label="Favorite six">
          <span className="hud-label">Favorite six</span>
          <MiniTeam refs={profile.favoritePokemon} label={`${name}'s favorites`} />
        </section>
      )}
      {open && open.length > 0 && (
        <section aria-label="Open challenges" className="opponent-panel-open">
          <span className="hud-label">Open challenges</span>
          <ul>
            {open.map((c) => (
              <li key={c.id}>
                <span>{c.proposerId === user?.id ? 'You challenged' : 'They challenged'}</span>
                {' · '}{challengeFormatLabel(c.formatName, c.league)}
                {' · '}{c.scheduledFor ? new Date(c.scheduledFor).toLocaleString() : 'now'}
                <span className="text-muted"> — {user ? challengeView(c, user.id, new Date()).label : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button type="button" className="btn btn-primary chamfer-5" onClick={() => onChallenge({ id: otherId!, name })}>
        Challenge
      </button>
      <button type="button" className="btn btn-secondary chamfer-5" onClick={() => patch({ screen: 'player', activePlayerId: otherId! })}>
        View profile
      </button>
      <button
        type="button"
        className="btn btn-ghost chamfer-5"
        onClick={async () => {
          if (!(await confirmDialog({ title: 'Block player', body: `Block ${name}? They will no longer be able to message you.`, confirmLabel: 'Block' }))) return;
          blockUser(otherId!).catch(fail);
        }}
      >
        Block
      </button>
      {error && <p className="friend-notice" role="alert">{error}</p>}
    </aside>
  );
}
