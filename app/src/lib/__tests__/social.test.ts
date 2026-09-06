import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: Record<string, unknown>[] = [];
const getSession = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession },
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    rpc: vi.fn().mockResolvedValue({ data: 'pending', error: null }),
  },
}));

const { listFriends } = await import('../social');

beforeEach(() => {
  rows.length = 0;
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } }, error: null });
});

describe('listFriends', () => {
  it('reports the other side of the pair from either seat', async () => {
    rows.push(
      { user_lo: 'me', user_hi: 'zed', requested_by: 'me', status: 'pending', created_at: 't' },
      { user_lo: 'abe', user_hi: 'me', requested_by: 'abe', status: 'accepted', created_at: 't' },
    );
    const friends = await listFriends();
    expect(friends).toEqual([
      { otherId: 'zed', status: 'pending', theyAsked: false, createdAt: 't' },
      { otherId: 'abe', status: 'accepted', theyAsked: true, createdAt: 't' },
    ]);
  });
});
