import { CPM, LVL, MAX_LEVEL_IDX } from './cpm';
import { LEAGUE_BY_ID, OPPONENT_POOL_BY_ID, SPECIES_BY_ID, opponentCandidatesFor, opponentsFor } from './data';
import type {
  BattleLogEntry,
  BattleMon,
  BattleResult,
  ChargeMove,
  FastMove,
  IV,
  League,
  LeagueId,
  RankedEntry,
  Species,
  SpeciesTable,
  StatLine,
} from './types';

export function ivKey(iv: IV): number {
  return iv.a * 256 + iv.d * 16 + iv.s;
}

function statsAt(species: Species, iv: IV, cpm: number) {
  return {
    atk: (species.atk + iv.a) * cpm,
    def: (species.def + iv.d) * cpm,
    hRaw: (species.hp + iv.s) * cpm,
    h: Math.floor((species.hp + iv.s) * cpm),
  };
}

function cpOf(s: { atk: number; def: number; hRaw: number }): number {
  return Math.max(10, Math.floor((s.atk * Math.sqrt(s.def) * Math.sqrt(s.hRaw)) / 10));
}

export function bestAt(species: Species, iv: IV, league: League): StatLine {
  for (let i = MAX_LEVEL_IDX; i >= 0; i--) {
    const s = statsAt(species, iv, CPM[i]);
    const cp = cpOf(s);
    if (cp <= league.cap) {
      const hp = Math.max(10, s.h);
      return { lvl: LVL(i), cp, atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
    }
  }
  const s = statsAt(species, iv, CPM[0]);
  const hp = Math.max(10, s.h);
  return { lvl: 1, cp: cpOf(s), atk: s.atk, def: s.def, hp, sp: s.atk * s.def * hp };
}

export function dmg(atk: number, def: number, move: FastMove | ChargeMove): number {
  return Math.floor(0.5 * move.power * (atk / def) * move.stab) + 1;
}

const tableCache = new Map<string, SpeciesTable>();

export function getTable(speciesId: string, leagueId: LeagueId): SpeciesTable {
  const key = `${speciesId}|${leagueId}`;
  const cached = tableCache.get(key);
  if (cached) return cached;

  // Merged lookup (curated roster ∪ broad opponent pool): opponents scanned
  // for breakpoint/bulkpoint relevance need their own ranked table too, not
  // just the curated main roster.
  const species = OPPONENT_POOL_BY_ID.get(speciesId)!;
  const league = LEAGUE_BY_ID.get(leagueId)!;
  const all: RankedEntry[] = [];
  for (let a = 0; a < 16; a++) {
    for (let d = 0; d < 16; d++) {
      for (let s = 0; s < 16; s++) {
        const r = bestAt(species, { a, d, s }, league);
        all.push({ a, d, s, ...r, rank: 0 });
      }
    }
  }
  const sorted = all.slice().sort((x, y) => y.sp - x.sp);
  sorted.forEach((e, i) => {
    e.rank = i + 1;
  });
  const map = new Map<number, RankedEntry>();
  sorted.forEach((e) => map.set(ivKey(e), e));
  const out: SpeciesTable = {
    all: sorted,
    map,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    league,
    species,
  };
  tableCache.set(key, out);
  return out;
}

export function getEntry(speciesId: string, iv: IV, leagueId: LeagueId): { entry: RankedEntry; table: SpeciesTable } {
  const table = getTable(speciesId, leagueId);
  return { entry: table.map.get(ivKey(iv))!, table };
}

export function bestLeagueFor(speciesId: string, iv: IV): { rank: number; league: League } {
  let best: { rank: number; league: League } | null = null;
  for (const league of LEAGUE_BY_ID.values()) {
    const { entry } = getEntry(speciesId, iv, league.id);
    if (!best || entry.rank < best.rank) best = { rank: entry.rank, league };
  }
  return best!;
}

// ── Opponent representative — the opponent's own rank-1 stat-product spread
// (not a blanket hundo assumption), primary fast move and charge move as the
// incoming attack. Sourced from the broad opponent pool (top ~300/league),
// not just the curated main roster, so a real but niche threshold isn't
// excluded for being outside the top-60 meta cut. ──
//
// Every species' realistic "best" roll is different - rank 1 is frequently
// NOT 15/15/15 (a low attack IV often trades a hair of damage for enough
// extra bulk/level headroom to raise the overall stat product under a CP
// cap), so representing every opponent with a uniform hundo overstates their
// attack and understates their bulk. Using each species' own table.best
// keeps the comparison "relative to itself."
export interface OpponentInfo {
  id: string;
  dex: number;
  name: string;
  types: string[];
  atk: number;
  def: number;
  hp: number;
  fastMove: FastMove;
  chargeMove: ChargeMove;
  chargeMove2: ChargeMove | null;
}

// Every charge move a mon actually has equipped, for the battle simulator's
// bait-vs-nuke decision. A single move is returned as-is (no bait choice to
// make).
export function chargesOf(chargeMove: ChargeMove, chargeMove2: ChargeMove | null): ChargeMove[] {
  return chargeMove2 ? [chargeMove, chargeMove2] : [chargeMove];
}

export function opponentInfo(speciesId: string, leagueId: LeagueId): OpponentInfo {
  const species = OPPONENT_POOL_BY_ID.get(speciesId)!;
  const best = getTable(speciesId, leagueId).best;
  return {
    id: species.id,
    dex: species.dex,
    name: species.name,
    types: species.types,
    atk: best.atk,
    def: best.def,
    hp: best.hp,
    fastMove: species.fastMoves[0],
    chargeMove: species.chargeMove,
    chargeMove2: species.chargeMove2,
  };
}

export function opponentList(leagueId: LeagueId): Species[] {
  return opponentsFor(leagueId);
}

// ── Does a real breakpoint/bulkpoint exist for this pairing, across every
// reachable stat in the 4096 spread? A flat pairing (same rounded damage no
// matter the IV roll) isn't a relevant matchup to surface. ──
export function hasBreakpoint(table: SpeciesTable, move: FastMove, oppDef: number): boolean {
  const seen = new Set<number>();
  for (const e of table.all) {
    seen.add(dmg(e.atk, oppDef, move));
    if (seen.size > 1) return true;
  }
  return false;
}

export function hasBulkpoint(table: SpeciesTable, oppAtk: number, oppFastMove: FastMove): boolean {
  const seen = new Set<number>();
  for (const e of table.all) {
    seen.add(dmg(oppAtk, e.def, oppFastMove));
    if (seen.size > 1) return true;
  }
  return false;
}

export type RelevanceKind = 'break' | 'bulk' | 'either';

const relevantCache = new Map<string, OpponentInfo[]>();

// Scans the broad opponent-candidate pool and keeps only matchups where the
// relevant threshold actually exists - a bulkpoint is common enough (roughly
// half of all matchups have one) that an "either" filter barely narrows
// anything, so when the caller is specifically looking at breakpoints (or
// specifically bulkpoints), only that one threshold type should gate
// inclusion. Toxapex, for example, has a real Psywave breakpoint from
// Malamar but ranks outside the top 60 meta list - so it must be found via
// this scan, not the curated top-N list, or it never surfaces at all.
// Ranked by the candidate's own pvpoke league rank so the most meta-relevant
// *and* actually-relevant matchups surface first.
export function relevantOpponents(
  speciesId: string,
  leagueId: LeagueId,
  moveIdx: number,
  kind: RelevanceKind = 'either',
  limit = 16,
): OpponentInfo[] {
  const key = `${speciesId}|${leagueId}|${moveIdx}|${kind}|${limit}`;
  const cached = relevantCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(speciesId)!;
  const move = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const table = getTable(speciesId, leagueId);
  const candidates = opponentCandidatesFor(leagueId).filter((s) => s.id !== speciesId);

  const scored = candidates
    .map((c) => {
      const info = opponentInfo(c.id, leagueId);
      const hb = kind !== 'bulk' && hasBreakpoint(table, move, info.def);
      const hk = kind !== 'break' && hasBulkpoint(table, info.atk, info.fastMove);
      return { info, relevant: hb || hk, rank: c.leagueRank[leagueId] ?? Number.MAX_SAFE_INTEGER };
    })
    .filter((x) => x.relevant)
    .sort((a, b) => a.rank - b.rank || a.info.name.localeCompare(b.info.name));

  const out = scored.slice(0, limit).map((x) => x.info);
  relevantCache.set(key, out);
  return out;
}

// ── Breakpoint / bulkpoint threshold rows ──
export interface ThresholdRow {
  kind: 'Breakpoint' | 'Bulkpoint';
  move: string;
  needLabel: string;
  need: number;
  spread: string;
  dmgLabel: string;
  have: number;
  at: number;
  met: boolean;
  near: boolean;
}

export function bpRowsFor(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  opp: OpponentInfo,
): ThresholdRow[] {
  const { entry, table } = getEntry(speciesId, iv, leagueId);
  const species = SPECIES_BY_ID.get(speciesId)!;
  const rows: Omit<ThresholdRow, 'met' | 'near'>[] = [];

  species.fastMoves.forEach((mv) => {
    const vals = table.all
      .map((x) => ({ atk: x.atk, d: dmg(x.atk, opp.def, mv), e: x }))
      .sort((x, y) => x.atk - y.atk);
    const seen = new Map<number, (typeof vals)[number]>();
    vals.forEach((v) => {
      if (!seen.has(v.d)) seen.set(v.d, v);
    });
    [...seen.keys()].sort((x, y) => x - y).forEach((d) => {
      const v = seen.get(d)!;
      rows.push({
        kind: 'Breakpoint',
        move: `${mv.name} (${mv.turns}t)`,
        needLabel: `atk ${v.atk.toFixed(2)}`,
        need: v.atk,
        spread: `${v.e.a}/${v.e.d}/${v.e.s}`,
        dmgLabel: `${d} dmg`,
        have: entry.atk,
        at: v.atk,
      });
    });
  });

  const dvals = table.all
    .map((x) => ({ def: x.def, d: dmg(opp.atk, x.def, opp.fastMove), e: x }))
    .sort((x, y) => x.def - y.def);
  const seenB = new Map<number, (typeof dvals)[number]>();
  dvals.forEach((v) => {
    if (!seenB.has(v.d)) seenB.set(v.d, v);
  });
  [...seenB.keys()].sort((x, y) => y - x).forEach((d) => {
    const v = seenB.get(d)!;
    rows.push({
      kind: 'Bulkpoint',
      move: `${opp.name} ${opp.fastMove.name}`,
      needLabel: `def ${v.def.toFixed(2)}`,
      need: v.def,
      spread: `${v.e.a}/${v.e.d}/${v.e.s}`,
      dmgLabel: `takes ${d}`,
      have: entry.def,
      at: v.def,
    });
  });

  return rows.map((r) => {
    const met = r.have >= r.at;
    const near = !met && (r.at - r.have) / r.at < 0.03;
    return { ...r, met, near };
  });
}

// ── Ruler bands (damage-per-use vs. attack/defense axis) ──
export interface RulerBand {
  label: string;
  start: number;
  width: number;
  active: boolean;
}
export interface RulerTick {
  pos: number;
}
export interface RulerData {
  title: string;
  sub: string;
  unit: 'atk' | 'def';
  badge: string;
  note: string;
  min: string;
  max: string;
  bands: RulerBand[];
  ticks: RulerTick[];
  youPos: number;
  youLabel: string;
  flat: boolean;
}

export function rulersFor(speciesId: string, iv: IV, leagueId: LeagueId, opp: OpponentInfo): RulerData[] {
  const { entry, table } = getEntry(speciesId, iv, leagueId);
  const species = SPECIES_BY_ID.get(speciesId)!;
  const atks = table.all.map((x) => x.atk);
  const aMin = Math.min(...atks);
  const aMax = Math.max(...atks);
  const defs = table.all.map((x) => x.def);
  const dMin = Math.min(...defs);
  const dMax = Math.max(...defs);
  const pos = (v: number, lo: number, hi: number) => ((v - lo) / (hi - lo)) * 100;

  function mk(
    title: string,
    sub: string,
    lo: number,
    hi: number,
    you: number,
    thresholds: { at: number; label: string }[],
    badge: string,
    note: string,
    kind: 'atk' | 'def',
  ): RulerData {
    const bands: RulerBand[] = thresholds.map((th, i) => {
      const start = i === 0 ? 0 : pos(th.at, lo, hi);
      const end = i === thresholds.length - 1 ? 100 : pos(thresholds[i + 1].at, lo, hi);
      const active = you >= th.at && (i === thresholds.length - 1 || you < thresholds[i + 1].at);
      return { label: end - start < 6 ? '' : th.label, start: Math.max(0, start), width: Math.max(0, end - start), active };
    });
    const ticks: RulerTick[] = thresholds.filter((_, i) => i > 0).map((th) => ({ pos: pos(th.at, lo, hi) }));
    const flat = thresholds.length <= 1;
    const bulk = kind === 'def';
    return {
      title,
      sub,
      unit: bulk ? 'def' : 'atk',
      badge: flat ? `No ${bulk ? 'bulkpoint' : 'breakpoint'} in reach` : badge,
      note: flat
        ? bulk
          ? 'The incoming move deals the same damage across every reachable defense value — no bulkpoint exists for this pairing.'
          : "This target's defense flattens the move — every reachable spread deals the same damage. Try another opponent."
        : note,
      min: lo.toFixed(1),
      max: hi.toFixed(1),
      bands,
      ticks,
      youPos: Math.min(99.6, Math.max(0, pos(you, lo, hi))),
      youLabel: you.toFixed(2),
      flat,
    };
  }

  const out: RulerData[] = [];
  species.fastMoves.forEach((mv) => {
    const seen = new Map<number, number>();
    table.all
      .slice()
      .sort((x, y) => x.atk - y.atk)
      .forEach((x) => {
        const d = dmg(x.atk, opp.def, mv);
        if (!seen.has(d)) seen.set(d, x.atk);
      });
    const th = [...seen.keys()].sort((x, y) => x - y).map((d) => ({ at: seen.get(d)!, label: `${d} dmg` }));
    const reached = th.filter((x) => entry.atk >= x.at).length;
    out.push(
      mk(
        `${mv.name} → ${opp.name}`,
        `${mv.turns}-turn · ${mv.power} power · target def ${opp.def.toFixed(1)}`,
        aMin,
        aMax,
        entry.atk,
        th,
        `${reached} / ${th.length} breakpoints`,
        'Bands are damage per use; the ruler marks where it steps up',
        'atk',
      ),
    );
  });
  const seenB = new Map<number, number>();
  table.all
    .slice()
    .sort((x, y) => x.def - y.def)
    .forEach((x) => {
      const d = dmg(opp.atk, x.def, opp.fastMove);
      if (!seenB.has(d)) seenB.set(d, x.def);
    });
  const thB = [...seenB.keys()].sort((x, y) => y - x).map((d) => ({ at: seenB.get(d)!, label: `takes ${d}` }));
  out.push(
    mk(
      `Bulkpoints vs ${opp.name} ${opp.fastMove.name}`,
      `your defense axis · attacker atk ${opp.atk.toFixed(1)}`,
      dMin,
      dMax,
      entry.def,
      thB,
      `${thB.filter((x) => entry.def >= x.at).length} / ${thB.length} bulkpoints`,
      'Further right takes less damage per hit',
      'def',
    ),
  );
  return out;
}

// ── Heatmap cell data (rank / breakpoint-tier / bulkpoint-tier colouring) ──
export interface HeatCell {
  a: number;
  d: number;
  entry: RankedEntry;
  bg: string;
  label: string;
  tip: string;
  isYou: boolean;
}

export function buildHeatCells(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  opp: OpponentInfo,
  moveIdx: number,
  colorBy: 'rank' | 'break' | 'bulk',
): HeatCell[] {
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { table } = getEntry(speciesId, iv, leagueId);
  const mv = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];

  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const spMax = table.best.sp;
  const spMin = Math.min(...slice.map((e) => e.sp));
  let tiers: number[] = [];
  if (colorBy === 'break') tiers = [...new Set(slice.map((e) => dmg(e.atk, opp.def, mv)))].sort((x, y) => x - y);
  if (colorBy === 'bulk') tiers = [...new Set(slice.map((e) => dmg(opp.atk, e.def, opp.fastMove)))].sort((x, y) => y - x);

  return slice.map((entry) => {
    const isYou = entry.a === iv.a && entry.d === iv.d;
    let bg: string;
    let label: string;
    if (colorBy === 'rank') {
      bg = cellColorMix((entry.sp - spMin) / Math.max(1e-9, spMax - spMin));
      label = `#${entry.rank}`;
    } else if (colorBy === 'break') {
      const dv = dmg(entry.atk, opp.def, mv);
      bg = tierColor(tiers.indexOf(dv), tiers.length);
      label = `${dv} dmg / ${mv.turns}t`;
    } else {
      const dv = dmg(opp.atk, entry.def, opp.fastMove);
      bg = tierColor(tiers.indexOf(dv), tiers.length);
      label = `takes ${dv}`;
    }
    return {
      a: entry.a,
      d: entry.d,
      entry,
      bg,
      label,
      isYou,
      tip: `ATK ${entry.a} / DEF ${entry.d} / HP ${iv.s} — #${entry.rank} · ${label}`,
    };
  });
}

