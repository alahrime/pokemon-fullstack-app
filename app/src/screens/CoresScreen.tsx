import { useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';
import { coreBalance, coresFor, pillarsFor, type Core, type Pillar } from '../lib/teams';
import { ScreenHeader } from '../components/ScreenHeader';
import { displayName, movesFor, parseRef, pickableFor, speciesOf } from '../lib/data';
import { bestSpreadFor } from '../lib/engine';
import { moveTypeStyle } from '../lib/pokemonTypes';
import { MoveCounts } from '../components/MoveCounts';
import type { LeagueId } from '../lib/types';
import { Sprite } from '../components/Sprite';
import { TypeBadge } from '../components/TypeBadge';
import { SegButton, SegGroup } from '../components/Seg';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { lookupPair, type PairLookup } from '../lib/pairLookup';
import { downloadCsv, stamp } from '../lib/exportData';

/**
 * Cores: which pairs actually hold each other up, and why.
 *
 * Nothing on this screen is hand-authored. A core is a pair where each member
 * is strong precisely where the other fails, scored as the geometric mean of
 * the two rescue directions — so a strong Pokemon carrying a passenger scores
 * near zero however strong it is. The Pokemon each one rescues, and the types
 * it resists on the other's behalf, are shown as the evidence rather than
 * asked for on trust.
 *
 * The second tab is the other shape people build around: a lead with a narrow
 * weakness that *two* teammates independently answer, so when the bad lead
 * happens there are two ways to flip it rather than one.
 */

// 52 by default, because the default is what the Pairs list uses and that list
// is the screen. The explicit sizes below are for the denser contexts.
function Mon({ ref: r, size = 52 }: { ref: string; size?: number }) {
  const sp = speciesOf(r);
  return (
    <span className="core-mon" title={displayName(r)}>
      {sp && <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(r).shadow} />}
    </span>
  );
}

function Direction({ from, to, covers, types }: {
  from: string;
  to: string;
  covers: string[];
  types: string[];
}) {
  if (!covers.length && !types.length) return null;
  return (
    <div className="core-dir">
      <span className="core-dir-head">
        <strong>{displayName(from)}</strong> answers for <strong>{displayName(to)}</strong>
      </span>
      {types.length > 0 && (
        <span className="core-dir-types">
          resists {types.map((t) => <TypeBadge key={t} type={t} />)}
        </span>
      )}
      {covers.length > 0 && (
        <span className="core-dir-mons">
          {covers.map((c) => <Mon key={c} ref={c} size={30} />)}
        </span>
      )}
    </div>
  );
}

/**
 * One member's rated build: the spread and the set the core was scored on.
 *
 * Read back from bestSpreadFor and movesFor rather than restated, so a row can
 * never advertise a build that did not earn the score beside it.
 */
