# Challenges and Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player challenge a friend (or someone they share a live match with) from a friend row, a DM or the new Chat screen; show the challenge as a live card in the DM; add a full-page Chat screen and a notification bell with toasts.

**Architecture:** A challenge is a `match_offers` row aimed at one person (`target_id`), created atomically with its DM message by one SECURITY DEFINER RPC (`create_challenge`). It rides the existing offer machinery unchanged: coordinator hash verification, `accept_offer` (patched to admit the target), `confirm_offer`, expiry sweep, conversion to `matches`, and the auto-created match channel. The card in the DM reads the offer's live state by polling. Channel polling moves into one shared context so the dock, the Chat screen and the bell do not each poll.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql, `supabase/tests` via `npm run check:db`), React 19 + TS, vitest + Testing Library, existing `lib/*` client modules.

**Spec:** `docs/superpowers/specs/2026-09-29-shell-challenges-tournaments-design.md`, section B. Builds on the shell (plan A, merged): `SECTIONS`, `SectionRail`, `useBadges`, hash routes.

## Global Constraints

- A challenge is a match offer aimed at one person, **not a new system**: reuse terms review, the accept/confirm handshake, expiry, conversion to `matches`, the match channel, and block enforcement.
- **Eligibility (ruling):** friends, or anyone you share a live match with — identical to the DM rule (`open_dm`). Blocked users can never challenge. One error sentence for every refusal reason; never let a caller distinguish "blocked" from "not friends".
- **Expiry (ruling):** 1 hour for a now-challenge; until the play time for a scheduled one. **No sweep change** (`sweep_expired` already lapses `open`/`accepted` past `expires_at`).
- A targeted offer is visible only to proposer and target and **never on the public board**.
- New offer state `declined`. Clients cannot write `match_offers` handshake columns (UPDATE is revoked); declining goes through an RPC.
- Formats: a challenge needs a **public** format (format versions are readable by others only when the format is public); the RPC refuses otherwise with one clear sentence.
- The coordinator recomputes `verified_hash` once a minute; `accept_offer` raises "not verified yet" until then. The card shows "Verifying the format…" and no Accept button during that minute.
- Out of scope: typing indicators, read receipts, attachments, web push, per-user "record vs you" statistics, realtime on `match_offers` (the card polls).
- Bell/toasts: in-app only (ruling). Count = unread channels + challenges awaiting your response + friend requests + scheduled challenges awaiting your confirm.
- Use design tokens and existing HUD classes (`.panel`, `.chamfer-9`, `.btn`, `.btn-ghost`, `.friend-notice`, `.hud-label`); no literal colours. Motion runs once and is dropped under `prefers-reduced-motion`.
- Gates: `cd app && npm run check` before every code commit; `cd app && npm run check:db` (needs Docker: `npm run db:start`) for Task 1 and again in Task 8. If Docker/Supabase cannot start, stop and report BLOCKED — do not fake DB tests.
- After any change reaching `src/rules`, run `npm run build:coordinator`. (This plan does not touch it; the coordinator function needs no change.)
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Deferred (deliberately out of this plan)

- Realtime push for offer state changes (poll every 10s while a card is on screen).
- "Record vs you" in the opponent panel (shows matches played together instead).
- User-level "Report" in the opponent panel (message-level report already exists in `ChatPane`).
- Web push, typing indicators, read receipts, attachments.

## File Structure

- Create `supabase/migrations/20260929000000_challenges.sql` — schema, RPCs, policy and function patches.
- Create `supabase/tests/challenges.test.ts` — RLS and RPC tests.
- Modify `app/src/lib/channels.ts` — `Message.kind/offerId`, `ChannelDisplay.otherId`.
- Create `app/src/lib/challenges.ts` — `createChallenge`, `declineChallenge`, `withdrawChallenge`, `fetchChallenges`, `myChallenges`, pure `challengeView`.
- Modify `app/src/lib/matchmaking.ts` — `listOpenOffers`/`myOffers` exclude challenges.
- Create `app/src/components/ChallengeCard.tsx`, `ChallengeSheet.tsx`.
- Modify `app/src/components/ChatPane.tsx` — card rendering, DM-header Challenge button, `embedded` variant.
- Modify `app/src/screens/FriendsScreen.tsx` — Challenge button on accepted rows.
- Create `app/src/state/ChannelListContext.tsx`; modify `ChatDock.tsx`, `App.tsx`.
- Modify `app/src/state/ChatDockContext.tsx` — generic `requestChannel`.
- Create `app/src/screens/ChatScreen.tsx`, `app/src/components/OpponentPanel.tsx`.
- Modify `app/src/state/AppState.tsx` (`Screen` += `'chat'`), `app/src/lib/screens.ts`, `app/src/lib/badges.ts`.
- Create `app/src/lib/notifications.ts`, `app/src/state/useNotifications.ts`, `app/src/components/NotificationBell.tsx`, `Toaster.tsx`.
- Modify `app/src/styles/components.css` — card, sheet, chat page, bell, toaster.
- Create `app/tools/m4-challenges-roundtrip.ts`.
- Tests beside each unit.

---

### Task 1: Database — challenges

**Files:**
- Create: `supabase/migrations/20260929000000_challenges.sql`
- Test: `supabase/tests/challenges.test.ts`

**Interfaces:**
- Produces (SQL):
  - `match_offers.target_id uuid` (nullable, FK `profiles`, `on delete cascade`); `match_offers.state` accepts `'declined'`.
  - `public.create_challenge(p_target uuid, p_format_version uuid, p_claimed_hash text, p_league text, p_team jsonb, p_data_rev text, p_scheduled_for timestamptz default null) returns uuid` — the offer id. Authenticated only.
  - `public.decline_challenge(p_offer uuid) returns boolean`. Authenticated only.
  - `messages.kind text` (`'text' | 'challenge'`, default `'text'`) and `messages.offer_id uuid`.
  - `accept_offer(uuid, jsonb, text)` admits the target of a private challenge.
- Consumes: `open_dm(uuid)`, `are_friends`, `share_a_live_match`, `blocked_between`, `is_channel_member`, existing policies (all in earlier migrations).

- [ ] **Step 1: Start the stack and capture the CURRENT definitions the migration must patch.** The migration patches three objects that later migrations replaced; copy from the live database, never from the oldest migration file.

Run (from repo root):

```bash
cd app && npm run db:start
cd .. && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select pg_get_functiondef('public.accept_offer(uuid,jsonb,text)'::regprocedure)" > /tmp/accept_offer.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select pg_get_functiondef('public.messages_protect_columns()'::regprocedure)" > /tmp/protect.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c "select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid='public.messages'::regclass and polname='a member who is not blocked may post'"
```

Expected: three definitions printed. (If `psql` is absent use `docker exec` into the supabase db container, or `supabase db dump --schema public`.) Keep them in the scratchpad, not the repo.

