import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, cleanup, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { SECTIONS, SCREEN_DEFS } from '../../lib/screens';

/**
 * Every way between screens, signed in and out: each section and its rail screens, Account, the home page, and
 * back/forward. A render error anywhere used to blank the whole app, so the check is that the shell is still there
 * and nothing was logged as an error after every hop.
 */

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
// Every table reads as empty, every write succeeds (combo-stress's stand-in).
function chain(): unknown {
  const r = { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (f: (v: unknown) => unknown) => Promise.resolve(r).then(f) : k === 'maybeSingle' || k === 'single' ? async () => ({ data: null, error: null }) : p),
    apply: () => p,
  });
  return p;
}

let errors: string[];
async function mountApp(signedIn: boolean) {
  const session = signedIn ? ({ access_token: 't', user: { id: 'user-1', email: 'ash@example.com' } } as unknown as Session) : null;
  pkg.client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => chain(),
    rpc: () => chain(),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
  vi.resetModules();
  const App = (await import('../../App')).default;
  let view!: RenderResult;
  await act(async () => { view = render(<App />); });
  return view;
}

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    const t = a.map(String).join(' ');
    if (!/suspended resource finished loading/.test(t)) errors.push(t.slice(0, 400));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The places a person can go from the top bar and the section rails. */
const label = (id: string) => SCREEN_DEFS.find((d) => d.id === id)!.label;
const RAIL = SECTIONS.flatMap((s) => s.screens.filter((id) => id !== 'match' && id !== 'player').map((id) => ({ section: s.id, id })));

async function hop(c: HTMLElement, to: { section?: string; id?: string; account?: boolean; home?: boolean }, trail: string[]) {
  const where = to.account ? 'account' : to.home ? 'home' : `${to.section}/${to.id ?? '(section)'}`;
  trail.push(where);
  await act(async () => {
    if (to.account) fireEvent.click(c.querySelector('.nav-account')!);
    else if (to.home) fireEvent.click(c.querySelector('.nav-brand')!);
    else fireEvent.click(c.querySelector(`.nav-section[data-section="${to.section}"]`)!);
  });
  if (to.id) {
    // The section's rail renders after the section click commits.
    const tab = [...c.querySelectorAll('.nav-tab')].find((t) => t.textContent?.includes(label(to.id!)));
    expect(tab, `no rail tab for ${to.id}`).toBeTruthy();
    await act(async () => { fireEvent.click(tab!); });
  }
  // Lazy screens: wait for the real screen, not its "Loading…" fallback, so the hop is actually exercised.
  for (let i = 0; i < 200 && c.querySelector('.lazy-fallback'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  expect(c.querySelector('.lazy-fallback'), `still loading after ${trail.join(' → ')}`).toBeNull();
  await settle();
  expect(c.querySelector('.nav'), `shell gone after ${trail.join(' → ')}`).toBeTruthy();
  expect(errors, `errors after ${trail.join(' → ')}`).toEqual([]);
  // The hop really landed: the address names where it went.
  const want = to.account ? '#/account' : to.home ? '' : to.id ? `#/${to.section}/${to.id}` : `#/${to.section}/`;
  if (to.home) expect(['', '#/']).toContain(window.location.hash);
  else expect(window.location.hash, `address after ${trail.join(' → ')}`).toContain(want);
}

describe.each([true, false])('switching screens (signed in: %s)', (signedIn) => {
  it('every rail screen to Account and back, and to its section and back', async () => {
    const { container: c } = await mountApp(signedIn);
    await settle();
    const trail: string[] = [];
    for (const s of RAIL) {
      await hop(c, s, trail);
      await hop(c, { account: true }, trail);
      await hop(c, s, trail);
      await hop(c, { section: 'play' }, trail);
      await hop(c, { account: true }, trail);
      await hop(c, { section: s.section }, trail);
      await hop(c, { home: true }, trail);
    }
  }, 120_000);

  it('Account and Play back and forth, then back/forward through the history', async () => {
    const { container: c } = await mountApp(signedIn);
    await settle();
    const trail: string[] = [];
    for (let i = 0; i < 5; i++) {
      await hop(c, { section: 'play' }, trail);
      await hop(c, { account: true }, trail);
    }
    for (const dir of ['back', 'back', 'forward', 'back', 'back', 'back'] as const) {
      trail.push(dir);
      await act(async () => {
        if (dir === 'back') window.history.back(); else window.history.forward();
        await new Promise((r) => setTimeout(r, 20));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      await settle();
      expect(c.querySelector('.nav'), `shell gone after ${trail.join(' → ')}`).toBeTruthy();
      expect(errors, `errors after ${trail.join(' → ')}`).toEqual([]);
    }
  }, 60_000);
});
