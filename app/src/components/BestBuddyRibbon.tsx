/**
 * Best Buddy ribbon.
 *
 * Shown when a spread can only be reached with a Best Buddy boost — the +1
 * level that puts 50.5 and 51 in range. It is a cost marker, not decoration:
 * a spread needing it is gated behind a buddy walk, so it belongs next to the
 * Pokemon it qualifies rather than in a legend somewhere.
 *
 * Inline SVG rather than an image so it inherits currentColor sizing, stays
 * crisp at the ~14px it renders at on an opponent cell, and costs no request.
 */
export function BestBuddyRibbon({ size = 16, title = 'Best Buddy required' }: { size?: number; title?: string }) {
  // Below ~18px the rosette points collapse into an orange smudge and swallow
  // the heart, which is the only part carrying meaning. Small renders drop the
  // points and keep the medal, scaled up to fill the same footprint — the same
  // trade the Shadow aura makes at small sizes.
  const detailed = size >= 18;
  const r = detailed ? 12.5 : 22;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <title>{title}</title>
      {/* Six-point rosette behind the medal: two rotated copies of the same
          ribbon shape, the muted pink pair first so the orange reads on top. */}
      <g style={{ display: detailed ? undefined : 'none' }}>
        {[90, 150, 30].map((deg, i) => (
          <rect
            key={deg}
            x="20.5"
            y="1.5"
            width="7"
            height="45"
            rx="1.5"
            fill={i === 0 ? '#c9697f' : '#c9697f'}
            transform={`rotate(${deg} 24 24)`}
          />
        ))}
        {[0, 60, 120].map((deg) => (
          <path
            key={deg}
            d="M17.5 2 h13 l-3.2 9.5 3.2 9.5 h-13 l3.2 -9.5 z"
            fill="#e8763a"
            transform={`rotate(${deg} 24 24)`}
          />
        ))}
        {[180, 240, 300].map((deg) => (
          <path
            key={deg}
            d="M17.5 2 h13 l-3.2 9.5 3.2 9.5 h-13 l3.2 -9.5 z"
            fill="#e8763a"
            transform={`rotate(${deg} 24 24)`}
          />
        ))}
      </g>

      {/* Medal */}
      <circle cx="24" cy="24" r={r} fill="#8a5a1e" />
      <circle cx="24" cy="24" r={r - 1} fill="url(#bb-gold)" />

      {/* Heart, drawn as an outline the way the badge does. Scaled about the
          centre so the small variant keeps the medal's proportions. */}
      <g transform={detailed ? undefined : `translate(24 24) scale(${r / 12.5}) translate(-24 -24)`}>
        <path
          d="M24 31.2 c-4.6 -3.1 -7.2 -5.6 -7.2 -8.6 a3.9 3.9 0 0 1 7.2 -2.1 a3.9 3.9 0 0 1 7.2 2.1 c0 3 -2.6 5.5 -7.2 8.6 z"
          fill="none"
          stroke="#8a5a1e"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
      </g>

      <defs>
        <linearGradient id="bb-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe066" />
          <stop offset="0.5" stopColor="#f5c518" />
          <stop offset="1" stopColor="#e0a800" />
        </linearGradient>
      </defs>
    </svg>
  );
}
