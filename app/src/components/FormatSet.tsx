import { useMemo, useState } from 'react';
import { displayName, makeRef, parseRef, speciesOf } from '../lib/data';
import { POKEMON_TYPES } from '../lib/pokemonTypes';
import { addSpecies, removeRef, resolvePool, type Format, type SpeciesScope } from '../rules';
import { Sprite } from './Sprite';
import { SpeciesSearch } from './SpeciesSearch';
import { TypeBadge } from './TypeBadge';

interface Props {
  format: Format;
  onChange: (next: Format) => void;
}

/**
 * The resolved set, grouped by type, with an X on every member.
 *
 * This is the primary way the pool is built and pruned: type chips (see
 * TypeFilterRow) add a whole type at once, and this component is where a
 * member is taken back out — one X at a time — or a single species is added
 * on its own.
 *
 * The Great pool alone is over a thousand refs. A flat grid of that many
 * sprite cards would be both unusable and slow, so members are grouped under
 * their type, collapsed, with a count; expanding one reveals its members.
 * That also mirrors how a format actually gets built: add a type, then prune
 * inside it.
 *
 * Members render as a light sprite-and-name row rather than `PokemonCard`.
 * `PokemonCard` computes a rated moveset and a rank-1 IV spread through the
 * engine (`movesFor`, `defaultSpreadFor`) for every card, even at its
 * smallest size — that is a "what would this score" computation, and this
 * screen is only ever asking "is this ref in the set." Reusing it would mean
 * running the engine over a group's whole membership just to draw a checkbox.
 */
