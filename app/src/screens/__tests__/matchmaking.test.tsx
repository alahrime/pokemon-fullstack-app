import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, act, fireEvent, cleanup, waitFor, type RenderResult } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import type { QueueEntry, Match, MyOffer, Offer } from '../../lib/matchmaking';
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
    rosterSize: 3,
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
    matchId: null,
    rosterSize: 3,
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
    for (const sel of ['.offer-list', '.my-offer-list']) {
      expect(css.match(new RegExp(`^\\${sel}\\s*\\{`, 'gm')) ?? [], sel).toHaveLength(1);
    }
  });
});
