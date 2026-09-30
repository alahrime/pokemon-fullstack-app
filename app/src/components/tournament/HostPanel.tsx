import { useRef, useState } from 'react';
import {
  cancelTournament, isCounted, startRound, toGames, type Entrant, type Pairing, type Tournament, type TournamentState,
} from '../../lib/tournaments';
import { pairSwiss } from '../../tournament/swiss';
import { AuditLog } from './AuditLog';
import { HostDetails } from './HostDetails';
import { HostLifecycle } from './HostLifecycle';
import { JudgePanel } from './JudgePanel';
import { NeedsAttention } from './NeedsAttention';
import { PairingPreview, type Preview } from './PairingPreview';
import { messageOf, type Run } from './hostRun';

interface Props {
  tournament: Tournament; state: TournamentState; entrants: readonly Entrant[]; pairings: readonly Pairing[];
  names: ReadonlyMap<string, string>; judges: readonly string[]; me: string | null; isOrganiser: boolean;
  now: Date; onChanged: () => void;
}

/** Organiser and judges only; everyone else gets nothing. One call runs at a time. */
export function HostPanel({ tournament: t, state, entrants, pairings, names, judges, me, isOrganiser, now, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const busyRef = useRef(false);
  if (!isOrganiser && !(me && judges.includes(me))) return null;

  const run: Run = async (fn) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const running = state === 'running';
  const current = running ? pairings.filter((p) => p.round === t.currentRound && p.playerB !== null) : [];
  const unsettled = current.filter((p) => !isCounted(p, now)).length;
  const overdue = running && !!t.roundEndsAt && now >= new Date(t.roundEndsAt);

  function openPreview() {
    setError(null);
    const active = entrants.filter((e) => !e.dropped).map((e) => e.playerId);
    // Called directly, never as a .map callback: extra arguments would land in its node budget.
    const r = pairSwiss(active, toGames(pairings, now), t.id);
    setPreview({ round: running ? t.currentRound + 1 : 1, pairs: r.pairs, rematches: r.rematches, repeatBye: r.repeatBye, unsettled });
  }

  async function confirmStart(override: boolean) {
    if (!preview) return;
    const force = preview.unsettled > 0;
    if (force && !window.confirm(`${preview.unsettled} unsettled ${preview.unsettled === 1 ? 'game is' : 'games are'} still open in round ${t.currentRound}. Start round ${preview.round} anyway?`)) return;
    if (await run(() => startRound(t.id, preview.pairs, force, override))) setPreview(null);
  }

  const over = state === 'complete' || state === 'cancelled';
  return (
    <section className="panel chamfer-9 host-panel" aria-label="Host controls">
      <div className="hud-label">Host controls</div>
      <HostLifecycle tournament={t} state={state} entrants={entrants} unsettled={unsettled} isOrganiser={isOrganiser}
        busy={busy} run={run} onPreview={openPreview} />
      {error && !preview && <p className="friend-notice" role="alert">{error}</p>}
      {overdue && unsettled > 0 && <NeedsAttention pairings={current} names={names} me={me} now={now} busy={busy} run={run} />}
      {isOrganiser && !over && (
        <JudgePanel tournamentId={t.id} organiserId={t.organiserId} state={state} entrants={entrants} judges={judges}
          names={names} busy={busy} run={run} />
      )}
      {isOrganiser && (state === 'draft' || state === 'registration') && <HostDetails tournament={t} busy={busy} run={run} />}
      <AuditLog tournamentId={t.id} names={names} busy={busy} />
      {isOrganiser && !over && (
        <section className="host-section" aria-label="Danger">
          <button type="button" className="btn" disabled={busy}
            onClick={() => {
              if (window.confirm('Cancel this tournament? Nobody can play or report any more, and this cannot be undone.')) void run(() => cancelTournament(t.id));
            }}>Cancel tournament</button>
        </section>
      )}
      {preview && (
        <PairingPreview preview={preview} names={names} busy={busy} error={error} onConfirm={(o) => void confirmStart(o)} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}
