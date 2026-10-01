import { useCallback, useEffect, useState } from 'react';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { listTeams, saveTeam, type SavedTeam } from '../lib/saves';
import { decodeMember, encodeMember, type StoredMember } from '../lib/teamCodec';
import type { LeagueId } from '../lib/types';
import { AddPokemonModal, movesForChoice } from './AddPokemonModal';
import { Sprite } from './Sprite';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Slots = (StoredMember | null)[];
export const emptySlots = (size: number): Slots => Array.from({ length: size }, () => null);
export const filledTeam = (slots: Slots): StoredMember[] | null =>
  slots.length > 0 && slots.every((m) => m !== null) ? (slots as StoredMember[]) : null;

function Slot({ n, member, league, onEdit, onClear }: {
  n: number; member: StoredMember; league: LeagueId; onEdit: () => void; onClear: () => void;
}) {
  const { choice } = decodeMember(member);
  const sp = speciesOf(choice.ref);
  const moves = movesForChoice(choice, league);
  const { shadow } = parseRef(choice.ref);
  return (
    <li className="ct-slot">
      <span className="hud-label">Slot {n}</span>
      <div className="ct-slot-id">
        {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={44} shadow={shadow} />}
        <div className="min-w-0">
          <div className="ct-slot-name">{displayName(choice.ref)}</div>
          <div className="text-faint ct-slot-moves">
            {moves ? [moves.fast.name, ...moves.charges.map((c) => c.name)].join(' · ') : 'Unknown Pokémon'}
          </div>
        </div>
      </div>
      <div className="ct-chips">
        <span className="ct-chip numeric">{member.iv_attack}/{member.iv_defense}/{member.iv_stamina}</span>
        {shadow && <span className="ct-chip is-shadow">Shadow</span>}
        {member.best_buddy && <span className="ct-chip is-buddy">Best Buddy</span>}
      </div>
      <div className="ct-slot-actions">
        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Edit slot ${n}: ${displayName(choice.ref)}`} onClick={onEdit}>Edit</button>
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove slot ${n}`} onClick={onClear}>Remove</button>
      </div>
    </li>
  );
}

/**
 * The team a challenge is played with: `size` slots, each added and edited in AddPokemonModal (species search,
 * Normal/Shadow, moves incl. Return, IVs, Best Buddy). A saved team of that size and league can be loaded into
 * the slots from the dropdown and then changed freely; a full team can be saved under a name from here.
 * State lives in the parent (`slots`), so the parent decides when the team is sendable.
 */
export function ChallengeTeam({ league, size, slots, onChange, restrictTo }: {
  league: LeagueId; size: number; slots: Slots; onChange: (s: Slots) => void; restrictTo?: ReadonlySet<string>;
}) {
  const [saved, setSaved] = useState<SavedTeam[] | null>(null);
  const [loaded, setLoaded] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const savable = size === 3 || size === 6;

  const load = useCallback(() => {
    if (size !== 3 && size !== 6) return Promise.resolve();
    return listTeams(size)
      .then((ts) => setSaved(ts.filter((t) => t.league === league)))
      .catch((e) => { setSaved([]); setNote({ text: messageOf(e), bad: true }); });
  }, [size, league]);
  useEffect(() => { setSaved(null); setLoaded(''); void load(); }, [load]);

  const team = filledTeam(slots);

  function pick(id: string) {
    setLoaded(id);
    const t = saved?.find((x) => x.id === id);
    if (t) { onChange(Array.from({ length: size }, (_, i) => t.members[i] ?? null)); setName(t.name); setNote(null); }
  }

  async function save() {
    if (!team || !name.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      // Same name as the team just loaded means "update it"; any other name is a new team.
      const id = await saveTeam({ id: loaded && saved?.find((t) => t.id === loaded)?.name === name.trim() ? loaded : undefined, name: name.trim(), league, size: size as 3 | 6, members: team });
      await load();
      setLoaded(id);
      setNote({ text: `Saved “${name.trim()}”`, bad: false });
    } catch (e) {
      setNote({ text: messageOf(e), bad: true });
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, m: StoredMember | null) => onChange(slots.map((x, j) => (j === i ? m : x)));
  const open = editing !== null ? slots[editing] : null;

  return (
    <div className="ct">
      <div className="field">
        <label htmlFor="ct-saved">Saved team</label>
        <select id="ct-saved" className="input" value={loaded} onChange={(e) => pick(e.target.value)} disabled={!savable || saved === null}>
          <option value="">{saved === null && savable ? 'Loading…' : 'Load a saved team…'}</option>
          {(saved ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <p className="text-muted ct-hint">
          {saved && saved.length === 0 ? `No saved ${size}-Pokémon teams for this league. Build one below and save it.` : 'Load one, then change any slot, or build from scratch below.'}
        </p>
      </div>

      <ol className="ct-slots">
        {slots.map((m, i) => m
          ? <Slot key={i} n={i + 1} member={m} league={league} onEdit={() => setEditing(i)} onClear={() => set(i, null)} />
          : (
            <li key={i} className="ct-slot is-empty">
              <span className="hud-label">Slot {i + 1}</span>
              <button type="button" className="btn btn-secondary ct-add" onClick={() => setEditing(i)}>+ Add Pokémon</button>
            </li>
          ))}
      </ol>

      <div className="ct-save">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!slots.some(Boolean)} onClick={() => { onChange(emptySlots(size)); setLoaded(''); }}>Clear all</button>
        {savable && (
          <>
            <input className="input ct-name" aria-label="Team name" placeholder="Name this team to save it" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn btn-secondary" disabled={!team || !name.trim() || busy} onClick={() => void save()}>Save team</button>
          </>
        )}
      </div>
      {note && <p className={note.bad ? 'friend-notice' : 'text-muted'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}

      {editing !== null && (
        <AddPokemonModal
          league={league}
          restrictTo={restrictTo}
          buddy
          initial={open ? decodeMember(open).choice : undefined}
          onClose={() => setEditing(null)}
          onCommit={(choice) => set(editing, encodeMember(choice, league))}
        />
      )}
    </div>
  );
}
