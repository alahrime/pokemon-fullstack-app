import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppState } from '../state/AppState';
import { DEFAULT_TIER, TIERS, btComparison, btFitFor } from '../lib/rankings';
import { SegButton, SegGroup } from '../components/Seg';
import { Sprite } from '../components/Sprite';
import { displayName, parseRef, speciesOf } from '../lib/data';
import { downloadCsv, stamp } from '../lib/exportData';

/**
 * Two rankings of the same data, and the question of whether either can be
 * right.
 *
 * The composite Overall aggregates each Pokemon's matchups under weights
 * somebody chose — an opponent curve, five category blends, a geometric mean
 * with exponents 12/6/4/2. Bradley-Terry asks instead what single strength per
 * Pokemon best explains every matchup at once, which makes "beating a strong
 * opponent counts more" fall out of the fit rather than out of a chosen curve.
 *
 * Putting them side by side is useful. What the fit's residuals say is more
 * useful still, and is the reason this screen exists rather than a second
 * ranking tab: they measure how much of this format ANY single number can
 * carry. That figure was never reported anywhere before.
 */

function Mon({ refId, size = 28 }: { refId: string; size?: number }) {
  const sp = speciesOf(refId);
  if (!sp) return null;
  return (
    <span className="diag-mon" title={displayName(refId)}>
      <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(refId).shadow} />
    </span>
  );
}

