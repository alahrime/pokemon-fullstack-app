import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal, POLICY_DENIED } from './helpers';

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
    const create = await refusal(() =>
      asAnon()(`select public.create_challenge('${bob}','${publicVersion}','bb','great','[]'::jsonb,'rev1')`));
    expect(create.message).toMatch(/permission denied for function create_challenge/);
    const decline = await refusal(() => asAnon()(`select public.decline_challenge('${randomUUID()}')`));
    expect(decline.message).toMatch(/permission denied for function decline_challenge/);
  });
});