// ── Turn-based shield/CMP battle simulator with selective baiting ──
// 1 turn = 500ms; throw-as-soon-as-charged (for the mon's *chosen* move, see
// below); shields absorb a charge move down to 1 damage; simultaneous charge
// moves (CMP) resolve by higher attack stat first.
//
// Baiting: a shielded charge move deals exactly 1 damage no matter which move
// is thrown, so a rational attacker never wants to spend its best (usually
// pricier, higher-DPE) move into a shield - it should spend a cheaper move
// instead, saving the harder-hitting move for when it will land for real.
// This means the mon's real "main" move is whichever charge move has the
// best damage-per-energy, and a *bait* role is only assigned to another move
// if that move is strictly cheaper than main (there's no point baiting with
// a move that costs more energy than the move you're saving up for anyway).
// While the opponent has shields, throw bait as soon as it's ready; once
// shields are gone (or there's no bait role at all), hold every point of
// energy for main and only throw once main's own threshold is met - never
// fire early just because a weaker move happens to be ready first.
interface ChargeRoles {
  main: ChargeMove;
  bait: ChargeMove | null;
}

function classifyCharges(atk: number, oppDef: number, charges: ChargeMove[]): ChargeRoles {
  if (charges.length === 1) return { main: charges[0], bait: null };
  const byDpe = charges.slice().sort((x, y) => dmg(atk, oppDef, y) / y.energy - dmg(atk, oppDef, x) / x.energy);
  const main = byDpe[0];
  const cheaperAlternative = byDpe.slice(1).find((c) => c.energy < main.energy) ?? null;
  return { main, bait: cheaperAlternative };
}

