import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

/** hh:mm:ss to `endsAt`; ticks only while that is in the future. Display only: no live region. */
export function RoundClock({ endsAt }: { endsAt: string | null }) {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!(end > Date.now())) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= end) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [end]);

  const left = Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / 1000));
  const text = left === null ? '—' : `${pad(Math.floor(left / 3600))}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`;
  return (
    <div className="round-clock">
      <span className="hud-label">Time until round end</span>
      <span className="round-clock-time numeric">{text}</span>
    </div>
  );
}
