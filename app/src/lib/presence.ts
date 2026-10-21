import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { joinShared } from './realtime';

/**
 * Who is signed in right now, from Supabase Realtime Presence. Presence is
 * the only source: a trainer who is not in the presence state is *unknown*,
 * never "offline" — the socket may simply not have synced yet.
 *
 * `match` is self-declared: a client is "in a match" while it has an
 * unsettled match open (`holdMatchPresence`). Several tabs of one trainer
 * share a key, so any one of them in a match makes the trainer "in a match".
 */
export type PresenceStatus = 'online' | 'match';

/** One channel for everyone signed in. ponytail: any signed-in client can join and see who is online; private channels with realtime RLS if that must be friends-only. */
const TOPIC = 'presence:trainers';

let snapshot: ReadonlyMap<string, PresenceStatus> = new Map();
const listeners = new Set<() => void>();
let sub: RealtimeChannel | null = null;
let matchHolds = 0;

/** Presence state (key → that key's metas, one per tab) folded to one status per trainer. */
export function statusesFrom(state: Record<string, readonly { status?: unknown }[]>): Map<string, PresenceStatus> {
  const out = new Map<string, PresenceStatus>();
  for (const [id, metas] of Object.entries(state)) {
    if (metas.length === 0) continue;
    out.set(id, metas.some((m) => m.status === 'match') ? 'match' : 'online');
  }
  return out;
}

function emit(next: ReadonlyMap<string, PresenceStatus>) {
  snapshot = next;
  for (const l of listeners) l();
}

function track() {
  if (sub?.state === 'joined') void sub.track({ status: matchHolds > 0 ? 'match' : 'online' });
}

/** Joins presence as `me`; returns the leave. Mounted once, keyed on the signed-in user. */
export function joinPresence(me: string): () => void {
  const { ch, leave } = joinShared(
    `${TOPIC}:${me}`,
    (emit) => {
      const c = supabase.channel(TOPIC, { config: { presence: { key: me } } });
      c.on('presence', { event: 'sync' }, () => emit('sync', c.presenceState()))
        .subscribe((status: string) => { if (status === 'SUBSCRIBED') { sub = c; track(); } });
      return c;
    },
    (_event, state) => emit(statusesFrom(state as Record<string, { status?: unknown }[]>)),
  );
  sub = ch;
  // A remount within the leave's grace tick reuses a joined channel that will not sync again by itself.
  if (ch.state === 'joined') emit(statusesFrom(ch.presenceState<{ status?: unknown }>()));
  return () => {
    leave();
    emit(new Map());
  };
}

/** While held, this client reports "in a match". Returns the release; idempotent. */
export function holdMatchPresence(): () => void {
  matchHolds++;
  track();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    matchHolds--;
    track();
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** A trainer's status, or undefined when presence does not know them. */
export function usePresence(id: string | null | undefined): PresenceStatus | undefined {
  return useSyncExternalStore(subscribe, () => (id ? snapshot.get(id) : undefined));
}