function pickCharge(roles: ChargeRoles, energy: number, oppShields: number): ChargeMove | null {
  if (roles.bait && oppShields > 0 && energy >= roles.bait.energy) return roles.bait;
  if (energy >= roles.main.energy) return roles.main;
  return null;
}

export function battle(a: BattleMon, b: BattleMon, shieldsA: number, shieldsB: number, energyA = 0, energyB = 0): BattleResult {
  let hpA = a.hp;
  let hpB = b.hp;
  let eA = energyA;
  let eB = energyB;
  let sA = shieldsA;
  let sB = shieldsB;
  let tA = a.fast.turns;
  let tB = b.fast.turns;
  let cmpDecided = false;
  const fA = dmg(a.atk, b.def, a.fast);
  const fB = dmg(b.atk, a.def, b.fast);
  const rolesA = classifyCharges(a.atk, b.def, a.charges);
  const rolesB = classifyCharges(b.atk, a.def, b.charges);
  const log: BattleLogEntry[] = [];

  for (let turn = 0; turn < 480 && hpA > 0 && hpB > 0; turn++) {
    const moveA = pickCharge(rolesA, eA, sB);
    const moveB = pickCharge(rolesB, eB, sA);
    if (moveA || moveB) {
      const order: ('A' | 'B')[] = moveA && moveB ? (a.atk >= b.atk ? ['A', 'B'] : ['B', 'A']) : moveA ? ['A'] : ['B'];
      if (moveA && moveB) cmpDecided = true;
      for (const who of order) {
        if (who === 'A' && hpA > 0 && moveA) {
          eA -= moveA.energy;
          const shielded = sB > 0;
          const damage = shielded ? 1 : dmg(a.atk, b.def, moveA);
          if (shielded) sB--;
          hpB -= damage;
          tA = a.fast.turns;
          log.push({
            turn,
            actor: 'A',
            kind: 'charge',
            moveName: moveA.name,
            bait: shielded && moveA === rolesA.bait,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
          });
        }
        if (who === 'B' && hpB > 0 && moveB) {
          eB -= moveB.energy;
          const shielded = sA > 0;
          const damage = shielded ? 1 : dmg(b.atk, a.def, moveB);
          if (shielded) sA--;
          hpA -= damage;
          tB = b.fast.turns;
          log.push({
            turn,
            actor: 'B',
            kind: 'charge',
            moveName: moveB.name,
            bait: shielded && moveB === rolesB.bait,
            shielded,
            damage,
            hpA: Math.max(0, hpA),
            hpB: Math.max(0, hpB),
            energyA: eA,
            energyB: eB,
          });
        }
      }
      continue;
    }
    if (--tA <= 0) {
      hpB -= fA;
      eA = Math.min(100, eA + a.fast.energyGain);
      tA = a.fast.turns;
      log.push({
        turn,
        actor: 'A',
        kind: 'fast',
        moveName: a.fast.name,
        bait: false,
        shielded: false,
        damage: fA,
        hpA: Math.max(0, hpA),
        hpB: Math.max(0, hpB),
        energyA: eA,
        energyB: eB,
      });
    }
    if (--tB <= 0) {
      hpA -= fB;
      eB = Math.min(100, eB + b.fast.energyGain);
      tB = b.fast.turns;
      log.push({
        turn,
        actor: 'B',
        kind: 'fast',
        moveName: b.fast.name,
        bait: false,
        shielded: false,
        damage: fB,
        hpA: Math.max(0, hpA),
        hpB: Math.max(0, hpB),
        energyA: eA,
        energyB: eB,
      });
    }
  }
  const finalHpA = Math.max(0, hpA);
  const finalHpB = Math.max(0, hpB);
  const mine = finalHpA / a.hp;
  const theirs = finalHpB / b.hp;
  const win = hpA <= 0 && hpB <= 0 ? a.atk >= b.atk : mine > theirs;
  return { win, mine, theirs, hpA: finalHpA, hpB: finalHpB, maxHpA: a.hp, maxHpB: b.hp, cmpDecided, margin: (mine - theirs) * 100, log };
}

