import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { SpeciesSearch } from './SpeciesSearch';
import { MonTile } from './MonTile';
import { SegGroup, SegButton } from './Seg';
import { displayName } from '../lib/data';
import { FAVORITES, MAX_LEVEL, SPECIALTIES, loadTrainers, saveProfile, trainerUrl, type Profile, type ProfileEdit } from '../lib/profile';
import type { LeagueId } from '../lib/types';

const LEAGUES: { id: LeagueId | null; label: string }[] = [
  { id: null, label: 'None' }, { id: 'great', label: 'Great' }, { id: 'ultra', label: 'Ultra' }, { id: 'master', label: 'Master' },
];
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,\s]/g, '')));

/** The owner's editor for their trainer card. An overlay (portal, like the add-Pokémon modal) so the page stays put. */
export function ProfileEditor({ id, profile, onSaved, onClose }: {
  id: string; profile: Profile; onSaved: (p: ProfileEdit) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProfileEdit>({
    avatar: profile.avatar, region: profile.region, trainerLevel: profile.trainerLevel, xp: profile.xp,
    favoritePokemon: profile.favoritePokemon, favoriteLeague: profile.favoriteLeague, faction: profile.faction, specialty: profile.specialty,
    pinnedTrophies: profile.pinnedTrophies,
  });
  const [level, setLevel] = useState(profile.trainerLevel?.toString() ?? '');
  const [xp, setXp] = useState(profile.xp?.toString() ?? '');
  const [trainers, setTrainers] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const set = (p: Partial<ProfileEdit>) => setDraft((d) => ({ ...d, ...p }));

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (trainers ?? []).filter((t) => !q || t.includes(q));
  }, [trainers, filter]);

  const addFavorite = (ref: string) => {
    if (!ref || draft.favoritePokemon.length >= FAVORITES || draft.favoritePokemon.includes(ref)) return;
    set({ favoritePokemon: [...draft.favoritePokemon, ref] });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trainerLevel = num(level), xpN = num(xp);
    if (trainerLevel !== null && !(Number.isInteger(trainerLevel) && trainerLevel >= 1 && trainerLevel <= MAX_LEVEL)) return setError(`Trainer level is a whole number from 1 to ${MAX_LEVEL}.`);
    if (xpN !== null && !(Number.isInteger(xpN) && xpN >= 0 && xpN <= 99_999_999_999)) return setError('XP is a whole number, 0 or more.');
    const next = { ...draft, trainerLevel, xp: xpN };
    setBusy(true); setError('');
    try { await saveProfile(id, next); onSaved(next); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel profile-editor" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit profile" onSubmit={submit}>
        <div className="modal-head">
          <span className="hud-label">Edit trainer card</span>
          <button type="button" className="btn btn-sm py-0.5 px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <section className="profile-editor-avatar" aria-label="Avatar">
            <div className="profile-avatar-sm">
              {draft.avatar ? <img src={trainerUrl(draft.avatar)} alt="" width={80} height={80} /> : <span aria-hidden="true">?</span>}
            </div>
            <div className="profile-editor-avatar-ctl">
              <span className="hud-label">Avatar</span>
              <div className="profile-editor-row">
                <button type="button" className="btn btn-secondary" aria-expanded={trainers !== null}
                  onClick={() => (trainers ? setTrainers(null) : void loadTrainers().then(setTrainers))}>
                  {trainers ? 'Done choosing' : 'Choose a trainer'}
                </button>
                {draft.avatar && <button type="button" className="btn btn-ghost" onClick={() => set({ avatar: null })}>Remove</button>}
              </div>
            </div>
          </section>
          {trainers && (
            <div className="profile-trainers">
              <input className="input" type="search" placeholder={`Filter ${trainers.length} trainers…`} aria-label="Filter trainers"
                value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="profile-trainer-grid" role="listbox" aria-label="Trainer sprites">
                {shown.map((t) => (
                  <button key={t} type="button" role="option" aria-selected={draft.avatar === t} title={t}
                    className={`profile-trainer${draft.avatar === t ? ' is-active' : ''}`} onClick={() => set({ avatar: t })}>
                    <img src={trainerUrl(t)} alt={t} loading="lazy" width={64} height={64} />
                  </button>
                ))}
                {shown.length === 0 && <p className="text-muted">No trainer matches “{filter}”.</p>}
              </div>
            </div>
          )}

          <div className="profile-editor-grid">
            <label className="profile-field"><span className="hud-label">Area</span>
              <input className="input" maxLength={60} placeholder="North Carolina" value={draft.region ?? ''} onChange={(e) => set({ region: e.target.value })} /></label>
            <label className="profile-field"><span className="hud-label">Trainer level</span>
              <input className="input numeric" inputMode="numeric" placeholder={`1–${MAX_LEVEL}`} value={level} onChange={(e) => setLevel(e.target.value)} /></label>
            <label className="profile-field"><span className="hud-label">Total XP</span>
              <input className="input numeric" inputMode="numeric" placeholder="110,811,553" value={xp} onChange={(e) => setXp(e.target.value)} /></label>
            <label className="profile-field"><span className="hud-label">Faction</span>
              <input className="input" maxLength={40} placeholder="Your team or community" value={draft.faction ?? ''} onChange={(e) => set({ faction: e.target.value })} /></label>
            <label className="profile-field"><span className="hud-label">Role</span>
              <input className="input" maxLength={40} list="profile-specialties" placeholder="Ultra League Specialist" value={draft.specialty ?? ''} onChange={(e) => set({ specialty: e.target.value })} />
              <datalist id="profile-specialties">{SPECIALTIES.map((s) => <option key={s} value={s} />)}</datalist></label>
            <div className="profile-field"><span className="hud-label">Favourite league</span>
              <SegGroup>
                {LEAGUES.map((l) => <SegButton key={l.label} active={draft.favoriteLeague === l.id} onClick={() => set({ favoriteLeague: l.id })}>{l.label}</SegButton>)}
              </SegGroup></div>
          </div>

          <section className="profile-field" aria-label="Favourite Pokémon">
            <span className="hud-label">Favourite Pokémon · {draft.favoritePokemon.length}/{FAVORITES}</span>
            <ol className="profile-six profile-six-edit">
              {Array.from({ length: FAVORITES }, (_, i) => {
                const ref = draft.favoritePokemon[i];
                return (
                  <li key={ref ?? `empty-${i}`} className={ref ? '' : 'is-empty'}>
                    {ref ? (<>
                      <MonTile refId={ref} label={displayName(ref)} size={56} />
                      <button type="button" className="btn btn-ghost profile-six-remove" aria-label={`Remove ${displayName(ref)}`}
                        onClick={() => set({ favoritePokemon: draft.favoritePokemon.filter((r) => r !== ref) })}>✕</button>
                    </>) : <span aria-hidden="true">{i + 1}</span>}
                  </li>
                );
              })}
            </ol>
            {draft.favoritePokemon.length < FAVORITES && (
              <div className="modal-search">
                <SpeciesSearch id="profile-favorite" value="" startEmpty includeShowcase onChange={addFavorite} placeholder="Add a favourite…" />
              </div>
            )}
          </section>
          {error && <p className="friend-notice" role="alert">{error}</p>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
