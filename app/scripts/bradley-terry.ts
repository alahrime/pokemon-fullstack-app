/**
 * A Bradley-Terry fit over the matchup matrix, as an alternative to the
 * composite Overall.
 *
 * WHY
 *
 * The composite ranks by aggregating each Pokemon's matchup ratings under a
 * weighting somebody chose: opponents graded by `((o - min) / span) ** 3`, five
 * role categories blended by hand-set scenario weights, then a weighted
 * geometric mean with exponents 12/6/4/2. Every one of those numbers is a
 * judgement call, and §1l records that we could not settle even one of them
 * (score curve versus log-of-rank) by measurement.
 *
 * Bradley-Terry asks a different question. Rather than "what is the weighted
 * average of this Pokemon's results", it asks "what single strength per
 * Pokemon best explains ALL the observed matchups at once". Beating a strong
 * opponent counts for more automatically, because the model has to raise your
 * strength to explain the result — it falls out of the fit rather than out of a
 * chosen curve.
 *
 * THE MODEL
 *
 *   p_ab = sigma(s_a - s_b)        probability a beats b
 *   logit(p_ab) = s_a - s_b        so the fit is linear in log-odds
 *
 * Over a complete graph — and ours is complete, every ref meets every ref — the
 * least-squares solution has a closed form: each strength is the mean of its
 * own row of log-odds. No solver, no convergence question, no learning rate.
 *
 *   s_a = (1 / n) * sum_b logit(p_ab)
 *
 * That is the Massey/Colley construction, and it is exactly least squares on
 * the log-odds with the design matrix being the graph Laplacian.
 *
 * WHAT p COMES FROM
 *
 * Ratings are already an expected-score measure on 0-1000, so the Bradley-Terry
 * form is available directly:
 *
 *   p_ab = R_ab / (R_ab + R_ba)
 *
 * This symmetrises correctly even though R_ab and R_ba are not complementary —
 * the soft cap and loss curve are applied to each side independently, so
 * R_ab + R_ba is not 1000.
 *
 * THE HONEST CAVEAT
 *
 * Bradley-Terry assumes one latent strength explains every matchup, which means
 * approximate transitivity. Pokemon PvP is famously intransitive: cores and
 * coverage triangles ARE cyclic structure, and no single number can express
 * "beats A, loses to B, where B loses to A". The residuals are therefore not
 * noise to be minimised away — they are the measurement of how much of this
 * format any one-dimensional ranking can carry at all, which nothing in this
 * pipeline currently reports. Read them as the finding, not the error term.
 */

export interface BTFit {
  /** Latent strength per ref, in log-odds. Higher is stronger. */
  strength: Float64Array;
  /** Share of variance in observed log-odds the single strength explains. */
  r2: number;
  /** Root mean squared residual in probability space. */
  rmse: number;
  /**
   * The most intransitive pairs: where a single strength is furthest from
   * explaining the observed result. Positive means the model UNDER-rates a's
   * result against b.
   */
  worst: { a: number; b: number; observed: number; predicted: number }[];
  /**
   * Cyclic triples found by sampling: a beats b, b beats c, c beats a. The
   * count is the direct measure of how non-transitive the format is.
   */
  cycles: { sampled: number; cyclic: number };
}

const sigma = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Clamped log-odds. A probability of exactly 0 or 1 has infinite log-odds and
 * would dominate a mean, so the clamp bounds any single matchup's influence at
 * roughly +/-4.6 (a 99:1 result).
 */
const EPS = 0.01;
const logit = (p: number): number => {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
};

/**
 * Fit strengths from a square rating matrix.
 *
 * `R[a * n + b]` is a's mean rating against b on the 0-1000 scale. The diagonal
 * is ignored: a species is never scored against itself (see BACKLOG §0).
 */
export function fitBradleyTerry(R: Float64Array, n: number, topK = 20): BTFit {
  // Observed log-odds, and the row means that solve the least-squares problem.
  const L = new Float64Array(n * n);
  const strength = new Float64Array(n);
  for (let a = 0; a < n; a++) {
    let sum = 0;
    let count = 0;
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const rab = R[a * n + b];
      const rba = R[b * n + a];
      const total = rab + rba;
      const p = total > 0 ? rab / total : 0.5;
      const l = logit(p);
      L[a * n + b] = l;
      sum += l;
      count++;
    }
    strength[a] = count ? sum / count : 0;
  }
  // Centre, so the scale has a meaningful zero rather than an arbitrary offset.
  const mean = strength.reduce((x, y) => x + y, 0) / (n || 1);
  for (let a = 0; a < n; a++) strength[a] -= mean;

  // Residuals in probability space, which is the interpretable one: a residual
  // of 0.2 means the model missed that matchup by twenty points of win rate.
  let ssRes = 0;
  let ssTot = 0;
  let sqSum = 0;
  let pairs = 0;
  let pMean = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      pMean += sigma(L[a * n + b]);
      pairs++;
    }
  }
  pMean /= pairs || 1;

  const worst: BTFit['worst'] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const obs = sigma(L[a * n + b]);
      const pred = sigma(strength[a] - strength[b]);
      const d = obs - pred;
      ssRes += d * d;
      ssTot += (obs - pMean) ** 2;
      sqSum += d * d;
      // Keep only the extreme tail; a full sort of 1.3M pairs is not needed.
      if (Math.abs(d) > 0.25) worst.push({ a, b, observed: obs, predicted: pred });
    }
  }
  worst.sort((x, y) => Math.abs(y.observed - y.predicted) - Math.abs(x.observed - x.predicted));

  // Intransitivity, measured directly rather than inferred from residuals.
  // Sampling rather than enumerating: n^3 is 1.5 billion triples in Great.
  let sampled = 0;
  let cyclic = 0;
  const beats = (x: number, y: number) => sigma(L[x * n + y]) > 0.5;
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const TRIPLES = 200_000;
  for (let t = 0; t < TRIPLES && n >= 3; t++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    const c = Math.floor(rnd() * n);
    if (a === b || b === c || a === c) continue;
    sampled++;
    if (beats(a, b) && beats(b, c) && beats(c, a)) cyclic++;
    else if (beats(b, a) && beats(c, b) && beats(a, c)) cyclic++;
  }

  return {
    strength,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    rmse: Math.sqrt(sqSum / (pairs || 1)),
    worst: worst.slice(0, topK),
    cycles: { sampled, cyclic },
  };
}
