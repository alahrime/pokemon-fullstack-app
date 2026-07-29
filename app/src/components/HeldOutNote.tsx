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
export function HeldOutNote({ compact = false }: { compact?: boolean }) {
  const names = [...UNSIMULATED_IDS].map((id) => SPECIES_BY_ID.get(id)?.name ?? id);
  if (!names.length) return null;

  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

  return (
    <p className={`held-out-note${compact ? ' is-compact' : ''}`}>
      <span className="held-out-mark" aria-hidden>
        ⌁
      </span>
      <span>
        <strong>{list}</strong> {names.length > 1 ? 'are' : 'is'} temporarily unavailable.{' '}
        {compact ? null : (
          <>
            Each has a battle mechanic the simulator does not model yet — a built-in shield, a form
            change, a stance change — so any number shown for {names.length > 1 ? 'them' : 'it'}{' '}
            would be wrong rather than merely imprecise.{' '}
          </>
        )}
        Returning once those are implemented.
      </span>
    </p>
  );
}