- [ ] **Step 2: Write the failing tests** — `supabase/tests/challenges.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

describe('challenges', () => {
  const ann = randomUUID();
  const bob = randomUUID();
  const cal = randomUUID();
  let publicVersion = '';
  let privateVersion = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }
  const befriend = (a: string, b: string) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return sql(
      `insert into public.friendships (user_lo, user_hi, status, requested_by) values ('${lo}','${hi}','accepted','${a}')`,
    );
  };
  const challenge = (as: string, target: string, version = publicVersion, scheduled = 'null') =>
    asUser({ sub: as })<{ create_challenge: string }>(
      `select public.create_challenge('${target}', '${version}', 'bb', 'great', '[]'::jsonb, 'rev1', ${scheduled})`,
    );

  beforeAll(async () => {
    await makeUser(ann, `PA_${ann.slice(0, 8)}`);
    await makeUser(bob, `PB_${bob.slice(0, 8)}`);
    await makeUser(cal, `PC_${cal.slice(0, 8)}`);
    for (const [vis, set] of [['public', (id: string) => (publicVersion = id)], ['private', (id: string) => (privateVersion = id)]] as const) {
      const [f] = await sql<{ id: string }>(
        `insert into public.formats (owner_id, name, visibility) values ('${ann}', 'Chal ${vis}', '${vis}') returning id`);
      const [v] = await sql<{ id: string }>(
        `insert into public.format_versions (format_id, version, rules, rules_hash)
         values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
      set(v.id);
    }
  });

  afterEach(async () => {
    const ids = `'${ann}','${bob}','${cal}'`;
    await sql(`delete from public.matches where player_a in (${ids}) or player_b in (${ids})`);
    await sql(`delete from public.match_offers where proposer_id in (${ids})`);
    await sql(`delete from public.channels where created_by in (${ids})`);
    await sql(`delete from public.friendships where user_lo in (${ids}) or user_hi in (${ids})`);
    await sql(`delete from public.blocks where blocker_id in (${ids})`);
  });

  it('lets a friend challenge a friend: private offer aimed at them, plus a card in the DM', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    const [o] = await sql<{ target_id: string; visibility: string; state: string; expires_at: string }>(
      `select target_id, visibility, state, expires_at from public.match_offers where id = '${offer}'`);
    expect(o.target_id).toBe(bob);
    expect(o.visibility).toBe('private');
    expect(o.state).toBe('open');
    const [m] = await sql<{ kind: string; offer_id: string; author_id: string }>(
      `select kind, offer_id, author_id from public.messages where offer_id = '${offer}'`);
    expect(m).toMatchObject({ kind: 'challenge', offer_id: offer, author_id: ann });
    // the target can read both the offer and the card
    expect(await asUser({ sub: bob })(`select id from public.match_offers where id = '${offer}'`)).toHaveLength(1);
    expect(await asUser({ sub: bob })(`select id from public.messages where offer_id = '${offer}'`)).toHaveLength(1);
  });

  it('keeps a challenge from everyone but the two people in it', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    expect(await asUser({ sub: cal })(`select id from public.match_offers where id = '${offer}'`)).toHaveLength(0);
    expect(await asUser({ sub: cal })(`select id from public.messages where offer_id = '${offer}'`)).toHaveLength(0);
  });

  it('refuses strangers, yourself, and blocked pairs with one indistinguishable sentence', async () => {
    const stranger = await refusal(() => challenge(ann, bob));
    await befriend(ann, bob);
    await sql(`insert into public.blocks (blocker_id, blocked_id) values ('${bob}','${ann}')`);
    const blocked = await refusal(() => challenge(ann, bob));
    const self = await refusal(() => challenge(ann, ann));
    for (const r of [stranger, blocked, self]) expect(r.message).toMatch(/that person cannot be challenged/);
    expect(blocked.message).toBe(stranger.message);
  });

  it('accepts someone you share a live match with, without friendship', async () => {
    await sql(
      `insert into public.matches (player_a, player_b, format_version_id, rules_hash, team_a, team_b, data_rev, seed, source)
       values ('${ann}','${bob}','${publicVersion}','bb','[]','[]','rev1','s','queue')`);
    await expect(challenge(ann, bob)).resolves.toHaveLength(1);
  });

  it('refuses a private format and a past schedule', async () => {
    await befriend(ann, bob);
    expect((await refusal(() => challenge(ann, bob, privateVersion))).message).toMatch(/public format/);
    expect((await refusal(() => challenge(ann, bob, publicVersion, `now() - interval '1 hour'`))).message).toMatch(/past/);
  });

  it('a scheduled challenge lives until its play time, a live one for an hour', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: live }] = await challenge(ann, bob);
    const [{ create_challenge: sched }] = await challenge(ann, bob, publicVersion, `now() + interval '3 days'`);
    const [a] = await sql<{ h: number }>(
      `select extract(epoch from (expires_at - created_at))/3600 as h from public.match_offers where id = '${live}'`);
    expect(Math.round(a.h)).toBe(1);
    const [b] = await sql<{ same: boolean }>(
      `select expires_at = scheduled_for as same from public.match_offers where id = '${sched}'`);
    expect(b.same).toBe(true);
  });

  it('never lets a client write target_id, kind or offer_id directly', async () => {
    await befriend(ann, bob);
    const direct = await refusal(() =>
      asUser({ sub: ann })(
        `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, target_id)
         values ('${publicVersion}','bb','great','[]','rev1','${bob}')`));
    expect(direct.message).toMatch(POLICY_DENIED);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    const [{ id: dm }] = await sql<{ id: string }>(`select channel_id as id from public.messages where offer_id = '${offer}'`);
    const forged = await refusal(() =>
      asUser({ sub: ann })(
        `insert into public.messages (channel_id, body, kind, offer_id) values ('${dm}','hi','challenge','${offer}')`));
    expect(forged.message).toMatch(POLICY_DENIED);
    const [{ id: msg }] = await sql<{ id: string }>(`select id from public.messages where offer_id = '${offer}'`);
    const rewrite = await refusal(() =>
      asUser({ sub: ann })(`update public.messages set kind = 'text', offer_id = null where id = '${msg}'`));
    expect(rewrite.message).toMatch(/cannot be changed/);
  });

  it('only the target accepts; a stranger or the proposer cannot', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    await sql(`update public.match_offers set verified_hash = 'bb' where id = '${offer}'`);
    for (const who of [ann, cal]) {
      const r = await refusal(() =>
        asUser({ sub: who })(`select public.accept_offer('${offer}', '[]'::jsonb, 'rev1')`));
      expect(r.message).toMatch(/cannot accept your own offer|not open to you|no such offer/);
    }
    await asUser({ sub: bob })(`select public.accept_offer('${offer}', '[]'::jsonb, 'rev1')`);
    const [m] = await sql<{ state: string }>(`select state from public.match_offers where id = '${offer}'`);
    expect(m.state).toBe('converted');
  });

  it('the target can decline once; the proposer and strangers cannot', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    const strangerTry = await asUser({ sub: cal })<{ decline_challenge: boolean }>(`select public.decline_challenge('${offer}')`);
    expect(strangerTry[0].decline_challenge).toBe(false);
    const proposerTry = await asUser({ sub: ann })<{ decline_challenge: boolean }>(`select public.decline_challenge('${offer}')`);
    expect(proposerTry[0].decline_challenge).toBe(false);
    const done = await asUser({ sub: bob })<{ decline_challenge: boolean }>(`select public.decline_challenge('${offer}')`);
    expect(done[0].decline_challenge).toBe(true);
    const [o] = await sql<{ state: string }>(`select state from public.match_offers where id = '${offer}'`);
    expect(o.state).toBe('declined');
    const again = await asUser({ sub: bob })<{ decline_challenge: boolean }>(`select public.decline_challenge('${offer}')`);
    expect(again[0].decline_challenge).toBe(false);
  });

  it('a declined or lapsed challenge is left alone by the sweep and never accepted', async () => {
    await befriend(ann, bob);
    const [{ create_challenge: offer }] = await challenge(ann, bob);
    await sql(`update public.match_offers set verified_hash = 'bb' where id = '${offer}'`);
    await asUser({ sub: bob })(`select public.decline_challenge('${offer}')`);
    await sql(`select public.sweep_expired()`);
    const [o] = await sql<{ state: string }>(`select state from public.match_offers where id = '${offer}'`);
    expect(o.state).toBe('declined');
    const r = await refusal(() =>
      asUser({ sub: bob })(`select public.accept_offer('${offer}', '[]'::jsonb, 'rev1')`));
    expect(r.message).toMatch(/no longer open/);
  });

  it('anonymous callers cannot reach either function', async () => {
    const r = await refusal(() => sql(`set local role anon; select public.create_challenge('${bob}','${publicVersion}','bb','great','[]','rev1')`));
    expect(r.message).toMatch(/permission denied|must be owner|cannot|set role/i);
  });
});
```

(The last test is a smoke check; if `sql()` cannot `set local role` outside a transaction in this helper, replace it with `asAnon()` from `helpers.ts` — it exists — and assert `PRIVILEGE_DENIED`-style `permission denied for function create_challenge`.)

- [ ] **Step 3: Run to verify failure**

Run: `cd app && npx vitest run --config vitest.db.config.ts ../supabase/tests/challenges.test.ts`
Expected: FAIL — `create_challenge` does not exist.

- [ ] **Step 4: Write the migration** — `supabase/migrations/20260929000000_challenges.sql`:

```sql
-- A challenge is a match offer aimed at one person. Everything after posting —
-- verification, accept/confirm, expiry, conversion, the match channel, block
-- enforcement — is the existing offer machinery, so this migration adds only
-- the aim, the way to decline, and the card that carries it into a DM.

