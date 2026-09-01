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
  const { legal, decidedBy } = useMemo(() => resolvePool(format), [format]);

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

  /**
   * Per species, which scopes are still worth offering.
   *
   * Reads legality off the *resolved* set (`resolvePool(format).legal`), not
   * the raw clause list — the opposite of how `typesOn` in edits.ts reads a
   * chip's state. A species can end up partially in the set through clauses
   * that never mention it by name at all (a type chip plus one X, say), and
   * the resolved set is the only place that shows the true, current state.
   *
   * Every scope offered is also checked against `decidedBy` — resolvePool's
   * map of every base-league ref to the clause that decided it, populated for
   * every ref regardless of legality (see pool.ts). `decidedBy.has(ref)` is
   * exactly "does this ref exist in the league's pool at all," which is a
   * different question from "is it currently legal." Some species rank as a
   * Shadow in a league while their plain form is structurally absent from it
   * — mewtwo, kyogre, groudon, dialga, palkia, giratina_altered and reshiram
   * all do this in Great — and `cradily_b` has the reverse asymmetry. Without
   * this check, a species like that would get offered a scope whose selector
   * can never match a single base-pool ref: the button does nothing, and
   * nothing says so.
   *
   * States, per species:
   *   - both forms it can have are already legal   → not offered at all
   *   - neither is legal, and both exist in league  → 'both', 'normal', 'shadow'
   *   - only Normal legal (Shadow exists in league) → 'shadow' only
   *   - only Shadow legal (Normal exists in league) → 'normal' only
   *   - only one form exists in the league at all,
   *     and it is not yet legal                     → that one scope only
   *
   * A species with no Shadow form ever (`!shadowEligible`) only ever reaches
   * the second and last rows, with 'both' and 'normal' offered together —
   * equivalent for it, since there is no Shadow ref to distinguish them.
   */
  const offeredScopes = useMemo(() => {
    const legalSet = new Set(legal);
    const m = new Map<string, SpeciesScope[]>();
    const seen = new Set<string>();
    for (const ref of decidedBy.keys()) {
      const { id } = parseRef(ref);
      if (seen.has(id)) continue;
      seen.add(id);
      const sp = speciesOf(id);
      if (!sp) continue;

      if (!sp.shadowEligible) {
        if (!legalSet.has(id)) m.set(id, ['both', 'normal']);
        continue;
      }

      const normalInLeague = decidedBy.has(id);
      const shadowInLeague = decidedBy.has(makeRef(id, true));
      const normalLegal = normalInLeague && legalSet.has(id);
      const shadowLegal = shadowInLeague && legalSet.has(makeRef(id, true));

      if (normalInLeague && shadowInLeague) {
        if (normalLegal && shadowLegal) continue;
        if (normalLegal) m.set(id, ['shadow']);
        else if (shadowLegal) m.set(id, ['normal']);
        else m.set(id, ['both', 'normal', 'shadow']);
      } else if (normalInLeague) {
        if (!normalLegal) m.set(id, ['normal']);
      } else if (shadowInLeague) {
        if (!shadowLegal) m.set(id, ['shadow']);
      }
      // Neither in league: this id would not appear as a key of `decidedBy`
      // at all, so this branch is unreachable — noted rather than coded,
      // since there is nothing to express here.
    }
    return m;
  }, [decidedBy, legal]);

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
