import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { FriendsScreen } from '../FriendsScreen';

const respondToFriendship = vi.fn();
const requestFriendship = vi.fn();
const removeFriendship = vi.fn();
const blockUser = vi.fn();
const unblockUser = vi.fn();

let friendRows: { otherId: string; status: 'pending' | 'accepted'; theyAsked: boolean; createdAt: string }[] = [];
let blockedRows: string[] = [];

function defaultFriendRows() {
  return [
    { otherId: 'incoming', status: 'pending' as const, theyAsked: true, createdAt: 't' },
    { otherId: 'outgoing', status: 'pending' as const, theyAsked: false, createdAt: 't' },
    { otherId: 'mate', status: 'accepted' as const, theyAsked: false, createdAt: 't' },
  ];
}

vi.mock('../../lib/social', () => ({
  listFriends: async () => friendRows,
  listBlocks: async () => blockedRows,
  respondToFriendship: (...a: unknown[]) => respondToFriendship(...a),
  requestFriendship: (...a: unknown[]) => requestFriendship(...a),
  removeFriendship: (...a: unknown[]) => removeFriendship(...a),
  blockUser: (...a: unknown[]) => blockUser(...a),
  unblockUser: (...a: unknown[]) => unblockUser(...a),
}));

const opponentFriendCode = vi.fn();
vi.mock('../../lib/matchmaking', () => ({
  opponentFriendCode: (...a: unknown[]) => opponentFriendCode(...a),
}));

/**
 * `renderApp`'s own `SessionProvider` settles signed-out for the whole suite
 * (see its doc comment) — right for most screens, but `FriendsScreen` now
 * gates its whole body on a session (Task 5 CONTROLLER RULING), so every test
 * here needs a session-bearing harness instead. `sessionId` is this file's
 * own control for signed-in vs signed-out, mirroring how `team-saves.test.tsx`
 * and `sign-in.test.tsx` each build a harness with a real session rather than
 * accepting the suite-wide signed-out default. This file-level mock of
 * `../../lib/supabase` REPLACES the shared stub — a file-level mock always
 * wins — and doubles as the search box's stand-in for the client, since the
 * search bypasses `lib/social.ts` and reads `profiles` directly.
 */
let sessionId: string | null = 'me';

const searchRows: { id: string; display_name: string }[] = [];
vi.mock('../../lib/supabase', () => {
  function chain() {
    // `unknown` rather than `PromiseLike<...>`: the real query builder's
    // `.then` signature has two optional, overloaded callback parameters,
    // which a plain mock only has to satisfy at the call site (`await`),
    // never at the type level.
    const q: Record<string, unknown> = {};
    q.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: searchRows, error: null }));
    q.select = () => q;
    q.ilike = () => q;
    q.limit = () => q;
    return q;
  }
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: sessionId ? { user: { id: sessionId } } : null },
          error: null,
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
      },
      from: () => chain(),
    },
  };
});

beforeEach(() => {
  sessionId = 'me';
  friendRows = defaultFriendRows();
  blockedRows = ['blocked'];
  respondToFriendship.mockReset().mockResolvedValue('accepted');
  requestFriendship.mockReset().mockResolvedValue('pending');
  removeFriendship.mockReset().mockResolvedValue(true);
  blockUser.mockReset().mockResolvedValue(true);
  unblockUser.mockReset().mockResolvedValue(undefined);
  opponentFriendCode.mockReset().mockResolvedValue(null);
  searchRows.length = 0;
});

describe('signed out', () => {
  /**
   * The gate itself (Finding 3): a signed-out visitor must see a sign-in
   * panel, not the four sections truthfully-but-misleadingly reporting empty.
   */
  it('shows a sign-in panel instead of the four sections', async () => {
    sessionId = null;
    renderApp(<FriendsScreen />);
    expect(await screen.findByText(/sign in to send and accept friend requests/i)).toBeInTheDocument();
    expect(screen.queryByText(/requests waiting on you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no friends yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you have not blocked anyone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search by display name/i)).not.toBeInTheDocument();
  });
});

