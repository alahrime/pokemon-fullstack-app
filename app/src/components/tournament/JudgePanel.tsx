import { useState } from 'react';
import { grantJudge, revokeJudge, type Entrant, type TournamentState } from '../../lib/tournaments';
import type { Run } from './hostRun';
import { playerName } from './playerName';

interface Props {
  tournamentId: string; organiserId: string; state: TournamentState; entrants: readonly Entrant[]; judges: readonly string[];
  names: ReadonlyMap<string, string>; busy: boolean; run: Run;
}

/** Organiser only. Judges are picked from the entrants (no profile search in v1). */
export function JudgePanel({ tournamentId, organiserId, state, entrants, judges, names, busy, run }: Props) {
  const [pick, setPick] = useState('');
  const options = entrants.filter((e) => !e.dropped && e.playerId !== organiserId && !judges.includes(e.playerId));
  const draft = state === 'draft';
  return (
    <section className="host-section" aria-label="Judges">
      <div className="hud-label">Judges</div>
      {judges.length === 0 && <p className="text-muted">No judges appointed</p>}
      <ul className="host-list">
        {judges.map((j) => (
          <li key={j}>
            {playerName(names, j)}
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => revokeJudge(tournamentId, j))}>Revoke {playerName(names, j)}</button>
          </li>
        ))}
      </ul>
      <div className="host-actions">
        <div className="field">
          <label htmlFor="host-judge">Appoint judge</label>
          <select id="host-judge" className="input" value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a player</option>
            {options.map((e) => <option key={e.playerId} value={e.playerId}>{playerName(names, e.playerId)}</option>)}
          </select>
        </div>
        <button type="button" className="btn" disabled={busy || draft || !pick}
          onClick={async () => { if (await run(() => grantJudge(tournamentId, pick))) setPick(''); }}>Appoint</button>
      </div>
      {draft && <p className="text-muted">Open registration before appointing judges</p>}
    </section>
  );
}
