### Task 4: The client data layer

**Files:**
- Create: `app/src/lib/social.ts`
- Test: `app/src/lib/__tests__/social.test.ts`

**Interfaces:**
- Consumes: the four RPCs from Task 2.
- Produces:
  - `type FriendshipStatus = 'pending' | 'accepted'`
  - `interface Friend { otherId: string; status: FriendshipStatus; theyAsked: boolean; createdAt: string }`
  - `listFriends(): Promise<Friend[]>`
  - `requestFriendship(targetId: string): Promise<FriendshipStatus>`
  - `respondToFriendship(otherId: string, accept: boolean): Promise<'accepted' | 'removed'>`
  - `removeFriendship(otherId: string): Promise<boolean>`
  - `blockUser(targetId: string): Promise<boolean>`
  - `listBlocks(): Promise<string[]>`
  - `unblockUser(targetId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/social.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/social.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../social"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/social.ts
import { supabase } from './supabase';

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friend {
  otherId: string;
  status: FriendshipStatus;
  /** True when the OTHER person sent the request, i.e. it is yours to accept. */
  theyAsked: boolean;
  createdAt: string;
}

async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

export async function listFriends(): Promise<Friend[]> {
  const me = await myId();
  const { data, error } = await supabase
    .from('friendships')
    .select('user_lo, user_hi, requested_by, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      user_lo: string; user_hi: string; requested_by: string;
      status: FriendshipStatus; created_at: string;
    };
    return {
      otherId: r.user_lo === me ? r.user_hi : r.user_lo,
      status: r.status,
      theyAsked: r.requested_by !== me,
      createdAt: r.created_at,
    };
  });
}

export async function requestFriendship(targetId: string): Promise<FriendshipStatus> {
  const { data, error } = await supabase.rpc('request_friendship', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as FriendshipStatus;
}

export async function respondToFriendship(
  otherId: string,
  accept: boolean,
): Promise<'accepted' | 'removed'> {
  const { data, error } = await supabase.rpc('respond_to_friendship', {
    p_other: otherId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  return data as 'accepted' | 'removed';
}

export async function removeFriendship(otherId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('remove_friendship', { p_other: otherId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function blockUser(targetId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function listBlocks(): Promise<string[]> {
  const { data, error } = await supabase.from('blocks').select('blocked_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as unknown as { blocked_id: string }).blocked_id);
}

export async function unblockUser(targetId: string): Promise<void> {
  const { error } = await supabase.from('blocks').delete().eq('blocked_id', targetId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/social.ts app/src/lib/__tests__/social.test.ts
git commit -m "feat(social): the client data layer for friends and blocks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

