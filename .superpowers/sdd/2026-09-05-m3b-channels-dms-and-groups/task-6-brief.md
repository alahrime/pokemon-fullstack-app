### Task 6: The client data layer, and a subscription that cleans up after itself

The Realtime subscription is where this codebase has been bitten before. `useFormats.ts` shipped a migration guarded by a `live` flag that React StrictMode's mount-unmount-mount defeated, and the fix was a module-scoped in-flight promise because *the thing that breaks is precisely the remount React state does not survive*. A channel subscription has the same shape: subscribe on mount, and a remount leaves two subscriptions delivering every message twice.

**Files:**
- Create: `app/src/lib/channels.ts`
- Test: `app/src/lib/__tests__/channels.test.ts`

**Interfaces:**
- Consumes: `open_dm`, `create_group`, `add_to_group`, `report_message` from Tasks 2 and 5.
- Produces:
  - `type ChannelKind = 'dm' | 'group' | 'match'`
  - `interface Channel { id: string; kind: ChannelKind; title: string | null; matchId: string | null; lastReadAt: string | null }`
  - `interface Message { id: string; channelId: string; authorId: string; body: string; createdAt: string; editedAt: string | null; deletedAt: string | null }`
  - `listChannels(): Promise<Channel[]>`
  - `listMessages(channelId: string, limit?: number): Promise<Message[]>`
  - `sendMessage(channelId: string, body: string): Promise<Message>`
  - `openDm(otherId: string): Promise<string>`
  - `createGroup(title: string, memberIds: string[]): Promise<string>`
  - `addToGroup(channelId: string, userId: string): Promise<boolean>`
  - `reportMessage(messageId: string, reason: string): Promise<string>`
  - `markRead(channelId: string): Promise<void>`
  - `subscribeToChannel(channelId: string, onMessage: (m: Message) => void): () => void`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/channels.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const removeChannel = vi.fn();
const subscribe = vi.fn().mockReturnValue({});
const on = vi.fn().mockReturnThis();
const channel = vi.fn(() => ({ on, subscribe }));

vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } }, error: null }) },
    channel,
    removeChannel,
  },
}));

const { subscribeToChannel } = await import('../channels');

beforeEach(() => {
  channel.mockClear();
  removeChannel.mockClear();
  subscribe.mockClear();
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/channels.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../channels"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/channels.ts
import { supabase } from './supabase';

export type ChannelKind = 'dm' | 'group' | 'match';

export interface Channel {
  id: string;
  kind: ChannelKind;
  title: string | null;
  matchId: string | null;
  lastReadAt: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    channelId: r.channel_id,
    authorId: r.author_id,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
  };
}

export async function listChannels(): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('id, kind, title, match_id, channel_members(last_read_at)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string; kind: ChannelKind; title: string | null; match_id: string | null;
      channel_members: { last_read_at: string | null }[];
    };
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      matchId: r.match_id,
      // The join is filtered by RLS to the rows this viewer may see, which for
      // channel_members is every member of a channel they belong to. Their own
      // row is the one with a read position that means anything to them.
      lastReadAt: r.channel_members[0]?.last_read_at ?? null,
    };
  });
}

export async function listMessages(channelId: string, limit = 100): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMessage(r as unknown as MessageRow)).reverse();
}

export async function sendMessage(channelId: string, body: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ channel_id: channelId, body })
    .select('id, channel_id, author_id, body, created_at, edited_at, deleted_at')
    .single();
  if (error) throw new Error(error.message);
  return toMessage(data as unknown as MessageRow);
}

export async function openDm(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_dm', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_title: title,
    p_members: memberIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function addToGroup(channelId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('add_to_group', {
    p_channel: channelId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function reportMessage(messageId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('report_message', {
    p_message: messageId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function markRead(channelId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) return;
  const { error } = await supabase
    .from('channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('user_id', me);
  if (error) throw new Error(error.message);
}

/**
 * Returns its own teardown, and the teardown is IDEMPOTENT.
 *
 * StrictMode mounts an effect, tears it down and mounts it again. A teardown
 * that removes "the subscription for channel X" rather than the specific
 * subscription it opened will, on the second call, remove the one the second
 * mount just created — leaving a live component wired to nothing. `useFormats`
 * shipped exactly this bug in a different costume; see the M1b notes in
 * docs/superpowers/HANDOFF.md.
 */
export function subscribeToChannel(
  channelId: string,
  onMessage: (m: Message) => void,
): () => void {
  const sub = supabase
    .channel(`messages:${channelId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload: { new: MessageRow }) => onMessage(toMessage(payload.new)),
    )
    .subscribe();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    supabase.removeChannel(sub);
  };
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/channels.ts app/src/lib/__tests__/channels.test.ts
git commit -m "feat(chat): the client data layer, with a teardown that survives a remount

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

