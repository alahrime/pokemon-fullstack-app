import { SPECIES_BY_ID, UNSIMULATED_IDS } from '../lib/data';

/**
 * Says which Pokemon are missing, and that they are coming back.
 *
 * Without it their absence is indistinguishable from a data bug — Mimikyu
 * ranks 1st in both Great and Ultra, so someone searching for it and finding
 * nothing has every reason to assume the roster is broken rather than that we
 * left it out on purpose.
 *
 * Reads UNSIMULATED_IDS directly, so it lists whatever is actually held out
 * and renders nothing once the set is empty. There is no second list to keep
 * in step, and restoring the species removes this note on its own.
 */
export function HeldOutNote({
  compact = false,
  /**
   * Restrict the note to specific held-out species.
   *
   * The search box passes the ones the current query actually matched. Without
   * it the note fired on every keystroke of every search, so looking up
   * Altaria — which is present, ranked, and matched exactly — still produced a
   * paragraph about Mimikyu, Morpeko and Aegislash. That reads as stray text,
   * and it trains people to ignore the one notice that matters on the day
   * their search really does come back empty.
   */
  only,
}: {
  compact?: boolean;
  only?: readonly string[];
}) {
  const ids = only ? only.filter((id) => UNSIMULATED_IDS.has(id)) : [...UNSIMULATED_IDS];
  const names = ids.map((id) => SPECIES_BY_ID.get(id)?.name ?? id);
  if (!names.length) return null;

  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

  // Compact is a legend, not a paragraph: a boxed swatch of the same shape a
  // chart legend uses, sized to the names it carries and nothing more. The
  // full explanation lives in the title attribute, where it is one hover away
  // rather than four lines of prose in the layout.
  if (compact) {
    return (
      <p
        className="held-out-legend"
        title={`${list} ${names.length > 1 ? 'are' : 'is'} temporarily unavailable. Each has a battle mechanic the simulator does not model yet — a built-in shield, a form change, a stance change — so any number shown ${names.length > 1 ? 'for them' : 'for it'} would be wrong rather than merely imprecise. Returning once ${names.length > 1 ? 'those are' : 'that is'} implemented.`}
      >
        <span className="held-out-legend-mark" aria-hidden>
          ⌁
        </span>
        <span className="held-out-legend-body">
          <span className="held-out-legend-head">Not simulated</span>
          {/* Bare species names in the legend. The parenthesised form — the
              "(Shield)" of Aegislash, the "(Full Belly)" of Morpeko — is the
              only thing that made this overflow, and it distinguishes forms
              that are all held out anyway. The full names stay in the title. */}
          <span className="held-out-legend-names">
            {names.map((n) => n.replace(/\s*\([^)]*\)/g, '')).join(' · ')}
          </span>
        </span>
      </p>
    );
  }

  return (
    <p className="held-out-note">
      <span className="held-out-mark" aria-hidden>
        ⌁
      </span>
      <span>
        <strong>{list}</strong> {names.length > 1 ? 'are' : 'is'} temporarily unavailable. Each has a
        battle mechanic the simulator does not model yet — a built-in shield, a form change, a
        stance change — so any number shown for {names.length > 1 ? 'them' : 'it'} would be wrong
        rather than merely imprecise.{' '}
        {names.length > 1 ? 'Returning once those are implemented.' : 'Returning once that is implemented.'}
      </span>
    </p>
  );
}
