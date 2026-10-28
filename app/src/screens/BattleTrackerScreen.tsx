import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sprite } from '../components/Sprite';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { TypeBadge } from '../components/TypeBadge';
import { TrainerAvatar, useProfiles } from '../components/TrainerBits';
import { confirmDialog } from '../components/ConfirmDialog';
import { HudLabel } from '../components/Hud';
import { displayName, movesFor, parseRef, speciesOf } from '../lib/data';
import { DEFAULT_TIER, fieldPool } from '../lib/rankings';
import { PRESET_FORMATS, cupLegal } from '../lib/presetFormats';
import type { LeagueId } from '../lib/types';
import type { Profile } from '../lib/profile';
import { monthGrid } from '../lib/records';
import {
  CURRENT_SEASON, DAILY_BATTLES, DAY_SIZES, ELO_MAX, MAX_ALTS, NO_MOVES, SET_SIZE, TIERS,
  addAccount, addBattle, daySize, listDaySizes, setDaySize, deleteAccount, deleteGblTeam, listGblTeams, saveGblTeam, listAccounts, onAccount, renameAccount, backdatedAt, battlesByDay, battlesToday, byFormat, deleteBattle, deleteSet, eloSeries, exportSeason, fromLocalDay, getPublic,
  knowsAny, lastElo, leaderboard, removeBattle, restoreBattle, listMySets, localDay, meta, nextTier, recap, seasonSets, seasonTotals, setPublic, startSet, summaryOf,
  tallyOf, tierOf, todaysSets, updateBattle, updateSet,
  type GblAccount, type GblBattle, type GblTeam, type GblResult, type GblSet, type GblSetSummary, type LadderRow, type Meta, type OppMoves, type Tally, type Tier,
} from '../lib/gbl';

type View = 'log' | 'meta' | 'stats' | 'ladder';
const VIEWS: [View, string][] = [['log', 'Log'], ['meta', 'Meta'], ['stats', 'Stats'], ['ladder', 'Ladder']];

/** Remembered per browser: which format you play is a habit, not a setting worth an account column. */
const FORMAT_KEY = 'gbl-tracker-format';
const readFormat = (): string => {
  try { return localStorage.getItem(FORMAT_KEY) ?? 'great'; } catch { return 'great'; }
};

const byStart = (a: GblSet, b: GblSet) => a.startedAt.localeCompare(b.startedAt);
const formatOf = (key: string) => PRESET_FORMATS.find((p) => p.key === key) ?? PRESET_FORMATS[0];
const formatName = (key: string) => formatOf(key).name;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const record = (t: Pick<Tally, 'wins' | 'losses' | 'ties'>) => `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const typeVar = (type: string): CSSProperties => ({ ['--type' as string]: `var(--type-${type})` } as CSSProperties);

/** The format's top ranked Pokémon, cup-legal: the quick picks. */
function topRefs(formatKey: string, n: number): string[] {
  const base = formatOf(formatKey).base;
  const legal = cupLegal(formatKey);
  return fieldPool(base, DEFAULT_TIER(base), 600).filter((r) => !legal || legal.has(r)).slice(0, n);
}

/** A species ref as a sprite with its name: the tracker's one way of drawing a Pokémon. */
function Mon({ refId, size = 40, label = true }: { refId: string; size?: number; label?: boolean }) {
  const sp = speciesOf(refId);
  if (!sp) return <span className="gt-mon is-unknown">{refId}</span>;
  return (
    <span className="gt-mon" title={displayName(refId)}>
      <Sprite sprite={sp.sprite} dex={sp.dex} size={size} shadow={parseRef(refId).shadow} />
      {label && <span className="gt-mon-name">{displayName(refId)}</span>}
    </span>
  );
}

function TierBadge({ elo }: { elo: number | null }) {
  if (elo === null) return null;
  const t = tierOf(elo);
  return <span className={`gt-tier is-${t.id}`}>{t.label}</span>;
}

/** The account the tracker opens on, remembered per browser; null is the main account. */
const ACCOUNT_KEY = 'gbl-tracker-account';
const readAccount = (): string | null => {
  try { return localStorage.getItem(ACCOUNT_KEY); } catch { return null; }
};

/** The 25, 50 or 100 picked for each `account:day`, as this browser last saw it: shown until the saved sizes load. */
const SIZE_KEY = 'gbl-tracker-day-size';
const readSizes = (): Record<string, number> => {
  try { return (JSON.parse(localStorage.getItem(SIZE_KEY) ?? '{}') as Record<string, number> | null) ?? {}; } catch { return {}; }
};

/**
 * Today's calendar day, which changes at local midnight while the screen is open: a session played across midnight
 * starts a fresh day (its own sets from one, its own 25), as GO's daily limit does, with no reload.
 */
export function useLocalDay(): string {
  const [today, setToday] = useState(() => localDay(new Date()));
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // A sleeping phone fires this late, on waking; the half second keeps an early tick from reading yesterday.
    const t = window.setTimeout(() => setToday(localDay(new Date())), midnight.getTime() - now.getTime() + 500);
    return () => window.clearTimeout(t);
  }, [today]);
  return today;
}

export function BattleTrackerScreen() {
  const { patch } = useAppState();
  // Re-renders the whole tracker at midnight, so Today, the calendar and the day's session all move on together.
  const today = useLocalDay();
  const { user } = useSession();
  const [view, setView] = useState<View>('log');
  // The current season only: the tracker is a notebook for the season being played.
  const season = CURRENT_SEASON;
  const [format, setFormatState] = useState(readFormat);
  const [sets, setSets] = useState<GblSet[] | null>(null);
  const [accounts, setAccounts] = useState<GblAccount[]>([]);
  const [account, setAccountState] = useState<string | null>(readAccount);
  const [error, setError] = useState<string | null>(null);
  const setFormat = (f: string) => {
    setFormatState(f);
    try { localStorage.setItem(FORMAT_KEY, f); } catch { /* private window: forget it */ }
  };
  const setAccount = (id: string | null) => {
    setAccountState(id);
    try { if (id) localStorage.setItem(ACCOUNT_KEY, id); else localStorage.removeItem(ACCOUNT_KEY); } catch { /* as above */ }
  };

  const uid = user?.id ?? null;
  const profiles = useProfiles(uid ? [uid] : []);
  const mainName = (uid && profiles.get(uid)?.goUsername) || 'Main account';
  useEffect(() => {
    if (!uid) return;
    let live = true;
    setSets(null);
    listMySets(season).then((s) => live && setSets(s)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [uid, season]);
  useEffect(() => {
    if (!uid) return;
    let live = true;
    listAccounts().then((a) => live && setAccounts(a)).catch(() => {});
    return () => { live = false; };
  }, [uid]);

  if (!user) {
    return (
      <>
        <ScreenHeader title="Battle Tracker" blurb="A notebook for GO Battle League: every set, every Elo change, all season." />
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to keep your GBL notebook.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </>
    );
  }

  // A remembered alt that has since been deleted falls back to the main account.
  const active = account && accounts.some((x) => x.id === account) ? account : null;
  const label = active ? accounts.find((x) => x.id === active)!.name : mainName;
  const mine = sets ? onAccount(sets, active) : null;
  // The Log edits one account's sets; the others ride along untouched.
  const setMine = (next: GblSet[]) => setSets([...(sets ?? []).filter((x) => x.accountId !== active), ...next].sort(byStart));

  return (
    <div className="gt">
      <ScreenHeader
        title="Battle Tracker"
        blurb="A notebook for GO Battle League: log each battle as you play it, write down your Elo after each set, and see the season, the live meta and the ladder."
      />
      <div className="gt-bar">
        <div className="seg-group gt-views" role="tablist" aria-label="Tracker view">
          {VIEWS.map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v}
              className={`btn seg-btn${view === v ? ' is-active' : ''}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <label className="gt-field">
          <span className="hud-label">Format</span>
          <select className="input gt-select" value={format} onChange={(e) => setFormat(e.target.value)}>
            {PRESET_FORMATS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
      </div>
      {view !== 'meta' && view !== 'ladder' && (
        <AccountBar mainName={mainName} accounts={accounts} active={active} onPick={setAccount} onAccounts={setAccounts}
          onDeleted={(id) => { setSets((sets ?? []).filter((x) => x.accountId !== id)); if (active === id) setAccount(null); }} />
      )}

      {error && <p className="friend-notice" role="alert">{error}</p>}
      {view === 'log' && (mine
        ? <LogView key={active ?? 'main'} season={season} format={format} accountId={active} today={today} sets={mine} setSets={setMine} onError={setError} />
        : <p className="text-muted">Loading your season…</p>)}
      {view === 'meta' && <MetaView format={format} />}
      {view === 'stats' && <StatsView key={active ?? 'main'} userId={user.id} accountId={active} season={season} mine={mine} name={label} self />}
      {view === 'ladder' && <LadderView season={season} />}
    </div>
  );
}

