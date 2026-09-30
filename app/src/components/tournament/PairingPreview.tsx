import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Pairing as SwissPairing } from '../../tournament/swiss';
import { playerName } from './playerName';

export interface Preview { round: number; pairs: SwissPairing[]; rematches: number; repeatBye: boolean; unsettled: number }

interface Props {
  preview: Preview; changed: boolean; names: ReadonlyMap<string, string>; busy: boolean; error: string | null;
  onConfirm: (override: boolean) => void; onClose: () => void;
}

/** The proposed pairings, before anything is sent. Rematches or a repeated bye need an explicit tick. */
export function PairingPreview({ preview, changed, names, busy, error, onConfirm, onClose }: Props) {
  const { round, pairs, rematches, repeatBye, unsettled } = preview;
  const needsOverride = rematches > 0 || repeatBye;
  const [override, setOverride] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dismiss = () => { if (!busy) onClose(); };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  const who = (id: string) => playerName(names, id);
  // Portalled to <body>: the screen wrapper keeps a transform, which would make it this
  // fixed backdrop's containing block (see AddPokemonModal).
  return createPortal(
    <div className="challenge-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="challenge-sheet panel chamfer-9" role="dialog" aria-modal="true" aria-label={`Round ${round} pairings`}>
        <div className="hud-label">Round {round} pairings</div>
        {changed && <p className="friend-notice" role="status">The field changed — please review the new pairings</p>}
        <ol className="host-pairs">
          {pairs.map((p, i) => (
            <li key={p.a}>{p.b ? `Table ${i + 1}: ${who(p.a)} vs ${who(p.b)}` : `${who(p.a)} has a bye`}</li>
          ))}
        </ol>
        {needsOverride && (
          <>
            <p className="text-muted">
              {[rematches > 0 && `${rematches} ${rematches === 1 ? 'rematch' : 'rematches'}`, repeatBye && 'a repeated bye']
                .filter(Boolean).join(' and ')} could not be avoided.
            </p>
            <label className="tournament-check">
              <input type="checkbox" checked={override} disabled={busy} onChange={(e) => setOverride(e.target.checked)} />
              Allow rematches / repeat bye
            </label>
          </>
        )}
        {unsettled > 0 && <p className="text-muted">{unsettled} unsettled from the previous round will be forfeited from the count.</p>}
        {error && <p className="friend-notice" role="alert">{error}</p>}
        <div className="challenge-sheet-actions">
          <button ref={cancelRef} type="button" className="btn" disabled={busy} onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || (needsOverride && !override)} onClick={() => onConfirm(needsOverride && override)}>
            Confirm round {round}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
