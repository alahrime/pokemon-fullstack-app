import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql, asUser, asAnon, refusal } from './helpers';

// helpers.ts's PRIVILEGE_DENIED names the older tables only; same class, these tables.
const PRIVILEGE_DENIED = /permission denied for table tournament/;

const TABLES = [
  'tournaments', 'tournament_entrants', 'tournament_rosters',
  'tournament_roles', 'tournament_pairings', 'tournament_audit',
];

const SPECIES = ['azumarill', 'medicham', 'registeel', 'altaria', 'swampert', 'skarmory'];
type Member = { ref: string; fast: string; charges: string[]; cp: unknown; bestBuddy: boolean };
const member = (ref: string, cp: unknown = 1498): Member =>
  ({ ref, fast: 'BUBBLE', charges: ['ICE_BEAM', 'PLAY_ROUGH'], cp, bestBuddy: false });
const roster = (cp: unknown = 1500): Member[] => SPECIES.map((s) => member(s, cp));
const lit = (r: unknown) => `'${JSON.stringify(r)}'::jsonb`;

describe('tournaments', () => {
  const host = randomUUID();
  const ann = randomUUID();
  const bob = randomUUID();
  const cal = randomUUID();
  const stranger = randomUUID();
  let six = ''; // host's private size-6 version
  let sixFormat = '';
  let otherPrivateVersion = ''; // host's second private format, never used by a tournament
  let otherPrivateFormat = '';
  let three = ''; // host's size-3 version
  let annPublic = ''; // ann's public size-6 version

  async function makeUser(id: string, name: string) {
    await sql(
      `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
       values ('${id}', '${id}@example.com', now(),
         '{"display_name":"${name}","go_username":"Go${name}","birth_date":"2000-01-01"}'::jsonb)`,
    );
  }

  const rules = (size: number) =>
    JSON.stringify({ schema: 1, base: 'great', pool: [], composition: { size, uniqueSpecies: true }, selection: { mode: 'open' } });

  async function makeVersion(owner: string, vis: 'public' | 'private', name: string, size = 6) {
    const [f] = await sql<{ id: string }>(
      `insert into public.formats (owner_id, name, visibility) values ('${owner}', '${name}', '${vis}') returning id`);
    const [v] = await sql<{ id: string }>(
      `insert into public.format_versions (format_id, version, rules, rules_hash)
       values ('${f.id}', 1, '${rules(size)}'::jsonb, 'bb') returning id`);
    return { format: f.id, version: v.id };
  }

  const as = (who: string) => asUser({ sub: who });
  const create = (who: string, version = six, title = 'Cup', rounds = 5, maxPlayers = 64) =>
    as(who)<{ create_tournament: string }>(
      `select public.create_tournament('${title}', 'desc', '${version}', ${rounds}::smallint, 25::smallint, ${maxPlayers}::smallint)`,
    ).then(([r]) => r.create_tournament);
  const call = (who: string, fn: string, id: string, ...args: string[]) =>
    as(who)(`select public.${fn}('${id}'${args.map((a) => `, ${a}`).join('')}) as r`).then(([r]) => r.r);
  const register = (who: string, id: string, r: unknown = roster()) =>
    as(who)<{ r: number }>(`select public.register_roster('${id}', ${lit(r)}) as r`).then(([x]) => x.r);
  const opened = async (maxPlayers = 64) => {
    const id = await create(host, six, 'Cup', 5, maxPlayers);
    await call(host, 'open_registration', id);
    return id;
  };
  const rostersSeen = async (who: string, id: string) =>
    (await as(who)(`select player_id from public.tournament_rosters where tournament_id = '${id}'`)).length;
  const closesInPast = (id: string) =>
    sql(`update public.tournaments set registration_closes_at = now() - interval '1 minute' where id = '${id}'`);

  beforeAll(async () => {
    for (const [id, tag] of [[host, 'TH'], [ann, 'TA'], [bob, 'TB'], [cal, 'TC'], [stranger, 'TS']] as const) {
      await makeUser(id, `${tag}_${id.slice(0, 8)}`);
    }
    ({ format: sixFormat, version: six } = await makeVersion(host, 'private', 'Tour private'));
    ({ format: otherPrivateFormat, version: otherPrivateVersion } = await makeVersion(host, 'private', 'Tour private 2'));
    three = (await makeVersion(host, 'private', 'Tour three', 3)).version;
    annPublic = (await makeVersion(ann, 'public', 'Tour ann public')).version;
  });

  afterEach(async () => {
    // Cascades to entrants, rosters, roles, pairings and audit.
    await sql(`delete from public.tournaments where organiser_id in ('${host}','${ann}','${bob}','${cal}','${stranger}')`);
  });

  it('creates a draft on your own private six, derives the league, and refuses bad input', async () => {
    const id = await create(host);
    const [t] = await sql<{ state: string; organiser_id: string; league: string }>(
      `select state, organiser_id, league from public.tournaments where id = '${id}'`);
    expect(t).toEqual({ state: 'draft', organiser_id: host, league: 'great' });

    expect((await refusal(() => create(host, three))).message).toMatch(/a tournament needs a format of six/);
    expect((await refusal(() => create(stranger, six))).message).toMatch(
      /a tournament needs a format you own or a public one/);
    expect((await refusal(() => create(host, randomUUID()))).message).toMatch(
      /a tournament needs a format you own or a public one/);
    for (const bad of [
      () => create(host, six, 'Cup', 0),
      () => create(host, six, 'Cup', 13),
      () => create(host, six, 'Cup', 5, 1),
      () => create(host, six, '   '),
    ]) {
      expect((await refusal(bad)).code).toBe('23514'); // check_violation
    }
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from public.tournaments where organiser_id = '${host}'`);
    expect(n).toBe(1);

    const other = await create(stranger, annPublic);
    const [o] = await sql<{ organiser_id: string }>(`select organiser_id from public.tournaments where id = '${other}'`);
    expect(o.organiser_id).toBe(stranger);
  });

  it('refuses every direct write to every tournament table', async () => {
    const id = await opened();
    for (const table of TABLES) {
      const ins = await refusal(() => as(host)(`insert into public.${table} default values`));
      expect(ins.message).toMatch(PRIVILEGE_DENIED);
      const col = table === 'tournaments' ? 'id' : 'tournament_id';
      const upd = await refusal(() => as(host)(`update public.${table} set ${col} = ${col} where ${col} = '${id}'`));
      expect(upd.message).toMatch(PRIVILEGE_DENIED);
      const del = await refusal(() => as(host)(`delete from public.${table} where ${col} = '${id}'`));
      expect(del.message).toMatch(PRIVILEGE_DENIED);
    }
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from public.tournaments where id = '${id}'`);
    expect(n).toBe(1);
  });

  it('hides a draft from all but its organiser; only the organiser opens registration', async () => {
    const id = await create(host);
    const sees = async (who: string) => (await as(who)(`select id from public.tournaments where id = '${id}'`)).length;
    expect(await sees(host)).toBe(1);
    expect(await sees(stranger)).toBe(0);
    const [{ v }] = await as(stranger)<{ v: boolean }>(`select public.tournament_visible('${id}') as v`);
    expect(v).toBe(false);

    const notYours = await refusal(() => call(stranger, 'open_registration', id));
    const missing = await refusal(() => call(stranger, 'open_registration', randomUUID()));
    expect(notYours.message).toMatch(/not allowed/);
    expect(missing.message).toBe(notYours.message);
    expect(await sees(stranger)).toBe(0);

    expect(await call(host, 'open_registration', id)).toBe(true);
    expect(await sees(stranger)).toBe(1);
    expect(await sees(ann)).toBe(1);
  });

  it('registers, edits and seeds rosters, and refuses bad shapes and closed registration', async () => {
    const id = await opened();
    expect(await register(ann, id)).toBe(1);
    expect(await register(ann, id, roster(1400))).toBe(1); // an edit, not a second entry
    const entrants = await sql<{ player_id: string; seed: number }>(
      `select player_id, seed from public.tournament_entrants where tournament_id = '${id}'`);
    expect(entrants).toEqual([{ player_id: ann, seed: 1 }]);
    const [r] = await sql<{ roster: Member[] }>(
      `select roster from public.tournament_rosters where tournament_id = '${id}' and player_id = '${ann}'`);
    expect(r.roster[0].cp).toBe(1400);
    expect(await register(bob, id)).toBe(2);

    const noCp = roster().map(({ cp: _cp, ...m }) => m);
    const shape = /a roster is exactly six/;
    for (const bad of [
      roster().slice(0, 5),
      [...roster(), member('lanturn')],
      noCp,
      roster(9),
      roster(1498.5),
      roster().map((m) => ({ ...m, charges: [] })),
      roster().map((m) => ({ ...m, charges: ['A', 'B', 'C'] })),
    ]) {
      expect((await refusal(() => register(cal, id, bad))).message).toMatch(shape);
    }
    // Legality (uniqueSpecies, pool) is the client's check; SQL checks shape only.
    expect(await register(cal, id, SPECIES.map(() => member('azumarill')))).toBe(3);

    const draft = await create(host);
    expect((await refusal(() => register(ann, draft))).message).toMatch(/registration is not open/);

    const tiny = await opened(2);
    await register(ann, tiny);
    await register(bob, tiny);
    expect((await refusal(() => register(cal, tiny))).message).toMatch(/this tournament is full/);

    await call(host, 'close_registration', tiny);
    expect((await refusal(() => register(ann, tiny))).message).toMatch(/registration is closed/);

    const timed = await opened();
    await closesInPast(timed);
    expect((await refusal(() => register(ann, timed))).message).toMatch(/registration is closed/);
    const [{ n }] = await sql<{ n: number }>(
      `select count(*)::int as n from public.tournament_entrants where tournament_id = '${timed}'`);
    expect(n).toBe(0);
  });

  it('keeps each roster secret until registration closes, then shows it to members only', async () => {
    const id = await opened();
    await call(host, 'grant_judge', id, `'${cal}'`);
    await register(ann, id);
    await register(bob, id);
    const [own] = await as(ann)<{ player_id: string }>(
      `select player_id from public.tournament_rosters where tournament_id = '${id}'`);
    expect(own.player_id).toBe(ann);
    expect(await rostersSeen(ann, id)).toBe(1);
    expect(await rostersSeen(bob, id)).toBe(1); // only bob's own
    expect(await rostersSeen(host, id)).toBe(0);
    expect(await rostersSeen(cal, id)).toBe(0);

    await call(host, 'close_registration', id);
    for (const who of [ann, bob, host, cal]) expect(await rostersSeen(who, id)).toBe(2);
    expect(await rostersSeen(stranger, id)).toBe(0);
  });

  it('closes lazily when the close time passes, and the time can no longer be moved', async () => {
    const id = await opened();
    await register(ann, id);
    await register(bob, id);
    expect(await rostersSeen(host, id)).toBe(0);
    await closesInPast(id);
    const [{ c }] = await as(stranger)<{ c: boolean }>(`select public.tournament_is_closed('${id}') as c`);
    expect(c).toBe(true);
    for (const who of [ann, bob, host]) expect(await rostersSeen(who, id)).toBe(2);
    expect(await rostersSeen(stranger, id)).toBe(0);
    // Rosters have been seen; reopening by moving the time would let someone edit after looking.
    const moved = await refusal(() =>
      as(host)(`select public.update_tournament('${id}', null, null, null, null, now() + interval '1 day')`));
    expect(moved.message).toMatch(/registration is closed/);
  });

  it('withdraws before close; refuses after', async () => {
    const id = await opened();
    await register(ann, id);
    await register(bob, id);
    await register(cal, id);
    expect(await call(cal, 'withdraw_from_tournament', id)).toBe(true);
    const [{ e, r }] = await sql<{ e: number; r: number }>(
      `select (select count(*)::int from public.tournament_entrants where tournament_id = '${id}' and player_id = '${cal}') as e,
              (select count(*)::int from public.tournament_rosters where tournament_id = '${id}' and player_id = '${cal}') as r`);
    expect({ e, r }).toEqual({ e: 0, r: 0 });
    // A later entrant does not reuse a live seed.
    expect(await register(cal, id)).toBe(3);
    await call(host, 'close_registration', id);
    expect((await refusal(() => call(ann, 'withdraw_from_tournament', id))).message).toMatch(/registration is closed/);
  });

  it('closes registration: organiser only, two players, audited for those who run it', async () => {
    const id = await opened();
    await call(host, 'grant_judge', id, `'${cal}'`);
    await register(ann, id);
    expect((await refusal(() => call(host, 'close_registration', id))).message).toMatch(/at least two players are needed/);
    await register(bob, id);
    expect((await refusal(() => call(ann, 'close_registration', id))).message).toMatch(/not allowed/);
    expect((await refusal(() => call(cal, 'close_registration', id))).message).toMatch(/not allowed/);
    expect(await call(host, 'close_registration', id)).toBe(true);
    const [t] = await sql<{ state: string }>(`select state from public.tournaments where id = '${id}'`);
    expect(t.state).toBe('closed');
    const audit = (who: string) =>
      as(who)<{ detail: { entrants: number } }>(
        `select detail from public.tournament_audit where tournament_id = '${id}' and action = 'close_registration'`);
    expect((await audit(host))[0].detail.entrants).toBe(2);
    expect(await audit(cal)).toHaveLength(1);
    expect(await audit(ann)).toHaveLength(0);
  });

  it('judges: granted and revoked by the organiser only; a judge runs but cannot appoint', async () => {
    const id = await opened();
    expect((await refusal(() => call(ann, 'grant_judge', id, `'${cal}'`))).message).toMatch(/not allowed/);
    const canRun = async (who: string) =>
      (await as(who)<{ c: boolean }>(`select public.tournament_can_run('${id}') as c`))[0].c;
    expect(await canRun(cal)).toBe(false);
    expect(await call(host, 'grant_judge', id, `'${cal}'`)).toBe(true);
    expect(await canRun(cal)).toBe(true);
    expect(await canRun(host)).toBe(true);
    expect(await canRun(ann)).toBe(false);
    expect((await refusal(() => call(cal, 'grant_judge', id, `'${bob}'`))).message).toMatch(/not allowed/);
    expect((await refusal(() => call(cal, 'revoke_judge', id, `'${cal}'`))).message).toMatch(/not allowed/);
    expect(await call(host, 'revoke_judge', id, `'${cal}'`)).toBe(true);
    expect(await canRun(cal)).toBe(false);
    const rows = await sql<{ action: string; detail: { user: string } }>(
      `select action, detail from public.tournament_audit where tournament_id = '${id}'
        and action in ('grant_judge','revoke_judge') order by created_at`);
    expect(rows).toEqual([
      { action: 'grant_judge', detail: { user: cal } },
      { action: 'revoke_judge', detail: { user: cal } },
    ]);
  });

  it("shows the tournament's format version to everyone once it is open, and nothing else", async () => {
    const canRead = async (who: string) => ({
      version: (await as(who)(`select id from public.format_versions where id = '${six}'`)).length,
      format: (await as(who)(`select id from public.formats where id = '${sixFormat}'`)).length,
      other: (await as(who)(
        `select id from public.format_versions where id = '${otherPrivateVersion}'
         union all select id from public.formats where id = '${otherPrivateFormat}'`)).length,
    });
    const id = await create(host);
    expect(await canRead(stranger)).toEqual({ version: 0, format: 0, other: 0 });
    await call(host, 'open_registration', id);
    expect(await canRead(stranger)).toEqual({ version: 1, format: 1, other: 0 });
    expect(await canRead(ann)).toEqual({ version: 1, format: 1, other: 0 });
  });

  it('cancels: organiser only, audited, and still visible', async () => {
    const id = await opened();
    expect((await refusal(() => call(ann, 'cancel_tournament', id))).message).toMatch(/not allowed/);
    expect(await call(host, 'cancel_tournament', id)).toBe(true);
    const [t] = await sql<{ state: string }>(`select state from public.tournaments where id = '${id}'`);
    expect(t.state).toBe('cancelled');
    const [a] = await sql<{ detail: { was: string } }>(
      `select detail from public.tournament_audit where tournament_id = '${id}' and action = 'cancel'`);
    expect(a.detail.was).toBe('registration');
    expect(await as(stranger)(`select id from public.tournaments where id = '${id}'`)).toHaveLength(1);
    expect((await refusal(() => call(host, 'cancel_tournament', id))).message).toMatch(/this tournament is over/);
  });

  it('a cancel during registration does not open the rosters to the organiser or a judge', async () => {
    const id = await opened();
    await call(host, 'grant_judge', id, `'${cal}'`);
    await register(ann, id);
    await register(bob, id);
    await call(host, 'cancel_tournament', id);
    expect(await rostersSeen(host, id)).toBe(0);
    expect(await rostersSeen(cal, id)).toBe(0);
    expect(await rostersSeen(ann, id)).toBe(1); // her own, still
    const [{ c }] = await as(host)<{ c: boolean }>(`select public.tournament_is_closed('${id}') as c`);
    expect(c).toBe(false);
  });

  describe('hardening (20260930000010)', () => {
    const readsFormat = async (who: string, f: { format: string; version: string }) => ({
      version: (await as(who)(`select id from public.format_versions where id = '${f.version}'`)).length,
      format: (await as(who)(`select id from public.formats where id = '${f.format}'`)).length,
    });

    it("a tournament on someone else's format stops exposing it once its owner makes it private", async () => {
      const f = await makeVersion(ann, 'public', `Tour ann flip ${randomUUID().slice(0, 8)}`);
      const id = await create(stranger, f.version);
      await call(stranger, 'open_registration', id);
      expect(await readsFormat(bob, f)).toEqual({ version: 1, format: 1 });
      await sql(`update public.formats set visibility = 'private' where id = '${f.format}'`);
      expect(await readsFormat(bob, f)).toEqual({ version: 0, format: 0 });
      // The organiser's OWN private format stays readable while their tournament is open.
      await opened();
      expect(await readsFormat(bob, { format: sixFormat, version: six })).toEqual({ version: 1, format: 1 });
    });

    it('a roster member is exactly five bounded keys', async () => {
      const id = await opened();
      const shape = /a roster is exactly six/;
      const withIvs = roster().map((m) => ({ ...m, ivs: [15, 15, 15] }));
      expect((await refusal(() => register(ann, id, withIvs))).message).toMatch(shape);
      const longRef = roster().map((m, i) => (i === 0 ? { ...m, ref: 'a'.repeat(65) } : m));
      expect((await refusal(() => register(ann, id, longRef))).message).toMatch(shape);
      const longCharge = roster().map((m, i) => (i === 0 ? { ...m, charges: ['C'.repeat(65)] } : m));
      expect((await refusal(() => register(ann, id, longCharge))).message).toMatch(shape);
      const emptyCharge = roster().map((m, i) => (i === 0 ? { ...m, charges: [''] } : m));
      expect((await refusal(() => register(ann, id, emptyCharge))).message).toMatch(shape);
      const edge = roster().map((m, i) => (i === 0 ? { ...m, ref: 'a'.repeat(64) } : m));
      expect(await register(ann, id, edge)).toBe(1);
    });

    it('no judges on a draft, and a draft never leaks its audit or child rows', async () => {
      const id = await create(host);
      expect((await refusal(() => call(host, 'grant_judge', id, `'${cal}'`))).message).toMatch(
        /open registration before appointing judges/);
      // Rows only a superuser could put on a draft: the policies must still hide them.
      await sql(`insert into public.tournament_roles (tournament_id, user_id, granted_by) values ('${id}', '${cal}', '${host}')`);
      await sql(`insert into public.tournament_entrants (tournament_id, player_id, seed) values ('${id}', '${ann}', 1)`);
      const [{ c }] = await as(cal)<{ c: boolean }>(`select public.tournament_can_run('${id}') as c`);
      expect(c).toBe(true);
      const audit = (who: string) => as(who)(`select id from public.tournament_audit where tournament_id = '${id}'`);
      expect(await audit(cal)).toHaveLength(0);
      expect(await audit(host)).toHaveLength(1); // the create row
      for (const table of ['tournament_entrants', 'tournament_roles']) {
        expect(await as(stranger)(`select 1 from public.${table} where tournament_id = '${id}'`)).toHaveLength(0);
        expect(await as(host)(`select 1 from public.${table} where tournament_id = '${id}'`)).toHaveLength(1);
      }
      await call(host, 'open_registration', id);
      expect(await audit(cal)).toHaveLength(2);
    });

    it('withdraw answers a draft like a missing tournament', async () => {
      const id = await create(host);
      expect(await call(ann, 'withdraw_from_tournament', id)).toBe(false);
      expect(await call(ann, 'withdraw_from_tournament', randomUUID())).toBe(false);
    });

    it('seeds are unique per tournament; a repeat grant is audited once', async () => {
      const id = await opened();
      await register(ann, id);
      const dup = await refusal(() =>
        sql(`insert into public.tournament_entrants (tournament_id, player_id, seed) values ('${id}', '${bob}', 1)`));
      expect(dup.code).toBe('23505');
      await call(host, 'grant_judge', id, `'${cal}'`);
      expect(await call(host, 'grant_judge', id, `'${cal}'`)).toBe(true);
      const [{ n }] = await sql<{ n: number }>(
        `select count(*)::int as n from public.tournament_audit where tournament_id = '${id}' and action = 'grant_judge'`);
      expect(n).toBe(1);
    });

    it('a revoked judge reads no rosters after close; a judge-entrant reads only their own before', async () => {
      const id = await opened();
      await call(host, 'grant_judge', id, `'${cal}'`);
      await call(host, 'grant_judge', id, `'${bob}'`);
      await register(ann, id);
      await register(bob, id); // bob is judge AND entrant
      const [own] = await as(bob)<{ player_id: string }>(
        `select player_id from public.tournament_rosters where tournament_id = '${id}'`);
      expect(await rostersSeen(bob, id)).toBe(1);
      expect(own.player_id).toBe(bob);
      await call(host, 'close_registration', id);
      expect(await rostersSeen(cal, id)).toBe(2);
      await call(host, 'revoke_judge', id, `'${cal}'`);
      expect(await rostersSeen(cal, id)).toBe(0);
    });
  });

  it('refuses anonymous callers every RPC and helper', async () => {
    const id = randomUUID();
    const calls: [string, string][] = [
      ['create_tournament', `select public.create_tournament('t', '', '${six}', 5::smallint, 25::smallint, 64::smallint)`],
      ['update_tournament', `select public.update_tournament('${id}', 't', '', null, null, null)`],
      ['open_registration', `select public.open_registration('${id}')`],
      ['close_registration', `select public.close_registration('${id}')`],
      ['cancel_tournament', `select public.cancel_tournament('${id}')`],
      ['register_roster', `select public.register_roster('${id}', '[]'::jsonb)`],
      ['withdraw_from_tournament', `select public.withdraw_from_tournament('${id}')`],
      ['grant_judge', `select public.grant_judge('${id}', '${ann}')`],
      ['revoke_judge', `select public.revoke_judge('${id}', '${ann}')`],
      ['tournament_visible', `select public.tournament_visible('${id}')`],
      ['tournament_can_run', `select public.tournament_can_run('${id}')`],
      ['tournament_is_member', `select public.tournament_is_member('${id}')`],
      ['tournament_is_closed', `select public.tournament_is_closed('${id}')`],
    ];
    for (const [fn, q] of calls) {
      expect((await refusal(() => asAnon()(q))).message).toMatch(new RegExp(`permission denied for function ${fn}`));
    }
    for (const fn of ['_tournament_audit', '_roster_shape_ok']) {
      const q = fn === '_tournament_audit'
        ? `select public._tournament_audit('${id}', 'x', '{}')` : `select public._roster_shape_ok('[]')`;
      expect((await refusal(() => as(ann)(q))).message).toMatch(new RegExp(`permission denied for function ${fn}`));
    }
  });
});
