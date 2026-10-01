import { useEffect, useMemo, useState } from 'react';
import { displayName, parseRef, speciesOf } from '../lib/data';
import {
  SHIELDS, altRowFor, alternativesFor, threatScore, toneOf, topThreats,
  type AltRow, type MatrixRow, type Ratings,
} from '../lib/matchupMatrix';
import type { MonBuild } from '../lib/teambuild';
import type { LeagueId } from '../lib/types';
import { SpeciesSearch } from './SpeciesSearch';
import { Sprite } from './Sprite';

const TONE_LABEL = { rout: 'routed', lose: 'loses', close: 'close', win: 'wins', crush: 'crushes' } as const;

function Face({ refId, size, name = false }: { refId: string; size: number; name?: boolean }) {
  const sp = speciesOf(refId);
  return (
    <>
      {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(refId).shadow} />}
      {name && <span className="mx-name">{displayName(refId)}</span>}
    </>
  );
}

/**
 * One result at three shield counts, drawn as three bars rising from a baseline: height is the rating, the dotted
 * line across is 500 (a draw), colour is the band. Left to right they are 0, 1 and 2 shields each side.
 */
export function Bars({ ratings, label, small = false }: { ratings: Ratings; label: string; small?: boolean }) {
  const text = SHIELDS.map((s, i) => `${s} shield${s === 1 ? '' : 's'}: ${ratings[i]} (${TONE_LABEL[toneOf(ratings[i])]})`).join(', ');
  return (
    <span className={`mx-bars ${small ? 'is-small' : ''}`} role="img" aria-label={`${label} — ${text}`} title={`${label}\n${text.replaceAll(', ', '\n')}`}>
      {ratings.map((r, i) => (
        <i key={i} className={`mx-bar tone-${toneOf(r)}`} style={{ height: `${Math.max(8, r / 10)}%` }} />
      ))}
    </span>
  );
}

function Legend() {
  return (
    <div className="mx-legend">
      <span className="mx-legend-key">
        <Bars ratings={[820, 560, 240]} label="Example" small />
        <span>bars left to right: <b>0</b> · <b>1</b> · <b>2</b> shields each side; height is the rating, the dotted line a draw</span>
      </span>
      <span className="mx-legend-tones">
        {(['rout', 'lose', 'close', 'win', 'crush'] as const).map((t) => (
          <span key={t} className="mx-legend-tone"><i className={`mx-swatch tone-${t}`} />{TONE_LABEL[t]}</span>
        ))}
      </span>
    </div>
  );
}

/**
 * The matchup matrix for the current roster: what presses it, how each member fares against it at every shield
 * count, and who would answer it — with a search to compare anyone else, and a "+" to take an alternative onto the
 * roster. Everything is computed live from the roster and its builds.
 */
