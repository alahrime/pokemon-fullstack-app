import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import type { QueueEntry, Match, Offer } from '../../lib/matchmaking';

/**
 * The Matchmaking screen: the blind queue, the open offer board, and
 * scheduled proposals.
 *
 * `../../lib/matchmaking` is mocked at the module boundary — the round trip
 * through Supabase belongs to `matchmaking.test.ts`, not here. What belongs
 * here is what the screen does with the nine functions it calls: whether it
 * calls them with the roster and format actually on screen, whether it asks
 * before an irreversible leave, whether a self-proposed offer is ever given
 * an Accept control the database would refuse anyway, and whether a `null`
 * return from `acceptOffer` (a scheduled offer awaiting the proposer's
 * confirmation) is ever rendered as a match.
 */

const mmApi = vi.hoisted(() => ({
  joinQueue: vi.fn(),
  leaveQueue: vi.fn(),
  myQueueEntry: vi.fn(),
  myMatches: vi.fn(),
  listOpenOffers: vi.fn(),
  createOffer: vi.fn(),
  acceptOffer: vi.fn(),
  confirmOffer: vi.fn(),
  opponentFriendCode: vi.fn(),
}));
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

/** Add a named Pokemon through the live search dropdown. Copied from
 * team-saves.test.tsx's `pick` — reading the first row synchronously after
 * the change event reads the *previous* render's list. */
async function pick(container: HTMLElement, typed: string) {
  const input = container.querySelector('.team-add input') as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: typed } });
  const row = await waitFor(() => {
    const hit = [...container.querySelectorAll('.search-dropdown .search-row')].find((r) =>
      new RegExp(`^${typed}$`, 'i').test(r.querySelector('.search-row-name')?.textContent?.trim() ?? ''),
    );
    if (!hit) throw new Error(`no search result for "${typed}"`);
    return hit;
  });
  fireEvent.mouseDown(row);
}

async function pickThree(container: HTMLElement) {
  await pick(container, 'azumarill');
  await pick(container, 'registeel');
  await pick(container, 'skarmory');
}

function offer(over: Partial<Offer>): Offer {
  return {
    id: 'off-x',
    proposerId: 'someone-else',
    league: 'great',
    formatVersionId: 'v1',
    scheduledFor: null,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    state: 'open',
    acceptedBy: null,
    ...over,
  };
}

