import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

describe('tournament channels', () => {
  const [org, judge, p1, p2, outsider] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const list = [org, judge, p1, p2, outsider].map((u) => `'${u}'`).join(',');
  let tid = '', ch = '';
  const members = async () =>
    (await sql<{ user_id: string; role: string }>(`select user_id, role from public.channel_members where channel_id = '${ch}'`))
      .map((m) => m.user_id).sort();
  const sorted = (...u: string[]) => [...u].sort();
  const as = (u: string) => asUser({ sub: u, role: 'authenticated' });
  const entrant = (u: string, seed: number) =>
    sql(`insert into public.tournament_entrants (tournament_id, player_id, seed) values ('${tid}', '${u}', ${seed})`);

  beforeAll(async () => {
    for (const [i, id] of [org, judge, p1, p2, outsider].entries()) {
      await sql(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         values ('${id}', '${id}@example.com', now(),
           '{"display_name":"TC${i}_${id.slice(0, 8)}","go_username":"TC${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`,
      );
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${org}', 'Chan Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`);
    const [t] = await sql<{ id: string }>(
      `insert into public.tournaments (organiser_id, title, format_version_id, league, rounds, state)
       values ('${org}', 'Chan One', '${v.id}', 'great', 3, 'registration') returning id`);
    tid = t.id;
    ch = (await sql<{ id: string }>(`select id from public.channels where tournament_id = '${tid}'`))[0]?.id;
  });

  afterAll(async () => {
    await sql(`delete from public.tournaments where id = '${tid}'`);
    await sql(`delete from auth.users where id in (${list})`);
  });

  it('is created with the tournament, the organiser its owner, titled after it', async () => {
    const [c] = await sql<{ kind: string; title: string }>(`select kind, title from public.channels where id = '${ch}'`);
    expect(c).toEqual({ kind: 'tournament', title: 'Chan One' });
    expect(await sql(`select 1 from public.channel_members where channel_id = '${ch}' and user_id = '${org}' and role = 'owner'`)).toHaveLength(1);
    await sql(`update public.tournaments set title = 'Chan Uno' where id = '${tid}'`);
    expect((await sql<{ title: string }>(`select title from public.channels where id = '${ch}'`))[0].title).toBe('Chan Uno');
  });

  it('follows registration, withdrawal, drop-out and judges', async () => {
    await entrant(p1, 1);
    await entrant(p2, 2);
    await sql(`insert into public.tournament_roles (tournament_id, user_id, granted_by) values ('${tid}', '${judge}', '${org}')`);
    expect(await members()).toEqual(sorted(org, p1, p2, judge));

    await sql(`delete from public.tournament_entrants where tournament_id = '${tid}' and player_id = '${p2}'`);
    expect(await members()).toEqual(sorted(org, p1, judge));
    await sql(`update public.tournament_entrants set dropped = true where tournament_id = '${tid}' and player_id = '${p1}'`);
    expect(await members()).toEqual(sorted(org, judge));
    await sql(`update public.tournament_entrants set dropped = false where tournament_id = '${tid}' and player_id = '${p1}'`);
    expect(await members()).toEqual(sorted(org, p1, judge));
    await sql(`delete from public.tournament_roles where tournament_id = '${tid}' and user_id = '${judge}'`);
    expect(await members()).toEqual(sorted(org, p1));
  });

  it('keeps a judge who is also an entrant when only one of the two goes', async () => {
    await entrant(judge, 3);
    await sql(`insert into public.tournament_roles (tournament_id, user_id, granted_by) values ('${tid}', '${judge}', '${org}')`);
    await sql(`delete from public.tournament_roles where tournament_id = '${tid}' and user_id = '${judge}'`);
    expect(await members()).toContain(judge);
    await sql(`delete from public.tournament_entrants where tournament_id = '${tid}' and player_id = '${judge}'`);
    expect(await members()).not.toContain(judge);
  });

  it('lets members read and post, and nobody else see it', async () => {
    const [m] = await as(p1)<{ id: string }>(
      `insert into public.messages (channel_id, author_id, body) values ('${ch}', '${p1}', 'gl hf') returning id`);
    expect(m.id).toBeTruthy();
    expect(await as(org)(`select id from public.messages where channel_id = '${ch}'`)).toHaveLength(1);
    expect(await as(outsider)(`select id from public.channels where id = '${ch}'`)).toHaveLength(0);
    expect(await as(outsider)(`select id from public.messages where channel_id = '${ch}'`)).toHaveLength(0);
    await refusal(() => as(outsider)(`insert into public.messages (channel_id, author_id, body) values ('${ch}', '${outsider}', 'hi')`));
  });

  it('cannot be left, added to, or created by hand, and is invisible to anon', async () => {
    expect((await refusal(() => as(p1)(`select public.leave_channel('${ch}')`))).message).toMatch(/cannot be left/);
    expect((await refusal(() => as(org)(`select public.add_to_group('${ch}', '${outsider}')`))).message).toMatch(/only a group/);
    await refusal(() => as(org)(`insert into public.channel_members (channel_id, user_id) values ('${ch}', '${outsider}')`));
    expect(await asAnon()(`select id from public.channels where id = '${ch}'`)).toHaveLength(0);
    expect((await refusal(() => as(org)(`select public._sync_tournament_member('${tid}', '${org}')`))).code).toBe('42501');
  });

  it('survives a cancelled tournament with its members and messages', async () => {
    await sql(`update public.tournaments set state = 'cancelled' where id = '${tid}'`);
    expect(await as(p1)(`select id from public.messages where channel_id = '${ch}'`)).toHaveLength(1);
  });
});
