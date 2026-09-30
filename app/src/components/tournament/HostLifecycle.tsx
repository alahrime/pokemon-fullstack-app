import { closeRegistration, finishTournament, openRegistration, type Entrant, type Tournament, type TournamentState } from '../../lib/tournaments';
import type { Run } from './hostRun';

interface Props {
  tournament: Tournament; state: TournamentState; entrants: readonly Entrant[]; unsettled: number; isOrganiser: boolean;
  busy: boolean; run: Run; onPreview: () => void;
}

/** The one next step for this state. Only the organiser opens, closes or finishes; a judge may start rounds. */
export function HostLifecycle({ tournament: t, state, entrants, unsettled, isOrganiser, busy, run, onPreview }: Props) {
  const active = entrants.filter((e) => !e.dropped).length;
  const last = state === 'running' && t.currentRound >= t.rounds;
  return (
    <div className="host-lifecycle">
      {state === 'running' && t.roundEndsAt && <p className="text-muted">Round {t.currentRound} ends {new Date(t.roundEndsAt).toLocaleString()}</p>}
      {state === 'draft' && isOrganiser && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => openRegistration(t.id))}>Open registration</button>
      )}
      {/* The database state, not the clock: a lapsed deadline reads as closed but only close_registration moves it on. */}
      {t.state === 'registration' && isOrganiser && (
        <>
          <button type="button" className="btn btn-primary" disabled={busy || active < 2} onClick={() => void run(() => closeRegistration(t.id))}>
            {state === 'closed' ? 'Close registration (deadline passed)' : 'Close registration'}
          </button>
          {active < 2 && <span className="text-muted">At least two players are needed</span>}
        </>
      )}
      {t.state === 'closed' && <button type="button" className="btn btn-primary" disabled={busy} onClick={onPreview}>Start round 1</button>}
      {state === 'running' && !last && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onPreview}>
          {unsettled > 0 ? `Progress anyway (${unsettled} unsettled)` : 'Progress bracket round'}
        </button>
      )}
      {last && unsettled > 0 && <p className="text-muted">The last round is under way; finish once every result counts.</p>}
      {last && unsettled === 0 && isOrganiser && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => finishTournament(t.id))}>Finish tournament</button>
      )}
    </div>
  );
}
