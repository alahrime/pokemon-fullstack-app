/**
 * Option A for the app, apart from src/lib/pvpoke.ts so that Node scripts
 * (bundled by esbuild, which has no `?raw`) can import the loader without it.
 */
import { loadPvPoke, type PvPoke } from './pvpoke';

let appEngine: Promise<PvPoke> | null = null;

/**
 * The engine for the app: sources and the trimmed gamemaster load on first
 * call, in a chunk of their own (~140 KB gzipped), so nothing that never runs
 * option A pays for it. Memoised.
 */
export function loadPvPokeLazy(): Promise<PvPoke> {
  appEngine ??= Promise.all([
    import('../../vendor/pvpoke/DamageCalculator.js?raw'),
    import('../../vendor/pvpoke/TimelineEvent.js?raw'),
    import('../../vendor/pvpoke/TimelineAction.js?raw'),
    import('../../vendor/pvpoke/GameMaster.js?raw'),
    import('../../vendor/pvpoke/Pokemon.js?raw'),
    import('../../vendor/pvpoke/ActionLogic.js?raw'),
    import('../../vendor/pvpoke/Battle.js?raw'),
    import('../data/pvpoke-gamemaster.json'),
  ]).then(([dc, te, ta, gmSrc, pk, al, bt, data]) =>
    loadPvPoke(
      { DamageCalculator: dc.default, TimelineEvent: te.default, TimelineAction: ta.default, GameMaster: gmSrc.default,
        Pokemon: pk.default, ActionLogic: al.default, Battle: bt.default },
      data.default,
    ),
  );
  return appEngine;
}
