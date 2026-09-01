import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { ClauseEditor } from '../components/ClauseEditor';
import { PoolPreview } from '../components/PoolPreview';
import { LEAGUES } from '../lib/data';
import type { LeagueId } from '../lib/types';
import { RULES_SCHEMA, lintFormat, type Format } from '../rules';
import { deleteFormat, listFormats, saveFormat, type StoredFormat } from '../state/formatStore';

const EMPTY: Format = {
  schema: RULES_SCHEMA,
  base: 'great',
  pool: [],
  composition: { size: 3, uniqueSpecies: true },
  selection: { mode: 'open' },
};

/**
 * Author a format, and watch the pool move as you do.
 *
 * Saving is blocked while any error diagnostic stands, and only errors block:
 * a narrow pool is a legitimate thing to want and warning about it is the most
 * the tool should do. An unsatisfiable one is not, and shipping it means
 * somebody queues into a format no legal team can enter.
 */
export function FormatBuilderScreen() {
  const [format, setFormat] = useState<Format>(EMPTY);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<StoredFormat[]>(() => listFormats());
  const [explain, setExplain] = useState('');

  const diagnostics = useMemo(() => lintFormat(format), [format]);
  const blocked = diagnostics.some((d) => d.level === 'error') || name.trim() === '';

  const onSave = () => {
    if (blocked) return;
    const entry = saveFormat(name.trim(), format, editing);
    setEditing(entry.id);
    setSaved(listFormats());
  };

  const onLoad = (s: StoredFormat) => {
    setFormat(s.format);
    setName(s.name);
    setEditing(s.id);
  };

  const onNew = () => {
    setFormat(EMPTY);
    setName('');
    setEditing(undefined);
  };

  return (
    <>
      <ScreenHeader
        title="Formats"
        blurb="Compose a ruleset clause by clause, and watch the legal pool move with every keystroke."
      />

      <div className="format-builder">
        <header className="format-builder-head">
          <label className="hud-label" htmlFor="format-name">Format name</label>
          <input
            id="format-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Air Ban"
          />

          <label className="hud-label" htmlFor="format-league">League</label>
          <select
            id="format-league"
            value={format.base}
            onChange={(e) => setFormat({ ...format, base: e.target.value as LeagueId })}
          >
            {LEAGUES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>

          <label className="hud-label" htmlFor="format-size">Team size</label>
          <input
            id="format-size"
            className="input"
            type="number"
            min={1}
            max={6}
            value={format.composition.size}
            onChange={(e) =>
              setFormat({
                ...format,
                composition: { ...format.composition, size: Number(e.target.value) || 1 },
              })
            }
          />

          <button type="button" className="btn chip-btn" onClick={onSave} disabled={blocked}>
            Save
          </button>
          <button type="button" className="btn chip-btn" onClick={onNew}>
            New format
          </button>
        </header>

        <div className="format-builder-body">
          <ClauseEditor
            clauses={format.pool}
            onChange={(pool) => setFormat({ ...format, pool })}
          />

          <div className="format-builder-side">
            <label className="hud-label" htmlFor="explain-ref">Why is this banned?</label>
            <input
              id="explain-ref"
              className="input"
              value={explain}
              onChange={(e) => setExplain(e.target.value)}
              placeholder="azumarill"
            />
            <PoolPreview format={format} explain={explain.trim() || undefined} />
          </div>
        </div>

        <section className="format-saved">
          <p className="hud-label">Saved formats</p>
          <ul>
            {saved.map((s) => (
              <li key={s.id}>
                <button type="button" className="btn chip-btn" onClick={() => onLoad(s)}>
                  Load {s.name}
                </button>
                <button
                  type="button"
                  className="btn chip-btn"
                  onClick={() => {
                    deleteFormat(s.id);
                    setSaved(listFormats());
                  }}
                >
                  Delete {s.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
