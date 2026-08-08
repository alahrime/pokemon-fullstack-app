import { describe, it, expect } from 'vitest';
import { allTeamRows, coresFor, pillarsFor } from '../teams';
import { conflictsOnTeam, speciesOf } from '../data';
import type { LeagueId } from '../types';

/**
 * No discovered team may hold two Pokemon sharing a Pokedex number.
 *
 * GBL's duplicate rule goes by dex, not by id — so Forretress bars Forretress
 * (Shadow), and Kanto Ninetales bars the Alolan one. `build-teams.ts` enforces
 * it while combinations are generated and while the opposing field is sampled,
 * never on the output (BACKLOG §2b), which is the right place for it but also
 * the hard place to see. This checks the artefact that actually ships.
 *
 * Prompted by a report that the landing page's "Strongest in Great League"
 * offered Forretress beside Forretress (Shadow). It did — but that section is a
 * leaderboard of individuals, not a team, and the teams themselves were clean.
 * The rule is worth pinning anyway: it is load-bearing for every team surface
 * in the app, and nothing else asserts it end to end.
 */

const LEAGUES: LeagueId[] = ['great', 'ultra', 'master'];

/** Every pair of a roster that shares a dex number. */
function illegalPairs(refs: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < refs.length; i++)
    for (let j = i + 1; j < refs.length; j++)
      if (conflictsOnTeam(refs[i], refs[j])) out.push(`${refs[i]} + ${refs[j]}`);
  return out;
}

const refsOf = (s: string) => s.split(' / ').map((x) => x.trim()).filter(Boolean);

describe('the duplicate-species rule holds across the shipped artefact', () => {
  it('agrees that a Shadow and its plain form conflict, and two forms of one dex do too', () => {
    // The premise the rest of the file rests on. Both cases are dex matches,
    // which is why comparing refs or ids would catch only the first.
    expect(conflictsOnTeam('forretress', 'forretress_shadow')).toBe(true);
    expect(speciesOf('ninetales')!.dex).toBe(speciesOf('ninetales_alolan')!.dex);
    expect(conflictsOnTeam('ninetales', 'ninetales_alolan')).toBe(true);
    expect(conflictsOnTeam('forretress', 'registeel')).toBe(false);
  });

  it('no discovered team of three or six repeats a dex number', () => {
    for (const lg of LEAGUES) {
      const rows = allTeamRows(lg);
      expect(rows.length, `${lg} has no teams`).toBeGreaterThan(1000);
      for (const r of rows) {
        const bad = illegalPairs(refsOf(r.members));
        expect(bad, `${lg} ${r.tier}|${r.category}|${r.pass} size ${r.size} rank ${r.rank}`).toEqual([]);
      }
    }
  }, 120000);

  it('nor does the line a six actually fields', () => {
    // A legal six could still name an illegal three as its best line if the
    // subset step lost the rule.
    for (const lg of LEAGUES) {
      for (const r of allTeamRows(lg)) {
        if (!r.bestLine) continue;
        expect(illegalPairs(refsOf(r.bestLine)), `${lg} ${r.tier} rank ${r.rank}`).toEqual([]);
      }
    }
  }, 120000);

  it('nor do the cores and pillars, which are teams-in-miniature', () => {
    for (const lg of LEAGUES) {
      const cores = coresFor(lg);
      expect(cores.length, lg).toBeGreaterThan(0);
      for (const c of cores) expect(conflictsOnTeam(c.a, c.b), `${lg} core ${c.a}+${c.b}`).toBe(false);
      for (const p of pillarsFor(lg)) {
        expect(illegalPairs([p.lead, ...p.backs]), `${lg} pillar ${p.lead}`).toEqual([]);
      }
    }
  }, 60000);
});
