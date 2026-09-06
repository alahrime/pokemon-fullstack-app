### Task 7: The chat screen

**Files:**
- Create: `app/src/screens/ChatScreen.tsx`
- Modify: `app/src/lib/screens.ts`
- Modify: `app/src/screens/MatchScreen.tsx`
- Test: `app/src/screens/__tests__/chat-screen.test.tsx`

**Interfaces:**
- Consumes: everything exported by `app/src/lib/channels.ts` (Task 6).
- Produces: a `chat` screen id in `screens.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/screens/__tests__/chat-screen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/render';
import { ChatScreen } from '../ChatScreen';

const sendMessage = vi.fn();
const unsubscribe = vi.fn();
vi.mock('../../lib/channels', () => ({
  listChannels: async () => [
    { id: 'c1', kind: 'dm', title: null, matchId: null, lastReadAt: null },
    { id: 'c2', kind: 'group', title: 'Squad', matchId: null, lastReadAt: null },
  ],
  listMessages: async () => [
    { id: 'm1', channelId: 'c1', authorId: 'them', body: 'hey', createdAt: 't', editedAt: null, deletedAt: null },
  ],
  sendMessage: (...a: unknown[]) => sendMessage(...a),
  subscribeToChannel: () => unsubscribe,
  markRead: async () => {},
  reportMessage: vi.fn(),
}));

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue({
    id: 'm2', channelId: 'c1', authorId: 'me', body: 'hi', createdAt: 't', editedAt: null, deletedAt: null,
  });
  unsubscribe.mockReset();
});

describe('chat screen', () => {
  it('lists channels and opens one', async () => {
    render(<ChatScreen />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /squad/i }));
    expect(await screen.findByText('hey')).toBeInTheDocument();
  });

  it('will not send an empty message', async () => {
    render(<ChatScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /squad/i }));
    expect(await screen.findByRole('button', { name: /send/i })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c2', 'hi'));
  });

  it('unsubscribes when the open channel changes', async () => {
    render(<ChatScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /squad/i }));
    await user.click(screen.getByRole('button', { name: /direct message/i }));
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/screens/__tests__/chat-screen.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../ChatScreen"`.

- [ ] **Step 3: Write the screen**

Two panes. A list from `listChannels()`, each row a button labelled by `title` for a group, `Direct message` for a `dm`, and `Match chat` for a `match`. Selecting one calls `listMessages`, then `subscribeToChannel` inside a `useEffect` whose cleanup calls the returned teardown — the effect keys on the channel id, so switching channels tears the old one down. Append incoming messages, ignoring one whose `id` is already present, because `sendMessage` returns the row *and* the subscription delivers it.

Below the transcript, a labelled textarea and a Send button disabled while the trimmed body is empty or a send is in flight. Each message gets a Report control that prompts for a reason and calls `reportMessage`, showing `Reported` afterwards; a message with `deletedAt` renders as `Message deleted` rather than its body.

Register `chat` in `app/src/lib/screens.ts`, titled `Chat`, blurb `Direct messages, group chats, and the channel for each of your matches.` In `MatchScreen.tsx`, add a control that navigates to the `chat` destination for that match's channel, so the match and its conversation are one click apart.

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/ChatScreen.tsx app/src/lib/screens.ts app/src/screens/MatchScreen.tsx app/src/screens/__tests__/chat-screen.test.tsx
git commit -m "feat(chat): a screen for dms, groups and match channels

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

