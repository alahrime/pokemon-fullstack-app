import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon } from './helpers';

describe('match offer policies', () => {
  const proposer = randomUUID();
  const taker = randomUUID();
  let versionId = '';

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  beforeAll(async () => {
    await makeUser(proposer, `OP_${proposer.slice(0, 8)}`);
    await makeUser(taker, `OT_${taker.slice(0, 8)}`);
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${proposer}', 'Offer Cup', 'public') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '{"schema":1}'::jsonb, 'bb') returning id`);
    versionId = v.id;
  });

  afterEach(async () => {
    await sql(`delete from public.matches where player_a in ('${proposer}','${taker}') or player_b in ('${proposer}','${taker}')`);
    await sql(`delete from public.match_offers where proposer_id in ('${proposer}','${taker}')`);
    await sql(`delete from public.friend_codes where profile_id in ('${proposer}','${taker}')`);
  });

  const offer = (visibility: string, scheduled = 'null') =>
    asUser({ sub: proposer })<{ id: string }>(
      `insert into public.match_offers (format_version_id, claimed_hash, league, team, data_rev, visibility, scheduled_for)
       values ('${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', '${visibility}', ${scheduled}) returning id`,
    );

  it('shows a public offer to any signed-in stranger', async () => {
    const [o] = await offer('public');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides a public offer from someone not signed in, though the row exists and is visible to its proposer', async () => {
    const [o] = await offer('public');
    expect(await asAnon()(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    // Prove the emptiness above is the anon policy at work, not an absent row:
    // the superuser connection (bypasses RLS) and the proposer (via their own
    // policy) both still see it.
    expect(await sql(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('hides an unlisted offer from a stranger while its proposer still sees it', async () => {
    const [o] = await offer('unlisted');
    expect(await asUser({ sub: taker })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(0);
    expect(await asUser({ sub: proposer })(`select id from public.match_offers where id = '${o.id}'`)).toHaveLength(1);
  });

  it('refuses an offer proposed on someone else\'s behalf', async () => {
    await expect(
      asUser({ sub: taker })(
        `insert into public.match_offers (proposer_id, format_version_id, claimed_hash, league, team, data_rev, visibility)
         values ('${proposer}', '${versionId}', 'bb', 'great', '[]'::jsonb, 'rev1', 'public')`),
    ).rejects.toThrow(/row-level security/);
  });

  /**
   * A taker may accept. A taker may NOT rewrite the terms they are accepting.
   *
   * There is no update policy that admits the taker at all (see the migration
   * comment), so the row fails the USING clause before WITH CHECK is ever
   * consulted. Postgres does not raise an error for that case — an UPDATE
   * whose WHERE/USING excludes every row simply reports 0 rows affected, the
   * same as `UPDATE ... WHERE id = <nothing>`. So the proof here isn't a
   * thrown exception; it's that the write touched nothing (0 rows, RETURNING
   * empty) while the superuser connection shows the row still holds its
   * original terms.
   *
   * That alone can't tell "the taker was denied" apart from "nobody can
   * update this table" — a typo in the proposer's own policy would leave the
   * taker's update at 0 rows too, for the wrong reason. The third leg closes
   * that gap: the proposer, on the very same row and column, succeeds.
   */
  it('refuses a taker editing the offer\'s terms', async () => {
    const [o] = await offer('public');
    const written = await asUser({ sub: taker })<{ id: string }>(
      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
    );
    expect(written).toHaveLength(0);
    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
      { league: 'great' },
    ]);
    // Same row, same column, different actor: the proposer can.
    const proposerWrite = await asUser({ sub: proposer })<{ id: string }>(
      `update public.match_offers set league = 'master' where id = '${o.id}' returning id`,
    );
    expect(proposerWrite).toHaveLength(1);
    expect(await sql<{ league: string }>(`select league from public.match_offers where id = '${o.id}'`)).toEqual([
      { league: 'master' },
    ]);
  });

  it('refuses a scheduled offer in the past', async () => {
    await expect(offer('public', `now() - interval '1 hour'`)).rejects.toThrow(/match_offers_scheduled_future/);
  });
});