export function DiagnosticsScreen() {
  const { state } = useAppState();
  const league = state.league;
  const [tier, setTier] = useState<string>(() => DEFAULT_TIER(league));
  const [limit, setLimit] = useState(25);

  const fit = btFitFor(league);
  const { rows, rho } = useMemo(() => btComparison(league, tier), [league, tier]);

  // The pairs the fit misses worst come in both directions; one is enough.
  const worst = useMemo(() => {
    if (!fit) return [];
    const seen = new Set<string>();
    return fit.worst.filter((w) => {
      const key = [w.a, w.b].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [fit]);

  const movers = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12),
    [rows],
  );

  if (!fit) {
    return (
      <>
        <ScreenHeader title="Diagnostics" blurb="No Bradley-Terry fit in this build. Re-run npm run matrix." />
      </>
    );
  }

  // 0% would be a perfectly transitive format; 25% is what independent coin
  // flips produce. The bar reads against that 25% ceiling, not against 100%.
  const cyclicOfMax = Math.min(100, (fit.cyclicPct / 25) * 100);

  return (
    <>
      <ScreenHeader
        title="Diagnostics"
        blurb="Two rankings built from the same matchup matrix — the composite Overall, and a Bradley-Terry fit that derives one latent strength per Pokémon. The disagreement between them is interesting. What the fit cannot explain is more interesting."
      />

      {/* ── The headline: how much of the format is even rankable ─────────── */}
      <section className="panel panel-strong diag-headline">
        <div className="diag-stat">
          <span className="hud-label">Cyclic triples</span>
          <span className="numeric diag-stat-value is-warn">{fit.cyclicPct}%</span>
          <span className="diag-bar">
            <span style={{ width: `${cyclicOfMax}%` }} />
          </span>
          <span className="diag-stat-note">
            of {fit.sampled.toLocaleString()} sampled A&gt;B&gt;C&gt;A triples. A perfectly
            transitive format is 0%. Independent coin flips are 25%.
          </span>
        </div>
        <div className="diag-stat">
          <span className="hud-label">Variance explained</span>
          <span className="numeric diag-stat-value">{(fit.r2 * 100).toFixed(1)}%</span>
          <span className="diag-bar">
            <span style={{ width: `${Math.max(0, fit.r2 * 100)}%` }} />
          </span>
          <span className="diag-stat-note">
            by a single strength per Pokémon. Deflated somewhat by the rating scale&rsquo;s own
            compression, so read the triple count as the firmer number.
          </span>
        </div>
        <div className="diag-stat">
          <span className="hud-label">Typical miss</span>
          <span className="numeric diag-stat-value">{(fit.rmse * 100).toFixed(1)}pts</span>
          <span className="diag-bar">
            <span style={{ width: `${Math.min(100, fit.rmse * 300)}%` }} />
          </span>
          <span className="diag-stat-note">
            of win rate, per matchup. The distance between what the fit predicts and what the
            simulation actually produced.
          </span>
        </div>
        <div className="diag-stat">
          <span className="hud-label">The two rankings agree</span>
          <span className="numeric diag-stat-value">{rho.toFixed(3)}</span>
          <span className="diag-bar">
            <span style={{ width: `${Math.max(0, rho * 100)}%` }} />
          </span>
          <span className="diag-stat-note">
            Spearman, composite against Bradley-Terry. High overall; the heads of the two lists
            disagree far more than this number suggests.
          </span>
        </div>
      </section>

      <p className="text-muted diag-read">
        <strong>How to read this.</strong> Nearly one sampled triple in five is a rock-paper-scissors
        cycle — A beats B beats C beats A. No single number can express that, which means a ranking
        is a lossy summary of this format rather than a description of it, and the loss is not
        small. That is an argument for the Cores and Teams views, where cyclic structure is the
        subject rather than the error term. It is not an argument that either ranking is broken.
      </p>

      <div className="panel diag-controls">
        <div>
          <div className="hud-label">Opponent pool</div>
          <SegGroup>
            {TIERS(league).map((t) => (
              <SegButton key={t} active={tier === t} onClick={() => setTier(t)}>
                {t === 'all' ? 'All' : `Top ${t}`}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <div>
          <div className="hud-label">Rows</div>
          <SegGroup>
            {[25, 50, 100].map((n) => (
              <SegButton key={n} active={limit === n} onClick={() => setLimit(n)}>
                {n}
              </SegButton>
            ))}
          </SegGroup>
        </div>
        <button
          className="btn btn-sm diag-export"
          onClick={() =>
            downloadCsv(
              `paragon-bt-${league}-${tier}-${stamp()}`,
              rows.map((r) => ({
                ref: r.ref, name: r.name,
                compositeRank: r.compositeRank, composite: r.composite,
                btRank: r.btRank, btStrength: r.bt, delta: r.delta,
              })),
            )
          }
        >
          CSV
        </button>
      </div>

      {/* ── Side by side ──────────────────────────────────────────────────── */}
      <div className="diag-split">
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Composite Overall</div>
          <ol className="diag-list">
            {rows.slice(0, limit).map((r) => (
              <li key={r.ref}>
                <span className="numeric diag-pos">{r.compositeRank}</span>
                <Mon refId={r.ref} />
                <span className="diag-name">{r.name}</span>
                <span className="numeric diag-score">{r.composite}</span>
                <span
                  className={`numeric diag-delta${r.delta > 20 ? ' is-up' : r.delta < -20 ? ' is-down' : ''}`}
                  title="Where the Bradley-Terry fit puts it"
                >
                  BT #{r.btRank}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Bradley-Terry strength</div>
          <ol className="diag-list">
            {[...rows]
              .sort((a, b) => a.btRank - b.btRank)
              .slice(0, limit)
              .map((r) => (
                <li key={r.ref}>
                  <span className="numeric diag-pos">{r.btRank}</span>
                  <Mon refId={r.ref} />
                  <span className="diag-name">{r.name}</span>
                  <span className="numeric diag-score">{r.bt.toFixed(2)}</span>
                  <span
                    className={`numeric diag-delta${r.delta < -20 ? ' is-up' : r.delta > 20 ? ' is-down' : ''}`}
                    title="Where the composite puts it"
                  >
                    C #{r.compositeRank}
                  </span>
                </li>
              ))}
          </ol>
        </section>
      </div>

      {/* ── Where they disagree, and where the model fails ────────────────── */}
      <div className="diag-split">
        <section className="panel diag-col">
          <div className="hud-label diag-col-head">Biggest disagreements</div>
          <p className="text-faint diag-sub">
            A large gap means the two methods weigh this Pokémon&rsquo;s results very differently —
            usually a mon that farms a wide field but loses to the head of it, or the reverse.
          </p>
          <ol className="diag-list">
            {movers.map((r) => (
              <li key={r.ref}>
                <Mon refId={r.ref} />
                <span className="diag-name">{r.name}</span>
                <span className="numeric diag-score">C #{r.compositeRank}</span>
                <span className="numeric diag-score">BT #{r.btRank}</span>
                <span className={`numeric diag-delta${r.delta > 0 ? ' is-up' : ' is-down'}`}>
                  {r.delta > 0 ? '+' : ''}{r.delta}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel diag-col">
          <div className="hud-label diag-col-head">What one number cannot explain</div>
          <p className="text-faint diag-sub">
            The matchups furthest from the fit. These are not simulation errors — they are the
            places where strength alone is the wrong shape for the answer, because typing and
            coverage decided it instead.
          </p>
          <ul className="diag-list">
            {worst.map((w) => (
              <li key={`${w.a}|${w.b}`}>
                <Mon refId={w.a} />
                <span className="diag-name">{displayName(w.a)}</span>
                <span className="text-faint">vs</span>
                <Mon refId={w.b} size={24} />
                <span className="diag-name">{displayName(w.b)}</span>
                <span className="numeric diag-score" title="What the simulation produced">
                  {(w.observed * 100).toFixed(0)}%
                </span>
                <span className="numeric diag-delta is-down" title="What the fit predicted">
                  fit {(w.predicted * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
