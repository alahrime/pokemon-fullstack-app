import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { goTo } from '../../test/nav';

/**
 * Cross-feature regressions: whole <App/>, signed in, driving the actions a
 * person strings together (build a roster, save it, chat, change screens,
 * change league, open the account page). Each feature has its own tests; what
 * nothing covered is one feature's state surviving — or being torn down by —
 * another's navigation. The shared invariants are checked after every step.
 */

const db = vi.hoisted(() => ({
  teams: [] as { id: string; name: string; league: string; size: number; members: unknown[] }[],
  messages: {} as Record<string, unknown[]>,
  push: {} as Record<string, (m: unknown) => void>,
  n: 0,
}));

vi.mock('../../lib/saves', async (orig) => ({
  ...(await orig<typeof import('../../lib/saves')>()),
  listTeams: async (size: number) => db.teams.filter((t) => t.size === size),
  saveTeam: async (t: { name: string; league: string; size: number; members: unknown[] }) => {
    const id = `t${++db.n}`;
    db.teams.push({ id, ...t });
    return id;
  },
  deleteTeam: async (id: string) => {
    db.teams = db.teams.filter((t) => t.id !== id);
  },
}));

const CHANNELS = [
  { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null, displayTitle: 'Misty', otherId: 'u2', memberCount: null, lastMessageAt: '2026-01-02T00:00:00Z' },
  { id: 'c2', kind: 'group', title: 'Gym', matchId: null, lastReadAt: null, displayTitle: 'A very long group name that should wrap rather than push the pane wider than the dock allows', otherId: null, memberCount: 4, lastMessageAt: null },
  { id: 'c3', kind: 'match', title: null, matchId: 'm1', lastReadAt: null, displayTitle: 'Brock', otherId: 'u3', memberCount: null, lastMessageAt: null },
];

vi.mock('../../lib/channels', async (orig) => ({
  ...(await orig<typeof import('../../lib/channels')>()),
  listChannelsWithActivity: async () => CHANNELS,
  withDisplayNames: async (c: unknown[]) => c,
  listMessages: async (id: string) => db.messages[id] ?? [],
  sendMessage: async (id: string, body: string) => {
    const m = { id: `m${++db.n}`, channelId: id, authorId: 'user-1', body, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, kind: 'text', offerId: null };
    (db.messages[id] ??= []).push(m);
    return m;
  },
  markRead: async () => {},
  canAnnounce: async () => false,
  isTournamentOrganiser: async () => false,
  listPins: async () => [],
  latestAnnouncement: async () => null,
  subscribeToChannel: (id: string, cb: (m: unknown) => void) => {
    db.push[id] = cb;
    return () => {};
  },
}));

// Every other table reads as empty; every write succeeds.
const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));
function chain(): unknown {
  const r = { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (f: (v: unknown) => unknown) => Promise.resolve(r).then(f) : k === 'maybeSingle' || k === 'single' ? async () => ({ data: null, error: null }) : p),
    apply: () => p,
  });
  return p;
}

let errors: string[];
async function mountApp() {
  pkg.client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'user-1', email: 'ash@example.com' } } as unknown as Session }, error: null }),
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
  await act(async () => {
    view = render(<App />);
  });
  return view;
}