alter table public.match_offers
  add column target_id uuid references public.profiles (id) on delete cascade;

alter table public.match_offers drop constraint match_offers_state;
alter table public.match_offers add constraint match_offers_state
  check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted', 'declined'));

create index match_offers_target_idx on public.match_offers (target_id) where target_id is not null;

-- Clients may never post an aimed offer themselves: eligibility (friends or a
-- live match, not blocked, a public format) is enforced in create_challenge(),
-- and a direct INSERT would bypass all of it. Recreate the owner policy from
-- 20260904071716 with one more conjunct.
drop policy "an offer belongs to the person who proposed it" on public.match_offers;
create policy "an offer belongs to the person who proposed it"
  on public.match_offers for all
  to authenticated
  using ((select auth.uid()) = proposer_id)
  with check (
    (select auth.uid()) = proposer_id
    and verified_hash is null
    and accepted_by is null
    and accepted_team is null
    and accepted_at is null
    and confirmed_at is null
    and match_id is null
    and state = 'open'
    and target_id is null
  );

create policy "a challenge is readable by its target"
  on public.match_offers for select
  to authenticated
  using (target_id = (select auth.uid()));

-- The card. `kind` and `offer_id` are server-written: the messages INSERT
-- policy below only lets a client post plain text, and the protect trigger
-- refuses to let either be rewritten afterwards.
alter table public.messages
  add column kind text not null default 'text' check (kind in ('text', 'challenge')),
  add column offer_id uuid references public.match_offers (id) on delete set null;

