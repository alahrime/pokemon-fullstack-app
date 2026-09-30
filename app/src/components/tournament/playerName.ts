/** A readable label for a player id; never the raw uuid. */
export const playerName = (names: ReadonlyMap<string, string>, id: string): string => names.get(id) ?? 'Unknown player';
