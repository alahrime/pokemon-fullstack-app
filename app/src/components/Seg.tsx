import type { CSSProperties, ReactNode } from 'react';

const segBase: CSSProperties = {
  minHeight: 38,
  borderRadius: 0,
  border: 0,
  fontSize: 12,
  letterSpacing: '0.04em',
  padding: '0 12px',
};

export function segStyle(active: boolean): CSSProperties {
  return {
    ...segBase,
    background: active ? 'var(--color-accent)' : 'transparent',
    color: active ? 'var(--color-bg)' : 'var(--color-text)',
  };
}

const chipBase: CSSProperties = {
  minHeight: 32,
  borderRadius: 0,
  fontSize: 12,
  padding: '0 10px',
};

export function chipStyle(active: boolean): CSSProperties {
  return {
    ...chipBase,
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-divider)'}`,
    background: active ? 'var(--color-accent)' : 'transparent',
    color: active ? 'var(--color-bg)' : 'var(--color-text)',
  };
}

export function SegGroup({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-divider)' }}>{children}</div>;
}

export function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="btn" style={segStyle(active)} onClick={onClick}>
      {children}
    </button>
  );
}

export function ChipButton({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button className="btn" style={{ ...chipStyle(active), ...style }} onClick={onClick}>
      {children}
    </button>
  );
}