export function MatchupMatrix({ team, builds, league, onAdd, full }: {
  team: string[];
  builds?: Record<string, MonBuild>;
  league: LeagueId;
  onAdd: (ref: string) => void;
  full: boolean;
}) {
  // The roster edits instantly; the matrix catches up once the edits stop, so picking six in a row costs one run
  // of the simulation, not six.
  const [roster, setRoster] = useState(team);
  useEffect(() => {
    const id = window.setTimeout(() => setRoster(team), 250);
    return () => window.clearTimeout(id);
  }, [team]);
  const stale = roster !== team;
  const [extra, setExtra] = useState<string[]>([]);

  const threats = useMemo(() => topThreats(roster, league, builds), [roster, league, builds]);
  const score = threatScore(threats);
  const alternatives = useMemo(() => alternativesFor(roster, threats, league), [roster, threats, league]);
  const compared = useMemo(
    () => extra.filter((r) => !roster.includes(r)).map((r) => altRowFor(r, threats, league)),
    [extra, roster, threats, league],
  );

  if (team.length === 0) {
    return <div className="panel text-muted">Add a Pokémon and its matchups against the field appear here, at 0, 1 and 2 shields.</div>;
  }

  return (
    <section className={`mx ${stale ? 'is-stale' : ''}`} aria-label="Matchup matrix">
      <div className="panel panel-strong mx-panel">
        <div className="mx-head">
          <div className="hud-label">What presses this roster</div>
          <span className="numeric mx-score" title="Pressure from the twenty opponents below, summed. Lower is better.">
            threat score <b>{score}</b>
          </span>
        </div>
        <p className="text-muted mx-lede">
          The {threats.length} opponents that give your {team.length === 1 ? 'Pokémon' : `${team.length} Pokémon`} the most trouble, likelier ones
          counting for more. Each cell is one matchup fought three times — 0-0, 1-1 and 2-2 shields.
        </p>
        <Legend />
        <div className="mx-scroll">
          <table className="mx-table">
            <thead>
              <tr>
                <th className="mx-corner" scope="col">vs</th>
                {roster.map((m) => (
                  <th key={m} scope="col" className="mx-colhead"><Face refId={m} size={44} name /></th>
                ))}
                <th scope="col" className="mx-net-head">overall</th>
              </tr>
            </thead>
            <tbody>
              {threats.map((t, i) => (
                <MatrixRowView key={t.ref} row={t} n={i + 1} members={roster} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel panel-strong mx-panel">
        <div className="mx-head">
          <div className="hud-label">Who would answer them</div>
        </div>
        <p className="text-muted mx-lede">
          Candidates from the league's pool, ranked by how well they hold up against the opponents above (the ones pressing hardest
          count most). <b>+</b> adds one to your roster; search to put anyone else alongside.
        </p>
        <div className="mx-compare">
          <SpeciesSearch
            id="mx-compare"
            value=""
            startEmpty
            includeShadow
            placeholder="Compare any Pokémon…"
            onChange={(r) => setExtra((e) => (e.includes(r) ? e : [r, ...e]))}
          />
        </div>
        <div className="mx-scroll">
          <table className="mx-table mx-alts">
            <thead>
              <tr>
                <th className="mx-corner" scope="col">Pokémon</th>
                <th scope="col" className="mx-stat-head" title="Mean rating against the opponents, weighted by pressure">score</th>
                <th scope="col" className="mx-stat-head" title="Opponents answered: won at two or more shield counts">answers</th>
                {threats.map((t) => (
                  <th key={t.ref} scope="col" className="mx-threat-head" title={displayName(t.ref)}>
                    <Face refId={t.ref} size={30} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compared.map((a) => (
                <AltRowView key={`c-${a.ref}`} row={a} threats={threats} compared onAdd={full ? undefined : onAdd}
                  onRemove={() => setExtra((e) => e.filter((r) => r !== a.ref))} />
              ))}
              {alternatives.map((a) => (
                <AltRowView key={a.ref} row={a} threats={threats} onAdd={full ? undefined : onAdd} />
              ))}
            </tbody>
          </table>
        </div>
        {full && <p className="text-faint mx-note">Your roster is full — remove a member to add one of these.</p>}
      </div>
    </section>
  );
}

function MatrixRowView({ row, n, members }: { row: MatrixRow; n: number; members: string[] }) {
  return (
    <tr className={`mx-row ${row.beats.length === members.length ? 'is-hole' : ''}`}>
      <th scope="row" className="mx-rowhead">
        <span className="numeric mx-pos">{n}</span>
        <Face refId={row.ref} size={36} name />
        {row.beats.length === members.length && <span className="mx-tag" title="Beats every member">no answer</span>}
      </th>
      {row.cells.map((c, i) => (
        <td key={members[i]} className="mx-cell">
          <Bars ratings={c} label={`${displayName(members[i])} vs ${displayName(row.ref)}`} />
        </td>
      ))}
      <td className="mx-net">
        <span className="mx-net-bar"><i style={{ width: `${row.mean / 10}%` }} className={`tone-${toneOf(row.mean)}`} /></span>
        <span className="numeric">{Math.round(row.mean)}</span>
      </td>
    </tr>
  );
}

function AltRowView({ row, threats, onAdd, compared = false, onRemove }: {
  row: AltRow; threats: readonly MatrixRow[]; onAdd?: (ref: string) => void; compared?: boolean; onRemove?: () => void;
}) {
  return (
    <tr className={`mx-row ${compared ? 'is-compared' : ''}`}>
      <th scope="row" className="mx-rowhead">
        <Face refId={row.ref} size={34} name />
        {compared && <span className="mx-tag">compared</span>}
        <span className="mx-actions">
          {onAdd && (
            <button type="button" className="btn btn-sm mx-add" aria-label={`Add ${displayName(row.ref)} to the roster`} onClick={() => onAdd(row.ref)}>+</button>
          )}
          {onRemove && (
            <button type="button" className="btn btn-sm btn-ghost" aria-label={`Stop comparing ${displayName(row.ref)}`} onClick={onRemove}>✕</button>
          )}
        </span>
      </th>
      <td className="mx-stat numeric">{row.score}</td>
      <td className="mx-stat numeric">{row.answered}/{threats.length}</td>
      {row.cells.map((c, i) => (
        <td key={threats[i].ref} className="mx-cell">
          <Bars ratings={c} small label={`${displayName(row.ref)} vs ${displayName(threats[i].ref)}`} />
        </td>
      ))}
    </tr>
  );
}
