import { supabase } from './supabase';

/**
 * Calls `onChange` (coalesced over `debounceMs`) whenever any row the viewer can see changes in one of `tables`.
 *
 * One Realtime channel for the whole list and no row filter: Realtime applies the subscriber's RLS, so this is one
 * subscription however many conversations, offers or tournaments someone has — the cost the chat dock's per-channel
 * design avoided. The payload is ignored on purpose; callers refetch their joined view through RLS. A DELETE carries
 * only the key and is not RLS-filtered, so it is just a nudge to refetch.
 *
 * Callers keep a slow poll as well: a dropped socket must only make things late, never stale for good.
 */
export function subscribeToTables(tables: readonly string[], onChange: () => void, debounceMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nudge = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  const sub = supabase.channel(`live:${tables.join(',')}:${crypto.randomUUID()}`);
  for (const table of tables) sub.on('postgres_changes', { event: '*', schema: 'public', table }, nudge);
  sub.subscribe();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    void supabase.removeChannel(sub);
  };
}
