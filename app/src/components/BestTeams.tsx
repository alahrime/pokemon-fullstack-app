import { useMemo, useState } from 'react';
import { CATEGORIES, type CategoryId } from '../lib/scenarios';
import { DEFAULT_TIER, ENGINE_REV, TIERS } from '../lib/rankings';
import {
  TEAM_ENGINE_REV,
  TEAM_PASSES,
  allTeamRows,
  bestTeams,
  type BestTeam,
  type TeamPass,
} from '../lib/teams';
import { displayName, movesFor, parseRef, speciesOf } from '../lib/data';
import { bestSpreadFor } from '../lib/engine';
import { Sprite } from './Sprite';
import { TypeBadge } from './TypeBadge';
import { SegButton, SegGroup } from './Seg';
import { downloadCsv, stamp } from '../lib/exportData';
import type { LeagueId } from '../lib/types';

/**
 * The teams the build found, as against the team the user typed in.
 *
 * This is a lookup, not a simulation — every legal team in the stratum was
 * already played out offline, which is minutes of work rather than the tens of
 * milliseconds a live analysis fits into. The controls mirror the Rankings
 * screen, plus a third pass the species rankings have no use for: synergy,
 * which is a property of a team.
 */

/** One member, at the spread and loadout the whole app prices opponents at. */
function Member({ ref: r, league, size }: { ref: string; league: LeagueId; size: number }) {
  const sp = speciesOf(r);
  const { shadow } = parseRef(r);
  // Same call the simulation used, so what is displayed is what was played —
  // rank-1 roll at the Best Buddy ceiling. Anything else would be showing a
  // different Pokemon than the one that earned the score.
  const spread = useMemo(() => bestSpreadFor(r, league, true), [r, league]);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  if (!sp) return null;
  return (
    <div className="bt-member">
      <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={shadow} />
      <div className="bt-member-body">
        <div className="bt-member-name">{displayName(r)}</div>
        <div className="bt-member-types">
          {sp.types.map((t) => <TypeBadge key={t} type={t} />)}
        </div>
        <div className="numeric bt-member-iv" title={`Rank-1 roll · CP ${spread.cp} · level ${spread.lvl}`}>
          {spread.a}/{spread.d}/{spread.s}
          <span className="bt-member-cp">{spread.cp}</span>
        </div>
        {moves && (
          <div className="bt-member-moves" title="The league's rated set — what was simulated">
            <span className="bt-move-fast">{moves.fast.name}</span>
            <span className="bt-move-charge">{moves.charges.map((c) => c.name).join(' · ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const SYN_FIELDS = [
  ['coverage', 'Coverage', 'Mean best answer across the field — the floor-raising term'],
  ['redundancy', 'Redundancy', 'Share of the field with two answers, half credit for one'],
  ['swapWorst', 'Swap (worst)', 'How well the back line answers the single worst lead matchup'],
  ['swapMean', 'Swap (mean)', 'The same averaged over every opponent that beats the lead'],
  ['typeCover', 'Type cover', "Share of members' weaknesses a teammate resists"],
  ['bulk', 'Bulk', 'Mean stat product against the tier best'],
] as const;

function TeamRow({ t, i, max, league, size, pass, onLoad }: {
  t: BestTeam;
  i: number;
  max: number;
  league: LeagueId;
  size: 3 | 6;
  pass: TeamPass;
  onLoad: (refs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`bt-row${open ? ' is-open' : ''}`}>
      <div className="bt-row-main">
        <span className="numeric bt-pos">{i + 1}</span>
        <div className={`bt-members bt-members-${size}`}>
          {t.refs.map((r) => (
            <Member key={r} ref={r} league={league} size={size === 3 ? 48 : 40} />
          ))}
        </div>
        <div className="bt-metrics">
          <div className="bt-score-main">
            <span className="numeric bt-score">{t.score}</span>
            <span className="bt-score-bar">
              <span className="bt-score-bar-fill" style={{ width: `${(t.score / max) * 100}%` }} />
            </span>
          </div>
          {/* The other pass's number, so switching axis is a comparison rather
              than a jump. Only shown when it differs from the ranking one. */}
          {t.sim !== undefined && pass === 'syn' && (
            <span className="numeric bt-alt" title="Simulated chain score for this same team">
              sim {t.sim}
            </span>
          )}
          {t.syn && pass !== 'syn' && (
            <span className="numeric bt-alt" title="Synergy score for this same team">
              syn {t.syn.score}
            </span>
          )}
        </div>
        <div className="bt-actions">
          <button className="btn btn-sm" onClick={() => onLoad(t.refs)} title="Load into the slots above">
            Load
          </button>
          {t.syn && (
            <button className="btn btn-sm" onClick={() => setOpen((v) => !v)} title="Synergy breakdown">
              {open ? '▴' : '▾'}
            </button>
          )}
        </div>
      </div>

      {open && t.syn && (
        <div className="bt-detail">
          <div className="bt-syn-grid">
            {SYN_FIELDS.map(([k, label, hint]) => (
              <div className="bt-syn-cell" key={k} title={hint}>
                <div className="hud-label">{label}</div>
                <div className="numeric bt-syn-value">{t.syn![k]}</div>
                <div className="bt-syn-bar">
                  <span style={{ width: `${Math.min(100, (t.syn![k] / 1000) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {t.line && (
            <div className="bt-line">
              <span className="hud-label">Carrying line</span>
              {t.line.map((r) => {
                const sp = speciesOf(r);
                return sp ? (
                  <span key={r} title={displayName(r)}>
                    <Sprite sprite={sp.sprite} dex={sp.dex} size={26} shadow={parseRef(r).shadow} />
                  </span>
                ) : null;
              })}
            </div>
          )}
          <div className="bt-holes">
            <span className="hud-label">Uncovered</span>
            {t.syn.holes.length === 0 ? (
              <span className="text-faint">Nothing in the field beats every member.</span>
            ) : (
              t.syn.holes.map((r) => {
                const sp = speciesOf(r);
                return sp ? (
                  <span key={r} title={displayName(r)}>
                    <Sprite sprite={sp.sprite} dex={sp.dex} size={24} shadow={parseRef(r).shadow} />
                  </span>
                ) : null;
              })
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function BestTeams({ league, size, onLoad }: {
  league: LeagueId;
  size: 3 | 6;
  onLoad: (refs: string[]) => void;
}) {
  const [cat, setCat] = useState<CategoryId>('overall');
  const [tier, setTier] = useState<string>(() => DEFAULT_TIER(league));
  const [pass, setPass] = useState<TeamPass>('d1');

  const teams = useMemo(() => bestTeams(league, tier, cat, pass, size), [league, tier, cat, pass, size]);
  const category = CATEGORIES.find((c) => c.id === cat)!;
  const passDef = TEAM_PASSES.find((p) => p.id === pass)!;
  const max = teams[0]?.score ?? 1000;
  const stale = TEAM_ENGINE_REV(league) !== ENGINE_REV(league);

  return (
    <div className="panel best-teams">
      <div className="best-teams-head">
        <div className="hud-label">Best {size === 3 ? 'teams of 3' : 'Show 6s'}</div>
        <div className="best-teams-export">
          <button
            className="btn btn-sm"
            title="This view as a flat CSV — one row per team, with every synergy component"
            onClick={() =>
              downloadCsv(
                `paragon-best-${size}-${league}-${tier}-${cat}-${pass}-${stamp()}`,
                teams.map((t, i) => ({
                  rank: i + 1,
                  score: t.score,
                  sim: t.sim ?? '',
                  league, tier, category: cat, pass, size,
                  ...Object.fromEntries(t.refs.map((r, n) => [`member${n + 1}`, displayName(r)])),
                  coverage: t.syn?.coverage ?? '',
                  redundancy: t.syn?.redundancy ?? '',
                  swapWorst: t.syn?.swapWorst ?? '',
                  swapMean: t.syn?.swapMean ?? '',
                  typeCover: t.syn?.typeCover ?? '',
                  bulk: t.syn?.bulk ?? '',
                  holes: t.syn?.holes.map(displayName).join(' ') ?? '',
                  bestLine: t.line?.map(displayName).join(' / ') ?? '',
                })),
              )
            }
          >
            CSV
          </button>
          <button
            className="btn btn-sm"
            title="Every stratum for this league as CSV — all tiers, categories and all three passes"
            onClick={() =>
              downloadCsv(
                `paragon-teams-${league}-all-strata-${stamp()}`,
                allTeamRows(league).map((r) => ({
                  ...r,
                  members: r.members.split(' / ').map(displayName).join(' / '),
                  bestLine: r.bestLine ? r.bestLine.split(' / ').map(displayName).join(' / ') : '',
                  holes: r.holes ? r.holes.split(' ').map(displayName).join(' ') : '',
                })),
              )
            }
          >
            All strata
          </button>
        </div>
      </div>

      <div className="best-teams-controls">
        <div>
          <div className="hud-label">Category</div>
          <SegGroup>
            {CATEGORIES.map((c) => (
              <SegButton key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} title={c.blurb}>
                {c.label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Pass</div>
          <SegGroup>
            {TEAM_PASSES.map((p) => (
              <SegButton key={p.id} active={pass === p.id} onClick={() => setPass(p.id)} title={p.blurb}>
                {p.label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Opponent pool</div>
          <SegGroup>
            {TIERS(league).map((t) => (
              <SegButton
                key={t}
                active={tier === t}
                onClick={() => setTier(t)}
                title={t === 'all' ? 'Opposing teams drawn from every league-legal form' : `Opposing teams drawn from the top ${t}`}
              >
                {t === 'all' ? 'All' : `Top ${t}`}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      </div>

      <p className="text-muted best-teams-blurb">
        {passDef.blurb}{' '}
        {pass === 'syn' ? (
          <>
            Weighted for <strong>{category.label}</strong>, which decides the shield and energy
            states coverage is measured in. Expand a row for the component breakdown and the
            opponents nothing on the team answers.
          </>
        ) : size === 3 ? (
          <>
            Every legal team of three from this stratum's 24 strongest species, played as a
            continuous chain — HP, energy and shields all carrying across matchups — at all nine
            shield parities and both energy states, then weighted for <strong>{category.label}</strong>.
          </>
        ) : (
          <>
            Every legal six from this stratum's 16 strongest, scored as the matrix game it is:
            against each opposing six you pick your best of twenty lines and they answer with their
            best of twenty.
          </>
        )}{' '}
        No two members share a Pokédex number, so regional forms, Megas and a Pokémon's own Shadow
        never appear together.
      </p>

      {stale && (
        <p className="text-muted best-teams-stale">
          Built against engine rev {TEAM_ENGINE_REV(league)}, but the rankings are at{' '}
          {ENGINE_REV(league)}. Re-run <code>npm run teams</code>.
        </p>
      )}

      {teams.length === 0 ? (
        <p className="text-muted">No teams recorded for this stratum.</p>
      ) : (
        <ol className="bt-list">
          {teams.map((t, i) => (
            <TeamRow
              key={t.refs.join('|')}
              t={t}
              i={i}
              max={max}
              league={league}
              size={size}
              pass={pass}
              onLoad={onLoad}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
