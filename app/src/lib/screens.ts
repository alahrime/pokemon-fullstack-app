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
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    kicker: 'The method',
    glyph: '◎',
    hue: 'var(--type-steel)',
    blurb: 'Two rankings of the same data, and how much either can actually say.',
  },
  {
    id: 'moves',
    label: 'Moves',
    kicker: 'The catalogue',
    glyph: '⌁',
    hue: 'var(--type-electric)',
    blurb: 'Every fast and charge move, with the figures that rank them.',
  },
  {
    id: 'formats',
    label: 'Formats',
    kicker: 'Rulesets',
    glyph: '⌘',
    hue: 'var(--type-dark)',
    blurb: 'Author a format clause by clause, and watch the legal pool move as you type.',
  },
  {
    id: 'matchmaking',
    label: 'Matches',
    kicker: 'Opponents',
    // Not --type-fighting: the Battle screen already carries it, and every
    // screen needs a distinct hue for colour to identify a section (see
    // src/lib/__tests__/screens.test.ts). Ghost fits a blind queue anyway —
    // the opponent is unseen until the pairing lands.
    glyph: '⚔',
    hue: 'var(--type-ghost)',
    blurb: 'Queue for a blind match, browse an open offer, or schedule one for later.',
  },
  {
    id: 'match',
    label: 'Match',
    kicker: 'Report',
    // Not --type-fighting: the Battle screen already carries it, and every
    // screen needs a distinct hue (see src/lib/__tests__/screens.test.ts).
    // Ground fits the contrast with Battle deliberately: Battle prices a
    // simulated fight, and this screen is about the real one — grounded in
    // whatever actually happened in Pokémon GO, reported back and settled.
    glyph: '◭',
    hue: 'var(--type-ground)',
    blurb: 'Report the rounds you played and see the adjudicated result.',
  },
  {
    id: 'account',
    label: 'Account',
    kicker: 'You',
    glyph: '◉',
    hue: 'var(--type-normal)',
    blurb: 'Sign in, and choose the name the rest of Paragon will know you by.',
  },
];

export const HUE_OF: Record<string, string> = Object.fromEntries(
  SCREEN_DEFS.map((s) => [s.id, s.hue]),
);
