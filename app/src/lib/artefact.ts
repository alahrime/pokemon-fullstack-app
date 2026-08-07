import type { LeagueId } from './types';

/**
 * Typed access to the generated JSON artefacts, checked rather than asserted.
 *
 * Every artefact was previously read as `raw as unknown as Record<LeagueId, T>`.
 * That cast is a claim tsc cannot check and does not try to: the JSON is data,
 * the interface is a description of it, and nothing keeps the two in step. When
 * the build renamed a Bradley-Terry field from `sampled` to `total` and the emit
 * lagged the reader, the compiler saw a perfectly typed `number` and the screen
 * got `undefined` — a white page, with the gate green.
 *
 * A cast still happens here, because a structural check cannot produce a type on
 * its own. The difference is that it happens once, behind a runtime assertion
 * that names the missing field and the command that regenerates it, instead of
 * silently at five separate import sites.
 *
 * The check is deliberately shallow — presence of the keys each reader depends
 * on, per league. Deep validation of multi-megabyte artefacts on every page load
 * would cost more than it protects, and `npm run verify` already walks the
 * contents properly offline.
 */

const LEAGUE_IDS: readonly LeagueId[] = ['great', 'ultra', 'master'];

function fail(name: string, detail: string, rebuild: string): never {
  throw new Error(`Artefact ${name} is unusable: ${detail}. Re-run \`${rebuild}\`.`);
}

/**
 * Read an artefact keyed by league, asserting each league carries `required`.
 *
 * `rebuild` is the npm script that regenerates the file, and it goes in the
 * error text — the failure is nearly always a stale artefact, and the fix is
 * more useful than the diagnosis.
 */
export function leagueArtefact<T>(
  raw: unknown,
  name: string,
  required: readonly (keyof T & string)[],
  rebuild: string,
): Record<LeagueId, T> {
  if (!raw || typeof raw !== 'object') fail(name, 'not an object', rebuild);
  const byLeague = raw as Record<string, unknown>;
  for (const lg of LEAGUE_IDS) {
    const entry = byLeague[lg];
    if (!entry || typeof entry !== 'object') fail(name, `no data for the ${lg} league`, rebuild);
    const missing = required.filter((k) => (entry as Record<string, unknown>)[k] === undefined);
    if (missing.length) fail(name, `${lg} is missing ${missing.join(', ')}`, rebuild);
  }
  return raw as Record<LeagueId, T>;
}

/** Read an artefact with its own shape, asserting the top-level keys exist. */
export function artefact<T>(
  raw: unknown,
  name: string,
  required: readonly (keyof T & string)[],
  rebuild: string,
): T {
  if (!raw || typeof raw !== 'object') fail(name, 'not an object', rebuild);
  const obj = raw as Record<string, unknown>;
  const missing = required.filter((k) => obj[k] === undefined);
  if (missing.length) fail(name, `missing ${missing.join(', ')}`, rebuild);
  return raw as T;
}
