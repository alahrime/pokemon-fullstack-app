import { useEffect, useRef } from 'react';
import { QUERY_FORMS } from '../lib/query';

/**
 * Syntax legend for the search box.
 *
 * Rendered from QUERY_FORMS, the same export the parser documents itself with,
 * so a form cannot exist in one and not the other.
 *
 * Opens on click rather than hover: the list is long enough to read rather
 * than glance at, and a hover panel over a text field fights the cursor.
 */
export function SearchHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Deferred so the click that opened this does not immediately close it.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="search-help" ref={ref} role="dialog" aria-label="Search syntax">
      {QUERY_FORMS.map((g) => (
        <div className="search-help-group" key={g.group}>
          <div className="hud-label search-help-heading">
            <span>{g.group}</span>
          </div>
          {g.forms.map((f) => (
            <div className="search-help-row" key={f.syntax}>
              <code className="search-help-syntax">{f.syntax}</code>
              <span className="search-help-label">{f.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
