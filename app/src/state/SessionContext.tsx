import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface SessionContextValue {
  /** The live session, or null when nobody is signed in. */
  session: Session | null;
  /**
   * The signed-in person. `user.email` is the identity anchor — it is verified
   * by the auth provider and survives every rename, which is why `profiles`
   * deliberately does not carry a second copy of it. Read it from here.
   */
  user: User | null;
  /**
   * True until the first answer about the stored session arrives. A UI that
   * treats "not loaded yet" as "signed out" flashes the sign-in screen at
   * everyone on every reload.
   */
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set false when this effect is torn down, so neither asynchronous answer
    // sets state belonging to a provider that is gone — including the discarded
    // first mount under StrictMode, whose `getSession` can still be in flight.
    //
    // Deliberately untested: React 19 makes a post-unmount `setState` a silent
    // no-op, so removing this guard changes nothing any test can observe. A
    // test for it would pass either way, which is worse than none.
    let live = true;
    // True once the subscription has spoken. Its answer is at least as new as
    // the stored one, so a slow `getSession` must not overwrite it: someone who
    // signs in fast would otherwise be thrown back to signed-out by a reply
    // about the past.
    let heard = false;

    // Subscribed BEFORE the session is asked for, not after. In the other order
    // an event fired in between lands on nobody, and the context then shows
    // whatever the stored session said, indefinitely.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!live) return;
      heard = true;
      setSession(next);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!live || heard) return;
      setSession(data.session);
      setLoading(false);
    });

    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * The SIGNED_OUT event clears this too, which does not make the local clear
   * redundant: a caller that awaits `signOut()` expects the session gone when
   * it resolves, and the event arrives on its own schedule.
   */
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
