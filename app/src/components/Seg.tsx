import type { CSSProperties, ReactNode } from 'react';

/**
 * Segmented and chip controls.
 *
 * Styling lives in components.css (.seg-group / .seg-btn / .chip-btn). The old
 * segStyle/chipStyle inline helpers are gone — call sites use the classes, so
 * both themes plus all hover/active/focus states come for free.
 */

export function SegGroup({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="seg-group" style={style}>
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
