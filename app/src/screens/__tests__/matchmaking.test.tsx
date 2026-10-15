import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import type { Match } from '../../lib/matchmaking';

/**
 * The Matches screen: the list of your matches, each a way into its Match
 * screen. The blind queue and the open offer board it used to carry were
 * removed with the coordinator (2026-10-15).
 *
 * `../../lib/matchmaking` is mocked at the module boundary — the round trip
 * through Supabase belongs to `matchmaking.test.ts`, not here.
 */

const mmApi = vi.hoisted(() => ({ myMatches: vi.fn(), opponentFriendCode: vi.fn() }));
vi.mock('../../lib/matchmaking', () => mmApi);

const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

function fakeSession(id: string, email: string): Session {
  return { access_token: 'tok', user: { id, email } } as unknown as Session;
}

function fakeClient(session: Session | null) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  pkg.client = { auth };
  return auth;
}

/**
 * `lib/supabase` builds its client once at import time, so the mock above
 * only takes effect for an import that happens AFTER `pkg.client` is set —
 * see `team-saves.test.tsx`'s identical harness for why this resets modules
 * and imports dynamically rather than importing at the top of the file.
 */
async function mount(session: Session | null) {
  fakeClient(session);
  vi.resetModules();
  const { ThemeProvider } = await import('../../state/ThemeContext');
  const { AppStateProvider } = await import('../../state/AppState');
  const { SessionProvider } = await import('../../state/SessionContext');
  const { MatchmakingScreen } = await import('../MatchmakingScreen');
  let view!: RenderResult;
  await act(async () => {
    view = render(
      <ThemeProvider>
        <AppStateProvider>
          <SessionProvider>
            <MatchmakingScreen />
          </SessionProvider>
        </AppStateProvider>
      </ThemeProvider>,
    );
  });
  return { view, container: view.container };
}

function match(over: Partial<Match>): Match {
  return {
    id: 'm-x',
    opponentId: 'opp-1',
    mySide: 'a',
    formatVersionId: 'v1',
    rulesHash: 'hash',
    dataRev: 'rev1',
    rounds: 3,
    state: 'paired',
    ratingCounted: false,
    amendDeadline: null,
    source: 'queue',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  mmApi.myMatches.mockReset().mockResolvedValue([]);
  mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe('signed out', () => {
  it('says to sign in and reads nothing', async () => {
    const { container } = await mount(null);
    expect(container.textContent).toMatch(/sign in/i);
    expect(mmApi.myMatches).not.toHaveBeenCalled();
  });
});

describe('signed in', () => {
  it('offers neither a queue nor an offer board', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.textContent).toMatch(/no matches yet/i));
    expect(container.textContent).not.toMatch(/queue|offer board|post an offer/i);
  });

});

describe('signed in — matches and friend codes', () => {
  it("shows the opponent's friend code once a match exists", async () => {
    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-1' })]);
    mmApi.opponentFriendCode.mockResolvedValue('1234 5678 9012');
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.textContent).toMatch(/1234 5678 9012/));
    expect(mmApi.opponentFriendCode).toHaveBeenCalledWith('opp-1');
  });

  it('says no friend code is on file rather than showing nothing', async () => {
    mmApi.myMatches.mockResolvedValue([match({ opponentId: 'opp-2' })]);
    mmApi.opponentFriendCode.mockResolvedValue(null);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.textContent).toMatch(/no friend code/i));
  });
});
