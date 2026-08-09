import { BestBuddyRibbon } from './BestBuddyRibbon';

/**
 * Off / Include selector for the Best Buddy boost.
 *
 * Mirrors FormToggle rather than the accent SegGroup, for the same reason:
 * this describes the Pokemon, not the view. It reads as a property you turn on
 * for both sides of the matchup, which is what it is — a Best Buddy opponent
 * is a real opponent.
 *
 * Disabled when the species cannot exceed level 50 under the cap, where the
 * boost is inert. Showing it greyed rather than hiding it answers the question
 * "would Best Buddy help here?" with a visible no.
 */
export function BestBuddyToggle({
  on,
  eligible,
  onChange,
}: {
  on: boolean;
  eligible: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="form-toggle" role="group" aria-label="Best Buddy">
      <button
        type="button"
        className={`form-opt form-opt-normal${!on || !eligible ? ' is-active' : ''}`}
        aria-pressed={!on || !eligible}
        onClick={() => onChange(false)}
      >
        Level 50
      </button>
      <button
        type="button"
        className={`form-opt form-opt-buddy flex items-center justify-center gap-[5px]${on && eligible ? ' is-active' : ''}`}
        aria-pressed={on && eligible}
        disabled={!eligible}
        onClick={() => onChange(true)}
        title={eligible ? 'Include levels 50.5 and 51' : 'No spread here can exceed level 50'}
      >
        <BestBuddyRibbon size={16} title="" detail />
        Best Buddy
      </button>
    </div>
  );
}