export function FormatSet({ format, onChange }: Props) {
  const { legal } = useMemo(() => resolvePool(format), [format]);

  // Bucketed by PRIMARY type only — `speciesOf(ref).types[0]` — never every
  // type a ref has. A Pokemon can carry two types, so grouping under both
  // would double-count it across groups; the group counts would then no
  // longer sum to the set's size, which is the invariant the tests pin.
  const buckets = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ref of legal) {
      const sp = speciesOf(ref);
      if (!sp) continue;
      const t = sp.types[0];
      const arr = m.get(t);
      if (arr) arr.push(ref);
      else m.set(t, [ref]);
    }
    return m;
  }, [legal]);

  const orderedTypes = useMemo(() => POKEMON_TYPES.filter((t) => buckets.has(t)), [buckets]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (t: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // Every league-legal species id, deduped, regardless of which of its forms
  // are league-legal — the base to offer an add against. `pool: []` and
  // `start: 'league'` peel off every clause the author has written so far, so
  // this is the whole league's candidate set, not the format's current one.
  const leaguePool = useMemo(
    () => resolvePool({ ...format, pool: [], start: 'league' }).legal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format.base],
  );

  /**
   * Per species, which scopes are still worth offering.
   *
   * Not a flat "already in the set, so hide it" — that was the bug this fixed.
   * A species with only its Shadow legal still has a real gap (its Normal
   * form), and hiding the species entirely took away the only discoverable
   * way to close it — leaving just the advanced clause editor, the syntax
   * path this whole control exists to keep people off.
   *
   * Reads legality the same way `typesOn` does in edits.ts: inspecting the
   * *resolved* set rather than the raw clause list, because a species can end
   * up partially in the set through clauses that never mention it by name — a
   * type chip plus one X, say — and the resolved set is the only place that
   * shows the true, current state at a glance.
   *
   * Four states, per species:
   *   - both variants already legal        → not offered at all
   *   - neither variant legal               → 'both', 'normal', and 'shadow'
   *     (Shadow only where the species can have one)
   *   - only Normal legal                   → 'shadow' only (if it can have one)
   *   - only Shadow legal                   → 'normal' only
   *
   * A species with no Shadow form at all behaves as the first two rows
   * collapse into: fully in the set once Normal is legal, otherwise offered
   * as 'both' and 'normal' (equivalent for it, since no Shadow ref exists to
   * distinguish them).
   */
  const offeredScopes = useMemo(() => {
    const legalSet = new Set(legal);
    const m = new Map<string, SpeciesScope[]>();
    const seen = new Set<string>();
    for (const ref of leaguePool) {
      const { id } = parseRef(ref);
      if (seen.has(id)) continue;
      seen.add(id);
      const sp = speciesOf(id);
      if (!sp) continue;

      const normalLegal = legalSet.has(id);
      const shadowLegal = sp.shadowEligible && legalSet.has(makeRef(id, true));

      if (!sp.shadowEligible) {
        if (!normalLegal) m.set(id, ['both', 'normal']);
        continue;
      }
      if (normalLegal && shadowLegal) continue;
      if (normalLegal && !shadowLegal) m.set(id, ['shadow']);
      else if (!normalLegal && shadowLegal) m.set(id, ['normal']);
      else m.set(id, ['both', 'normal', 'shadow']);
    }
    return m;
  }, [leaguePool, legal]);

  const addable = useMemo(() => new Set(offeredScopes.keys()), [offeredScopes]);

  return (
    <div className="format-set">
      <AddSpecies format={format} onChange={onChange} addable={addable} offeredScopes={offeredScopes} />

      {legal.length === 0 ? (
        <p data-testid="set-empty" className="text-faint">
          The set is empty. Switch on a type above, or add one species below.
        </p>
      ) : (
        orderedTypes.map((t) => {
          const refs = buckets.get(t)!;
          const isOpen = expanded.has(t);
          return (
            <section key={t} data-testid={`set-group-${t}`} className="set-group">
              <div className="set-group-head">
                <button
                  type="button"
                  className="btn chip-btn"
                  aria-expanded={isOpen}
                  onClick={() => toggle(t)}
                >
                  <TypeBadge type={t} />
                  <span>{isOpen ? 'Hide' : 'Show'}</span>
                </button>
                <span data-testid="set-group-count" className="numeric">
                  {refs.length}
                </span>
              </div>

              {isOpen && (
                <ul className="set-members">
                  {refs.map((ref) => {
                    const sp = speciesOf(ref)!;
                    return (
                      <li key={ref} className="set-member" data-testid="set-member">
                        <Sprite sprite={sp.sprite} dex={sp.dex} size={28} shadow={parseRef(ref).shadow} />
                        <span className="set-member-name">{displayName(ref)}</span>
                        <button
                          type="button"
                          className="btn btn-sm set-remove-btn"
                          data-testid="set-remove"
                          aria-label={`Remove ${displayName(ref)}`}
                          onClick={() => onChange(removeRef(format, ref))}
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

/** A scope's label in the picker, in the order the buttons render. */
const SCOPE_LABEL: Record<SpeciesScope, string> = {
  both: 'Whole species',
  normal: 'Normal only',
  shadow: 'Shadow only',
};

/**
 * Add one species, in a chosen scope.
 *
 * Three explicit buttons rather than a single "add" — whole species, normal
 * only, Shadow only — so the precision `addSpecies`'s `SpeciesScope` offers is
 * discoverable without teaching anyone the selector syntax that backs it
 * (`&!shadow`, `&shadow`). Only the scopes `offeredScopes` names for the
 * picked species are shown: a species already fully in the set is filtered
 * out of the search entirely (see `addable`), and one partially in it offers
 * only the variant actually missing, rather than every scope regardless of
 * what is already there.
 */
function AddSpecies({
  format,
  onChange,
  addable,
  offeredScopes,
}: {
  format: Format;
  onChange: (next: Format) => void;
  addable: ReadonlySet<string>;
  offeredScopes: ReadonlyMap<string, SpeciesScope[]>;
}) {
  const [pick, setPick] = useState<string>('');
  const sp = pick ? speciesOf(pick) : undefined;
  const scopes = pick ? (offeredScopes.get(parseRef(pick).id) ?? []) : [];

  const commit = (scope: SpeciesScope) => {
    if (!pick) return;
    onChange(addSpecies(format, pick, scope));
    setPick('');
  };

  return (
    <div className="add-species" data-testid="add-species">
      <SpeciesSearch
        id="format-add-species"
        value=""
        onChange={setPick}
        startEmpty
        placeholder="Add a species…"
        restrictTo={addable}
      />
      {sp && pick && scopes.length > 0 && (
        <div className="add-species-scopes" role="group" aria-label={`Add ${displayName(pick)}`}>
          <span className="add-species-name">{displayName(pick)}</span>
          {scopes.map((scope) => (
            <button
              key={scope}
              type="button"
              className="btn chip-btn"
              data-testid={`add-species-${scope}`}
              onClick={() => commit(scope)}
            >
              {SCOPE_LABEL[scope]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
