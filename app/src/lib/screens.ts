import type { Screen } from '../state/AppState';

/**
 * The screens, and the identity each one carries.
 *
 * One table feeding both the nav tabs and the landing page's route cards. They
 * described the same six destinations in two places before this, which is how
 * a tab and its card end up disagreeing about what a section is called — and
 * it made "give each screen a colour" a change in two files that had to be
 * kept in step by hand.
 *
 * Hues are type colours, so the palette stays the one the rest of the app
 * already uses rather than a second scheme invented for navigation.
 */
export interface ScreenDef {
  id: Screen;
  label: string;
  /** Category word, scannable before the prose is read. */
  kicker: string;
  blurb: string;
  glyph: string;
  hue: string;
}

export const SCREEN_DEFS: ScreenDef[] = [
  {
    id: 'report',
    label: 'Report',
    kicker: 'One Pokémon',
    glyph: '◈',
    hue: 'var(--type-dragon)',
    blurb: 'Every spread, against the field it actually meets.',
  },
  {
    id: 'battle',
    label: 'Battle',
    kicker: 'Head to head',
    glyph: '⚔',
    hue: 'var(--type-fighting)',
    blurb: 'Turn by turn, with shields and energy played out.',
  },
  {
    id: 'rankings',
    label: 'Rankings',
    kicker: 'The whole league',
    glyph: '▤',
    hue: 'var(--type-psychic)',
    blurb: 'Sorted by role, at every opponent-pool depth.',
  },
  {
    id: 'gbl',
    label: 'GBL Teams',
    kicker: 'Teams of three',
    glyph: '⬢',
    hue: 'var(--type-water)',
    blurb: 'Simulated as one chain, not three separate matchups.',
  },
  {
    id: 'show6',
    label: 'Show 6',
    kicker: 'Teams of six',
    glyph: '⬡',
    hue: 'var(--type-grass)',
    blurb: 'Scored as the matrix game a Show 6 really is.',
  },
  {
    id: 'cores',
    label: 'Cores',
    kicker: 'Pairs',
    glyph: '⧗',
    hue: 'var(--type-fairy)',
    blurb: 'Two that cover each other, and the third that finishes them.',
  },
];

export const HUE_OF: Record<string, string> = Object.fromEntries(
  SCREEN_DEFS.map((s) => [s.id, s.hue]),
);
