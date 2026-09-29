// Swiss pairing and standings. Pure and isomorphic: the same code pairs a round
// in the organiser's browser and (later) verifies one under Node.
//
// ponytail: adjacent-in-rank DFS under ONE node budget shared by the whole
// pairSwiss call (so the worst case is bounded, ~NODE_BUDGET * N steps), not a
// true Dutch/Burstein system. It never repeats a pairing when one is found
// within the budget, and does not minimise score-group floaters. When the
// budget runs out (or no fresh pairing exists) a greedy pass pairs each player
// with the best-ranked partner they have not played, else the next one; that
// is cheap, not minimal in rematches. Upgrade to a matching-based pairer if
// organisers report ugly pairings.

export interface Game { round: number; a: string; b: string | null; scoreA: number; scoreB: number }
export interface Standing {
  id: string; matches: number; matchWins: number; gameWins: number; gameLosses: number;
  omw: number; gwp: number; hadBye: boolean; opponents: string[];
}
export interface Pairing { a: string; b: string | null }

const FLOOR = 1 / 3;
const GAMES_TO_WIN = 2;
const NODE_BUDGET = 50_000;
const EPS = 1e-9;

export const defaultRounds = (players: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(1, players))));

// Games naming an id not in `ids` are ignored (both sides of that game). Callers
// that must keep such games (e.g. dropped opponents) pass those ids too, as pairSwiss does.
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
  const cmp = (x: number, y: number) => (Math.abs(x - y) < EPS ? 0 : y - x);
  const sorted = [...by.values()].sort(
    (p, q) => cmp(p.matchWins, q.matchWins) || cmp(p.omw, q.omw) || cmp(p.gwp, q.gwp) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0),
  );
  // Head-to-head only for a group of exactly two tied players: on 3+ it can cycle and make the order input-dependent.
  const tied = (p: Standing, q: Standing) => !(cmp(p.matchWins, q.matchWins) || cmp(p.omw, q.omw) || cmp(p.gwp, q.gwp));
  const out: Standing[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && tied(sorted[i], sorted[j])) j++;
    if (j - i === 2 && h2h(sorted[i + 1].id, sorted[i].id) > h2h(sorted[i].id, sorted[i + 1].id)) out.push(sorted[i + 1], sorted[i]);
    else out.push(...sorted.slice(i, j));
    i = j;
  }
  return out;
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

// Adjacent-in-rank DFS. `used` is mutated and restored; one shared budget counts every call.
function solve(order: string[], used: boolean[], from: number, played: ReadonlySet<string>, budget: { n: number }, acc: Pairing[]): boolean {
  let i = from;
  while (i < order.length && used[i]) i++;
  if (i === order.length) return true;
  if (--budget.n < 0) return false;
  used[i] = true;
  for (let j = i + 1; j < order.length; j++) {
    if (used[j] || played.has(pairKey(order[i], order[j]))) continue;
    used[j] = true;
    acc.push({ a: order[i], b: order[j] });
    if (solve(order, used, i + 1, played, budget, acc)) return true;
    acc.pop();
    used[j] = false;
    if (budget.n < 0) break;
  }
  used[i] = false;
  return false;
}

// Cheap fallback: each player in rank order takes the best-ranked unplayed partner still free, else the next free one.
function greedy(order: string[], played: ReadonlySet<string>): Pairing[] {
  const used = new Array<boolean>(order.length).fill(false);
  const out: Pairing[] = [];
  for (let i = 0; i < order.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let pick = -1;
    for (let j = i + 1; j < order.length; j++) {
      if (used[j]) continue;
      if (pick < 0) pick = j;
      if (!played.has(pairKey(order[i], order[j]))) { pick = j; break; }
    }
    used[pick] = true;
    out.push({ a: order[i], b: order[pick] });
  }
  return out;
}

export function pairSwiss(
  activeIn: readonly string[], games: readonly Game[], seed: string, nodeBudget = NODE_BUDGET,
): { pairs: Pairing[]; rematches: number; repeatBye: boolean } {
  const active = [...new Set(activeIn)];
  if (active.length === 0) return { pairs: [], rematches: 0, repeatBye: false };
  const played = new Set(games.filter((g) => g.b !== null).map((g) => pairKey(g.a, g.b as string)));
  const hadBye = new Set(games.filter((g) => g.b === null).map((g) => g.a));
  let order: string[];
  let byeCandidates: string[];
  if (games.length === 0) {
    const rnd = mulberry32(hash(seed));
    order = [...active].sort();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    byeCandidates = [...order].reverse();
  } else {
    // rank over active + everyone in games so a dropped opponent's games still count for the survivors
    const everyone = new Set(active);
    for (const g of games) { everyone.add(g.a); if (g.b !== null) everyone.add(g.b); }
    const keep = new Set(active);
    order = standings([...everyone], games).map((s) => s.id).filter((id) => keep.has(id));
    const noBye = order.filter((id) => !hadBye.has(id)).reverse();
    byeCandidates = noBye.length ? noBye : [...order].reverse();
  }

  const odd = order.length % 2 === 1;
  const candidates = odd ? byeCandidates : [null];
  const budget = { n: nodeBudget };
  for (const bye of candidates) {
    const rest = bye === null ? order : order.filter((id) => id !== bye);
    const pairs: Pairing[] = [];
    if (solve(rest, new Array<boolean>(rest.length).fill(false), 0, played, budget, pairs)) {
      return { pairs: bye === null ? pairs : [...pairs, { a: bye, b: null }], rematches: 0, repeatBye: bye !== null && hadBye.has(bye) };
    }
    if (budget.n < 0) break;
  }
  // No fresh pairing exists (or the budget ran out): greedy, and report the rematches.
  const bye = odd ? candidates[0] : null;
  const rest = bye === null ? order : order.filter((id) => id !== bye);
  const pairs = greedy(rest, played);
  const rematches = pairs.filter((p) => p.b !== null && played.has(pairKey(p.a, p.b as string))).length;
  return { pairs: bye === null ? pairs : [...pairs, { a: bye as string, b: null }], rematches, repeatBye: bye !== null && hadBye.has(bye) };
}
