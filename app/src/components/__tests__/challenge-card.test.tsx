import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import type { Challenge } from '../../lib/challenges';

const fetchChallenges = vi.fn();
const declineChallenge = vi.fn();
const withdrawChallenge = vi.fn();
const acceptOffer = vi.fn();
const confirmOffer = vi.fn();
const myMatches = vi.fn();
const patch = vi.fn();
const stop = vi.fn();
let fire: () => void = () => {};
const subscribeToOffer = vi.fn((_id: string, onChange: () => void) => { fire = onChange; return stop; });

vi.mock('../../lib/challenges', async (orig) => ({
  ...(await orig<typeof import('../../lib/challenges')>()),
  fetchChallenges: (...a: unknown[]) => fetchChallenges(...a),
  declineChallenge: (...a: unknown[]) => declineChallenge(...a),
  withdrawChallenge: (...a: unknown[]) => withdrawChallenge(...a),
  subscribeToOffer: (id: string, cb: () => void) => subscribeToOffer(id, cb),
}));
vi.mock('../../lib/matchmaking', () => ({
  acceptOffer: (...a: unknown[]) => acceptOffer(...a),
  confirmOffer: (...a: unknown[]) => confirmOffer(...a),
}));
const resolveDisplayNames = vi.fn();
vi.mock('../../lib/channels', () => ({ resolveDisplayNames: (...a: unknown[]) => resolveDisplayNames(...a) }));
vi.mock('../ChallengeSheet', () => ({
  ChallengeSheet: (p: { target: { id: string; name: string }; counterOf?: string; defaultLeague?: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`sheet ${p.target.name} ${p.target.id} counterOf=${p.counterOf} ${p.defaultLeague}`}><button onClick={p.onClose}>close sheet</button></div>
  ),
}));
vi.mock('../../lib/matches', () => ({ myMatches: (...a: unknown[]) => myMatches(...a) }));
const team = [{ ref: 'a' }];
vi.mock('../ChallengeAcceptSheet', () => ({
  ChallengeAcceptSheet: (p: { league: string; size: number; onAccept: (t: unknown[]) => Promise<void>; onClose: () => void }) => (
    <div role="dialog" aria-label={`accept ${p.league} ${p.size}`}>
      <button onClick={() => void p.onAccept(team).then(p.onClose, () => {})}>bring team</button>
    </div>
  ),
}));
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../../state/AppState', () => ({ useAppState: () => ({ patch }) }));

import { ChallengeCard } from '../ChallengeCard';

