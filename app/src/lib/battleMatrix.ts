import { LEAGUE_BY_ID, isSimulated, movesFor, parseRef, ratedFastIdx, speciesOf } from './data';
import { battle, bestBuddyEligible, bestSpreadFor, defaultSpreadFor, dmg, getEntry, mkBattleMon, selectedCharges } from './engine';
import { DEFAULT_TIER, fieldPool } from './rankings';
import { LIMITED_CUPS, cupLegal } from './presetFormats';
import { rating } from './scenarios';
import type { BattleMon, ChargeMove, FastMove, IV, LeagueId, RankedEntry } from './types';

/**
 * The Battle screen's Matrix mode: every Pokémon on one side fought against every Pokémon on the other, at one shield
 * scenario, PvPoke's Battle → Matrix.
 *
 * A cell holds everything any of the four views needs (the battle, the damage each move deals both ways, and the
 * charge-move-priority comparison), so switching between Battle Rating, Breakpoints, Bulkpoints and Attack never
 * re-simulates. The views are read off the cell, and so are the Differences: a row against the baseline row, column
 * by column, naming what was gained and what was lost.
 */

/** One Pokémon on either side of the matrix, with its build. */
export interface MatrixEntry {
  /** Stable across edits and reorders, so React and the Differences key on it rather than on position. */
  key: string;
  ref: string;
  fastIdx: number;
  /** Empty means the league's rated charged moves. */
  chargeIds: string[];
  iv: IV;
  bestBuddy?: boolean;
}

/** An entry resolved against the league: the stats it fights at and the moves it uses. */
export interface ResolvedMon {
  entry: MatrixEntry;
  stats: RankedEntry;
  fast: FastMove;
  charges: ChargeMove[];
  types: readonly string[];
  mon: BattleMon;
}

