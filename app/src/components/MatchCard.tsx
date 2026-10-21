import type { Match, MatchState } from '../lib/matches';
import type { Profile } from '../lib/profile';
import type { RecordRow } from '../lib/records';
import { challengeFormatLabel } from '../lib/challenges';
import { LEAGUE_BY_ID } from '../lib/data';
import { humanTime } from '../lib/channels';
import { CopyCode, MiniTeam, TrainerAvatar, TrainerChips } from './TrainerBits';

type Tone = 'action' | 'info' | 'dispute' | 'neutral';

/** What the card says about each state, and whether it is yours to act on. `iReported` only matters for `reported`. */
export function matchStatus(state: MatchState, iReported: boolean | undefined): { label: string; tone: Tone; cta: string; needsYou: boolean } {
  switch (state) {
    case 'paired': return { label: 'To report', tone: 'action', cta: 'Report result', needsYou: true };
    case 'reported': return iReported === false
      ? { label: 'Opponent reported', tone: 'action', cta: 'Report result', needsYou: true }
      : { label: 'Reported', tone: 'info', cta: 'Waiting on opponent', needsYou: false };
    case 'mismatch': return { label: 'Reports disagree', tone: 'dispute', cta: 'Amend report', needsYou: true };
    case 'confirmed': return { label: 'Confirmed', tone: 'info', cta: 'Open match', needsYou: false };
    case 'disputed': return { label: 'Disputed', tone: 'dispute', cta: 'Open match', needsYou: false };
    case 'unverified': return { label: 'Unverified', tone: 'neutral', cta: 'Open match', needsYou: false };
    case 'abandoned': return { label: 'Abandoned', tone: 'neutral', cta: 'Open match', needsYou: false };
  }
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One match as a matchup: who, under what, both sixes side by side, the score
 * once it is settled, and the one thing to do next.
 */
export function MatchCard({
  match, name, profile, code, record, iReported, onOpen, onChat,
}: {
  match: Match; name: string; profile: Profile | undefined; code: string | null | undefined;
  record: RecordRow | undefined; iReported: boolean | undefined; onOpen: () => void; onChat: () => void;
}) {
  const s = matchStatus(match.state, iReported);
  // No readable format name: the league alone says more than "an unnamed format".
  const format = !match.league ? 'Format unknown' : match.formatName ? challengeFormatLabel(match.formatName, match.league) : LEAGUE_BY_ID.get(match.league)?.name ?? match.league;
  const mine = (match.myTeam ?? []).map((m) => m.ref);
  const theirs = (match.oppTeam ?? []).map((m) => m.ref);
  const settled = !s.needsYou && match.state !== 'reported';
  return (
    <article className="match-card panel" data-tone={s.tone} aria-label={`Match against ${name}`}>
      <div className="match-card-who">
        <TrainerAvatar profile={profile} name={name} size={80} />
        <div className="match-card-id">
          <span className="status-chip chamfer-5" data-tone={s.tone}>{s.label}</span>
          <strong className="match-card-name">vs {name}</strong>
          <TrainerChips profile={profile} />
          <span className="text-muted match-card-sub">{humanTime(match.createdAt)}</span>
        </div>
      </div>

      <div className="match-card-body">
        <div className="match-card-meta">
          <span className="hud-label">{format} · Best of {match.rounds}</span>
          {record && (
            <span className="match-card-score numeric" aria-label={`${record.won ? 'Won' : 'Lost'} ${record.myRounds} to ${record.oppRounds}`}>
              <span data-won={record.won}>{record.myRounds}</span>–{record.oppRounds}
            </span>
          )}
        </div>
        <div className="match-card-teams">
          <div>
            <span className="match-card-side">You</span>
            {mine.length ? <MiniTeam refs={mine} label="Your team" /> : <span className="text-muted match-card-sub">Team not shared</span>}
          </div>
          <span className="match-card-vs" aria-hidden="true">VS</span>
          <div className="match-card-theirs">
            <span className="match-card-side">{name}</span>
            {theirs.length ? <MiniTeam refs={theirs} label={`${name}'s team`} /> : <span className="text-muted match-card-sub">Team not shared</span>}
          </div>
        </div>
      </div>

      <div className="match-card-act">
        {s.needsYou && (code ? <CopyCode code={code} name={name} /> : <span className="text-muted match-card-sub">{code === undefined ? 'Loading friend code…' : 'No friend code on file for this opponent.'}</span>)}
        <div className="match-card-buttons">
          <button type="button" className="btn btn-secondary chamfer-5" aria-label={`Match chat with ${name}`} onClick={onChat}>Chat</button>
          <button type="button" className={`btn chamfer-5 ${s.needsYou ? 'btn-primary' : 'btn-secondary'}`} onClick={onOpen}>{s.cta}</button>
        </div>
        {match.state === 'mismatch' && match.amendDeadline && (
          <span className="match-card-note" data-tone="dispute">Amend by {clock(match.amendDeadline)}</span>
        )}
        {settled && <span className="match-card-note">{match.ratingCounted ? 'Rated' : 'Not rated'}</span>}
      </div>
    </article>
  );
}
