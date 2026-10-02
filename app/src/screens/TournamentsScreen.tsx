import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { useTournaments } from '../state/useTournaments';
import { LEAGUE_BY_ID } from '../lib/data';
import { listServerFormats, type SavedFormat } from '../lib/saves';
import { PRESET_FORMATS, SHOW_6, versionFor, withTeamSize } from '../lib/presetFormats';
import { LeagueSelect, type LeagueOption } from '../components/LeagueSelect';
import { createTournament, effectiveState, openRegistration, type Tournament, type TournamentState } from '../lib/tournaments';
import { TournamentScreen } from './TournamentScreen';
import { defaultRounds } from '../tournament/swiss';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const FILTERS = [
  ['all', 'All'],
  ['open', 'Open'],
  ['live', 'Live'],
  ['done', 'Finished'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const MATCHES: Record<Filter, (s: TournamentState) => boolean> = {
  all: () => true,
  open: (s) => s === 'registration',
  live: (s) => s === 'closed' || s === 'running',
  done: (s) => s === 'complete',
};

const CHIP_HUE: Record<TournamentState, string> = {
  draft: 'var(--type-normal)',
  registration: 'var(--type-grass)',
  closed: 'var(--type-steel)',
  running: 'var(--type-electric)',
  complete: 'var(--type-dragon)',
  cancelled: 'var(--type-ghost)',
};

function chipText(t: Tournament, s: TournamentState): string {
  switch (s) {
    case 'draft': return 'Draft';
    case 'registration': return 'Registration open';
    case 'closed': return 'Registration closed';
    case 'running': return `Round ${t.currentRound} of ${t.rounds}`;
    case 'complete': return 'Finished';
    case 'cancelled': return 'Cancelled';
  }
}

export function TournamentsScreen() {
  const { state } = useAppState();
  // The page has its own gate and reads; the list below stays unmounted (and unpolled) meanwhile.
  return state.activeTournamentId ? <TournamentScreen id={state.activeTournamentId} /> : <TournamentList />;
}

function TournamentList() {
  const { patch } = useAppState();
  const { user } = useSession();
  const { tournaments, failed } = useTournaments();
  const [filter, setFilter] = useState<Filter>('all');
  const [hosting, setHosting] = useState(false);

  const now = new Date();
  const shown = (tournaments ?? []).filter((t) => MATCHES[filter](effectiveState(t, now)));
  const open = (id: string) => patch({ activeTournamentId: id });

  // The data is authenticated-only: signed out there is nothing to list.
  if (!user) {
    return (
      <div className="tournaments-screen">
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see and host tournaments.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tournaments-screen">
      <div className="tournaments-bar">
        <div className="seg-group" role="group" aria-label="Filter tournaments">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn seg-btn tournament-filter${filter === id ? ' is-active' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {user && (
          <button type="button" className="btn btn-primary" onClick={() => setHosting(true)}>
            Host a tournament
          </button>
        )}
      </div>

      {failed && tournaments === null && (
        <p className="friend-notice" role="alert">Couldn't load tournaments.</p>
      )}
      {tournaments === null && !failed && <p className="text-muted">Loading tournaments…</p>}
      {tournaments && shown.length === 0 && <p className="panel text-muted">No tournaments here yet.</p>}

      <div className="tournament-list">
        {shown.map((t) => {
          const s = effectiveState(t, now);
          return (
            <button key={t.id} type="button" className="panel chamfer-9 tournament-card" onClick={() => open(t.id)}>
              <span className="tournament-card-title">{t.title}</span>
              <span className="tournament-chip" style={{ '--tab-hue': CHIP_HUE[s] } as React.CSSProperties}>
                {chipText(t, s)}
              </span>
              <span className="text-muted">
                {LEAGUE_BY_ID.get(t.league)?.label ?? t.league} · {t.entrants} / {t.maxPlayers} players
              </span>
            </button>
          );
        })}
      </div>

      {hosting && (
        <CreateSheet
          onClose={() => setHosting(false)}
          onCreated={(id) => {
            setHosting(false);
            open(id);
          }}
        />
      )}
    </div>
  );
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [formats, setFormats] = useState<SavedFormat[] | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formatId, setFormatId] = useState('');
  const [rounds, setRounds] = useState(defaultRounds(16));
  const [roundMinutes, setRoundMinutes] = useState(25);
  const [maxPlayers, setMaxPlayers] = useState(64);
  const [closes, setClosesAt] = useState('');
  const [openNow, setOpenNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  // Once created, leaving lands the host on the tournament (a fresh form would
  // invite a duplicate); mid-flight, leaving is blocked.
  const dismiss = () => {
    if (busy) return;
    if (createdId) onCreated(createdId);
    else onClose();
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let live = true;
    listServerFormats()
      .then((fs) => live && setFormats(fs.filter((f) => f.format.composition.size === 6)))
      .catch((e) => live && (setFormats([]), setError(messageOf(e))));
    return () => {
      live = false;
    };
  }, []);

  // The standard cups (as a Show 6 roster) first, then your own six-Pokémon formats.
  const formatOptions: LeagueOption[] = [
    ...PRESET_FORMATS.map((p) => ({
      value: `preset:${p.key}`, label: p.name, league: p.base, types: p.cup.include?.types, palette: p.palette, group: 'Standard',
      note: p.base === 'master' ? 'No cap' : `${p.base === 'great' ? 1500 : 2500} CP`,
    })),
    ...(formats ?? []).map((f) => ({ value: f.id, label: f.name, league: f.format.base, group: 'Your formats' })),
  ];
  const format = formats?.find((f) => f.id === formatId);
  const preset = PRESET_FORMATS.find((p) => `preset:${p.key}` === formatId);
  const ready = (!!format || !!preset) && formats !== null && title.trim() !== '' && !busy && createdId === null;

  async function create() {
    if (!format && !preset) return;
    setBusy(true);
    setError(null);
    let id: string | null = null;
    try {
      // A cup is saved to your own formats the first time it is used, and that copy reused after.
      const versionId = format ? format.versionId : await versionFor({ name: `${preset!.name} · Show 6`, format: withTeamSize(preset!.format, SHOW_6) }, formats ?? []);
      id = await createTournament({
        title: title.trim(), description, formatVersionId: versionId, rounds, roundMinutes, maxPlayers,
        closesAt: closes ? new Date(closes).toISOString() : null,
      });
      setCreatedId(id);
      if (openNow) await openRegistration(id);
      onCreated(id);
    } catch (e) {
      // Once it exists a re-submit would create a second: only "Open
      // registration" (below) is offered.
      setError(id ? `Tournament created but registration could not be opened: ${messageOf(e)}` : messageOf(e));
      setBusy(false);
    }
  }

  async function openIt() {
    if (!createdId) return;
    setBusy(true);
    setError(null);
    try {
      await openRegistration(createdId);
      onCreated(createdId);
    } catch (e) {
      setError(`Tournament created but registration could not be opened: ${messageOf(e)}`);
      setBusy(false);
    }
  }

  // Portalled to <body>: the screen wrapper keeps a transform, which would make it this
  // fixed backdrop's containing block (see AddPokemonModal).
  return createPortal(
    <div
      className="challenge-sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="challenge-sheet panel chamfer-9" role="dialog" aria-modal="true" aria-label="Host a tournament">
        <div className="hud-label">Host a tournament</div>
        <div className="field">
          <label htmlFor="tn-title">Title</label>
          <input id="tn-title" ref={firstRef} className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tn-desc">Description</label>
          <textarea id="tn-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tn-format">Format</label>
          <LeagueSelect
            id="tn-format"
            label="Format"
            value={formatId}
            options={[{ value: '', label: 'Choose a format', league: 'great' }, ...formatOptions]}
            onChange={setFormatId}
          />
        </div>
        <div className="field">
          <label htmlFor="tn-rounds">Rounds</label>
          <input id="tn-rounds" className="input" type="number" min={1} max={12} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="tn-minutes">Round length (minutes)</label>
          <input id="tn-minutes" className="input" type="number" min={1} value={roundMinutes} onChange={(e) => setRoundMinutes(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="tn-max">Max players</label>
          <input id="tn-max" className="input" type="number" min={2} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="tn-closes">Registration closes (optional)</label>
          <input id="tn-closes" className="input" type="datetime-local" value={closes} onChange={(e) => setClosesAt(e.target.value)} />
        </div>
        <label className="tournament-check">
          <input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} />
          Open registration now
        </label>

        {error && <p className="friend-notice" role="alert">{error}</p>}

        <div className="challenge-sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={dismiss}>{createdId ? 'Close' : 'Cancel'}</button>
          {createdId && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void openIt()}>
              Open registration
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