-- >>> PASTE the CURRENT `a member who is not blocked may post` policy here <<<
-- (from Step 1's third command), as `drop policy ...; create policy ...`,
-- with exactly two conjuncts appended to its WITH CHECK:
--     and kind = 'text'
--     and offer_id is null
-- Change nothing else in it.

-- >>> PASTE the CURRENT messages_protect_columns() from Step 1 as
-- `create or replace function ...`, adding, inside its UPDATE branch's
-- comparison that raises 'channel_id, author_id, created_at and expires_at
-- cannot be changed after insert', two more disjuncts:
--     or new.kind is distinct from old.kind
--     or new.offer_id is distinct from old.offer_id
-- and add `kind` and `offer_id` to the words of that message. Nothing else. <<<

create function public.create_challenge(
  p_target uuid,
  p_format_version uuid,
  p_claimed_hash text,
  p_league text,
  p_team jsonb,
  p_data_rev text,
  p_scheduled_for timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := (select auth.uid());
  vis public.format_visibility;
  offer uuid;
  dm uuid;
begin
  if me is null then raise exception 'not signed in'; end if;

  -- One sentence for every reason, exactly as open_dm does: a caller that can
  -- tell "blocked" from "not friends" can enumerate blocks.
  if p_target is null or p_target = me
     or not exists (select 1 from public.profiles where id = p_target)
     or public.blocked_between(me, p_target)
     or not (public.are_friends(me, p_target) or public.share_a_live_match(me, p_target)) then
    raise exception 'that person cannot be challenged';
  end if;

  -- Versions are readable by others only for a PUBLIC format, and the target
  -- has to be able to read the terms they are agreeing to.
  select f.visibility into vis
    from public.format_versions v join public.formats f on f.id = v.format_id
   where v.id = p_format_version;
  if vis is distinct from 'public' then
    raise exception 'a challenge needs a public format';
  end if;

  if p_scheduled_for is not null and p_scheduled_for <= now() then
    raise exception 'a scheduled challenge cannot be in the past';
  end if;

  insert into public.match_offers
    (proposer_id, target_id, format_version_id, claimed_hash, league, team, data_rev,
     visibility, scheduled_for, expires_at)
  values
    (me, p_target, p_format_version, p_claimed_hash, p_league, p_team, p_data_rev,
     'private', p_scheduled_for, coalesce(p_scheduled_for, now() + interval '1 hour'))
  returning id into offer;

  dm := public.open_dm(p_target);
  insert into public.messages (channel_id, author_id, body, kind, offer_id)
  values (dm, me, 'Challenge', 'challenge', offer);
  return offer;
end;
$fn$;

-- Declining is a function, not an UPDATE, for the reason accept_offer is: no
-- client may write this table. Returns false rather than raising for "not
-- yours / not open" so a stranger learns nothing about which offers exist.
create function public.decline_challenge(p_offer uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  update public.match_offers set state = 'declined'
   where id = p_offer
     and target_id = (select auth.uid())
     and state = 'open';
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

-- >>> PASTE the CURRENT accept_offer(uuid, jsonb, text) from Step 1 as
-- `create or replace function ...`, replacing ONLY this line:
--     if o.visibility <> 'public' then raise exception 'this offer is not open to you'; end if;
-- with:
--     if o.target_id is not null then
--       if o.target_id <> taker then raise exception 'this offer is not open to you'; end if;
--     elsif o.visibility <> 'public' then
--       raise exception 'this offer is not open to you';
--     end if;
-- Keep every other line, including the data-rev check that must stay LAST. <<<

revoke all on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz) from public, anon;
revoke all on function public.decline_challenge(uuid) from public, anon;
grant execute on function public.create_challenge(uuid, uuid, text, text, jsonb, text, timestamptz) to authenticated;
grant execute on function public.decline_challenge(uuid) to authenticated;
```

Replace each `>>> PASTE … <<<` block with the real SQL from Step 1 (delete the marker comments). The migration must contain no marker text when committed.

- [ ] **Step 5: Apply and run**

Run: `cd app && npm run db:reset && npx vitest run --config vitest.db.config.ts ../supabase/tests/challenges.test.ts`
Expected: PASS. Then the whole DB suite once: `npm run check:db` — expected all green (the existing `offers`, `pairing`, `channels` tests exercise the patched objects; if one fails, the patch changed behaviour it should not have — fix the migration, not the test). `db:reset` restarts the realtime container; run DB files alone if a timeout appears.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929000000_challenges.sql supabase/tests/challenges.test.ts
git commit -m "feat(db): challenges — aimed offers, decline, and the DM card

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client data layer

**Files:**
- Modify: `app/src/lib/channels.ts` (Message types and mappers, `ChannelDisplay.otherId`)
- Create: `app/src/lib/challenges.ts`
- Modify: `app/src/lib/matchmaking.ts` (`listOpenOffers`, `myOffers`)
- Test: `app/src/lib/__tests__/challenges.test.ts`; extend `channels.test.ts`, `matchmaking.test.ts`

**Interfaces:**
- Consumes: the SQL API from Task 1; `supabase`, `rulesHash`, `DATA_REV`, `Format`, `StoredMember`, `OfferState`.
- Produces:
  - `Message` gains `kind: 'text' | 'challenge'` and `offerId: string | null`.
  - `ChannelDisplay` gains `otherId: string | null` (the other person in a DM; null otherwise).
  - `type ChallengeState = OfferState | 'declined'`.
  - `interface Challenge { id; proposerId; targetId; league: LeagueId; state: ChallengeState; scheduledFor: string | null; expiresAt: string; verifiedHash: string | null; matchId: string | null; rosterSize: number; formatName: string | null }`
  - `type ChallengeAction = 'accept' | 'decline' | 'confirm' | 'withdraw'`
  - `interface ChallengeView { label: string; tone: 'open' | 'wait' | 'done' | 'dead'; actions: ChallengeAction[] }`
  - `challengeView(c: Challenge | null, me: string, now: Date): ChallengeView` (pure)
  - `createChallenge(a: { targetId: string; league: LeagueId; formatVersionId: string; format: Format; team: StoredMember[]; scheduledFor?: Date }): Promise<string>`
  - `declineChallenge(id: string): Promise<boolean>`; `withdrawChallenge(id: string): Promise<void>`
  - `fetchChallenges(ids: string[]): Promise<Map<string, Challenge>>`; `myChallenges(): Promise<Challenge[]>`
  - `listOpenOffers`/`myOffers` never return a targeted offer.

- [ ] **Step 1: Write the failing tests** — `lib/__tests__/challenges.test.ts` (pure part first, this is the logic that matters):

```ts
import { describe, it, expect } from 'vitest';
import { challengeView, type Challenge } from '../challenges';

const NOW = new Date('2026-09-29T12:00:00Z');
const base: Challenge = {
  id: 'o', proposerId: 'ann', targetId: 'bob', league: 'great', state: 'open',
  scheduledFor: null, expiresAt: '2026-09-29T13:00:00Z', verifiedHash: 'h', matchId: null,
  rosterSize: 3, formatName: 'Cup',
};
const v = (over: Partial<Challenge>, me: string) => challengeView({ ...base, ...over }, me, NOW);

describe('challengeView', () => {
  it('a gone offer is withdrawn', () => {
    expect(challengeView(null, 'bob', NOW)).toEqual({ label: 'Withdrawn', tone: 'dead', actions: [] });
  });
  it('the target can accept or decline a verified open challenge', () => {
    expect(v({}, 'bob')).toMatchObject({ tone: 'open', actions: ['accept', 'decline'] });
  });
  it('shows a verifying state and no Accept in the first minute', () => {
    const r = v({ verifiedHash: null }, 'bob');
    expect(r.label).toMatch(/Verifying/);
    expect(r.actions).toEqual(['decline']);
  });
  it('the proposer waits and may withdraw', () => {
    expect(v({}, 'ann')).toMatchObject({ tone: 'wait', actions: ['withdraw'] });
    expect(v({ verifiedHash: null }, 'ann').label).toMatch(/Verifying/);
  });
  it('a scheduled acceptance asks the proposer to confirm and tells the target to wait', () => {
    const acc = { state: 'accepted' as const, scheduledFor: '2026-10-01T12:00:00Z', expiresAt: '2026-10-01T12:00:00Z' };
    expect(v(acc, 'ann')).toMatchObject({ tone: 'open', actions: ['confirm', 'withdraw'] });
    expect(v(acc, 'bob')).toMatchObject({ tone: 'wait', actions: [] });
  });
  it('a converted challenge is a match', () => {
    expect(v({ state: 'converted', matchId: 'm' }, 'bob')).toMatchObject({ tone: 'done', actions: [] });
  });
  it('declined and expired are dead, expiry judged by the clock as well as the state', () => {
    expect(v({ state: 'declined' }, 'ann')).toMatchObject({ label: 'Declined', tone: 'dead', actions: [] });
    expect(v({ state: 'lapsed' }, 'bob')).toMatchObject({ label: 'Expired', tone: 'dead', actions: [] });
    expect(v({ expiresAt: '2026-09-29T11:59:00Z' }, 'bob')).toMatchObject({ label: 'Expired', tone: 'dead' });
  });
  it('a stranger to the challenge sees no actions', () => {
    expect(v({}, 'cal').actions).toEqual([]);
  });
});
```

Add to `channels.test.ts` (use that file's existing harness/mocking style — read its top first): one test that `listMessages` and `subscribeToChannel` map `kind` (default `'text'`) and `offer_id → offerId`; one that a DM in `withDisplayNames` output carries `otherId`, and a group's is `null`. Add to `matchmaking.test.ts`: one test that `listOpenOffers` and `myOffers` both call `.is('target_id', null)` (extend the harness's query stub with `is: vi.fn(...)` recording like its siblings), and one that `createChallenge` calls `rpc('create_challenge', …)` with `p_claimed_hash` equal to `rulesHash(format)`, `p_data_rev` = `DATA_REV`, ISO `p_scheduled_for`, and refuses a past `scheduledFor` before any network call (put these in `challenges.test.ts` if the harness there is simpler — use the same `vi.hoisted` supabase mock pattern as `matchmaking.test.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/lib/__tests__/challenges.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** `lib/challenges.ts`:

```ts
import { supabase } from './supabase';
import { DATA_REV } from './data';
import { rulesHash, type Format } from '../rules';
import type { LeagueId } from './types';
import type { StoredMember } from './teamCodec';
import type { OfferState } from './matchmaking';

export type ChallengeState = OfferState | 'declined';

export interface Challenge {
  id: string;
  proposerId: string;
  targetId: string;
  league: LeagueId;
  state: ChallengeState;
  scheduledFor: string | null;
  expiresAt: string;
  /** Null for the first minute: the coordinator has not recomputed the hash yet. */
  verifiedHash: string | null;
  matchId: string | null;
  /** Length of the proposer's team — what the accepter's roster must match. */
  rosterSize: number;
  formatName: string | null;
}

export type ChallengeAction = 'accept' | 'decline' | 'confirm' | 'withdraw';
export interface ChallengeView {
  label: string;
  tone: 'open' | 'wait' | 'done' | 'dead';
  actions: ChallengeAction[];
}

/** What a card says and offers, for one viewer at one moment. Pure. */
export function challengeView(c: Challenge | null, me: string, now: Date): ChallengeView {
  if (!c) return { label: 'Withdrawn', tone: 'dead', actions: [] };
  if (c.state === 'converted') return { label: 'Match on — open it', tone: 'done', actions: [] };
  if (c.state === 'declined') return { label: 'Declined', tone: 'dead', actions: [] };
  const live = c.state === 'open' || c.state === 'accepted';
  if (c.state === 'lapsed' || (live && new Date(c.expiresAt) <= now)) {
    return { label: 'Expired', tone: 'dead', actions: [] };
  }
  const mine = c.proposerId === me;
  const theirs = c.targetId === me;
  if (c.state === 'open') {
    if (theirs) {
      return c.verifiedHash
        ? { label: 'Waiting for you', tone: 'open', actions: ['accept', 'decline'] }
        : { label: 'Verifying the format…', tone: 'wait', actions: ['decline'] };
    }
    if (mine) {
      return {
        label: c.verifiedHash ? 'Waiting for them' : 'Verifying the format…',
        tone: 'wait',
        actions: ['withdraw'],
      };
    }
  }
  if (c.state === 'accepted') {
    if (mine) return { label: 'They accepted — confirm to lock it in', tone: 'open', actions: ['confirm', 'withdraw'] };
    if (theirs) return { label: 'Accepted — waiting for them to confirm', tone: 'wait', actions: [] };
  }
  return { label: 'Pending', tone: 'wait', actions: [] };
}

export async function createChallenge(a: {
  targetId: string;
  league: LeagueId;
  formatVersionId: string;
  format: Format;
  team: StoredMember[];
  scheduledFor?: Date;
}): Promise<string> {
  if (a.scheduledFor && a.scheduledFor <= new Date()) {
    throw new Error('a scheduled challenge cannot be in the past');
  }
  const { data, error } = await supabase.rpc('create_challenge', {
    p_target: a.targetId,
    p_format_version: a.formatVersionId,
    p_claimed_hash: await rulesHash(a.format),
    p_league: a.league,
    p_team: a.team,
    p_data_rev: DATA_REV,
    p_scheduled_for: a.scheduledFor ? a.scheduledFor.toISOString() : null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function declineChallenge(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('decline_challenge', { p_offer: id });
  if (error) throw new Error(error.message);
  return data as boolean;
}

/** The proposer's own row, deleted under the existing "an offer belongs to the person who proposed it" policy. */
export async function withdrawChallenge(id: string): Promise<void> {
  const { error } = await supabase.from('match_offers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

const COLS =
  'id, proposer_id, target_id, league, state, scheduled_for, expires_at, verified_hash, match_id, team, format_versions(formats(name))';

interface Row {
  id: string;
  proposer_id: string;
  target_id: string;
  league: LeagueId;
  state: ChallengeState;
  scheduled_for: string | null;
  expires_at: string;
  verified_hash: string | null;
  match_id: string | null;
  team: unknown[] | null;
  // PostgREST returns an embedded to-one as an object, but the generated
  // types say array; read both.
  format_versions?: { formats?: { name: string } | { name: string }[] | null } | { formats?: { name: string } | { name: string }[] | null }[] | null;
}

function nameOf(fv: Row['format_versions']): string | null {
  const v = Array.isArray(fv) ? fv[0] : fv;
  const f = Array.isArray(v?.formats) ? v?.formats[0] : v?.formats;
  return f?.name ?? null;
}

function toChallenge(r: Row): Challenge {
  return {
    id: r.id,
    proposerId: r.proposer_id,
    targetId: r.target_id,
    league: r.league,
    state: r.state,
    scheduledFor: r.scheduled_for,
    expiresAt: r.expires_at,
    verifiedHash: r.verified_hash,
    matchId: r.match_id,
    rosterSize: (r.team ?? []).length,
    formatName: nameOf(r.format_versions),
  };
}

/** Keyed by id; an id with no row (withdrawn, or not yours) is simply absent. */
export async function fetchChallenges(ids: string[]): Promise<Map<string, Challenge>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('match_offers').select(COLS).in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [(r as unknown as Row).id, toChallenge(r as unknown as Row)]));
}

/** Challenges I sent or received, newest first — the bell's raw material. */
export async function myChallenges(): Promise<Challenge[]> {
  const { data: s, error: se } = await supabase.auth.getSession();
  if (se) throw new Error(se.message);
  const me = s.session?.user.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('match_offers')
    .select(COLS)
    .not('target_id', 'is', null)
    .or(`proposer_id.eq.${me},target_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toChallenge(r as unknown as Row));
}
```

`lib/channels.ts`: add `kind: 'text' | 'challenge'` and `offerId: string | null` to `Message`; `kind: 'text' | 'challenge'`, `offer_id: string | null` to `MessageRow`; map them in `toMessage` (`kind: r.kind ?? 'text'`, `offerId: r.offer_id ?? null`); add `kind, offer_id` to BOTH `select(...)` strings (`listMessages`, `sendMessage`). Add `otherId: string | null` to `ChannelDisplay` and set it in `withDisplayNames`: for a `dm`, the id of the member that is not `me` (the code already computes `otherIds` — read that block and reuse the same member scan); `null` for group and match.

`lib/matchmaking.ts`: in `listOpenOffers` add `.is('target_id', null)` after `.eq('state', 'open')`; in `myOffers` add `.is('target_id', null)` before `.order(...)`. Comment both: aimed offers are challenges, read through `lib/challenges.ts`, and must never reach the board or the Matches screen's own lists.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/lib/__tests__/challenges.test.ts src/lib/__tests__/channels.test.ts src/lib/__tests__/matchmaking.test.ts && npx tsc -b`
Expected: PASS, tsc clean (every existing constructor of `Message` in tests/fixtures now needs the two fields — fix those fixtures, not the types).

