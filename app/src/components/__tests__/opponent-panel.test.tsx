import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const opponentFriendCode = vi.fn();
const myMatches = vi.fn();
const blockUser = vi.fn();
const patch = vi.fn();
const liveChallengesWith = vi.fn();
vi.mock('../../lib/matchmaking', () => ({
  opponentFriendCode: (...a: unknown[]) => opponentFriendCode(...a),
  myMatches: (...a: unknown[]) => myMatches(...a),
}));
vi.mock('../../lib/social', () => ({ blockUser: (...a: unknown[]) => blockUser(...a) }));
vi.mock('../../state/AppState', () => ({ useAppState: () => ({ patch }) }));
vi.mock('../../state/SessionContext', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
vi.mock('../../lib/challenges', async (orig) => ({
  ...(await orig<typeof import('../../lib/challenges')>()),
  liveChallengesWith: (...a: unknown[]) => liveChallengesWith(...a),
}));

import { OpponentPanel } from '../OpponentPanel';

const dm = { id: 'c1', kind: 'dm', matchId: null, otherId: 'u2', displayTitle: 'Ally' } as never;
const matchCh = { id: 'c3', kind: 'match', matchId: 'm2', otherId: null, displayTitle: 'Rival' } as never;

beforeEach(() => {
  opponentFriendCode.mockReset().mockResolvedValue('1234 5678 9012');
  myMatches.mockReset().mockResolvedValue([
    { id: 'm1', opponentId: 'u2' },
    { id: 'm2', opponentId: 'u3' },
    { id: 'm4', opponentId: 'u2' },
  ]);
  blockUser.mockReset().mockResolvedValue(true);
  liveChallengesWith.mockReset().mockResolvedValue([]);
  patch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OpponentPanel', () => {
  it('shows name, friend code and match count', async () => {
    render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    expect(screen.getByText('Ally')).toBeTruthy();
    expect(await screen.findByText('1234 5678 9012')).toBeTruthy();
    expect(await screen.findByText('2 matches together')).toBeTruthy();
  });

  it('says so when there is no friend code', async () => {
    opponentFriendCode.mockResolvedValue(null);
    render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    expect(await screen.findByText('No friend code shared')).toBeTruthy();
  });

  it('Challenge passes the opponent', () => {
    const onChallenge = vi.fn();
    render(<OpponentPanel channel={dm} onChallenge={onChallenge} />);
    fireEvent.click(screen.getByRole('button', { name: 'Challenge' }));
    expect(onChallenge).toHaveBeenCalledWith({ id: 'u2', name: 'Ally' });
  });

  it('Block blocks only when confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(blockUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(blockUser).toHaveBeenCalledWith('u2');
  });

  it('shows a quiet error when blocking fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    blockUser.mockRejectedValue(new Error('nope'));
    render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
  });

  it('never shows the previous DM\'s code or count while the next loads, and ignores a late reply', async () => {
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    opponentFriendCode.mockImplementation((id: string) => (id === 'u2' ? a.promise : b.promise));
    const dmB = { id: 'c9', kind: 'dm', matchId: null, otherId: 'u3', displayTitle: 'Bo' } as never;
    const { rerender } = render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    a.resolve('AAAA');
    expect(await screen.findByText('AAAA')).toBeTruthy();
    expect(await screen.findByText('2 matches together')).toBeTruthy();
    rerender(<OpponentPanel channel={dmB} onChallenge={() => {}} />);
    expect(screen.queryByText('AAAA')).toBeNull();
    expect(screen.queryByText('2 matches together')).toBeNull();
    expect(screen.queryByText('No friend code shared')).toBeNull();
    b.resolve('BBBB');
    expect(await screen.findByText('BBBB')).toBeTruthy();
    expect(screen.queryByText('AAAA')).toBeNull();
  });

  it('ignores a late reply for the previous DM', async () => {
    let resolveA!: (v: string | null) => void;
    opponentFriendCode.mockImplementation((id: string) =>
      id === 'u2' ? new Promise((r) => (resolveA = r)) : new Promise(() => {}),
    );
    const dmB = { id: 'c9', kind: 'dm', matchId: null, otherId: 'u3', displayTitle: 'Bo' } as never;
    const { rerender } = render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
    rerender(<OpponentPanel channel={dmB} onChallenge={() => {}} />);
    resolveA('LATE');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('LATE')).toBeNull();
  });

  it('a match channel offers only Open match', async () => {
    render(<OpponentPanel channel={matchCh} onChallenge={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Open match' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Open match' }));
    expect(patch).toHaveBeenCalledWith({ activeMatch: { id: 'm2', opponentId: 'u3' }, screen: 'match' });
  });

  describe('open challenges', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const ch = (o = {}) => ({
      id: 'o1', proposerId: 'me', targetId: 'u2', league: 'great', state: 'open', scheduledFor: null, expiresAt: future,
      verifiedHash: 'h', matchId: null, rosterSize: 3, formatName: 'Cup', ...o,
    });

    it('lists each live challenge between you, with who sent it and where it stands for you', async () => {
      liveChallengesWith.mockResolvedValue([ch(), ch({ id: 'o2', proposerId: 'u2', targetId: 'me', formatName: 'Sprint', league: 'ultra' })]);
      render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
      const section = await screen.findByRole('region', { name: 'Open challenges' });
      const rows = section.querySelectorAll('li');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toMatch(/You challenged.*Cup.*Waiting for them/);
      expect(rows[1].textContent).toMatch(/They challenged.*Sprint.*Waiting for you/);
      expect(liveChallengesWith).toHaveBeenCalledWith('u2');
    });

    it('shows nothing when there are none, and does not ask for a match channel', async () => {
      render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
      await waitFor(() => expect(liveChallengesWith).toHaveBeenCalled());
      expect(screen.queryByRole('region', { name: 'Open challenges' })).toBeNull();
      cleanup();
      liveChallengesWith.mockClear();
      render(<OpponentPanel channel={matchCh} onChallenge={() => {}} />);
      expect(liveChallengesWith).not.toHaveBeenCalled();
    });

    it('refreshes on a timer', async () => {
      vi.useFakeTimers();
      render(<OpponentPanel channel={dm} onChallenge={() => {}} />);
      await vi.advanceTimersByTimeAsync(0);
      const n = liveChallengesWith.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(liveChallengesWith.mock.calls.length).toBeGreaterThan(n);
      vi.useRealTimers();
    });
  });
});
