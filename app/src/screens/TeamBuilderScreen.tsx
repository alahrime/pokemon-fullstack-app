import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { LEAGUE_BY_ID, conflictsOnTeam, displayName, movesFor, parseRef, pickableFor, speciesOf } from '../lib/data';
import { defaultSpreadFor } from '../lib/engine';
import { teamPool } from '../lib/rankings';
import { analyseShow6, analyseTeam, completionPool, suggestCompletions, suggestSwaps, weaknessesAgainst } from '../lib/teambuild';
import type { SixSwap, Weakness } from '../lib/teambuild';
import { Sprite } from '../components/Sprite';
import { PokemonCard } from '../components/PokemonCard';
import { TypeBadge } from '../components/TypeBadge';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { AddPokemonModal, movesForChoice, type AddPokemonChoice } from '../components/AddPokemonModal';
import { BestTeams } from '../components/BestTeams';
import { InfoPopover } from '../components/InfoPopover';
import { useSession } from '../state/SessionContext';
import { deleteTeam, listTeams, saveTeam, type SavedTeam } from '../lib/saves';
import { decodeMember, encodeMember } from '../lib/teamCodec';
import type { LeagueId } from '../lib/types';

/**
 * Both team builders, which differ only in size and in how a team is scored.
 *
 * Three is a straight chained battle. Six is a matrix game — you bring six,
 * three enter, and both players choose after seeing the other's six — so it is
 * scored as a maximin over each side's twenty possible lines. Sharing the
 * screen keeps the two comparable, which matters because most people build a
 * six by starting from a three they already trust.
 */

function Slot({ ref: r, league, onClear, onAdd, build }: {
  ref: string | null;
  league: LeagueId;
  onClear: () => void;
  onAdd: () => void;
  build?: AddPokemonChoice;
}) {
  // An empty slot was a decorative "＋" that did nothing; the only way to add
  // was the search box below. It is now the button it always looked like, and
  // opens the build picker.
  if (!r) {
    return (
      <button className="team-slot is-empty" onClick={onAdd} title="Add a Pokémon, with its moves and roll">
        <span className="team-slot-mark" aria-hidden="true">+</span>
        <span className="team-slot-hint">Add</span>
      </button>
    );
  }
  // The full card: a slot is the one place there is room for the whole thing,
  // and it is where you most want to see the spread and the set you are
  // actually fielding rather than a sprite and a name.
  // The card reports the build this slot actually carries, not the league's
  // rated set — otherwise it contradicts the analysis running behind it.
  const resolved = build ? movesForChoice(build, league) : null;
  return (
    <PokemonCard
      refId={r}
      league={league}
      size="full"
      onClick={onClear}
      title="Click to remove"
      build={resolved ? { ...resolved, iv: build!.iv } : null}
    />
  );
}

/** A sprite that says who it is — the unit both lists below are built from. */
function Mon({ refId, size = 28 }: { refId: string; size?: number }) {
  const sp = speciesOf(refId);
  if (!sp) return null;
  return (
    <span className="flex-none inline-grid place-items-center" title={displayName(refId)}>
      <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(refId).shadow} />
    </span>
  );
}

/**
 * What beats the six, and what the six has to say about it.
 *
 * One row per opponent: how much of the roster it beats, and — the part that
 * makes it act-on-able rather than read-only — exactly which members answer it.
 * A row with no answer at all is the thing to fix, and is marked as such.
 */
