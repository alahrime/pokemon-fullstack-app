import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { resolveDisplayNames } from '../lib/channels';
import { listMyRecords, summarise, type RecordRow } from '../lib/records';
import { listPlacements, listPlayerGames, type PlayerGame } from '../lib/tournaments';
import { FAVORITES, PINS, friendRecord, getProfile, pinFirst, saveProfile, showcase, trainerUrl, type Bout, type FreeRecord, type Profile } from '../lib/profile';
import { liveChallengesWith, type Challenge } from '../lib/challenges';
import { opponentFriendCode } from '../lib/matchmaking';
import { ChallengeCard } from '../components/ChallengeCard';
import { ChallengeSheet } from '../components/ChallengeSheet';
import { displayName, parseRef, speciesOf } from '../lib/data';
import type { LeagueId } from '../lib/types';
import { TeamGrid } from '../components/tournament/RosterCard';
import { MonTile } from '../components/MonTile';
import { LeagueEmblem } from '../components/LeagueEmblem';
import { ProfileEditor } from '../components/ProfileEditor';
import { SpeciesSearch } from '../components/SpeciesSearch';
import { Sprite } from '../components/Sprite';
import type { TeamMember } from '../tournament/roster';

const LEAGUE_NAME: Record<LeagueId, string> = { great: 'Great League', ultra: 'Ultra League', master: 'Master League' };
const PLACE = ['', '1st', '2nd', '3rd'];
/** The league's ball colours, the way the species hero is tinted. */
const leagueVars = (l: LeagueId | null): CSSProperties | undefined =>
  l ? ({ '--lg': `var(--lg-${l})`, '--lg-deep': `var(--lg-${l}-deep)`, '--lg-accent': `var(--lg-${l}-accent)` } as CSSProperties) : undefined;
const pct = (w: number, n: number) => (n ? `${((w / n) * 100).toFixed(1)}%` : '—');

/** One finished game: result, what it was, the score, and (folded) both sixes. */
function Line({ won, what, score, aTitle, a, bTitle, b }: {
  won: boolean; what: ReactNode; score: string; aTitle: string; a: readonly TeamMember[] | null; bTitle: string; b: readonly TeamMember[] | null;
}) {
  return (
    <li className="player-line">
      <span className={won ? 'records-win' : 'records-loss'}>{won ? 'W' : 'L'}</span>
      <span className="player-line-what">{what}</span>
      <span className="numeric">{score}</span>
      <details className="records-teams">
        <summary>Pokémon</summary>
        <div className="matchup-rosters">
          {a ? <TeamGrid title={aTitle} team={a} /> : <p className="text-muted">{aTitle}: not shown.</p>}
          {b ? <TeamGrid title={bTitle} team={b} /> : <p className="text-muted">{bTitle}: not shown.</p>}
        </div>
      </details>
    </li>
  );
}

function Six({ refs, size }: { refs: readonly string[]; size: number }) {
  return (
    <ol className="profile-six">
      {refs.map((ref, i) => <li key={`${ref}-${i}`}><MonTile refId={ref} label={displayName(ref)} shadow={parseRef(ref).shadow} size={size} /></li>)}
    </ol>
  );
}

/**
 * Choosing a favourite is choosing a species: no Shadow, no moves, no roll. Picking one adds it and closes.
 * An overlay like the team views' "+" picker, so the page stays put.
 */
