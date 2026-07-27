import type { CSSProperties, ReactNode } from 'react';

// Simplified Android (Material 3) device frame: status bar + content + gesture nav.
// Ported from the Claude Design starter component (android-frame.jsx).

const MD_C = {
  surface: '#f4fbf8',
  surfaceVariant: '#dae5e1',
  inverseOnSurface: '#ecf2ef',
  secondaryContainer: '#cde8e1',
  primaryFixedDim: '#83d5c6',
  onSurface: '#171d1b',
  onSurfaceVar: '#49454f',
  onPrimaryContainer: '#00201c',
  primary: '#006a60',
  frameBorder: 'rgba(116,119,117,0.5)',
};

function AndroidStatusBar({ dark = false }: { dark?: boolean }) {
  const c = dark ? '#fff' : MD_C.onSurface;
  return (
    <div
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        position: 'relative',
        fontFamily: 'Roboto, system-ui, sans-serif',
      }}
    >
      <div style={{ width: 128, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 400, letterSpacing: 0.25, lineHeight: '20px', color: c }}>9:30</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 8,
          transform: 'translateX(-50%)',
          width: 24,
          height: 24,
          borderRadius: 100,
          background: '#2e2e2e',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', paddingRight: 2 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ marginRight: -2 }}>
            <path d="M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z" fill={c} />
          </svg>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ marginRight: -2 }}>
            <path d="M14.67 14.67V1.33L1.33 14.67h13.34z" fill={c} />
          </svg>
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="3.75" y="2" width="8.5" height="13" rx="1.5" fill={c} />
          <rect x="5.5" y="0.9" width="5" height="2" rx="0.5" fill={c} />
        </svg>
      </div>
    </div>
  );
}

function AndroidNavBar({ dark = false }: { dark?: boolean }) {
  return (
    <div style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 108, height: 4, borderRadius: 2, background: dark ? '#fff' : MD_C.onSurface, opacity: 0.4 }} />
    </div>
  );
}

export function AndroidDevice({
  children,
  width = 412,
  height = 892,
  dark = false,
}: {
  children: ReactNode;
  width?: number;
  height?: number;
  dark?: boolean;
}) {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: 18,
    overflow: 'hidden',
    background: dark ? '#1d1b20' : MD_C.surface,
    border: `8px solid ${MD_C.frameBorder}`,
    boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  };
  return (
    <div style={style}>
      <AndroidStatusBar dark={dark} />
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      <AndroidNavBar dark={dark} />
    </div>
  );
}
