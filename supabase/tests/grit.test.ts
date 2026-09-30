import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

type Grit = { post_loss_games: number; post_loss_wins: number; tournaments: number; gate: number };

describe('my_grit', () => {
  const [p, q, c, d, e, lone] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const list = [p, q, c, d, e, lone].map((u) => `'${u}'`).join(',');
  let versionId = '';
  const tournaments: string[] = [];
  const grit = (who: string) => asUser({ sub: who, role: 'authenticated' })<Grit>(`select * from public.my_grit()`).then((r) => r[0]);

  async function tournament(state: string) {
    const [t] = await sql<{ id: string }>(
      `insert into public.tournaments (organiser_id, title, format_version_id, league, rounds, state)
       values ('${p}', 'Grit', '${versionId}', 'great', 12, '${state}') returning id`,
    );
    tournaments.push(t.id);
    return t.id;
  }
  /** One pairing; `b` null is a bye; `st` defaults to settled. */
  async function pairing(t: string, round: number, a: string, b: string | null, sa: number, sb: number, st = 'settled', finalAt = 'null') {
    await sql(
      `insert into public.tournament_pairings (tournament_id, round, table_no, player_a, player_b, score_a, score_b, state, final_at)
       values ('${t}', ${round}, 1, '${a}', ${b ? `'${b}'` : 'null'}, ${sa}, ${sb}, '${st}', ${finalAt})`,
    );
  }

  beforeAll(async () => {
    for (const [i, id] of [p, q, c, d, e, lone].entries()) {
      await sql(
        `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         values ('${id}', '${id}@example.com', now(),
           '{"display_name":"GR${i}_${id.slice(0, 8)}","go_username":"GR${i}${id.slice(0, 6)}","birth_date":"2000-01-01"}'::jsonb)`,
      );
    }
    const [f] = await sql<{ id: string }>(`insert into public.formats (owner_id, name) values ('${p}', 'Grit Cup') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash) values ('${f.id}', 1, '{"schema":1}'::jsonb, 'aa') returning id`,
    );
    versionId = v.id;
  });

  afterAll(async () => {
    await sql(`delete from public.tournaments where id in (${tournaments.map((t) => `'${t}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})`);
    await sql(`delete from auth.users where id in (${list})`);
  });

  it('is empty for someone who has played nothing, at the floor gate', async () => {
    expect(await grit(lone)).toEqual({ post_loss_games: 0, post_loss_wins: 0, tournaments: 0, gate: 10 });
  });

  it('counts a game right after a loss once, skips byes, draws and uncounted games, and ignores unstarted events', async () => {
    const t = await tournament('complete');
    await pairing(t, 1, p, q, 0, 2); // P loses
    await pairing(t, 2, p, q, 2, 1); // post-loss WIN
    await pairing(t, 3, p, null, 2, 0); // bye: neither a loss nor a game
    await pairing(t, 4, p, q, 1, 2); // P loses (previous game was a win: not post-loss)
    await pairing(t, 5, p, q, 2, 0); // post-loss WIN
    await pairing(t, 6, p, q, 0, 2, 'reported', "now() + interval '1 hour'"); // not final: does not count
    await pairing(t, 7, p, q, 2, 0); // if round 6 counted this would be a third post-loss win
    await pairing(t, 8, p, q, 1, 1); // a draw is not a loss
    const cancelled = await tournament('cancelled');
    await pairing(cancelled, 1, p, q, 0, 2);
    await pairing(cancelled, 2, p, q, 2, 0);

    expect(await grit(p)).toMatchObject({ post_loss_games: 2, post_loss_wins: 2, tournaments: 1 });
    // the mirror: Q lost rounds 2 and 5; round 4 (won) and round 7 (lost) follow them
    expect(await grit(q)).toMatchObject({ post_loss_games: 2, post_loss_wins: 1, tournaments: 1 });
  });

  it('counts a reported game once its finality has passed, and counts distinct tournaments', async () => {
    const t = await tournament('running');
    await pairing(t, 1, p, q, 0, 2);
    await pairing(t, 2, p, q, 0, 2, 'reported', "now() - interval '1 minute'");
    expect(await grit(p)).toMatchObject({ post_loss_games: 3, post_loss_wins: 2, tournaments: 2 });
  });

  it('raises the gate with the median post-loss sample', async () => {
    // C, D and E each lose 12 straight games in their own event: 11 post-loss games apiece,
    // a majority of the players who have any, so the median is 11.
    for (const [loser, winner] of [[c, lone], [d, lone], [e, lone]]) {
      const t = await tournament('complete');
      for (let r = 1; r <= 12; r++) await pairing(t, r, loser, winner, 0, 2);
    }
    const g = await grit(p);
    expect(g.gate).toBeGreaterThanOrEqual(11);
    expect(await grit(c)).toMatchObject({ post_loss_games: 11, post_loss_wins: 0, tournaments: 1 });
  });

  it('refuses anonymous callers and the internal function to everyone', async () => {
    expect((await refusal(() => asAnon()(`select * from public.my_grit()`))).code).toBe('42501');
    expect((await refusal(() => asUser({ sub: p, role: 'authenticated' })(`select * from public._grit_games()`))).code).toBe('42501');
  });
});
