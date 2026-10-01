import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../state/AppState';
import { useChatDockRequest } from '../state/ChatDockContext';
import { createChallenge, declineChallenge } from '../lib/challenges';
import { openDm } from '../lib/channels';
import { LEAGUES } from '../lib/data';
import { listServerFormats, type SavedFormat } from '../lib/saves';
import { resolvePool, validateTeam } from '../rules';
import { describeViolation } from '../tournament/roster';
import type { LeagueId } from '../lib/types';
import { ChallengeTeam, emptySlots, filledTeam, type Slots } from './ChallengeTeam';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Propose a match to one person: a league, one of YOUR saved server formats
 * for it, a team of that format's size (loaded from your saved teams or built here, and saveable from here), and when. Sending
 * creates the challenge, opens (or finds) the DM with the target and asks the
 * dock to open it, where the challenge card lives. Any of your own formats will do,
 * private or not — the target can read the one you challenge on. A refusal
 * (a past time, someone no longer challengeable) is shown here and leaves the sheet open to fix.
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
  const [league, setLeague] = useState<LeagueId>(defaultLeague ?? state.league);
  const [formats, setFormats] = useState<SavedFormat[] | null>(null);
  const [formatId, setFormatId] = useState('');
  const [slots, setSlots] = useState<Slots>([]);
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLSelectElement>(null);

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

  const leagueFormats = (formats ?? []).filter((f) => f.format.base === league);
  const format = leagueFormats.find((f) => f.id === formatId);
  const size = format?.format.composition.size;

  // A new slot count is a different team; a different format of the same size keeps what was built.
  useEffect(() => setSlots(size ? emptySlots(size) : []), [size]);

  const restrictTo = useMemo(() => {
    try { return format ? new Set(resolvePool(format.format).legal) : undefined; } catch { return undefined; }
  }, [format]);
  const team = filledTeam(slots);
  const problems = useMemo(() => {
    if (!format || !team) return [];
    try {
      return validateTeam(team.map((m) => ({ ref: m.ref, fast: m.fast_move, charges: m.charge_moves })), format.format).violations.map(describeViolation);
    } catch { return []; }
  }, [format, team]);
  const ready = !!format && !!team && problems.length === 0 && (!scheduled || when !== '') && !busy;

  async function send() {
    if (!format || !team || !ready) return;
    setBusy(true);
    setError(null);
    let created = false;
    try {
      await createChallenge({
        targetId: target.id,
        league,
        formatVersionId: format.versionId,
        format: format.format,
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
              <label htmlFor="challenge-league">League</label>
              <select
                id="challenge-league"
                ref={firstRef}
                className="input"
                value={league}
                onChange={(e) => {
                  setLeague(e.target.value as LeagueId);
                  setFormatId('');
                }}
              >
                {LEAGUES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="challenge-format">Format</label>
              <select id="challenge-format" className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                <option value="">Choose a format</option>
                {leagueFormats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              {formats && leagueFormats.length === 0 && (
                <p className="text-muted">No saved formats for this league — save one on the Formats screen.</p>
              )}
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
