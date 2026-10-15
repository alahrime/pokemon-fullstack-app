import { useSyncExternalStore } from 'react';

/**
 * Phones: the Report's one-column breakpoint. Screens that lay out differently
 * there (compact roster rows, a pinned action bar, paired match rows) choose in
 * JS from this one query, so each control renders once rather than twice with
 * CSS hiding a copy. Live: crossing the width re-renders.
 */
const PHONE = '(max-width: 820px)';

export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
