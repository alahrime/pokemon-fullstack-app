import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, asUser, refusal } from './helpers';

describe('the profile showcase columns', () => {
  const a = randomUUID(), b = randomUUID();
  const as = (id: string) => asUser({ sub: id, role: 'authenticated' });

  beforeAll(async () => {
    for (const id of [a, b]) {
      await sql(`insert into auth.users (id, email) values ('${id}', '${id}@example.com')`);
      await sql(`insert into public.profiles (id, display_name, go_username, tos_accepted_at, birth_date)
                 values ('${id}', 'Show_${id.slice(0, 8)}', 'T', now(), '2000-01-01')`);
    }
  });
  afterAll(() => sql(`delete from auth.users where id in ('${a}', '${b}')`));

  it('lets the owner set them and anyone signed in read them', async () => {
    await as(a)(`update public.profiles set avatar = 'cynthia', region = 'North Carolina', trainer_level = 44,
                 xp = 110811553, favorite_pokemon = '{lickilicky,politoed,registeel,walrein_shadow,crobat_shadow,ninetales_alolan}',
                 favorite_league = 'ultra', faction = 'TnT Flingulls', specialty = 'Ultra League Specialist' where id = '${a}'`);
    const [row] = await as(b)<{ avatar: string; favorite_pokemon: string[]; xp: string }>(
      `select avatar, favorite_pokemon, xp from public.profiles where id = '${a}'`);
    expect(row.avatar).toBe('cynthia');
    expect(row.favorite_pokemon).toHaveLength(6);
    expect(String(row.xp)).toBe('110811553');
  });

  it("does not let anyone else write them", async () => {
    const rows = await as(b)(`update public.profiles set faction = 'Hijack' where id = '${a}' returning id`);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ['a seventh favourite', `favorite_pokemon = '{a,b,c,d,e,f,g}'`],
    ['an avatar that is a URL', `avatar = 'https://evil.example/x.png'`],
    ['a level past 80', 'trainer_level = 81'],
    ['negative XP', 'xp = -1'],
    ['an unknown league', `favorite_league = 'little'`],
    ['a blank faction', `faction = '   '`],
    ['a fourth pinned trophy', `pinned_trophies = array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]`],
  ])('refuses %s', async (_, set) => {
    const r = await refusal(() => as(a)(`update public.profiles set ${set} where id = '${a}'`));
    expect(r.code).toBe('23514');
  });
});
