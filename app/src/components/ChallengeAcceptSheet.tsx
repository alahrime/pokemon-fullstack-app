import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LeagueId } from '../lib/types';
import type { StoredMember } from '../lib/teamCodec';
import { ChallengeTeam, emptySlots, filledTeam, type Slots } from './ChallengeTeam';

/**
 * The team you bring to a challenge you are accepting: picked from your saved teams or built here (and saveable
 * from here), and `size` Pokémon exactly, which is what the proposer's roster demands. Accept stays off until the
 * slots are full; a refusal from the server is shown and leaves the sheet open.
 */
export function ChallengeAcceptSheet({ league, size, onAccept, onClose }: {
  league: LeagueId; size: number; onAccept: (team: StoredMember[]) => Promise<void>; onClose: () => void;
}) {
  const [slots, setSlots] = useState<Slots>(() => emptySlots(size));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = filledTeam(slots);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-scrim') && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function accept() {
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(team);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="challenge-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="challenge-sheet is-narrow panel chamfer-9" role="dialog" aria-modal="true" aria-label="Accept challenge">
        <div className="challenge-sheet-head">
          <div className="hud-label">Accept · choose your {size}</div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close dialog" onClick={onClose}>✕</button>
        </div>
        <ChallengeTeam league={league} size={size} slots={slots} onChange={setSlots} />
        {error && <p className="friend-notice" role="alert">{error}</p>}
        <div className="challenge-sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!team || busy} onClick={() => void accept()}>Accept with this team</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
