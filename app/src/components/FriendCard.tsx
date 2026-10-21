import type { Profile } from '../lib/profile';
import type { RecordRow } from '../lib/records';
import { humanTime } from '../lib/channels';
import { CopyCode, MiniTeam, TrainerAvatar, TrainerChips } from './TrainerBits';

/** Your head-to-head with one person, newest first, from the match records you already hold. */
export function headToHead(rows: readonly RecordRow[], id: string) {
  const vs = rows.filter((r) => r.opponentId === id);
  const wins = vs.filter((r) => r.won).length;
  return { wins, losses: vs.length - wins, last5: vs.slice(0, 5).map((r) => r.won), lastPlayed: vs[0]?.playedAt ?? null };
}

export function ResultPips({ results }: { results: readonly boolean[] }) {
  if (results.length === 0) return null;
  return (
    <span className="result-pips" role="img" aria-label={`Last ${results.length}: ${results.map((w) => (w ? 'win' : 'loss')).join(', ')}`}>
      {results.map((w, i) => <span key={i} data-won={w}>{w ? 'W' : 'L'}</span>)}
    </span>
  );
}

/**
 * An accepted friend: who they are, what they play, how you fare against
 * them, and what you do with a friend. Nothing is invented — a field the
 * trainer left blank, or a record you have not made yet, is simply absent.
 */
export function FriendCard({
  id, name, profile, code, since, records, busy, onOpenProfile, onMessage, onChallenge, onRemove, onBlock,
}: {
  id: string; name: string; profile: Profile | undefined; code: string | null | undefined; since: string;
  /** null while loading or when records could not be read; the stats strip is then left out. */
  records: readonly RecordRow[] | null; busy: boolean;
  onOpenProfile: () => void; onMessage: () => void; onChallenge: () => void; onRemove: () => void; onBlock: () => void;
}) {
  const vs = records ? headToHead(records, id) : null;
  const six = profile?.favoritePokemon ?? [];
  return (
    <article className="friend-card panel" aria-label={name}>
      <header className="friend-card-head">
        <TrainerAvatar profile={profile} name={name} size={80} />
        <div className="friend-card-id">
          <button type="button" className="btn btn-ghost friend-card-name" aria-label={`View ${name}'s profile`} onClick={onOpenProfile}>
            {name}
          </button>
          {profile?.goUsername && profile.goUsername !== name && <span className="text-muted friend-card-sub">In game: {profile.goUsername}</span>}
          <TrainerChips profile={profile} />
          {profile?.specialty && <span className="text-muted friend-card-sub">{profile.specialty}</span>}
        </div>
      </header>

      {six.length > 0 && (
        <div className="friend-card-six">
          <span className="hud-label">Favorite six</span>
          <MiniTeam refs={six} label={`${name}'s favorites`} />
        </div>
      )}

      {vs && (
        <dl className="friend-card-stats">
          <div>
            <dt className="hud-label">Vs you</dt>
            <dd className="numeric">{vs.wins + vs.losses === 0 ? '—' : `${vs.wins}–${vs.losses}`}</dd>
          </div>
          <div>
            <dt className="hud-label">Last played</dt>
            <dd>{vs.lastPlayed ? humanTime(vs.lastPlayed) : 'Never'}</dd>
          </div>
          <div>
            <dt className="hud-label">Recent</dt>
            <dd>{vs.last5.length ? <ResultPips results={vs.last5} /> : <span className="text-muted">No matches yet</span>}</dd>
          </div>
        </dl>
      )}

      <div className="friend-card-actions">
        {code ? <CopyCode code={code} name={name} /> : <span className="text-muted friend-card-sub">{code === undefined ? 'Loading friend code…' : 'No friend code shared'}</span>}
        <div className="friend-card-buttons">
          <button type="button" className="btn btn-secondary chamfer-5" aria-label={`Message ${name}`} onClick={onMessage}>Message</button>
          <button type="button" className="btn btn-primary chamfer-5" aria-label={`Challenge ${name}`} onClick={onChallenge}>Challenge</button>
        </div>
      </div>
      <footer className="friend-card-foot">
        <span className="text-muted">Added {humanTime(since)}</span>
        <span>
          <button type="button" className="btn btn-ghost" aria-label={`Remove ${name}`} disabled={busy} onClick={onRemove}>Remove</button>
          <button type="button" className="btn btn-ghost" aria-label={`Block ${name}`} disabled={busy} onClick={onBlock}>Block</button>
        </span>
      </footer>
    </article>
  );
}
