/**
 * Pokemon GO type effectiveness.
 *
 * GO does not use the main-series multipliers. Effectiveness steps in powers
 * of 0.625: a resistance is x0.625, a main-series immunity is x0.625^2
 * (0.390625, shown as 0.39), and a dual type resisting twice lands on
 * x0.625^3 (0.244). Super-effective is x1.6, and a dual type weak on both
 * halves takes x1.6^2 = 2.56. Nothing in GO deals zero damage.
 *
 * Stored as attacker -> { defender: multiplier }, listing only the entries
 * that are not neutral.
 */

const SE = 1.6;
const NVE = 0.625;
/** Main-series immunity, which GO models as a double resistance. */
const IMM = 0.625 * 0.625;

type Chart = Record<string, Record<string, number>>;

const CHART: Chart = {
  normal: { rock: NVE, ghost: IMM, steel: NVE },
  fire: { fire: NVE, water: NVE, grass: SE, ice: SE, bug: SE, rock: NVE, dragon: NVE, steel: SE },
  water: { fire: SE, water: NVE, grass: NVE, ground: SE, rock: SE, dragon: NVE },
  electric: { water: SE, electric: NVE, grass: NVE, ground: IMM, flying: SE, dragon: NVE },
  grass: {
    fire: NVE, water: SE, grass: NVE, poison: NVE, ground: SE, flying: NVE,
    bug: NVE, rock: SE, dragon: NVE, steel: NVE,
  },
  ice: { fire: NVE, water: NVE, grass: SE, ice: NVE, ground: SE, flying: SE, dragon: SE, steel: NVE },
  fighting: {
    normal: SE, ice: SE, poison: NVE, flying: NVE, psychic: NVE, bug: NVE,
    rock: SE, ghost: IMM, dark: SE, steel: SE, fairy: NVE,
  },
  poison: { grass: SE, poison: NVE, ground: NVE, rock: NVE, ghost: NVE, steel: IMM, fairy: SE },
  ground: { fire: SE, electric: SE, grass: NVE, poison: SE, flying: IMM, bug: NVE, rock: SE, steel: SE },
  flying: { electric: NVE, grass: SE, fighting: SE, bug: SE, rock: NVE, steel: NVE },
  psychic: { fighting: SE, poison: SE, psychic: NVE, dark: IMM, steel: NVE },
  bug: {
    fire: NVE, grass: SE, fighting: NVE, poison: NVE, flying: NVE, psychic: SE,
    ghost: NVE, dark: SE, steel: NVE, fairy: NVE,
  },
  rock: { fire: SE, ice: SE, fighting: NVE, ground: NVE, flying: SE, bug: SE, steel: NVE },
  ghost: { normal: IMM, psychic: SE, ghost: SE, dark: NVE },
  dragon: { dragon: SE, steel: NVE, fairy: IMM },
  dark: { fighting: NVE, psychic: SE, ghost: SE, dark: NVE, fairy: NVE },
  steel: { fire: NVE, water: NVE, electric: NVE, ice: SE, rock: SE, steel: NVE, fairy: SE },
  fairy: { fire: NVE, fighting: SE, poison: NVE, dragon: SE, dark: SE, steel: NVE },
};

/**
 * Combined multiplier for one attacking type against a defender's typing.
 *
 * Dual types multiply, which is where 2.56 and 0.244 come from — they are not
 * separate rules, just both halves applying.
 */
export function typeEffectiveness(moveType: string, defenderTypes: readonly string[]): number {
  const row = CHART[moveType?.toLowerCase()];
  if (!row) return 1;
  let mult = 1;
  for (const t of defenderTypes) {
    const m = row[t?.toLowerCase()];
    if (m !== undefined) mult *= m;
  }
  return mult;
}
