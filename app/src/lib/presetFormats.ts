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
export interface PresetFormat { key: string; name: string; base: LeagueId; cup: Cup; format: Format }

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

const preset = (key: string, name: string, base: LeagueId, cup: Cup = {}): PresetFormat =>
  ({ key, name, base, cup, format: toFormat(base, cup) });

const ORDER = ['great', 'ultra', 'master', 'mega-great', 'mega-ultra', 'mega-master', 'mega-color', 'retro', 'laic-2027',
  'battlefrontier-spectral', 'battlefrontier-cauldron', 'battlefrontier-master'];

/** PvPoke's dropdown order. */
export const PRESET_FORMATS: PresetFormat[] = ([
  preset('great', 'Great League', 'great'),
  preset('ultra', 'Ultra League', 'ultra'),
  preset('master', 'Master League', 'master'),
  preset('retro', 'Retro Cup', 'great', { exclude: { types: ['dark', 'fairy', 'steel'] } }),
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
  }),
  preset('mega-ultra', 'Mega Ultra League', 'ultra', { every: true }),
  preset('mega-master', 'Mega Master League', 'master', { every: true }),
  preset('mega-color', 'Mega Color Cup', 'great', { every: true, include: { types: ['fire', 'water', 'grass', 'electric'] } }),
  preset('laic-2027', 'LAIC 2027 Championship Series Cup', 'great', {
    every: true,
    exclude: {
      types: ['dark', 'fairy', 'fire', 'steel'],
      tags: ['legendary', 'mythical', 'ultrabeast'],
      ids: ['altaria', 'annihilape', 'araquanid', 'chansey', 'clodsire', 'corsola_galarian', 'dusclops', 'furret', 'jellicent', 'kingdra',
        'medicham', 'oranguru', 'snorlax', 'wobbuffet', 'sableye_mega'],
    },
  }),
  preset('battlefrontier-master', 'Battle Frontier (Master)', 'master', {
    every: true,
    exclude: {
      ids: ['rayquaza_mega', 'groudon_primal', 'kyogre_primal', 'metagross_mega', 'heracross_mega', 'delphox_mega', 'dragonite_mega',
        'tyranitar_mega', 'salamence_mega', 'garchomp_mega', 'mewtwo_mega_y', 'mewtwo_mega_x', 'gyarados_mega', 'greninja_mega', 'chesnaught_mega'],
    },
  }),
] as PresetFormat[]).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

/**
 * The saved-format version to challenge on for a preset: your copy if one with identical rules exists, otherwise
 * a new one saved now. Matched by rules hash, not name, so renaming or re-saving a copy never forks it.
 */
export async function versionFor(p: PresetFormat, mine: readonly SavedFormat[]): Promise<string> {
  const hash = await rulesHash(p.format);
  const have = mine.find((f) => f.rulesHash === hash);
  if (have) return have.versionId;
  await saveServerFormat({ name: p.name, format: p.format });
  const made = (await listServerFormats()).find((f) => f.rulesHash === hash);
  if (!made) throw new Error(`could not save ${p.name} to your formats`);
  return made.versionId;
}
