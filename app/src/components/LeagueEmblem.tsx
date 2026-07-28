import type { LeagueId } from '../lib/types';

/**
 * The three league emblems, drawn rather than fetched.
 *
 * Each is the same construction — a downward triangle with a silver rim, a
 * Poké Ball disc in the upper left, and diagonal stripes — differing only in
 * palette and stripe count. Authoring them as one parameterised SVG keeps the
 * three genuinely consistent, which a set of hand-traced files would not be,
 * and avoids shipping three more binaries for a shape this simple.
 *
 * Stripe count rises with the CP cap (1, 2, 3), so the tiers read as a
 * progression even before you register the colour.
 */

interface Spec {
  field: string;
  fieldDark: string;
  stripe: string;
  stripes: number;
}

const SPECS: Record<LeagueId, Spec> = {
  // Great Ball: blue shell, single red band.
  great: { field: '#2f56b5', fieldDark: '#1d3a86', stripe: '#e0402f', stripes: 1 },
  // Ultra Ball: black shell, gold bands.
  ultra: { field: '#2b2b2f', fieldDark: '#141417', stripe: '#f0c034', stripes: 2 },
  // Master Ball: deep violet shell, magenta bands.
  master: { field: '#40217a', fieldDark: '#24124a', stripe: '#d94fb4', stripes: 3 },
};

export function LeagueEmblem({ league, size = 30 }: { league: LeagueId; size?: number }) {
  const s = SPECS[league];
  const clip = `lg-clip-${league}`;

  // Stripes run parallel to the triangle's right edge, spread across the face.
  const bands = Array.from({ length: s.stripes }, (_, i) => {
    const offset = 14 + i * 17;
    return (
      <path
        key={i}
        d={`M ${28 + offset} 6 L ${40 + offset} 6 L ${offset - 4} 96 L ${offset - 16} 96 Z`}
        fill={s.stripe}
        opacity={0.95 - i * 0.12}
      />
    );
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 96"
      aria-hidden
      focusable="false"
      style={{ display: 'block', flex: 'none', overflow: 'visible' }}
    >
      <defs>
        <clipPath id={clip}>
          <polygon points="50,84 10,9 90,9" />
        </clipPath>
      </defs>

      {/* Silver rim, then the darker shell beneath it. */}
      <polygon points="50,94 1,2 99,2" fill="#e8ebef" />
      <polygon points="50,88 6,6 94,6" fill={s.fieldDark} />
      <polygon points="50,84 10,9 90,9" fill={s.field} />

      <g clipPath={`url(#${clip})`}>{bands}</g>

      {/* Poké Ball disc, upper left. */}
      <circle cx="29" cy="24" r="10.5" fill="#f4f6f8" />
      <circle cx="29" cy="24" r="10.5" fill="none" stroke={s.fieldDark} strokeWidth="1.4" />
      <path d="M18.5 24h21" stroke={s.fieldDark} strokeWidth="2.2" />
      <circle cx="29" cy="24" r="3.6" fill="#f4f6f8" stroke={s.fieldDark} strokeWidth="2.2" />
    </svg>
  );
}
