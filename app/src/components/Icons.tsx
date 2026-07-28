/**
 * Small inline glyphs, authored here rather than pulled from an icon set.
 *
 * Three icons don't justify a dependency, and inline SVG inherits currentColor
 * so they tint with whatever control they sit in — which the segmented buttons
 * need, since the active state inverts.
 *
 * All are drawn on a 24x24 grid with a 1.75 stroke so they sit consistently
 * next to 12-13px label text.
 */

type IconProps = { size?: number; style?: React.CSSProperties };

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
}

/** Rank — overall standing within the 4096. */
export function TrophyIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 4" />
      <path d="M17 6h2.5a2.5 2.5 0 0 1-2.5 4" />
      <path d="M12 14v3" />
      <path d="M9 20h6" />
      <path d="M10 17h4l.6 3h-5.2l.6-3Z" />
    </svg>
  );
}

/** Breakpoint — damage you deal. */
export function SwordIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <path d="M20 3v4.5L10.5 17 7 13.5 16.5 4H20Z" />
      <path d="m8.75 15.25-2.5 2.5" />
      <path d="M6.5 15.5 3 19l2 2 3.5-3.5" />
      <path d="m14 10 3.5 3.5" />
    </svg>
  );
}

/** 4096 heatmap — the attack x defense grid. */
export function GridIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </svg>
  );
}

/** Damage ruler — banded scale with tick marks. */
export function RulerIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </svg>
  );
}

/** Threshold table — rows of values. */
export function TableIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10" />
    </svg>
  );
}

/** Matchup flips — a result turning over. */
export function FlipIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <path d="M4 8h11a4 4 0 0 1 0 8H9" />
      <path d="m7 5-3 3 3 3" />
      <path d="m11.5 13-2.5 3 2.5 3" />
    </svg>
  );
}

/** Bulkpoint — damage you take. */
export function ShieldIcon({ size = 14, style }: IconProps) {
  return (
    <svg {...svgProps(size)} style={{ display: 'block', flex: 'none', ...style }}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3Z" />
    </svg>
  );
}