function WeaknessList({ weaknesses }: { weaknesses: readonly Weakness[] }) {
  if (!weaknesses.length) {
    return <p className="text-muted">Nothing in the pool beats a member of this six.</p>;
  }
  return (
    <ol className="weak-list">
      {weaknesses.map((w) => (
        <li key={w.ref} className={`weak-row${w.answered.length === 0 ? ' is-open' : ''}`}>
          <Mon refId={w.ref} size={30} />
          <span className="weak-name">{displayName(w.ref)}</span>
          <span className="weak-share" title={`${w.lost.length} of ${w.lost.length + w.answered.length} lose to it`}>
            <span className="weak-share-fill" style={{ width: `${w.beatShare * 100}%` }} />
            <span className="numeric weak-share-text">{w.lost.length}/{w.lost.length + w.answered.length}</span>
          </span>
          <span className="weak-answers">
            {w.answered.length === 0 ? (
              <span className="weak-none">no answer</span>
            ) : (
              w.answered.map((r) => <Mon key={r} refId={r} size={24} />)
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Swaps worth trying, each answering something the six currently cannot.
 *
 * The gain is weighted threat coverage — a hole nothing answers is worth more
 * than a second answer to something half the team already handles — and the
 * "answers" figure is how much of the whole list the incoming pick holds,
 * which is what separates several candidates that all plug the same one hole.
 */
function SwapList({ swaps }: { swaps: readonly SixSwap[] }) {
  if (!swaps.length) {
    return (
      <p className="text-muted">
        No legal swap improves on this six — every candidate that answers something new gives up
        something the roster was already holding.
      </p>
    );
  }
  return (
    <ol className="swap-list">
      {swaps.map((s) => (
        <li key={`${s.out}|${s.in}`} className="swap-row">
          <span className="swap-side is-out">
            <Mon refId={s.out} size={30} />
            <span className="swap-name">{displayName(s.out)}</span>
          </span>
          <span className="swap-arrow" aria-hidden="true">→</span>
          <span className="swap-side is-in">
            <Mon refId={s.in} size={30} />
            <span className="swap-name">{displayName(s.in)}</span>
          </span>
          <span className="swap-why">
            {s.covers.length > 0 && (
              <span className="swap-covers">
                answers {s.covers.slice(0, 3).map(displayName).join(', ')}
                {s.covers.length > 3 && ` +${s.covers.length - 3}`}
              </span>
            )}
            {s.costs.length > 0 && (
              <span className="swap-costs">gives up {s.costs.map(displayName).join(', ')}</span>
            )}
          </span>
          <span className="numeric swap-score" title="How many of the flagged threats this pick beats">
            {s.answers}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ThreatList({ threats }: { threats: { ref: string; lossRate: number; meanHpCost: number }[] }) {
  if (!threats.length) return <p className="text-muted">No opponent in the pool beats this team often enough to flag.</p>;
  const max = threats[0].lossRate || 1;
  return (
    <ol className="threat-list">
      {threats.map((t) => {
        const sp = speciesOf(t.ref);
        return (
          <li key={t.ref}>
            {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={26} shadow={parseRef(t.ref).shadow} />}
            <span className="threat-name">{displayName(t.ref)}</span>
            <span className="threat-bar">
              <span className="threat-bar-fill" style={{ width: `${(t.lossRate / max) * 100}%` }} />
            </span>
            <span className="numeric threat-pct">{Math.round(t.lossRate * 100)}%</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What a member saves as when it was never opened in the build picker.
 *
 * A ref added through the quick search beside the slots has no entry in
 * `builds` — it is carrying the league's rated set implicitly, the same set
 * `Slot` falls back to when `build` is undefined. Saving has no such fallback
 * to lean on: `encodeMember` needs an actual `AddPokemonChoice`, so this
 * reconstructs the one the modal would have opened on, rather than saving
 * nothing or throwing.
 */
function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
  const sp = speciesOf(refId);
  if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
  const rated = movesFor(sp, leagueId);
  const spread = defaultSpreadFor(refId, leagueId, true);
  return {
    ref: refId,
    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
    chargeIds: rated.charges.map((c) => c.id),
    iv: { a: spread.a, d: spread.d, s: spread.s },
  };
}

/**
 * The rosters a save under `name` would replace, newest first.
 *
 * Compared case-insensitively and trimmed, because "GL Squad" and "gl squad"
 * are one roster to the person typing them and two rows to Postgres — nothing
 * in the database forbids the duplicate, so the only thing standing between a
 * name and a second identical entry in the load list is this comparison.
 *
 * `listTeams` orders by `updated_at` descending, so index 0 is the most
 * recently touched. Ties are possible: anything saved before this screen could
 * overwrite may already have left duplicates behind.
 */
/**
 * `size` is checked here too, not only trusted from the server-side
 * `.eq('size', size)` in `listTeams` — belt and suspenders. `listTeams` being
 * scoped is what stops a roster of the other size from ever reaching
 * `savedTeams` in the first place, but this is the line that actually decides
 * whether to offer a replace, and a stale fetch or a future regression in
 * that scoping should not be able to resurrect the bug this whole screen
 * exists to close (task 5b, ledger Ruling 13): a same-named roster from the
 * OTHER size matching here is exactly what let a 3-roster save delete three
 * members of a 6-roster nobody was looking at.
 */
function rostersNamed(saved: SavedTeam[] | null, name: string, size: 3 | 6): SavedTeam[] {
  const key = name.trim().toLowerCase();
  if (key === '') return [];
  return (saved ?? []).filter((t) => t.size === size && t.name.trim().toLowerCase() === key);
}

/**
 * What to ask before replacing one. Says which roster, and names anything about
 * the replacement that is not obvious from the slots on screen.
 */
function replacePrompt(target: SavedTeam, matchCount: number, league: LeagueId): string {
  const parts = [`Replace "${target.name}" with the roster in the slots above?`];
  // saveTeam's update path rewrites `league` along with the members, so this
  // can change the cap the roster is judged under without touching a control
  // that says so.
  if (target.league !== league) {
    const from = LEAGUE_BY_ID.get(target.league)?.label ?? target.league;
    const into = LEAGUE_BY_ID.get(league)?.label ?? league;
    parts.push(`It was saved for ${from}; this roster is ${into}.`);
  }
  if (matchCount > 1) {
    parts.push(`${matchCount} saved rosters share that name — this replaces the most recently updated one.`);
  }
  return parts.join('\n\n');
}

export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
  const { state } = useAppState();
  const { user } = useSession();
  const league = state.league;
  const [team, setTeam] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  /**
   * Per-species build overrides chosen through the modal.
   *
   * Keyed by ref rather than by slot: the duplicate rule means a ref appears at
   * most once on a team, and keying by slot would lose the build when a
   * teammate ahead of it is cleared and the array shifts.
   */
  const [builds, setBuilds] = useState<Record<string, AddPokemonChoice>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof analyseTeam> | null>(null);
  const [six, setSix] = useState<ReturnType<typeof analyseShow6> | null>(null);
  const [swaps, setSwaps] = useState<SixSwap[] | null>(null);
  const [weak, setWeak] = useState<Weakness[] | null>(null);
  const [picks, setPicks] = useState<ReturnType<typeof suggestCompletions> | null>(null);

  // Three different pools, and conflating them is what made Altaria
  // unselectable in Great:
  //   - what you may PICK        — anything GBL allows (pickableFor)
  //   - who you are MEASURED against — the top 100 (teamPool)
  //   - what gets SUGGESTED      — also the top 100, since a recommendation
  //                                 drawn from the tail is noise
  // Only the first is a restriction on the user, and it should be as wide as
  // the game is.
  const pool = useMemo(() => new Set(teamPool(league)), [league]);
  const selectable = useMemo(
    () =>
      new Set(
        pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r))),
      ),
    [league, team],
  );
  const full = team.length === size;
  /**
   * Why the save control is disabled when the roster is non-empty but not
   * exactly `size` yet — shown the same way a blank name gets a reason (see
   * `team-save-hint` below). Silent before this: the only gate was
   * `team.length === 0`, so a 1-of-6 saved without anything on screen saying
   * it was incomplete (task 5b).
   */
  const saveIncompleteReason =
    team.length > 0 && team.length < size ? `Add ${size - team.length} more to save this roster.` : null;

  const invalidate = () => {
    setReport(null);
    setSix(null);
    setPicks(null);
  };
  // Functional updates, not `setTeam([...team, ref])`. Two picks landing in the
  // same tick both read the `team` their own render closed over, so the second
  // overwrites the first instead of appending — which silently dropped members
  // and left the roster looking like it had chosen at random.
  /**
   * Where the keyboard goes once a Pokemon has been added.
   *
   * The "+" that opened the dialog has just been replaced by the card it asked
   * for, so the modal has nothing to hand focus back to and it would land on
   * <body>. The next empty slot is where you would go to add the next one.
   *
   * In an effect rather than a frame callback: requestAnimationFrame does not
   * run at all while the document is hidden, so a focus move scheduled that
   * way either never happens or happens whenever the tab is next looked at.
   * `preventScroll` for the same reason the dialog uses it — focus should
   * move, the page should not.
   */
  const focusNextSlot = useRef(false);
  useEffect(() => {
    if (!focusNextSlot.current) return;
    focusNextSlot.current = false;
    document.querySelector<HTMLElement>('.team-slot.is-empty')?.focus({ preventScroll: true });
  }, [team]);

  const addBuilt = (choice: AddPokemonChoice) => {
    setBuilds((b) => ({ ...b, [choice.ref]: choice }));
    add(choice.ref);
    focusNextSlot.current = true;
  };

  const add = (ref: string) => {
    setTeam((t) =>
      // GBL forbids two of the same species, and that is by Pokedex number —
      // so Alolan Ninetales blocks Kanto Ninetales, and a Shadow blocks its
      // plain form. Rejected here rather than flagged after the fact, because
      // an illegal team has no score worth showing.
      t.includes(ref) || t.length >= size || t.some((m) => conflictsOnTeam(m, ref))
        ? t
        : [...t, ref],
    );
    invalidate();
  };
  const clear = (i: number) => {
    setTeam((t) => t.filter((_, n) => n !== i));
    invalidate();
  };
  // Loading a discovered team replaces the roster outright rather than
  // appending, so a half-built team does not silently reject the load.
  const load = (refs: string[]) => {
    setTeam(refs.slice(0, size));
    invalidate();
  };

  /**
   * The signed-in person's saved rosters for this account, `null` while the
   * first fetch is still in flight or nobody is signed in. Distinct from `[]`
   * (fetched, and empty) so the panel can say which one it is.
   */
  const [savedTeams, setSavedTeams] = useState<SavedTeam[] | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  /** Set when a load hit a move the current data no longer has — see decodeMember. */
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  /** A failed save, load-list fetch or delete — surfaced rather than left as
   * an unhandled rejection nobody sees. */
  const [savesError, setSavesError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setSavedTeams(null);
      return;
    }
    // Guards a fetch that outlives its own sign-in: signing out while the
    // request is in flight must not resurrect `savedTeams` for a session that
    // no longer exists.
    let live = true;
    listTeams(size)
      .then((teams) => {
        if (live) setSavedTeams(teams);
      })
      .catch((e: unknown) => {
        if (live) setSavesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [user, size]);

  const saveRoster = async () => {
    // A complete roster, not merely a non-empty one — see the button's own
    // `disabled` condition below, which this mirrors. `team.length === 0`
    // alone (the old check) let a 1-of-6 be saved with nothing to say it was
    // incomplete (task 5b).
    if (team.length !== size || saving) return;
    const name = saveName.trim();
    // Saving under a name already in the list updates that roster instead of
    // writing a second row with the same label — but only when asked for. The
    // update path replaces every member, so an unprompted overwrite would be
    // indistinguishable from losing a roster.
    //
    // This reads the list already in state rather than re-fetching: it is
    // refreshed on sign-in and after every save and delete, which covers one
    // browser. It does NOT close the window where a second tab inserts the
    // same name between this check and the write — nothing but a unique index
    // on (owner_id, name) can, and there is none.
    const clashes = rostersNamed(savedTeams, name, size);
    const target = clashes[0];
    // Declining writes nothing at all. Falling back to an insert here would
    // answer "don't replace it" with a duplicate, which is what this whole
    // affordance exists to stop.
    if (target && !window.confirm(replacePrompt(target, clashes.length, league))) return;
    setSaving(true);
    setSavesError(null);
    try {
      // Every member is encoded, whether it went through the build modal or
      // not — `builds` has no entry for a ref added through the quick search,
      // and `defaultChoice` is what that ref is actually carrying (the rated
      // set `Slot` falls back to), not nothing.
      const members = team.map((ref) => encodeMember(builds[ref] ?? defaultChoice(ref, league), league));
      await saveTeam({ id: target?.id, name, league, size, members });
      setSaveName('');
      setSavedTeams(await listTeams(size));
    } catch (e) {
      setSavesError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Sets both `team` and `builds` — and REPLACES rather than merges into
  // either. See the comment on `add`/`t.includes` above: this screen has a
  // history of a second write landing on top of the render the first one
  // closed over, and dropping a member silently. A saved roster is a full
  // roster, not an addition to whatever is already in the slots.
  const loadSaved = (t: SavedTeam) => {
    const nextTeam: string[] = [];
    const nextBuilds: Record<string, AddPokemonChoice> = {};
    const notices: string[] = [];
    // A roster saved for one league is built around that league's IV spread
    // and CP cap — loading it while viewing a different league silently
    // fields IVs that were never capped for the league they are about to be
    // judged in. The load still happens (the roster is a legitimate starting
    // point in any league), but it must not happen quietly.
    if (t.league !== league) {
      const from = LEAGUE_BY_ID.get(t.league)?.label ?? t.league;
      const into = LEAGUE_BY_ID.get(league)?.label ?? league;
      notices.push(`"${t.name}" was saved for ${from}, not ${into} — its IVs and CP cap were built for the other league.`);
    }
    for (const stored of t.members) {
      const { choice, unknownMove } = decodeMember(stored);
      nextTeam.push(choice.ref);
      nextBuilds[choice.ref] = choice;
      // Falling back to a different move and saying nothing is how a saved
      // team quietly becomes a different team — decodeMember already picked
      // the fallback; this only has to name what it replaced.
      if (unknownMove) {
        notices.push(`${displayName(choice.ref)}'s saved fast move "${unknownMove}" no longer exists in the data.`);
      }
    }
    setTeam(nextTeam.slice(0, size));
    setBuilds(nextBuilds);
    invalidate();
    setSavedOpen(false);
    setLoadNotice(notices.length > 0 ? notices.join(' ') : null);
  };

  const deleteSaved = async (t: SavedTeam) => {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try {
      await deleteTeam(t.id);
      setSavedTeams(await listTeams(size));
    } catch (e) {
      setSavesError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = () => {
    setBusy(true);
    // Yield once so the button paints its busy state before the sim blocks.
    setTimeout(() => {
      const t0 = performance.now();
      // A roster of two has no line to field, so neither the chain nor the
      // matrix game is asked of it. The weakness scan and the swaps are — they
      // are per-member measurements, and they are most useful while there are
      // still slots to fill.
      const canField = team.length >= 3;
      const report6 = size === 6 && canField ? analyseShow6(team, league, { builds }) : null;
      const weakness = report6 ? report6.weakTo : weaknessesAgainst(team, league, { builds });
      setSix(report6);
      setWeak(weakness);
      // Scored against the weaknesses just named, so the two panels always
      // agree about what the problem is.
      setSwaps(suggestSwaps(team, weakness, league, { builds }));
      setReport(
        canField
          ? size === 3
            ? analyseTeam(team, league, { builds })
            : analyseTeam(team, league, { size: 3, count: 160, builds })
          : null,
      );
      setElapsed(performance.now() - t0);
      setBusy(false);
    }, 0);
  };
  const [elapsed, setElapsed] = useState(0);

  const suggest = () => {
    setBusy(true);
    setTimeout(() => {
      // `size`, not a hard 3. Passing 3 here asked for the completion to a team
      // of three whatever screen you were on, which on a Show 6 both scored the
      // wrong game and applied the three's no-repeated-typing rule to a roster
      // of five — a rule five arbitrary Pokemon always break, so the panel came
      // back empty from the fourth pick onward in every league.
      // `builds` for the same reason `run` passes it: a slot the modal built
      // otherwise gets scored on moves it is not carrying.
      setPicks(suggestCompletions(team, league, size, { builds }));
      setBusy(false);
    }, 0);
  };
  // Cheap — a filter over the top 100, no simulation — so it is recomputed for
  // the note rather than threaded out of the scored result.
  const candidates = useMemo(
    () => (picks ? completionPool(team, league, size) : null),
    [picks, team, league, size],
  );

  return (
    <div className="team-builder">
      <ScreenHeader
        title={size === 3 ? 'GBL Teams' : 'Show 6'}
        blurb={size === 3 ? 'Build a team of three, or take one discovery found.' : 'Build a Show 6, or take one discovery found.'}
        info={
          size === 3 ? (
            <p className="info-pop-lead">
              Every legal team from the stratum was played as one continuous chain — HP, energy and
              shields all carrying across matchups — rather than as three independent fights. That is
              the part a matchup table cannot express: the value of a lead is not whether it wins its
              own fight but what it leaves behind for the next one.
            </p>
          ) : (
            <p className="info-pop-lead">
              A six is scored as the matrix game it really is: against each opposing six you pick
              your best of twenty lines and they answer with theirs. Bringing six only helps if you
              have an answer to everything, not one strong line — so the number is what you can
              guarantee when the opponent picks their best reply to whatever you pick.
            </p>
          )
        }
      />
      <div className="panel panel-strong">
        <div className="hud-label">
          {size === 3 ? 'Your team of 3' : 'Your Show 6'}
          <InfoPopover label="What you may pick, and what you are measured against">

          Pick any of the {selectable.size.toLocaleString()} Pokémon GBL allows in{' '}
          {LEAGUE_BY_ID.get(league)!.label} — ranked or not. The sampled opposing field and the
          suggested completions come from the top {pool.size} by Overall, which caps who you are{' '}
          <em>measured against</em> rather than what you may bring.
          </InfoPopover>
        </div>
        <div className="team-slots">
          {Array.from({ length: size }, (_, i) => (
            <Slot
              key={i}
              ref={team[i] ?? null}
              league={league}
              onClear={() => clear(i)}
              onAdd={() => setAdding(true)}
              build={team[i] ? builds[team[i]] : undefined}
            />
          ))}
        </div>
        <div className="team-add">
          <SpeciesSearch
            // SpeciesSearch holds a selection: it syncs its text back from
            // `value` whenever the dropdown closes. Here the field is a
            // repeating picker with no selection to hold, so that sync fires
            // after every pick and races whatever is typed next. Remounting on
            // team size makes the clear deterministic instead.
            key={team.length}
            id="team-add"
            value=""
            onChange={add}
            placeholder="Add a Pokémon — name, type, @move…"
            // Shadows are separate *candidates* — the stat multipliers make
            // one a different Pokemon to build around — but not separate
            // species: picking one removes the other from the list, because
            // GBL's duplicate rule goes by Pokedex number.
            includeShadow
            restrictTo={selectable}
          />
        </div>
        {user && (
          <div className="team-saves">
            <div className="team-saves-row">
              <label className="hud-label" htmlFor="team-save-name">Save this roster</label>
              <input
                id="team-save-name"
                className="input team-save-name"
                placeholder="Name this roster"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={team.length !== size || saveName.trim() === '' || saving}
                title={saveIncompleteReason ?? undefined}
                onClick={saveRoster}
              >
                {saving ? 'Saving…' : 'Save roster'}
              </button>
              {/* Overlays the panel rather than growing it — a roster list that
                  gets longer with use must not shove the slots above it down
                  the page every time something new is saved. */}
              <div className="team-load-picker">
                <button
                  type="button"
                  className="btn move-picker-btn"
                  aria-expanded={savedOpen}
                  onClick={() => setSavedOpen((o) => !o)}
                >
                  Saved teams{savedTeams ? ` (${savedTeams.length})` : ''}
                </button>
                {savedOpen && (
                  <div className="move-picker-panel team-load-panel">
                    {savedTeams === null && <p className="text-faint">Loading…</p>}
                    {savedTeams && savedTeams.length === 0 && (
                      <p className="text-faint">No saved teams yet.</p>
                    )}
                    {savedTeams && savedTeams.length > 0 && (
                      <ul className="team-load-list">
                        {savedTeams.map((t) => (
                          <li key={t.id} className="team-load-row">
                            <button
                              type="button"
                              className="chip-btn team-load-name"
                              onClick={() => loadSaved(t)}
                              title="Load into the slots above"
                            >
                              {t.name}
                            </button>
                            <span className="team-load-league text-faint">
                              {LEAGUE_BY_ID.get(t.league)?.label ?? t.league}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void deleteSaved(t)}
                              title="Delete this saved team"
                            >
                              Delete
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
            {saveIncompleteReason && <p className="team-save-hint text-faint">{saveIncompleteReason}</p>}
            {loadNotice && <p className="team-load-notice">{loadNotice}</p>}
            {savesError && <p className="team-load-notice" role="alert">{savesError}</p>}
          </div>
        )}
        <div className="team-actions">
          {/* Two members, not a full roster. What beats a partial team and
              which swap answers it are per-member measurements — they do not
              need the empty slots filled, and the questions are at their most
              useful while there are still slots to fill. Only the chain result
              and the matrix game need a fieldable line; those say so
              themselves rather than gating the whole button. */}
          <button className="btn btn-primary" disabled={team.length < 2 || busy} onClick={run}>
            {busy ? 'Simulating…' : full ? `Analyse ${size === 3 ? 'team' : 'six'}` : `Analyse ${team.length} of ${size}`}
          </button>
          <button className="btn" disabled={team.length >= size || busy || team.length === 0} onClick={suggest}>
            Suggest next pick
          </button>
          {elapsed > 0 && <span className="text-faint">{elapsed.toFixed(0)}ms</span>}
          {/* The analysis used to leave by the back door: an "Export JSON" of
              the headline numbers and a "Threats CSV" of a table nobody could
              read without a spreadsheet. Both are gone — everything they
              carried is on the page now, in "What beats this six" and the
              swaps beside it, where it can be acted on rather than
              downloaded. */}
        </div>
      </div>

      <BestTeams league={league} size={size} onLoad={load} />

      {picks && (
        <div className="panel">
          <div className="hud-label">Best completions</div>
          <p className="text-muted">
            Every candidate tried in the open slot and the whole roster re-simulated. With carryover
            in play a candidate cannot be scored on its own matchups — its value depends on what the
            rest of the team leaves it.{' '}
            {picks[0]?.metric === 'floor' ? (
              <>
                A six is scored as the matrix game, not as a longer chain: against each sampled
                opposing six, you field whichever of your lines best survives their best answer, and
                the headline is the mean of those guaranteed values. It is routinely negative until
                the roster is deep — a partial six cannot answer a full one.
              </>
            ) : (
              <>The headline is the share of the sampled field this chain beats.</>
            )}{' '}
            The second column compares that against the <em>median</em> candidate, so it measures
            this pick rather than the fact that three beats two.
          </p>
          {picks.length === 0 ? (
            <p className="text-muted">
              No candidate in the top {pool.size} is legal beside this roster. Clearing a slot widens
              the field.
            </p>
          ) : (
            <ol className="suggest-cards">
              {picks.map((p) => (
                <li key={p.ref}>
                  <PokemonCard
                    refId={p.ref}
                    league={league}
                    size="full"
                    metric={
                      p.metric === 'floor'
                        ? `${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(0)}`
                        : `${Math.round(p.value * 100)}%`
                    }
                    metricLabel={p.metric === 'floor' ? 'floor' : 'win rate'}
                    onClick={() => add(p.ref)}
                    title="Add to the team"
                    note={
                      <span className="suggest-why">
                        <span className={`numeric suggest-gain${p.gain >= 0 ? ' is-up' : ' is-down'}`}>
                          {p.gain >= 0 ? '+' : ''}{Math.round(p.gain * 100)}
                        </span>
                        <span className="text-faint">vs median pick</span>
                        {p.covers.length > 0 && (
                          <span className="suggest-covers">
                            shores up {p.covers.map((c) => <TypeBadge key={c} type={c} />)}
                          </span>
                        )}
                      </span>
                    }
                  />
                </li>
              ))}
            </ol>
          )}
          {candidates && (
            <p className="text-faint suggest-rule">
              {candidates.pool.length} candidate{candidates.pool.length === 1 ? '' : 's'} obeyed the
              rules discovery builds under: no duplicate species, and at most {candidates.typeCap}{' '}
              pair{candidates.typeCap === 1 ? '' : 's'} of the roster sharing a typing.
              {candidates.typeCap > candidates.nominal &&
                ` The allowance for a ${size} is ${candidates.nominal}; this roster already spends ${candidates.shared}, and a rule that rejects every candidate says nothing.`}
            </p>
          )}
        </div>
      )}

      {(report || weak) && (
        <div className="team-report">
          {!report && (
            <div className="panel text-muted">
              A roster of {team.length} cannot field a line, so there is no chain result and no
              matrix game to report — those arrive at three. What is below needs only the members
              you have: every opponent in the pool played against each of them, and the swaps that
              would answer what none of them beat.
            </div>
          )}
          {report && (
          <div className="panel panel-filled">
            <div className="stat-strip">
              <div className="stat-cell">
                <div className="stat-cell-label">Win rate</div>
                <div className="stat-cell-value">{Math.round(report.winRate * 100)}%</div>
              </div>
              <div className="stat-cell">
                <div className="stat-cell-label">Mean HP kept</div>
                <div className="stat-cell-value">{Math.round(report.meanHp * 100)}%</div>
              </div>
              <div className="stat-cell">
                <div className="stat-cell-label" title="Win rate with HP/energy/shields persisting, minus the same fight with survivors healed between matchups">
                  Carryover edge
                </div>
                <div className="stat-cell-value">
                  {report.carryover >= 0 ? '+' : ''}
                  {(report.carryover * 100).toFixed(0)}
                </div>
              </div>
              {six && (
                <>
                  <div className="stat-cell">
                    <div className="stat-cell-label" title="Guaranteed value when the opponent picks their best answer to your best line">
                      Guaranteed floor
                    </div>
                    <div className="stat-cell-value">{(six.floor * 100).toFixed(0)}</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-cell-label" title="Value if the opponent picks blind — the gap is what their read costs you">
                      If they pick blind
                    </div>
                    <div className="stat-cell-value">{(six.naive * 100).toFixed(0)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          )}

          {six && (
            <div className="panel">
              <div className="hud-label">Your strongest line</div>
              <p className="text-muted">
                Of the twenty threes inside your six, this is the one whose worst case is least bad —
                the maximin. Bringing six only helps if you have an answer to everything, not one
                strong line.
              </p>
              <div className="team-slots">
                {six.bestLine.map((r) => (
                  <PokemonCard key={r} refId={r} league={league} size="compact" />
                ))}
              </div>
            </div>
          )}

          {weak && (
            <>
              <div className="panel">
                <div className="hud-label">What beats this {size === 6 ? 'six' : 'team'}</div>
                <p className="text-muted">
                  The twenty opponents your roster handles worst, each played against every member
                  at 0, 1 and 2 shields. The bar is how many of your {team.length} lose to it; the
                  sprites on the right are the ones that answer it. A row with no answer is a hole —
                  those come first.
                </p>
                <WeaknessList weaknesses={weak} />
              </div>

              <div className="panel">
                <div className="hud-label">{team.length < size ? 'Swaps worth trying — and the slots still open' : 'Swaps worth trying'}</div>
                <p className="text-muted">
                  One member out, one legal candidate in, ranked by how much of the list above the
                  exchange closes. A candidate is charged for anything the departing member alone
                  was holding, so a swap that trades one hole for another never appears. The figure
                  on the right is how many of the twenty the incoming pick beats.
                  {team.length < size && ' With slots still open, "Suggest next pick" answers the other half of the question — what to add rather than what to change.'}
                </p>
                <SwapList swaps={swaps ?? []} />
              </div>
            </>
          )}

          {report && size === 3 && (
            <div className="panel">
              <div className="hud-label">Greatest threats</div>
              <p className="text-muted">
                Share of sampled opposing teams containing this Pokémon that beat you. Listed per
                Pokémon rather than per team, because "Registeel is a problem" is actionable and
                "this exact trio is a problem" is not.
              </p>
              <ThreatList threats={report.threats} />
            </div>
          )}
        </div>
      )}

      {!report && !weak && !picks && (
        <div className="panel text-muted">
          Pick at least two and hit analyse. Every matchup is played as one continuous fight — the winner
          carries its remaining HP and banked energy into the next opponent, and your two shields
          deplete across the whole battle rather than resetting each time.
          {size === 6 && ' Six is scored as a matrix game: both players choose their three after seeing the other six.'}
        </div>
      )}
      {adding && (
        <AddPokemonModal
          league={league}
          restrictTo={selectable}
          onCommit={addBuilt}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
