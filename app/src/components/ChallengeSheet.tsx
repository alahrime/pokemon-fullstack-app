import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../state/AppState';
import { useChatDockRequest } from '../state/ChatDockContext';
import { createChallenge, declineChallenge } from '../lib/challenges';
import { openDm } from '../lib/channels';
import { listServerFormats, type SavedFormat } from '../lib/saves';
import { pickableFor } from '../lib/data';
import { PRESET_FORMATS, versionFor, withTeamSize, type PresetFormat } from '../lib/presetFormats';
import { LeagueSelect, type LeagueOption } from './LeagueSelect';
import { resolvePool, rulesHash, validateTeam, type Format } from '../rules';
import { describeViolation } from '../tournament/roster';
import type { LeagueId } from '../lib/types';
import { ChallengeTeam, emptySlots, filledTeam, type Slots } from './ChallengeTeam';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Propose a match to one person: a format, a team of that format's size, and when. The format starts on the plain
 * league, so the team can be built straight away; the standard cups and your own saved formats are one select away.
 * A cup you have not used before is saved to your formats when you send (see `versionFor`). The team is loaded from
 * your saved teams or built slot by slot, and can be saved from here. Sending creates the challenge, opens (or
 * finds) the DM with the target and asks the dock to open it, where the challenge card lives. A refusal (a past
 * time, someone no longer challengeable) is shown here and leaves the sheet open to fix.
 *
 * `counterOf` turns it into a counter: `target` is the person who challenged you, the league starts at theirs,
 * and once your challenge exists the one you are answering is declined. Create first, decline second, so a
 * refusal of your new terms leaves their challenge open to accept or decline as before.
 */
