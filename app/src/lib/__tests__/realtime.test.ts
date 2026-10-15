import { describe, it, expect, vi } from 'vitest';

vi.unmock('../realtime');
const handlers: { filter: unknown; cb: () => void }[] = [];
const sub = {
  on: vi.fn((_kind: string, filter: unknown, cb: () => void) => { handlers.push({ filter, cb }); return sub; }),
  subscribe: vi.fn(() => sub),
};
const channel = vi.fn((_name: string) => sub);
const removeChannel = vi.fn(async (_s: unknown) => 'ok');
vi.mock('../supabase', () => ({ supabase: { channel: (n: string) => channel(n), removeChannel: (s: unknown) => removeChannel(s) } }));

import { subscribeToTables } from '../realtime';

describe('subscribeToTables', () => {
  it('opens one channel with a listener per table, coalesces a burst into one call, and tears down once', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = subscribeToTables(['messages', 'friendships'], onChange);
    expect(channel).toHaveBeenCalledTimes(1);
    expect(handlers.map((h) => h.filter)).toEqual([
      { event: '*', schema: 'public', table: 'messages' },
      { event: '*', schema: 'public', table: 'friendships' },
    ]);
    expect(sub.subscribe).toHaveBeenCalledTimes(1);

    handlers[0].cb(); handlers[1].cb(); handlers[0].cb();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);

    handlers[1].cb();
    stop(); stop();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1); // a nudge pending at teardown never fires
    expect(removeChannel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
