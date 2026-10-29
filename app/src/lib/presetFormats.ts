import { resolvePool } from '../rules/pool';
import { rulesHash, RULES_SCHEMA, type Format } from '../rules';
import type { LeagueId } from './types';
import { listServerFormats, saveServerFormat, type SavedFormat } from './saves';
import CUP_POOLS from '../data/cup-pools.json';

/**
 * PvPoke's format dropdown as rules. A cup is an include list and an exclude list of types, tags and ids; the
 * shipped cups are only an include list of ids, PvPoke's own ranking for the cup. `toFormat` turns one into rules.
 * Nobody has to save these: choosing one in a challenge saves it to your own formats the first time, and reuses
 * that copy after.
 *
 * `every` cups draw from every species buildable under the cap, Megas included, not just the league's ranked ones.
 * Their include lists are turned into one deny of everything outside them, since the pool already starts full.
 */
export interface Cup {
  /** Start from everything buildable, Megas too, instead of the ranked league. */
  every?: boolean;
  include?: { types?: string[]; ids?: string[] };
  exclude?: { types?: string[]; ids?: string[]; tags?: string[] };
}
export interface PresetFormat {
  key: string; name: string; base: LeagueId; cup: Cup; format: Format;
  /** Colours for a cup that is not defined by types (the Mega and LAIC cups); types, then the league, otherwise. */
  palette?: string[];
}

const MEGA = ['#ef5a3c', '#f2b630'];

const ref = (ids: string[]) => ids.map((i) => `=${i}`).join(',');

export function toFormat(base: LeagueId, cup: Cup): Format {
  const pool: Format['pool'] = [];
  const add = (effect: 'allow' | 'deny', select: string) => { if (select) pool.push({ effect, select }); };
  const inc = cup.include;
  const hasInc = !!(inc?.types?.length || inc?.ids?.length);
  if (cup.every) {
    // Not in any include list: no type of the list, and not one of its ids.
    if (hasInc) add('deny', [...(inc?.types ?? []).map((t) => `!${t}`), ...(inc?.ids ?? []).map((i) => `!=${i}`)].join('&'));
  } else {
    add('allow', (inc?.types ?? []).join(','));
    add('allow', ref(inc?.ids ?? []));
  }
  add('deny', (cup.exclude?.types ?? []).join(','));
  add('deny', (cup.exclude?.tags ?? []).join(','));
  add('deny', ref(cup.exclude?.ids ?? []));
  return {
    schema: RULES_SCHEMA,
    base,
    start: cup.every ? 'every' : hasInc ? 'empty' : 'league',
    pool,
    composition: { size: 3 },
    selection: { mode: 'open' },
  };
}

const preset = (key: string, name: string, base: LeagueId, cup: Cup = {}, palette?: string[]): PresetFormat =>
  ({ key, name, base, cup, format: toFormat(base, cup), palette });

/** Keys the app used before cups came from PvPoke's own list, kept so saved selections still resolve. */
const KEYS: Record<string, string> = {
  'mega-1500': 'mega-great', 'mega-2500': 'mega-ultra', 'mega-10000': 'mega-master', 'laic2027-1500': 'laic-2027',
  'spectral-1500': 'battlefrontier-spectral', 'cauldron-2500': 'battlefrontier-cauldron',
  'battlefrontiermaster-10000': 'battlefrontier-master',
};
const BASE: Record<number, LeagueId> = { 1500: 'great', 2500: 'ultra', 10000: 'master' };
const typeSwatch = (types: string[]) => types.map((t) => `var(--type-${t})`);
const PALETTES: Record<string, string[]> = {
  'mega-great': ['var(--lg-great)', ...MEGA], 'mega-ultra': ['var(--lg-ultra-accent)', ...MEGA],
  'mega-master': ['var(--lg-master)', ...MEGA], 'laic-2027': ['#2aa7a0', '#f2b630'],
  'battlefrontier-spectral': typeSwatch(['bug', 'ghost', 'ice', 'poison', 'psychic']),
  'battlefrontier-cauldron': typeSwatch(['bug', 'dark', 'fairy', 'ghost', 'poison']),
};

/**
 * PvPoke's dropdown order: the three leagues, then every cup in `cup-pools.json` (`npm run cups`). A cup's population
 * is exactly what PvPoke ranks in it, so it starts from everything buildable (Megas too) and keeps only those ids.
 */
export const PRESET_FORMATS: PresetFormat[] = [
  preset('great', 'Great League', 'great'),
  preset('ultra', 'Ultra League', 'ultra'),
  preset('master', 'Master League', 'master'),
  ...(CUP_POOLS as { cup: string; cp: number; title: string; ids: string[] }[]).map((c) => {
    const key = KEYS[`${c.cup}-${c.cp}`] ?? c.cup;
    return preset(key, c.title, BASE[c.cp], { every: true, include: { ids: c.ids } }, PALETTES[key]);
  }),
];

/** The plain leagues are the league tabs; every other preset is a limited cup. */
export const LIMITED_CUPS = PRESET_FORMATS.filter((p) => p.key !== p.base);

const legalCache = new Map<string, Set<string>>();
/** Refs a limited cup allows (the same resolution a challenge validates against); null for no cup. */
export function cupLegal(key: string | null): Set<string> | null {
  const p = key && LIMITED_CUPS.find((c) => c.key === key);
  if (!p) return null;
  let s = legalCache.get(p.key);
  if (!s) legalCache.set(p.key, (s = new Set(resolvePool(p.format).legal)));
  return s;
}

/** GBL is three; Show 6 is a roster of six from which three are brought to each battle. */
export const SHOW_6 = 6;
export function withTeamSize(format: Format, size: 3 | 6): Format {
  const { bring: _bring, ...rest } = format.composition;
  return { ...format, composition: size === SHOW_6 ? { ...rest, size, bring: 3 } : { ...rest, size } };
}

/**
 * The saved-format version to challenge on for a cup or a one-off variant of your own format: your copy if one with
 * identical rules exists, otherwise a new one saved now. Matched by rules hash, not name, so renaming or re-saving
 * a copy never forks it.
 */
export async function versionFor(p: { name: string; format: Format }, mine: readonly SavedFormat[]): Promise<string> {
  const hash = await rulesHash(p.format);
  const have = mine.find((f) => f.rulesHash === hash);
  if (have) return have.versionId;
  await saveServerFormat({ name: p.name, format: p.format });
  const made = (await listServerFormats()).find((f) => f.rulesHash === hash);
  if (!made) throw new Error(`could not save ${p.name} to your formats`);
  return made.versionId;
}