let seq = 0;
/** A fresh entry key. Random enough to survive a reload alongside keys from a stored list. */
export const newKey = (): string => `m${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** An entry at the league's rated moves and the default roll — what a quick fill or a bare add produces. */
export function ratedEntry(ref: string, league: LeagueId): MatrixEntry {
  const s = defaultSpreadFor(ref, league);
  return { key: newKey(), ref, fastIdx: ratedFastIdx(ref, league), chargeIds: [], iv: { a: s.a, d: s.d, s: s.s } };
}

/** The same entry at its league's rank-1 roll (Best Buddy included where the entry is a buddy and can use it). */
export function atRankOne(e: MatrixEntry, league: LeagueId): MatrixEntry {
  const s = bestSpreadFor(e.ref, league, buddyOn(e, league));
  return { ...e, iv: { a: s.a, d: s.d, s: s.s } };
}

function buddyOn(e: MatrixEntry, league: LeagueId): boolean {
  const sp = speciesOf(e.ref);
  return !!e.bestBuddy && !!sp && bestBuddyEligible(sp, LEAGUE_BY_ID.get(league)!);
}

/** The charged moves an entry fields: its own pick, or the league's rated pair for its form. */
export function chargesFor(e: MatrixEntry, league: LeagueId): ChargeMove[] {
  const sp = speciesOf(e.ref)!;
  return e.chargeIds.length ? selectedCharges(sp, e.chargeIds) : movesFor(sp, league, parseRef(e.ref).shadow).charges;
}

export function resolve(e: MatrixEntry, league: LeagueId): ResolvedMon {
  const sp = speciesOf(e.ref)!;
  const stats = getEntry(e.ref, e.iv, league, buddyOn(e, league)).entry;
  const fast = sp.fastMoves[Math.min(Math.max(0, e.fastIdx), sp.fastMoves.length - 1)];
  const charges = chargesFor(e, league);
  return { entry: e, stats, fast, charges, types: sp.types, mon: mkBattleMon(stats, fast, charges, sp.types) };
}

/** A stored entry is only kept if it still names a species the engine can field. */
export function isUsable(e: unknown): e is MatrixEntry {
  if (!e || typeof e !== 'object') return false;
  const m = e as Partial<MatrixEntry>;
  const okIv = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15;
  return typeof m.key === 'string' && typeof m.ref === 'string' && !!speciesOf(m.ref) && isSimulated(m.ref)
    && typeof m.fastIdx === 'number' && Array.isArray(m.chargeIds) && m.chargeIds.every((c) => typeof c === 'string')
    && !!m.iv && okIv(m.iv.a) && okIv(m.iv.d) && okIv(m.iv.s);
}

// ── Cells ──────────────────────────────────────────────────────────────────

/** On a battle, `tie` is a simultaneous knockout (PvPoke rates it 500); on CMP it is an equal Attack stat. */
export type Outcome = 'win' | 'tie' | 'loss';

/** The three moves a damage view can be read on: the fast move, then the charged moves in the order equipped. */
export const MOVE_SLOTS = ['fast', 'charge1', 'charge2'] as const;
export type MoveSlot = (typeof MOVE_SLOTS)[number];
export const SLOT_LABEL: Record<MoveSlot, string> = { fast: 'Fast Move', charge1: 'Charged Move 1', charge2: 'Charged Move 2' };

export interface MatrixCell {
  /** PvPoke's 0–1000 battle rating, from the row Pokémon's side. A double knockout is 500. */
  rating: number;
  outcome: Outcome;
  /** Damage the row Pokémon deals the column one, per slot; null where it has no such move. */
  dealt: [number, number | null, number | null];
  /** Damage the row Pokémon takes from the column one, per slot. */
  taken: [number, number | null, number | null];
  /** Charge-move priority: the higher Attack stat throws first; equal stats both resolve. */
  cmp: Outcome;
  /** Row Attack stat minus column Attack stat. */
  atkDiff: number;
}

const hit = (from: ResolvedMon, to: ResolvedMon, move: FastMove | ChargeMove | undefined) =>
  move ? dmg(from.mon.atk, to.mon.def, move, to.types) : null;

/**
 * One pairing at one shield scenario. `optimizeTiming` is the app's charge-timing setting, the same one the 1v1 screen
 * reads, so a cell opened there replays the battle it was scored on.
 */
export function cell(row: ResolvedMon, col: ResolvedMon, shieldsRow: number, shieldsCol: number, optimizeTiming = false): MatrixCell {
  const r = battle(row.mon, col.mon, shieldsRow, shieldsCol, 0, 0, false, optimizeTiming);
  // PvPoke scores a double knockout a draw; the engine's `win` alone would hand it to the row.
  const tie = r.hpA <= 0 && r.hpB <= 0;
  const atkDiff = row.mon.cmpAtk - col.mon.cmpAtk;
  return {
    rating: tie ? 500 : rating(r, shieldsRow, shieldsCol),
    outcome: tie ? 'tie' : r.win ? 'win' : 'loss',
    dealt: [hit(row, col, row.fast)!, hit(row, col, row.charges[0]), hit(row, col, row.charges[1])],
    taken: [hit(col, row, col.fast)!, hit(col, row, col.charges[0]), hit(col, row, col.charges[1])],
    cmp: atkDiff > 0 ? 'win' : atkDiff < 0 ? 'loss' : 'tie',
    atkDiff,
  };
}

/** Every row against every column, indexed [row][column]. */
export function matrix(
  rows: readonly ResolvedMon[], cols: readonly ResolvedMon[], shieldsRow: number, shieldsCol: number, optimizeTiming = false,
): MatrixCell[][] {
  return rows.map((r) => cols.map((c) => cell(r, c, shieldsRow, shieldsCol, optimizeTiming)));
}

// ── Views ──────────────────────────────────────────────────────────────────

export type Metric = 'rating' | 'break' | 'bulk' | 'attack';
export const METRICS: { id: Metric; label: string; lede: string }[] = [
  { id: 'rating', label: 'Battle Rating', lede: 'Battle results against this group, from the left side\'s point of view. Select a column to sort.' },
  { id: 'break', label: 'Breakpoints', lede: 'Damage dealt to this group by the chosen move. Select a column to sort.' },
  { id: 'bulk', label: 'Bulkpoints', lede: 'Damage received from this group\'s chosen move. Select a column to sort.' },
  { id: 'attack', label: 'CMP', lede: 'Charge-move priority against this group: the higher Attack stat throws first when both throw on the same turn. Cells show the Attack stat difference. Select a column to sort.' },
];

const slotIdx = (slot: MoveSlot) => MOVE_SLOTS.indexOf(slot);

/** The number a cell shows in a view; null where the view has nothing to say (no such move). */
export function valueOf(c: MatrixCell, metric: Metric, slot: MoveSlot): number | null {
  if (metric === 'rating') return c.rating;
  if (metric === 'break') return c.dealt[slotIdx(slot)];
  if (metric === 'bulk') return c.taken[slotIdx(slot)];
  return c.atkDiff;
}

/**
 * The colour a cell carries: always the battle's outcome, CMP included (as PvPoke does), so a column reads the same in
 * every view. What a view is *about* — the battle, or charge-move priority on CMP — is `resultOf`.
 */
export const toneOf = (c: MatrixCell): Outcome => c.outcome;

/** The result a view counts in its Record and compares in its Differences: CMP on the CMP view, the battle otherwise. */
export const resultOf = (c: MatrixCell, metric: Metric): Outcome => (metric === 'attack' ? c.cmp : c.outcome);

/** Sort direction that puts the best first: less damage taken is better on Bulkpoints, more of everything else. */
export const higherIsBetter = (metric: Metric): boolean => metric !== 'bulk';

export interface Record3 { win: number; loss: number; tie: number }
export function recordOf(cells: readonly MatrixCell[], metric: Metric): Record3 {
  const out = { win: 0, loss: 0, tie: 0 };
  for (const c of cells) out[resultOf(c, metric)]++;
  return out;
}

export function averageOf(cells: readonly MatrixCell[], metric: Metric, slot: MoveSlot): number | null {
  const vs = cells.map((c) => valueOf(c, metric, slot)).filter((v): v is number => v !== null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

// ── Differences ────────────────────────────────────────────────────────────

/**
 * What changed in one column against the baseline row.
 *
 * Outcome views (Battle Rating, Attack) say which way the result moved and where it landed, so a matchup won and a
 * matchup merely drawn read differently: `gain-win` (now wins), `gain-tie` (a loss became a draw), `drop-tie` (a win
 * became a draw), `drop-loss` (now loses). Damage views move by a number, so they are a plain `gain` or `drop`.
 */
export type DiffKind = 'gain-win' | 'gain-tie' | 'drop-tie' | 'drop-loss' | 'gain' | 'drop';

export interface Diff {
  col: number;
  kind: DiffKind;
  /** Damage views: the change in damage (dealt, or taken), signed. */
  delta?: number;
}

const RANK: Record<Outcome, number> = { loss: 0, tie: 1, win: 2 };

function outcomeDiff(from: Outcome, to: Outcome): DiffKind | null {
  if (from === to) return null;
  if (RANK[to] > RANK[from]) return to === 'win' ? 'gain-win' : 'gain-tie';
  return to === 'loss' ? 'drop-loss' : 'drop-tie';
}

/** A row's differences from the baseline row, column by column, in column order. */
export function diffsOf(base: readonly MatrixCell[], row: readonly MatrixCell[], metric: Metric, slot: MoveSlot): Diff[] {
  const out: Diff[] = [];
  row.forEach((c, col) => {
    const b = base[col];
    if (!b) return;
    if (metric === 'rating' || metric === 'attack') {
      const kind = outcomeDiff(resultOf(b, metric), resultOf(c, metric));
      if (kind) out.push({ col, kind });
      return;
    }
    const was = valueOf(b, metric, slot);
    const now = valueOf(c, metric, slot);
    if (was === null || now === null || was === now) return;
    // More damage dealt is a breakpoint gained; less damage taken is a bulkpoint gained.
    const better = metric === 'break' ? now > was : now < was;
    out.push({ col, kind: better ? 'gain' : 'drop', delta: now - was });
  });
  return out;
}

/**
 * Battle Rating wording. A battle here always ends in a knockout, so a drawn battle is always a simultaneous KO and
 * is named as one; on CMP a tie is an equal Attack stat (`CMP_DIFF_LABEL`).
 */
export const DIFF_LABEL: Record<DiffKind, string> = {
  'gain-win': 'Now wins',
  'gain-tie': 'Loss → double KO',
  'drop-tie': 'Win → double KO',
  'drop-loss': 'Now loses',
  gain: 'Gained',
  drop: 'Lost',
};

export const CMP_DIFF_LABEL: Record<DiffKind, string> = {
  'gain-win': 'CMP won', 'gain-tie': 'CMP loss → tie', 'drop-tie': 'CMP win → tie', 'drop-loss': 'CMP lost', gain: 'Gained', drop: 'Lost',
};

// ── Quick fill ─────────────────────────────────────────────────────────────

/** How many of a meta a quick fill takes: the top of the league or cup's own ranking. */
export const META_SIZE = 40;

export interface QuickFill {
  key: string;
  label: string;
  /** One line on what the group is, for the option's second row. */
  note: string;
  /** Two to three CSS colours for the option's swatch: the cup's own palette, its types, or the league. */
  swatch: string[];
  /** Types a cup is built from, drawn as icons beside its name. */
  types: string[];
}

const LEAGUE_SWATCH: Record<LeagueId, string[]> = {
  great: ['var(--lg-great)', 'var(--lg-great-accent)'],
  ultra: ['var(--lg-ultra)', 'var(--lg-ultra-accent, #c9a227)'],
  master: ['var(--lg-master)', 'var(--lg-master-accent, #b88cff)'],
};

/** The groups a side can be filled with in a league: its meta, then each limited cup played under its cap. */
export function quickFills(league: LeagueId): QuickFill[] {
  const name = LEAGUE_BY_ID.get(league)!.name.split(' · ')[0];
  const cap = league === 'master' ? 'No CP cap' : `${LEAGUE_BY_ID.get(league)!.cap} CP`;
  return [
    { key: `meta:${league}`, label: `${name} meta`, note: `Top ${META_SIZE} by rating · ${cap}`, swatch: LEAGUE_SWATCH[league], types: [] },
    ...LIMITED_CUPS.filter((c) => c.base === league).map((c) => {
      const types = c.cup.include?.types ?? [];
      return {
        key: `cup:${c.key}`,
        label: c.name,
        note: `Top ${META_SIZE} the cup allows · ${cap}`,
        swatch: c.palette ?? (types.length ? types.slice(0, 3).map((t) => `var(--type-${t})`) : LEAGUE_SWATCH[league]),
        types,
      };
    }),
  ];
}

/** The refs a quick fill names, best first. */
export function quickFillRefs(key: string, league: LeagueId, size = META_SIZE): string[] {
  const ranked = fieldPool(league, DEFAULT_TIER(league), Number.MAX_SAFE_INTEGER).filter((r) => speciesOf(r) && isSimulated(r));
  if (key.startsWith('cup:')) {
    const legal = cupLegal(key.slice(4));
    return legal ? ranked.filter((r) => legal.has(r)).slice(0, size) : [];
  }
  return ranked.slice(0, size);
}

// ── Labels ─────────────────────────────────────────────────────────────────

/**
 * A move as a short code, the way PvPoke heads a matrix column ("Pk+S/Fl"): a multi-word move by its initials, a
 * single word by its first letter and the next consonant.
 */
export function moveAbbr(name: string): string {
  // "Weather Ball (Fire)" is still Weather Ball.
  const words = name.replace(/\(.*?\)/g, '').split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0].toUpperCase()).join('');
  const w = words[0] ?? '';
  const next = w.slice(1).match(/[bcdfghjklmnpqrstvwxz]/i)?.[0] ?? '';
  return w.charAt(0).toUpperCase() + next.toLowerCase();
}

/** Fast move, then charged moves: "Pk+S/Fl". */
export const movesetAbbr = (m: ResolvedMon): string =>
  `${moveAbbr(m.fast.name)}${m.charges.length ? '+' : ''}${m.charges.map((c) => moveAbbr(c.name)).join('/')}`;

export const ivText = (iv: IV): string => `${iv.a}/${iv.d}/${iv.s}`;
