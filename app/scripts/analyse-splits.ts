/**
 * Which Pokemon should enter the rankings as more than one entry, and how the
 * head of the format changes when they do.
 *
 *   npm run splits
 *
 * The rated-set rule (BACKLOG §0) assumes one loadout per species is worth
 * simulating. That is false when two sets are both played AND answer different
 * halves of the field. Shadow Forretress is the clean case: its rated set is
 * Volt Switch / Sand Tomb / Rock Tomb at 745, while every Bug Bite set scores
 * 850–878. Both are played; they are not the same Pokemon; collapsing them
 * loses whichever the rated field happened not to name.
 *
 * A split needs BOTH conditions. Divergence alone is not enough — Tinkaton's
 * most divergent alternative flips 56% of matchups while scoring 212 points
 * worse, which is a bad set rather than a second build.
 *
 * Three threshold variants are reported side by side so the effect of the
 * choice is visible rather than assumed: the cut decides whether the pool grows
 * by a third or doubles, and which builds reach the top.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { movesFor, speciesOf, displayName } from '../src/lib/data';
import { battle, bestSpreadFor, mkBattleMon } from '../src/lib/engine';
import { CATEGORIES, SCENARIOS, rating, startingEnergy, weightedScore } from '../src/lib/scenarios';
import type { ChargeMove, FastMove, LeagueId } from '../src/lib/types';
import type { ScenarioId } from '../src/lib/scenarios';

const DATA = resolve(process.cwd(), 'src/data');
const SRC = resolve(process.cwd(), '..', 'data-src');
/**
 * The report is evidence for the §1e decision, not something the app imports,
 * so it stays out of `src/` where a stray import could bundle it.
 */
const ANALYSIS = resolve(process.cwd(), 'analysis');

/**
 * The three cuts, widening.
 *
 * `viability` is how far below a species' own best a set may score and still be
 * kept; `divergence` is how much of the field it must flip against every set
 * already kept. Tightening either one collapses the pool back toward one entry
 * per species; loosening both admits builds nobody runs.
 */
const VARIANTS = [
  { name: 'primary', viability: 0.04, divergence: 0.12 },
  { name: 'secondary', viability: 0.08, divergence: 0.10 },
  { name: 'tertiary', viability: 0.12, divergence: 0.08 },
] as const;

/** A move must reach this share of its slot's recorded usage to be considered. */
const USAGE_FLOOR = 0.15;
/** How deep to look. Splitting the tail costs simulation and changes nothing. */
const DEPTH = 150;
/** Opponents each build is profiled against. */
const FIELD_N = 100;
/** Sets examined per species before the cut. */
const MAX_SETS = 10;

const RANKINGS = JSON.parse(readFileSync(join(DATA, 'rankings.json'), 'utf8')) as Record<LeagueId, {
  categories: string[];
  entries: { ref: string; name: string; tiers: Record<string, { rec: number[] }> }[];
}>;

function usageFor(lg: LeagueId) {
  const file = { great: 'rankings-1500.json', ultra: 'rankings-2500.json', master: 'rankings-10000.json' }[lg];
  const raw = JSON.parse(readFileSync(join(SRC, file), 'utf8')) as {
    speciesId: string;
    moves?: { fastMoves?: { moveId: string; uses: number }[]; chargedMoves?: { moveId: string; uses: number }[] };
  }[];
  return new Map(raw.map((e) => [e.speciesId, {
    fast: new Map((e.moves?.fastMoves ?? []).map((m) => [m.moveId, m.uses])),
    charge: new Map((e.moves?.chargedMoves ?? []).map((m) => [m.moveId, m.uses])),
  }]));
}

interface Build {
  label: string;
  fast: FastMove;
  charges: ChargeMove[];
  /** Per-opponent rating against the field. */
  profile: Float64Array;
  /** Mean of that profile — the build's own strength. */
  mean: number;
}

/** Share of the field where one build wins and the other does not. */
function flips(a: Float64Array, b: Float64Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] >= 500) !== (b[i] >= 500)) n++;
  return n / a.length;
}

