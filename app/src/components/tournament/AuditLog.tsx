import { useEffect, useState } from 'react';
import { AUDIT_LIMIT, listAudit, type AuditRow, type Pairing } from '../../lib/tournaments';
import { messageOf } from './hostRun';
import { playerName } from './playerName';

const ACTIONS: Record<string, string> = {
  create: 'Created the tournament', update: 'Edited the details', open_registration: 'Opened registration',
  close_registration: 'Closed registration', cancel: 'Cancelled the tournament', grant_judge: 'Appointed a judge',
  revoke_judge: 'Removed a judge', start_round: 'Started a round', settle_pairing: 'Settled a game',
  drop_out: 'A player dropped out', remove_player: 'Removed a player', finish: 'Finished the tournament',
};

type D = Record<string, unknown>;
const num = (v: unknown): v is number => typeof v === 'number';

/** Plain words for the values that matter; never a raw id. */
function detailOf(action: string, raw: unknown, names: ReadonlyMap<string, string>, pairings: readonly Pairing[]): string {
  const d: D = raw && typeof raw === 'object' ? (raw as D) : {};
  const who = (v: unknown) => (typeof v === 'string' ? playerName(names, v) : null);
  const out: (string | null | false)[] = [];
  if (num(d.round)) out.push(`round ${d.round}`);
  const game = action === 'settle_pairing' ? pairings.find((p) => p.id === d.pairing) : undefined;
  if (game) out.push(`round ${game.round} table ${game.tableNo}: ${playerName(names, game.playerA)} vs ${game.playerB ? playerName(names, game.playerB) : 'a bye'}`);
  if (d.forced === true) out.push(`forced (${num(d.unsettled) ? d.unsettled : 'some'} unsettled)`);
  if (d.override === true) out.push('override');
  if (num(d.score_a) && num(d.score_b)) out.push(`${d.score_a}–${d.score_b}`);
  if (num(d.was_score_a) && num(d.was_score_b)) out.push(`was ${d.was_score_a}–${d.was_score_b}`);
  if (action === 'grant_judge' || action === 'revoke_judge') out.push(who(d.user));
  if (action === 'remove_player' || action === 'drop_out') out.push(who(d.player));
  if (typeof d.reason === 'string' && d.reason) out.push(`reason: ${d.reason}`);
  if (typeof d.note === 'string' && d.note) out.push(`note: ${d.note}`);
  return out.filter(Boolean).join(', ');
}

/** Collapsed until asked for; the newest 50 rows (the reader caps and orders them), read lazily and refreshed when the pairings change. */
export function AuditLog({ tournamentId, names, pairings, busy }: { tournamentId: string; names: ReadonlyMap<string, string>; pairings: readonly Pairing[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A game or round changing is what writes audit rows; refetch then, keeping the rows on screen.
  const sig = pairings.map((p) => `${p.id}${p.state}`).join();
  useEffect(() => { setRows(null); }, [tournamentId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    listAudit(tournamentId)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(messageOf(e)));
    return () => { live = false; };
  }, [open, tournamentId, sig]);

  return (
    <section className="host-section" aria-label="Audit">
      <button type="button" className="btn" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>Audit log</button>
      {open && !rows && !error && <p className="text-muted">Loading…</p>}
      {open && error && <p className="friend-notice" role="alert">{error}</p>}
      {open && rows && rows.length === 0 && <p className="text-muted">Nothing recorded yet</p>}
      {open && rows && (
        <ul className="host-list max-h-80 overflow-y-auto" tabIndex={0} aria-label="Audit entries">
          {rows.map((r) => {
            const detail = detailOf(r.action, r.detail, names, pairings);
            return (
              <li key={r.id} data-testid="audit-row">
                {(r.actorId ? playerName(names, r.actorId) : 'System')} · {ACTIONS[r.action] ?? r.action}{detail && ` (${detail})`} · {new Date(r.createdAt).toLocaleString()}
              </li>
            );
          })}
        </ul>
      )}
      {open && rows && rows.length >= AUDIT_LIMIT && <p className="text-muted">Showing the newest {AUDIT_LIMIT} entries.</p>}
    </section>
  );
}