/**
 * Which GO account is being logged: the main one, named after the trainer on
 * the profile, and up to two alts. Each has its own Elo, its own battles a day and
 * its own row on the ladder. Alts are added, renamed and removed here.
 */
function AccountBar({ mainName, accounts, active, onPick, onAccounts, onDeleted }: {
  mainName: string; accounts: GblAccount[]; active: string | null; onPick: (id: string | null) => void;
  onAccounts: (a: GblAccount[]) => void; onDeleted: (id: string) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try { await f(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    const a = await addAccount(draft);
    onAccounts([...accounts, a]);
    setDraft('');
    onPick(a.id);
  });
  const rename = (a: GblAccount) => run(async () => {
    const name = (names[a.id] ?? a.name).trim();
    await renameAccount(a.id, name);
    onAccounts(accounts.map((x) => (x.id === a.id ? { ...x, name } : x)));
  });
  const remove = (a: GblAccount) => run(async () => {
    const ok = await confirmDialog({
      title: `Delete ${a.name}?`,
      body: `Every set and battle logged on ${a.name} is deleted with it. Your main account and other alt are not touched.`,
      confirmLabel: 'Delete alt and its logs',
    });
    if (!ok) return;
    await deleteAccount(a.id);
    onAccounts(accounts.filter((x) => x.id !== a.id));
    onDeleted(a.id);
  });

  return (
    <div className="gt-accounts">
      <div className="gt-accounts-bar">
        <span className="hud-label">Account</span>
        <div className="seg-group" role="group" aria-label="GO account">
          <button type="button" className={`btn seg-btn${active === null ? ' is-active' : ''}`} aria-pressed={active === null} onClick={() => onPick(null)}>
            <span className="gt-acct-kind">Main</span> {mainName}
          </button>
          {accounts.map((a) => (
            <button key={a.id} type="button" className={`btn seg-btn${active === a.id ? ' is-active' : ''}`} aria-pressed={active === a.id} onClick={() => onPick(a.id)}>
              <span className="gt-acct-kind">Alt</span> {a.name}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" aria-expanded={managing} onClick={() => setManaging(!managing)}>
          {accounts.length < MAX_ALTS ? '＋ Alt account' : 'Manage alts'}
        </button>
      </div>
      {managing && (
        <section className="panel chamfer-9 gt-accounts-panel anim-rise" aria-label="Alternate accounts">
          <p className="text-muted gt-hint">
            Up to {MAX_ALTS} alternate GO accounts besides {mainName}, named after their in-game trainer. Each keeps its own Elo, its own battles a day and its own place on the ladder.
          </p>
          {accounts.map((a) => (
            <div key={a.id} className="gt-acct-row">
              <input className="input" aria-label={`Rename ${a.name}`} maxLength={30} value={names[a.id] ?? a.name}
                onChange={(e) => setNames({ ...names, [a.id]: e.target.value })} />
              <button type="button" className="btn" disabled={busy || !(names[a.id] ?? a.name).trim() || (names[a.id] ?? a.name).trim() === a.name} onClick={() => rename(a)}>Rename</button>
              <button type="button" className="btn btn-ghost gt-danger" disabled={busy} onClick={() => remove(a)}>Delete</button>
            </div>
          ))}
          {accounts.length < MAX_ALTS ? (
            <form className="gt-acct-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void add(); }}>
              <input className="input" aria-label="New alt's trainer name" placeholder="Alt's trainer name" maxLength={30} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>Add alt</button>
            </form>
          ) : (
            <p className="text-faint gt-hint">That's the most — delete one to add another.</p>
          )}
          {problem && <p className="friend-notice" role="alert">{problem}</p>}
        </section>
      )}
    </div>
  );
}

// ── Log ─────────────────────────────────────────────────────────────────────

type Target = { kind: 'opp' | 'team'; slot: number };
const EMPTY3 = ['', '', ''];
const NO_MOVES3: OppMoves[] = [NO_MOVES, NO_MOVES, NO_MOVES];

/**
 * Logging: live into today, or — for a day that was played and never written
 * down — into any past day picked from the calendar. A day is its own page of
 * the notebook: its own sets numbered from one, its own limit of 25, 50 or 100.
 */
function LogView({ season, format, accountId, today, sets, setSets, onError }: {
  season: number; format: string; accountId: string | null; today: string; sets: GblSet[]; setSets: (s: GblSet[]) => void; onError: (m: string | null) => void;
}) {
  // null: today, logged live.
  const [dayKey, setDayKey] = useState<string | null>(null);
  const day = useMemo(() => fromLocalDay(dayKey ?? today), [dayKey, today]);
  const backlog = dayKey !== null;
  const daySets = todaysSets(sets, day);
  const last = daySets.at(-1) ?? null;
  // A set is open until five battles are in and an Elo (or a skip) closes it.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const awaitingElo = last && last.battles.length >= SET_SIZE && last.eloEnd === null && !skipped.has(last.id) ? last : null;
  const open = last && last.battles.length < SET_SIZE && last.format === format && last.eloEnd === null ? last : null;
  const [opps, setOpps] = useState<string[]>(EMPTY3);
  const [moves, setMoves] = useState<OppMoves[]>(NO_MOVES3);
  const [note, setNote] = useState('');
  const lastTeam = sets.at(-1)?.team ?? [];
  const [team, setTeam] = useState<string[]>(() => [...lastTeam, '', '', ''].slice(0, 3));
  const [target, setTarget] = useState<Target>({ kind: 'opp', slot: 0 });
  const [busy, setBusy] = useState(false);
  // The last battle deleted from the table, until Restore, the next log or another day.
  const [removed, setRemoved] = useState<{ battle: GblBattle; set: GblSet; setGone: boolean; label: string } | null>(null);
  // The logging panel is a modal, opened from the table's + row.
  const [adding, setAdding] = useState(false);
  const played = battlesToday(sets, day);
  // 25 a day, 50 on a GO Battle Thursday, 100 in GO Battle Week: picked per day, never below what is logged.
  // Saved with the player, so every device agrees; this browser's copy fills in until they load.
  const [sizes, setSizes] = useState(readSizes);
  useEffect(() => {
    let live = true;
    listDaySizes().then((saved) => live && setSizes((s) => ({ ...s, ...saved }))).catch(() => {});
    return () => { live = false; };
  }, []);
  const sizeKey = (k: string) => `${accountId ?? 'main'}:${k}`;
  const limit = daySize(played, sizes[sizeKey(localDay(day))]);
  const pickLimit = (n: number) => {
    const k = localDay(day);
    const next = { ...sizes, [sizeKey(k)]: n };
    setSizes(next);
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(next)); } catch { /* private window: forget it */ }
    setDaySize(accountId, k, n).catch((e: Error) => onError(`The day size was not saved: ${e.message}`));
  };
  const full = played >= limit;
  const [teams, setTeams] = useState<GblTeam[] | null>(null);
  useEffect(() => {
    let live = true;
    listGblTeams().then((t) => live && setTeams(t)).catch(() => live && setTeams([]));
    return () => { live = false; };
  }, []);
  const picks = useMemo(() => topRefs(format, 12), [format]);
  const legal = useMemo(() => cupLegal(format), [format]);

  // A finished set waiting for its Elo stays on show until it is closed.
  const shown = open ?? awaitingElo;
  const setNo = shown ? daySets.indexOf(shown) + 1 : daySets.length + 1;
  const battles = shown?.battles ?? [];
  const tally = tallyOf(battles);
  const editing = target.kind === 'opp' && opps[target.slot] ? target.slot : null;

  const place = (ref: string) => {
    if (target.kind === 'opp') {
      const next = [...opps];
      next[target.slot] = ref;
      setOpps(next);
      setMoves(moves.map((m, i) => (i === target.slot ? NO_MOVES : m)));
      // Move on to the next empty slot, as a player reveals the next Pokémon.
      const free = next.findIndex((r, i) => !r && i > target.slot);
      if (free >= 0) setTarget({ kind: 'opp', slot: free });
    } else {
      const next = [...team];
      next[target.slot] = ref;
      setTeam(next);
      if (target.slot < 2) setTarget({ kind: 'team', slot: target.slot + 1 });
    }
  };
  const clear = (kind: Target['kind'], i: number) => {
    if (kind === 'opp') {
      setOpps(opps.map((r, j) => (j === i ? '' : r)));
      setMoves(moves.map((m, j) => (j === i ? NO_MOVES : m)));
    } else setTeam(team.map((r, j) => (j === i ? '' : r)));
  };

  const replace = (s: GblSet) => setSets(sets.map((x) => (x.id === s.id ? s : x)));

  const log = useCallback(async (result: GblResult | null) => {
    if (busy || awaitingElo || full) return;
    setBusy(true);
    onError(null);
    try {
      const at = backlog ? backdatedAt(daySets, day) : undefined;
      let set = open;
      let all = sets;
      if (!set) {
        // The Elo a set starts at is the last one written down before it — on a past day, before that moment.
        const before = at ? sets.filter((x) => x.startedAt < at) : sets;
        set = await startSet({ season, format, team: team.filter(Boolean), eloStart: lastElo(before), startedAt: at, accountId });
        all = [...sets, set].sort(byStart);
      }
      const kept = opps.map((r, i) => [r, moves[i]] as const).filter(([r]) => r);
      const b = await addBattle(set.id, set.battles.length + 1, result, kept.map(([r]) => r), {
        moves: kept.map(([, m]) => m), note, playedAt: at,
      });
      const grown = { ...set, battles: [...set.battles, b] };
      setSets(all.map((x) => (x.id === grown.id ? grown : x)));
      setOpps(EMPTY3);
      setMoves(NO_MOVES3);
      setNote('');
      setTarget({ kind: 'opp', slot: 0 });
      setAdding(false);
      setRemoved(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, awaitingElo, full, backlog, daySets, day, open, sets, season, format, accountId, team, opps, moves, note, setSets, onError]);

  const undo = async () => {
    const s = last;
    if (!s || busy) return;
    setBusy(true);
    try {
      const b = s.battles.at(-1);
      if (b) {
        await deleteBattle(b.id);
        setOpps([...b.opponents, '', '', ''].slice(0, 3));
        setMoves([...b.opponentMoves, NO_MOVES, NO_MOVES, NO_MOVES].slice(0, 3));
        setNote(b.note ?? '');
      }
      if (s.battles.length <= 1) {
        await deleteSet(s.id);
        setSets(sets.filter((x) => x.id !== s.id));
      } else {
        replace({ ...s, battles: s.battles.slice(0, -1) });
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: GblSet, b: GblBattle) => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const rest = await removeBattle(s, b);
      // A set left with nothing in it goes too, as Undo does.
      if (!rest.length) await deleteSet(s.id);
      setSets(rest.length ? sets.map((x) => (x.id === s.id ? { ...s, battles: rest } : x)) : sets.filter((x) => x.id !== s.id));
      setRemoved({ battle: b, set: s, setGone: !rest.length, label: `Set ${daySets.indexOf(s) + 1}, battle ${b.idx}` });
    } catch (e) {
      onError(`${(e as Error).message} — reload to see the day as saved.`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!removed || busy) return;
    const { battle: b, set: was, setGone } = removed;
    setBusy(true);
    onError(null);
    try {
      if (setGone) {
        const s = await startSet({ season: was.season, format: was.format, team: was.team, eloStart: was.eloStart, startedAt: was.startedAt, accountId: was.accountId });
        if (was.eloEnd !== null) await updateSet(s.id, { eloEnd: was.eloEnd });
        const back = await addBattle(s.id, 1, b.result, b.opponents, { moves: b.opponentMoves, note: b.note, playedAt: b.playedAt });
        setSets([...sets, { ...s, eloEnd: was.eloEnd, battles: [back] }].sort(byStart));
      } else {
        const now = sets.find((x) => x.id === was.id)!;
        const battles = await restoreBattle(now, b);
        setSets(sets.map((x) => (x.id === now.id ? { ...now, battles } : x)));
      }
      setRemoved(null);
    } catch (e) {
      onError(`${(e as Error).message} — reload to see the day as saved.`);
    } finally {
      setBusy(false);
    }
  };

  // While the panel is open: W, T and L log a battle from the keyboard, unless a field has focus; Escape closes it.
  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAdding(false); return; }
      const typing = e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]');
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return;
      const r = ({ w: 'win', t: 'tie', l: 'loss' } as Record<string, GblResult>)[e.key.toLowerCase()];
      if (r) { e.preventDefault(); void log(r); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, adding]);

  const slot = (kind: Target['kind'], i: number, ref: string, label: string) => {
    const active = target.kind === kind && target.slot === i;
    const m = kind === 'opp' ? moves[i] : undefined;
    return (
      <button key={`${kind}${i}`} type="button" className={`gt-slot${active ? ' is-active' : ''}${ref ? ' is-filled' : ''}`}
        aria-pressed={active} onClick={() => setTarget({ kind, slot: i })} onDoubleClick={() => clear(kind, i)}
        title={ref ? `${displayName(ref)} — ${kind === 'opp' ? 'select to set the moves you saw; ' : ''}double-click to clear` : `Pick ${label}`}>
        <span className="gt-slot-label">{label}</span>
        {ref ? <Mon refId={ref} size={40} /> : <span className="gt-slot-empty"><span className="gt-slot-q" aria-hidden="true">?</span><span className="gt-slot-unseen">Unseen</span></span>}
        {kind === 'opp' && ref && <MovesLine refId={ref} moves={m!} format={format} />}
      </button>
    );
  };

  const dayLabel = backlog ? day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Today';
  // The battle the + row adds, as GO numbers it: set and place in the set.
  const nextSet = open ? setNo : daySets.length + 1;
  const nextInSet = open ? open.battles.length + 1 : 1;

  return (
    <div className="gt-log">
      <DayPicker sets={sets} value={dayKey} limitOf={(k, n) => daySize(n, sizes[sizeKey(k)])} onChange={(k) => { setDayKey(k); setSkipped(new Set()); setAdding(false); setRemoved(null); }} />

      {removed && (
        <div className="friend-notice gt-size-warn" role="status">
          <span>{removed.label} deleted.</span>
          <span>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={restore}>Restore</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setRemoved(null)}>✕</button>
          </span>
        </div>
      )}

      {awaitingElo && (
        <EloEntry set={awaitingElo} index={daySets.indexOf(awaitingElo) + 1}
          onDone={async (elo) => {
            try { await updateSet(awaitingElo.id, { eloEnd: elo }); replace({ ...awaitingElo, eloEnd: elo }); } catch (e) { onError((e as Error).message); }
          }}
          onSkip={() => setSkipped(new Set([...skipped, awaitingElo.id]))} />
      )}

      <BattleTable key={dayKey ?? 'today'} sets={daySets} title={dayLabel} format={format} backlog={backlog}
        played={played} limit={limit} onLimit={pickLimit} next={{ set: nextSet, inSet: nextInSet }} blocked={awaitingElo ? `Write down Set ${daySets.indexOf(awaitingElo) + 1}'s Elo above first` : null}
        busy={busy} onAdd={() => setAdding(true)} onUndo={() => { setRemoved(null); void undo(); }} onDelete={remove} onSaved={replace} onError={onError} />

      {adding && createPortal(
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdding(false); }}>
          <div className={`modal-panel gt-modal${backlog ? ' is-backlog' : ''}`} role="dialog" aria-modal="true" aria-label={`Log battle ${played + 1}`}
            tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>
            <div className="modal-head">
              <span className="hud-label">Battle {played + 1} of {limit} · {dayLabel}</span>
              <button type="button" className="btn btn-sm" onClick={() => setAdding(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body gt-set">
              <div className="gt-set-head">
                <div>
                  <div className="gt-set-title">Set {setNo} <span className="numeric gt-set-record">{record(tally)}</span></div>
                  <div className="hud-label">
                    Battle {Math.min(battles.length + 1, SET_SIZE)} of {SET_SIZE} · {formatName(format)}
                    {backlog && <> · <span className="gt-backlog-tag">Backlog · {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></>}
                  </div>
                </div>
                <ol className="gt-pips" aria-label="This set's battles">
                  {Array.from({ length: SET_SIZE }, (_, i) => {
                    const b = battles[i];
                    const cls = b ? `is-${b.result ?? 'none'}` : i === battles.length ? 'is-next' : '';
                    return <li key={i} className={`gt-pip ${cls}`} aria-label={b ? `Battle ${i + 1}: ${b.result ?? 'no result'}` : `Battle ${i + 1}`} />;
                  })}
                </ol>
                <div className={`gt-today${full ? ' is-full' : ''}`} title={`${limit} battles ${backlog ? 'that day' : 'today'}`}>
                  <b className="numeric">{played}</b><i>/{limit} {backlog ? 'that day' : 'today'}</i>
                  <span className="gt-today-bar"><span style={{ width: `${Math.min(100, (played / limit) * 100)}%` }} /></span>
                </div>
              </div>

              <div className="gt-slots-row">
                <div className="gt-slots" role="group" aria-label="Your team">
                  <span className="hud-label">Your team</span>
                  <div className="gt-slot-grid">{team.map((r, i) => slot('team', i, r, i === 0 ? 'Lead' : `Slot ${i + 1}`))}</div>
                  <SavedTeams team={team} teams={teams} legal={legal} onTeams={setTeams} onPick={setTeam} onError={onError} />
                </div>
                <div className="gt-slots" role="group" aria-label="Opponent">
                  <span className="hud-label">Opponent</span>
                  <div className="gt-slot-grid">{opps.map((r, i) => slot('opp', i, r, i === 0 ? 'Lead' : `Slot ${i + 1}`))}</div>
                </div>
              </div>

              {editing !== null && (
                <MoveEditor refId={opps[editing]} format={format} value={moves[editing]}
                  onChange={(m) => setMoves(moves.map((x, i) => (i === editing ? m : x)))} />
              )}

              <div className="gt-pick">
                <SpeciesSearch id="gt-search" value="" startEmpty includeShadow restrictTo={legal ?? undefined} onChange={place}
                  placeholder={`Search — fills ${target.kind === 'opp' ? "the opponent's" : 'your'} ${target.slot === 0 ? 'lead' : `slot ${target.slot + 1}`}`} />
                <div className="gt-quick" aria-label={`Top ${picks.length} in ${formatName(format)}`}>
                  {picks.map((r, i) => (
                    <button key={r} type="button" className="gt-quick-mon" onClick={() => place(r)} title={`#${i + 1} ${displayName(r)}`}>
                      <span className="gt-quick-rank numeric">{i + 1}</span>
                      <Mon refId={r} size={56} />
                    </button>
                  ))}
                </div>
              </div>

              <label className="gt-note">
                <span className="hud-label">Note for this battle</span>
                <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional — a read, a misplay, what they baited with. Only you can see it." />
              </label>

              <div className="gt-actions">
                {(['win', 'tie', 'loss'] as const).map((r) => (
                  <button key={r} type="button" className={`gt-result is-${r}`} disabled={busy || !!awaitingElo || full} onClick={() => log(r)}
                    aria-keyshortcuts={r[0].toUpperCase()}>
                    {r === 'win' ? 'Win' : r === 'tie' ? 'Tie' : 'Loss'}
                  </button>
                ))}
                <button type="button" className="btn gt-skip" disabled={busy || !!awaitingElo || full} onClick={() => log(null)} title="Log the battle without a result">
                  Skip outcome
                </button>
              </div>
              <p className="gt-hint gt-keys text-faint">Keys: <kbd>W</kbd> <kbd>T</kbd> <kbd>L</kbd>, <kbd>Esc</kbd> to close. Picks fill the highlighted slot; select a filled opponent to set its moves; double-click a slot to clear it.</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * The backlog calendar: each day of a month with how many battles it holds of
 * its limit (25, 50 or 100). Picking a past day logs into it; Today returns to live logging.
 */
function DayPicker({ sets, value, limitOf, onChange }: {
  sets: GblSet[]; value: string | null; limitOf: (day: string, played: number) => number; onChange: (k: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const todayKey = localDay(new Date());
  const shown = value ? fromLocalDay(value) : new Date();
  const [ym, setYm] = useState({ y: shown.getFullYear(), m: shown.getMonth() + 1 });
  const counts = useMemo(() => battlesByDay(sets), [sets]);
  const step = (d: number) => setYm(({ y, m }) => { const t = new Date(y, m - 1 + d, 1); return { y: t.getFullYear(), m: t.getMonth() + 1 }; });
  const thisMonth = ym.y === new Date().getFullYear() && ym.m === new Date().getMonth() + 1;
  return (
    <div className="gt-day">
      <div className="gt-day-bar">
        <button type="button" className={`btn gt-day-btn${value ? ' is-backlog' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">▦</span> {value ? `Backlog: ${shown.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Today'} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        {value && <button type="button" className="btn btn-ghost" onClick={() => { onChange(null); setOpen(false); }}>Back to today</button>}
        {!open && !value && <span className="text-faint gt-hint">Forgot a day? Open the calendar to fill it in.</span>}
      </div>
      {open && (
        <section className="panel chamfer-9 gt-cal anim-rise" aria-label="Pick a day to log">
          <div className="gt-cal-head">
            <button type="button" className="btn btn-sm" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
            <b>{new Date(ym.y, ym.m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
            <button type="button" className="btn btn-sm" aria-label="Next month" disabled={thisMonth} onClick={() => step(1)}>›</button>
          </div>
          <div className="gt-cal-grid" role="grid">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="gt-cal-dow" aria-hidden="true">{d}</span>)}
            {monthGrid(ym.y, ym.m).flat().map((k, i) => {
              if (!k) return <span key={i} />;
              const n = counts.get(k) ?? 0;
              const of = limitOf(k, n);
              const future = k > todayKey;
              const sel = (value ?? todayKey) === k;
              return (
                <button key={k} type="button" role="gridcell" disabled={future} aria-selected={sel}
                  className={`gt-cal-day${sel ? ' is-sel' : ''}${k === todayKey ? ' is-today' : ''}${n >= of ? ' is-full' : n ? ' has-battles' : ''}`}
                  style={{ ['--fill' as string]: `${Math.min(100, (n / of) * 100)}%` } as CSSProperties}
                  aria-label={`${k}: ${n} of ${of} battles logged`}
                  onClick={() => { onChange(k === todayKey ? null : k); setOpen(false); }}>
                  <span className="gt-cal-date">{Number(k.slice(8))}</span>
                  <span className="gt-cal-n numeric">{n ? `${n}/${of}` : ''}</span>
                </button>
              );
            })}
          </div>
          <p className="text-faint gt-hint">Days are your local calendar. A full day has {DAILY_BATTLES} battles, GO's daily limit — or the 50 or 100 you set for it.</p>
        </section>
      )}
    </div>
  );
}

/** PvPoke's rated set for a ref in the format: what an unseen move is assumed to be, shown as such. */
function ratedFor(refId: string, format: string) {
  const sp = speciesOf(refId);
  return sp ? movesFor(sp, formatOf(format).base as LeagueId, parseRef(refId).shadow) : null;
}
const moveName = (refId: string, id: string) => {
  const sp = speciesOf(refId);
  return [...(sp?.fastMoves ?? []), ...(sp?.chargeMoves ?? [])].find((m) => m.id === id)?.name ?? id;
};

/** One opponent's moves, compact: those seen in full, the rest as the rated default, faded. */
function MovesLine({ refId, moves, format }: { refId: string; moves: OppMoves; format: string }) {
  const rated = ratedFor(refId, format);
  if (!rated) return null;
  const fast = moves.fast ?? rated.fast.id;
  const charges = [...moves.charges, ...rated.charges.map((c) => c.id).filter((c) => !moves.charges.includes(c))].slice(0, 2);
  const seen = (id: string) => id === moves.fast || moves.charges.includes(id);
  return (
    <span className="gt-moves-line" title={knowsAny(moves) ? 'Faded: not seen, assumed from the rated set' : 'Nothing seen yet — showing the rated set'}>
      {[fast, ...charges].map((id) => <span key={id} className={seen(id) ? 'is-seen' : 'is-assumed'}>{moveName(refId, id)}</span>)}
    </span>
  );
}

/**
 * The moves seen on one opponent Pokémon: one fast, up to two charged, each a
 * toggle. Rated moves come first and are marked, since they are what most
 * players run; everything else it can learn follows.
 */
function MoveEditor({ refId, format, value, onChange }: { refId: string; format: string; value: OppMoves; onChange: (m: OppMoves) => void }) {
  const sp = speciesOf(refId);
  const rated = ratedFor(refId, format);
  if (!sp || !rated) return null;
  const ratedIds = new Set([rated.fast.id, ...rated.charges.map((c) => c.id)]);
  const order = <T extends { id: string }>(l: T[]) => [...l.filter((m) => ratedIds.has(m.id)), ...l.filter((m) => !ratedIds.has(m.id))];
  const toggleCharge = (id: string) => {
    const has = value.charges.includes(id);
    // At two, the oldest pick gives way, so a tap always does something.
    onChange({ ...value, charges: has ? value.charges.filter((c) => c !== id) : [...value.charges, id].slice(-2) });
  };
  return (
    <section className="gt-move-editor anim-rise" aria-label={`Moves seen on ${displayName(refId)}`}>
      <div className="gt-move-editor-head">
        <Mon refId={refId} size={32} />
        <span className="text-faint gt-hint">Tap the moves you saw. Anything left unset stays unknown.</span>
        {knowsAny(value) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(NO_MOVES)}>Clear</button>}
      </div>
      <div className="gt-move-group" role="group" aria-label="Fast move">
        <span className="hud-label">Fast</span>
        {order(sp.fastMoves).map((m) => (
          <button key={m.id} type="button" className={`gt-move-chip${value.fast === m.id ? ' is-on' : ''}${ratedIds.has(m.id) ? ' is-rated' : ''}`}
            aria-pressed={value.fast === m.id} style={typeVar(m.type)} onClick={() => onChange({ ...value, fast: value.fast === m.id ? null : m.id })}>
            {m.name}
          </button>
        ))}
      </div>
      <div className="gt-move-group" role="group" aria-label="Charged moves">
        <span className="hud-label">Charged</span>
        {order(sp.chargeMoves).map((m) => (
          <button key={m.id} type="button" className={`gt-move-chip${value.charges.includes(m.id) ? ' is-on' : ''}${ratedIds.has(m.id) ? ' is-rated' : ''}`}
            aria-pressed={value.charges.includes(m.id)} style={typeVar(m.type)} onClick={() => toggleCharge(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Closing a set: the Elo the game shows after its fifth battle. */
function EloEntry({ set, index, onDone, onSkip }: { set: GblSet; index: number; onDone: (elo: number) => void; onSkip: () => void }) {
  const [text, setText] = useState(set.eloStart?.toString() ?? '');
  const elo = Number(text);
  const valid = text !== '' && Number.isInteger(elo) && elo >= 0 && elo <= ELO_MAX;
  const t = tallyOf(set.battles);
  return (
    <section className="panel chamfer-9 gt-elo anim-rise" aria-label={`Set ${index} complete`}>
      <div className="gt-elo-head">
        <div>
          <HudLabel live>Set {index} complete</HudLabel>
          <div className="gt-elo-record numeric"><span className="is-win">{t.wins}</span>–<span className="is-loss">{t.losses}</span>{t.ties ? `–${t.ties}` : ''}</div>
        </div>
        {valid && <TierBadge elo={elo} />}
      </div>
      <label className="gt-elo-field">
        <span className="hud-label">Elo after this set</span>
        <input className="gt-elo-input numeric" inputMode="numeric" pattern="[0-9]*" autoFocus value={text} maxLength={4}
          onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) onDone(elo); }} aria-invalid={text !== '' && !valid} />
      </label>
      {set.eloStart !== null && (
        <div className="gt-elo-from">
          Started the set at <b className="numeric">{set.eloStart.toLocaleString()}</b>
          {valid && <span className={`gt-delta numeric ${elo >= set.eloStart ? 'is-up' : 'is-down'}`}>{signed(elo - set.eloStart)}</span>}
        </div>
      )}
      <div className="gt-elo-actions">
        <button type="button" className="btn" onClick={onSkip}>Skip</button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => onDone(elo)}>Done</button>
      </div>
      <p className="text-faint gt-hint">Skip leaves this set without an Elo; the next set starts from the last one written down.</p>
    </section>
  );
}

/**
 * A day of GBL as a table of its 25, 50 or 100 battles: the ones logged, in order, with
 * their set, result, opponents, note and the Elo each set closed on; then a +
 * row for the next one; then the rest of the day's places, empty. A row opens
 * to its note and the moves seen, and can be deleted (with a Restore); the last one can be undone.
 */
function BattleTable({ sets, title, format, backlog, played, limit, onLimit, next, blocked, busy, onAdd, onUndo, onDelete, onSaved, onError }: {
  sets: GblSet[]; title: string; format: string; backlog: boolean; played: number; limit: number; onLimit: (n: number) => void;
  next: { set: number; inSet: number }; blocked: string | null; busy: boolean;
  onAdd: () => void; onUndo: () => void; onDelete: (s: GblSet, b: GblBattle) => void; onSaved: (s: GblSet) => void; onError: (m: string | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A size picked below what is logged: locked, with what it would take. Gone once enough are undone.
  const [tooSmall, setTooSmall] = useState<number | null>(null);
  const over = tooSmall !== null && tooSmall < played ? played - tooSmall : 0;
  const rows = sets.flatMap((s, si) => s.battles.map((b) => ({ s, si, b })));
  const lastId = rows.at(-1)?.b.id;
  return (
    <section className={`panel chamfer-9 gt-table-panel${backlog ? ' is-backlog' : ''}`} aria-label={title}>
      <div className="gt-table-head">
        <HudLabel>{title}</HudLabel>
        <span className="gt-table-size">
          <span className="numeric gt-table-count"><b>{played}</b>/{limit} battles</span>
          <span className="seg-group" role="group" aria-label="Battles this day" title="25 a day; 50 on a GO Battle Thursday; 100 in GO Battle Week">
            {DAY_SIZES.map((n) => (
              <button key={n} type="button" className={`btn seg-btn btn-sm${limit === n ? ' is-active' : ''}`} aria-pressed={limit === n}
                aria-disabled={n < played} onClick={() => { if (n < played) setTooSmall(n); else { setTooSmall(null); onLimit(n); } }}>{n}</button>
            ))}
          </span>
        </span>
      </div>
      {over > 0 && (
        <div className="friend-notice gt-size-warn" role="alert">
          <span>
            This day has <b className="numeric">{played}</b> battles logged, more than {tooSmall}. To make it a {tooSmall}-battle day,
            delete the last <b className="numeric">{over}</b> with ↶ Undo — or keep these and log the rest on another day from the calendar.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setTooSmall(null)}>✕</button>
        </div>
      )}
      <div className="gt-rows" role="table" aria-label={`${title}'s battles`}>
        <div className="gt-row is-header" role="row">
          {['#', 'Set', 'Result', 'Opponent', 'Note', 'Elo'].map((h) => <span key={h} role="columnheader">{h}</span>)}
        </div>
        {rows.map(({ s, si, b }, i) => {
          const endOfSet = b.idx === s.battles.length && s.battles.length >= SET_SIZE;
          const opened = openId === b.id;
          return (
            <div key={b.id} role="rowgroup" className={`gt-rowgroup${b.idx === 1 ? ' is-set-start' : ''}`}>
              <div role="row" className={`gt-row is-${b.result ?? 'none'}${opened ? ' is-open' : ''}`} tabIndex={0} aria-expanded={opened}
                onClick={() => setOpenId(opened ? null : b.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(opened ? null : b.id); } }}>
                <span role="cell" className="gt-row-n numeric">{i + 1}</span>
                <span role="cell" className="gt-row-set">
                  <b>Set {si + 1}</b> <i className="numeric">{b.idx}/{SET_SIZE}</i>
                </span>
                <span role="cell"><span className={`gt-result-badge is-${b.result ?? 'none'}`}>{b.result ?? 'no result'}</span></span>
                <span role="cell" className="gt-row-opp" title={b.opponents.map((r, k) => {
                  const m = b.opponentMoves[k];
                  const seen = m && knowsAny(m) ? ` (${[m.fast, ...m.charges].filter(Boolean).map((id) => moveName(r, id!)).join(', ')})` : '';
                  return displayName(r) + seen;
                }).join('\n') || 'No opponents logged'}>
                  {b.opponents.length ? b.opponents.map((r, k) => <Mon key={r + k} refId={r} size={32} label={false} />) : <span className="text-faint">—</span>}
                </span>
                <span role="cell" className="gt-row-note">{b.note ?? ''}</span>
                <span role="cell" className="gt-row-elo numeric">
                  {endOfSet && s.eloEnd !== null && (
                    <>{s.eloStart !== null && <span className={s.eloEnd >= s.eloStart ? 'is-up' : 'is-down'}>{signed(s.eloEnd - s.eloStart)} </span>}→ {s.eloEnd.toLocaleString()}</>
                  )}
                  {b.id === lastId && (
                    <button type="button" className="btn btn-sm gt-row-undo" disabled={busy} aria-label="Undo the last battle"
                      onClick={(e) => { e.stopPropagation(); onUndo(); }}>↶</button>
                  )}
                </span>
              </div>
              {opened && (
                <BattleEditor key={b.id} battle={b} format={format} onError={onError} busy={busy} onDelete={() => onDelete(s, b)}
                  onSaved={(nb) => onSaved({ ...s, battles: s.battles.map((x) => (x.id === nb.id ? nb : x)) })} />
              )}
            </div>
          );
        })}
        {played < limit && (
          <div role="row" className="gt-row is-add">
            <button type="button" className="gt-add" onClick={onAdd} disabled={!!blocked} aria-label={`Add battle ${played + 1}`}>
              <span className="gt-add-plus" aria-hidden="true">＋</span>
              <span>{blocked ?? <>Add battle <b className="numeric">{played + 1}</b> <i>Set {next.set} · {next.inSet} of {SET_SIZE}</i></>}</span>
            </button>
          </div>
        )}
        {Array.from({ length: Math.max(0, limit - played - 1) }, (_, k) => (
          <div key={k} role="row" className={`gt-row is-empty${(played + 1 + k) % SET_SIZE === 0 ? ' is-set-end' : ''}`} aria-hidden="true">
            <span className="gt-row-n numeric">{played + 2 + k}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Saved teams of three: tap one to fill "Your team", or keep the team on show.
 * Some players run one team all day; others switch between many.
 */
function SavedTeams({ team, teams, legal, onTeams, onPick, onError }: {
  team: string[]; teams: GblTeam[] | null; legal: Set<string> | null; onTeams: (t: GblTeam[]) => void; onPick: (t: string[]) => void; onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const key = (t: string[]) => t.join('|');
  const saved = teams?.some((t) => key(t.team) === key(team));
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  // GO allows a species once per team, Shadow or not, any form: it goes by Pokédex number.
  const distinct = new Set(team.map((r) => speciesOf(r)?.dex ?? r)).size === team.length;
  if (!teams) return null;
  // In a cup, only the teams it allows: a Great League team with a Steel type is no use in a Fighting Cup.
  const shown = legal ? teams.filter((t) => t.team.every((r) => legal.has(r))) : teams;
  return (
    <div className="gt-teams" role="group" aria-label="Saved teams">
      {shown.map((t) => (
        <span key={t.id} className={`gt-team${key(t.team) === key(team) ? ' is-on' : ''}`}>
          <button type="button" className="gt-team-pick" aria-label={`Use ${t.team.map(displayName).join(', ')}`} onClick={() => onPick([...t.team])}>
            {t.team.map((r, i) => <Mon key={r + i} refId={r} size={28} label={false} />)}
          </button>
          <button type="button" className="gt-team-del" disabled={busy} aria-label={`Forget ${t.team.map(displayName).join(', ')}`}
            onClick={() => run(async () => { await deleteGblTeam(t.id); onTeams(teams.filter((x) => x.id !== t.id)); })}>✕</button>
        </span>
      ))}
      {team.every(Boolean) && distinct && !saved && (
        <button type="button" className="btn btn-sm" disabled={busy}
          onClick={() => run(async () => { onTeams([...teams, await saveGblTeam(team)]); })}>＋ Save team</button>
      )}
      {!teams.length && !team.every(Boolean) && <span className="text-faint gt-hint">Fill all three to save the team.</span>}
    </div>
  );
}

/** A logged battle, after the fact: its note, and the moves seen on each opponent. */
function BattleEditor({ battle, format, busy, onSaved, onDelete, onError }: {
  battle: GblBattle; format: string; busy: boolean; onSaved: (b: GblBattle) => void; onDelete: () => void; onError: (m: string | null) => void;
}) {
  const [note, setNote] = useState(battle.note ?? '');
  const [moves, setMoves] = useState<OppMoves[]>(battle.opponentMoves);
  const [which, setWhich] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = note.trim() !== (battle.note ?? '') || JSON.stringify(moves) !== JSON.stringify(battle.opponentMoves);
  const save = async () => {
    setSaving(true);
    try {
      await updateBattle(battle.id, { note, opponentMoves: moves });
      onSaved({ ...battle, note: note.trim() || null, opponentMoves: moves });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="gt-battle-editor anim-rise">
      <div className="gt-battle-editor-head">
        <b>Battle {battle.idx}</b>
        <span className="text-muted">{battle.result ?? 'no result'} · {new Date(battle.playedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      {battle.opponents.length > 0 && (
        <>
          <div className="seg-group gt-editor-mons" role="group" aria-label="Opponent">
            {battle.opponents.map((r, i) => (
              <button key={r + i} type="button" className={`btn seg-btn${which === i ? ' is-active' : ''}`} aria-pressed={which === i} onClick={() => setWhich(i)}>
                {displayName(r)}
              </button>
            ))}
          </div>
          <MoveEditor refId={battle.opponents[which]} format={format} value={moves[which] ?? NO_MOVES}
            onChange={(m) => setMoves(moves.map((x, i) => (i === which ? m : x)))} />
        </>
      )}
      <label className="gt-note">
        <span className="hud-label">Note</span>
        <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only you can see it." />
      </label>
      <div className="gt-elo-actions">
        <button type="button" className="btn btn-ghost gt-danger" disabled={busy || saving} onClick={onDelete}>Delete battle</button>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ── Meta ────────────────────────────────────────────────────────────────────

const WINDOWS: [string, number][] = [['24h', 1], ['7 days', 7], ['30 days', 30]];

function MetaView({ format }: { format: string }) {
  const [days, setDays] = useState(7);
  const [band, setBand] = useState<Tier | null>(null);
  const [data, setData] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    meta(format, new Date(Date.now() - days * 86_400_000), band).then((m) => live && setData(m)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [format, days, band]);
  const base = formatOf(format).base as LeagueId;
  const top = data?.rows[0]?.seen ?? 1;

  return (
    <div className="gt-meta">
      <div className="gt-bar">
        <div className="seg-group" role="group" aria-label="Window">
          {WINDOWS.map(([label, d]) => (
            <button key={d} type="button" className={`btn seg-btn${days === d ? ' is-active' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
        <div className="gt-chips" role="group" aria-label="Elo bracket">
          <button type="button" className={`chip-btn${band ? '' : ' is-active'}`} aria-pressed={!band} onClick={() => setBand(null)}>All players</button>
          {TIERS.map((t) => (
            <button key={t.id} type="button" className={`chip-btn gt-tier-chip is-${t.id}${band?.id === t.id ? ' is-active' : ''}`}
              aria-pressed={band?.id === t.id} onClick={() => setBand(t)} title={`${t.lo}${t.hi ? `–${t.hi}` : '+'} Elo at the start of the set`}>{t.label}</button>
          ))}
        </div>
      </div>
      <p className="text-faint gt-hint">Counts battles logged by players who share theirs, and yours. A bracket is the Elo a set started at.</p>

      {failed && <p className="friend-notice" role="alert">Couldn't load the meta.</p>}
      {!data && !failed && <p className="text-muted">Loading the meta…</p>}
      {data && (
        <>
          <dl className="gt-tiles">
            <div><dt>Battles</dt><dd className="numeric">{data.battles.toLocaleString()}</dd></div>
            <div><dt>Players</dt><dd className="numeric">{data.players}</dd></div>
            <div><dt>Pokémon seen</dt><dd className="numeric">{data.rows.length}</dd></div>
          </dl>
          {data.rows.length === 0 ? (
            <p className="panel text-muted">Nothing logged in {formatName(format)} in this window yet.</p>
          ) : (
            <ol className="gt-meta-list">
              {data.rows.slice(0, 60).map((r, i) => {
                const sp = speciesOf(r.ref);
                const decided = r.wins + r.losses + r.ties;
                const set = sp ? movesFor(sp, base, parseRef(r.ref).shadow) : null;
                return (
                  <li key={r.ref} className={`gt-meta-row${i < 3 ? ` is-podium is-p${i + 1}` : ''}`}
                    style={sp ? typeVar(sp.types[0]) : undefined}>
                    <span className="gt-meta-rank numeric">{i + 1}</span>
                    <Mon refId={r.ref} size={56} label={false} />
                    <div className="gt-meta-who">
                      <b>{displayName(r.ref)}</b>
                      <span className="gt-meta-types">{sp?.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
                      {r.moves ? (
                        // What players recorded, as a share of the sightings that recorded any move.
                        <span className="gt-meta-moves" title={`Moves recorded in ${r.moves.known} of ${r.seen} sightings`}>
                          {[...r.moves.fast.slice(0, 2), ...r.moves.charges.slice(0, 3)].map((m) => {
                            const mv = sp ? [...sp.fastMoves, ...sp.chargeMoves].find((x) => x.id === m.id) : undefined;
                            return (
                              <span key={m.id} className="gt-move" style={mv ? typeVar(mv.type) : undefined}>
                                {mv?.name ?? m.id} <b className="numeric">{pct(m.n, r.moves!.known)}</b>
                              </span>
                            );
                          })}
                        </span>
                      ) : set && (
                        <span className="gt-meta-moves is-rated" title="Nobody recorded its moves here yet — PvPoke's rated set">
                          {[set.fast, ...set.charges].map((m) => <span key={m.id} className="gt-move" style={typeVar(m.type)}>{m.name}</span>)}
                          <i>rated</i>
                        </span>
                      )}
                    </div>
                    <div className="gt-meta-usage" data-tip={`Seen in ${r.seen} of ${data.battles} battles`}>
                      <b className="numeric">{pct(r.seen, data.battles)}</b>
                      <span className="gt-bar-track"><span style={{ width: `${(r.seen / top) * 100}%` }} /></span>
                      <i className="numeric">n={r.seen}</i>
                    </div>
                    <div className="gt-meta-win" data-tip={`${record(r)} against it`}>
                      <b className="numeric">{decided ? pct(r.wins, decided) : 'n/a'}</b>
                      <i>win vs</i>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────

/**
 * A season: Elo, tier, record and the chart. `mine` is the caller's own sets
 * with their battles, which adds today's recap and the share controls; any
 * other player's season comes as tallies from gbl_season_sets.
 */
function StatsView({ userId, accountId, season, mine, name, self = false }: {
  userId: string; accountId: string | null; season: number; mine: GblSet[] | null; name: string; self?: boolean;
}) {
  const [theirs, setTheirs] = useState<GblSetSummary[] | null>(null);
  useEffect(() => {
    if (self) return;
    let live = true;
    seasonSets(userId, season, accountId).then((s) => live && setTheirs(s)).catch(() => live && setTheirs([]));
    return () => { live = false; };
  }, [self, userId, accountId, season]);
  const sets = self ? (mine ? mine.map(summaryOf) : null) : theirs;
  if (!sets) return <p className="text-muted">Loading the season…</p>;
  if (!sets.length) return <p className="panel text-muted">{self ? `Nothing logged on ${name} in season ${season} yet.` : `${name} has logged nothing in season ${season}.`}</p>;

  const tot = seasonTotals(sets);
  const series = eloSeries(sets);
  const elo = lastElo(sets);
  const high = Math.max(...sets.flatMap((s) => [s.eloStart ?? 0, s.eloEnd ?? 0]));
  const first = sets.find((s) => s.eloStart !== null)?.eloStart ?? null;
  const next = elo !== null ? nextTier(elo) : null;
  const priced = series.filter((p) => p.delta !== null);
  const perBattle = priced.length ? priced.reduce((n, p) => n + p.delta!, 0) / priced.reduce((n, p) => n + p.set.battles, 0) : null;

  return (
    <div className="gt-stats">
      {self && mine && <Today sets={todaysSets(mine)} />}
      <section className="panel chamfer-9 gt-hero" aria-label="Season">
        <div className="gt-hero-main">
          <span className="hud-label">{name} · Season {season} · current Elo</span>
          <span className="gt-hero-elo numeric">{elo?.toLocaleString() ?? '—'}</span>
        </div>
        <div className="gt-hero-side">
          <TierBadge elo={elo} />
          <span>Season high <b className="numeric is-up">{high ? high.toLocaleString() : '—'}</b></span>
          {first !== null && elo !== null && <span>Season <b className={`numeric ${elo >= first ? 'is-up' : 'is-down'}`}>{signed(elo - first)}</b></span>}
        </div>
        {next && elo !== null && (
          <div className="gt-progress" aria-label={`${next.gap} Elo to ${next.tier.label}`}>
            <span className="gt-progress-track"><span style={{ width: `${Math.max(2, next.progress * 100)}%` }} /></span>
            <span className="gt-progress-labels numeric">
              <span>{tierOf(elo).label} {tierOf(elo).lo.toLocaleString()}</span>
              <span><b>{next.gap}</b> to {next.tier.label}</span>
              <span>{next.tier.lo.toLocaleString()}</span>
            </span>
          </div>
        )}
      </section>

      <dl className="gt-tiles">
        <div><dt>Battles</dt><dd className="numeric">{tot.battles}</dd></div>
        <div><dt>Record</dt><dd className="numeric"><span className="is-up">{tot.wins}</span>–<span className="is-down">{tot.losses}</span>{tot.ties ? `–${tot.ties}` : ''}</dd></div>
        <div><dt>Win rate</dt><dd className="numeric">{pct(tot.wins, tot.wins + tot.losses + tot.ties)}</dd></div>
        <div><dt>Sets</dt><dd className="numeric">{tot.sets}</dd></div>
        <div><dt>Elo / battle</dt><dd className="numeric">{perBattle === null ? '—' : signed(Math.round(perBattle * 10) / 10)}</dd></div>
      </dl>

      {series.length > 0 && <EloChart series={series} />}

      <section className="panel chamfer-9 gt-formats" aria-label="By format">
        <HudLabel>By format</HudLabel>
        <table className="gt-table">
          <thead><tr><th>Format</th><th>Record</th><th>Win %</th><th>Elo / battle</th></tr></thead>
          <tbody>
            {byFormat(sets).map((f) => (
              <tr key={f.format}>
                <td>{formatName(f.format)}</td>
                <td className="numeric">{record(f.tally)}</td>
                <td className="numeric">{pct(f.tally.wins, f.tally.battles)}</td>
                <td className="numeric">{f.eloPerBattle === null ? '—' : signed(Math.round(f.eloPerBattle * 10) / 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {self && mine && <ShareControls userId={userId} sets={mine} season={season} />}
    </div>
  );
}

/** Today's session: what the sets played today came to. */
function Today({ sets }: { sets: GblSet[] }) {
  if (!sets.length) return null;
  const r = recap(sets);
  return (
    <section className="panel chamfer-9 gt-today-card" aria-label="Today's session">
      <div className="gt-today-head">
        <div>
          <HudLabel live>Today's session</HudLabel>
          <div className="gt-today-record numeric"><span className="is-up">{r.tally.wins}</span>–<span className="is-down">{r.tally.losses}</span>{r.tally.ties ? `–${r.tally.ties}` : ''}</div>
        </div>
        <dl className="gt-today-facts">
          <div><dt>Win rate</dt><dd className="numeric">{pct(r.tally.wins, r.tally.battles)}</dd></div>
          <div><dt>Sets</dt><dd className="numeric">{r.sets}</dd></div>
          {r.eloFrom !== null && r.eloTo !== null && (
            <div><dt>Elo</dt><dd className="numeric">{r.eloFrom.toLocaleString()} → {r.eloTo.toLocaleString()} <span className={r.eloTo >= r.eloFrom ? 'is-up' : 'is-down'}>{signed(r.eloTo - r.eloFrom)}</span></dd></div>
          )}
        </dl>
      </div>
      <dl className="gt-recap">
        {r.bestSet && <div><dt>Best set</dt><dd>Set {r.bestSet.index + 1} <b className="numeric">{record(r.bestSet.tally)}</b></dd></div>}
        {r.mostFaced && <div><dt>Most faced</dt><dd><Mon refId={r.mostFaced.ref} size={40} /> <b className="numeric">×{r.mostFaced.n}</b></dd></div>}
        {r.lostToMost && <div><dt>Lost to most</dt><dd><Mon refId={r.lostToMost.ref} size={40} /> <span className="text-muted">in {r.lostToMost.n} of {r.lostToMost.of} losses</span></dd></div>}
      </dl>
    </section>
  );
}

function ShareControls({ userId, sets, season }: { userId: string; sets: GblSet[]; season: number }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { getPublic(userId).then(setOn).catch(() => setOn(false)); }, [userId]);
  return (
    <section className="panel chamfer-9 gt-share" aria-label="Sharing">
      <div>
        <b>Share my battles</b>
        <p className="text-muted">Puts you on the season ladder and counts your battles toward the live meta. Friends can always see your season.</p>
      </div>
      <button type="button" role="switch" aria-checked={!!on} aria-label="Share my battles" disabled={on === null} className={`gt-switch${on ? ' is-on' : ''}`}
        onClick={async () => { const v = !on; setOn(v); try { await setPublic(userId, v); } catch { setOn(!v); } }} />
      <button type="button" className="btn" disabled={!sets.length} onClick={() => exportSeason(sets, season)}>Export CSV</button>
    </section>
  );
}

const CHART_W = 960, CHART_H = 240, PAD = 28;

/** Elo after every set, with the tier lines it crosses. Points are focusable; the one in focus is described below. */
function EloChart({ series }: { series: ReturnType<typeof eloSeries> }) {
  const [sel, setSel] = useState(series.length - 1);
  const elos = series.map((p) => p.elo);
  const lo = Math.min(...elos) - 60, hi = Math.max(...elos) + 60;
  const x = (i: number) => PAD + (series.length === 1 ? (CHART_W - 2 * PAD) / 2 : (i / (series.length - 1)) * (CHART_W - 2 * PAD));
  const y = (e: number) => CHART_H - PAD - ((e - lo) / (hi - lo)) * (CHART_H - 2 * PAD);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.elo).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${CHART_H - PAD} L${x(0).toFixed(1)},${CHART_H - PAD} Z`;
  const p = series[Math.min(sel, series.length - 1)];
  return (
    <section className="panel chamfer-9 gt-chart" aria-label="Elo over the season">
      <div className="gt-chart-head"><HudLabel>Elo over the season</HudLabel><span className="text-faint">Hover or tap a point</span></div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="gt-chart-svg" role="img" aria-label={`Elo from ${elos[0]} to ${elos.at(-1)}`}>
        <defs>
          <linearGradient id="gt-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gt-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--type-water)" />
            <stop offset="1" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        {TIERS.filter((t) => t.lo > lo && t.lo < hi).map((t) => (
          <g key={t.id} className={`gt-chart-tier is-${t.id}`}>
            <line x1={PAD} x2={CHART_W - PAD} y1={y(t.lo)} y2={y(t.lo)} />
            <text x={CHART_W - PAD} y={y(t.lo) - 5} textAnchor="end">{t.label.toUpperCase()}</text>
          </g>
        ))}
        <path d={area} fill="url(#gt-area)" />
        <path d={line} fill="none" stroke="url(#gt-line)" strokeWidth={2.5} strokeLinejoin="round" />
        {series.map((q, i) => (
          <circle key={q.set.id} cx={x(i)} cy={y(q.elo)} r={i === sel ? 7 : 4.5} tabIndex={0}
            className={`gt-chart-pt ${q.delta === null ? '' : q.delta >= 0 ? 'is-up' : 'is-down'}${i === sel ? ' is-sel' : ''}`}
            onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}>
            <title>{`${q.elo}${q.delta === null ? '' : ` (${signed(q.delta)})`}`}</title>
          </circle>
        ))}
      </svg>
      <div className="gt-chart-detail" aria-live="polite">
        <span>{new Date(p.set.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {formatName(p.set.format)} · <b className="numeric">{record(p.set)}</b></span>
        <span className="numeric">{p.delta !== null && <span className={p.delta >= 0 ? 'is-up' : 'is-down'}>{signed(p.delta)} </span>}→ {p.elo.toLocaleString()}</span>
      </div>
    </section>
  );
}

// ── Ladder ──────────────────────────────────────────────────────────────────

function LadderView({ season }: { season: number }) {
  const { patch } = useAppState();
  const [rows, setRows] = useState<LadderRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [open, setOpen] = useState<LadderRow | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    leaderboard(season).then((r) => live && setRows(r)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [season]);

  if (open) {
    return (
      <div className="gt-ladder">
        <div className="gt-bar">
          <button type="button" className="btn" onClick={() => setOpen(null)}>‹ Ladder</button>
          <button type="button" className="btn btn-ghost" onClick={() => patch({ screen: 'player', activePlayerId: open.userId })}>Open {open.name}'s profile</button>
        </div>
        <StatsView userId={open.userId} accountId={open.accountId} season={season} mine={null} name={open.accountName ?? open.name} />
      </div>
    );
  }

  const shown = (rows ?? []).filter((r) => !friendsOnly || r.isFriend);
  return (
    <div className="gt-ladder">
      <div className="gt-bar">
        <div className="seg-group" role="group" aria-label="Who">
          {([[false, 'Everyone'], [true, 'Friends']] as const).map(([v, label]) => (
            <button key={label} type="button" className={`btn seg-btn${friendsOnly === v ? ' is-active' : ''}`} aria-pressed={friendsOnly === v} onClick={() => setFriendsOnly(v)}>{label}</button>
          ))}
        </div>
        <span className="text-faint gt-hint">Players who share their battles, your friends, and you.</span>
      </div>
      {failed && <p className="friend-notice" role="alert">Couldn't load the ladder.</p>}
      {!rows && !failed && <p className="text-muted">Loading the ladder…</p>}
      {rows && shown.length === 0 && <p className="panel text-muted">Nobody on this ladder for season {season} yet.</p>}
      {shown.length > 0 && (
        <ol className="gt-ladder-list">
          {shown.map((r, i) => (
            <li key={`${r.userId}:${r.accountId ?? 'main'}`}>
              <button type="button" className={`gt-ladder-row${i < 3 ? ` is-podium is-p${i + 1}` : ''}`} onClick={() => setOpen(r)}>
                <span className="gt-ladder-rank numeric">{i + 1}</span>
                <TrainerAvatar profile={{ avatar: r.avatar } as Profile} name={r.name} size={40} userId={r.userId} />
                <span className="gt-ladder-who">
                  <b>{r.accountName ?? r.name}</b>
                  {r.accountName && <span className="gt-acct-of">alt of {r.name}</span>}
                  {r.isFriend && <span className="gt-friend-tag">Friend</span>}
                </span>
                <TierBadge elo={r.elo} />
                <span className="gt-ladder-elo numeric" data-tip={r.peak ? `Season high ${r.peak.toLocaleString()}` : undefined}>{r.elo?.toLocaleString() ?? '—'}</span>
                <span className="gt-ladder-rec numeric">{record(r)} <i>{pct(r.wins, r.battles)}</i></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
