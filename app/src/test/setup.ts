import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * Realtime opens a websocket, and the providers that subscribe are mounted by most screen tests against a client
 * pointed at a fake URL. Stubbed to a no-op here; `realtime.test.ts` tests the real one and the provider tests
 * override this to fire changes by hand.
 */
// Shared channels never join in tests: no presence dots, no typing pings, unless a test wires its own.
vi.mock('../lib/realtime', () => ({ subscribeToTables: () => () => {}, joinShared: () => ({ ch: { state: 'closed', presenceState: () => ({}) }, leave: () => {} }) }));

/**
 * jsdom does not implement layout, so anything that measures returns zeros.
 * Components here read `getBoundingClientRect` for tilt, drag edges and
 * marker placement; stubbing it to a plausible box keeps those paths
 * exercisable rather than silently short-circuiting on a 0x0 rect.
 */
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, toJSON: () => ({}) };
};

// Used by the card tilt and the board auto-scroll.
window.scrollTo = () => {};
window.scrollBy = () => {};
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

/**
 * jsdom implements no pointer capture. The IV track uses it so a drag survives
 * leaving the element, which is correct behaviour — the environment simply has
 * no such concept, so it is stubbed rather than removed from the component.
 */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}


/**
 * A seeded Math.random, so a suite that now depends on randomness is still
 * reproducible.
 *
 * The battle screen opens on a random matchup and the search offers a random
 * draw when empty. Both are rolled at module load, before any test body runs,
 * so a spy installed inside a test would be too late — it has to be here.
 * mulberry32: three lines, uniform enough, and identical on every run.
 */
let seed = 0x9e3779b9;
Math.random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * The Supabase client, stubbed for the whole suite.
 *
 * `App` mounts `SessionProvider` at the root, so every test that renders the
 * app would otherwise construct a real client and call `getSession()` — a live
 * fetch at 127.0.0.1:54321. That makes the suite behave differently depending
 * on whether the local database happens to be running, which is the definition
 * of a flaky test. Files that test the client or the session (`supabase.test.ts`,
 * `session.test.tsx`, `sign-in.test.tsx`) declare their own `vi.mock` for this
 * package, and a file-level mock takes precedence over this one.
 */
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    __stub: true,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));

import { beforeEach } from 'vitest';
// The screen is mirrored into location.hash, and jsdom's window outlives a
// test: without this the next test would start on the last one's screen.
beforeEach(() => { window.location.hash = ''; });
