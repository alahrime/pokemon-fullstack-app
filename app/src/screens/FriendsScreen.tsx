import { useEffect, useState, type FormEvent } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { opponentFriendCode } from '../lib/matchmaking';
import { supabase } from '../lib/supabase';
import {
  blockUser,
  listBlocks,
  listFriends,
  removeFriendship,
  requestFriendship,
  respondToFriendship,
  unblockUser,
  type Friend,
} from '../lib/social';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface ProfileHit {
  id: string;
  displayName: string;
}

/**
 * `profiles` by `display_name`, read directly rather than through
 * `lib/social.ts` — Task 4's module is the friendship graph itself, and
 * finding a stranger to send a request to is a different read than anything
 * on it. "readable by anyone signed in" (see
 * `supabase/migrations/20260901155633_profiles_policies.sql`) is what lets
 * this succeed for a name that is not yet a friend, a pending request, or a
 * block.
 */
async function searchProfilesByName(term: string): Promise<ProfileHit[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .ilike('display_name', `%${term}%`)
    .limit(8);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; display_name: string }[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
  }));
}

/**
 * The Friends screen: everything `lib/social.ts` (Task 4) exposes about the
 * friendship graph, on one page — who is waiting on you, who you are waiting
 * on, who you are already friends with, and who you have shut out.
 *
 * Four sections read from exactly two calls, `listFriends()` and
 * `listBlocks()`, and partitioned here rather than by the server: a
 * `friendships` row is one of `pending`/`theyAsked`, `pending`/`!theyAsked`
 * or `accepted`, and those three plus the separate blocks list are the whole
 * of the four sections below. `theyAsked` is what keeps an outgoing request
 * from ever growing an Accept button — offering Accept on a request YOU sent
 * is the exact bug that field exists to prevent (see its doc comment on
 * `Friend` in `lib/social.ts`).
 *
 * Every mutation (`respondToFriendship`, `removeFriendship`, `blockUser`,
 * `unblockUser`, `requestFriendship`) re-runs `load()` on success rather than
 * patching local state by hand — the same shape `MatchmakingScreen` uses for
 * its own queue/offer actions, and for the same reason: the server is the
 * one place that knows, for instance, that accepting a request also removes
 * it from someone else's "requests you sent" list.
 */