export function mkBattleMon(entry: { atk: number; def: number; hp: number }, fast: FastMove, charges: ChargeMove[]): BattleMon {
  return { atk: entry.atk, def: entry.def, hp: entry.hp, fast, charges };
}

// ── Verdict copy ──
export function verdictLine(rank: number): string {
  if (rank === 1) return 'Rank 1 · maximum stat product at cap';
  if (rank <= 10) return 'Top 10 · elite spread, worth full investment';
  if (rank <= 100) return 'Top 100 · strong spread, safe investment';
  if (rank <= 500) return 'Top 500 · playable, expect small SP losses';
  if (rank <= 1500) return 'Mid pack · replace when a better spread appears';
  return 'Bottom half · not competitive at this cap';
}

export function verdictTagClass(rank: number): string {
  if (rank <= 10) return 'tag tag-accent';
  if (rank <= 500) return 'tag tag-neutral';
  return 'tag tag-outline';
}

export function shortVerdict(rank: number): string {
  if (rank <= 10) return 'Elite';
  if (rank <= 100) return 'Strong';
  if (rank <= 500) return 'Playable';
  if (rank <= 1500) return 'Mid';
  return 'Transfer';
}

// ── Heatmap cell color helpers ──
export function cellColorMix(pct: number): string {
  const w = Math.round(Math.pow(Math.max(0, Math.min(1, pct)), 2.2) * 100);
  return `color-mix(in srgb, var(--color-accent) ${w}%, var(--color-neutral-200))`;
}

