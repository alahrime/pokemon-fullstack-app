import { SPECIES_BY_ID, UNSIMULATED_IDS } from '../lib/data';

/**
 * Says which Pokemon are missing, and that they are coming back.
 *
 * Without it their absence is indistinguishable from a data bug — Mimikyu
 * ranks 1st in both Great and Ultra, so someone searching for it and finding
 * nothing has every reason to assume the roster is broken rather than that we
 * left it out on purpose.
 *
 * A legend, not a paragraph: a boxed swatch of the shape a chart legend uses,
 * sized to the names it carries and nothing more. There was a four-line prose
 * version alongside it, which is what the rankings and the report used to
 * render — a screenful of caveat above the content it was a caveat about. The
 * full explanation lives in the `title`, one hover away, and the names alone
 * carry the point.
 *
 * Reads UNSIMULATED_IDS directly, so it lists whatever is actually held out
 * and renders nothing once the set is empty. There is no second list to keep
 * in step, and restoring the species removes this note on its own.
 */
export function HeldOutNote({
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
  only?: readonly string[];
}) {
  const ids = only ? only.filter((id) => UNSIMULATED_IDS.has(id)) : [...UNSIMULATED_IDS];
  const names = ids.map((id) => SPECIES_BY_ID.get(id)?.name ?? id);
  if (!names.length) return null;

  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

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

