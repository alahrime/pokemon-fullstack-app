import { describe, it, expect, vi, beforeEach } from 'vitest';

const removeChannel = vi.fn();
const subscribe = vi.fn().mockReturnValue({});
const on = vi.fn().mockReturnThis();
const channel = vi.fn(() => ({ on, subscribe }));

// `getSession` is a `vi.fn` (rather than the brief's fixed arrow function) so
// the same mock can also drive the no-session guard tests further down —
// `subscribeToChannel` itself never calls it, so this does not change what
// the two tests below are exercising.
const getSession = vi.fn();

const rpc = vi.fn();

/**
 * Rows and errors each table's query should resolve with, keyed by table
 * name. Tests set these directly rather than through a fluent builder, since
 * the module under test is the only thing that needs to believe the chain is
 * fluent.
 */
let rows: Record<string, unknown[]> = {};
let insertResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateError: unknown = null;
let calls: { table: string; op: string; payload?: unknown }[] = [];

function table(name: string) {
  const q: Record<string, unknown> = {
    select: vi.fn((cols?: unknown) => {
      calls.push({ table: name, op: 'select', payload: cols });
      return q;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.push({ table: name, op: 'eq', payload: [col, val] });
      return q;
    }),
    order: vi.fn((col: string, opts?: unknown) => {
      calls.push({ table: name, op: 'order', payload: [col, opts] });
      return q;
    }),
    limit: vi.fn((n: number) => {
      calls.push({ table: name, op: 'limit', payload: n });
      return q;
    }),
    insert: vi.fn((payload: unknown) => {
      calls.push({ table: name, op: 'insert', payload });
      return q;
    }),
    update: vi.fn((payload: unknown) => {
      calls.push({ table: name, op: 'update', payload });
      return q;
    }),
    single: vi.fn(async () => insertResult),
    // The mapping helpers each `await` the chain directly rather than calling
    // a terminal method, so the chain object itself must be thenable.
    then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: rows[name] ?? [], error: updateError }).then(res),
  };
  return q;
}

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession },
    channel,
    removeChannel,
    from: (n: string) => table(n),
    rpc,
  },
}));

const {
  listChannels,
  listMessages,
  sendMessage,
  openDm,
  createGroup,
  addToGroup,
  reportMessage,
  markRead,
  subscribeToChannel,
} = await import('../channels');

beforeEach(() => {
  channel.mockClear();
  removeChannel.mockClear();
  subscribe.mockClear();
  on.mockClear();
  rpc.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } }, error: null });
  rows = {};
  insertResult = { data: null, error: null };
  updateError = null;
  calls = [];
});

