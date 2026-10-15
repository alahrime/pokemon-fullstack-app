import { useSyncExternalStore } from 'react';

/**
 * Phones: the Report's one-column breakpoint. Screens that lay out differently
 * there (compact roster rows, a pinned action bar, paired match rows) choose in
 * JS from this one query, so each control renders once rather than twice with
 * CSS hiding a copy. Live: crossing the width re-renders.
 */
const PHONE = '(max-width: 820px)';

/** Live `matchMedia(query).matches`; false where there is no window (and in jsdom's stub). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const usePhone = (): boolean => useMedia(PHONE);
