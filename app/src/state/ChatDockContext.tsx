import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The one-shot bridge between a screen and the docked chat rail.
 *
 * `ChatDock` is mounted once, as a sibling of the screen tree that survives
 * navigation (see `App.tsx`'s own doc comment on why — the `key={state.screen}`
 * div next to it remounts on every tab change, and mounting the dock inside
 * that div would tear its open panes and subscriptions down on every click).
 * `MatchScreen`'s "Open match chat" button lives INSIDE that remounting tree,
 * several components away from the dock, with no direct handle on it — this
 * context is the seam between the two, standing in for what used to be a
 * plain `set('screen', 'chat')` navigation before the `chat` destination was
 * removed.
 *
 * `requestedMatchId` is deliberately not `AppState`'s own `activeMatch`: that
 * field already means "the match the `match` screen is open on" and reusing
 * it here would conflate "open this match's report" with "open this match's
 * chat pane", two different requests that can be live at once (you can ask
 * for chat while sitting on the match you already have open — the whole
 * point of the pane is that you never have to leave it).
 */
interface ChatDockContextValue {
  /** The match whose channel `ChatDock` should open (or bring back from
   *  minimised) the next time it renders, or `null` once satisfied. */
  requestedMatchId: string | null;
  /** Asks the dock to open the given match's channel. Calling it again with
   *  a different id before the dock has caught up simply replaces the
   *  request — there is only ever one pending "open this for me" at a time. */
  requestMatchChannel: (matchId: string) => void;
  /** `ChatDock` calls this once it has acted on `requestedMatchId`, so the
   *  same request does not re-fire on every later render. */
  clearRequestedMatchChannel: () => void;
}

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export function ChatDockRequestProvider({ children }: { children: ReactNode }) {
  const [requestedMatchId, setRequestedMatchId] = useState<string | null>(null);
  const value = useMemo<ChatDockContextValue>(
    () => ({
      requestedMatchId,
      requestMatchChannel: (matchId: string) => setRequestedMatchId(matchId),
      clearRequestedMatchChannel: () => setRequestedMatchId(null),
    }),
    [requestedMatchId],
  );
  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function useChatDockRequest(): ChatDockContextValue {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDockRequest must be used within ChatDockRequestProvider');
  return ctx;
}
