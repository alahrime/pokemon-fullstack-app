import type { CSSProperties, ReactNode } from 'react';
import { useSlidingMarker } from '../lib/useSlidingMarker';

/**
 * Segmented and chip controls.
 *
 * Styling lives in components.css (.seg-group / .seg-btn / .chip-btn). The old
 * segStyle/chipStyle inline helpers are gone — call sites use the classes, so
 * both themes plus all hover/active/focus states come for free.
 */

export function SegGroup({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  // The accent fill is one element that travels, rather than a background
  // switched off one button and on to another. Every segmented control in the
  // app is this component, so category, pass, pool and league all gain it here.
  const { ref, box } = useSlidingMarker<HTMLDivElement>('.seg-btn.is-active');
  return (
    <div className={`seg-group${box ? ' has-marker' : ''}`} style={style} ref={ref}>
      {box && (
        <span
          className="seg-marker"
          aria-hidden="true"
          style={{ transform: `translateX(${box.x}px)`, width: `${box.w}px` }}
        />
      )}
      {children}
    </div>
  );
}

export function SegButton({
  active,
  onClick,
  children,
  title,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      className={`btn seg-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={style}
    >
      {children}
    </button>
  );
}

export function ChipButton({
  active,
  onClick,
  children,
  title,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      className={`btn chip-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={style}
    >
      {children}
    </button>
  );
}
