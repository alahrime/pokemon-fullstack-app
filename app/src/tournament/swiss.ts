// Swiss pairing and standings. Pure and isomorphic: the same code pairs a round
// in the organiser's browser and (later) verifies one under Node.
//
// ponytail: adjacent-in-rank DFS with a node budget, not a true Dutch/Burstein
// system. Ceiling: it never repeats a pairing when one exists within the
// budget, but it does not minimise score-group floaters optimally. Upgrade to
// a matching-based pairer if organisers report ugly pairings.

export interface Game { round: number; a: string; b: string | null; scoreA: number; scoreB: number }
export interface Standing {
  id: string; matches: number; matchWins: number; gameWins: number; gameLosses: number;
  omw: number; gwp: number; hadBye: boolean; opponents: string[];
}
export interface Pairing { a: string; b: string | null }

const FLOOR = 1 / 3;
const GAMES_TO_WIN = 2;
const NODE_BUDGET = 50_000;

export const defaultRounds = (players: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(1, players))));

export function standings(ids: readonly string[], games: readonly Game[]): Standing[] {
  const by = new Map<string, Standing>(
    ids.map((id) => [id, { id, matches: 0, matchWins: 0, gameWins: 0, gameLosses: 0, omw: FLOOR, gwp: FLOOR, hadBye: false, opponents: [] }]),
  );
  for (const g of games) {
    const A = by.get(g.a);
    if (!A) continue;
    A.matches++;
    if (g.b === null) { A.hadBye = true; A.matchWins++; A.gameWins += GAMES_TO_WIN; continue; }
    const B = by.get(g.b);
    if (!B) { A.matches--; continue; }
    B.matches++;
    A.opponents.push(g.b); B.opponents.push(g.a);
    A.gameWins += g.scoreA; A.gameLosses += g.scoreB;
    B.gameWins += g.scoreB; B.gameLosses += g.scoreA;
    if (g.scoreA > g.scoreB) A.matchWins++;
    else if (g.scoreB > g.scoreA) B.matchWins++;
  }
  const rate = (id: string) => { const o = by.get(id)!; return Math.max(FLOOR, o.matches ? o.matchWins / o.matches : 0); };
  for (const s of by.values()) {
    s.omw = s.opponents.length ? s.opponents.reduce((n, id) => n + rate(id), 0) / s.opponents.length : FLOOR;
    const gt = s.gameWins + s.gameLosses;
    s.gwp = gt ? Math.max(FLOOR, s.gameWins / gt) : FLOOR;
  }
  const h2h = (x: string, y: string) => {
    let r = 0;
    for (const g of games) {
      if (g.b === null) continue;
      if (g.a === x && g.b === y) r += Math.sign(g.scoreA - g.scoreB);
      if (g.a === y && g.b === x) r += Math.sign(g.scoreB - g.scoreA);
    }
    return r;
  };
  return [...by.values()].sort(
    (p, q) =>
      q.matchWins - p.matchWins || q.omw - p.omw || q.gwp - p.gwp ||
      h2h(q.id, p.id) - h2h(p.id, q.id) || p.id.localeCompare(q.id),
  );
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function solve(order: string[], played: ReadonlySet<string>, budget: { n: number }): Pairing[] | null {
  if (order.length === 0) return [];
  const [first, ...rest] = order;
  for (let i = 0; i < rest.length; i++) {
    if (played.has(pairKey(first, rest[i]))) continue;
    if (--budget.n < 0) return null;
    const next = solve(rest.filter((_, j) => j !== i), played, budget);
    if (next) return [{ a: first, b: rest[i] }, ...next];
  }
  return null;
}

function greedy(order: string[]): Pairing[] {
  const out: Pairing[] = [];
  for (let i = 0; i + 1 < order.length; i += 2) out.push({ a: order[i], b: order[i + 1] });
  return out;
}

export function pairSwiss(
  active: readonly string[], games: readonly Game[], seed: string,
): { pairs: Pairing[]; rematches: number } {
  if (active.length === 0) return { pairs: [], rematches: 0 };
  const played = new Set(games.filter((g) => g.b !== null).map((g) => pairKey(g.a, g.b as string)));
  let order: string[];
  let byeCandidates: string[];
  if (games.length === 0) {
    const rnd = mulberry32(hash(seed));
    order = [...active].sort();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    byeCandidates = [...order].reverse();
  } else {
    const ranked = standings(active, games);
    order = ranked.map((s) => s.id);
    const noBye = ranked.filter((s) => !s.hadBye).map((s) => s.id).reverse();
    byeCandidates = noBye.length ? noBye : [...order].reverse();
  }

  const odd = order.length % 2 === 1;
  const candidates = odd ? byeCandidates : [null];
  for (const bye of candidates) {
    const rest = bye === null ? order : order.filter((id) => id !== bye);
    const pairs = solve(rest, played, { n: NODE_BUDGET });
    if (pairs) return { pairs: bye === null ? pairs : [...pairs, { a: bye, b: null }], rematches: 0 };
  }
  // No fresh pairing exists (or the budget ran out): pair adjacent in rank and report the rematches.
  const bye = odd ? candidates[0] : null;
  const rest = bye === null ? order : order.filter((id) => id !== bye);
  const pairs = greedy(rest);
  const rematches = pairs.filter((p) => p.b !== null && played.has(pairKey(p.a, p.b as string))).length;
  return { pairs: bye === null ? pairs : [...pairs, { a: bye as string, b: null }], rematches };
}
