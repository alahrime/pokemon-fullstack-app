### Task 4: The client data layer

`matchmaking.ts` already declares a `Match` shape and reads the row. This task moves match reading into its own module and extends it, rather than growing a 424-line file that is about getting *into* a match with everything about what happens *inside* one.

The perspective conversion lives here and nowhere else. The database stores `'a'`/`'b'` in match terms; a player thinks in "I won". One function converts, and every caller uses it.

**Files:**
- Create: `app/src/lib/matches.ts`
- Modify: `app/src/lib/matchmaking.ts`
- Test: `app/src/lib/__tests__/matches.test.ts`

**Interfaces:**
- Consumes: `public.submit_report` from Task 2; `supabase` from `app/src/lib/supabase.ts`.
- Produces:
  - `type MatchState = 'paired' | 'reported' | 'confirmed' | 'mismatch' | 'disputed' | 'unverified' | 'abandoned'`
  - `type Side = 'a' | 'b'`
  - `interface Match { id, opponentId, mySide: Side, formatVersionId, rulesHash, dataRev, rounds, state: MatchState, ratingCounted: boolean, amendDeadline: string | null, source: 'queue' | 'offer', createdAt }`
  - `myMatches(): Promise<Match[]>`
  - `submitReport(matchId: string, wins: Side[]): Promise<MatchState>`
  - `myReport(matchId: string): Promise<{ wins: Side[]; amendCount: number } | null>`
  - `adjudicatedRounds(matchId: string): Promise<{ roundNo: number; winner: string }[]>`
  - `toMatchTerms(iWon: boolean[], mySide: Side): Side[]`
  - `toMyTerms(wins: Side[], mySide: Side): boolean[]`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/__tests__/matches.test.ts
import { describe, it, expect } from 'vitest';
import { toMatchTerms, toMyTerms } from '../matches';

describe('perspective conversion', () => {
  it('converts what I claim into match terms, from either seat', () => {
    expect(toMatchTerms([true, false, true], 'a')).toEqual(['a', 'b', 'a']);
    expect(toMatchTerms([true, false, true], 'b')).toEqual(['b', 'a', 'b']);
  });

  it('round-trips from both seats', () => {
    const claim = [true, true, false, false, true];
    for (const side of ['a', 'b'] as const) {
      expect(toMyTerms(toMatchTerms(claim, side), side)).toEqual(claim);
    }
  });

  it('reads the same stored array oppositely for the two players', () => {
    const stored = ['a', 'b', 'a'] as const;
    expect(toMyTerms([...stored], 'a')).toEqual([true, false, true]);
    expect(toMyTerms([...stored], 'b')).toEqual([false, true, false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/__tests__/matches.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Failed to resolve import "../matches"`.

- [ ] **Step 3: Write the module**

```ts
// app/src/lib/matches.ts
import { supabase } from './supabase';

export type MatchState =
  | 'paired' | 'reported' | 'confirmed' | 'mismatch' | 'disputed' | 'unverified' | 'abandoned';

/** Which seat of the match row you are sitting in. */
export type Side = 'a' | 'b';

export interface Match {
  id: string;
  opponentId: string;
  mySide: Side;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  state: MatchState;
  ratingCounted: boolean;
  amendDeadline: string | null;
  source: 'queue' | 'offer';
  createdAt: string;
}

/**
 * The stored array names the winner of each round in MATCH terms. A player
 * thinks in "I won round 2". These two functions are the only place that
 * conversion happens — a flip applied twice, or in one caller and not its
 * neighbour, is a scoreline reported backwards.
 */
export function toMatchTerms(iWon: boolean[], mySide: Side): Side[] {
  const them: Side = mySide === 'a' ? 'b' : 'a';
  return iWon.map((won) => (won ? mySide : them));
}

export function toMyTerms(wins: Side[], mySide: Side): boolean[] {
  return wins.map((w) => w === mySide);
}

const COLUMNS =
  'id, player_a, player_b, format_version_id, rules_hash, data_rev, rounds, state, rating_counted, amend_deadline, source, created_at';

interface Row {
  id: string;
  player_a: string;
  player_b: string;
  format_version_id: string;
  rules_hash: string;
  data_rev: string;
  rounds: number;
  state: MatchState;
  rating_counted: boolean;
  amend_deadline: string | null;
  source: 'queue' | 'offer';
  created_at: string;
}

function toMatch(r: Row, me: string | undefined): Match {
  const mySide: Side = r.player_a === me ? 'a' : 'b';
  return {
    id: r.id,
    opponentId: r.player_a === me ? r.player_b : r.player_a,
    mySide,
    formatVersionId: r.format_version_id,
    rulesHash: r.rules_hash,
    dataRev: r.data_rev,
    rounds: r.rounds,
    state: r.state,
    ratingCounted: r.rating_counted,
    amendDeadline: r.amend_deadline,
    source: r.source,
    createdAt: r.created_at,
  };
}

/**
 * `getSession()`, not `getUser()`: `getUser()` is a network round trip that
 * revalidates the JWT and would abort this read on a transient error for an id
 * the caller already holds locally. `SessionContext.tsx` and the old
 * `matchmaking.myMatches` make the same choice for the same reason.
 */
async function myId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.user.id;
}

export async function myMatches(): Promise<Match[]> {
  const me = await myId();
  const { data, error } = await supabase
    .from('matches')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toMatch(row as unknown as Row, me));
}

export async function submitReport(matchId: string, wins: Side[]): Promise<MatchState> {
  const { data, error } = await supabase.rpc('submit_report', {
    p_match_id: matchId,
    p_wins: wins,
  });
  if (error) throw new Error(error.message);
  return data as MatchState;
}

export async function myReport(
  matchId: string,
): Promise<{ wins: Side[]; amendCount: number } | null> {
  const me = await myId();
  if (!me) return null;
  const { data, error } = await supabase
    .from('match_reports')
    .select('wins, amend_count')
    .eq('match_id', matchId)
    .eq('reporter_id', me)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as { wins: Side[]; amend_count: number };
  return { wins: r.wins, amendCount: r.amend_count };
}

export async function adjudicatedRounds(
  matchId: string,
): Promise<{ roundNo: number; winner: string }[]> {
  const { data, error } = await supabase
    .from('match_rounds')
    .select('round_no, winner')
    .eq('match_id', matchId)
    .order('round_no', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as unknown as { round_no: number; winner: string };
    return { roundNo: r.round_no, winner: r.winner };
  });
}
```

- [ ] **Step 4: Point `matchmaking.ts` at it**

Delete `matchmaking.ts`'s own `Match` interface and its `myMatches` implementation, and re-export instead, so there is one row shape:

```ts
export { myMatches, type Match } from './matches';
```

`MatchmakingScreen.tsx` imports both from `matchmaking` and needs no change.

- [ ] **Step 5: Run the gate to verify it passes**

Run: `cd app && npm run check > /tmp/app.log 2>&1; echo "EXIT=$?"; grep -E "Tests  " /tmp/app.log`
Expected: `EXIT=0`, test count up by 3 on the previous total.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/matches.ts app/src/lib/matchmaking.ts app/src/lib/__tests__/matches.test.ts
git commit -m "feat(matches): a data layer for what happens inside a match

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

