/**
 * The 18 Pokémon types and where their icons live.
 *
 * Kept out of TypeBadge.tsx so that file only exports components — mixing
 * constants and components in one module breaks React Fast Refresh.
 */

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

const KNOWN = new Set<string>(POKEMON_TYPES);

export function isPokemonType(t: string): boolean {
  return KNOWN.has(t.toLowerCase());
}

/**
 * Vendored from partywhale/pokemon-type-icons (MIT); see
 * public/type-icons/README.md. Served as a static asset rather than bundled so
 * a checkout without the icons still builds.
 */
export function typeIconUrl(type: string): string {
  return `${import.meta.env.BASE_URL}type-icons/${type.toLowerCase()}.svg`;
}

/**
 * The custom property a move chip is tinted from.
 *
 * Returns nothing for a type the palette does not know, so the chip falls back
 * to whatever its stylesheet already used rather than resolving `var(--type-)`
 * to nothing and losing its rail entirely.
 */
export function moveTypeStyle(type: string): Record<string, string> {
  return isPokemonType(type) ? { '--move-type': `var(--type-${type.toLowerCase()})` } : {};
}
