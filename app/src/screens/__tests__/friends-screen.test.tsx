import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { FriendsScreen } from '../FriendsScreen';

const respondToFriendship = vi.fn();
const requestFriendship = vi.fn();
const removeFriendship = vi.fn();
const blockUser = vi.fn();
const unblockUser = vi.fn();

vi.mock('../../lib/social', () => ({
  listFriends: async () => [
    { otherId: 'incoming', status: 'pending', theyAsked: true, createdAt: 't' },
    { otherId: 'outgoing', status: 'pending', theyAsked: false, createdAt: 't' },
    { otherId: 'mate', status: 'accepted', theyAsked: false, createdAt: 't' },
  ],
  listBlocks: async () => ['blocked'],
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

// The search box bypasses `social.ts` entirely — it reads `profiles` directly
// — so it needs its own stand-in for the client rather than piggybacking on
// the mock above. `auth` is stubbed the same way `src/test/setup.ts` stubs it
// for the whole suite (this file-level mock of the same module REPLACES that
// one), because `renderApp` mounts `SessionProvider`, which calls
// `onAuthStateChange` on the same client. Every query method but the
// terminal one just returns the same chainable object, the same duck-typed
// "thenable" shape `../supabase.ts`'s own query builder has.
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
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
      },
      from: () => chain(),
    },
  };
});

beforeEach(() => {
  respondToFriendship.mockReset().mockResolvedValue('accepted');
  requestFriendship.mockReset().mockResolvedValue('pending');
  removeFriendship.mockReset().mockResolvedValue(true);
  blockUser.mockReset().mockResolvedValue(true);
  unblockUser.mockReset().mockResolvedValue(undefined);
  opponentFriendCode.mockReset().mockResolvedValue(null);
  searchRows.length = 0;
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
    const withdraw = await screen.findByRole('button', { name: /^withdraw$/i });
    fireEvent.click(withdraw);
    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('outgoing'));
  });

  it('offers Remove and Block on an accepted friend', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('mate'));
    fireEvent.click(await screen.findByRole('button', { name: /^block$/i }));
    await waitFor(() => expect(blockUser).toHaveBeenCalledWith('mate'));
  });

  it('shows a friend code once friend_codes returns one', async () => {
    opponentFriendCode.mockImplementation(async (id: string) => (id === 'mate' ? '1234 5678 9012' : null));
    renderApp(<FriendsScreen />);
    expect(await screen.findByText('1234 5678 9012')).toBeInTheDocument();
  });

  it('lists a blocked account with Unblock', async () => {
    renderApp(<FriendsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^unblock$/i }));
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith('blocked'));
  });

  it('finds a profile by display name and sends a request', async () => {
    searchRows.push({ id: 'found-id', display_name: 'Ferra' });
    renderApp(<FriendsScreen />);
    fireEvent.change(screen.getByLabelText(/search by display name/i), { target: { value: 'Ferra' } });
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
    fireEvent.change(screen.getByLabelText(/search by display name/i), { target: { value: 'Ferra' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send friend request/i }));
    expect(await screen.findByText('that person cannot be sent a friend request')).toBeInTheDocument();
  });
});
