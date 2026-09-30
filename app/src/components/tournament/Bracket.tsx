import { useMemo, useState, type ReactNode } from 'react';
import { isCounted, type Pairing } from '../../lib/tournaments';
import { playerName } from './playerName';

interface Props {
  pairings: readonly Pairing[]; names: ReadonlyMap<string, string>; players: number; rounds: number;
  currentRound: number; me: string | null; query?: string; now: Date;
}

/** Wraps case-insensitive matches of `q` in <mark>. */
function highlight(text: string, q: string): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function Row({ name, score, mark, lost, q }: { name: string; score: number | null; mark: string; lost: boolean; q: string }) {
  return (
    <div className="bracket-row">
      <span className="bracket-mark" aria-hidden="true">{mark}</span>
      <span className={`bracket-name${lost ? ' is-loser' : ''}`}>{highlight(name, q)}</span>
      <span className="numeric bracket-score">{score ?? ''}</span>
    </div>
  );
}

function Table({ p, names, me, now, q }: { p: Pairing; names: ReadonlyMap<string, string>; me: string | null; now: Date; q: string }) {
  const a = playerName(names, p.playerA);
  const b = p.playerB === null ? null : playerName(names, p.playerB);
  const shown = p.scoreA !== null && p.scoreB !== null && p.state !== 'pending';
  const counted = isCounted(p, now);
  const decided = counted && shown && p.scoreA !== p.scoreB;
  const dbl = counted && shown && p.scoreA === p.scoreB && p.playerB !== null;
  const aWon = decided && p.scoreA! > p.scoreB!;
  const tag = p.state === 'disputed' ? 'disputed' : dbl ? 'double loss' : shown && !counted ? 'reported' : null;
  let label: string;
  if (b === null) label = `${a} has a bye`;
  else if (dbl) label = `${a} and ${b}: double loss`;
  else if (decided) label = `${aWon ? a : b} won ${aWon ? p.scoreA : p.scoreB}–${aWon ? p.scoreB : p.scoreA} against ${aWon ? b : a}`;
  else label = `${a} versus ${b}, ${tag ?? 'not played'}`;
  const mine = !!me && (p.playerA === me || p.playerB === me);
  return (
    <div role="group" aria-label={label} className="bracket-table">
      <div className="bracket-table-head hud-label">
        <span>Table {p.tableNo}</span>
        {mine && <span className="bracket-you">You</span>}
        {tag && <span className="bracket-tag">{tag}</span>}
      </div>
      <Row name={a} score={shown ? p.scoreA : null} mark={dbl ? '✗' : decided ? (aWon ? '✓' : '✗') : ''} lost={dbl || (decided && !aWon)} q={q} />
      {b === null
        ? <div className="bracket-row"><span className="bracket-mark" aria-hidden="true" /><span className="bracket-name">Bye</span></div>
        : <Row name={b} score={shown ? p.scoreB : null} mark={dbl ? '✗' : decided ? (aWon ? '✗' : '✓') : ''} lost={dbl || (decided && aWon)} q={q} />}
    </div>
  );
}

export function Bracket({ pairings, names, players, rounds, currentRound, me, query = '', now }: Props) {
  const [q, setQ] = useState(query);
  const needle = q.trim().toLowerCase();
  const played = useMemo(() => [...new Set(pairings.map((p) => p.round))].sort((x, y) => x - y), [pairings]);
  const hit = (p: Pairing) => !needle
    || [p.playerA, p.playerB].some((id) => id !== null && playerName(names, id).toLowerCase().includes(needle));
  if (pairings.length === 0) return <p className="panel text-muted">No pairings yet</p>;
  const cols = played.map((r) => [r, pairings.filter((p) => p.round === r && hit(p))] as const).filter(([, ps]) => ps.length);
  return (
    <div className="bracket">
      <div className="bracket-head">
        <span className="hud-label">{currentRound} / {rounds} Rounds</span>
        <span className="hud-label">{players} Players</span>
        <label className="bracket-search">
          <span className="hud-label">Search players</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Opponent name" />
        </label>
        {q && <button type="button" className="btn" onClick={() => setQ('')}>Clear</button>}
      </div>
      {cols.length === 0 && <p className="text-muted">No matching players</p>}
      <div className="bracket-scroll" role="region" aria-label="Bracket, scrollable" tabIndex={0}>
        <div className="bracket-rounds">
          {cols.map(([r, ps]) => (
            <section key={r} className="bracket-col" aria-label={`Round ${r}`}>
              <h3 className="bracket-col-head">Round {r}</h3>
              {ps.map((p) => <Table key={p.id} p={p} names={names} me={me} now={now} q={needle} />)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
