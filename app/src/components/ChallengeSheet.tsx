import { useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState';
import { useChatDockRequest } from '../state/ChatDockContext';
import { createChallenge } from '../lib/challenges';
import { openDm } from '../lib/channels';
import { LEAGUES } from '../lib/data';
import { listServerFormats, listTeams, type SavedFormat, type SavedTeam } from '../lib/saves';
import type { LeagueId } from '../lib/types';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Propose a match to one person: a league, one of YOUR saved server formats
 * for it, one of your saved teams that fits that format, and when. Sending
 * creates the challenge, opens (or finds) the DM with the target and asks the
 * dock to open it, where the challenge card lives. A refusal — a private
 * format, a past time — is shown here and leaves the sheet open to fix.
 */
export function ChallengeSheet({
  target,
  onClose,
}: {
  target: { id: string; name: string };
  onClose: () => void;
}) {
  const { state } = useAppState();
  const { requestChannel } = useChatDockRequest();
  const [league, setLeague] = useState<LeagueId>(state.league);
  const [formats, setFormats] = useState<SavedFormat[] | null>(null);
  const [formatId, setFormatId] = useState('');
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => firstRef.current?.focus(), []);

  useEffect(() => {
    let live = true;
    listServerFormats()
      .then((fs) => live && setFormats(fs))
      .catch((e) => live && (setFormats([]), setError(messageOf(e))));
    return () => {
      live = false;
    };
  }, []);

  const leagueFormats = (formats ?? []).filter((f) => f.format.base === league);
  const format = leagueFormats.find((f) => f.id === formatId);
  const size = format?.format.composition.size;

  useEffect(() => {
    setTeams(null);
    setTeamId('');
    if (size !== 3 && size !== 6) return;
    let live = true;
    listTeams(size)
      .then((ts) => live && setTeams(ts))
      .catch((e) => live && (setTeams([]), setError(messageOf(e))));
    return () => {
      live = false;
    };
  }, [size]);

  const leagueTeams = (teams ?? []).filter((t) => t.league === league && t.size === size);
  const team = leagueTeams.find((t) => t.id === teamId);
  const ready = !!format && !!team && (!scheduled || when !== '') && !busy;

  async function send() {
    if (!format || !team) return;
    setBusy(true);
    setError(null);
    try {
      await createChallenge({
        targetId: target.id,
        league,
        formatVersionId: format.versionId,
        format: format.format,
        team: team.members,
        scheduledFor: scheduled ? new Date(when) : undefined,
      });
      const dmId = await openDm(target.id);
      requestChannel(dmId);
      onClose();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="challenge-sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="challenge-sheet panel chamfer-9"
        role="dialog"
        aria-modal="true"
        aria-label={`Challenge ${target.name}`}
      >
        <div className="hud-label">Challenge {target.name}</div>

        <div className="field">
          <label htmlFor="challenge-league">League</label>
          <select
            id="challenge-league"
            ref={firstRef}
            className="input"
            value={league}
            onChange={(e) => {
              setLeague(e.target.value as LeagueId);
              setFormatId('');
            }}
          >
            {LEAGUES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="challenge-format">Format</label>
          <select id="challenge-format" className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            <option value="">Choose a format</option>
            {leagueFormats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {formats && leagueFormats.length === 0 && (
            <p className="text-muted">No saved formats for this league — save one on the Formats screen.</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="challenge-team">Team</label>
          <select
            id="challenge-team"
            className="input"
            value={teamId}
            disabled={!format}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">Choose a team</option>
            {leagueTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {format && teams && leagueTeams.length === 0 && (
            <p className="text-muted">
              No saved {size}-Pokémon teams for this league — build one on the Teams screen.
            </p>
          )}
        </div>

        <div className="seg-group challenge-sheet-when" role="radiogroup" aria-label="Start">
          <label className={`btn seg-btn radio${scheduled ? '' : ' is-active'}`}>
            <input type="radio" name="challenge-when" checked={!scheduled} onChange={() => setScheduled(false)} />
            Now
          </label>
          <label className={`btn seg-btn radio${scheduled ? ' is-active' : ''}`}>
            <input type="radio" name="challenge-when" checked={scheduled} onChange={() => setScheduled(true)} />
            Scheduled
          </label>
        </div>
        {scheduled && (
          <div className="field">
            <label htmlFor="challenge-when">When</label>
            <input
              id="challenge-when"
              className="input"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
        )}

        {error && (
          <p className="friend-notice" role="alert">
            {error}
          </p>
        )}

        <div className="challenge-sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void send()}>
            Send challenge
          </button>
        </div>
      </div>
    </div>
  );
}
