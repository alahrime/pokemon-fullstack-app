import type { ThresholdRow } from '../../lib/engine';
import { ShieldIcon, SwordIcon } from '../../components/Icons';

/**
 * Every threshold in this matchup, and how far your roll is from each.
 *
 * The table used to end in a word — "Reached", "Just short", "Out of reach" —
 * which is the one thing you can already tell from the two numbers beside it.
 * What it did not show is the quantity you actually act on: the *gap*. `have`
 * and `at` were both in the row and never subtracted.
 *
 * So the last column is a gauge anchored at the threshold, deviation left for
 * short and right for surplus, with the signed gap in stat points beside it.
 * Measured over real matchups the deviations run -4.7% to +14.5% and pile up
 * at exactly zero, so the scale is +/-15% and a row sitting precisely on its
 * threshold reads as a nub at the centre — which is the honest picture of
 * "exactly on it", not a rounding artefact.
 *
 * Breakpoints are damage you deal and bulkpoints damage you take, which is a
 * distinction worth a glyph rather than a word: sword out, shield in.
 */

/** The gauge's half-range. Covers every deviation seen across the roster. */
const MARGIN_SPAN = 0.15;

export function ThresholdTable({ rows }: { rows: ThresholdRow[] }) {
  return (
    <div className="table-scroll">
      <table className="table thr">
        <thead>
          <tr>
            <th>Threshold</th>
            <th>Move</th>
            <th>Result</th>
            <th className="numeric">Needs</th>
            <th>Min IV spread</th>
            <th className="thr-margin-head">Your roll against it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bulk = r.kind === 'Bulkpoint';
            const gap = r.have - r.at;
            const dev = r.at === 0 ? 0 : gap / r.at;
            // Clamped, so one freak row cannot flatten every other gauge.
            const mag = Math.min(Math.abs(dev), MARGIN_SPAN) / MARGIN_SPAN;
            const state = r.met ? 'met' : r.near ? 'near' : 'out';
            return (
              <tr key={i} className="thr-row" data-state={state}>
                <td>
                  <span className={`thr-kind${bulk ? ' is-bulk' : ''}`}>
                    {bulk ? <ShieldIcon size={13} /> : <SwordIcon size={13} />}
                    <span>{r.kind}</span>
                  </span>
                </td>
                <td className="thr-move">{r.move}</td>
                <td>
                  <span className="thr-result numeric">{r.dmgLabel}</span>
                </td>
                <td className="numeric thr-need">{r.needLabel}</td>
                <td>
                  {/* Three values, read as three, rather than as one string
                      with slashes in it. */}
                  <span className="inline-flex gap-0.5 numeric" title={`attack / defense / stamina ${r.spread}`}>
                    {r.spread.split('/').map((v, n) => (
                      <span key={n} className="thr-iv">
                        {v}
                      </span>
                    ))}
                  </span>
                </td>
                <td>
                  <span className="thr-margin">
                    <span className="thr-gauge" aria-hidden="true">
                      <span className="thr-gauge-axis" />
                      <span className="thr-gauge-pin" />
                      <span
                        className="thr-gauge-fill"
                        data-dir={gap < 0 ? 'short' : 'over'}
                        style={{ ['--mag' as string]: `${mag * 50}%` }}
                      />
                    </span>
                    <span className="numeric thr-gap">
                      {gap === 0 ? '±0' : `${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)}`}
                      <i>{bulk ? 'def' : 'atk'}</i>
                    </span>
                    <span className="thr-state" aria-label={r.met ? 'Reached' : r.near ? 'Just short' : 'Out of reach'} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