function match(over: Partial<Match>): Match {
  return {
    id: 'm-x',
    opponentId: 'opp-1',
    formatVersionId: 'v1',
    rulesHash: 'hash',
    dataRev: 'rev1',
    rounds: 3,
    source: 'queue',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  mmApi.joinQueue.mockReset().mockResolvedValue('q1');
  mmApi.leaveQueue.mockReset().mockResolvedValue(undefined);
  mmApi.myQueueEntry.mockReset().mockResolvedValue(null);
  mmApi.myMatches.mockReset().mockResolvedValue([]);
  mmApi.listOpenOffers.mockReset().mockResolvedValue([]);
  mmApi.createOffer.mockReset().mockResolvedValue('o1');
  mmApi.acceptOffer.mockReset().mockResolvedValue('m1');
  mmApi.confirmOffer.mockReset().mockResolvedValue('m1');
  mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe('signed out', () => {
  it('offers nothing to sign in with when signed out', async () => {
    const { container } = await mount(null);
    expect(container.querySelector('.queue-join')).toBeFalsy();
    expect(container.textContent).toMatch(/sign in/i);
  });
});

describe('signed in — the blind queue', () => {
  it('cannot join with an incomplete roster', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
    expect(joinBtn).toBeTruthy();
    expect(joinBtn.disabled).toBe(true);
  });

  it('joins the queue with the roster and format on screen', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(joinBtn);
    });
    await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
    const arg = mmApi.joinQueue.mock.calls[0][0] as {
      league: string;
      formatVersionId: string;
      format: { base: string };
      team: { ref: string }[];
    };
    expect(arg.league).toBe('great');
    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
    expect(typeof arg.formatVersionId).toBe('string');
    expect(arg.formatVersionId.length).toBeGreaterThan(0);
    expect(arg.format.base).toBe('great');
  });

  it('distinguishes queued-awaiting-verification from queued-and-eligible', async () => {
    mmApi.myQueueEntry.mockResolvedValue({
      id: 'q1',
      league: 'great',
      formatVersionId: 'v1',
      verifiedHash: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    } satisfies QueueEntry);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.textContent).toMatch(/awaiting verification/i));
    expect(container.textContent).not.toMatch(/eligible to pair/i);
  });

  it('shows a verified entry as eligible, not awaiting', async () => {
    mmApi.myQueueEntry.mockResolvedValue({
      id: 'q1',
      league: 'great',
      formatVersionId: 'v1',
      verifiedHash: 'abc123',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    } satisfies QueueEntry);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.textContent).toMatch(/eligible to pair/i));
    expect(container.textContent).not.toMatch(/awaiting verification/i);
  });

  it('asks before leaving a queue it is already in', async () => {
    mmApi.myQueueEntry.mockResolvedValue({
      id: 'q1',
      league: 'great',
      formatVersionId: 'v1',
      verifiedHash: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    } satisfies QueueEntry);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const leaveBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('button')].find((x) => /Leave queue/i.test(x.textContent ?? ''));
      if (!b) throw new Error('leave button not rendered yet');
      return b as HTMLButtonElement;
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(leaveBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mmApi.leaveQueue).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      fireEvent.click(leaveBtn);
    });
    await waitFor(() => expect(mmApi.leaveQueue).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
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

describe('signed in — the open offer board', () => {
  it('disables accept on an offer the signed-in person proposed', async () => {
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-mine', proposerId: 'u1' }),
      offer({ id: 'off-theirs', proposerId: 'someone-else' }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const [mineRow, theirsRow] = await waitFor(() => {
      const mine = container.querySelector('[data-offer-id="off-mine"]');
      const theirs = container.querySelector('[data-offer-id="off-theirs"]');
      if (!mine || !theirs) throw new Error('offer rows not rendered yet');
      return [mine, theirs];
    });
    // The database refuses match_offers_not_self and accept_offer raises for
    // it too, but a control that can only fail should not be presented.
    expect(mineRow.querySelector('.offer-accept')).toBeFalsy();
    expect(theirsRow.querySelector('.offer-accept')).toBeTruthy();
  });

  it('shows a scheduled offer awaiting confirmation as awaiting, not as a match', async () => {
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-sched', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() }),
    ]);
    mmApi.acceptOffer.mockResolvedValue(null);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const acceptBtn = await waitFor(() => {
      const b = container.querySelector('[data-offer-id="off-sched"] .offer-accept');
      if (!b) throw new Error('accept button not rendered yet');
      return b as HTMLButtonElement;
    });
    await act(async () => {
      fireEvent.click(acceptBtn);
    });
    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledWith('off-sched', expect.any(Array)));
    // accept_offer returns null for a scheduled offer: it is `accepted`, not
    // yet a match, until the proposer confirms. Rendering null as "matched"
    // would put a battle on someone's calendar nobody actually confirmed.
    expect(container.textContent).toMatch(/awaiting/i);
    expect(container.textContent).not.toMatch(/matched!/i);
  });

  it('shows a live offer as matched once accepted, since accept_offer returned a match id', async () => {
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-live' })]);
    mmApi.acceptOffer.mockResolvedValue('brand-new-match');
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const acceptBtn = await waitFor(() => {
      const b = container.querySelector('[data-offer-id="off-live"] .offer-accept');
      if (!b) throw new Error('accept button not rendered yet');
      return b as HTMLButtonElement;
    });
    await act(async () => {
      fireEvent.click(acceptBtn);
    });
    await waitFor(() => expect(container.textContent).toMatch(/matched!/i));
  });

  it('posts an offer to the open board with the roster and format on screen', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
    fireEvent.click(toggle);
    const postBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('button')].find((x) => /Post to the open board/i.test(x.textContent ?? ''));
      if (!b) throw new Error('post button not rendered yet');
      return b as HTMLButtonElement;
    });
    await act(async () => {
      fireEvent.click(postBtn);
    });
    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; team: { ref: string }[] };
    expect(arg.scheduledFor).toBeUndefined();
    expect(arg.team.map((m) => m.ref)).toEqual(['azumarill', 'registeel', 'skarmory']);
  });

  it('schedules an offer for later with a scheduledFor date, and offers a Confirm control once posted', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
    fireEvent.click(toggle);
    const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const future = new Date(Date.now() + 3 * 86_400_000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
    fireEvent.change(dtInput, { target: { value: local } });
    const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
    await act(async () => {
      fireEvent.click(scheduleBtn);
    });
    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date };
    expect(arg.scheduledFor).toBeInstanceOf(Date);

    const confirmBtn = await waitFor(() => {
      const b = [...container.querySelectorAll('.posted-offer-row button')].find((x) => /Confirm/i.test(x.textContent ?? ''));
      if (!b) throw new Error('confirm button not rendered yet');
      return b as HTMLButtonElement;
    });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    await waitFor(() => expect(mmApi.confirmOffer).toHaveBeenCalledWith('o1'));
  });
});
