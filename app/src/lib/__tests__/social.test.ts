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

  /**
   * Pins the finding: with `me` undefined, `r.user_lo === me` is false for
   * every row (collapsing `otherId` to always `r.user_lo`) and
   * `r.requested_by !== me` is always true — every request, including one's
   * own outgoing ones, would render as incoming with an Accept button. The
   * `friendships` SELECT policy (`to authenticated`, no `anon` grant) is what
   * makes an unauthenticated `select` come back `[]` in production, but this
   * test does not rely on that: the mocked `from().select().order()` above
   * returns a real row regardless of session, so this only passes if
   * `listFriends` itself refuses to map when it has no session id — the same
   * shape `matches.test.ts` pins for `myMatches`.
   */
  it('returns no friends rather than fabricating a direction, when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    rows.push({ user_lo: 'abe', user_hi: 'zed', requested_by: 'abe', status: 'pending', created_at: 't' });
    expect(await listFriends()).toEqual([]);
  });
});
