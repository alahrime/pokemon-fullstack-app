import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const opponentFriendCode = vi.fn();
const myMatches = vi.fn();
const blockUser = vi.fn();
const patch = vi.fn();
vi.mock('../../lib/matchmaking', () => ({
  opponentFriendCode: (...a: unknown[]) => opponentFriendCode(...a),
  myMatches: (...a: unknown[]) => myMatches(...a),
}));
vi.mock('../../lib/social', () => ({ blockUser: (...a: unknown[]) => blockUser(...a) }));
vi.mock('../../state/AppState', () => ({ useAppState: () => ({ patch }) }));

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

  it('a match channel offers only Open match', async () => {
    render(<OpponentPanel channel={matchCh} onChallenge={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Open match' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Open match' }));
    expect(patch).toHaveBeenCalledWith({ activeMatch: { id: 'm2', opponentId: 'u3' }, screen: 'match' });
  });
});
