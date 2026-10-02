import { describe, it, expect, vi } from 'vitest';
import { challengeView, createChallenge, isLiveChallenge, liveChallengesWith, type Challenge } from '../challenges';
import { rulesHash, RULES_SCHEMA, type Format } from '../../rules';
import { DATA_REV } from '../data';

const rpc = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({ filters: [] as unknown[][], rows: [] as unknown[] }));
const builder = vi.hoisted(() => {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'or', 'in', 'order', 'not']) b[m] = (...a: unknown[]) => { query.filters.push([m, ...a]); return b; };
  b.limit = () => Promise.resolve({ data: query.rows, error: null });
  return b;
});
vi.mock('../supabase', () => ({
  supabase: { rpc, from: () => builder, auth: { getSession: async () => ({ data: { session: { user: { id: 'ann' } } }, error: null }) } },
}));

const FORMAT: Format = {
  schema: RULES_SCHEMA, base: 'great', pool: [],
  composition: { size: 3, uniqueSpecies: true }, selection: { mode: 'open' },
};


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
    expect(v({}, 'bob')).toMatchObject({ tone: 'open', actions: ['accept', 'counter', 'decline'] });
  });
  it('needs no verification: an unverified challenge is accepted or declined all the same', () => {
    expect(v({ verifiedHash: null }, 'bob')).toMatchObject({ label: 'Waiting for you', actions: ['accept', 'counter', 'decline'] });
  });
  it('the proposer waits and may withdraw', () => {
    expect(v({}, 'ann')).toMatchObject({ tone: 'wait', actions: ['withdraw'] });
    expect(v({ verifiedHash: null }, 'ann').label).toBe('Waiting for them');
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

describe('createChallenge', () => {
  const a = { targetId: 'bob', league: 'great' as const, formatVersionId: 'v1', format: FORMAT, team: [] };
  it('sends the recomputed hash, data rev and ISO schedule', async () => {
    rpc.mockResolvedValue({ data: 'o1', error: null });
    const when = new Date(Date.now() + 86_400_000);
    expect(await createChallenge({ ...a, scheduledFor: when })).toBe('o1');
    expect(rpc).toHaveBeenCalledWith('create_challenge', {
      p_target: 'bob', p_format_version: 'v1', p_claimed_hash: await rulesHash(FORMAT),
      p_league: 'great', p_team: [], p_data_rev: DATA_REV, p_scheduled_for: when.toISOString(),
    });
  });
  it('refuses a past schedule before any network call', async () => {
    rpc.mockClear();
    await expect(createChallenge({ ...a, scheduledFor: new Date(Date.now() - 1000) })).rejects.toThrow(/past/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('live challenges between two people', () => {
  const at = (o: Partial<Challenge>) => ({ ...base, ...o });
  it('counts open and accepted challenges that have not expired, and nothing else', () => {
    expect(isLiveChallenge(at({}), NOW)).toBe(true);
    expect(isLiveChallenge(at({ state: 'accepted' }), NOW)).toBe(true);
    expect(isLiveChallenge(at({ expiresAt: '2026-09-29T11:00:00Z' }), NOW)).toBe(false);
    for (const state of ['lapsed', 'declined', 'converted', 'confirmed'] as const) expect(isLiveChallenge(at({ state }), NOW), state).toBe(false);
  });

  it('asks for both directions between me and them, open or accepted only, and drops an expired row', async () => {
    query.filters.length = 0;
    const row = (id: string, exp: string) => ({
      id, proposer_id: 'ann', target_id: 'bob', league: 'great', state: 'open', scheduled_for: null, expires_at: exp,
      verified_hash: 'h', match_id: null, team: [], format_versions: null,
    });
    query.rows = [row('live', '2026-09-29T13:00:00Z'), row('stale', '2026-09-29T11:00:00Z')];
    const out = await liveChallengesWith('bob', NOW);
    expect(out.map((c) => c.id)).toEqual(['live']);
    const or = query.filters.find((f) => f[0] === 'or')![1] as string;
    expect(or).toBe('and(proposer_id.eq.ann,target_id.eq.bob),and(proposer_id.eq.bob,target_id.eq.ann)');
    expect(query.filters.find((f) => f[0] === 'in')).toEqual(['in', 'state', ['open', 'accepted']]);
  });
});
