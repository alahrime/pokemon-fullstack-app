import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import type { QueueEntry, Match, MyOffer, Offer } from '../../lib/matchmaking';
import type { StoredMember } from '../../lib/teamCodec';
import type { SavedFormat } from '../../lib/saves';
import { RULES_SCHEMA } from '../../rules';

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
  myOffers: vi.fn(),
  createOffer: vi.fn(),
  acceptOffer: vi.fn(),
  confirmOffer: vi.fn(),
  opponentFriendCode: vi.fn(),
}));
vi.mock('../../lib/matchmaking', () => mmApi);

/**
 * `../../lib/saves` is mocked the same way, for the same reason — and it is
 * mocked at all because a queue entry's `format_version_id` is a foreign key
 * into `format_versions`, so the screen has to get a real one from somewhere.
 * M2a's answer is a format the person saved to their account.
 */
const savesApi = vi.hoisted(() => ({ listServerFormats: vi.fn() }));
vi.mock('../../lib/saves', () => savesApi);

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

/** A roster member as the database stores one — see `StoredMember`. */
function member(ref: string, fast = 'BUBBLE'): StoredMember {
  return { ref, fast_move: fast, charge_moves: ['ICE_BEAM'], iv_attack: 0, iv_defense: 15, iv_stamina: 15, level: 40 };
}

const THREE = [member('azumarill'), member('registeel', 'LOCK_ON'), member('skarmory', 'AIR_SLASH')];

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
    // Verified by default: the unverified case is its own set of tests below,
    // and leaving every fixture in it would silently remove the Accept control
    // from tests that are about something else entirely.
    verifiedHash: 'h1',
    rosterSize: 3,
    // The members the board now renders. `rosterSize` stays its own field and
    // its own override knob: it is what `canAccept` compares against, and
    // several tests below set it without caring who is on the roster.
    roster: THREE,
    ...over,
  };
}

function savedFormat(over: Partial<SavedFormat> = {}): SavedFormat {
  return {
    id: 'f-great',
    name: 'Great League Open',
    version: 2,
    versionId: 'fv-great-2',
    rulesHash: 'h2',
    format: {
      schema: RULES_SCHEMA,
      base: 'great',
      pool: [],
      composition: { size: 3, uniqueSpecies: true },
      selection: { mode: 'open' },
    },
    ...over,
  };
}

