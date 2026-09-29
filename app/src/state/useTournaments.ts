import { useEffect, useState } from 'react';
import { listTournaments, type Tournament } from '../lib/tournaments';
import { useSession } from './SessionContext';

const POLL_MS = 30_000;

/**
 * Polled like `useBadges`: a failed read leaves the last answer; `null` until
 * the first one. The data is authenticated-only, so nothing is read while
 * signed out, and signing in re-reads at once (the effect is keyed on the id).
 */
export function useTournaments(): { tournaments: Tournament[] | null; failed: boolean } {
  const { user } = useSession();
  const uid = user?.id ?? null;
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTournaments(null);
    setFailed(false);
    if (!uid) return;
    let live = true;
    const load = () =>
      void listTournaments()
        .then((t) => live && (setTournaments(t), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [uid]);

  return { tournaments, failed };
}
