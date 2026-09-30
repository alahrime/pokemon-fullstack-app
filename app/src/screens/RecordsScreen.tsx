import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { LEAGUE_BY_ID } from '../lib/data';
import type { LeagueId } from '../lib/types';
import { byDay, exportRecords, gritStatus, listMyRecords, myGrit, type Grit, monthGrid, summarise, wilson, type RecordRow } from '../lib/records';

const SHOWN = 50;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function RecordsScreen() {
  const { patch } = useAppState();
  const { user } = useSession();
  const uid = user?.id ?? null;
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [grit, setGrit] = useState<Grit | null>(null);
  const [ranked, setRanked] = useState(false);
  const [more, setMore] = useState(SHOWN);
  const [ym, setYm] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1 }; });

  useEffect(() => {
    if (!uid) return;
    let live = true;
    listMyRecords().then((r) => live && setRows(r)).catch(() => live && setFailed(true));
    myGrit().then((g) => live && setGrit(g)).catch(() => {});
    return () => { live = false; };
  }, [uid]);

  const shown = useMemo(() => (rows ?? []).filter((r) => !ranked || r.ranked), [rows, ranked]);
  const sum = useMemo(() => summarise(shown), [shown]);
  const days = useMemo(() => byDay(shown, tz), [shown]);

  if (!user) {
    return (
      <div className="records-screen">
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see your records.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </div>
    );
  }

  const step = (d: number) => setYm(({ y, m }) => { const t = new Date(y, m - 1 + d, 1); return { y: t.getFullYear(), m: t.getMonth() + 1 }; });
  const title = new Date(ym.y, ym.m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const [lo, hi] = wilson(sum.wins, sum.games);

  return (
    <div className="records-screen">
      <div className="tournaments-bar">
        <div className="seg-group" role="group" aria-label="Which matches">
          {[[false, 'All'], [true, 'Ranked']].map(([v, label]) => (
            <button key={String(label)} type="button" aria-pressed={ranked === v}
              className={`btn seg-btn${ranked === v ? ' is-active' : ''}`} onClick={() => { setRanked(v as boolean); setMore(SHOWN); }}>
              {label as string}
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={shown.length === 0} onClick={() => exportRecords(shown, tz)}>Export CSV</button>
      </div>

      {failed && rows === null && <p className="friend-notice" role="alert">Couldn't load your records.</p>}
      {rows === null && !failed && <p className="text-muted">Loading records…</p>}
      {rows && shown.length === 0 && <p className="panel text-muted">No confirmed matches here yet.</p>}

      {rows && shown.length > 0 && (
        <>
          <dl className="panel chamfer-9 records-tiles">
            <div><dt>Win rate</dt><dd data-testid="win-rate">{pct(sum.winRate ?? 0)}{sum.games < 30 && ` (${pct(lo)}–${pct(hi)})`}</dd></div>
            <div><dt>Games</dt><dd>{sum.wins}–{sum.games - sum.wins}</dd></div>
            <div><dt>Opponents</dt><dd>{sum.uniqueOpponents}</dd></div>
            <div><dt>Rounds</dt><dd>{sum.roundsWon}–{sum.roundsLost}</dd></div>
            {grit && <GritTile g={grit} />}
          </dl>

          <section className="panel chamfer-9 records-cal" aria-label="Calendar">
            <div className="records-cal-head">
              <button type="button" className="btn" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
              <strong>{title}</strong>
              <button type="button" className="btn" aria-label="Next month" onClick={() => step(1)}>›</button>
            </div>
            <div className="records-grid" role="grid">
              {monthGrid(ym.y, ym.m).flat().map((k, i) => {
                const t = k ? days.get(k) : undefined;
                return (
                  <div key={i} role="gridcell" className={`records-day${t ? ' has-games' : ''}`}>
                    {k && <span className="records-date">{Number(k.slice(8))}</span>}
                    {t && <span className="records-tally">{t.wins}–{t.losses}</span>}
                  </div>
                );
              })}
            </div>
            <p className="text-muted">Days are in your browser's timezone ({tz}).</p>
          </section>

          <section className="panel chamfer-9 records-history" aria-label="History">
            <ul>
              {shown.slice(0, more).map((r) => (
                <li key={r.matchId}>
                  <span className={r.won ? 'records-win' : 'records-loss'}>{r.won ? 'W' : 'L'}</span>
                  <span>{r.opponentName}</span>
                  <span className="text-muted">{r.league ? LEAGUE_BY_ID.get(r.league as LeagueId)?.label ?? r.league : r.source}{r.ranked ? ' · ranked' : ''}</span>
                  <span>{r.myRounds}–{r.oppRounds}</span>
                  <time dateTime={r.playedAt}>{new Date(r.playedAt).toLocaleDateString('en-CA', { timeZone: tz })}</time>
                </li>
              ))}
            </ul>
            {shown.length > more && <button type="button" className="btn" onClick={() => setMore(more + SHOWN)}>Show more</button>}
          </section>
        </>
      )}
    </div>
  );
}

/** Win rate in the game after a loss, over tournament rounds; independent of the Ranked/All switch. */
function GritTile({ g }: { g: Grit }) {
  const s = gritStatus(g);
  return (
    <div className="records-grit">
      <dt>Grit</dt>
      {s.ready
        ? <dd data-testid="grit">{pct(s.rate)}{g.postLossGames < 30 && ` (${pct(s.interval[0])}–${pct(s.interval[1])})`}<small className="text-muted"> after a loss, {g.postLossGames} games</small></dd>
        : <dd className="text-muted records-grit-note" data-testid="grit">{s.note}</dd>}
    </div>
  );
}
