import { useEffect, useMemo, useRef, useState } from 'react';
import { displayName, movesFor, speciesOf } from '../../lib/data';
import { listTeams, type SavedTeam } from '../../lib/saves';
import { registerRoster, type Tournament } from '../../lib/tournaments';
import { resolvePool, type Format } from '../../rules';
import type { LeagueId } from '../../lib/types';
import { ROSTER_SIZE, checkRoster, cpBounds, leagueCap, memberFromChoice, type RosterMember } from '../../tournament/roster';
import { AddPokemonModal } from '../AddPokemonModal';
import { RosterCard } from './RosterCard';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Base = Pick<RosterMember, 'ref' | 'fast' | 'charges'>;
interface Pending { slot: number; base: Base; cp: string; bestBuddy: boolean }
interface Queued { slot: number; base: Base }

/** What the CP field accepts: the species' ceiling, cut to the league cap. */
function cpRange(ref: string, bestBuddy: boolean, league: LeagueId): { min: number; max: number } {
  const b = cpBounds(ref, bestBuddy);
  const cap = leagueCap(league);
  return { min: b.min, max: cap === null ? b.max : Math.min(b.max, cap) };
}

const padded = (initial?: readonly RosterMember[]): (RosterMember | null)[] =>
  Array.from({ length: ROSTER_SIZE }, (_, i) => initial?.[i] ?? null);

/**
 * Six slots for a tournament roster. A member is picked in the shared
 * AddPokemonModal (its IV controls are ignored: only the species and moves are
 * taken), then given a CP and a Best Buddy flag. Save is offered only for a
 * roster `checkRoster` passes; the server checks the shape again.
 */
