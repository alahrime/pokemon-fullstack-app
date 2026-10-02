/**
 * A property switch at instrument density: a micro-label over a short track
 * with a knob that slides.
 *
 * The report's two properties — Shadow and Best Buddy — used to be full-width
 * labelled channels, one above the other, each naming both of its states
 * ("Normal | Shadow"). That is a lot of column for two booleans, and the pair
 * of them pushed the roll and its readouts down the page. Here the label above
 * says which property, the knob says whether, and the two sit side by side in
 * the height one of them used to take.
 *
 * The wider labelled channel ({@link BestBuddyToggle}) is still right where a
 * control has room and its two states want naming — the battle screen keeps it.
 *
 * `tone` tints the engaged knob in the colour that state carries everywhere
 * else in the app: violet for Shadow, gold for Best Buddy.
 */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  tone = 'accent',
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  tone?: 'accent' | 'shadow' | 'buddy';
  title?: string;
}) {
  return (
    <div className={`sw sw-${tone}${checked ? ' is-on' : ''}`}>
      <span className="hud-label sw-label">
        <span>{label}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={title}
        disabled={disabled}
        className="sw-track"
        onClick={() => onChange(!checked)}
      >
        <span className="sw-knob" aria-hidden />
      </button>
    </div>
  );
}
