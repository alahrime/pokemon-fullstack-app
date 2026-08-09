import { fastMoveCounts } from '../lib/engine';
import type { ChargeMove, FastMove } from '../lib/types';

/**
 * How many fast moves each successive charged throw costs — `5 - 5 - 5 - 5`.
 *
 * One component for every screen that lists a moveset, because there were four
 * of these and they disagreed: boxed cells on the team cards, a different set
 * of cells in the moves panel, a third style in the cores detail, and nothing
 * at all in the rankings. The same fact should not change shape depending on
 * which screen you read it from.
 *
 * Written as a dashed run rather than as separate cells. The sequence is one
 * reading — "five, every time" for Florges into Chilling Water — and boxing
 * each number turned a single fact into four, which is what it looked like
 * and is not what it is.
 *
 * It is a sequence at all because the count is not constant: the first throw
 * starts from empty and every one after begins with whatever energy overflowed
 * the last, so it drifts down and eventually cycles. Florges' Fairy Wind into
 * Chilling Water is 5-5-5-5 because 9 divides 45 exactly; into Moonblast at 60
 * it is 7-7-6-7.
 */
export function MoveCounts({
  fast,
  charge,
  className,
}: {
  fast: FastMove;
  charge: ChargeMove;
  className?: string;
}) {
  const counts = fastMoveCounts(fast, charge);
  if (!counts.length) {
    return (
      <span className={`move-counts-run is-empty${className ? ' ' + className : ''}`} title={`${fast.name} generates no energy, so it cannot charge ${charge.name}.`}>
        —
      </span>
    );
  }
  return (
    <span
      className={`numeric move-counts-run${className ? ' ' + className : ''}`}
      title={`${counts.join(' - ')} ${fast.name} to reach each successive ${charge.name}. Later throws start with leftover energy, so the count drifts down.`}
    >
      {counts.map((n, i) => (
        <span key={i}>
          {i > 0 && <span className="move-counts-sep" aria-hidden="true">-</span>}
          {n}
        </span>
      ))}
    </span>
  );
}
