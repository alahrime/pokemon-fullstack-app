import { useState, type FormEvent } from 'react';
import { searchProfilesByName } from '../../lib/channels';
import { grantJudge, revokeJudge, type Entrant, type TournamentState } from '../../lib/tournaments';
import type { Run } from './hostRun';
import { playerName } from './playerName';

interface Props {
  tournamentId: string; organiserId: string; state: TournamentState; entrants: readonly Entrant[]; judges: readonly string[];
  names: ReadonlyMap<string, string>; busy: boolean; run: Run;
}

/** Organiser only. Judges are picked from the entrants, or found by display name (any profile may judge). */
export function JudgePanel({ tournamentId, organiserId, state, entrants, judges, names, busy, run }: Props) {
  const [pick, setPick] = useState('');
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<{ id: string; displayName: string }[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const find = async (e: FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    setSearchError(null);
    try { setHits(await searchProfilesByName(q)); } catch (err) { setHits(null); setSearchError(err instanceof Error ? err.message : 'Search failed'); }
  };
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
        <div className="field min-w-0 max-w-full">
          <label htmlFor="host-judge">Appoint judge</label>
          <select id="host-judge" className="input" value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a player</option>
            {options.map((e) => <option key={e.playerId} value={e.playerId}>{playerName(names, e.playerId)}</option>)}
          </select>
        </div>
        <button type="button" className="btn" disabled={busy || draft || !pick}
          onClick={async () => { if (await run(() => grantJudge(tournamentId, pick))) setPick(''); }}>Appoint</button>
      </div>
      <form className="host-actions" onSubmit={(e) => void find(e)}>
        <div className="field min-w-0 max-w-full">
          <label htmlFor="host-judge-find">Find anyone by name</label>
          <input id="host-judge-find" className="input" value={term} disabled={busy} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={busy || draft || !term.trim()}>Search</button>
      </form>
      {searchError && <p className="friend-notice" role="alert">{searchError}</p>}
      {hits && hits.filter((h) => h.id !== organiserId && !judges.includes(h.id)).length === 0 && <p className="text-muted">No one to appoint matches that name</p>}
      <ul className="host-list">
        {(hits ?? []).filter((h) => h.id !== organiserId && !judges.includes(h.id)).map((h) => (
          <li key={h.id}>
            {h.displayName}
            <button type="button" className="btn" disabled={busy || draft}
              onClick={async () => { if (await run(() => grantJudge(tournamentId, h.id))) { setHits(null); setTerm(''); } }}>Appoint {h.displayName}</button>
          </li>
        ))}
      </ul>
      {draft && <p className="text-muted">Open registration before appointing judges</p>}
    </section>
  );
}