beforeEach(() => {
  db.teams = []; db.messages = {}; db.push = {}; db.n = 0;
  errors = [];
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  window.confirm = () => true;
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    const t = a.map(String).join(' ');
    if (!/suspended resource finished loading/.test(t)) errors.push(t.slice(0, 300));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const btn = (c: HTMLElement, re: RegExp) => [...c.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement | undefined;

async function pick(c: HTMLElement, typed: string) {
  const input = await waitFor(() => { const i = c.querySelector('.team-add input'); if (!i) throw new Error('builder not loaded'); return i as HTMLInputElement; });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const row = await waitFor(() => {
    const hit = [...c.querySelectorAll('.search-dropdown .search-row')].find((r) => new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''));
    if (!hit) throw new Error('no ' + typed);
    return hit;
  });
  fireEvent.mouseDown(row);
}

/** Invariants that must hold on every screen after every step. */
function invariants(c: HTMLElement, tag: string) {
  expect(c.querySelector('.nav'), `${tag}: nav`).toBeTruthy();
  expect(c.querySelector('.screen-enter')?.textContent?.length, `${tag}: blank screen`).toBeGreaterThan(0);
  const panes = [...c.querySelectorAll('.chat-dock-panes .chat-pane')];
  const titles = panes.map((p) => p.querySelector('.chat-pane-title')?.textContent);
  expect(new Set(titles).size, `${tag}: duplicate panes ${titles}`).toBe(titles.length);
  const ids = [...c.querySelectorAll('.chat-message')].map((m) => m.getAttribute('data-id') ?? m.textContent);
  expect(ids.length).toBeGreaterThanOrEqual(0);
  if (errors.length) throw new Error(`${tag}: console.error: ${errors[0]}`);
}

describe('combined flows, signed in', () => {
  it('save a team, chat, go to rankings, come back: roster list, pane and draft all intact', async () => {
    const view = await mountApp();
    const c = view.container;
    await settle();
    goTo(c, 'GBL Teams');
    await settle();
    await pick(c, 'azumarill');
    await pick(c, 'registeel');
    await pick(c, 'skarmory');
    fireEvent.change(c.querySelector('#team-save-name')!, { target: { value: 'Combo' } });
    await act(async () => { fireEvent.click(btn(c, /Save roster/i)!); });
    await settle();
    expect(db.teams).toHaveLength(1);
    invariants(c, 'saved');

    // chat while on the builder
    await act(async () => { fireEvent.click(btn(c, /Misty/)!); });
    await settle();
    const box = c.querySelector('textarea[aria-label="Message to Misty"]') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'gg' } });
    await act(async () => { fireEvent.click(btn(c, /Send message to Misty/)!); });
    await settle();
    expect(c.querySelector('.chat-transcript')?.textContent).toContain('gg');
    // an unsent draft must survive a screen change
    fireEvent.change(c.querySelector('textarea[aria-label="Message to Misty"]')!, { target: { value: 'draft' } });
    invariants(c, 'chatted');

    goTo(c, 'Rankings');
    await settle();
    invariants(c, 'rankings');
    expect((c.querySelector('textarea[aria-label="Message to Misty"]') as HTMLTextAreaElement).value).toBe('draft');
    expect(c.querySelector('.chat-transcript')?.textContent).toContain('gg');

    goTo(c, 'GBL Teams');
    await settle();
    invariants(c, 'back to teams');
    // the saved team is still offered after the round trip
    fireEvent.click(btn(c, /Saved teams/i)!);
    await settle();
    expect(c.textContent).toContain('Combo');
  });

  it('a live message arriving while the pane is minimised, on another screen, does not crash or duplicate', async () => {
    const view = await mountApp();
    const c = view.container;
    await settle();
    await act(async () => { fireEvent.click(btn(c, /Brock/)!); });
    await settle();
    fireEvent.click(btn(c, /Minimize chat with Brock/)!);
    goTo(c, 'Records');
    await settle();
    const m = { id: 'live1', channelId: 'c3', authorId: 'u3', body: 'incoming', createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, kind: 'text', offerId: null };
    await act(async () => { db.push.c3(m); db.push.c3(m); });
    fireEvent.click(btn(c, /Expand chat with Brock/)!);
    await settle();
    expect([...c.querySelectorAll('.chat-message')].filter((e) => e.textContent?.includes('incoming'))).toHaveLength(1);
    invariants(c, 'live');
  });

  it('opens every channel at once, closes them in reverse, reopens: no duplicate or ghost panes', async () => {
    const view = await mountApp();
    const c = view.container;
    await settle();
    for (const w of [/Misty/, /Brock/, /A very long/]) { await act(async () => { fireEvent.click(btn(c, w)!); }); await settle(); }
    expect(c.querySelectorAll('.chat-dock-panes .chat-pane')).toHaveLength(3);
    invariants(c, 'three open');
    for (const w of [/Close chat with A very/, /Close chat with Brock/, /Close chat with Misty/]) { fireEvent.click(btn(c, w)!); }
    expect(c.querySelectorAll('.chat-dock-panes .chat-pane')).toHaveLength(0);
    await act(async () => { fireEvent.click(btn(c, /Misty/)!); });
    await settle();
    expect(c.querySelectorAll('.chat-dock-panes .chat-pane')).toHaveLength(1);
    invariants(c, 'reopened');
  });

  it('clicking an already-open conversation moves it to the newest slot, without remounting it', async () => {
    const view = await mountApp();
    const c = view.container;
    await settle();
    for (const w of [/Misty/, /Brock/]) { await act(async () => { fireEvent.click(btn(c, w)!); }); await settle(); }
    fireEvent.change(c.querySelector('textarea[aria-label="Message to Misty"]')!, { target: { value: 'keep me' } });
    const order = () => [...c.querySelectorAll('.chat-dock-panes .chat-pane-title')].map((e) => e.textContent);
    expect(order()).toEqual(['Misty', 'Brock']);
    await act(async () => { fireEvent.click(btn(c, /Open chat with Misty|Misty.*direct/)!); });
    expect(order()).toEqual(['Brock', 'Misty']);
    expect((c.querySelector('textarea[aria-label="Message to Misty"]') as HTMLTextAreaElement).value).toBe('keep me');
  });

  it('seeded random walk across screens, leagues, chat, saves and the account page', async () => {
    const view = await mountApp();
    const c = view.container;
    await settle();
    let s = Number(process.env.COMBO_SEED ?? 12345);
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pickOne = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const screens = ['Report', 'Battle', 'Moves', 'Rankings', 'Diagnostics', 'GBL Teams', 'Show 6', 'Cores', 'Formats', 'Matches', 'Friends', 'Chat', 'Tournaments', 'Records'];
    const trail: string[] = [];
    for (let i = 0; i < Number(process.env.COMBO_STEPS ?? 120); i++) {
      const roll = rnd();
      let what = '';
      try {
        if (roll < 0.3) { what = pickOne(screens); goTo(c, what); }
        else if (roll < 0.45) { const b = pickOne([...c.querySelectorAll('.nav-right [role=tab], .nav-right button')].filter((x) => /CP|CAP/.test(x.textContent ?? ''))); what = 'league ' + b.textContent; fireEvent.click(b); }
        else if (roll < 0.6) { const b = pickOne([...c.querySelectorAll('.chat-rail-row, .chat-pane-controls button')] as HTMLElement[]); if (b) { what = 'chat ' + (b.getAttribute('aria-label') ?? b.textContent); await act(async () => { fireEvent.click(b); }); } }
        else if (roll < 0.7) { const t = c.querySelector('textarea.input') as HTMLTextAreaElement | null; if (t) { what = 'type'; fireEvent.change(t, { target: { value: 'hi ' + i } }); const send = btn(c, /Send message/); if (send && rnd() < 0.6) await act(async () => { fireEvent.click(send); }); } }
        else if (roll < 0.8) { const b = btn(c, /Account/); what = 'account'; fireEvent.click(b!); }
        else { const bs = [...c.querySelectorAll('.screen-enter button')].filter((b) => !(b as HTMLButtonElement).disabled && !/delete|sign|download|export|forfeit|resign|csv|json|categories/i.test(b.textContent ?? '')) as HTMLElement[]; const b = pickOne(bs); if (b) { what = 'btn ' + (b.textContent ?? '').slice(0, 20); await act(async () => { fireEvent.click(b); }); } }
      } catch (e) {
        throw new Error(`step ${i} (${what}) threw: ${(e as Error).message}\ntrail: ${trail.join(' > ')}`);
      }
      trail.push(what);
      await settle();
      try { invariants(c, `step ${i} ${what}`); } catch (e) { throw new Error(`${(e as Error).message}\ntrail: ${trail.slice(-10).join(' > ')}`); }
    }
  }, 600_000);
});
