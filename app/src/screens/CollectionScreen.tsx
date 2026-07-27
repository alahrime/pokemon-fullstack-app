import { useMemo, useState } from 'react';
import { useAppState, type SortKey } from '../state/AppState';
import { SPECIES_BY_ID } from '../lib/data';
import { MOCK_CATCHES } from '../data/mockCatches';
import { getEntry, shortVerdict, verdictTagClass } from '../lib/engine';
import { Sprite } from '../components/Sprite';
import { SegButton, SegGroup } from '../components/Seg';

const SORT_ITEMS: [SortKey, string][] = [
  ['rank', 'Rank'],
  ['cp', 'CP'],
  ['name', 'Name'],
  ['new', 'Newest'],
];

export function CollectionScreen() {
  const { state, patch, beginner } = useAppState();
  const { league } = state;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('rank');

  const rows = useMemo(() => {
    const withEntry = MOCK_CATCHES.map((m) => {
      const species = SPECIES_BY_ID.get(m.speciesId)!;
      const { entry, table } = getEntry(m.speciesId, { a: m.a, d: m.d, s: m.s }, league);
      return { ...m, species, entry, table };
    }).filter((m) => m.species.name.toLowerCase().includes(query.toLowerCase()));

    return withEntry.slice().sort((x, y) => {
      if (sort === 'rank') return x.entry.rank - y.entry.rank;
      if (sort === 'cp') return y.entry.cp - x.entry.cp;
      if (sort === 'name') return x.species.name.localeCompare(y.species.name);
      return MOCK_CATCHES.findIndex((z) => z.id === x.id) - MOCK_CATCHES.findIndex((z) => z.id === y.id);
    });
  }, [league, query, sort]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>Collection</h3>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {rows.length} catches · ranked for {rows[0]?.table.league.name ?? ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" style={{ width: 190 }} placeholder="Filter species…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <SegGroup>
            {SORT_ITEMS.map(([id, label]) => (
              <SegButton key={id} active={sort === id} onClick={() => setSort(id)}>
                {label}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Species</th>
            <th>IV</th>
            <th>Rank</th>
            <th>% of #1</th>
            <th>CP / L</th>
            <th>Breakpoints</th>
            <th>Verdict</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = ((r.entry.sp / r.table.best.sp) * 100).toFixed(1) + '%';
            const bpCount = r.species.fastMoves.length;
            const bpMet = r.entry.atk >= r.table.best.atk ? bpCount : Math.max(1, bpCount - 1);
            return (
              <tr key={r.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Sprite dex={r.species.dex} size={34} />
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800 }}>{r.species.name}</span>
                  </div>
                </td>
                <td>
                  {r.a}/{r.d}/{r.s}
                </td>
                <td>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, color: r.entry.rank <= 100 ? 'var(--color-accent)' : 'var(--color-text)' }}>
                    #{r.entry.rank}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 70, height: 6, background: 'var(--color-neutral-300)' }}>
                      <div style={{ height: 6, background: 'var(--color-accent)', width: pct }} />
                    </div>
                    <span style={{ fontSize: 12 }}>{pct}</span>
                  </div>
                </td>
                <td className="text-muted">
                  {r.entry.cp} / L{r.entry.lvl}
                </td>
                <td>
                  {bpMet} of {bpCount} met
                </td>
                <td>
                  <span className={verdictTagClass(r.entry.rank)}>{shortVerdict(r.entry.rank)}</span>
                </td>
                <td>
                  <button className="btn btn-ghost" onClick={() => patch({ screen: 'detail', species: r.speciesId, iv: { a: r.a, d: r.d, s: r.s } })}>
                    Open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-muted" style={{ fontSize: 11, marginTop: 12 }}>
        {beginner
          ? 'Sorted best-first. Anything tagged Transfer is safe to send to the professor.'
          : 'Ranks are league-scoped — switching the league selector re-sorts the whole table against the new cap.'}
      </p>
    </>
  );
}
