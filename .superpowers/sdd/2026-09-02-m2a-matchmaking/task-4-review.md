# Task 4 review package — 4e16ad5..HEAD

## Commits
5c89f6f feat(db): offers you can browse, and offers you schedule

## Files changed
 .../migrations/20260902205215_match_offers.sql     | 60 ++++++++++++++
 supabase/tests/offers.test.ts                      | 96 ++++++++++++++++++++++
 2 files changed, 156 insertions(+)

## Full diff
diff --git a/supabase/migrations/20260902205215_match_offers.sql b/supabase/migrations/20260902205215_match_offers.sql
new file mode 100644
index 0000000..959da4a
--- /dev/null
+++ b/supabase/migrations/20260902205215_match_offers.sql
@@ -0,0 +1,60 @@
+-- A proposition, not a queue entry. The difference that earns a separate table
+-- is review: an opponent reads the format before agreeing, which a blind queue
+-- by definition does not allow.
+create table public.match_offers (
+  id uuid primary key default gen_random_uuid(),
+  proposer_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
+  format_version_id uuid not null references public.format_versions (id) on delete restrict,
+  claimed_hash text not null,
+  verified_hash text,
+  league text not null,
+  team jsonb not null,
+  data_rev text not null,
+  visibility public.format_visibility not null default 'public',
+  -- Null for the live board: playable now. Set for a proposal at a stated time.
+  scheduled_for timestamptz,
+  -- The handshake window. Both sides must be inside it, and an offer that
+  -- reaches it unconfirmed LAPSES rather than converting — a scheduled battle
+  -- on the board is one both people committed to, not one somebody was
+  -- nominated for.
+  expires_at timestamptz not null default now() + interval '1 hour',
+  accepted_by uuid references public.profiles (id) on delete set null,
+  -- The taker's roster as saved at the moment they accepted, not a pointer
+  -- into `teams`: editing a team afterwards must not change what was accepted
+  -- with, and Task 5's accept_offer() writes it here alongside accepted_by so
+  -- a converted offer has both rosters that matches.team_a/team_b need.
+  -- Null until someone accepts.
+  accepted_team jsonb,
+  accepted_at timestamptz,
+  confirmed_at timestamptz,
+  match_id uuid references public.matches (id) on delete set null,
+  state text not null default 'open',
+  created_at timestamptz not null default now(),
+  constraint match_offers_state check (state in ('open', 'accepted', 'confirmed', 'lapsed', 'converted')),
+  constraint match_offers_not_self check (accepted_by is null or accepted_by <> proposer_id),
+  constraint match_offers_scheduled_future check (scheduled_for is null or scheduled_for > created_at)
+);
+
+create index match_offers_open_idx on public.match_offers (visibility, league, created_at)
+  where state = 'open';
+create index match_offers_expiry_idx on public.match_offers (expires_at) where state in ('open', 'accepted');
+
+alter table public.match_offers enable row level security;
+
+create policy "an offer belongs to the person who proposed it"
+  on public.match_offers for all
+  to authenticated
+  using ((select auth.uid()) = proposer_id)
+  with check ((select auth.uid()) = proposer_id);
+
+-- Same shape as "a public format is readable by anyone signed in", which is
+-- the precedent this copies rather than invents.
+create policy "a public offer is readable by anyone signed in"
+  on public.match_offers for select
+  to authenticated
+  using (visibility = 'public' or (select auth.uid()) = accepted_by);
+
+-- Accepting is done through accept_offer(), not by a client UPDATE. There is
+-- deliberately no update policy for a taker: letting them write this row is
+-- letting them edit the terms they are agreeing to, and no WITH CHECK
+-- expressible here can say "you may set accepted_by and nothing else".
diff --git a/supabase/tests/offers.test.ts b/supabase/tests/offers.test.ts
new file mode 100644
index 0000000..34cbdcc
--- /dev/null
+++ b/supabase/tests/offers.test.ts
@@ -0,0 +1,96 @@
+import { randomUUID } from 'node:crypto';
+import { describe, it, expect, beforeAll, afterEach } from 'vitest';
+import { sql, asUser, asAnon } from './helpers';
+
+describe('match offer policies', () => {
+  const proposer = randomUUID();
+  const taker = randomUUID();
+  let versionId = '';
+
+  async function makeUser(id: string, name: string) {
+    await sql(
+      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
+       values ('${id}', '${id}@example.com', now(),
+         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
+    );
+  }
+
+  beforeAll(async () => {
+    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
+    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
+    const [f] = await sql<{ id: string }>(
+      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
+    const [v] = await sql<{ id: string }>(
+      `insert into public.format_versions (format_id, version, rules, rules_hash)
+       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
+    versionId = v.id;
+  });
+
+  afterEach(async () => {
+    await sql(`delete from public.matches where player_a in ('${proposer}','${taker}') or player_b in ('${proposer}','${taker}')`);
+    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
+    await sql(`delete from public.friend_codes where profile_id in ('${proposer}','${taker}')`);
+  });
+
+  const offer = (visibility: string, scheduled = 'null') =>
+    asUser({ sub: proposer })<{ id: string }>(
+      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
+       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`,
+    );
+
+  it('shows a public offer to any signed-in stranger', async () => {
+    const [o] = await offer('public');
+    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('hides a public offer from someone not signed in, though the row exists and is visible to its proposer', async () => {
+    const [o] = await offer('public');
+    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
+    // Prove the emptiness above is the anon policy at work, not an absent row:
+    // the superuser connection (bypasses RLS) and the proposer (via their own
+    // policy) both still see it.
+    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
+    const [o] = await offer('unlisted');
+    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
+    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
+  });
+
+  it('refuses an offer proposed on someone else\'s behalf', async () => {
+    await expect(
+      asUser({ sub: taker })(
+        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
+         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
+    ).rejects.toThrow(/row-level security/);
+  });
+
+  /**
+   * A taker may accept. A taker may NOT rewrite the terms they are accepting.
+   *
+   * There is no update policy that admits the taker at all (see the migration
+   * comment), so the row fails the USING clause before WITH CHECK is ever
+   * consulted. Postgres does not raise an error for that case — an UPDATE
+   * whose WHERE/USING excludes every row simply reports 0 rows affected, the
+   * same as `UPDATE ... WHERE id = <nothing>`. So the proof here isn't a
+   * thrown exception; it's that the write touched nothing (0 rows, RETURNING
+   * empty) while the superuser connection shows the row still holds its
+   * original terms.
+   */
+  it('refuses a taker editing the offer\'s terms', async () => {
+    const [o] = await offer('public');
+    const written = await asUser({ sub: taker })<{ id: string }>(
+      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
+    );
+    expect(written).toHaveLength(0);
+    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
+      { league: 'great' },
+    ]);
+  });
+
+  it('refuses a scheduled offer in the past', async () => {
+    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
+  });
+});