- [ ] **Step 5: Commit**

```bash
git add -A app/src/lib
git commit -m "feat(chat): challenge client — create, decline, read, and a pure card view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The challenge card in a DM

**Files:**
- Create: `app/src/components/ChallengeCard.tsx`
- Modify: `app/src/components/ChatPane.tsx` (render a card for `m.kind === 'challenge'`)
- Modify: `app/src/styles/components.css` (append `.challenge-card*`)
- Test: `app/src/components/__tests__/challenge-card.test.tsx`

**Interfaces:**
- Consumes: `Challenge`, `challengeView`, `fetchChallenges`, `declineChallenge`, `withdrawChallenge` (Task 2); `acceptOffer`, `confirmOffer`, `myMatches` (`lib/matchmaking`, `lib/matches`); `listTeams` (`lib/saves`); `useSession`, `useAppState`.
- Produces: `<ChallengeCard offerId={string} />` — self-contained: loads its offer, polls every 10s while the state is non-terminal, and offers the actions `challengeView` returns.

- [ ] **Step 1: Write the failing test** — `challenge-card.test.tsx`. Mock `../../lib/challenges` (`fetchChallenges`, `declineChallenge`, `withdrawChallenge`), `../../lib/matchmaking` (`acceptOffer`, `confirmOffer`), `../../lib/matches` (`myMatches`), `../../lib/saves` (`listTeams`) and the session (copy the signed-in harness pattern from `components/__tests__/chat-dock.test.tsx`: `fakeClient`/`fakeSession`, or mock `useSession` from `../../state/SessionContext`). Cases, each asserting real behaviour:
  1. Target, verified open challenge, one saved team of the right size: shows "Waiting for you", a team `<select>`, Accept and Decline. Clicking Accept calls `acceptOffer('o', team.members)` exactly once.
  2. Target, no saved team of that size: Accept is disabled and the text names the size ("Save a team of 3 in Teams first").
  3. Target, `verifiedHash: null`: label "Verifying the format…", no Accept button, Decline present.
  4. Proposer, open: "Waiting for them", Withdraw calls `withdrawChallenge`; after it resolves the card re-fetches.
  5. Proposer, `accepted` scheduled: Confirm calls `confirmOffer('o')`.
  6. `converted` with `matchId: 'm'`: shows an "Open match" button; clicking it calls `myMatches`, finds `m`, and the app state moves to the `match` screen with that match (render inside `renderApp` and read `state.screen` through the DOM: the shell shows the Match screen, or assert on a spy `patch` if the card is rendered under a test provider).
  7. Terminal states (`declined`, `lapsed`) show their label and no buttons, and the 10s poll is cleared (use `vi.useFakeTimers` and assert `fetchChallenges` call count stops growing).
  8. Decline calls `declineChallenge('o')` and re-fetches.
  9. A rejected `acceptOffer` shows its message in a `role="alert"` `.friend-notice` and leaves the card usable.

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/components/__tests__/challenge-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** `ChallengeCard.tsx` skeleton to fill in (state names are binding for the tests above):

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { useAppState } from '../state/AppState';
import {
  challengeView, declineChallenge, fetchChallenges, withdrawChallenge, type Challenge,
} from '../lib/challenges';
import { acceptOffer, confirmOffer } from '../lib/matchmaking';
import { myMatches } from '../lib/matches';
import { listTeams, type SavedTeam } from '../lib/saves';

const POLL_MS = 10_000;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ChallengeCard({ offerId }: { offerId: string }) {
  const { user } = useSession();
  const { patch } = useAppState();
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(undefined); // undefined = loading
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChallenge((await fetchChallenges([offerId])).get(offerId) ?? null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [offerId]);

  // Poll only while the challenge can still change.
  const view = user && challenge !== undefined ? challengeView(challenge, user.id, new Date()) : null;
  const terminal = view?.tone === 'dead' || view?.tone === 'done';
  useEffect(() => {
    void load();
    if (terminal) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load, terminal]);

  // Teams the accepter can bring: same size as the proposer's, same league.
  const wantsTeam = !!challenge && !!user && challenge.targetId === user.id && challenge.state === 'open';
  useEffect(() => {
    if (!wantsTeam || !challenge) return;
    const size = challenge.rosterSize;
    if (size !== 3 && size !== 6) return; // only sizes the app can save
    void listTeams(size).then((ts) => {
      const ok = ts.filter((t) => t.league === challenge.league);
      setTeams(ok);
      setTeamId((cur) => (ok.some((t) => t.id === cur) ? cur : ok[0]?.id ?? ''));
    }).catch((e) => setError(messageOf(e)));
  }, [wantsTeam, challenge]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  async function openMatch() {
    if (!challenge?.matchId) return;
    const m = (await myMatches()).find((x) => x.id === challenge.matchId);
    if (m) patch({ activeMatch: m, screen: 'match' });
  }

  // …render (below)
}
```

Render rules (a `<div className={`challenge-card chamfer-9 tone-${view.tone}`}>`): `hud-label` "Challenge"; a line with `challenge.formatName ?? 'a public format'`, the league name (import `LEAGUE_BY_ID` from `../lib/data`), "now" or the scheduled time via `new Date(scheduledFor).toLocaleString()`, and — while live — "expires <time>"; the `view.label`; then, per `view.actions`: `accept` → a `<select aria-label="Team to bring">` (only when `teams.length > 0`) plus `<button className="btn btn-primary">Accept</button>` disabled unless `teamId` is set (and the hint "Save a team of N in Teams first" when `teams.length === 0`); `decline`/`withdraw`/`confirm` → `.btn`/`.btn-ghost` buttons calling `run(() => declineChallenge(offerId))`, `run(() => withdrawChallenge(offerId))`, `run(() => confirmOffer(offerId))`; accept → `run(() => acceptOffer(offerId, teams.find((t) => t.id === teamId)!.members))`. When `challenge?.state === 'converted'` render an `Open match` `.btn` that calls `openMatch()`. Loading (`undefined`) renders a quiet "Loading challenge…"; `error` renders `<p className="friend-notice" role="alert">`. All buttons `disabled={busy}`.

