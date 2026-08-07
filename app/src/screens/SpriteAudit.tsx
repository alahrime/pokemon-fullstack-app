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
    <div className="sa">
      <div>
        <h3 className="m-0">Sprite coverage</h3>
        <div className="text-muted text-sm">
          {SPECIES.length} species · {loaded} primary slugs loaded · {failed.length} fell back to the dex image
        </div>
      </div>

      <div className="sa-controls">
        <input
          className="input sa-input"
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
        <div className="panel sa-log">
          <div className="panel-title">Fell back to dex image</div>
          <code className="sa-log-line">{failed.join(', ')}</code>
        </div>
      )}

      <div className="sa-grid">
        {rows.map((s) => (
          <figure
            key={s.id}
            className="panel sa-cell"
            title={`${s.id}\n${spriteUrl(s.sprite)}`}
          >
            <img
              src={spriteUrl(s.sprite)}
              alt={s.name}
              loading="lazy"
              width={56}
              height={56}
              className="sa-img"
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
            <figcaption className="sa-name">
              {s.name}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
