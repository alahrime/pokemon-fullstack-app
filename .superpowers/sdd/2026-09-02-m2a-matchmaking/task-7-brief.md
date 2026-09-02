### Task 7: The client data layer

One module, mirroring `lib/saves.ts` in shape and in its rule: `user_id` is never sent, the database default decides it.

**Files:**
- Create: `app/src/lib/matchmaking.ts`
- Test: `app/src/lib/__tests__/matchmaking.test.ts`

**Interfaces:**
- Consumes: `rulesHash` (Task 2), `DATA_REV` (Task 1), `StoredMember` from `lib/teamCodec`.
- Produces, all used by Task 8. Define these three at the top of the module — Task 8 destructures them, so the field names are load-bearing:

```ts
export interface QueueEntry {
  id: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null until the coordinator has recomputed the hash. Render as "checking…". */
  verifiedHash: string | null;
  expiresAt: string;
}

export interface Match {
  id: string;
  opponentId: string;
  formatVersionId: string;
  rulesHash: string;
  dataRev: string;
  rounds: number;
  source: 'queue' | 'offer';
  createdAt: string;
}

export interface Offer {
  id: string;
  proposerId: string;
  league: LeagueId;
  formatVersionId: string;
  /** Null for the live board; a timestamp for a scheduled proposal. */
  scheduledFor: string | null;
  expiresAt: string;
  state: 'open' | 'accepted' | 'confirmed' | 'lapsed' | 'converted';
  acceptedBy: string | null;
}
```

  - `joinQueue(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[] }): Promise<string>`
  - `leaveQueue(): Promise<void>`
  - `myQueueEntry(): Promise<QueueEntry | null>`
  - `myMatches(): Promise<Match[]>`
  - `listOpenOffers(league: LeagueId): Promise<Offer[]>`
  - `createOffer(a: { league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[]; scheduledFor?: Date }): Promise<string>`
  - `acceptOffer(id: string): Promise<string | null>`
  - `confirmOffer(id: string): Promise<string>`
  - `opponentFriendCode(profileId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

Copy the `harness(rows, errors)` helper from `app/src/lib/__tests__/saves.test.ts` — including the `errors` parameter added when `saveTeam` learned to name a duplicate roster. Then:

```ts
// app/src/lib/__tests__/matchmaking.test.ts
it('never sends user_id — the database default decides who owns the entry', async () => {
  const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
  const { joinQueue } = await import('../matchmaking');
  await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
  const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
  expect(Object.keys(insert.payload as object)).not.toContain('user_id');
});

it('sends the hash it computed, not one it was handed', async () => {
  const { calls } = harness({ queue_entries: [{ id: 'q1' }] });
  const { joinQueue } = await import('../matchmaking');
  const { rulesHash } = await import('../../rules');
  await joinQueue({ league: 'great', formatVersionId: 'v1', format: FORMAT, team: [] });
  const insert = calls.find((c) => c.table === 'queue_entries' && c.op === 'insert')!;
  expect((insert.payload as { claimed_hash: string }).claimed_hash).toBe(await rulesHash(FORMAT));
});

it('accepts an offer through the function, never by writing the row', async () => {
  const { calls } = harness({});
  const { acceptOffer } = await import('../matchmaking');
  await acceptOffer('o1');
  expect(calls.some((c) => c.table === 'match_offers' && c.op === 'update')).toBe(false);
  // accept_offer holds the row lock while it checks state; an UPDATE from here
  // would race a second taker and could edit the terms being agreed to.
});

it('refuses to schedule an offer in the past before the database has to', async () => {
  harness({});
  const { createOffer } = await import('../matchmaking');
  await expect(createOffer({
    league: 'great', formatVersionId: 'v1', format: FORMAT, team: [],
    scheduledFor: new Date(Date.now() - 60_000),
  })).rejects.toThrow(/in the past/);
});
```

Add the `rpc` recorder to the copied harness so the third test can observe it:

```ts
pkg.client = {
  from: vi.fn((n: string) => table(n)),
  rpc: vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ table: 'rpc', op: fn, payload: args });
    return { data: 'm1', error: null };
  }),
};
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd app && ./node_modules/.bin/vitest run src/lib/__tests__/matchmaking.test.ts > /tmp/red.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — cannot resolve `../matchmaking`.

- [ ] **Step 3: Write the module**

Follow `lib/saves.ts` exactly for error handling (`throw new Error(error.message)`), for never sending the owner column, and for typing the PostgREST rows at the boundary. `joinQueue` computes `claimed_hash` with `await rulesHash(format)` and sends `data_rev: DATA_REV`. `acceptOffer` and `confirmOffer` call `supabase.rpc('accept_offer', { p_offer: id })` / `rpc('confirm_offer', …)` and return `data as string | null`. `createOffer` throws `new Error('a scheduled offer cannot be in the past')` before any network call when `scheduledFor <= new Date()`.

- [ ] **Step 4: Run the tests, run the gate, commit**

```bash
cd app && npm run check > /tmp/gate.log 2>&1; echo "EXIT=$?"
git add app/src/lib/matchmaking.ts app/src/lib/__tests__/matchmaking.test.ts
git commit -m "feat(matchmaking): the client data layer for queue, offers and matches"
```

---