`ChatPane.tsx`: inside the `messages.map`, before the `<p className="chat-message-body">`, branch: `m.kind === 'challenge' && m.offerId && !m.deletedAt ? <ChallengeCard offerId={m.offerId} /> : <p …existing body…>` — keep the report controls exactly as they are (a challenge card is still reportable text "Challenge"; that is acceptable and the moderation queue already handles it).

`components.css` — append a small block: `.challenge-card` (panel padding `var(--space-3)`, border `var(--border-hairline) solid var(--rule-hairline)`, background `var(--surface-1)`), a left border in `var(--rule-strong)` that becomes `var(--color-accent)` for `.tone-open`, muted (`opacity: .7`) for `.tone-dead`, and `.challenge-card-actions { display: flex; gap: var(--space-2); flex-wrap: wrap }`. Tokens only; verify each with `grep -n -- "--rule-hairline\|--surface-1\|--space-3\|--color-accent" app/src/styles/*.css` and `npm run tokens`.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/components/__tests__/challenge-card.test.tsx src/components/__tests__/chat-pane.test.tsx src/components/__tests__/chat-dock.test.tsx && npx tsc -b && npm run tokens`
Expected: PASS (existing chat tests still green — their `Message` fixtures got `kind` in Task 2).

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(chat): live challenge card in the DM

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The challenge sheet and its entry points

**Files:**
- Create: `app/src/components/ChallengeSheet.tsx`
- Modify: `app/src/state/ChatDockContext.tsx` (generic channel request), `app/src/components/ChatDock.tsx` (consume it)
- Modify: `app/src/screens/FriendsScreen.tsx` (Challenge on accepted rows), `app/src/components/ChatPane.tsx` (Challenge in a DM header)
- Modify: `app/src/styles/components.css`
- Test: `app/src/components/__tests__/challenge-sheet.test.tsx`; extend `friends-screen.test.tsx`, `chat-pane.test.tsx`

**Interfaces:**
- Consumes: `createChallenge` (Task 2); `listServerFormats`, `SavedFormat` (`lib/saves`); `listTeams`, `SavedTeam`; `openDm` (`lib/channels`); `useAppState`.
- Produces:
  - `<ChallengeSheet target={{ id: string; name: string }} onClose={() => void} />`
  - `ChatDockContext` gains `requestedChannelId: string | null`, `requestChannel(id: string)`, `clearRequestedChannel()` (the existing match-request members stay unchanged).
  - `ChatPane` gets an optional `onChallenge?: (target: { id: string; name: string }) => void` prop; it shows a "Challenge" button in the header only for `channel.kind === 'dm' && channel.otherId`.

- [ ] **Step 1: Write the failing tests.**
`challenge-sheet.test.tsx` (mock `../../lib/saves`, `../../lib/challenges`, `../../lib/channels`): (1) league defaults to `state.league`; changing it re-filters the formats list to `f.format.base === league`; (2) the team list shows only saved teams whose `size === format.composition.size` and `league` matches; (3) Send is disabled until a format and a team are chosen; (4) "Scheduled" reveals a `datetime-local` input and Send passes `scheduledFor` as a `Date`, "Now" passes none; (5) Send calls `createChallenge({ targetId, league, formatVersionId: version.versionId, format, team: team.members, scheduledFor })`, then `openDm(target.id)`, then `requestChannel(dmId)` through the context, then `onClose`; (6) a rejected send (e.g. `'a challenge needs a public format'`) is shown in `role="alert"` and the sheet stays open; (7) Escape and the Cancel button call `onClose`; (8) no saved formats/teams → helper text pointing to Formats/Teams, Send disabled.
`friends-screen.test.tsx`: an accepted-friend row has a `Challenge` button (aria-label `Challenge <name>`) that opens the sheet for that friend; pending/blocked rows have none.
`chat-pane.test.tsx`: a DM channel with `otherId` shows Challenge and clicking it calls `onChallenge({ id: otherId, name: displayTitle })`; group and match channels do not show it.

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/components/__tests__/challenge-sheet.test.tsx` → FAIL, module not found.

- [ ] **Step 3: Implement.**
`ChatDockContext.tsx`: add `requestedChannelId` state alongside `requestedMatchId`, exposing `requestChannel: (id) => setRequestedChannelId(id)` and `clearRequestedChannel`. Keep the doc comment style; note this is the generic sibling of the match request.
`ChatDock.tsx`: next to the existing effect for `requestedMatchId`, add one for `requestedChannelId`: when `channels` contains that id, `openChannel(id)` and `clearRequestedChannel()`; if the channel list has not loaded it, keep the request (same rule as the match effect). Also call `refresh()` once when a request is pending and the channel is absent (a just-created DM is not in the last poll).
`ChallengeSheet.tsx`: a modal `<div role="dialog" aria-modal="true" aria-label={`Challenge ${target.name}`}>` in the HUD style (`.panel.chamfer-9`, a backdrop; focus the first control on mount; close on Escape and backdrop click), fields per the tests above, using `<select>`s (native, accessible) for league, format and team and two `.seg-btn`-styled radios for Now/Scheduled. Load formats with `listServerFormats()` and teams with `listTeams(size)` once the format is chosen. On send: `setBusy(true)`, the four calls in test 5's order, errors to `.friend-notice role="alert"`.
`FriendsScreen.tsx`: state `challengeTarget`; on the accepted rows add `<button className="btn" aria-label={`Challenge ${name}`} onClick={() => setChallengeTarget({ id: f.otherId, name })}>Challenge</button>` where `name` is however the row already labels the friend (read the accepted-row JSX at ~L328-346 and reuse its name variable); render `{challengeTarget && <ChallengeSheet target={challengeTarget} onClose={() => setChallengeTarget(null)} />}`. Follow the file's own rule that "every row's mutation button carries the person's name in its accessible name".
`ChatPane.tsx`: add the optional `onChallenge` prop and the header button; `ChatDock.tsx` passes `onChallenge` that sets a `challengeTarget` and renders the same `ChallengeSheet`.
CSS: `.challenge-sheet`, `.challenge-sheet-backdrop` (fixed inset, `z-index` above the dock), form grid using `--space-*`; tokens only.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/components/__tests__/challenge-sheet.test.tsx src/screens/__tests__/friends-screen.test.tsx src/components/__tests__/chat-pane.test.tsx src/components/__tests__/chat-dock.test.tsx && npx tsc -b && npm run tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(chat): challenge sheet, opened from a friend row or a DM

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: One shared channel list

**Files:**
- Create: `app/src/state/ChannelListContext.tsx`
- Modify: `app/src/components/ChatDock.tsx`, `app/src/App.tsx`, `app/src/test/render.tsx`
- Test: `app/src/state/__tests__/channel-list.test.tsx`; existing `chat-dock.test.tsx` must stay green unchanged in intent.

**Interfaces:**
- Consumes: `listChannelsWithActivity`, `withDisplayNames`, `isChannelUnread`, `ChannelDisplay`, `useSession`.
- Produces:
  - `<ChannelListProvider>` (mounted inside `SessionProvider`).
  - `useChannelList(): { channels: ChannelDisplay[] | null; loadError: string | null; refresh: () => void; bumpActivity(id: string, at: string): void; bumpRead(id: string, at: string): void; totalUnread: number }`
  - `POLL_MS` exported (the value `ChatDock` already uses — move it, do not change it).

This is a **behaviour-preserving refactor**: the dock, the Chat screen (Task 6) and the bell (Task 7) must share one poll rather than each polling the same three queries.

- [ ] **Step 1: Write the failing test** — `channel-list.test.tsx` with `listChannelsWithActivity`/`withDisplayNames` mocked: (1) signed out → `channels === null`, no fetch; (2) signed in → one fetch on mount, `channels` populated, `totalUnread` counts `isChannelUnread` rows; (3) two consumers rendered under one provider cause **one** fetch, not two; (4) `refresh()` refetches; (5) a fetch error sets `loadError` and keeps the previous `channels`; (6) `bumpActivity` only moves `lastMessageAt` forward, `bumpRead` only moves `lastReadAt` forward; (7) the interval is cleared on unmount (fake timers: no calls after unmount).

- [ ] **Step 2: Run to verify failure** — FAIL, module not found.