export function FriendsScreen() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  // Friend codes for accepted friends only — `opponentFriendCode` reads
  // `friend_codes`, which policy only opens to an ACCEPTED friend (the Task 3
  // policy the brief refers to), so asking for anyone else's would just be a
  // read RLS was always going to refuse.
  const [codes, setCodes] = useState<Record<string, string | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ProfileHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [f, b] = await Promise.all([listFriends(), listBlocks()]);
      setFriends(f);
      setBlocked(b);
      const acceptedIds = f.filter((x) => x.status === 'accepted').map((x) => x.otherId);
      const pairs = await Promise.all(
        acceptedIds.map(async (id): Promise<[string, string | null]> => {
          try {
            return [id, await opponentFriendCode(id)];
          } catch {
            // A code that cannot be read is not a load failure for the whole
            // screen — it is just a friend with no code shown, the same as
            // one who never saved one.
            return [id, null];
          }
        }),
      );
      setCodes(Object.fromEntries(pairs));
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const incoming = (friends ?? []).filter((f) => f.status === 'pending' && f.theyAsked);
  const outgoing = (friends ?? []).filter((f) => f.status === 'pending' && !f.theyAsked);
  const accepted = (friends ?? []).filter((f) => f.status === 'accepted');

  /** Runs one mutation against `f.otherId`/`id`, then reloads on success. */
  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusyId(null);
    }
  }

  async function runSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    setSearchBusy(true);
    setSearchError(null);
    try {
      setResults(await searchProfilesByName(q));
    } catch (e) {
      setSearchError(messageOf(e));
    } finally {
      setSearchBusy(false);
    }
  }

  async function send(id: string) {
    setBusyId(id);
    setSearchError(null);
    try {
      await requestFriendship(id);
      await load();
    } catch (e) {
      // Never mapped to anything friendlier: `request_friendship` raises one
      // sentence for blocked-either-direction, no-such-profile and yourself
      // alike, on purpose — see `lib/social.ts`'s own doc comment on
      // `requestFriendship`. Rendering anything but `e.message` verbatim
      // would turn that deliberate ambiguity back into a block detector.
      setSearchError(messageOf(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="friends-screen">
      <ScreenHeader
        title="Friends"
        blurb="Send and accept friend requests, see friend codes, and block people."
      />

      {loadError && (
        <p className="friend-notice" role="alert">
          {loadError}
        </p>
      )}

      <form className="panel" onSubmit={(e) => void runSearch(e)}>
        <div className="hud-label">Find a trainer</div>
        <div className="friend-search-row">
          <input
            id="friend-search"
            className="input"
            type="text"
            placeholder="Search by display name"
            aria-label="Search by display name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <button type="submit" className="btn" disabled={searchBusy || !term.trim()}>
            {searchBusy ? 'Searching…' : 'Search'}
          </button>
        </div>
        {searchError && (
          <p className="friend-notice" role="alert">
            {searchError}
          </p>
        )}
        {results && (
          <ul className="match-list">
            {results.length === 0 && <li className="text-muted">No trainers found.</li>}
            {results.map((r) => (
              <li key={r.id} className="friend-row">
                <span>{r.displayName}</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === r.id}
                  onClick={() => void send(r.id)}
                >
                  Send friend request
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <section className="panel">
        <div className="hud-label">Requests waiting on you</div>
        {incoming.length === 0 && <p className="text-muted">Nobody is waiting on you right now.</p>}
        <ul className="match-list">
          {incoming.map((f) => (
            <li key={f.otherId} className="friend-row" data-kind="incoming">
              <span>{f.otherId}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyId === f.otherId}
                onClick={() => void act(f.otherId, () => respondToFriendship(f.otherId, true))}
              >
                Accept {f.otherId}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busyId === f.otherId}
                onClick={() => void act(f.otherId, () => respondToFriendship(f.otherId, false))}
              >
                Decline {f.otherId}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="hud-label">Requests you sent</div>
        {outgoing.length === 0 && <p className="text-muted">You have not sent any requests.</p>}
        <ul className="match-list">
          {outgoing.map((f) => (
            <li key={f.otherId} className="friend-row" data-kind="outgoing">
              <span>{f.otherId}</span>
              <span className="text-faint">Waiting on them</span>
              <button
                type="button"
                className="btn"
                disabled={busyId === f.otherId}
                onClick={() => void act(f.otherId, () => removeFriendship(f.otherId))}
              >
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="hud-label">Friends</div>
        {accepted.length === 0 && <p className="text-muted">No friends yet.</p>}
        <ul className="match-list">
          {accepted.map((f) => (
            <li key={f.otherId} className="friend-row" data-kind="accepted">
              <span>{f.otherId}</span>
              {codes[f.otherId] && <span className="friend-code">{codes[f.otherId]}</span>}
              <button
                type="button"
                className="btn"
                disabled={busyId === f.otherId}
                onClick={() => void act(f.otherId, () => removeFriendship(f.otherId))}
              >
                Remove
              </button>
              <button
                type="button"
                className="btn"
                disabled={busyId === f.otherId}
                onClick={() => void act(f.otherId, () => blockUser(f.otherId))}
              >
                Block
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="hud-label">Blocked</div>
        {(blocked ?? []).length === 0 && <p className="text-muted">You have not blocked anyone.</p>}
        <ul className="match-list">
          {(blocked ?? []).map((id) => (
            <li key={id} className="friend-row" data-kind="blocked">
              <span>{id}</span>
              <button
                type="button"
                className="btn"
                disabled={busyId === id}
                onClick={() => void act(id, () => unblockUser(id))}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      </section>

      {actionError && (
        <p className="friend-notice" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
