import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { LEAGUE_BY_ID, conflictsOnTeam, displayName, parseRef, pickableFor, speciesOf } from '../lib/data';
import { teamPool } from '../lib/rankings';
import { analyseShow6, analyseTeam, suggestCompletions } from '../lib/teambuild';
import { Sprite } from '../components/Sprite';
import { PokemonCard } from '../components/PokemonCard';
import { TypeBadge } from '../components/TypeBadge';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { BestTeams } from '../components/BestTeams';
import { downloadCsv, downloadJson, stamp } from '../lib/exportData';
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

function Slot({ ref: r, league, onClear }: { ref: string | null; league: LeagueId; onClear: () => void }) {
  if (!r) return <div className="team-slot is-empty">＋</div>;
  // The full card: a slot is the one place there is room for the whole thing,
  // and it is where you most want to see the spread and the set you are
  // actually fielding rather than a sprite and a name.
  return <PokemonCard refId={r} league={league} size="full" onClick={onClear} title="Click to remove" />;
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

export function TeamBuilderScreen({ size }: { size: 3 | 6 }) {
  const { state } = useAppState();
  const league = state.league;
  const [team, setTeam] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof analyseTeam> | null>(null);
  const [six, setSix] = useState<ReturnType<typeof analyseShow6> | null>(null);
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

  const invalidate = () => {
    setReport(null);
    setSix(null);
    setPicks(null);
  };
  // Functional updates, not `setTeam([...team, ref])`. Two picks landing in the
  // same tick both read the `team` their own render closed over, so the second
  // overwrites the first instead of appending — which silently dropped members
  // and left the roster looking like it had chosen at random.
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

  const run = () => {
    setBusy(true);
    // Yield once so the button paints its busy state before the sim blocks.
    setTimeout(() => {
      const t0 = performance.now();
      if (size === 3) setReport(analyseTeam(team, league));
      else {
        setSix(analyseShow6(team, league));
        setReport(analyseTeam(team, league, { size: 3, count: 160 }));
      }
      setElapsed(performance.now() - t0);
      setBusy(false);
    }, 0);
  };
  const [elapsed, setElapsed] = useState(0);

  const suggest = () => {
    setBusy(true);
    setTimeout(() => {
      setPicks(suggestCompletions(team, league, size === 6 ? 3 : 3));
      setBusy(false);
    }, 0);
  };

  return (
    <div className="team-builder">
      <ScreenHeader
        title={size === 3 ? 'GBL Teams' : 'Show 6'}
        blurb={
          size === 3
            ? 'Build a team of three, or take one the discovery pass already found. Every legal team from the stratum was played as one continuous chain — HP, energy and shields all carrying across matchups — rather than as three independent fights.'
            : 'Build a Show 6, or take one the discovery pass found. A six is scored as the matrix game it really is: against each opposing six you pick your best of twenty lines and they answer with theirs.'
        }
      />
      <div className="panel panel-strong">
        <div className="hud-label">{size === 3 ? 'Your team of 3' : 'Your Show 6'}</div>
        <div className="team-slots">
          {Array.from({ length: size }, (_, i) => (
            <Slot key={i} ref={team[i] ?? null} league={league} onClear={() => clear(i)} />
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
        <div className="team-actions">
          <button className="btn btn-primary" disabled={!full || busy} onClick={run}>
            {busy ? 'Simulating…' : `Analyse ${size === 3 ? 'team' : 'six'}`}
          </button>
          <button className="btn" disabled={team.length >= size || busy || team.length === 0} onClick={suggest}>
            Suggest next pick
          </button>
          {elapsed > 0 && <span className="text-faint">{elapsed.toFixed(0)}ms</span>}
          {report && (
            <>
              <button
                className="btn btn-sm"
                title="This analysis as JSON — headline numbers, threats, and the Show 6 game where applicable"
                onClick={() =>
                  downloadJson(`paragon-team-${league}-${stamp()}`, {
                    league,
                    size,
                    team: team.map((r) => ({ ref: r, name: displayName(r) })),
                    winRate: report.winRate,
                    meanHpKept: report.meanHp,
                    carryoverEdge: report.carryover,
                    show6: six
                      ? { floor: six.floor, naive: six.naive, bestLine: six.bestLine }
                      : null,
                    threats: (six ? six.threats : report.threats).map((t) => ({
                      ref: t.ref,
                      name: displayName(t.ref),
                      lossRate: t.lossRate,
                      meanHpCost: t.meanHpCost,
                    })),
                  })
                }
              >
                Export JSON
              </button>
              <button
                className="btn btn-sm"
                title="The threat table as CSV"
                onClick={() =>
                  downloadCsv(
                    `paragon-threats-${league}-${stamp()}`,
                    (six ? six.threats : report.threats).map((t, i) => ({
                      rank: i + 1,
                      ref: t.ref,
                      name: displayName(t.ref),
                      lossRate: t.lossRate,
                      meanHpCost: t.meanHpCost,
                      league,
                      team: team.map(displayName).join(' / '),
                    })),
                  )
                }
              >
                Threats CSV
              </button>
            </>
          )}
        </div>
        <p className="text-muted team-warn">
          Pick any of the {selectable.size.toLocaleString()} Pokémon GBL allows in{' '}
          {LEAGUE_BY_ID.get(league)!.label} — ranked or not. The sampled opposing field and the
          suggested completions come from the top {pool.size} by Overall, which caps who you are{' '}
          <em>measured against</em> rather than what you may bring.
        </p>
      </div>

      <BestTeams league={league} size={size} onLoad={load} />

      {picks && (
        <div className="panel">
          <div className="hud-label">Best completions</div>
          <p className="text-muted">
            Every candidate tried in the open slot and the whole team re-simulated. With carryover in
            play a candidate cannot be scored on its own matchups — its value depends on what the rest
            of the team leaves it. The second column is win rate against the <em>median</em> candidate,
            so it measures this pick rather than the fact that three beats two. Candidates obey the
            same rules discovery does — no duplicate species, and no repeated typing on a three.
          </p>
          <ol className="suggest-cards">
            {picks.map((p) => (
              <li key={p.ref}>
                <PokemonCard
                  refId={p.ref}
                  league={league}
                  size="full"
                  metric={`${Math.round(p.winRate * 100)}%`}
                  metricLabel="win rate"
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
        </div>
      )}

      {report && (
        <div className="team-report">
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

          <div className="panel">
            <div className="hud-label">Greatest threats</div>
            <p className="text-muted">
              Share of sampled opposing teams containing this Pokémon that beat you. Listed per
              Pokémon rather than per team, because "Registeel is a problem" is actionable and "this
              exact trio is a problem" is not.
            </p>
            <ThreatList threats={six ? six.threats : report.threats} />
          </div>
        </div>
      )}

      {!report && !picks && (
        <div className="panel text-muted">
          Pick {size} and hit analyse. Every matchup is played as one continuous fight — the winner
          carries its remaining HP and banked energy into the next opponent, and your two shields
          deplete across the whole battle rather than resetting each time.
          {size === 6 && ' Six is scored as a matrix game: both players choose their three after seeing the other six.'}
        </div>
      )}
    </div>
  );
}
