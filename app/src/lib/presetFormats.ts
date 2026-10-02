import { resolvePool } from '../rules/pool';
import { rulesHash, RULES_SCHEMA, type Format } from '../rules';
import type { LeagueId } from './types';
import { listServerFormats, saveServerFormat, type SavedFormat } from './saves';

/**
 * The cups in PvPoke's format dropdown, written the way PvPoke writes them (an include list and an exclude list of
 * types, tags and ids) so a changed cup can be pasted in. `toFormat` turns one into rules. Nobody has to save these:
 * choosing one in a challenge saves it to your own formats the first time, and reuses that copy after.
 *
 * `every` cups (the Mega ones, and Battle Frontier Master) draw from every species buildable under the cap, Megas
 * included, not just the ranked ones. Their include lists are turned into one deny of everything outside them,
 * since the pool already starts full. Retro's "no Megas" needs no clause in a ranked cup (no Mega is ranked); a
 * bare `mega` selector would also match Meganium.
 */
export interface Cup {
  /** Start from everything buildable, Megas too, instead of the ranked league. */
  every?: boolean;
  include?: { types?: string[]; ids?: string[] };
  exclude?: { types?: string[]; ids?: string[]; tags?: string[] };
}
export interface PresetFormat {
  key: string; name: string; base: LeagueId; cup: Cup; format: Format;
  /** Colours for a cup that is not defined by types (the Mega and retro cups); types, then the league, otherwise. */
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

const ORDER = ['great', 'ultra', 'master', 'mega-great', 'mega-ultra', 'mega-master', 'mega-color', 'retro', 'laic-2027',
  'battlefrontier-spectral', 'battlefrontier-cauldron', 'battlefrontier-master'];

/** PvPoke's dropdown order. */
export const PRESET_FORMATS: PresetFormat[] = ([
  preset('great', 'Great League', 'great'),
  preset('ultra', 'Ultra League', 'ultra'),
  preset('master', 'Master League', 'master'),
  preset('retro', 'Retro Cup', 'great', { exclude: { types: ['dark', 'fairy', 'steel'] } }, ['#d9822b', '#7a4fa6']),
  preset('battlefrontier-spectral', 'Battle Frontier (Spectral)', 'great', {
    include: { types: ['bug', 'ghost', 'ice', 'poison', 'psychic'] },
    exclude: {
      types: ['dark', 'normal', 'rock', 'steel'],
      tags: ['shadow'],
      ids: ['annihilape', 'araquanid', 'armarouge', 'clodsire', 'corsola_galarian', 'dusclops', 'dusknoir', 'frillish', 'golett',
        'golurk', 'jellicent', 'lapras', 'marowak_alolan', 'mimikyu', 'sealeo', 'spidops', 'toxapex', 'toxtricity', 'typhlosion_hisuian', 'walrein'],
    },
  }),
  preset('battlefrontier-cauldron', 'Battle Frontier (Cauldron)', 'ultra', {
    include: {
      types: ['bug', 'dark', 'fairy', 'ghost', 'poison'],
      ids: ['blaziken', 'blaziken_shadow', 'camerupt', 'camerupt_shadow', 'charizard', 'charizard_shadow', 'delphox', 'delphox_shadow',
        'greedent', 'ninetales', 'ninetales_shadow', 'rapidash', 'rapidash_shadow', 'reshiram', 'reshiram_shadow', 'samurott',
        'samurott_shadow', 'seaking', 'sandslash', 'sandslash_shadow', 'talonflame', 'talonflame_shadow', 'turtonator', 'typhlosion',
        'typhlosion_shadow', 'ursaluna', 'ursaluna_shadow'],
    },
    exclude: { ids: ['crustle', 'forretress', 'guzzlord', 'kingambit', 'mimikyu', 'nidoqueen', 'tentacruel', 'tinkaton'] },
  }),
  preset('mega-great', 'Mega Great League', 'great', {
    every: true,
    exclude: { ids: ['mewtwo_mega_x', 'mewtwo_mega_y', 'kyogre_primal', 'groudon_primal', 'rayquaza_mega'] },
  }, ['var(--lg-great)', ...MEGA]),
  preset('mega-ultra', 'Mega Ultra League', 'ultra', { every: true }, ['var(--lg-ultra-accent)', ...MEGA]),
  preset('mega-master', 'Mega Master League', 'master', { every: true }, ['var(--lg-master)', ...MEGA]),
  preset('mega-color', 'Mega Color Cup', 'great', { every: true, include: { types: ['fire', 'water', 'grass', 'electric'] } }),
  preset('laic-2027', 'LAIC 2027 Championship Series Cup', 'great', {
    every: true,
    exclude: {
      types: ['dark', 'fairy', 'fire', 'steel'],
      tags: ['legendary', 'mythical', 'ultrabeast'],
      ids: ['altaria', 'annihilape', 'araquanid', 'chansey', 'clodsire', 'corsola_galarian', 'dusclops', 'furret', 'jellicent', 'kingdra',
        'medicham', 'oranguru', 'snorlax', 'wobbuffet', 'sableye_mega'],
    },
  }, ['#2aa7a0', '#f2b630']),
  preset('battlefrontier-master', 'Battle Frontier (Master)', 'master', {
    every: true,
    exclude: {
      ids: ['rayquaza_mega', 'groudon_primal', 'kyogre_primal', 'metagross_mega', 'heracross_mega', 'delphox_mega', 'dragonite_mega',
        'tyranitar_mega', 'salamence_mega', 'garchomp_mega', 'mewtwo_mega_y', 'mewtwo_mega_x', 'gyarados_mega', 'greninja_mega', 'chesnaught_mega'],
    },
  }),
] as PresetFormat[]).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

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