function main() {
  const overall = CATEGORIES.find((c) => c.id === 'overall')!;
  const report: Record<string, unknown> = {};

  for (const lg of ['great', 'ultra', 'master'] as LeagueId[]) {
    const league = RANKINGS[lg];
    const oi = league.categories.indexOf('overall');
    const ord = [...league.entries].sort((a, b) => b.tiers['100'].rec[oi] - a.tiers['100'].rec[oi]);
    const field = ord.slice(0, FIELD_N).map((e) => e.ref);
    const fieldMons = field.map((r) => {
      const sp = speciesOf(r)!;
      const m = movesFor(sp, lg);
      return mkBattleMon(bestSpreadFor(r, lg, true), m.fast, m.charges, sp.types);
    });
    const usage = usageFor(lg);

    /** Every played set for one species, profiled against the field. */
    const buildsFor = (ref: string): Build[] => {
      const sp = speciesOf(ref)!;
      const u = usage.get(ref.replace(/_shadow$/, ''));
      const uf = (m: FastMove) => u?.fast.get(m.id.split('|')[0]) ?? 0;
      const uc = (m: ChargeMove) => u?.charge.get(m.id.split('|')[0]) ?? 0;
      const tf = sp.fastMoves.reduce((n, m) => n + uf(m), 0) || 1;
      const tc = sp.chargeMoves.reduce((n, m) => n + uc(m), 0) || 1;
      const fasts = sp.fastMoves.filter((m) => uf(m) / tf >= USAGE_FLOOR);
      const chs = sp.chargeMoves.filter((m) => uc(m) / tc >= USAGE_FLOOR);
      const rec = movesFor(sp, lg);

      const seen = new Set<string>();
      const combos: { fast: FastMove; charges: ChargeMove[] }[] = [];
      const push = (fast: FastMove, cs: ChargeMove[]) => {
        const k = `${fast.id}|${cs.map((c) => c.id).sort().join('+')}`;
        if (seen.has(k)) return;
        seen.add(k);
        combos.push({ fast, charges: cs });
      };
      push(rec.fast, rec.charges);
      for (const f of fasts)
        for (let i = 0; i < chs.length; i++)
          for (let j = i + 1; j < chs.length; j++) push(f, [chs[i], chs[j]]);

      return combos.slice(0, MAX_SETS).map(({ fast, charges }) => {
        const me = mkBattleMon(bestSpreadFor(ref, lg, true), fast, charges, sp.types);
        const profile = new Float64Array(field.length);
        const per = {} as Record<ScenarioId, number>;
        for (let f = 0; f < field.length; f++) {
          if (field[f] === ref) { profile[f] = 500; continue; }
          for (const sc of SCENARIOS) {
            let sum = 0;
            for (const pol of ['always', 'read'] as const) {
              sum += rating(battle(me, fieldMons[f], sc.shieldsA, sc.shieldsB,
                startingEnergy(me, sc.bankedA), startingEnergy(fieldMons[f], sc.bankedB),
                false, true, undefined, undefined, pol, pol), sc.shieldsA, sc.shieldsB);
            }
            per[sc.id] = sum / 2;
          }
          profile[f] = weightedScore(per, overall.weights);
        }
        let s = 0;
        for (const v of profile) s += v;
        return {
          label: `${fast.name} · ${charges.map((c) => c.name).join(' / ')}`,
          fast, charges, profile, mean: s / profile.length,
        };
      });
    };

    const all = new Map<string, Build[]>();
    for (const e of ord.slice(0, DEPTH)) all.set(e.ref, buildsFor(e.ref));

    const perVariant: Record<string, unknown> = {};
    for (const v of VARIANTS) {
      const entries: { ref: string; name: string; label: string; score: number; isRated: boolean }[] = [];
      let split = 0;
      for (const [ref, builds] of all) {
        const sorted = [...builds].sort((a, b) => b.mean - a.mean);
        const top = sorted[0].mean;
        // Greedy: keep the strongest, then any set that is still viable AND
        // answers a different part of the field from everything already kept.
        const kept = [sorted[0]];
        for (const b of sorted.slice(1)) {
          if (b.mean < top * (1 - v.viability)) continue;
          if (kept.every((k) => flips(k.profile, b.profile) >= v.divergence)) kept.push(b);
        }
        if (kept.length > 1) split++;
        for (const k of kept)
          entries.push({
            ref, name: displayName(ref), label: k.label,
            score: Math.round(k.mean), isRated: k.label === builds[0].label,
          });
      }
      entries.sort((a, b) => b.score - a.score);
      perVariant[v.name] = {
        thresholds: { viability: v.viability, divergence: v.divergence },
        speciesSplit: split,
        totalEntries: entries.length,
        entries: entries.slice(0, 80),
      };
      console.log(
        `${lg.padEnd(7)} ${v.name.padEnd(10)} viability<=${(v.viability * 100).toFixed(0)}% divergence>=${(v.divergence * 100).toFixed(0)}%` +
          `  ->  ${String(split).padStart(3)}/${DEPTH} species split, ${entries.length} entries` +
          `  (+${(((entries.length - DEPTH) / DEPTH) * 100).toFixed(0)}%)`,
      );
    }
    report[lg] = perVariant;

    // What actually reaches the top, per variant — the comparison asked for.
    console.log(`\n  ${lg} top 12 by variant (entries that are NOT the rated set are marked *):`);
    const cols = VARIANTS.map((v) => (perVariant[v.name] as { entries: { name: string; label: string; score: number; isRated: boolean }[] }).entries);
    for (let i = 0; i < 12; i++) {
      const cells = cols.map((c) => {
        const e = c[i];
        if (!e) return ''.padEnd(34);
        const tag = e.isRated ? ' ' : '*';
        return `${tag}${e.name} ${e.score}`.slice(0, 33).padEnd(34);
      });
      console.log(`   ${String(i + 1).padStart(2)} ${cells.join('')}`);
    }
    console.log('');
  }

  mkdirSync(ANALYSIS, { recursive: true });
  writeFileSync(join(ANALYSIS, 'splits.json'), JSON.stringify(report));
  console.log(`wrote analysis/splits.json — ${VARIANTS.map((v) => v.name).join(', ')}`);
}

main();
