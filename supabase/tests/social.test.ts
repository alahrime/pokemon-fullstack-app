import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, refusal, PRIVILEGE_DENIED, POLICY_DENIED } from './helpers';

describe('friendships and blocks', () => {
  const ann = randomUUID();
  const bob = randomUUID();
  const cal = randomUUID();

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  const lo = (a: string, b: string) => (a < b ? a : b);
  const hi = (a: string, b: string) => (a < b ? b : a);

  beforeAll(async () => {
    await makeUser(ann, `SA_${ann.slice(0, 8)}`);
    await makeUser(bob, `SB_${bob.slice(0, 8)}`);
    await makeUser(cal, `SC_${cal.slice(0, 8)}`);
  });

  afterEach(async () => {
    await sql(`delete from public.friendships where user_lo in ('${ann}','${bob}','${cal}') or user_hi in ('${ann}','${bob}','${cal}')`);
    await sql(`delete from public.blocks where blocker_id in ('${ann}','${bob}','${cal}')`);
  });

  it('refuses a friendship row that is not canonically ordered', async () => {
    await expect(
      sql(`insert into public.friendships (user_lo, user_hi, requested_by)
           values ('${hi(ann, bob)}', '${lo(ann, bob)}', '${ann}')`),
    ).rejects.toThrow(/friendships_ordered/);
  });

  it('holds exactly one row for a pair however the request went', async () => {
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by)
               values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`);
    await expect(
      sql(`insert into public.friendships (user_lo, user_hi, requested_by)
           values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${bob}')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('shows a friendship to its two sides and to nobody else', async () => {
    await sql(`insert into public.friendships (user_lo, user_hi, requested_by)
               values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`);
    expect(await asUser({ sub: ann })(`select * from public.friendships`)).toHaveLength(1);
    expect(await asUser({ sub: bob })(`select * from public.friendships`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select * from public.friendships`)).toHaveLength(0);
  });

  it('lets nobody write a friendship row directly', async () => {
    const denied = await refusal(() =>
      asUser({ sub: ann })(
        `insert into public.friendships (user_lo, user_hi, requested_by)
         values ('${lo(ann, bob)}', '${hi(ann, bob)}', '${ann}')`,
      ),
    );
    expect(denied.message).toMatch(PRIVILEGE_DENIED);
  });

  // Harness change (Task 4/FIX 4): the `blocks` policy used to be `for all`,
  // so a test could create its fixture with a plain `insert into
  // public.blocks` as the blocker. That policy is now SELECT and DELETE
  // only — INSERT goes through `block_user()` alone — so every test below
  // that needs a block on the board now creates it by calling
  // `block_user()`, the same route a real client has. This is a change of
  // ROUTE, not a weakened assertion: each test still checks the same
  // outcome it checked before.
  it('hides a block completely from the person blocked', async () => {
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    expect(await asUser({ sub: ann })(`select * from public.blocks`)).toHaveLength(1);
    // Not "sees a row that says nothing" — sees NOTHING. A blocked user who can
    // count rows can detect the block.
    expect(await asUser({ sub: bob })(`select * from public.blocks`)).toHaveLength(0);
    expect(await asUser({ sub: cal })(`select * from public.blocks`)).toHaveLength(0);
  });

  // Harness change: this used to be one claim exercised one way (a direct
  // self-insert throwing `blocks_distinct`). It is actually two claims, and
  // Task 4 closed the route that let one test stand in for both:
  //   1. `block_user()` — the only route a client has — refuses a self-block.
  //      It does so by RETURNING false (see its own `if p_target is null or
  //      p_target = me then return false`), not by raising, so there is
  //      nothing for `.rejects.toThrow` to catch on this path.
  //   2. The `blocks_distinct` CHECK constraint backs the table itself, for
  //      any writer that reaches it directly — which, after Task 4, no
  //      `authenticated` caller can (a direct `insert into public.blocks` is
  //      refused by RLS before the constraint is ever consulted). The only
  //      way left to exercise the constraint is the superuser `sql()`
  //      helper, which bypasses RLS the same way `block_user` itself does as
  //      `security definer`.
  it('refuses a block against yourself: block_user returns false, the table constraint still stands', async () => {
    expect(
      await asUser({ sub: ann })(`select public.block_user('${ann}') as block_user`),
    ).toEqual([{ block_user: false }]);

    await expect(
      sql(`insert into public.blocks (blocker_id, blocked_id) values ('${ann}', '${ann}')`),
    ).rejects.toThrow(/blocks_distinct/);
  });

  it('lets the blocker unblock and nobody else', async () => {
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Filtered out by USING — 0 rows, and NO error. Asserting "it threw" here
    // would pass for the wrong reason.
    await asUser({ sub: bob })(`delete from public.blocks where blocker_id = '${ann}'`);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(1);
    await asUser({ sub: ann })(`delete from public.blocks where blocked_id = '${bob}'`);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(0);
  });

  // New coverage (not a rewrite of an existing test): FIX 4's whole point is
  // that this insert must now be refused. Nothing above proves that on its
  // own — each rewritten test above only proves `block_user()` still works.
  it('refuses a direct insert into blocks; block_user is the only route in', async () => {
    const denied = await refusal(() =>
      asUser({ sub: ann })(`insert into public.blocks (blocked_id) values ('${bob}')`),
    );
    expect(denied.message).toMatch(POLICY_DENIED);
    expect(
      await sql(
        `select * from public.blocks where blocker_id = '${ann}' and blocked_id = '${bob}'`,
      ),
    ).toHaveLength(0);
  });

  const request = (who: string, target: string) =>
    asUser({ sub: who })<{ request_friendship: string }>(
      `select public.request_friendship('${target}') as request_friendship`,
    );
  const respond = (who: string, other: string, accept: boolean) =>
    asUser({ sub: who })<{ respond_to_friendship: string }>(
      `select public.respond_to_friendship('${other}', ${accept}) as respond_to_friendship`,
    );

  it('turns a mutual request into an accepted friendship', async () => {
    const [first] = await request(ann, bob);
    expect(first.request_friendship).toBe('pending');
    const [second] = await request(bob, ann);
    expect(second.request_friendship).toBe('accepted');
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('accepted');
  });

  it('will not let the requester accept their own request', async () => {
    await request(ann, bob);
    await expect(respond(ann, bob, true)).rejects.toThrow(/you sent this request/);
    const [f] = await sql<{ status: string }>(`select status from public.friendships`);
    expect(f.status).toBe('pending');
  });

  it('deletes the row when a request is declined', async () => {
    await request(ann, bob);
    const [r] = await respond(bob, ann, false);
    expect(r.respond_to_friendship).toBe('removed');
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a request in both directions once either side blocks', async () => {
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Both messages are the SAME, and the same one a nonexistent user gets.
    await expect(request(bob, ann)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, bob)).rejects.toThrow(/cannot be sent a friend request/);
    await expect(request(ann, randomUUID())).rejects.toThrow(/cannot be sent a friend request/);
  });

  it('tears down an existing friendship when one side blocks', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
    expect(await sql(`select * from public.blocks where blocker_id = '${ann}'`)).toHaveLength(1);
  });

  it('lets either side remove an accepted friendship', async () => {
    await request(ann, bob);
    await respond(bob, ann, true);
    const [gone] = await asUser({ sub: bob })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(gone.remove_friendship).toBe(true);
    expect(await sql(`select * from public.friendships`)).toHaveLength(0);
  });

  it('refuses a stranger acting on a friendship that is not theirs', async () => {
    await request(ann, bob);
    const [nothing] = await asUser({ sub: cal })<{ remove_friendship: boolean }>(
      `select public.remove_friendship('${ann}') as remove_friendship`,
    );
    expect(nothing.remove_friendship).toBe(false);
    expect(await sql(`select * from public.friendships`)).toHaveLength(1);
  });

  it('shows a friend code to an accepted friend and to nobody else', async () => {
    await sql(`insert into public.friend_codes (profile_id, code) values ('${bob}', '4444 5555 6666')
               on conflict (profile_id) do update set code = excluded.code`);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);

    await request(ann, bob);
    expect(
      await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`),
      'pending is not accepted',
    ).toHaveLength(0);

    await respond(bob, ann, true);
    expect(await asUser({ sub: ann })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(1);
    expect(await asUser({ sub: cal })(`select code from public.friend_codes where profile_id = '${bob}'`)).toHaveLength(0);
  });

  it('never pairs two people who have blocked each other', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Block Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`,
    );
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Inserted through `sql()` (the superuser connection), not `asUser`:
    // `verified_hash` is server-only — the "a queue entry is its owner's"
    // WITH CHECK on public.queue_entries (added in
    // 20260904071716_handshake_columns_are_server_only.sql) requires it be
    // null on a client insert, and the coordinator that would normally set it
    // is not running in this suite. `user_id` defaults to `auth.uid()`, which
    // is null on this connection, so it is named explicitly here.
    for (const who of [ann, bob]) {
      await sql(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${who}', 'great', '${v.id}', 'bb', 'bb', '[]'::jsonb, 'rev1')`,
      );
    }
    await sql(`select public.pair_queue_entries()`);
    expect(
      await sql(`select * from public.matches where player_a in ('${ann}','${bob}') or player_b in ('${ann}','${bob}')`),
    ).toHaveLength(0);
    // And both are still queued — a skipped pair is not a consumed one.
    expect(await sql(`select * from public.queue_entries where user_id in ('${ann}','${bob}')`)).toHaveLength(2);
    await sql(`delete from public.queue_entries where user_id in ('${ann}','${bob}')`);
  });

  it('skips a blocked pair without quarantining the third party sharing their group', async () => {
    // The test above only proves ann and bob do not pair with EACH OTHER,
    // which a version of pair_queue_entries() that just refused to pair
    // anyone in a group touching a block would also satisfy. What actually
    // matters is that a blocked pair is SKIPPED — the scan keeps searching
    // for a different partner rather than giving up on the whole
    // (verified_hash, league, data_rev) group — so cal, unblocked and sharing
    // that same group, must still get matched with one of them in a SINGLE
    // tick, and whichever of ann/bob is left over must still be queued for
    // the next one.
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Block Skip Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bs') returning id`,
    );
    await asUser({ sub: ann })(`select public.block_user('${bob}')`);
    // Through `sql()` (the superuser connection), not `asUser`, the same way
    // `enqueue()` does it in pairing.test.ts: `verified_hash` is server-only,
    // and the "a queue entry is its owner's" WITH CHECK on
    // public.queue_entries (20260904071716_handshake_columns_are_server_only.sql)
    // requires it be null on a client insert.
    for (const who of [ann, bob, cal]) {
      await sql(
        `insert into public.queue_entries (user_id, league, format_version_id, claimed_hash, verified_hash, team, data_rev)
         values ('${who}', 'great', '${v.id}', 'bs', 'bs', '[]'::jsonb, 'rev1')`,
      );
    }

    const [{ pair_queue_entries: paired }] = await sql<{ pair_queue_entries: number }>(
      `select public.pair_queue_entries()`,
    );
    expect(Number(paired)).toBe(1);

    const matches = await sql<{ player_a: string; player_b: string }>(
      `select player_a, player_b from public.matches
        where player_a in ('${ann}','${bob}','${cal}') or player_b in ('${ann}','${bob}','${cal}')`,
    );
    expect(matches).toHaveLength(1);
    const [match] = matches;
    const parties = [match.player_a, match.player_b];
    expect(parties).toContain(cal);
    expect(parties.some((p) => p === ann || p === bob)).toBe(true);

    const stillQueued = await sql<{ user_id: string }>(
      `select user_id from public.queue_entries where user_id in ('${ann}','${bob}','${cal}')`,
    );
    expect(stillQueued).toHaveLength(1);
    expect([ann, bob]).toContain(stillQueued[0].user_id);

    await sql(`delete from public.queue_entries where user_id in ('${ann}','${bob}','${cal}')`);
    await sql(`delete from public.matches where player_a in ('${ann}','${bob}','${cal}') or player_b in ('${ann}','${bob}','${cal}')`);
  });

  it('lets an unblocked accept through, and refuses a blocked one with the EXACT sentence a lapsed offer gives', async () => {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Block Offer Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bo') returning id`,
    );
    const makeOffer = async () => {
      const [o] = await sql<{ id: string }>(
        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev, visibility)
         values ('${ann}', '${v.id}', 'bo', 'bo', 'great', '["A"]'::jsonb, 'rev1', 'public') returning id`,
      );
      return o;
    };

    // Allow: cal has no block with ann in either direction, so the new
    // guard must not stand in the way of an ordinary accept.
    const clean = await makeOffer();
    await asUser({ sub: cal })(`select public.accept_offer('${clean.id}', '["C"]'::jsonb, 'rev1')`);
    expect(await sql(`select state from public.match_offers where id = '${clean.id}'`)).toEqual([
      { state: 'converted' },
    ]);

    // What "the same sentence" actually means: not a shared regex matched
    // against two literals (that only proves each literal individually
    // contains some substring — it says nothing about whether the two
    // literals are the SAME string), but the two runtime messages captured
    // independently and compared to each other.
    //
    // Message 1: a GENUINE lapse. accept_offer()'s own check
    // (`if o.state <> 'open' then raise exception 'this offer is no longer
    // open'`, deployed 20260904071717) is what a real lapse hits — reached
    // here by forcing the offer's state to 'lapsed' directly and then trying
    // to accept it, the same shape of refusal a client would hit accepting
    // an offer that expired moments earlier.
    const lapsed = await makeOffer();
    await sql(`update public.match_offers set state = 'lapsed' where id = '${lapsed.id}'`);
    const lapseRefusal = await refusal(() =>
      asUser({ sub: cal })(`select public.accept_offer('${lapsed.id}', '["C"]'::jsonb, 'rev1')`),
    );

    // Message 2: a BLOCKED accept. bob has blocked ann, so bob accepting
    // ann's still-open offer must be refused by the new trigger guard, never
    // by any check inside accept_offer() itself — the offer genuinely is
    // still 'open'.
    const blocked = await makeOffer();
    await asUser({ sub: bob })(`select public.block_user('${ann}')`);
    const blockRefusal = await refusal(() =>
      asUser({ sub: bob })(`select public.accept_offer('${blocked.id}', '["B"]'::jsonb, 'rev1')`),
    );

    // The claim: these are not two sentences that both happen to mention
    // unavailability. They are the SAME sentence.
    expect(blockRefusal.message).toEqual(lapseRefusal.message);
    expect(await sql(`select state from public.match_offers where id = '${blocked.id}'`)).toEqual([
      { state: 'open' },
    ]);

    await sql(`delete from public.match_offers where proposer_id = '${ann}'`);
    await sql(`delete from public.matches where player_a = '${ann}' or player_b = '${ann}' or player_a = '${cal}' or player_b = '${cal}'`);
  });

  it('sweeps a lapsed, blocked, accepted offer instead of raising through the whole tick', async () => {
    // The exact poisoned state 20260906002000_friend_codes_and_blocked_matchmaking.sql's
    // trigger scoping fixes: an offer that reached 'accepted' honestly, whose
    // two parties blocked each other only AFTERWARD, then expired unconfirmed.
    // Before the `when` clause, sweep_expired()'s bulk
    // `update ... set state = 'lapsed' where state in ('open','accepted') and
    // expires_at <= now()` fires this row's block guard — the update does not
    // touch accepted_by, so an unscoped `before update` trigger still runs —
    // and the guard raises 'this offer is no longer open' because
    // accepted_by is not null and the parties are blocked, aborting the whole
    // sweep (and, in the coordinator's own transaction, everything before it).
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Sweep Guard Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'sg') returning id`,
    );
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers
         (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev,
          visibility, state, accepted_by, accepted_team, accepted_at, expires_at)
       values
         ('${ann}', '${v.id}', 'sg', 'sg', 'great', '["A"]'::jsonb, 'rev1',
          'public', 'accepted', '${bob}', '["B"]'::jsonb, now() - interval '2 hours',
          now() - interval '1 hour')
       returning id`,
    );
    // Blocked AFTER the accept, which is exactly the sequence the fix's
    // `when` clause has to tolerate: the guard exists to stop a NEW accept
    // onto a blocked pair, not to punish a pair that blocked each other after
    // already agreeing to play.
    await asUser({ sub: bob })(`select public.block_user('${ann}')`);

    // Succeeds, rather than throwing 'this offer is no longer open' — an
    // uncaught rejection here fails the test on its own, which is the point:
    // no assertion could distinguish "raised" from "raised, but we expected
    // that" the way a plain unguarded `await` does.
    await sql(`select public.sweep_expired()`);
    expect(await sql(`select state from public.match_offers where id = '${o.id}'`)).toEqual([
      { state: 'lapsed' },
    ]);

    await sql(`delete from public.match_offers where id = '${o.id}'`);
  });

  it('refuses to confirm a scheduled offer once the two parties have blocked each other, with the same sentence FIX 1 unified on', async () => {
    // FIX 2's exact failure mode: the guard's original `when` clause fired
    // only on `accepted_by` changing, and confirm_offer() (deployed,
    // 20260905124300_scheduled_matches_carry_their_play_time.sql) moves
    // `state` from 'accepted' to 'converted' without ever touching
    // `accepted_by` again — so a scheduled offer that was accepted cleanly,
    // then blocked by either party, then confirmed inside the window, used
    // to sail straight through: a match landed on a blocked pair, and the
    // "shared active match" friend_codes policy
    // (20260905124000_match_reports_and_rounds.sql) handed the blocker's
    // code to the party who blocked them.
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name) values ('${ann}', 'Confirm Guard Cup') returning id`,
    );
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'cg') returning id`,
    );
    const [o] = await sql<{ id: string }>(
      `insert into public.match_offers
         (proposer_id, format_version_id, claimed_hash, verified_hash, league, team, data_rev,
          visibility, scheduled_for, expires_at)
       values
         ('${ann}', '${v.id}', 'cg', 'cg', 'great', '["A"]'::jsonb, 'rev1',
          'public', now() + interval '1 day', now() + interval '1 hour')
       returning id`,
    );

    // Accepted honestly, before any block exists — the guard must let this
    // through, same as always.
    await asUser({ sub: bob })(`select public.accept_offer('${o.id}', '["B"]'::jsonb, 'rev1')`);
    expect(await sql(`select state, accepted_by from public.match_offers where id = '${o.id}'`)).toEqual([
      { state: 'accepted', accepted_by: bob },
    ]);

    // Blocked AFTER the accept, inside the confirm window — the scenario the
    // brief calls out: nothing about accepted_by changes from here on, so
    // only the new `new.state = 'converted'` arm of the `when` clause can
    // still catch what happens next.
    await asUser({ sub: bob })(`select public.block_user('${ann}')`);

    const lapseRefusal = await refusal(() =>
      asUser({ sub: cal })(`select public.accept_offer('${o.id}', '["C"]'::jsonb, 'rev1')`),
    );
    const confirmRefusal = await refusal(() =>
      asUser({ sub: ann })(`select public.confirm_offer('${o.id}')`),
    );
    expect(confirmRefusal.message).toEqual(lapseRefusal.message);

    // The offer must still read 'accepted', never 'converted' — no match was
    // created, and no new state was committed. The whole point of a
    // `before update` guard raising is that its own row-level effect rolls
    // back with it.
    expect(await sql(`select state, match_id from public.match_offers where id = '${o.id}'`)).toEqual([
      { state: 'accepted', match_id: null },
    ]);
    expect(
      await sql(
        `select * from public.matches where player_a in ('${ann}','${bob}') and player_b in ('${ann}','${bob}')`,
      ),
    ).toHaveLength(0);

    await sql(`delete from public.match_offers where id = '${o.id}'`);
  });
});