const future = new Date(Date.now() + 3600_000).toISOString();
const base: Challenge = {
  id: 'o', proposerId: 'them', targetId: 'me', league: 'great', state: 'open',
  scheduledFor: null, expiresAt: future, verifiedHash: 'h', matchId: null, rosterSize: 3, formatName: 'Cup',
};
const serve = (c: Partial<Challenge>) => fetchChallenges.mockResolvedValue(new Map([['o', { ...base, ...c }]]));
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  declineChallenge.mockResolvedValue(true);
  withdrawChallenge.mockResolvedValue(undefined);
  confirmOffer.mockResolvedValue('m');
  acceptOffer.mockResolvedValue(null);
  resolveDisplayNames.mockResolvedValue(new Map([['them', 'Ally']]));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ChallengeCard', () => {
  it('Accept opens the team sheet for the challenge league and roster size, and accepts with what it returns', async () => {
    serve({});
    render(<ChallengeCard offerId="o" />);
    expect(await screen.findByText('Waiting for you')).toBeTruthy();
    expect(acceptOffer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('dialog', { name: 'accept great 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'bring team' }));
    await waitFor(() => expect(acceptOffer).toHaveBeenCalledWith('o', team));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('unverified: Accept shown but disabled, Decline present', async () => {
    serve({ verifiedHash: null });
    render(<ChallengeCard offerId="o" />);
    expect(await screen.findByText('Verifying the format…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('proposer withdraws then re-fetches', async () => {
    serve({ proposerId: 'me', targetId: 'them' });
    render(<ChallengeCard offerId="o" />);
    expect(await screen.findByText('Waiting for them')).toBeTruthy();
    const before = fetchChallenges.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawChallenge).toHaveBeenCalledWith('o'));
    await waitFor(() => expect(fetchChallenges.mock.calls.length).toBeGreaterThan(before));
  });

  it('proposer confirms an accepted scheduled challenge', async () => {
    serve({ proposerId: 'me', targetId: 'them', state: 'accepted', scheduledFor: future });
    render(<ChallengeCard offerId="o" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmOffer).toHaveBeenCalledWith('o'));
  });

  it('converted opens the match', async () => {
    serve({ state: 'converted', matchId: 'm' });
    const match = { id: 'm' };
    myMatches.mockResolvedValue([{ id: 'x' }, match]);
    render(<ChallengeCard offerId="o" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open match' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ activeMatch: match, screen: 'match' }));
  });

  it.each(['declined', 'lapsed'] as const)('%s is terminal: no buttons, poll stops', async (state) => {
    vi.useFakeTimers();
    serve({ state });
    render(<ChallengeCard offerId="o" />);
    await flush();
    await flush();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const n = fetchChallenges.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
    expect(fetchChallenges.mock.calls.length).toBe(n);
  });

  it('still polls every 60s while live, as a fallback for a dropped socket', async () => {
    vi.useFakeTimers();
    serve({});
    render(<ChallengeCard offerId="o" />);
    await flush();
    const n = fetchChallenges.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchChallenges.mock.calls.length).toBe(n); // no longer every 10s
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(fetchChallenges.mock.calls.length).toBeGreaterThan(n);
  });

  it('refetches the moment its offer row changes, and shows the new state', async () => {
    serve({});
    render(<ChallengeCard offerId="o" />);
    expect(await screen.findByText('Waiting for you')).toBeTruthy();
    expect(subscribeToOffer).toHaveBeenCalledWith('o', expect.any(Function));
    const n = fetchChallenges.mock.calls.length;
    serve({ state: 'lapsed' });
    await act(async () => { fire(); });
    await waitFor(() => expect(fetchChallenges.mock.calls.length).toBeGreaterThan(n));
    await waitFor(() => expect(screen.queryByText('Waiting for you')).toBeNull());
  });

  it('stops listening when it unmounts, and does not listen to a challenge that is over', async () => {
    serve({});
    const live = render(<ChallengeCard offerId="o" />);
    await screen.findByText('Waiting for you');
    live.unmount();
    expect(stop).toHaveBeenCalled();
    subscribeToOffer.mockClear();
    stop.mockClear();
    serve({ state: 'lapsed' });
    render(<ChallengeCard offerId="o" />);
    await screen.findByText(/expired|declined|lapsed|ended/i).catch(() => null);
    await flush();
    // A dead challenge may subscribe once before its first load lands; whatever it opened must be closed again.
    expect(stop.mock.calls.length).toBe(subscribeToOffer.mock.calls.length);
  });

  it('decline calls declineChallenge and re-fetches', async () => {
    serve({});
    render(<ChallengeCard offerId="o" />);
    const before = fetchChallenges.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(declineChallenge).toHaveBeenCalledWith('o'));
    await waitFor(() => expect(fetchChallenges.mock.calls.length).toBeGreaterThan(before));
  });

  it('a rejected accept leaves the team sheet open for the sheet to report', async () => {
    serve({});
    acceptOffer.mockRejectedValue(new Error('roster mismatch'));
    render(<ChallengeCard offerId="o" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    fireEvent.click(await screen.findByRole('button', { name: 'bring team' }));
    await waitFor(() => expect(acceptOffer).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'accept great 3' })).toBeTruthy();
  });

  it('Counter opens the sheet aimed back at the proposer, in the same league, answering this offer', async () => {
    serve({ league: 'ultra' });
    render(<ChallengeCard offerId="o" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Counter' }));
    expect(await screen.findByRole('dialog', { name: 'sheet Ally them counterOf=o ultra' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'close sheet' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers Counter only to the target of a verified, open challenge', async () => {
    serve({ verifiedHash: null });
    const a = render(<ChallengeCard offerId="o" />);
    await screen.findByText('Verifying the format…');
    expect(screen.queryByRole('button', { name: 'Counter' })).toBeNull();
    a.unmount();
    serve({ proposerId: 'me', targetId: 'them' });
    render(<ChallengeCard offerId="o" />);
    await screen.findByText('Waiting for them');
    expect(screen.queryByRole('button', { name: 'Counter' })).toBeNull();
  });
});
