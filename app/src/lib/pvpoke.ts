/**
 * PvPoke's own battle engine, run as-is.
 *
 * The files in app/vendor/pvpoke are PvPoke's Battle, Pokemon, ActionLogic
 * and friends, unmodified (MIT). They are browser scripts: sloppy-mode globals
 * that load their data with jQuery. So they are evaluated with `new Function`
 * - sloppy by construction, which they need - with the handful of globals
 * they touch passed in as parameters, shadowing the real ones.
 *
 * The caller supplies the sources and the gamemaster, so the same loader
 * serves Node scripts (fs) and the app (a bundler import) alike.
 */

/** Evaluation order: each file only needs the ones before it at call time. */
export const PVPOKE_FILES = [
  'DamageCalculator', 'TimelineEvent', 'TimelineAction', 'GameMaster', 'Pokemon', 'ActionLogic', 'Battle',
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped vendored JS */
export interface PvPoke {
  Battle: any;
  Pokemon: any;
}

export function loadPvPoke(sources: Record<(typeof PVPOKE_FILES)[number], string>, gamemaster: unknown): PvPoke {
  // GameMaster requests its data through $.ajax and defines the rest of its
  // methods after that call returns, so the data must arrive afterwards,
  // as it would asynchronously in a browser.
  const pending: { success: (d: unknown) => void }[] = [];
  const jq = Object.assign(() => ({ insertAfter() {}, eq() { return this; } }), {
    ajax: (o: { success: (d: unknown) => void }) => pending.push(o),
    getJSON: () => {},
  });
  const store: Record<string, string> = {};
  const window = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    location: { href: '' },
  };
  const settings = { gamemaster: 'gamemaster', xls: false, hardMovesetLinks: false };
  const body = PVPOKE_FILES.map((f) => sources[f]).join('\n;\n') +
    '\nvar gm = GameMaster.getInstance();\nreturn { Battle: Battle, Pokemon: Pokemon };';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const make = new Function('$', 'window', 'host', 'webRoot', 'siteVersion', 'settings', 'console', body);
  const quiet = { ...console, log: () => {} };
  const engine = make(jq, window, 'node', '', '0', settings, quiet) as PvPoke;
  while (pending.length) pending.shift()!.success(gamemaster);
  return engine;
}
