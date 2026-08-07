import { describe, it, expect } from 'vitest';
import { fitBradleyTerry } from '../bradley-terry';

/** Build a rating matrix from a win/loss table; 700 beats 300. */
function matrixFrom(beats: number[][]): Float64Array {
  const n = beats.length;
  const R = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (a === b) continue;
    R[a * n + b] = beats[a][b] ? 700 : 300;
  }
  return R;
}

describe('fitBradleyTerry — transitive cases', () => {
  it('recovers the order of a strict hierarchy', () => {
    // 0 beats everyone, 1 beats 2 and 3, 2 beats 3.
    const beats = [
      [0, 1, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 0],
    ];
    const fit = fitBradleyTerry(matrixFrom(beats), 4);
    const s = Array.from(fit.strength);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(s[2]).toBeGreaterThan(s[3]);
  });

  it('finds no cycles in a hierarchy, and counts every triple', () => {
    const beats = [
      [0, 1, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 0],
    ];
    const fit = fitBradleyTerry(matrixFrom(beats), 4);
    expect(fit.cycles.cyclic).toBe(0);
    expect(fit.cycles.total).toBe(4); // C(4,3)
  });

  it('centres the strengths on zero', () => {
    const beats = [[0, 1, 1], [0, 0, 1], [0, 0, 0]];
    const fit = fitBradleyTerry(matrixFrom(beats), 3);
    const sum = Array.from(fit.strength).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 9);
  });
});

describe('fitBradleyTerry — cyclic cases', () => {
  it('detects a rock-paper-scissors triple whichever way it is oriented', () => {
    const fwd = fitBradleyTerry(matrixFrom([[0, 1, 0], [0, 0, 1], [1, 0, 0]]), 3);
    const rev = fitBradleyTerry(matrixFrom([[0, 0, 1], [1, 0, 0], [0, 1, 0]]), 3);
    expect(fwd.cycles.cyclic).toBe(1);
    expect(rev.cycles.cyclic).toBe(1);
  });

  it('gives all three equal strength in a perfect cycle — the model cannot separate them', () => {
    const fit = fitBradleyTerry(matrixFrom([[0, 1, 0], [0, 0, 1], [1, 0, 0]]), 3);
    const s = Array.from(fit.strength);
    expect(s[0]).toBeCloseTo(s[1], 9);
    expect(s[1]).toBeCloseTo(s[2], 9);
  });

  it('reports a poor fit for a cycle and a good one for a hierarchy', () => {
    const cyc = fitBradleyTerry(matrixFrom([[0, 1, 0], [0, 0, 1], [1, 0, 0]]), 3);
    const hier = fitBradleyTerry(matrixFrom([[0, 1, 1], [0, 0, 1], [0, 0, 0]]), 3);
    expect(cyc.rmse).toBeGreaterThan(hier.rmse);
  });

  it('counts C(n,3) triples exactly — a census, not a sample', () => {
    for (const n of [3, 5, 8]) {
      const beats = Array.from({ length: n }, (_, a) =>
        Array.from({ length: n }, (_, b) => (a < b ? 1 : 0)));
      const fit = fitBradleyTerry(matrixFrom(beats), n);
      expect(fit.cycles.total).toBe((n * (n - 1) * (n - 2)) / 6);
    }
  });
});

describe('fitBradleyTerry — edge cases', () => {
  it('survives a matrix of zeros without NaN', () => {
    const fit = fitBradleyTerry(new Float64Array(9), 3);
    expect(Array.from(fit.strength).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(fit.rmse)).toBe(true);
  });
  it('handles n < 3, where no triple exists', () => {
    const fit = fitBradleyTerry(matrixFrom([[0, 1], [0, 0]]), 2);
    expect(fit.cycles.total).toBe(0);
    expect(fit.cycles.cyclic).toBe(0);
  });
  it('clamps a total blowout instead of producing infinite log-odds', () => {
    const R = new Float64Array(4);
    R[0 * 2 + 1] = 1000; R[1 * 2 + 0] = 0;
    const fit = fitBradleyTerry(R, 2);
    expect(Array.from(fit.strength).every(Number.isFinite)).toBe(true);
  });
  it('reports the pairs it cannot explain', () => {
    // A long hierarchy with one upset planted in it.
    const n = 6;
    const beats = Array.from({ length: n }, (_, a) =>
      Array.from({ length: n }, (_, b) => (a < b ? 1 : 0)));
    beats[5][0] = 1; beats[0][5] = 0; // the weakest beats the strongest
    const fit = fitBradleyTerry(matrixFrom(beats), n);
    expect(fit.worst.length).toBeGreaterThan(0);
    const pair = fit.worst.find((w) => w.a === 5 && w.b === 0);
    expect(pair).toBeDefined();
    expect(pair!.observed).toBeGreaterThan(pair!.predicted);
  });
});