function FavoritePicker({ taken, onPick, onClose }: { taken: readonly string[]; onPick: (ref: string) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" ref={panel} role="dialog" aria-modal="true" aria-label="Add a favourite Pokémon">
        <div className="modal-head">
          <span className="hud-label">Add a favourite</span>
          <button type="button" className="btn btn-sm py-0.5 px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-search">
            <SpeciesSearch id="favorite-species" value="" startEmpty placeholder="Search any Pokémon…"
              onChange={(ref) => { if (ref && !taken.includes(ref)) onPick(ref); onClose(); }} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The favourite six as a broadcast roster's tiles. The owner fills an empty tile with "+" and clears one with ✕. */
function Roster({ profile, own, onAdd, onRemove }: {
  profile: Profile | null; own: boolean; onAdd: () => void; onRemove: (ref: string) => void;
}) {
  const favs = profile?.favoritePokemon ?? [];
  return (
      <ol className="profile-roster-grid" aria-label="Favourite Pokémon">
        {Array.from({ length: FAVORITES }, (_, i) => {
          const ref = favs[i];
          const s = ref ? speciesOf(ref) : undefined;
          if (!ref) {
            return (
              <li key={`empty-${i}`} className="profile-tile is-empty">
                {own && i === favs.length
                  ? <button type="button" className="team-slot is-empty profile-tile-add" onClick={onAdd} aria-label="Add a favourite Pokémon">
                      <span className="team-slot-mark" aria-hidden="true">+</span><span className="team-slot-hint">Add</span>
                    </button>
                  : <span className="profile-tile-blank" aria-hidden="true" />}
              </li>
            );
          }
          // Lit by its own two types, the --t1/--t2 pair MonTile and PokemonCard use.
          const tint = s ? { ['--t1' as string]: `var(--type-${s.types[0]})`, ['--t2' as string]: `var(--type-${s.types[1] ?? s.types[0]})` } : undefined;
          return (
            <li key={ref} className="profile-tile" style={tint}>
              {s && <Sprite sprite={s.sprite} dex={s.dex} size={128} className="profile-tile-sprite" />}
              <span className="profile-tile-name">{displayName(ref)}</span>
              {own && <button type="button" className="profile-tile-remove" aria-label={`Remove ${displayName(ref)}`} onClick={() => onRemove(ref)}>✕</button>}
            </li>
          );
        })}
      </ol>
  );
}

/**
 * A player's profile: their trainer card (self-declared, editable by them) and a Show 6 arena breakdown computed
 * from public tournament games — only formats whose roster is six count. For anyone but yourself, also your own
 * matches against them (free matches stay private to the two players, so this is the only place they show).
 */
export function PlayerScreen({ playerId, embedded = false }: {
  /** Show this player instead of the route's; Records passes your own id. */
  playerId?: string;
  /** Inside Records' Profile view: no "← Records", since Records is where you already are. */
  embedded?: boolean;
} = {}) {
  const { state, patch } = useAppState();
  const { user } = useSession();
  const id = playerId ?? state.activePlayerId;
  const me = user?.id ?? null;
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<PlayerGame[] | null>(null);
  const [places, setPlaces] = useState<Map<string, { place: number; field: number }>>(new Map());
  const [mine, setMine] = useState<RecordRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [free, setFree] = useState<FreeRecord | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challenging, setChallenging] = useState(false);
  // friend_record answers only for yourself and accepted friends, so a record for someone else means a friend.
  const friend = id !== me && free !== null;

  useEffect(() => {
    if (!me || !id) return;
    let live = true;
    setGames(null); setMine(null); setProfile(null); setPlaces(new Map()); setFailed(false);
    setFree(null); setCode(null); setChallenges([]);
    // Extras, not the profile: a failure here leaves the card without them rather than failing it.
    void friendRecord(id).then(async (f) => {
      if (!live) return;
      setFree(f);
      if (f && id !== me) {
        const [c, l] = await Promise.all([opponentFriendCode(id).catch(() => null), liveChallengesWith(id).catch(() => [])]);
        if (live) { setCode(c); setChallenges(l); }
      }
    }).catch(() => {});
    Promise.all([getProfile(id), listPlayerGames(id), id === me ? Promise.resolve([] as RecordRow[]) : listMyRecords()])
      .then(async ([p, g, r]) => {
        const finished = [...new Set(g.filter((x) => x.complete && x.teamSize === 6).map((x) => x.tournamentId))];
        const [n, pl] = await Promise.all([
          resolveDisplayNames([id, ...g.map((x) => x.opponentId), ...r.filter((x) => x.opponentId === id).map((x) => x.opponentId)]),
          listPlacements(id, finished),
        ]);
        if (live) { setProfile(p); setGames(g); setPlaces(pl); setMine(r.filter((x) => x.opponentId === id)); setNames(n); }
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [me, id]);

  const sc = useMemo(() => showcase(games ?? [], places), [games, places]);
  const pins = profile?.pinnedTrophies ?? [];
  const h2h = useMemo(() => summarise(mine ?? []), [mine]);
  const name = (uid: string) => names.get(uid) ?? 'Unknown player';
  const toRecords = () => patch({ screen: 'records', activePlayerId: null });
  // The route lives in the hash, so Back returns to wherever the profile was opened from (Friends, a tournament, Records).
  const back = () => (history.length > 1 ? history.back() : toRecords());
  const refreshChallenges = () => { if (id) void liveChallengesWith(id).then(setChallenges).catch(() => {}); };
  const open = (uid: string) => patch({ screen: 'player', activePlayerId: uid });
  /** "+", "✕" and a pin save straight away: a tile that looks added must be added. */
  const saveNow = async (edit: Partial<Profile>) => {
    if (!profile || !me) return;
    const next = { ...profile, ...edit };
    setSaveError('');
    try { await saveProfile(me, next); setProfile(next); }
    catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
  };

  if (!user) {
    return (
      <div className="records-screen">
        <div className="panel chamfer-9 tournaments-signin">
          <p className="text-muted">Sign in to see player profiles.</p>
          <button type="button" className="btn btn-primary" onClick={() => patch({ screen: 'account' })}>Sign in</button>
        </div>
      </div>
    );
  }
  if (!id) {
    return (
      <div className="records-screen">
        <p className="panel text-muted">No player selected.</p>
        <div><button type="button" className="btn" onClick={back}>← Back</button></div>
      </div>
    );
  }

  const loading = games === null && !failed;
  const shownName = names.get(id) ?? profile?.displayName ?? (loading ? 'Loading…' : 'Unknown player');
  const fav = profile?.favoriteLeague ?? null;
  const favRecord = fav ? sc.byLeague[fav] : null;
  const total = sc.wins + sc.losses;

  return (
    <div className="records-screen profile-screen">
      {!embedded && <div><button type="button" className="btn" onClick={back}>← Back</button></div>}
      {failed && <p className="friend-notice" role="alert">Couldn't load this profile.</p>}

      <section className="profile-card" style={leagueVars(fav)} aria-label="Trainer card">
        <div className="profile-side">
          {/* The sprite as drawn, centred in the space above the name: no frame, its own silhouette on a contact shadow. */}
          <figure className="profile-trainer-fig">
            {profile?.avatar
              ? <img src={trainerUrl(profile.avatar)} alt={`${shownName}'s trainer`} width={80} height={80} />
              : <span className="profile-trainer-initial" aria-hidden="true">{shownName.slice(0, 1).toUpperCase()}</span>}
          </figure>
          <div className="profile-ident">
            <p className="profile-title">{sc.tier.name}{profile?.specialty ? ` · ${profile.specialty}` : ''}</p>
            <h2 className="player-name profile-name">{shownName}</h2>
            {profile?.region && <p className="profile-region">{profile.region}</p>}
            {(profile?.trainerLevel != null || profile?.xp != null) && (
              <dl className="profile-vitals">
                {profile.trainerLevel != null && <div><dt>Level</dt><dd className="numeric">{profile.trainerLevel}</dd></div>}
                {profile.xp != null && <div><dt>XP</dt><dd className="numeric">{profile.xp.toLocaleString('en-US')}</dd></div>}
              </dl>
            )}
            {profile && <p className="profile-since">Trainer since {new Date(profile.createdAt).getFullYear()}</p>}
            {friend && (
              <div className="profile-own">
                <p className="text-muted">Friend code: <span className="friend-code">{code ?? 'not shared'}</span></p>
                <button type="button" className="btn btn-primary" onClick={() => setChallenging(true)}>Challenge {shownName}</button>
              </div>
            )}
            {saveError && <p className="friend-notice" role="alert">{saveError}</p>}
            {id === me && (
              <div className="profile-own">
                <p className="text-muted">This is you. Your games are under Records → Match history.</p>
                {profile && <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit profile</button>}
              </div>
            )}
          </div>
        </div>
        <Roster profile={profile} own={id === me && !!profile}
          onAdd={() => setAdding(true)}
          onRemove={(ref) => void saveNow({ favoritePokemon: (profile?.favoritePokemon ?? []).filter((r) => r !== ref) })} />
      </section>

      {friend && challenges.length > 0 && (
        <section className="profile-section" aria-label="Challenges">
          <h3 className="hud-label">Live challenges with {shownName}</h3>
          <ul className="match-list">{challenges.map((c) => <li key={c.id}><ChallengeCard offerId={c.id} /></li>)}</ul>
        </section>
      )}

      {free && (
        <dl className="profile-stats" aria-label="Free matches">
          <div><dt>Free matches</dt><dd className="numeric">{free.wins + free.losses}</dd></div>
          <div><dt>Wins</dt><dd className="numeric">{free.wins}<small>{pct(free.wins, free.wins + free.losses)}</small></dd></div>
          <div><dt>Losses</dt><dd className="numeric">{free.losses}</dd></div>
          <div><dt>Unique opponents</dt><dd className="numeric">{free.opponents}</dd></div>
        </dl>
      )}

      {games && (<>
        <dl className="profile-stats" aria-label="Show 6 arena">
          <div><dt>Unique opponents</dt><dd className="numeric">{sc.uniqueOpponents}</dd></div>
          <div><dt>Ranked tournaments</dt><dd className="numeric">{sc.tournaments}</dd></div>
          <div><dt>Record</dt><dd className="numeric">{sc.wins}–{sc.losses}<small>{pct(sc.wins, total)}</small></dd></div>
          <div><dt>Trophies</dt><dd className="numeric">{sc.trophies.length}</dd></div>
        </dl>

        <section className="profile-standing" aria-label="Standing">
          <div className="profile-tier">
            <span className="hud-label">Current tier</span>
            <strong className="profile-tier-name">{sc.tier.name}</strong>
            <div className="profile-meter" role="progressbar" aria-label={sc.tier.next ? `Progress to ${sc.tier.next}` : 'Top tier'}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sc.tier.progress * 100)}>
              <span style={{ width: `${Math.round(sc.tier.progress * 100)}%` }} />
            </div>
            <span className="profile-meter-note">{sc.tier.next ? `Next: ${sc.tier.next}` : 'Top tier'} · from Show 6 tournament games</span>
          </div>
          <dl className="profile-facts">
            <div><dt>Faction</dt><dd>{profile?.faction ?? '—'}</dd></div>
            <div><dt>Role</dt><dd>{profile?.specialty ?? '—'}</dd></div>
            <div style={leagueVars(fav)} className={fav ? 'has-league' : ''}>
              <dt>Favourite league</dt>
              <dd>{fav ? <><LeagueEmblem league={fav} size={22} /> {LEAGUE_NAME[fav]} <span className="numeric">{favRecord!.wins}–{favRecord!.losses}</span></> : '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-section" aria-label="Trophies">
          <h3 className="hud-label">Trophy case</h3>
          {sc.trophies.length === 0 ? <p className="text-muted">No podium finishes in a Show 6 tournament yet.</p> : (
            <ul className="profile-trophies">
              {pinFirst(sc.trophies, pins).map((t) => {
                const pinned = pins.includes(t.tournamentId);
                return (
                  <li key={t.tournamentId} className={`profile-trophy is-p${t.placement!.place}${pinned ? ' is-pinned' : ''}`} style={leagueVars(t.league)}>
                    <span className="profile-trophy-medal" aria-hidden="true">{t.placement!.place}</span>
                    <span className="profile-trophy-format">{t.formatName}</span>
                    <button type="button" className="btn btn-ghost profile-trophy-title" onClick={() => patch({ screen: 'tournaments', activeTournamentId: t.tournamentId })}>{t.title}</button>
                    <span className="profile-trophy-foot">
                      <span className="profile-trophy-place">{PLACE[t.placement!.place]} of {t.placement!.field}</span>
                      {id === me && profile ? (
                        <button type="button" className="btn btn-ghost profile-trophy-pin" aria-pressed={pinned}
                          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${t.title}`}
                          disabled={!pinned && pins.length >= PINS} title={!pinned && pins.length >= PINS ? `At most ${PINS} pinned; unpin one first` : undefined}
                          onClick={() => void saveNow({ pinnedTrophies: pinned ? pins.filter((x) => x !== t.tournamentId) : [...pins, t.tournamentId] })}>
                          {pinned ? '★ Pinned' : '☆ Pin'}
                        </button>
                      ) : pinned && <span className="profile-trophy-pin">★ Pinned</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="profile-section" aria-label="Arena performance">
          <h3 className="hud-label">Arena performance · Show 6</h3>
          {sc.bouts.length === 0 ? <p className="text-muted">No finished Show 6 tournament games.</p> : (
            <ul className="profile-bouts">
              {sc.bouts.map((b: Bout) => (
                <li key={b.tournamentId} className="profile-bout" style={leagueVars(b.league)}>
                  <div className="profile-bout-head">
                    <LeagueEmblem league={b.league} size={28} />
                    <div className="profile-bout-what">
                      <span className="profile-bout-format">{b.formatName}</span>
                      <button type="button" className="btn btn-ghost profile-bout-title" onClick={() => patch({ screen: 'tournaments', activeTournamentId: b.tournamentId })}>{b.title}</button>
                    </div>
                    {b.placement && <span className="profile-bout-place">{PLACE[b.placement.place] || `#${b.placement.place}`} of {b.placement.field}</span>}
                    <dl className="profile-bout-score">
                      <div><dt>Wins</dt><dd className="numeric">{b.wins}</dd></div>
                      <div><dt>Losses</dt><dd className="numeric">{b.losses}</dd></div>
                    </dl>
                  </div>
                  {b.roster ? <Six refs={b.roster.map((m) => m.ref)} size={52} /> : <p className="text-muted">Team not shown.</p>}
                  <details className="profile-bout-games">
                    <summary>{b.games.length} {b.games.length === 1 ? 'game' : 'games'}</summary>
                    <ul className="records-history">
                      {b.games.map((g, i) => (
                        <Line key={`${g.round}-${i}`} won={g.won} score={`${g.myRounds}–${g.oppRounds}`}
                          what={<>R{g.round} vs <button type="button" className="btn btn-ghost" onClick={() => open(g.opponentId)}>{name(g.opponentId)}</button></>}
                          aTitle={shownName} a={g.myRoster} bTitle={name(g.opponentId)} b={g.oppRoster} />
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>)}

      {id !== me && mine && (
        <section className="panel chamfer-9 records-history" aria-label="Your matches">
          <h3 className="hud-label">Your matches against {name(id)}{mine.length > 0 && ` · ${h2h.wins}–${h2h.games - h2h.wins}`}</h3>
          {mine.length === 0 ? <p className="text-muted">You have not played them.</p> : (
            <ul>
              {mine.map((r) => (
                <Line key={r.matchId} won={r.won} score={`${r.myRounds}–${r.oppRounds}`}
                  what={<time dateTime={r.playedAt}>{new Date(r.playedAt).toLocaleDateString('en-CA')}</time>}
                  aTitle="You" a={r.myTeam} bTitle={name(id)} b={r.oppTeam} />
              ))}
            </ul>
          )}
        </section>
      )}

      {challenging && id && (
        <ChallengeSheet target={{ id, name: shownName }} onClose={() => { setChallenging(false); refreshChallenges(); }} />
      )}
      {adding && profile && (
        <FavoritePicker taken={profile.favoritePokemon} onClose={() => setAdding(false)}
          onPick={(ref) => void saveNow({ favoritePokemon: [...profile.favoritePokemon, ref].slice(0, FAVORITES) })} />
      )}
      {editing && profile && me && (
        <ProfileEditor id={me} profile={profile} onClose={() => setEditing(false)}
          onSaved={(e) => setProfile({ ...profile, ...e })} />
      )}
    </div>
  );
}