const TIER_STEPS = [
  'var(--color-neutral-200)',
  'var(--color-accent-200)',
  'var(--color-accent-400)',
  'var(--color-accent-500)',
  'var(--color-accent-600)',
  'var(--color-accent-700)',
];

export function tierColor(i: number, n: number): string {
  if (n <= 1) return TIER_STEPS[2];
  return TIER_STEPS[Math.min(TIER_STEPS.length - 1, Math.round((i / (n - 1)) * (TIER_STEPS.length - 1)))];
}

// ── Matchup flips: which IV spreads flip a shielded/CMP scenario from loss to win ──
export interface FlipCellResult {
  entry: RankedEntry;
  result: BattleResult;
}
export interface FlipGrid {
  results: FlipCellResult[];
  winners: FlipCellResult[];
  cheapest: FlipCellResult | null;
  minAtkWin: FlipCellResult | null;
  total: number;
  opponentMon: BattleMon;
  opponentInfo: OpponentInfo;
}

const flipCache = new Map<string, FlipGrid>();

export function flipGrid(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  oppSpeciesId: string,
  moveIdx: number,
  shields: number,
): FlipGrid {
  const key = [speciesId, leagueId, oppSpeciesId, moveIdx, shields, iv.s].join('|');
  const cached = flipCache.get(key);
  if (cached) return cached;

  const species = SPECIES_BY_ID.get(speciesId)!;
  const { table } = getEntry(speciesId, iv, leagueId);
  const opp = opponentInfo(oppSpeciesId, leagueId);
  const opponentMon = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2));
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const myCharges = chargesOf(species.chargeMove, species.chargeMove2);

  const slice: RankedEntry[] = [];
  for (let d = 15; d >= 0; d--) for (let a = 0; a < 16; a++) slice.push(table.map.get(a * 256 + d * 16 + iv.s)!);

  const results: FlipCellResult[] = slice.map((entry) => ({
    entry,
    result: battle(mkBattleMon(entry, myFast, myCharges), opponentMon, shields, shields),
  }));
  const winners = results.filter((o) => o.result.win);
  const cheapest = winners.length ? winners.slice().sort((p, q) => p.entry.rank - q.entry.rank)[0] : null;
  const minAtkWin = winners.length ? winners.slice().sort((p, q) => p.entry.atk - q.entry.atk)[0] : null;

  const out: FlipGrid = { results, winners, cheapest, minAtkWin, total: slice.length, opponentMon, opponentInfo: opp };
  flipCache.set(key, out);
  return out;
}

