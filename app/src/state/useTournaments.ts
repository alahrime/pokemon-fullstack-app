import { useEffect, useState } from 'react';
import { listTournaments, type Tournament } from '../lib/tournaments';

const POLL_MS = 30_000;

/** Polled like `useBadges`: a failed read leaves the last answer. `null` until the first one. */
export function useTournaments(): { tournaments: Tournament[] | null; failed: boolean; reload: () => void } {
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
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
  }, [tick]);

  return { tournaments, failed, reload: () => setTick((n) => n + 1) };
}
