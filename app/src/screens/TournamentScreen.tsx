import { useState } from 'react';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { useTournament } from '../state/useTournament';
import { LEAGUE_BY_ID } from '../lib/data';
import { hashForTournament } from '../lib/route';
import { withdrawFromTournament, type Tournament, type TournamentState } from '../lib/tournaments';
import { PlayerRoster } from '../components/tournament/RosterCard';
import { RosterForm } from '../components/tournament/RosterForm';
import { RoundClock } from '../components/tournament/RoundClock';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const TABS = [['bracket', 'Bracket'], ['standings', 'Standings'], ['players', 'Players']] as const;
type Tab = (typeof TABS)[number][0];
/** Server truth (RLS): other players' rosters exist for us only once registration has closed. */
const ROSTERS_VISIBLE: readonly TournamentState[] = ['closed', 'running', 'complete'];

function banner(t: Tournament, s: TournamentState): { tone: string; text: string; sub?: string } {
  switch (s) {
    case 'draft': return { tone: 'dead', text: 'Draft', sub: 'Not open for registration yet.' };
    case 'registration': return {
      tone: 'open', text: 'Registration open',
      sub: t.registrationClosesAt ? `Closes ${new Date(t.registrationClosesAt).toLocaleString()}` : 'Closes when the host closes it',
    };
    case 'closed': return { tone: 'closed', text: 'Registration closed', sub: 'Teams of Pokémon Visible' };
    case 'running': return { tone: 'live', text: `Round ${t.currentRound} of ${t.rounds}` };
    case 'complete': return { tone: 'done', text: 'Finished' };
    case 'cancelled': return { tone: 'dead', text: 'Cancelled' };
  }
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <button type="button" className="btn" onClick={onBack}>← All tournaments</button>
    </div>
  );
}

export function TournamentScreen({ id }: { id: string }) {
  const { patch } = useAppState();
  const { user } = useSession();
  const v = useTournament(id);
  const [tab, setTab] = useState<Tab>('bracket');
  const [forming, setForming] = useState(false);
  const [hideMine, setHideMine] = useState(false);
  const [share, setShare] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const back = <Back onBack={() => patch({ activeTournamentId: null })} />;

  if (!user) {
    return (
      <div className="tournament-page">
        {back}
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see this tournament.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </div>
    );
  }

  const t = v.tournament?.id === id ? v.tournament : null;
  const s = t ? v.state : null;
  if (!t || !s) {
    return (
      <div className="tournament-page">
        {back}
        {v.error && !v.loading ? <p className="friend-notice" role="alert">Couldn't load this tournament.</p>
          : v.loading ? <p className="text-muted">Loading tournament…</p>
          : <p className="panel text-muted">This tournament isn't available.</p>}
      </div>
    );
  }

  const me = v.me;
  const mine = v.entrants.find((e) => e.playerId === me && !e.dropped);
  const myRoster = me ? v.rosters.get(me) : undefined;
  const open = s === 'registration';
  const full = t.entrants >= t.maxPlayers;
  const matchup = s === 'running' && v.pairings.some(
    (p) => p.round === t.currentRound && p.playerB !== null && (p.playerA === me || p.playerB === me),
  );
  const isHost = t.organiserId === me;
  const b = banner(t, s);
  const name = (uid: string) => v.names.get(uid) ?? 'Player';
  const hosts = [t.organiserId, ...v.judges.filter((j) => j !== t.organiserId)].map(name).join(', ');
  const others = ROSTERS_VISIBLE.includes(s)
    ? v.entrants.filter((e) => !e.dropped && e.playerId !== me && v.rosters.has(e.playerId)) : [];

  async function withdraw() {
    if (!window.confirm('Withdraw from this tournament?')) return;
    setNotice(null);
    try {
      await withdrawFromTournament(id);
      v.refresh();
    } catch (e) {
      setNotice(messageOf(e));
    }
  }

  async function copyLink() {
    const link = `${window.location.origin}/${hashForTournament(id)}`;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      setShare('copied');
    } catch {
      setShare('manual');
    }
  }

  return (
    <div className="tournament-page">
      {back}

      <header className="panel chamfer-9 tournament-head">
        <h2 className="tournament-title">{t.title}</h2>
        <p className="text-muted">Hosted by {hosts}</p>
        {t.description && <p>{t.description}</p>}
        <div className="tournament-chips">
          <span className="tournament-chip">Swiss Bracket</span>
          <span className="tournament-chip">Round length: {t.roundMinutes} minutes</span>
          {v.format && <span className="tournament-chip">{v.format.name}</span>}
          <span className="tournament-chip">{LEAGUE_BY_ID.get(t.league)?.label ?? t.league}</span>
          <span className="tournament-chip">{t.entrants} / {t.maxPlayers} players</span>
        </div>
      </header>

      <div className={`tournament-banner tone-${b.tone}`}>
        <strong>{b.text}</strong>
        {b.sub && <span className="text-muted">{b.sub}</span>}
        {s === 'running' && <RoundClock endsAt={t.roundEndsAt} />}
      </div>

      <div className="tournament-actions">
        {open && !mine && !full && (
          <button type="button" className="btn btn-primary" disabled={!v.format} onClick={() => setForming(true)}>Register</button>
        )}
        {open && !mine && full && <span className="text-muted">This tournament is full.</span>}
        {open && mine && (
          <>
            <button type="button" className="btn btn-primary" disabled={!v.format} onClick={() => setForming(true)}>Edit roster</button>
            <button type="button" className="btn" onClick={() => void withdraw()}>Withdraw</button>
          </>
        )}
        {matchup && <button type="button" className="btn btn-primary" onClick={() => setTab('bracket')}>View your matchup</button>}
        <button type="button" className="btn" onClick={() => void copyLink()}>Share tournament page</button>
        {share === 'copied' && <span role="status" className="text-muted">Copied</span>}
        {share === 'manual' && (
          <span className="text-muted tournament-link">{`${window.location.origin}/${hashForTournament(id)}`}</span>
        )}
      </div>
      {notice && <p className="friend-notice" role="alert">{notice}</p>}

      {isHost && <section className="panel chamfer-9 host-panel" aria-label="Host controls"><div className="hud-label">Host controls</div></section>}

      {myRoster && (
        <section className="tournament-mine" aria-label="Your roster">
          <div className="tournaments-bar">
            <div className="hud-label">Your roster</div>
            <button type="button" className="btn" aria-pressed={hideMine} onClick={() => setHideMine((h) => !h)}>
              {hideMine ? 'See your Pokémon' : 'Hide Pokémon'}
            </button>
          </div>
          <PlayerRoster name={name(me!)} roster={myRoster} hidden={hideMine} />
        </section>
      )}

      <div className="seg-group" role="tablist" aria-label="Tournament">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={`btn seg-btn${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" className="panel chamfer-9 text-muted">
        {tab === 'bracket' && 'Pairings appear here once a round starts.'}
        {tab === 'standings' && 'Standings appear here once games are played.'}
        {tab === 'players' && `${t.entrants} registered.`}
      </div>

      {others.length > 0 && (
        <section className="tournament-teams" aria-label="Teams">
          <div className="hud-label">Teams</div>
          {others.map((e) => <PlayerRoster key={e.playerId} name={name(e.playerId)} roster={v.rosters.get(e.playerId)!} />)}
        </section>
      )}

      {forming && v.format && (
        <RosterForm
          tournament={t} format={v.format.format} league={t.league} initial={myRoster}
          onCancel={() => setForming(false)}
          onSaved={() => { setForming(false); v.refresh(); }}
        />
      )}
    </div>
  );
}