describe('subscribeToChannel', () => {
  it('opens one subscription and tears it down exactly once', () => {
    const stop = subscribeToChannel('c1', () => {});
    expect(channel).toHaveBeenCalledTimes(1);
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    // A double unsubscribe is what a StrictMode remount produces. It must not
    // remove a subscription some LATER mount has since opened.
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('opens a separate subscription per mount', () => {
    const a = subscribeToChannel('c1', () => {});
    const b = subscribeToChannel('c1', () => {});
    expect(channel).toHaveBeenCalledTimes(2);
    a();
    b();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });

  it('delivers an INSERT payload to the caller as a mapped Message', () => {
    const onMessage = vi.fn();
    subscribeToChannel('c1', onMessage);
    // `.on(event, filter, handler)` — grab the handler the module registered
    // and drive it the way Realtime would, with a raw snake_case row.
    const handler = on.mock.calls[0][2] as (p: { new: Record<string, unknown> }) => void;
    handler({
      new: {
        id: 'm1',
        channel_id: 'c1',
        author_id: 'them',
        body: 'hey',
        created_at: 't1',
        edited_at: null,
        deleted_at: null,
      },
    });
    expect(onMessage).toHaveBeenCalledWith({
      id: 'm1',
      channelId: 'c1',
      authorId: 'them',
      body: 'hey',
      createdAt: 't1',
      editedAt: null,
      deletedAt: null,
    });
  });
});

describe('listChannels', () => {
  it('maps the channel_members join to lastReadAt, or null with no row', async () => {
    rows.channels = [
      {
        id: 'c1', kind: 'dm', title: null, match_id: null,
        channel_members: [{ last_read_at: '2026-01-01T00:00:00Z' }],
      },
      {
        id: 'c2', kind: 'group', title: 'Squad', match_id: null,
        channel_members: [],
      },
    ];
    expect(await listChannels()).toEqual([
      { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: '2026-01-01T00:00:00Z' },
      { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null },
    ]);
  });
});

describe('listMessages', () => {
  it('queries newest-first but returns chronological order', async () => {
    rows.messages = [
      { id: 'm3', channel_id: 'c1', author_id: 'a', body: 'third', created_at: 't3', edited_at: null, deleted_at: null },
      { id: 'm2', channel_id: 'c1', author_id: 'a', body: 'second', created_at: 't2', edited_at: null, deleted_at: null },
      { id: 'm1', channel_id: 'c1', author_id: 'a', body: 'first', created_at: 't1', edited_at: null, deleted_at: null },
    ];
    const messages = await listMessages('c1');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(calls).toContainEqual({ table: 'messages', op: 'eq', payload: ['channel_id', 'c1'] });
    expect(calls).toContainEqual({ table: 'messages', op: 'limit', payload: 100 });
  });

  it('forwards a caller-supplied limit', async () => {
    rows.messages = [];
    await listMessages('c1', 20);
    expect(calls).toContainEqual({ table: 'messages', op: 'limit', payload: 20 });
  });
});

describe('sendMessage', () => {
  it('inserts the body under the given channel and returns the mapped row', async () => {
    insertResult = {
      data: {
        id: 'm9', channel_id: 'c1', author_id: 'me', body: 'hi',
        created_at: 't9', edited_at: null, deleted_at: null,
      },
      error: null,
    };
    const sent = await sendMessage('c1', 'hi');
    expect(sent).toEqual({
      id: 'm9', channelId: 'c1', authorId: 'me', body: 'hi',
      createdAt: 't9', editedAt: null, deletedAt: null,
    });
    expect(calls).toContainEqual({
      table: 'messages', op: 'insert', payload: { channel_id: 'c1', body: 'hi' },
    });
  });
});

describe('RPC wrappers', () => {
  it('openDm passes the other id and returns the channel id', async () => {
    rpc.mockResolvedValue({ data: 'chan-1', error: null });
    expect(await openDm('them')).toBe('chan-1');
    expect(rpc).toHaveBeenCalledWith('open_dm', { p_other: 'them' });
  });

  it('createGroup passes the title and member list', async () => {
    rpc.mockResolvedValue({ data: 'chan-2', error: null });
    expect(await createGroup('Squad', ['a', 'b'])).toBe('chan-2');
    expect(rpc).toHaveBeenCalledWith('create_group', { p_title: 'Squad', p_members: ['a', 'b'] });
  });

  it('addToGroup passes the channel and the user being added', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await addToGroup('chan-2', 'c')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('add_to_group', { p_channel: 'chan-2', p_user: 'c' });
  });

  it('reportMessage passes the message and reason', async () => {
    rpc.mockResolvedValue({ data: 'report-1', error: null });
    expect(await reportMessage('m1', 'spam')).toBe('report-1');
    expect(rpc).toHaveBeenCalledWith('report_message', { p_message: 'm1', p_reason: 'spam' });
  });

  it('surfaces the RPC error message rather than swallowing it', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'blocked' } });
    await expect(openDm('them')).rejects.toThrow('blocked');
  });
});

describe('markRead', () => {
  it('stamps last_read_at for the signed-in member', async () => {
    await markRead('c1');
    expect(calls).toContainEqual({
      table: 'channel_members', op: 'eq', payload: ['channel_id', 'c1'],
    });
    expect(calls).toContainEqual({
      table: 'channel_members', op: 'eq', payload: ['user_id', 'me'],
    });
    const updateCall = calls.find((c) => c.table === 'channel_members' && c.op === 'update');
    expect(updateCall).toBeDefined();
  });

  /**
   * `markRead` derives `me` from the session to filter which row it updates —
   * the same shape `myMatches` (matches.ts) and `listFriends` (social.ts)
   * were each found fabricating a result for. There is nothing here for an
   * undefined `me` to fabricate (an update with `user_id=eq.undefined` just
   * matches no row), but a query built and sent with `undefined` baked into
   * it is a bug in waiting, and the pattern this codebase now enforces is:
   * guard at the top, and prove it with a no-session test. This only passes
   * if `markRead` returns before issuing any query at all.
   */
  it('does nothing when there is no session, rather than updating with an undefined user_id', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(markRead('c1')).resolves.toBeUndefined();
    expect(calls.some((c) => c.table === 'channel_members')).toBe(false);
  });
});
