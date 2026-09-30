import { supabase } from './supabase';
import { downloadCsv } from './exportData';

export interface RecordRow {
  matchId: string; playedAt: string; league: string | null; source: string; ranked: boolean;
  opponentId: string; opponentName: string; myRounds: number; oppRounds: number; won: boolean;
}
export interface Summary {
  games: number; wins: number; winRate: number | null; uniqueOpponents: number; roundsWon: number; roundsLost: number;
}
export interface DayTally { wins: number; losses: number }

const PAGE = 500;
const MAX_PAGES = 20;

/** Newest first. Paged: the hosted API caps rows per response. */
export async function listMyRecords(): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await supabase.from('my_match_records').select('*')
      .order('played_at', { ascending: false }).order('match_id').range(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      out.push({
        matchId: r.match_id, playedAt: r.played_at, league: r.league, source: r.source, ranked: r.ranked,
        opponentId: r.opponent_id, opponentName: r.opponent_name, myRounds: r.my_rounds, oppRounds: r.opp_rounds, won: r.won,
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

export function summarise(rows: readonly RecordRow[]): Summary {
  const wins = rows.filter((r) => r.won).length;
  return {
    games: rows.length, wins, winRate: rows.length ? wins / rows.length : null,
    uniqueOpponents: new Set(rows.map((r) => r.opponentId)).size,
    roundsWon: rows.reduce((n, r) => n + r.myRounds, 0), roundsLost: rows.reduce((n, r) => n + r.oppRounds, 0),
  };
}

/** Wilson 95% interval: a 3-from-4 record must not read as a 75% trait. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** "YYYY-MM-DD" of an instant as seen in `tz`. */
export const dayKey = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function byDay(rows: readonly RecordRow[], tz: string): Map<string, DayTally> {
  const days = new Map<string, DayTally>();
  for (const r of rows) {
    const k = dayKey(r.playedAt, tz);
    const t = days.get(k) ?? { wins: 0, losses: 0 };
    if (r.won) t.wins++; else t.losses++;
    days.set(k, t);
  }
  return days;
}

/** Sunday-first weeks of "YYYY-MM-DD" keys for `month` (1-12); null pads the ends. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

export const toCsvRows = (rows: readonly RecordRow[], tz: string): Record<string, unknown>[] =>
  rows.map((r) => ({
    date: dayKey(r.playedAt, tz), played_at: r.playedAt, opponent: r.opponentName, league: r.league ?? '',
    ranked: r.ranked ? 'yes' : 'no', source: r.source, result: r.won ? 'win' : 'loss',
    my_rounds: r.myRounds, opponent_rounds: r.oppRounds, match_id: r.matchId,
  }));

export const exportRecords = (rows: readonly RecordRow[], tz: string) => downloadCsv('paragon-matches', toCsvRows(rows, tz));