function myOffer(over: Partial<MyOffer>): MyOffer {
  return {
    id: 'mine-x',
    proposerId: 'u1',
    league: 'great',
    formatVersionId: 'fv-great-2',
    scheduledFor: null,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    state: 'open',
    acceptedBy: null,
    verifiedHash: 'h1',
    matchId: null,
    rosterSize: 3,
    roster: THREE,
    ...over,
  };
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
  mmApi.joinQueue.mockReset().mockResolvedValue('q1');
  mmApi.leaveQueue.mockReset().mockResolvedValue(undefined);
  mmApi.myQueueEntry.mockReset().mockResolvedValue(null);
  mmApi.myMatches.mockReset().mockResolvedValue([]);
  mmApi.listOpenOffers.mockReset().mockResolvedValue([]);
  mmApi.myOffers.mockReset().mockResolvedValue([]);
  mmApi.createOffer.mockReset().mockResolvedValue('o1');
  mmApi.acceptOffer.mockReset().mockResolvedValue('m1');
  mmApi.confirmOffer.mockReset().mockResolvedValue('m1');
  mmApi.opponentFriendCode.mockReset().mockResolvedValue(null);
  savesApi.listServerFormats.mockReset().mockResolvedValue([savedFormat()]);
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
    // The EXACT version id of the saved format on screen. "a non-empty
    // string" was the earlier assertion, and it passed against the
    // `canonical:great` placeholder that no foreign key could ever have
    // accepted — an assertion no wrong value could fail is not coverage.
    // `versionId` is `format_versions.id`; `id` is `formats.id`, a different
    // table, and sending that one would fail the key just as quietly.
    expect(arg.formatVersionId).toBe('fv-great-2');
    expect(arg.formatVersionId).not.toBe('f-great');
    expect(arg.format).toEqual(savedFormat().format);
  });

  it('offers no Join at all when there is no saved format to join under', async () => {
    savesApi.listServerFormats.mockResolvedValue([]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => expect(container.querySelector('.no-formats')).toBeTruthy());
    // `format_version_id` is NOT NULL and a foreign key: with nothing to put
    // in it, joining could only fail. Same rule as Accept on one's own offer.
    expect(container.querySelector('.queue-join')).toBeFalsy();
    expect(container.textContent).toMatch(/no saved format/i);
  });

  it('queues under the format that was chosen, not the first one listed', async () => {
    savesApi.listServerFormats.mockResolvedValue([
      savedFormat(),
      savedFormat({ id: 'f-cup', name: 'Fossil Cup', versionId: 'fv-cup-7' }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const second = await waitFor(() => {
      const b = container.querySelector('[data-format-id="f-cup"]');
      if (!b) throw new Error('format choices not rendered yet');
      return b as HTMLButtonElement;
    });
    fireEvent.click(second);
    await pickThree(container);
    await act(async () => {
      fireEvent.click(container.querySelector('.queue-join') as HTMLButtonElement);
    });
    await waitFor(() => expect(mmApi.joinQueue).toHaveBeenCalledTimes(1));
    expect((mmApi.joinQueue.mock.calls[0][0] as { formatVersionId: string }).formatVersionId).toBe('fv-cup-7');
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

  /**
   * I4. A queue entry lives ten minutes and `sweep_expired` deletes it on the
   * next coordinator tick; nothing re-reads this panel. Past `expiresAt` the
   * row on screen is a memory, and "queued and eligible to pair" is a claim
   * about the future that has already been falsified — the person is not
   * queued at all and is being told they are.
   *
   * The fixture is a VERIFIED entry on purpose: an unverified one would show
   * "awaiting verification" for the wrong reason, and the assertion would pass
   * without the expiry branch existing. Verified plus expired is the only
   * combination where the two branches disagree.
   */
  it('stops calling an expired queue entry eligible, though the row is still on screen', async () => {
    mmApi.myQueueEntry.mockResolvedValue({
      id: 'q1',
      league: 'great',
      formatVersionId: 'v1',
      verifiedHash: 'abc123',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    } satisfies QueueEntry);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const status = await waitFor(() => {
      const p = container.querySelector('.queue-status');
      if (!p) throw new Error('queue status not rendered yet');
      return p;
    });
    expect(status.textContent).toBe('The queue window closed — join again to keep looking.');
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

  it('schedules an offer for later with a scheduledFor date, and re-reads its own offers from the server', async () => {
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
    fireEvent.click(toggle);
    const dtInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const future = new Date(Date.now() + 3 * 86_400_000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T12:00`;
    fireEvent.change(dtInput, { target: { value: local } });
    const before = mmApi.myOffers.mock.calls.length;
    const scheduleBtn = [...container.querySelectorAll('button')].find((b) => /^Schedule$/i.test(b.textContent ?? ''))!;
    await act(async () => {
      fireEvent.click(scheduleBtn);
    });
    await waitFor(() => expect(mmApi.createOffer).toHaveBeenCalledTimes(1));
    const arg = mmApi.createOffer.mock.calls[0][0] as { scheduledFor?: Date; formatVersionId: string };
    expect(arg.scheduledFor).toBeInstanceOf(Date);
    expect(arg.formatVersionId).toBe('fv-great-2');
    // Read back, not remembered: what this panel shows has to survive the
    // reload that throws every piece of session state away.
    await waitFor(() => expect(mmApi.myOffers.mock.calls.length).toBeGreaterThan(before));
  });
});

/**
 * Accepting is the OFFER's business, not yours.
 *
 * `accept_offer(p_offer, p_team)` takes no format argument: the offer's own
 * `format_version_id` governs the match. So neither a saved format of your
 * own nor its `composition.size` may have any say in whether, or with what,
 * you accept — the first locks out everyone who has none, and the second
 * quietly sends a roster of the wrong length into someone else's offer.
 */
describe('signed in — accepting an offer', () => {
  it('lets someone with no saved format of their own accept an open offer', async () => {
    savesApi.listServerFormats.mockResolvedValue([]);
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-open', rosterSize: 3 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-open"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);

    const acceptBtn = container.querySelector('[data-offer-id="off-open"] .offer-accept') as HTMLButtonElement;
    expect(acceptBtn).toBeTruthy();
    // The database would take this person: they need no format to accept one.
    expect(acceptBtn.disabled).toBe(false);
    // And never the tooltip that used to sit on a permanently dead control.
    expect(acceptBtn.getAttribute('title') ?? '').not.toMatch(/add 0 more/i);

    await act(async () => {
      fireEvent.click(acceptBtn);
    });
    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
    // Their own Join is still, correctly, not on offer — that one does need a
    // format. The two gates are separate, which is the whole point.
    expect(container.querySelector('.queue-join')).toBeFalsy();
  });

  it('sizes the roster it accepts with by the offer, not by your own format', async () => {
    // Your format wants six; this offer is played with three.
    savesApi.listServerFormats.mockResolvedValue([
      savedFormat({
        format: {
          schema: RULES_SCHEMA,
          base: 'great',
          pool: [],
          composition: { size: 6, uniqueSpecies: true },
          selection: { mode: 'open' },
        },
      }),
    ]);
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);

    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(false);
    // Sized by your own six-member format, Join is not ready at three — the
    // contrast is the assertion: one control says yes and the other says no,
    // on the same roster, because they answer to different formats.
    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(acceptBtn);
    });
    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
    // Three, because the offer is played with three. Nothing downstream would
    // have rejected six: the coordinator recomputes rules_hash and never
    // inspects the roster.
    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(3);
  });

  it('refuses to send a six-strong roster into a three-member offer', async () => {
    // The exact mismatch nothing downstream would catch: `accept_offer` stores
    // whatever roster it is handed as `matches.team_b`, and the coordinator
    // recomputes `rules_hash` without ever inspecting `team`. A gate written
    // as "at least as many as the offer wants" would let this through.
    savesApi.listServerFormats.mockResolvedValue([
      savedFormat({
        format: {
          schema: RULES_SCHEMA,
          base: 'great',
          pool: [],
          composition: { size: 6, uniqueSpecies: true },
          selection: { mode: 'open' },
        },
      }),
    ]);
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-three', rosterSize: 3 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-three"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);
    await pick(container, 'medicham');
    await pick(container, 'swampert');
    await pick(container, 'bastiodon');
    // Six picked, under your own six-member format, which is legitimate — and
    // Join is ready. It is Accept that must not be.
    expect((container.querySelector('.queue-join') as HTMLButtonElement).disabled).toBe(false);
    const acceptBtn = container.querySelector('[data-offer-id="off-three"] .offer-accept') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(true);
    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 3/i);
  });

  it('offers no Accept on an offer the coordinator has not verified yet, and says why', async () => {
    // The coordinator ticks once a minute, so this is the normal first minute
    // of every offer's life, not a rare edge — and `accept_offer` raises
    // 'this offer has not been verified yet' for the whole of it.
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-fresh', verifiedHash: null }),
      offer({ id: 'off-ready', verifiedHash: 'h1' }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const [fresh, ready] = await waitFor(() => {
      const a = container.querySelector('[data-offer-id="off-fresh"]');
      const b = container.querySelector('[data-offer-id="off-ready"]');
      if (!a || !b) throw new Error('board not rendered yet');
      return [a, b];
    });
    await pickThree(container);
    expect(fresh.querySelector('.offer-accept')).toBeFalsy();
    // A reason in the person's own register, so the board reads as busy
    // rather than broken.
    expect(fresh.textContent).toMatch(/being checked/i);
    // And the verified one beside it is unaffected — otherwise this test
    // would pass against a board that offered nothing to anybody.
    expect((ready.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
  });

  it('tells the proposer their own offer is being checked, not that nobody wants it', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({ id: 'off-fresh', proposerId: 'u1', state: 'open', verifiedHash: null }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-fresh"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.textContent).toMatch(/being checked/i);
    expect(row.textContent).not.toMatch(/nobody has accepted/i);
  });

  it('offers no Accept on an offer posted with no roster at all', async () => {
    // Not reachable from this screen, which never posts an empty roster — but
    // `accept_offer` refuses only a NULL p_team, not an empty one, so a
    // malformed offer from another client would otherwise convert into a
    // match with an empty team_b.
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-empty', rosterSize: 0 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-empty"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    // A fresh screen holds an empty roster, so `team.length === o.rosterSize`
    // is 0 === 0 — true. Length alone would have offered an enabled Accept.
    expect(row.querySelector('.offer-accept')).toBeFalsy();
    expect(row.textContent).toMatch(/without a roster/i);
  });

  it('refuses to accept with a roster of the wrong length, and says what the offer wants', async () => {
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);
    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(true);
    expect(acceptBtn.getAttribute('title')).toMatch(/roster of 6/i);
  });

  it('lets the roster grow past your own format to reach a bigger offer', async () => {
    // Otherwise a six-member offer is unacceptable no matter what you pick,
    // which is the "control that cannot succeed" rule wearing the roster's
    // clothes: your own three-member format would cap the picker at three.
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);
    await pick(container, 'medicham');
    await pick(container, 'swampert');
    await pick(container, 'bastiodon');
    // Every member picked is rendered in a slot — a member with no slot is a
    // member nobody can remove.
    expect(container.querySelectorAll('.team-slots > *').length).toBeGreaterThanOrEqual(6);

    // Your own three-member format now wants three FEWER than you hold, and
    // the shortfall arithmetic runs negative here: "Add -3 more to queue".
    const joinBtn = container.querySelector('.queue-join') as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(true);
    expect(joinBtn.getAttribute('title')).toMatch(/^Remove 3 to queue$/);
    expect(joinBtn.getAttribute('title')).not.toMatch(/-\d/);

    const acceptBtn = container.querySelector('[data-offer-id="off-six"] .offer-accept') as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(acceptBtn);
    });
    await waitFor(() => expect(mmApi.acceptOffer).toHaveBeenCalledTimes(1));
    expect((mmApi.acceptOffer.mock.calls[0][1] as unknown[]).length).toBe(6);
  });
});

/**
 * The handshake, after a reload.
 *
 * A scheduled offer needs two acts by two people, minutes or days apart, and
 * neither of them is likely to still have this tab open. `listOpenOffers`
 * cannot carry it: the offer leaves `state = 'open'` the moment it is
 * accepted, which is exactly when the proposer needs to see it. Everything
 * these tests mount is a FRESH screen that posted nothing this session — the
 * panel is driven by what `myOffers` reports, or it is driven by nothing.
 */
describe('signed in — the handshake survives a reload', () => {
  it('rediscovers an offer awaiting your confirmation, and confirms it', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({
        id: 'off-accepted',
        proposerId: 'u1',
        acceptedBy: 'someone-else',
        state: 'accepted',
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-accepted"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.textContent).toMatch(/confirm it to make it a match/i);
    const confirmBtn = row.querySelector('.offer-confirm') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    await waitFor(() => expect(mmApi.confirmOffer).toHaveBeenCalledWith('off-accepted'));
  });

  it('tells the taker their acceptance is waiting on the proposer, and gives them no Confirm', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({
        id: 'off-theirs',
        proposerId: 'someone-else',
        acceptedBy: 'u1',
        state: 'accepted',
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-theirs"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.textContent).toMatch(/awaiting the proposer/i);
    // `confirm_offer` raises "only the proposer confirms" for the taker.
    expect(row.querySelector('.offer-confirm')).toBeFalsy();
  });

  it('offers no Confirm on an offer nobody has accepted yet', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({ id: 'off-open-live', proposerId: 'u1', state: 'open' }),
      myOffer({
        id: 'off-open-sched',
        proposerId: 'u1',
        state: 'open',
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-my-offer-id="off-open-live"]')) throw new Error('not rendered yet');
    });
    // A live offer goes open -> converted on acceptance and never reaches
    // `accepted`, so confirm_offer would raise "this offer has not been
    // accepted yet" every single time and print that sentence at the person.
    expect(container.querySelectorAll('.offer-confirm')).toHaveLength(0);
    expect(container.textContent).toMatch(/nobody has accepted it yet/i);
  });

  /**
   * I3, first half. `confirm_offer` raises 'this offer has expired' on an
   * accepted offer past its window, and expiry is a coordinator SWEEP rather
   * than a trigger — so the row sits in state 'accepted' until the next tick,
   * and `myOffers()` never re-reads on its own. A tab left open shows an
   * enabled Confirm indefinitely, and pressing it can only print raw Postgres
   * text at the person.
   *
   * The fixture differs from the passing confirm test above in `expiresAt`
   * alone: same proposer, same state, same acceptedBy. So the control
   * disappearing here is the expiry branch and nothing else.
   */
  it('replaces Confirm with a reason once the window has closed on an accepted offer', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({
        id: 'off-late',
        proposerId: 'u1',
        acceptedBy: 'someone-else',
        state: 'accepted',
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-late"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.querySelector('.offer-confirm')).toBeFalsy();
    expect(row.querySelector('.offer-blocked')?.textContent).toBe('The window closed before this was confirmed.');
    // And the status line stops instructing the person to do a thing there is
    // no longer a control for.
    expect(row.textContent).not.toMatch(/confirm it to make it a match/i);
    expect(row.textContent).toMatch(/the window closed before it was confirmed/i);
  });

  /**
   * I3, second half, and the one that exists only because a migration was
   * written to produce it. `accepted_by` is `on delete set null`, so a taker
   * who accepts and then deletes their account leaves the offer in state
   * 'accepted' with nobody attached; nothing about account deletion touches
   * `state`. Migration 20260903011151 exists for exactly this and does nothing
   * else — it turns a raw NOT NULL violation on `matches.player_b` into a
   * sentence — and until this branch the only way to reach that sentence was
   * to press a button that could not work.
   */
  it('replaces Confirm with a reason when whoever accepted has deleted their account', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({
        id: 'off-ghost',
        proposerId: 'u1',
        acceptedBy: null,
        state: 'accepted',
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-ghost"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.querySelector('.offer-confirm')).toBeFalsy();
    expect(row.querySelector('.offer-blocked')?.textContent).toBe('Whoever accepted it no longer has an account.');
    expect(mmApi.confirmOffer).not.toHaveBeenCalled();
  });

  it('shows a confirmed offer as a match rather than as something still to do', async () => {
    mmApi.myOffers.mockResolvedValue([
      myOffer({ id: 'off-done', proposerId: 'u1', acceptedBy: 'someone-else', state: 'converted', matchId: 'm9' }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-done"]');
      if (!r) throw new Error('offer row not rendered yet');
      return r;
    });
    expect(row.textContent).toMatch(/this is a match now/i);
    expect(row.querySelector('.offer-confirm')).toBeFalsy();
  });
});

/**
 * An offer past its own `expires_at`.
 *
 * `accept_offer` raises 'this offer has expired' before it checks anything
 * else, and expiry is a coordinator SWEEP rather than a trigger — the row sits
 * in `state = 'open'` until the next tick. `listOpenOffers` filters on
 * `league` and `state` only, so it hands the expired row back looking exactly
 * like a live one, and nothing on this screen re-reads the board on its own.
 * A page left open past the timestamp therefore shows an enabled Accept whose
 * only possible outcome is raw Postgres text, indefinitely.
 */
describe('signed in — an offer that has expired', () => {
  it('offers no Accept on an offer past its expiry, and says so', async () => {
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-gone', expiresAt: new Date(Date.now() - 60_000).toISOString() }),
      offer({ id: 'off-live', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const [gone, live] = await waitFor(() => {
      const a = container.querySelector('[data-offer-id="off-gone"]');
      const b = container.querySelector('[data-offer-id="off-live"]');
      if (!a || !b) throw new Error('board not rendered yet');
      return [a, b];
    });
    // A roster of exactly the size the offer wants: the ONLY remaining gate is
    // the expiry itself, so without it this Accept renders enabled.
    await pickThree(container);
    expect(gone.querySelector('.offer-accept')).toBeFalsy();
    // Unfixable, so the reason takes the control's place rather than sitting
    // in a tooltip on a dead button — the split the screen keeps.
    expect(gone.querySelector('.offer-blocked')?.textContent).toMatch(/expired/i);
    // And the live offer beside it is untouched, or this test would pass
    // against a board that offered nothing to anybody.
    expect((live.querySelector('.offer-accept') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is the reason given even when the offer is also unverified, as the database would', async () => {
    // `accept_offer` checks expiry BEFORE verified_hash, so "being checked"
    // here would be a sentence the database disagrees with — and a hopeful
    // one, since "acceptable once verified" is a promise this row cannot keep.
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-both', verifiedHash: null, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-both"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    expect(row.textContent).toMatch(/expired/i);
    expect(row.textContent).not.toMatch(/being checked/i);
  });
});

/**
 * Every disabled control says why it is disabled.
 *
 * Three buttons share the `rosterReady` gate — Join, Post and Schedule — and
 * until now only Join carried a hint; the other two went dead and silent in
 * exactly the state round 3 named. And any of them, plus Accept, can be dead
 * for the length of an in-flight call with nothing said at all.
 */
describe('signed in — a disabled control says why', () => {
  async function openPostPanel(container: HTMLElement) {
    const toggle = [...container.querySelectorAll('button')].find((b) => /Post an offer/i.test(b.textContent ?? ''))!;
    fireEvent.click(toggle);
    return waitFor(() => {
      const b = container.querySelector('.offer-post') as HTMLButtonElement | null;
      if (!b) throw new Error('post panel not open yet');
      return b;
    });
  }

  it('names its own action in the roster hint, rather than telling Post to queue', async () => {
    // The state round 3 named: own format of three, a six-member offer on the
    // board, six picked to reach it. Join says "Remove 3 to queue"; Post and
    // Schedule are dead under the same gate.
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-six', rosterSize: 6 })]);
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-six"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);
    await pick(container, 'medicham');
    await pick(container, 'swampert');
    await pick(container, 'bastiodon');

    const postBtn = await openPostPanel(container);
    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
    expect(postBtn.disabled).toBe(true);
    expect(schedBtn.disabled).toBe(true);
    expect(postBtn.getAttribute('title')).toBe('Remove 3 to post');
    expect(schedBtn.getAttribute('title')).toBe('Remove 3 to schedule');
    // Not the one verb the parameter used to be hardcoded to.
    expect(postBtn.getAttribute('title')).not.toMatch(/queue/);
    expect(schedBtn.getAttribute('title')).not.toMatch(/queue/);
  });

  it('tells Schedule apart from Post when the roster is fine and only the date is missing', async () => {
    // The one state where Schedule is dead and Post beside it is live. A
    // roster hint here would be actively wrong.
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await pickThree(container);
    const postBtn = await openPostPanel(container);
    const schedBtn = container.querySelector('.offer-schedule') as HTMLButtonElement;
    expect(postBtn.disabled).toBe(false);
    expect(postBtn.getAttribute('title')).toBeNull();
    expect(schedBtn.disabled).toBe(true);
    // The exact string, not a pattern: `getAttribute` returns null for a
    // missing title, and `toMatch(null)` is a TypeError rather than a
    // failed assertion — which is the difference between evidence and noise.
    expect(schedBtn.getAttribute('title')).toBe('Pick a date and time to schedule for');
    expect(schedBtn.getAttribute('title') ?? '').not.toMatch(/add|remove/i);
  });

  it('says why Accept is dead for the length of an in-flight call', async () => {
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-a' }), offer({ id: 'off-b' })]);
    let release!: (id: string | null) => void;
    mmApi.acceptOffer.mockReturnValue(new Promise<string | null>((res) => (release = res)));
    const { container } = await mount(fakeSession('u1', 'ash@example.com'));
    await waitFor(() => {
      if (!container.querySelector('[data-offer-id="off-b"]')) throw new Error('board not rendered yet');
    });
    await pickThree(container);
    const a = container.querySelector('[data-offer-id="off-a"] .offer-accept') as HTMLButtonElement;
    const b = container.querySelector('[data-offer-id="off-b"] .offer-accept') as HTMLButtonElement;
    expect(b.getAttribute('title')).toBeNull();
    await act(async () => {
      fireEvent.click(a);
    });
    // `canAccept(off-b)` is still true — `busy` is the only gate that shut,
    // and it is the one an undefined title left unexplained.
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('title')).toBe('Working — wait for the last action to finish');
    await act(async () => {
      release('m1');
    });
  });
});

/**
 * The whole reason the board exists: deciding whether to accept. A row that
 * says only WHEN an offer is for cannot answer "would I want this match", so
 * the roster the offer was posted with is rendered on it — for the open board
 * and for your own offers alike.
 *
 * `species.json` is GENERATED, and an offer is a row someone else wrote on
 * some other build. So a member the current data cannot resolve is a real
 * case, not a hypothetical, and the rule for it is the same one `decodeMember`
 * follows: say so, never substitute silently, and never take the row down
 * with it.
 */
describe('an offer row shows the roster it was posted with', () => {
  const signedIn = () => fakeSession('u1', 'ash@example.com');

  it('names every member of an open offer, in the order they were posted', async () => {
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-look' })]);
    const { container } = await mount(signedIn());
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-look"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    const names = [...row.querySelectorAll('.offer-roster-name')].map((n) => n.textContent);
    expect(names).toEqual(['Azumarill', 'Registeel', 'Skarmory']);
    // The sprite too, not just the word — a board is scanned, not read.
    expect(row.querySelectorAll('.offer-roster-mon img').length).toBe(3);
  });

  it('shows the roster on your own offers as well as on the open board', async () => {
    mmApi.myOffers.mockResolvedValue([myOffer({ id: 'off-own' })]);
    const { container } = await mount(signedIn());
    const row = await waitFor(() => {
      const r = container.querySelector('[data-my-offer-id="off-own"]');
      if (!r) throw new Error('your offers not rendered yet');
      return r;
    });
    expect([...row.querySelectorAll('.offer-roster-name')].map((n) => n.textContent)).toEqual([
      'Azumarill',
      'Registeel',
      'Skarmory',
    ]);
  });

  /**
   * A ref this build's `species.json` has never heard of. `speciesOf` returns
   * undefined and there is no sprite to draw, so the member degrades to the
   * only thing that is still true about it — the stored ref — and is marked as
   * unreadable rather than quietly rendered as a blank.
   */
  it('degrades a member the current data cannot resolve, and keeps the row', async () => {
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-odd', roster: [member('azumarill'), member('no-such-mon'), member('skarmory', 'AIR_SLASH')] }),
    ]);
    const { container } = await mount(signedIn());
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-odd"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    expect([...row.querySelectorAll('.offer-roster-name')].map((n) => n.textContent)).toEqual([
      'Azumarill',
      'no-such-mon',
      'Skarmory',
    ]);
    const odd = row.querySelector('[data-ref="no-such-mon"]')!;
    expect(odd.className).toMatch(/is-unreadable/);
    // The row itself survives intact — the offer is still browsable and still
    // acceptable. One bad member must not cost the board a whole offer.
    expect(row.querySelector('.offer-when')?.textContent).toMatch(/open now/i);
    expect(row.querySelector('.offer-accept')).toBeTruthy();
  });

  /**
   * `decodeMember` REPORTS a fast move the data no longer has instead of
   * substituting the first one — see its own comment. The row is the last
   * place that report could go, so it goes there.
   */
  it('marks a member whose stored fast move no longer exists rather than substituting one', async () => {
    mmApi.listOpenOffers.mockResolvedValue([
      offer({ id: 'off-move', rosterSize: 1, roster: [member('azumarill', 'MOVE_THAT_LEFT')] }),
    ]);
    const { container } = await mount(signedIn());
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-move"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    const mon = row.querySelector('[data-ref="azumarill"]') as HTMLElement | null;
    // Asserted before it is dereferenced. A missing element read straight
    // through raises TypeError, and a TypeError is not a failing assertion —
    // it is a test that stopped rather than one that decided.
    expect(mon, 'no roster entry rendered for azumarill').not.toBeNull();
    // Still Azumarill — the species resolved fine; it is the move that did not.
    expect(mon!.querySelector('.offer-roster-name')?.textContent).toBe('Azumarill');
    expect(mon!.dataset.unknownMove).toBe('MOVE_THAT_LEFT');
    expect(mon!.title).toMatch(/MOVE_THAT_LEFT/);
  });

  it('says so rather than rendering nothing when an offer carries no roster at all', async () => {
    mmApi.listOpenOffers.mockResolvedValue([offer({ id: 'off-bare', rosterSize: 0, roster: [] })]);
    const { container } = await mount(signedIn());
    const row = await waitFor(() => {
      const r = container.querySelector('[data-offer-id="off-bare"]');
      if (!r) throw new Error('board not rendered yet');
      return r;
    });
    expect(row.querySelector('.offer-roster')).toBeFalsy();
    // `unacceptableReason` already refuses this offer; the row must not also
    // render an empty list that reads as a roster of nobody.
    expect(row.textContent).toMatch(/without a roster/i);
  });
});

/**
 * jsdom applies no stylesheet, so nothing here asserts a rendered box. What a
 * test CAN hold is the rule itself, read as text — the established pattern in
 * this repo (see `add-modal-size.test.tsx`). The board grows on its own as
 * other people post to it; without a bound and its own scroll it pushes the
 * Post control and every panel below it down the page while someone is
 * reaching for them.
 */
describe('the offer board is bounded, not expanding', () => {
  const css = readFileSync('src/styles/components.css', 'utf8');

  function block(selector: string): string {
    const i = css.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
    expect(i, `${selector} not found at the top level`).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i) + 1);
  }

  it('caps the open board and scrolls inside that cap', () => {
    const rule = block('.offer-list');
    expect(rule).toMatch(/max-height:\s*\d/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it('caps your own offer list the same way', () => {
    const rule = block('.my-offer-list');
    expect(rule).toMatch(/max-height:\s*\d/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it('declares each of those selectors once at the top level', () => {
    // The .team-slots lesson: two rules for one selector, and the edit lands
    // on whichever you read rather than whichever wins.
    for (const sel of ['.offer-list', '.my-offer-list', '.offer-roster']) {
      expect(css.match(new RegExp(`^\\${sel}\\s*\\{`, 'gm')) ?? [], sel).toHaveLength(1);
    }
  });

  /**
   * The roster made every row taller, which is exactly the pressure the cap
   * above exists to resist. Two ways a child defeats a `max-height` box, and
   * this holds both shut: escaping it with `position: absolute`, or refusing
   * to wrap and forcing the box wider than the panel. Wrapping keeps a
   * six-member roster inside the cap's own scroll rather than beside it.
   */
  it('keeps the roster inside the capped, scrolling box rather than escaping it', () => {
    const rule = block('.offer-roster');
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(rule).not.toMatch(/position:\s*(absolute|fixed)/);
    // A second scroller nested in the first is two scrollbars for one list.
    expect(rule).not.toMatch(/overflow[^:]*:\s*(auto|scroll)/);
  });

  /** No colour literals — the design system's tokens or nothing. */
  it('styles the roster from tokens, never from a raw colour', () => {
    for (const sel of ['.offer-roster', '.offer-roster-mon', '.offer-roster-name']) {
      const rule = block(sel);
      expect(rule, sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule, sel).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
    }
  });

  /**
   * The rule's own comment claims .offer-blocked is sized like the control it
   * stands in for. Asserted against .chip-btn's ACTUAL declarations rather
   * than against the literal 32px, so the two cannot drift apart silently —
   * which is the whole failure mode the claim had before this round: a
   * sentence describing a box the rule never had.
   */
  it('gives the blocked reason the same box as the Accept control it replaces', () => {
    const chip = block('.chip-btn');
    const blocked = block('.offer-blocked');
    const decl = (rule: string, prop: string) =>
      rule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim() ?? null;

    expect(decl(chip, 'min-height'), '.chip-btn declares no min-height').not.toBeNull();
    expect(decl(blocked, 'min-height')).toBe(decl(chip, 'min-height'));
    expect(decl(blocked, 'padding')).toBe(decl(chip, 'padding'));
    // Height only bites on a box that can have one.
    expect(blocked).toMatch(/display:\s*inline-flex/);
  });
});