function CoreBuild({ ref: r, league }: { ref: string; league: LeagueId }) {
  const sp = speciesOf(r);
  const spread = useMemo(() => (sp ? bestSpreadFor(r, league, true) : null), [sp, r, league]);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  if (!sp || !spread) return null;
  return (
    <span className="core-build">
      <span className="numeric core-build-iv">{spread.a}/{spread.d}/{spread.s}</span>
      <span className="numeric core-build-cp">{spread.cp}<i>CP</i></span>
      {moves && (
        // The same chips the Show 6 and GBL cards use — literally the same
        // classes, so the two cannot drift apart. A moveset was a run-on line
        // of names here ("Rollout · Body Slam / Earthquake"), which said what
        // the set was and nothing about what it costs.
        <span className="pc-moves">
          <span className="pc-move pc-move-fast" style={moveTypeStyle(moves.fast.type)}>
            <span className="pc-move-name">{moves.fast.name}</span>
            <span className="numeric pc-move-eco">
              {(moves.fast.energyGain / moves.fast.turns).toFixed(1)}<i>e/t</i>
            </span>
          </span>
          {moves.charges.map((m) => (
            <span className="pc-move" key={m.id} style={moveTypeStyle(m.type)}>
              <span className="pc-move-name">{m.name}</span>
              <span className="numeric pc-move-eco">
                {(m.power / m.energy).toFixed(2)}<i>dpe</i>
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * How long each charged move takes, in fast moves.
 *
 * The row says what a member throws; this says how often. The count is not a
 * constant — the first throw starts from empty and every one after it begins
 * with whatever overflowed the last, so the sequence drifts down and cycles.
 * Lickilicky is the worked example in `fastMoveCounts`: Rollout at 13 energy
 * charges Body Slam 3-3-3-2, while Lick at 3 charges the same move 12-12-11-12.
 *
 * Which is the point of showing it per member rather than as a single number:
 * the same charged move is a different proposition behind a different fast
 * move, and a core is a claim about two builds fighting together.
 */
function CoreTiming({ ref: r, league }: { ref: string; league: LeagueId }) {
  const sp = speciesOf(r);
  const moves = useMemo(() => (sp ? movesFor(sp, league) : null), [sp, league]);
  if (!sp || !moves) return null;
  return (
    <div className="core-timing">
      <span className="hud-label core-timing-who">{displayName(r)}</span>
      <span className="core-timing-fast numeric">
        {moves.fast.name}
        <i>{(moves.fast.energyGain / moves.fast.turns).toFixed(1)}e/t</i>
      </span>
      <span className="core-timing-list">
        {moves.charges.map((m) => (
          <span className="core-timing-row" key={m.id}>
            <span className="core-timing-move">{m.name}</span>
            <MoveCounts fast={moves.fast} charge={m} />
          </span>
        ))}
      </span>
    </div>
  );
}

function CoreRow({ c, max, league }: { c: Core; max: number; league: LeagueId }) {
  const [open, setOpen] = useState(false);
  // All four typings of the pairing, so the row is tinted by the core rather
  // than by one member. A mono-type member repeats its own colour, which keeps
  // the gradient even instead of leaving a gap where its second type would be.
  const hues = useMemo(() => {
    const t = (r: string) => {
      const sp = speciesOf(r);
      const ty = sp?.types ?? [];
      return [ty[0] ?? 'normal', ty[1] ?? ty[0] ?? 'normal'];
    };
    const [a1, a2] = t(c.a);
    const [b1, b2] = t(c.b);
    return {
      ['--ca1' as string]: `var(--type-${a1})`,
      ['--ca2' as string]: `var(--type-${a2})`,
      ['--cb1' as string]: `var(--type-${b1})`,
      ['--cb2' as string]: `var(--type-${b2})`,
    };
  }, [c.a, c.b]);
  return (
    <li className={open ? 'is-open' : ''} style={hues}>
      <button className="core-row" onClick={() => setOpen((v) => !v)}>
        {/* One block per member rather than a sprite pair beside a shared
            name column. The old layout gave the names 940px it did not need
            while the sprite column stayed at the width two 34px sprites once
            needed — so the second 52px sprite spilled 14px into the text.
            Side by side, each member owns its own space and the row reads as
            the pairing it describes. */}
        <span className="core-side">
          <Mon ref={c.a} />
          <span className="core-side-id">
            <span className="core-side-name">{displayName(c.a)}</span>
            <CoreBuild ref={c.a} league={league} />
          </span>
        </span>
        <span className="core-amp" aria-hidden="true">+</span>
        <span className="core-side">
          <Mon ref={c.b} />
          <span className="core-side-id">
            <span className="core-side-name">{displayName(c.b)}</span>
            <CoreBuild ref={c.b} league={league} />
          </span>
        </span>
        <span className="numeric core-score" title="Mutual rescue — both directions, geometric mean">
          {c.score}
          <span className="core-bar">
            <span className="core-bar-fill" style={{ width: `${(c.score / max) * 100}%` }} />
          </span>
        </span>
        <span
          className={`numeric core-lift${c.lift >= 1.2 ? ' is-up' : c.lift < 0.8 ? ' is-down' : ''}`}
          title="How often the pair appeared together in top teams, against what independence predicts"
        >
          {c.lift ? `${c.lift.toFixed(2)}x` : '—'}
        </span>
        <span className="numeric core-appear" title="Times the pair appeared together in a stratum's top teams">
          {c.appearances}
        </span>
        <span
          className={`numeric core-balance${coreBalance(c) >= 0.7 ? ' is-up' : ''}`}
          title="How evenly the rescue runs both ways — 1.00 is fully reciprocal, low means one member is carrying"
        >
          {coreBalance(c).toFixed(2)}
        </span>
      </button>
      {open && (
        <div className="core-detail">
          {c.sharedWeak?.length > 0 && (
            <div className="core-shared-weak">
              <strong>Both weak to</strong>
              {c.sharedWeak.map((t) => <TypeBadge key={t} type={t} />)}
              <span className="text-faint">
                — nothing on this pair answers it, so the score is discounted for it.
              </span>
            </div>
          )}
          <Direction from={c.b} to={c.a} covers={c.bCovers} types={c.bCoversTypes} />
          <Direction from={c.a} to={c.b} covers={c.aCovers} types={c.aCoversTypes} />
          <div className="core-timings">
            <CoreTiming ref={c.a} league={league} />
            <CoreTiming ref={c.b} league={league} />
          </div>
          <p className="text-faint core-detail-note">
            Rescue is measured only over matchups the other member loses, and only counts the part
            above a comfortable win — being mediocre into your partner's counters is not cover.
            {' '}{displayName(c.a)} gains {c.aRescuedByB}, {displayName(c.b)} gains {c.bRescuedByA}.
          </p>
        </div>
      )}
    </li>
  );
}

function PillarRow({ p, max }: { p: Pillar; max: number }) {
  return (
    <li>
      <span className="pillar-lead">
        <Mon ref={p.lead} size={56} />
        <span className="pillar-lead-name">{displayName(p.lead)}</span>
      </span>
      <span className="pillar-arrow" aria-hidden="true">↻</span>
      <span className="pillar-backs">
        {p.backs.map((b) => (
          <span className="pillar-back" key={b}>
            <Mon ref={b} size={42} />
            <span className="pillar-back-name">{displayName(b)}</span>
          </span>
        ))}
      </span>
      <span className="numeric pillar-cover" title="Share of the lead's losing matchups that BOTH backs answer">
        {(p.doubleCover / 10).toFixed(0)}%
        <span className="core-bar">
          <span className="core-bar-fill" style={{ width: `${(p.doubleCover / max) * 100}%` }} />
        </span>
      </span>
      <span className="numeric pillar-losses" title="Opponents in the field that beat the lead">
        {p.leadLosses}
      </span>
    </li>
  );
}

export function CoresScreen() {
  const { state } = useAppState();
  const league = state.league;
  const [tab, setTab] = useState<'cores' | 'pillars' | 'check'>('cores');
  const [sort, setSort] = useState<'score' | 'lift' | 'seen' | 'balance'>('score');
  // One Pokemon can legitimately anchor most of a league's best cores — Carbink
  // took 13 of Great's top 20 — which is true and also unreadable. This caps
  // repeats so the list shows cores rather than one Pokemon's address book.
  const [diverse, setDiverse] = useState(true);
  const [filter, setFilter] = useState('');
  // Live pair lookup, for the great majority of pairings the shipped list does
  // not reach — the cut is around the 99.5th percentile.
  const [pa, setPa] = useState('');
  const [pb, setPb] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PairLookup | null>(null);

  const allCores = useMemo(() => coresFor(league), [league]);
  const cores = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = q
      ? allCores.filter((c) =>
          displayName(c.a).toLowerCase().includes(q) || displayName(c.b).toLowerCase().includes(q))
      : allCores;
    const key = sort === 'lift' ? (c: Core) => c.lift
      : sort === 'seen' ? (c: Core) => c.appearances
      : sort === 'balance' ? coreBalance
      : (c: Core) => c.score;
    const sorted = [...rows].sort((x, y) => key(y) - key(x));
    if (!diverse) return sorted;
    const seen = new Map<string, number>();
    return sorted.filter((c) => {
      const na = seen.get(c.a) ?? 0;
      const nb = seen.get(c.b) ?? 0;
      if (na >= 3 || nb >= 3) return false;
      seen.set(c.a, na + 1);
      seen.set(c.b, nb + 1);
      return true;
    });
  }, [allCores, filter, sort, diverse]);
  const pillars = useMemo(() => pillarsFor(league), [league]);
  // Megas and Primals are the only real exclusion — GBL does not allow them.
  const pickable = useMemo(() => new Set(pickableFor(league)), [league]);
  const maxCore = cores[0]?.score || 1;
  const maxPillar = pillars[0]?.doubleCover || 1;

  return (
    <div className="cores-screen">
      <ScreenHeader
        title="Cores"
        blurb="Pairs that answer what the other cannot, ranked by how much the partnership adds over the two Pokémon alone. Lift is the whole point: a core is only a core if it beats its own halves."
      />
      <div className="panel panel-strong">
        <div className="best-teams-head">
          <div className="hud-label">Cores</div>
          <div className="best-teams-export">
            <button
              className="btn btn-sm"
              onClick={() =>
                tab === 'cores'
                  ? downloadCsv(`paragon-cores-${league}-${stamp()}`, cores.map((c, i) => ({
                      rank: i + 1, league, a: displayName(c.a), b: displayName(c.b),
                      coreScore: c.score, aRescuedByB: c.aRescuedByB, bRescuedByA: c.bRescuedByA,
                      appearances: c.appearances, lift: c.lift,
                      bCoversForA: c.bCovers.map(displayName).join(' '),
                      aCoversForB: c.aCovers.map(displayName).join(' '),
                      bResistsTypes: c.bCoversTypes.join(' '),
                      aResistsTypes: c.aCoversTypes.join(' '),
                    })))
                  : downloadCsv(`paragon-pillars-${league}-${stamp()}`, pillars.map((p, i) => ({
                      rank: i + 1, league, lead: displayName(p.lead),
                      back1: displayName(p.backs[0]), back2: displayName(p.backs[1]),
                      doubleCoverPct: (p.doubleCover / 10).toFixed(1),
                      leadLosses: p.leadLosses,
                      covered: p.covered.map(displayName).join(' '),
                    })))
              }
            >
              CSV
            </button>
          </div>
        </div>

        <SegGroup>
          <SegButton active={tab === 'cores'} onClick={() => setTab('cores')} title="Pairs that rescue each other">
            Pairs
          </SegButton>
          <SegButton active={tab === 'pillars'} onClick={() => setTab('pillars')} title="A lead whose weakness two teammates both answer">
            One front, two back
          </SegButton>
          <SegButton active={tab === 'check'} onClick={() => setTab('check')} title="Score any two Pokémon on demand">
            Check a pair
          </SegButton>
        </SegGroup>

        {tab === 'cores' && (
          <div className="core-controls">
            <input
              className="input core-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              aria-label="Filter cores by name"
            />
            <SegGroup>
              <SegButton active={sort === 'score'} onClick={() => setSort('score')} title="Mutual rescue, both directions">
                Rescue
              </SegButton>
              <SegButton active={sort === 'lift'} onClick={() => setSort('lift')} title="Co-occurrence against what independence predicts">
                Lift
              </SegButton>
              <SegButton active={sort === 'seen'} onClick={() => setSort('seen')} title="Raw appearances together in top teams">
                Seen
              </SegButton>
              <SegButton active={sort === 'balance'} onClick={() => setSort('balance')} title="How evenly the two rescue directions run — a true mutual core rather than one member carrying">
                Balance
              </SegButton>
            </SegGroup>
            <SegGroup>
              <SegButton active={diverse} onClick={() => setDiverse(true)} title="At most three cores per Pokémon, so one anchor cannot fill the list">
                Varied
              </SegButton>
              <SegButton active={!diverse} onClick={() => setDiverse(false)} title="Every core in score order, repeats included">
                All
              </SegButton>
            </SegGroup>
            <span className="text-faint">{cores.length} of {allCores.length}</span>
          </div>
        )}

        <p className="text-muted best-teams-blurb">
          {tab === 'cores' ? (
            <>
              A core is a pair where each is strong exactly where the other fails. Scored as the
              geometric mean of both rescue directions, so a strong Pokémon carrying a passenger
              scores near zero however strong it is — mutual is the whole point. Click a row for the
              evidence: the opponents each one answers, and the types it resists on the other's
              behalf. <strong>Lift</strong> is how often the pair actually appeared together in top
              teams against what independence predicts, so it separates real partnership from two
              good Pokémon that turn up everywhere.
            </>
          ) : (
            <>
              A lead with a narrow weakness that <strong>two</strong> teammates independently answer.
              When the bad lead happens there are two separate ways to flip it and realign the front
              onto the rest of the field — one answer is a plan, two is a plan that survives the
              opponent having a read. The percentage is the share of the lead's losing matchups that
              both backs cover, not either.
            </>
          )}
        </p>
      </div>

      {tab === 'check' ? (
        <div className="panel">
          <div className="hud-label">Score any pair</div>
          <p className="text-muted best-teams-blurb">
            The list is the best few hundred of tens of thousands of legal pairs, so a cut at 300 is
            roughly the 99.5th percentile — plenty of genuinely good pairings sit just below it.
            This runs the same metric on any two Pokémon, live, against the same 500-wide field —
            and reproduces the offline numbers exactly, so a looked-up score is directly comparable
            to a listed one. The first lookup takes a second or two while the reference distribution
            is built; after that they are near-instant. The percentile places the score against the
            pool's own strong pairs, so the raw number means something.
          </p>
          <div className="core-check-inputs">
            <SpeciesSearch id="pair-a" value={pa} onChange={setPa} placeholder="First Pokémon…" includeShadow restrictTo={pickable} />
            <span className="core-amp">+</span>
            <SpeciesSearch id="pair-b" value={pb} onChange={setPb} placeholder="Second Pokémon…" includeShadow restrictTo={pickable} />
            <button
              className="btn btn-primary"
              disabled={!pa || !pb || pa === pb || busy}
              onClick={() => {
                setBusy(true);
                // Yield so the button paints before the sweep blocks the thread.
                setTimeout(() => {
                  setResult(lookupPair(pa, pb, league));
                  setBusy(false);
                }, 0);
              }}
            >
              {busy ? 'Simulating…' : 'Score pair'}
            </button>
          </div>
          {result && (
            <div className="core-detail core-check-result">
              <div className="core-check-head">
                <Mon ref={result.a} size={64} />
                <Mon ref={result.b} size={64} />
                <span className="core-names">
                  {displayName(result.a)} <span className="core-amp">+</span> {displayName(result.b)}
                </span>
                <span className="numeric core-check-score">
                  {result.score}
                  <span className="text-faint"> · {result.percentile}th pct</span>
                </span>
              </div>
              <Direction from={result.b} to={result.a} covers={result.bCovers} types={result.bCoversTypes} />
              <Direction from={result.a} to={result.b} covers={result.aCovers} types={result.aCoversTypes} />
              <p className="text-faint core-detail-note">
                Measured over the top {result.fieldSize} of the league. {displayName(result.a)} gains{' '}
                {result.aRescuedByB}, {displayName(result.b)} gains {result.bRescuedByA} — a core
                scores near zero unless both directions are positive.
              </p>
            </div>
          )}
        </div>
      ) : tab === 'cores' ? (
        cores.length === 0 ? (
          <div className="panel text-muted">No cores recorded. Re-run <code>npm run teams</code>.</div>
        ) : (
          <div className="panel">
            {/* Header cells match the row's grid one-for-one; the old version
                was two blanks short of the six columns it labelled, so every
                heading sat above the wrong number. */}
            <div className="core-head">
              <span className="hud-label">Core</span>
              <span />
              <span />
              <span className="hud-label">Mutual rescue</span>
              <span className="hud-label">Lift</span>
              <span className="hud-label">Seen</span>
              <span className="hud-label">Balance</span>
            </div>
            <ol className="core-list">
              {cores.map((c) => <CoreRow key={`${c.a}|${c.b}`} c={c} max={maxCore} league={league} />)}
            </ol>
          </div>
        )
      ) : pillars.length === 0 ? (
        <div className="panel text-muted">No pillars recorded. Re-run <code>npm run teams</code>.</div>
      ) : (
        <div className="panel">
          <ol className="pillar-list">
            {pillars.map((p) => (
              <PillarRow key={`${p.lead}|${p.backs.join('|')}`} p={p} max={maxPillar} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
