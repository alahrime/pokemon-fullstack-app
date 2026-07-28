import { useMemo, useRef, useState } from 'react';
import { SPECIES, spriteFallbackUrl, spriteUrl } from '../lib/data';

/**
 * Sprite coverage contact sheet.
 *
 * Slugs are derived mechanically from PvPoke species ids, and I have no way to
 * verify a URL resolves without loading it in a browser. This renders all 1123
 * at once and reports which fell through to the dex-numbered fallback, so a
 * miss is visible rather than silently degrading.
 *
 * Reachable via ?audit=sprites — deliberately not in the nav.
 */
export function SpriteAudit() {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const seen = useRef(new Set<string>());
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? SPECIES.filter((s) => s.name.toLowerCase().includes(q) || s.id.includes(q)) : SPECIES;
  }, [filter]);

  const note = (id: string) => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    setFailed((f) => [...f, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>Sprite coverage</h3>
        <div className="text-muted" style={{ fontSize: 12 }}>
          {SPECIES.length} species · {loaded} primary slugs loaded · {failed.length} fell back to the dex image
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="Filter by name or id…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {failed.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => navigator.clipboard?.writeText(failed.join('\n'))}
            title="Copy the failing species ids"
          >
            Copy {failed.length} misses
          </button>
        )}
      </div>

      {failed.length > 0 && (
        <div className="panel" style={{ fontSize: 11, maxHeight: 140, overflowY: 'auto' }}>
          <div className="panel-title">Fell back to dex image</div>
          <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{failed.join(', ')}</code>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
          gap: 4,
        }}
      >
        {rows.map((s) => (
          <figure
            key={s.id}
            className="panel"
            style={{ padding: 4, display: 'grid', placeItems: 'center', gap: 2 }}
            title={`${s.id}\n${spriteUrl(s.sprite)}`}
          >
            <img
              src={spriteUrl(s.sprite)}
              alt={s.name}
              loading="lazy"
              width={56}
              height={56}
              style={{ width: 56, height: 56, objectFit: 'contain' }}
              onLoad={() => setLoaded((n) => n + 1)}
              onError={(e) => {
                note(s.id);
                const img = e.currentTarget;
                if (!img.dataset.fell) {
                  img.dataset.fell = '1';
                  img.src = spriteFallbackUrl(s.dex);
                  img.style.imageRendering = 'pixelated';
                  img.style.outline = '2px solid var(--color-accent)';
                }
              }}
            />
            <figcaption
              style={{
                fontSize: 9,
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 76,
              }}
            >
              {s.name}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