export function RosterForm({ tournament, format, league, initial, onSaved, onCancel }: {
  tournament: Tournament; format: Format; league: LeagueId; initial?: readonly RosterMember[];
  onSaved: () => void; onCancel: () => void;
}) {
  const [slots, setSlots] = useState(() => padded(initial));
  const [picking, setPicking] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  // An import fills this, not the slots: the old roster stays until every member has its CP.
  const [staged, setStaged] = useState<(RosterMember | null)[] | null>(null);
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const cpRef = useRef<HTMLInputElement>(null);
  const restrictTo = useMemo(() => new Set(resolvePool(format).legal), [format]);

  // Escape closes the form only when nothing inside it is open (the modal
  // handles its own Escape; reading refs makes the order of listeners moot).
  const guard = useRef({ picking, pending, busy, onCancel });
  guard.current = { picking, pending, busy, onCancel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = guard.current;
      if (e.key === 'Escape' && g.picking === null && !g.pending && !g.busy) g.onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const pendingKey = pending ? `${pending.slot}:${pending.base.ref}` : null;
  useEffect(() => {
    if (pendingKey) cpRef.current?.focus({ preventScroll: true });
  }, [pendingKey]);

  const filled = slots.filter((m): m is RosterMember => m !== null);
  const check = checkRoster(filled, format, league);
  // "exactly six" is the counter's job while slots are still empty.
  const problems = filled.length < ROSTER_SIZE ? check.problems.filter((p) => !p.startsWith('A roster is exactly')) : check.problems;
  const firstIdx = Math.max(0, slots.findIndex((x) => !x));
  const canSave = filled.length === ROSTER_SIZE && check.ok && !busy;

  function startPending(slot: number, base: Base, existing?: RosterMember | null) {
    const bestBuddy = existing?.bestBuddy ?? false;
    const r = cpRange(base.ref, bestBuddy, league);
    setPending({ slot, base, bestBuddy, cp: String(existing?.cp ?? r.max) });
  }

  function confirmPending() {
    if (!pending) return;
    const member: RosterMember = { ...pending.base, cp: Number(pending.cp), bestBuddy: pending.bestBuddy };
    const result = (staged ?? slots).map((m, i) => (i === pending.slot ? member : m));
    const [next, ...rest] = queue;
    if (next) {
      if (staged) setStaged(result);
      else setSlots(result);
      setQueue(rest);
      startPending(next.slot, next.base);
    } else {
      setSlots(result);
      setStaged(null);
      setQueue([]);
      setPending(null);
    }
  }

  function cancelPending() {
    setPending(null);
    setQueue([]);
    setStaged(null);
  }

  async function openImport() {
    setImporting(true);
    setError(null);
    try {
      setTeams((await listTeams(6)).filter((t) => t.league === league));
    } catch (e) {
      setTeams([]);
      setError(messageOf(e));
    }
  }

  function importTeam(id: string) {
    const team = teams?.find((t) => t.id === id);
    if (!team) return;
    const items = team.members.map((m, slot) => ({ slot, base: { ref: m.ref, fast: m.fast_move, charges: [...m.charge_moves] } }));
    setStaged(padded());
    setImporting(false);
    const [first, ...rest] = items;
    setQueue(rest);
    if (first) startPending(first.slot, first.base);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await registerRoster(tournament.id, filled);
      onSaved();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  const range = pending ? cpRange(pending.base.ref, pending.bestBuddy, league) : null;
  const cpNum = pending ? Number(pending.cp) : NaN;
  const cpOk = !!range && pending!.cp.trim() !== '' && Number.isInteger(cpNum) && cpNum >= range.min && cpNum <= range.max;

  const cap = leagueCap(league);
  const cpHint = !range ? '' : cpOk ? `CP must be between ${range.min} and ${range.max}`
    : !Number.isInteger(cpNum) || pending!.cp.trim() === '' ? `CP must be a whole number from ${range.min} to ${range.max}`
    : cpNum < range.min ? `CP ${cpNum} is below ${range.min}`
    : `CP ${cpNum} is over the ${range.max} ${cap === range.max ? 'cap' : 'maximum'}`;

  return (
    <div
      className="challenge-sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && picking === null && !pending) onCancel();
      }}
    >
      <div className="roster-form panel chamfer-9" role="dialog" aria-modal="true" aria-label={initial?.length ? 'Edit your six' : 'Register your six'}>
        <div className="hud-label">Your roster · {filled.length} / {ROSTER_SIZE}</div>

        <ol className="roster-slots">
          {slots.map((m, i) => (
            <li key={i} className="roster-slot">
              <span className="hud-label">Slot {i + 1}</span>
              {m ? (
                <>
                  <RosterCard member={m} />
                  <div className="roster-slot-actions">
                    <button type="button" ref={i === firstIdx ? firstRef : undefined} className="btn" disabled={busy || pending !== null}
                      aria-label={`Replace slot ${i + 1}: ${displayName(m.ref)}`} onClick={() => setPicking(i)}>Replace</button>
                    <button type="button" className="btn" disabled={busy || pending !== null}
                      onClick={() => setSlots((s) => s.map((x, j) => (j === i ? null : x)))}>Clear</button>
                  </div>
                </>
              ) : (
                <button type="button" ref={i === firstIdx ? firstRef : undefined} className="btn"
                  disabled={busy || pending !== null} onClick={() => setPicking(i)}>Add Pokémon</button>
              )}
            </li>
          ))}
        </ol>

        {pending && range && (
          <fieldset className="roster-cp-step">
            <legend>Slot {pending.slot + 1}: {displayName(pending.base.ref)}</legend>
            <div className="field">
              <label htmlFor="roster-cp">CP</label>
              <input id="roster-cp" ref={cpRef} className="input" type="number" min={range.min} max={range.max}
                value={pending.cp} aria-invalid={!cpOk} aria-describedby="roster-cp-hint"
                onChange={(e) => setPending({ ...pending, cp: e.target.value })} />
              <span id="roster-cp-hint" className={cpOk ? 'text-muted' : 'roster-problem'}>{cpHint}</span>
            </div>
            <label className="tournament-check">
              <input type="checkbox" checked={pending.bestBuddy} onChange={(e) => setPending({ ...pending, bestBuddy: e.target.checked })} />
              Best Buddy
            </label>
            <div className="roster-slot-actions">
              <button type="button" className="btn" onClick={cancelPending}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!cpOk} onClick={confirmPending}>Add to slot</button>
            </div>
          </fieldset>
        )}

        {problems.length > 0 && (
          <ul className="roster-problems">
            {problems.map((p) => <li key={p} className="roster-problem">{p}</li>)}
          </ul>
        )}

        {importing ? (
          <div className="field">
            <label htmlFor="roster-import">Saved team</label>
            <select id="roster-import" className="input" defaultValue="" onChange={(e) => importTeam(e.target.value)} disabled={teams === null}>
              <option value="">{teams === null ? 'Loading…' : 'Choose a team'}</option>
              {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {teams && teams.length === 0 && <p className="text-muted">No saved six-Pokémon teams for this league.</p>}
          </div>
        ) : (
          <button type="button" className="btn" disabled={busy || pending !== null} onClick={() => void openImport()}>
            Import a saved team
          </button>
        )}

        {error && <p className="friend-notice" role="alert">{error}</p>}

        <div className="challenge-sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void save()}>Save roster</button>
        </div>
      </div>

      {picking !== null && (
        <AddPokemonModal
          league={league}
          restrictTo={restrictTo}
          onClose={() => setPicking(null)}
          onCommit={(choice) => {
            const s = speciesOf(choice.ref);
            const withDefaults = choice.chargeIds.length || !s
              ? choice
              : { ...choice, chargeIds: movesFor(s, league).charges.map((c) => c.id) };
            startPending(picking, memberFromChoice(withDefaults, 0, false), slots[picking]);
          }}
        />
      )}
    </div>
  );
}
