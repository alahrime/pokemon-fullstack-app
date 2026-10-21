import type { RealtimeChannel } from '@supabase/supabase-js';
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

type Emit = (event: string, payload: unknown) => void;
interface Shared { ch: RealtimeChannel; listeners: Set<Emit>; timer?: ReturnType<typeof setTimeout> }
const shared = new Map<string, Shared>();

/**
 * One Realtime channel per topic for this whole tab, for topics that must be shared by name (broadcast, presence).
 * supabase-js hands back the existing instance for a topic it already holds, so two independent joins would subscribe
 * one instance twice (which throws) and the first leave would cut the other off. Here `create` runs once, binds its
 * events to `emit`, and every joiner's `listener` hears them; the last `leave` removes the channel.
 *
 * The removal waits a tick: StrictMode's unmount-and-remount would otherwise remove the channel the remount is about
 * to reuse, while it is still closing.
 */
export function joinShared(topic: string, create: (emit: Emit) => RealtimeChannel, listener: Emit): { ch: RealtimeChannel; leave: () => void } {
  let entry = shared.get(topic);
  if (entry) clearTimeout(entry.timer);
  else {
    const listeners = new Set<Emit>();
    entry = { ch: create((event, payload) => { for (const l of listeners) l(event, payload); }), listeners };
    shared.set(topic, entry);
  }
  const e = entry;
  e.listeners.add(listener);
  let left = false;
  return {
    ch: e.ch,
    leave: () => {
      if (left) return;
      left = true;
      e.listeners.delete(listener);
      if (e.listeners.size > 0) return;
      e.timer = setTimeout(() => {
        if (e.listeners.size > 0 || shared.get(topic) !== e) return;
        shared.delete(topic);
        void supabase.removeChannel(e.ch);
      }, 0);
    },
  };
}
