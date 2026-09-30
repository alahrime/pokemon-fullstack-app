import { useEffect, useState } from 'react';
import { listAudit, type AuditRow } from '../../lib/tournaments';
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
function detailOf(action: string, raw: unknown, names: ReadonlyMap<string, string>): string {
  const d: D = raw && typeof raw === 'object' ? (raw as D) : {};
  const who = (v: unknown) => (typeof v === 'string' ? playerName(names, v) : null);
  const out: (string | null | false)[] = [];
  if (num(d.round)) out.push(`round ${d.round}`);
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

/** Collapsed until asked for; the last 50 rows, newest first, read lazily. */
export function AuditLog({ tournamentId, names, busy }: { tournamentId: string; names: ReadonlyMap<string, string>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    setError(null);
    listAudit(tournamentId)
      .then((r) => live && setRows(r.slice(-50).reverse()))
      .catch((e) => live && setError(messageOf(e)));
    return () => { live = false; };
  }, [open, tournamentId]);

  return (
    <section className="host-section" aria-label="Audit">
      <button type="button" className="btn" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>Audit log</button>
      {open && !rows && !error && <p className="text-muted">Loading…</p>}
      {open && error && <p className="friend-notice" role="alert">{error}</p>}
      {open && rows && rows.length === 0 && <p className="text-muted">Nothing recorded yet</p>}
      {open && rows && (
        <ul className="host-list">
          {rows.map((r) => {
            const detail = detailOf(r.action, r.detail, names);
            return (
              <li key={r.id} data-testid="audit-row">
                {(r.actorId ? playerName(names, r.actorId) : 'System')} · {ACTIONS[r.action] ?? r.action}{detail && ` (${detail})`} · {new Date(r.createdAt).toLocaleString()}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