export interface FlipMatchupRow {
  species: OpponentInfo;
  cells: { win: boolean; margin: number }[];
  cmpWin: boolean;
  flips: number;
}

export function flipMatchupRows(
  speciesId: string,
  iv: IV,
  leagueId: LeagueId,
  moveIdx: number,
  opponentIds: string[],
): FlipMatchupRow[] {
  const species = SPECIES_BY_ID.get(speciesId)!;
  const { entry } = getEntry(speciesId, iv, leagueId);
  const myFast = species.fastMoves[Math.min(moveIdx, species.fastMoves.length - 1)];
  const you = mkBattleMon(entry, myFast, chargesOf(species.chargeMove, species.chargeMove2));

  return opponentIds.map((oid) => {
    const opp = opponentInfo(oid, leagueId);
    const foe = mkBattleMon(opp, opp.fastMove, chargesOf(opp.chargeMove, opp.chargeMove2));
    const cells = [0, 1, 2].map((sh) => {
      const r = battle(you, foe, sh, sh);
      return { win: r.win, margin: r.margin };
    });
    return {
      species: opp,
      cells,
      cmpWin: entry.atk >= foe.atk,
      flips: cells.filter((c) => c.win).length,
    };
  });
}

// ── Head-to-head battle simulator: full 3x3 shield-count matrix ──
export function shieldMatrix(a: BattleMon, b: BattleMon, energyA = 0, energyB = 0): BattleResult[][] {
  return [0, 1, 2].map((sA) => [0, 1, 2].map((sB) => battle(a, b, sA, sB, energyA, energyB)));
}
