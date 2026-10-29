/**
 * Every cup in PvPoke's format dropdown, with its population: the species PvPoke ranks in it, best first.
 * Writes src/data/cup-pools.json. Network, so it is run by hand (`npm run cups`), not by `npm run data`.
 *
 * The dropdown is the live gamemaster's `formats` with `showFormat`; a cup's rankings live at
 * rankings/<cup>/overall/rankings-<cp>.json. A cup PvPoke lists but publishes no ranking for is skipped, loudly.
 */
import { writeFileSync } from 'node:fs';

const B = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data';
const get = async (url) => {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
};

const gm = await get(`${B}/gamemaster.min.json`);
const cups = [];
for (const f of gm.formats.filter((f) => f.showFormat && f.cup !== 'all' && f.cup !== 'custom')) {
  const ranking = await get(`${B}/rankings/${f.cup}/overall/rankings-${f.cp}.json`);
  if (!ranking) { console.warn(`skipped ${f.title}: no rankings/${f.cup}/overall/rankings-${f.cp}.json`); continue; }
  cups.push({ cup: f.cup, cp: Number(f.cp), title: f.title, ids: ranking.map((r) => r.speciesId) });
  console.log(`${f.title}: ${ranking.length}`);
}
writeFileSync(new URL('../src/data/cup-pools.json', import.meta.url), JSON.stringify(cups) + '\n');