- [ ] **Step 3: Implement.** Move these pieces **verbatim** out of `ChatDock.tsx` into the provider (read the top of `ChatDock.tsx` first — `POLL_MS`, the `channels`/`loadError` state, `refresh`, the polling `useEffect` keyed on `user`, `bumpActivity`, `bumpRead`, `totalUnread`): behaviour must not change. `ChatDock` then reads `const { channels, loadError, refresh, bumpActivity, bumpRead, totalUnread } = useChannelList();` and keeps only its own UI state (`railCollapsed`, `openIds`, `minimizedIds`, `openChannel`, `closeChannel`, `toggleMinimize`, the request effects). Mount `<ChannelListProvider>` in `App.tsx` between `SessionProvider` and `AppStateProvider`, and in `test/render.tsx` in the same place (its doc comment names App.tsx's nesting order — keep it true). `useChannelList` throws outside the provider, like the other contexts.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/state/__tests__/channel-list.test.tsx src/components/__tests__/chat-dock.test.tsx src/components/__tests__/chat-pane.test.tsx src/screens/__tests__/app-shell.test.tsx && npx tsc -b`
Expected: PASS with no edits to the dock tests' assertions (fixtures may need the provider; that is a harness change, not a weakening).

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "refactor(chat): one shared channel list for every reader

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Chat screen

**Files:**
- Create: `app/src/screens/ChatScreen.tsx`, `app/src/components/OpponentPanel.tsx`
- Modify: `app/src/state/AppState.tsx` (`Screen` += `'chat'`), `app/src/lib/screens.ts`, `app/src/lib/badges.ts`, `app/src/components/ChatDock.tsx`, `app/src/components/ChatPane.tsx`, `app/src/App.tsx`, `app/src/styles/components.css`
- Test: `app/src/screens/__tests__/chat-screen.test.tsx`, `app/src/components/__tests__/opponent-panel.test.tsx`; update `lib/__tests__/screens.test.ts`, `route.test.ts`, `badges.test.ts`

**Interfaces:**
- Consumes: `useChannelList` (Task 5), `ChatPane`, `ChallengeSheet`, `requestedChannelId` (Task 4), `opponentFriendCode`, `myMatches`, `blockUser`, `humanTime`, `isChannelUnread`.
- Produces:
  - `Screen` includes `'chat'`; `SCREEN_DEFS` has `{ id: 'chat', label: 'Chat', kicker: 'Talk', glyph: '✉', hue: 'var(--type-fire)', blurb: 'Message opponents and answer their challenges.' }` (fire is unused by any screen — the distinct-hue test guards this); `SECTIONS` Play = `['matchmaking', 'match', 'friends', 'chat']`; `hashFor('chat') === '#/play/chat'`.
  - `computeBadges(friends, offers, me, unreadChannels?: number)` — a fourth optional argument adds `chat` when > 0 (existing callers and tests unchanged).
  - `ChatPane` gets `embedded?: boolean` — hides minimize/close controls and the `is-minimized` styling, and fills its parent.
  - `<OpponentPanel channel={ChannelDisplay} onChallenge={(t) => void} />`.

- [ ] **Step 1: Write the failing tests.**
`lib/__tests__/screens.test.ts`: change the Play expectation to `['matchmaking', 'match', 'friends', 'chat']`. `route.test.ts` already round-trips every `SCREEN_DEFS` entry (chat is covered) — add one explicit `expect(hashFor('chat')).toBe('#/play/chat')`. `badges.test.ts`: `computeBadges([], [], 'me', 3)` → `{ chat: 3 }`; omitted or `0` → no `chat` key.
`chat-screen.test.tsx` (mock `useChannelList` via a provider stub or the underlying `lib/channels` functions, and `ChatPane` as a spy component receiving `channel` and `embedded`): (1) lists every channel with title, kind word, sub-line and an Unread tag for unread ones (reuse `humanTime`/`isChannelUnread`; a **filter** of All / Direct / Groups / Matches narrows the list); (2) selecting a row renders `ChatPane` with `embedded` and that channel; (3) with none selected it shows the empty prompt "Pick a conversation"; (4) a pending `requestedChannelId` selects that channel once the list carries it and clears the request; (5) for a DM the `OpponentPanel` is shown, for a group/match it is not (a match channel shows only a "Open match" button, see panel test); (6) the dock renders nothing while `state.screen === 'chat'` (assert `.chat-dock` absent on the chat screen and present elsewhere).
`opponent-panel.test.tsx` (mock `opponentFriendCode`, `myMatches`, `blockUser`): shows the other person's name; shows their friend code when `opponentFriendCode` returns one and "No friend code shared" when null; shows "N matches together" counted from `myMatches()` rows where the opponent is `otherId`; Challenge calls `onChallenge({ id: otherId, name })`; Block asks for confirmation (`window.confirm` spy) and calls `blockUser(otherId)` only when confirmed; shows a quiet error on failure.

- [ ] **Step 2: Run to verify failure** — the new tests FAIL (missing modules); the updated `screens.test.ts` FAILS on the Play list.

- [ ] **Step 3: Implement.** Add `'chat'` to the `Screen` union in `AppState.tsx`; add the `SCREEN_DEFS` entry after `friends`; add `'chat'` to `SECTIONS.play.screens`; confirm `hashFor`/`screenFromHash` need no edit (they derive from `SECTIONS`). `badges.ts`: extend `computeBadges` per the interface (`if (unreadChannels) out.chat = unreadChannels`), and in `state/useBadges.ts` pass `totalUnread` from `useChannelList()` — `useBadges` must not fetch channels itself.

`ChatScreen.tsx` layout: `<div className="chat-screen">` a CSS grid `minmax(14rem, 18rem) minmax(0, 1fr) minmax(12rem, 16rem)` (right column only when a DM is selected; below 900px stack: inbox, then conversation, panel hidden). Left: filter `seg` buttons and a `ul.chat-rail-list`-style list reusing the dock's row markup/classes (`chat-rail-row`, `chat-rail-title`, `chat-rail-sub`, `chat-rail-unread-tag`) — extract the dock's `kindWord`, `subLine` and `railAriaLabel` helpers to a shared `components/chatRow.ts` and import them from both (the only refactor in this task; keep function bodies verbatim). Selection is local state `selectedId`, cleared if the channel disappears. Centre: `<ChatPane embedded channel={selected} onChallenge={setChallengeTarget} onActivity={bumpActivity} onRead={bumpRead} minimized={false} onToggleMinimize={noop} onClose={noop} />` — read `ChatPane` first and make `embedded` a real prop that removes the two control buttons and header collapse behaviour, rather than passing no-ops that leave dead buttons. Right: `OpponentPanel`. Also consume `requestedChannelId` like the dock does. `App.tsx`: add the lazy `ChatScreen` case (`<LazyScreen key="chat">`) and make `ChatDock` return null when `state.screen === 'chat'` — the dock must also skip its request effects then, so a request made from the Chat screen is consumed by the screen, not the dock (test 6 and 4 cover both).

`OpponentPanel.tsx`: `useEffect` on `channel.otherId` loading `opponentFriendCode(otherId)` and `myMatches()`, an `aria-label="Opponent"` `<aside className="opponent-panel panel chamfer-9">`; buttons per the test above. A match channel gets an "Open match" button instead (find the match by `channel.matchId` via `myMatches`, then `patch({ activeMatch, screen: 'match' })`).

CSS: `.chat-screen`, `.opponent-panel`, using only tokens; the page must not gain horizontal scroll at 375px (verified in Task 8).

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/screens/__tests__/chat-screen.test.tsx src/components/__tests__/opponent-panel.test.tsx src/lib/__tests__/screens.test.ts src/lib/__tests__/route.test.ts src/lib/__tests__/badges.test.ts src/components/__tests__/chat-dock.test.tsx src/components/__tests__/section-rail.test.tsx src/screens/__tests__/landing-featured.test.tsx src/screens/__tests__/app-shell.test.tsx && npx tsc -b && npm run tokens`
Expected: PASS (the landing/section tests derive from `SECTIONS`, so the new card and rail item appear without edits — if one hard-codes counts, update it to derive).

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(chat): full-page Chat screen with an opponent panel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Notification bell and toasts

**Files:**
- Create: `app/src/lib/notifications.ts`, `app/src/state/useNotifications.ts`, `app/src/components/NotificationBell.tsx`, `app/src/components/Toaster.tsx`
- Modify: `app/src/App.tsx` (bell in `.nav-right`, `<Toaster />` in `Shell`), `app/src/styles/components.css`
- Test: `app/src/lib/__tests__/notifications.test.ts`, `app/src/components/__tests__/notification-bell.test.tsx`

**Interfaces:**
- Consumes: `useChannelList` (Task 5), `myChallenges`/`Challenge`/`challengeView` (Task 2), `listFriends`/`Friend` (`lib/social`), `useSession`, `useAppState`, `useChatDockRequest`.
- Produces:
  - `interface Notice { id: string; kind: 'message' | 'challenge' | 'confirm' | 'friend'; title: string; detail: string; target: { screen: Screen; channelId?: string } }`
  - `buildNotices(input: { channels: ChannelDisplay[]; challenges: Challenge[]; friends: Friend[]; me: string; now: Date }): Notice[]` — pure. Rules: one `message` notice per unread channel (`id: 'ch:'+id`, title = `displayTitle`, target chat + channelId); one `challenge` per `open`, verified-or-not, non-expired challenge where `targetId === me` (`id: 'co:'+id`; target = the DM with the proposer → the channel in `channels` whose `otherId === proposerId`, else screen `chat` with no channel); one `confirm` per `accepted` non-expired challenge where `proposerId === me` (`id: 'cc:'+id`); one `friend` per pending incoming request (`id: 'fr:'+otherId`, target screen `friends`). Sorted challenges/confirm first, then friend, then message; stable within a kind.
  - `useNotifications(): { notices: Notice[]; fresh: Notice[] }` — polls `myChallenges()` and `listFriends()` every 15s while signed in (channels come from `useChannelList`, not re-fetched); `fresh` = notices whose ids were not present on the previous evaluation and only after the first load (so opening the app does not toast the backlog).
  - `<NotificationBell />` and `<Toaster />`.

- [ ] **Step 1: Write the failing tests.**
`notifications.test.ts` (pure): one case per rule above — an unread channel yields a message notice; a read one does not; an open challenge to me yields a `challenge` notice whose target is the DM found by `otherId`; the same challenge from me yields nothing (I am waiting, not being asked); an expired challenge yields nothing; an `accepted` challenge I proposed yields `confirm`; an incoming pending friend request yields `friend`, an outgoing one does not; ordering; ids are stable across calls.
`notification-bell.test.tsx` (mock `useNotifications`): the bell button has `aria-label="Notifications"` and shows a count badge only when `notices.length > 0` (accessible name `N notifications`); clicking opens an overlay list (`role="menu"`), each item a button showing title and detail; clicking an item calls `patch({ screen })`, and for a chat target also `requestChannel(channelId)`, then closes the menu; Escape and an outside mousedown close it (copy `ThemeMenu`'s deferred-listener pattern — read it); an empty list says "You're all caught up". `Toaster`: renders a toast (`role="status"`, in an `aria-live="polite"` region) for each id in `fresh`, removes it after 6s (fake timers), never renders more than 3 at once, and clicking a toast navigates like the bell item.

- [ ] **Step 2: Run to verify failure** — FAIL, modules not found.

- [ ] **Step 3: Implement** per the interfaces. `useNotifications` keeps the previous id set in a ref and a `loaded` flag set after the first successful `myChallenges()`+`listFriends()` round; failures leave the last answer (same rule as `useBadges`). `NotificationBell` mirrors `ThemeMenu` (trigger + overlay panel, never inline growth, `aria-expanded`, `aria-controls` via `useId`). Place `<NotificationBell />` in `.nav-right` between the `Account` button and `ThemeMenu` in `App.tsx`; render `<Toaster />` as a sibling after `<ChatDock />` in `Shell`. CSS: `.notification-bell`, `.notification-panel`, `.toaster`, `.toast` — tokens only; the toast enters once (`transition` on transform/opacity using `--dur-3`, `--ease-out`, which already collapse under reduced motion) and never loops.

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/lib/__tests__/notifications.test.ts src/components/__tests__/notification-bell.test.tsx src/screens/__tests__/app-shell.test.tsx src/components/__tests__/responsive.test.tsx && npx tsc -b && npm run tokens`
Expected: PASS. (`responsive.test.tsx` guards `.nav-right` wrapping — the bell must not break it.)

- [ ] **Step 5: Commit**

```bash
git add -A app/src
git commit -m "feat(shell): notification bell and toasts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Real-stack roundtrip, verification, handoff

**Files:**
- Create: `app/tools/m4-challenges-roundtrip.ts`
- Modify: `docs/superpowers/HANDOFF.md`, `package.json` script (optional: `"roundtrip:m4"`)

- [ ] **Step 1: The roundtrip script.** Copy the structure, sign-in helpers, run-stamp emails and check-reporting style of `app/tools/m3b-roundtrip.ts` (read it fully first — it explains the two-client trick and why it imports the SHIPPING modules). Two real confirmed bots befriend each other, then, through `src/lib/challenges.ts`, `src/lib/matchmaking.ts` and `src/lib/channels.ts` only (never SQL, never re-implemented logic), check:
  1. `createChallenge` (bot A → bot B, public format saved through `saveServerFormat` with `visibility public` — if the shipping API cannot set visibility, use the admin client to flip it and say so in the script's header) returns an offer id; bot B's `listMessages` on the DM shows one `kind: 'challenge'` message with that `offerId`.
  2. `fetchChallenges` as B returns it `open`; as a third bot returns nothing; `listOpenOffers` never shows it.
  3. Before the coordinator ticks, B's `acceptOffer` is refused with "not been verified yet"; invoke the coordinator tick (the same call `m2a-roundtrip.ts` uses to force one — reuse it), then `acceptOffer` returns a match id and `fetchChallenges` says `converted` with that `matchId`.
  4. A second challenge: `declineChallenge` as B returns true and the state is `declined`; A's `withdrawChallenge` on a third, open one deletes it and `fetchChallenges` no longer returns it.
  5. A blocked pair: `createChallenge` refuses with the one sentence.
  Each check prints PASS/FAIL like the siblings and the script exits non-zero on any FAIL.

Run: `cd app && npm run db:reset && npx esbuild tools/m4-challenges-roundtrip.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/m4.mjs --log-level=warning && node node_modules/.cache/m4.mjs` (mirror however `m3b-roundtrip.ts`'s header says to run it, including any env vars).
Expected: every check PASS.

- [ ] **Step 2: Drive the UI in the browser** (two accounts need the local stack; sign in as the two roundtrip-style users, or create two test users in the local Supabase — local development host, test values only). Measure, do not eyeball (`javascript_tool`; the pane closes dropdowns between calls, so open-and-measure in one call, and reload after every `resize_window`):
  - Friend row → Challenge opens the sheet; sending it makes a card appear in the DM (dock) for the other account within the 10s poll; Accept/Decline work; Open match lands on the Match screen.
  - Play → Chat: inbox, conversation, opponent panel measure without overlap at 1440 (`getBoundingClientRect` of the three columns: left of each ≥ right of the previous), and at 375 there is no horizontal page scroll (`documentElement.scrollWidth <= clientWidth`).
  - The dock is absent on the Chat screen and present elsewhere.
  - Bell count equals `notices.length`; clicking a challenge item lands on the DM; a new incoming challenge produces a toast that disappears.
  Report anything that could not be driven; do not infer it.

- [ ] **Step 3: Full gates**

Run: `cd app && npm run check && npm run check:db`
Expected: `ALL CHECKS PASSED` and the DB suite green (rerun any timed-out file alone before believing a red).

- [ ] **Step 4: Deploy note in the handoff.** In `docs/superpowers/HANDOFF.md` mark the shell row done (already) and add a "Challenges and chat" row and a "Where this session left off" section: what shipped, the ruling list (friends or live match; 1h/until play time; public format only; card polls every 10s; the up-to-one-minute verification wait is expected; bell counts), the deploy order (**push applies the migration; the coordinator needs no redeploy** — it already verifies every unverified offer, which includes challenges), and the deferred list at the top of this plan.

- [ ] **Step 5: Commit**

```bash
git add app/tools/m4-challenges-roundtrip.ts docs/superpowers/HANDOFF.md
git commit -m "docs(handoff): challenges and chat built; m4 roundtrip

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
