import { useMemo, useState } from 'react';
import { displayName, parseRef, speciesOf } from '../lib/data';
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

  // Species eligible to be added: legal in the base league at all, and not
  // already resolved into the set. The league-membership half keeps the
  // picker from offering something that would add nothing (a species the
  // league itself never admits). The already-in-the-set half exists because
  // `addSpecies` dedupes only by exact selector string (see rules/edits.ts):
  // adding a species 'both' and then 'normal' would not narrow the first
  // clause, it would append a second, redundant one. Rather than teach the
  // picker to detect and merge that, it simply never offers a species that is
  // already in the set — narrowing an existing member happens through the X
  // buttons below, not through Add.
  const leaguePool = useMemo(
    () => resolvePool({ ...format, pool: [], start: 'league' }).legal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format.base],
  );
  const legalIds = useMemo(() => new Set(legal.map((r) => parseRef(r).id)), [legal]);
  const addable = useMemo(() => {
    const s = new Set<string>();
    for (const ref of leaguePool) {
      const id = parseRef(ref).id;
      if (!legalIds.has(id)) s.add(id);
    }
    return s;
  }, [leaguePool, legalIds]);

  return (
    <div className="format-set">
      <AddSpecies format={format} onChange={onChange} addable={addable} />

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

/**
 * Add one species, in a chosen scope.
 *
 * Three explicit buttons rather than a single "add" — whole species, normal
 * only, Shadow only — so the precision `addSpecies`'s `SpeciesScope` offers is
 * discoverable without teaching anyone the selector syntax that backs it
 * (`&!shadow`, `&shadow`). The Shadow-only button is left off entirely for a
 * species with no Shadow form: offering it would add a clause that can never
 * match anything, which is a harmless no-op but a confusing one.
 */
function AddSpecies({
  format,
  onChange,
  addable,
}: {
  format: Format;
  onChange: (next: Format) => void;
  addable: ReadonlySet<string>;
}) {
  const [pick, setPick] = useState<string>('');
  const sp = pick ? speciesOf(pick) : undefined;

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
      {sp && pick && (
        <div className="add-species-scopes" role="group" aria-label={`Add ${displayName(pick)}`}>
          <span className="add-species-name">{displayName(pick)}</span>
          <button type="button" className="btn chip-btn" data-testid="add-species-both" onClick={() => commit('both')}>
            Whole species
          </button>
          <button
            type="button"
            className="btn chip-btn"
            data-testid="add-species-normal"
            onClick={() => commit('normal')}
          >
            Normal only
          </button>
          {sp.shadowEligible && (
            <button
              type="button"
              className="btn chip-btn"
              data-testid="add-species-shadow"
              onClick={() => commit('shadow')}
            >
              Shadow only
            </button>
          )}
        </div>
      )}
    </div>
  );
}
