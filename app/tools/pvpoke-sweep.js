// Run on any pvpoke.com battle page (browser console, or the Claude browser
// pane's javascript_exec), after setting TOP to the first 50 entries of
// data-src/rankings-1500.json as [speciesId, fast, charged1, charged2]:
//
//   TOP = <paste>; <this file>
//
// It drives PvPoke's own Battle/Pokemon classes and returns the JSON for
// data-src/pvpoke-sweep-1500.json minus the _readme/generated/league/top keys.
// Check `ck` against what `npm run parity` recomputes before committing.
(() => {
  const run = (sh, ivs) => {
    const out = [];
    for (let i = 0; i < TOP.length; i++)
      for (let j = i + 1; j < TOP.length; j++) {
        const b = new Battle();
        b.setCP(1500);
        const mk = (t, k) => {
          const p = new Pokemon(t[0], k, b);
          p.initialize(1500);
          p.selectMove('fast', t[1]);
          p.selectMove('charged', t[2], 0);
          p.selectMove('charged', t[3], 1);
          p.setShields(sh);
          return p;
        };
        const A = mk(TOP[i], 0), B = mk(TOP[j], 1);
        b.setNewPokemon(A, 0);
        b.setNewPokemon(B, 1);
        b.simulate();
        ivs[TOP[i][0]] = [A.level, A.ivs.atk, A.ivs.def, A.ivs.hp];
        ivs[TOP[j][0]] = [B.level, B.ivs.atk, B.ivs.def, B.ivs.hp];
        out.push(`${A.hp} ${B.hp}`);
      }
    return out;
  };
  const ivs = {};
  const rs = [0, 1, 2].map((sh) => run(sh, ivs));
  let ck = 0, k = 0;
  for (const r of rs) for (const x of r) { const [a, b] = x.split(' ').map(Number); k++; ck = (ck + k * (a * 1000 + b)) % 1000000007; }
  return JSON.stringify({ ivs, ck, r: rs.map((r) => r.join(',')) });
})();
