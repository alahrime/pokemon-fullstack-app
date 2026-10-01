import { rulesHash, RULES_SCHEMA, type Format } from '../rules';
import type { LeagueId } from './types';
import { listServerFormats, saveServerFormat, type SavedFormat } from './saves';

/**
 * The cups in PvPoke's format dropdown that this app can represent, written the way PvPoke writes them
 * (an include list and an exclude list of types, tags and ids) so a changed cup can be pasted in. `toFormat`
 * turns one into rules. Nobody has to save these: choosing one in a challenge saves it to your own formats the
 * first time, and reuses that copy after.
 *
 * Not here: Mega Great / Ultra / Master, Mega Color Cup, LAIC 2027. Their pools are made of Megas, and no Mega
 * is in any league's pool (no Mega is in a ranking), so rules could not express them. Battle Frontier (Master)
 * bans only Megas, which are already absent, so it is the plain Master pool under its own name; likewise Retro's
 * "no Megas" needs no clause (a bare `mega` selector would also match Meganium).
 */
export interface Cup {
  include?: { types?: string[]; ids?: string[] };
  exclude?: { types?: string[]; ids?: string[]; tags?: string[] };
}
export interface PresetFormat { key: string; name: string; base: LeagueId; cup: Cup; format: Format }

const ref = (ids: string[]) => ids.map((i) => `=${i}`).join(',');

export function toFormat(base: LeagueId, cup: Cup): Format {
  const pool: Format['pool'] = [];
  const add = (effect: 'allow' | 'deny', select: string) => { if (select) pool.push({ effect, select }); };
  add('allow', (cup.include?.types ?? []).join(','));
  add('allow', ref(cup.include?.ids ?? []));
  add('deny', (cup.exclude?.types ?? []).join(','));
  add('deny', (cup.exclude?.tags ?? []).join(','));
  add('deny', ref(cup.exclude?.ids ?? []));
  return {
    schema: RULES_SCHEMA,
    base,
    start: cup.include && (cup.include.types?.length || cup.include.ids?.length) ? 'empty' : 'league',
    pool,
    composition: { size: 3 },
    selection: { mode: 'open' },
  };
}

const preset = (key: string, name: string, base: LeagueId, cup: Cup = {}): PresetFormat =>
  ({ key, name, base, cup, format: toFormat(base, cup) });

export const PRESET_FORMATS: PresetFormat[] = [
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
  preset('battlefrontier-master', 'Battle Frontier (Master)', 'master'),
];

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