export function ChallengeSheet({
  target,
  onClose,
  counterOf,
  defaultLeague,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  counterOf?: string;
  defaultLeague?: LeagueId;
}) {
  const { state } = useAppState();
  const { requestChannel } = useChatDockRequest();
  const [formats, setFormats] = useState<SavedFormat[] | null>(null);
  // A plain league is always there to start from, so the team can be built before anything else is decided.
  const [choiceKey, setChoiceKey] = useState(`preset:${defaultLeague ?? state.league}`);
  // null: the format's own size. GBL is 3, Show 6 is six on the roster and three brought.
  const [sizePick, setSizePick] = useState<3 | 6 | null>(null);
  const [presetHashes, setPresetHashes] = useState<ReadonlySet<string>>(new Set());
  const [slots, setSlots] = useState<Slots>([]);
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Pokémon editor (a .modal-scrim) closes itself on Escape; the sheet stays.
      if (e.key === 'Escape' && !document.querySelector('.modal-scrim')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus moves in on mount and returns to the opener on unmount (the
  // AddPokemonModal pattern; it has no Tab trap, so neither does this).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let live = true;
    listServerFormats()
      .then((fs) => live && setFormats(fs))
      .catch((e) => live && (setFormats([]), setError(messageOf(e))));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all(PRESET_FORMATS.map((p) => rulesHash(p.format))).then((hs) => live && setPresetHashes(new Set(hs)));
    return () => { live = false; };
  }, []);

  // Cups first; then your own formats, minus any that are just a copy of a cup.
  const own = (formats ?? []).filter((f) => !presetHashes.has(f.rulesHash));
  const picked: { name: string; format: Format; saved?: SavedFormat; preset?: PresetFormat } | undefined = choiceKey.startsWith('preset:')
    ? PRESET_FORMATS.filter((p) => `preset:${p.key}` === choiceKey).map((p) => ({ name: p.name, format: p.format, preset: p }))[0]
    : own.filter((f) => f.id === choiceKey).map((f) => ({ name: f.name, format: f.format, saved: f }))[0];
  const ownSize = picked?.format.composition.size;
  const wantSize = sizePick ?? (ownSize === 6 ? 6 : 3);
  // Changing the size changes the rules, so it is a different format: saved under its own name on send.
  const resized = !!picked && ownSize !== wantSize && (wantSize === 3 || wantSize === 6);
  const choice = picked && resized
    ? { name: `${picked.name} · ${wantSize === 6 ? 'Show 6' : 'GBL'}`, format: withTeamSize(picked.format, wantSize as 3 | 6) }
    : picked;
  const format = choice?.format;
  const league: LeagueId = format?.base ?? state.league;
  const size = format?.composition.size;

  const formatOptions: LeagueOption[] = [
    ...PRESET_FORMATS.map((p) => ({
      value: `preset:${p.key}`, label: p.name, league: p.base, types: p.cup.include?.types, palette: p.palette, group: 'Standard',
      note: p.base === 'master' ? 'No cap' : `${p.base === 'great' ? 1500 : 2500} CP`,
    })),
    ...own.map((f) => ({ value: f.id, label: f.name, league: f.format.base, group: 'Your formats' })),
  ];

  // A new slot count is a different team; a different format of the same size keeps what was built.
  useEffect(() => setSlots(size ? emptySlots(size) : []), [size]);

  // A plain league has no rules of its own to enforce, so anything pickable (no Megas, as in GBL) may be brought; a cup's pool binds.
  const restricted = !!format && (format.pool.length > 0 || (format.start ?? 'league') !== 'league');
  const restrictTo = useMemo(() => {
    if (!format) return undefined;
    try { return new Set(restricted ? resolvePool(format).legal : pickableFor(format.base)); } catch { return undefined; }
  }, [format, restricted]);
  const team = filledTeam(slots);
  const problems = useMemo(() => {
    if (!format || !team || !restricted) return [];
    try {
      return validateTeam(team.map((m) => ({ ref: m.ref, fast: m.fast_move, charges: m.charge_moves })), format).violations.map(describeViolation);
    } catch { return []; }
  }, [format, team, restricted]);
  // `formats` settled first, or a cup would be saved a second time next to the copy still loading.
  const ready = !!choice && formats !== null && !!team && problems.length === 0 && (!scheduled || when !== '') && !busy;

  async function send() {
    if (!choice || !format || !team || !ready) return;
    setBusy(true);
    setError(null);
    let created = false;
    try {
      const formatVersionId = (!resized && picked?.saved?.versionId) || (await versionFor(choice, formats ?? []));
      await createChallenge({
        targetId: target.id,
        league,
        formatVersionId,
        format,
        team,
        scheduledFor: scheduled ? new Date(when) : undefined,
      });
      created = true;
      setSent(true);
      if (counterOf) await declineChallenge(counterOf);
      const dmId = await openDm(target.id);
      requestChannel(dmId);
      onClose();
    } catch (e) {
      // Once the challenge exists, a retry would create a second one: keep
      // Send disabled and say so.
      setError(created ? `${counterOf ? 'Counter' : 'Challenge'} sent — couldn't ${counterOf ? 'finish up (decline theirs or open the chat)' : 'open the chat'}: ${messageOf(e)}` : messageOf(e));
      setBusy(created);
    }
  }

  // Portalled like the other sheets: a screen wrapper's transform would otherwise box the fixed backdrop and the chat dock would sit over it.
  return createPortal(
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
        aria-label={`${counterOf ? 'Counter' : 'Challenge'} ${target.name}`}
      >
        <div className="challenge-sheet-head">
          <div className="hud-label">{counterOf ? 'Counter' : 'Challenge'} {target.name}</div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close dialog" onClick={onClose}>✕</button>
        </div>

        <div className="challenge-sheet-cols">
          <div className="challenge-sheet-col">
            <div className="field">
              <label htmlFor="challenge-format">Format</label>
              <LeagueSelect
                id="challenge-format"
                label="Format"
                buttonRef={firstRef}
                value={choiceKey}
                options={formatOptions}
                onChange={(k) => { setChoiceKey(k); setSizePick(null); }}
              />
              <p className="text-muted ct-hint">
                {restricted ? 'Only Pokémon this format allows can be brought.' : 'Any Pokémon within the league can be brought.'}
              </p>
            </div>

            <div className="field">
              <span className="hud-label" id="challenge-size">Team size</span>
              <div className="form-toggle" role="group" aria-labelledby="challenge-size">
                <button type="button" className={`form-opt${wantSize === 3 ? ' is-active' : ''}`} aria-pressed={wantSize === 3} onClick={() => setSizePick(3)}>GBL · 3</button>
                <button type="button" className={`form-opt${wantSize === 6 ? ' is-active' : ''}`} aria-pressed={wantSize === 6} onClick={() => setSizePick(6)}>Show 6 · 6</button>
              </div>
              {wantSize === 6 && <p className="text-muted ct-hint">Six on the roster; three are brought to each battle.</p>}
            </div>

            <div className="field">
              <span className="hud-label" id="challenge-start">Start</span>
              <div className="form-toggle" role="group" aria-labelledby="challenge-start">
                <button type="button" className={`form-opt${scheduled ? '' : ' is-active'}`} aria-pressed={!scheduled} onClick={() => setScheduled(false)}>Now</button>
                <button type="button" className={`form-opt${scheduled ? ' is-active' : ''}`} aria-pressed={scheduled} onClick={() => setScheduled(true)}>Scheduled</button>
              </div>
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
          </div>

          <div className="challenge-sheet-col">
            <div className="hud-label">Your team{size ? ` · ${slots.filter(Boolean).length} / ${size}` : ''}</div>
            {size ? (
              <ChallengeTeam league={league} size={size} slots={slots} onChange={setSlots} restrictTo={restrictTo} />
            ) : (
              <p className="text-muted">Choose a format to see how many Pokémon it takes.</p>
            )}
            {problems.length > 0 && (
              <ul className="roster-problems">
                {problems.map((p) => <li key={p} className="roster-problem">{p}</li>)}
              </ul>
            )}
          </div>
        </div>

        {error && (
          <p className="friend-notice" role="alert">
            {error}
          </p>
        )}

        <div className="challenge-sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            {sent ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void send()}>
            {counterOf ? 'Send counter' : 'Send challenge'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
