import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

describe('glicko2_update', () => {
  it("reproduces Glickman's worked example (1500/200/0.06 vs three opponents)", async () => {
    const [r] = await sql<{ rating: number; rd: number; vol: number }>(
      `select * from public.glicko2_update(1500, 200, 0.06,
         array[1400,1550,1700]::float8[], array[30,100,300]::float8[], array[1,0,0]::float8[], 0.5)`,
    );
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  it('is symmetric for two fresh players: winner up, loser down by the same amount', async () => {
    const [w] = await sql<{ rating: number; rd: number }>(
      `select * from public.glicko2_update(1500, 350, 0.06, array[1500]::float8[], array[350]::float8[], array[1]::float8[])`,
    );
    const [l] = await sql<{ rating: number; rd: number }>(
      `select * from public.glicko2_update(1500, 350, 0.06, array[1500]::float8[], array[350]::float8[], array[0]::float8[])`,
    );
    expect(w.rating).toBeGreaterThan(1500);
    expect(w.rating - 1500).toBeCloseTo(1500 - l.rating, 6);
    expect(w.rd).toBeLessThan(350);
    expect(w.rd).toBeCloseTo(l.rd, 6);
  });
});

describe('seasons and ratings schema', () => {
  it('season_for is one row per UTC month and idempotent', async () => {
    const [a] = await sql<{ id: string }>(`select public.season_for('2031-03-31 23:59:59+00') as id`);
    const [b] = await sql<{ id: string }>(`select public.season_for('2031-03-01 00:00:00+00') as id`);
    const [c] = await sql<{ id: string }>(`select public.season_for('2031-04-01 00:00:00+00') as id`);
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
    const [s] = await sql<{ s: string; e: string }>(
      `select starts_at::text as s, ends_at::text as e from public.seasons where id = '${a.id}'`,
    );
    expect(s.s).toMatch(/^2031-03-01 00:00:00/);
    expect(s.e).toMatch(/^2031-04-01 00:00:00/);
  });

  it('refuses every client write to ratings and seasons', async () => {
    const me = randomUUID();
    const asMe = asUser({ sub: me, role: 'authenticated' });
    for (const q of [
      `insert into public.ratings (season_id, league, user_id) values (gen_random_uuid(), 'great', '${me}')`,
      `update public.ratings set rating = 3000`,
      `delete from public.ratings`,
      `insert into public.seasons (starts_at, ends_at) values (now(), now())`,
    ]) expect((await refusal(() => asMe(q))).code).toBe('42501');
    expect((await refusal(() => asAnon()(`select * from public.ratings`))).code).toBe('42501');
  });
});