describe('friends screen', () => {
  it('offers Accept only on a request somebody sent to you', async () => {
    renderApp(<FriendsScreen />);
    expect(await screen.findByRole('button', { name: /accept incoming/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept outgoing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting on them/i)).toBeInTheDocument();
  });

  it('accepts a request', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /accept incoming/i }));
    await waitFor(() => expect(respondToFriendship).toHaveBeenCalledWith('incoming', true));
  });

  it('declines a request', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /decline incoming/i }));
    await waitFor(() => expect(respondToFriendship).toHaveBeenCalledWith('incoming', false));
  });

  it('withdraws a request you sent, without ever offering to accept it', async () => {
    renderApp(<FriendsScreen />);
    const withdraw = await screen.findByRole('button', { name: /^withdraw outgoing$/i });
    fireEvent.click(withdraw);
    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('outgoing'));
  });

  it('offers Remove and Block on an accepted friend', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^remove mate$/i }));
    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('mate'));
    fireEvent.click(await screen.findByRole('button', { name: /^block mate$/i }));
    await waitFor(() => expect(blockUser).toHaveBeenCalledWith('mate'));
  });

  /**
   * Pins Finding 2: before the per-row id was added, `Remove`, `Block`,
   * `Withdraw` and `Unblock` shared one accessible name across every row, so
   * a screen-reader user navigating by an elements list (not linearly) could
   * not tell rows apart. The brief's own two-row fixture is the point — the
   * original 9 tests all used exactly one row per section, which is why none
   * of them could have caught this.
   */
  it('gives each Remove button in a multi-friend list its own accessible name', async () => {
    friendRows = [
      { otherId: 'alpha', status: 'accepted', theyAsked: false, createdAt: 't' },
      { otherId: 'beta', status: 'accepted', theyAsked: false, createdAt: 't' },
    ];
    renderApp(<FriendsScreen />);
    const removeAlpha = await screen.findByRole('button', { name: /^remove alpha$/i });
    const removeBeta = await screen.findByRole('button', { name: /^remove beta$/i });
    expect(removeAlpha).not.toBe(removeBeta);
    fireEvent.click(removeAlpha);
    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('alpha'));
  });

  it('shows a friend code once friend_codes returns one', async () => {
    opponentFriendCode.mockImplementation(async (id: string) => (id === 'mate' ? '1234 5678 9012' : null));
    renderApp(<FriendsScreen />);
    expect(await screen.findByText('1234 5678 9012')).toBeInTheDocument();
  });

  it('lists a blocked account with Unblock', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^unblock blocked$/i }));
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith('blocked'));
  });

  it('finds a profile by display name and sends a request', async () => {
    searchRows.push({ id: 'found-id', display_name: 'Ferra' });
    renderApp(<FriendsScreen />);
    fireEvent.change(await screen.findByLabelText(/search by display name/i), { target: { value: 'Ferra' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send friend request/i }));
    await waitFor(() => expect(requestFriendship).toHaveBeenCalledWith('found-id'));
  });

  // `request_friendship` deliberately raises the same uninformative sentence
  // whether the target is blocked in either direction, does not exist, or is
  // yourself — a distinguishable error would work as a block detector. This
  // proves the screen surfaces it unedited rather than translating it into
  // something friendlier or more specific.
  it('renders a friend-request failure verbatim, without reinterpreting it', async () => {
    searchRows.push({ id: 'found-id', display_name: 'Ferra' });
    requestFriendship.mockRejectedValue(new Error('that person cannot be sent a friend request'));
    renderApp(<FriendsScreen />);
    fireEvent.change(await screen.findByLabelText(/search by display name/i), { target: { value: 'Ferra' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send friend request/i }));
    expect(await screen.findByText('that person cannot be sent a friend request')).toBeInTheDocument();
  });
});
