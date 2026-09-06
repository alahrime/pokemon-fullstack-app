### Task 5: The Friends screen

Four sections: requests waiting on you, requests you sent, accepted friends, and people you have blocked. People are found by display name, which `profiles` already exposes.

**Files:**
- Create: `app/src/screens/FriendsScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Test: `app/src/screens/__tests__/friends-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/social.ts` (Task 4).
- Produces: a `friends` screen id registered in `screens.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/friends-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
import { FriendsScreen } from '../FriendsScreen';

const respondToFriendship = vi.fn();
vi.mock('../../lib/social', () => ({
  listFriends: async () => [
    { otherId: 'incoming', status: 'pending', theyAsked: true, createdAt: 't' },
    { otherId: 'outgoing', status: 'pending', theyAsked: false, createdAt: 't' },
    { otherId: 'mate', status: 'accepted', theyAsked: false, createdAt: 't' },
  ],
  listBlocks: async () => ['blocked'],
  respondToFriendship: (...a: unknown[]) => respondToFriendship(...a),
  requestFriendship: vi.fn(),
  removeFriendship: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

beforeEach(() => respondToFriendship.mockReset().mockResolvedValue('accepted'));

describe('friends screen', () => {
  it('offers Accept only on a request somebody sent to you', async () => {
    render(<FriendsScreen />);
    expect(await screen.findByRole('button', { name: /accept incoming/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept outgoing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting on them/i)).toBeInTheDocument();
  });

  it('accepts a request', async () => {
    render(<FriendsScreen />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /accept incoming/i }));
    await waitFor(() => expect(respondToFriendship).toHaveBeenCalledWith('incoming', true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/friends-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../FriendsScreen"`.

- [ ] **Step 3: Write the screen**

Render four `<section>`s driven by one `listFriends()` call plus one `listBlocks()` call, partitioned in the component:

- **Requests waiting on you** — `status === 'pending' && theyAsked`. Two buttons per row, labelled `Accept {otherId}` and `Decline {otherId}`, calling `respondToFriendship(otherId, true|false)`.
- **Requests you sent** — `status === 'pending' && !theyAsked`. No Accept button; the row reads `Waiting on them`, with a `Withdraw` button calling `removeFriendship`.
- **Friends** — `status === 'accepted'`. Each row shows the friend code when `friend_codes` returns one (the Task 3 policy is what makes that read succeed) and offers `Remove` and `Block`.
- **Blocked** — from `listBlocks()`, each with `Unblock`.

Above them, a search field that looks up `profiles` by `display_name` and offers `Send friend request`, calling `requestFriendship`. Every failure renders `err.message` verbatim — the refusal sentence from Task 2 is deliberately uninformative and must not be "improved" into something that distinguishes a block from a missing account.

- [ ] **Step 4: Register the screen**

Add a `friends` entry to `app/src/lib/screens.ts` beside `matchmaking`, titled `Friends`, blurb `Send and accept friend requests, see friend codes, and block people.`

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/FriendsScreen.tsx app/src/lib/screens.ts app/src/screens/__tests__/friends-screen.test.tsx
git commit -m "feat(social): a friends screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

