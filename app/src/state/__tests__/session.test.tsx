import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';

/**
 * The session context's behaviour, with no network anywhere.
 *
 * `@supabase/supabase-js` is mocked at the package boundary rather than
 * `../../lib/supabase`, so the client module's own wiring runs too: this proves
 * the context talks to the client the app will actually hold. The env the
 * client reads comes from `vitest.config.ts`, not from `.env.local` — that file
 * is git-ignored, so a suite depending on it would fail on a fresh clone.
 *
 * `getSession` is deliberately a promise this file resolves by hand. The
 * ordering between it and `onAuthStateChange` is the part of this context most
 * able to be silently wrong, and it cannot be exercised at all if the answer
 * arrives on its own schedule.
 */
const pkg = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => pkg.client }));

type Handler = (event: string, session: Session | null) => void;

/** A session with only the fields this context reads. */
function fakeSession(token: string, email: string): Session {
  return { access_token: token, user: { id: 'u-1', email } } as unknown as Session;
}

function fakeClient() {
  let answer!: (v: { data: { session: Session | null } }) => void;
  const pending = new Promise<{ data: { session: Session | null } }>((res) => {
    answer = res;
  });
  const handlers: Handler[] = [];
  const unsubscribe = vi.fn();
  const signOutMock = vi.fn(async () => ({ error: null }));
  // The order the context calls the client in, which one of the tests below is
  // entirely about.
  const order: string[] = [];
  pkg.client = {
    auth: {
      getSession: vi.fn(() => {
        order.push('getSession');
        return pending;
      }),
      onAuthStateChange: vi.fn((cb: Handler) => {
        order.push('onAuthStateChange');
        handlers.push(cb);
        return { data: { subscription: { unsubscribe } } };
      }),
      signOut: signOutMock,
    },
  };
  return {
    unsubscribe,
    signOutMock,
    order,
    handlers,
    /** Resolve the initial `getSession` call. */
    answer: (s: Session | null) => act(async () => answer({ data: { session: s } })),
    /** Fire an auth state change, the way GoTrue would. */
    emit: (event: string, s: Session | null) => act(async () => { for (const h of handlers) h(event, s); }),
  };
}

async function mount() {
  const stub = fakeClient();
  vi.resetModules();
  const { SessionProvider, useSession } = await import('../SessionContext');

  const seen = { loading: 'unset', email: 'unset', token: 'unset' };
  let signOut!: () => Promise<void>;
  function Probe() {
    const s = useSession();
    seen.loading = String(s.loading);
    seen.email = s.user?.email ?? 'none';
    seen.token = s.session?.access_token ?? 'none';
    signOut = s.signOut;
    return null;
  }
  const view = render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  return { ...stub, seen, view, useSession, SessionProvider, signOut: () => signOut() };
}

afterEach(cleanup);

describe('SessionContext', () => {
  it('is loading until the first answer arrives', async () => {
    const s = await mount();
    expect(s.seen.loading).toBe('true');
    expect(s.seen.email).toBe('none');
    await s.answer(fakeSession('tok-1', 'ash@example.com'));
    expect(s.seen.loading).toBe('false');
    expect(s.seen.email).toBe('ash@example.com');
    expect(s.seen.token).toBe('tok-1');
  });

  it('settles signed out when there is no stored session', async () => {
    const s = await mount();
    await s.answer(null);
    expect(s.seen.loading).toBe('false');
    expect(s.seen.email).toBe('none');
  });

  it('follows a sign-in that happens after mount', async () => {
    const s = await mount();
    await s.answer(null);
    await s.emit('SIGNED_IN', fakeSession('tok-2', 'misty@example.com'));
    expect(s.seen.email).toBe('misty@example.com');
  });

  it('clears on a SIGNED_OUT event', async () => {
    const s = await mount();
    await s.answer(fakeSession('tok-3', 'brock@example.com'));
    await s.emit('SIGNED_OUT', null);
    expect(s.seen.email).toBe('none');
    expect(s.seen.token).toBe('none');
  });

  /**
   * The race this context exists to get right. `onAuthStateChange` can speak
   * before the `getSession` promise settles; that answer is at least as new, so
   * the slow one must not overwrite it. Get this wrong and a user who signs in
   * quickly is thrown back to signed-out by a reply about the past.
   */
  it('does not let a slow getSession overwrite a newer auth event', async () => {
    const s = await mount();
    await s.emit('SIGNED_IN', fakeSession('tok-4', 'gary@example.com'));
    expect(s.seen.email).toBe('gary@example.com');
    await s.answer(null);
    expect(s.seen.email).toBe('gary@example.com');
    expect(s.seen.loading).toBe('false');
  });

  /**
   * Subscribing second would leave a gap: an event fired between the
   * `getSession` call and the subscription lands on nobody, and the context
   * then shows whatever `getSession` said, forever.
   */
  it('subscribes before asking for the stored session', async () => {
    const s = await mount();
    expect(s.order).toEqual(['onAuthStateChange', 'getSession']);
  });

  it('signs out through the client, not only by forgetting locally', async () => {
    const s = await mount();
    await s.answer(fakeSession('tok-5', 'ash@example.com'));
    await act(async () => { await s.signOut(); });
    expect(s.signOutMock).toHaveBeenCalledTimes(1);
  });

  /**
   * No SIGNED_OUT event is emitted here on purpose. A caller that awaits
   * `signOut()` expects the session gone when it resolves; leaving that to the
   * event means a window where the app still believes someone is signed in.
   */
  it('has cleared the session by the time signOut resolves', async () => {
    const s = await mount();
    await s.answer(fakeSession('tok-6', 'ash@example.com'));
    await act(async () => { await s.signOut(); });
    expect(s.seen.email).toBe('none');
    expect(s.seen.token).toBe('none');
  });

  it('unsubscribes on unmount', async () => {
    const s = await mount();
    await s.answer(null);
    expect(s.unsubscribe).not.toHaveBeenCalled();
    s.view.unmount();
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('refuses to be used outside its provider', async () => {
    const s = await mount();
    function Bare() {
      s.useSession();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/SessionProvider/);
  });
});
