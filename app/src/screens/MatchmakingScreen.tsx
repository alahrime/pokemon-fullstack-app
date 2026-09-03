import { useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { PokemonCard } from '../components/PokemonCard';
import { SpeciesSearch } from '../components/SpeciesSearch';
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { LEAGUE_BY_ID, conflictsOnTeam, movesFor, pickableFor, speciesOf } from '../lib/data';
import { defaultSpreadFor } from '../lib/engine';
import { encodeMember, type StoredMember } from '../lib/teamCodec';
import { RULES_SCHEMA, type Format } from '../rules';
import type { LeagueId } from '../lib/types';
import {
  acceptOffer,
  confirmOffer,
  createOffer,
  joinQueue,
  leaveQueue,
  listOpenOffers,
  myMatches,
  myQueueEntry,
  opponentFriendCode,
  type Match,
  type Offer,
  type QueueEntry,
} from '../lib/matchmaking';

/**
 * The Matchmaking screen: three answers to one question — who do I play next
 * — on one screen. A blind queue paired by the coordinator, a live board of
 * offers anyone can browse and accept, and scheduled proposals that need
 * both sides to confirm before they become a match.
 *
 * The roster is built right here rather than loaded from a saved team: this
 * screen's "Consumes" list is deliberately narrow (Task 7's matchmaking API,
 * `useSession`, `LEAGUE_BY_ID`), and pulling in `lib/saves`' saved-team and
 * saved-format machinery would have meant mocking a second module boundary
 * this screen's tests were never asked to cover. What is built here is
 * scored under the league's own rated moveset — the same fallback `Slot`
 * uses on `TeamBuilderScreen` for a member that was never opened in a build
 * picker.
 *
 * `formatVersionId`/`format` are the "canonical league format" the design
 * spec describes for the open queue: the whole base league, no extra
 * clauses. See the KNOWN GAP note on `canonicalFormatVersionId` below —
 * there is currently no code anywhere, in this screen or elsewhere, that can
 * produce or discover a *real* `format_versions.id` for it.
 */

const ROSTER_SIZE = 3;

function canonicalFormat(league: LeagueId): Format {
  return {
    schema: RULES_SCHEMA,
    base: league,
    start: 'league',
    pool: [],
    composition: { size: ROSTER_SIZE, uniqueSpecies: true },
    selection: { mode: 'open' },
  };
}

/**
 * KNOWN GAP, reported rather than papered over (see task-8-report.md): a
 * `format_version_id` is a foreign key into `format_versions`, and nothing
 * in this codebase today can produce or discover a real one for a league's
 * canonical, unrestricted ruleset — there is no seed migration for it, and
 * `lib/saves.ts`'s `listServerFormats` doesn't expose `format_versions.id`
 * for a custom saved format either (only `formats.id`, a different table).
 * This placeholder keeps the shape of the write honest rather than hiding
 * the gap; `joinQueue`/`createOffer` will fail their foreign key against a
 * real database until that plumbing exists.
 */
function canonicalFormatVersionId(league: LeagueId): string {
  return `canonical:${league}`;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What a member saves as when it was never opened in a build picker — the
 * league's rated set, same fallback `TeamBuilderScreen`'s `Slot` uses. */
function defaultChoice(refId: string, leagueId: LeagueId): AddPokemonChoice {
  const sp = speciesOf(refId);
  if (!sp) return { ref: refId, chargeIds: [], fastIdx: 0, iv: { a: 0, d: 15, s: 15 } };
  const rated = movesFor(sp, leagueId);
  const spread = defaultSpreadFor(refId, leagueId, true);
  return {
    ref: refId,
    fastIdx: Math.max(0, sp.fastMoves.findIndex((m) => m.id === rated.fast.id)),
    chargeIds: rated.charges.map((c) => c.id),
    iv: { a: spread.a, d: spread.d, s: spread.s },
  };
}

function queueStatusText(entry: QueueEntry): string {
  // `verifiedHash` is null until the coordinator recomputes it; only a
  // verified entry is eligible to pair. Saying "queued" alone would imply a
  // match is imminent when it may not even be checked yet.
  return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
}

export function MatchmakingScreen() {
  const { state } = useAppState();
  const { user } = useSession();
  const league = state.league;

  // --- the roster, built locally on this screen ---------------------------
  const [team, setTeam] = useState<string[]>([]);
  const selectable = useMemo(
    () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
    [league, team],
  );
  const add = (ref: string) => {
    setTeam((t) =>
      t.includes(ref) || t.length >= ROSTER_SIZE || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
    );
  };
  const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
  const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
  const rosterReady = team.length === ROSTER_SIZE;

  // --- the blind queue ------------------------------------------------------
  const [entry, setEntry] = useState<QueueEntry | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [codes, setCodes] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setEntry(null);
      setMatches(null);
      setCodes({});
      return;
    }
    let live = true;
    void myQueueEntry()
      .then((e) => {
        if (live) setEntry(e);
      })
      .catch((e: unknown) => {
        if (live) setNotice(messageOf(e));
      });
    void myMatches()
      .then((m) => {
        if (live) setMatches(m);
      })
      .catch((e: unknown) => {
        if (live) setNotice(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [user]);

  // Friend codes are readable only once a match pairs two people — fetched
  // once matches are known, one call per opponent, never guessed at.
  useEffect(() => {
    if (!matches || matches.length === 0) return;
    let live = true;
    void Promise.all(
      matches.map((m) => opponentFriendCode(m.opponentId).then((code) => [m.opponentId, code] as const)),
    ).then((pairs) => {
      if (live) setCodes(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [matches]);

  const join = async () => {
    if (!rosterReady || entry || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await joinQueue({
        league,
        formatVersionId: canonicalFormatVersionId(league),
        format: canonicalFormat(league),
        team: buildTeam(),
      });
      setEntry(await myQueueEntry());
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!entry) return;
    // Irreversible the moment it lands — the same confirm idiom
    // `TeamBuilderScreen` uses before `deleteTeam`.
    if (!window.confirm('Leave the queue? You will stop being matched until you join again.')) return;
    setBusy(true);
    setNotice(null);
    try {
      await leaveQueue();
      setEntry(null);
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  // --- the open offer board --------------------------------------------------
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  // Offers this screen has posted this session, so a Confirm control can be
  // offered for them. There is no function anywhere in `lib/matchmaking` to
  // list "offers I proposed" (only `listOpenOffers`, scoped to `state =
  // 'open'`, which an accepted offer has already left) — see the report.
  // Confirming one nobody has actually accepted yet simply answers with
  // whatever error `confirm_offer` raises; that is surfaced, not hidden.
  const [posted, setPosted] = useState<{ id: string; scheduledFor: string | null }[]>([]);

  useEffect(() => {
    if (!user) {
      setOffers(null);
      return;
    }
    let live = true;
    void listOpenOffers(league)
      .then((o) => {
        if (live) setOffers(o);
      })
      .catch((e: unknown) => {
        if (live) setNotice(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [user, league]);

  const accept = async (o: Offer) => {
    if (!user || o.proposerId === user.id || !rosterReady || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const matchId = await acceptOffer(o.id, buildTeam());
      setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
      setJustAccepted({ offerId: o.id, matchId });
      // A live offer resolves to a match id immediately; a scheduled one
      // returns null and stays `accepted`, not a match, until the proposer
      // confirms — rendering null as "matched" would put a battle on
      // someone's calendar nobody actually agreed to yet.
      if (matchId) setMatches(await myMatches());
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const post = async (scheduled: boolean) => {
    if (!rosterReady || busy) return;
    let scheduledFor: Date | undefined;
    if (scheduled) {
      if (!scheduleAt) {
        setNotice('Pick a date and time to schedule for.');
        return;
      }
      scheduledFor = new Date(scheduleAt);
    }
    setBusy(true);
    setNotice(null);
    try {
      const id = await createOffer({
        league,
        formatVersionId: canonicalFormatVersionId(league),
        format: canonicalFormat(league),
        team: buildTeam(),
        scheduledFor,
      });
      setPosted((p) => [...p, { id, scheduledFor: scheduledFor ? scheduledFor.toISOString() : null }]);
      setPostOpen(false);
      setScheduleAt('');
      setOffers(await listOpenOffers(league));
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await confirmOffer(id);
      setPosted((p) => p.filter((o) => o.id !== id));
      setMatches(await myMatches());
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="matchmaking-screen">
        <ScreenHeader
          title="Matches"
          blurb="Queue for a blind match, browse an open offer, or schedule one for later."
        />
        <div className="panel text-muted">Sign in to queue for a match, browse the open offer board, or schedule one for later.</div>
      </div>
    );
  }

  return (
    <div className="matchmaking-screen">
      <ScreenHeader
        title="Matches"
        blurb="Queue for a blind match, browse an open offer, or schedule one for later."
      />

      <div className="panel panel-strong">
        <div className="hud-label">
          Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
        </div>
        <div className="team-slots">
          {Array.from({ length: ROSTER_SIZE }, (_, i) => {
            const r = team[i] ?? null;
            return r ? (
              <PokemonCard key={i} refId={r} league={league} size="compact" onClick={() => clear(i)} title="Click to remove" />
            ) : (
              <div key={i} className="team-slot is-empty">
                <span className="team-slot-hint">Empty</span>
              </div>
            );
          })}
        </div>
        <div className="team-add">
          <SpeciesSearch
            key={team.length}
            id="matchmaking-team-add"
            value=""
            onChange={add}
            placeholder="Add a Pokémon to this roster"
            includeShadow
            restrictTo={selectable}
          />
        </div>
      </div>

      <div className="panel">
        <div className="hud-label">Blind queue</div>
        <p className="text-muted">
          Matched with anyone else queued under the same league and rules, blind — no format to browse, no
          opponent to pick.
        </p>
        {entry && <p className="queue-status">{queueStatusText(entry)}</p>}
        <div className="matchmaking-actions">
          <button
            type="button"
            className="btn btn-primary queue-join"
            disabled={!rosterReady || !!entry || busy}
            title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to queue` : undefined}
            onClick={() => void join()}
          >
            {busy ? 'Working…' : 'Join queue'}
          </button>
          {entry && (
            <button type="button" className="btn" disabled={busy} onClick={() => void leave()}>
              Leave queue
            </button>
          )}
        </div>
        {matches && matches.length > 0 && (
          <ul className="match-list">
            {matches.map((m) => (
              <li key={m.id} className="match-row">
                <span>Match paired</span>
                <span className="friend-code">
                  {codes[m.opponentId] === undefined
                    ? 'Loading friend code…'
                    : codes[m.opponentId]
                      ? `Friend code: ${codes[m.opponentId]}`
                      : 'No friend code on file for this opponent.'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="hud-label">Open offer board</div>
        <p className="text-muted">
          Browse a curated offer, or post one of your own — live now, or scheduled for later once both sides
          confirm.
        </p>
        {justAccepted && (
          <p className="matchmaking-notice" role="status">
            {justAccepted.matchId
              ? 'Matched! Check your matches above for the friend code.'
              : "Offer accepted — awaiting the proposer's confirmation. Not a match yet."}
          </p>
        )}
        {offers && offers.length === 0 && <p className="text-faint">No open offers right now.</p>}
        {offers && offers.length > 0 && (
          <ul className="offer-list">
            {offers.map((o) => {
              const mine = o.proposerId === user.id;
              return (
                <li key={o.id} className="offer-row" data-offer-id={o.id}>
                  <span className="offer-when">
                    {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                  </span>
                  <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                  {mine ? (
                    <span className="text-faint">Your offer</span>
                  ) : (
                    <button
                      type="button"
                      className="btn chip-btn offer-accept"
                      disabled={!rosterReady || busy}
                      title={!rosterReady ? `Add ${ROSTER_SIZE - team.length} more to accept` : undefined}
                      onClick={() => void accept(o)}
                    >
                      Accept
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Overlays the panel rather than growing it — the board must not
            shove anything below it down the page as offers arrive. */}
        <div className="move-picker">
          <button
            type="button"
            className="btn move-picker-btn"
            aria-expanded={postOpen}
            onClick={() => setPostOpen((o) => !o)}
          >
            Post an offer
          </button>
          {postOpen && (
            <div className="move-picker-panel offer-post-panel">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!rosterReady || busy}
                onClick={() => void post(false)}
              >
                Post to the open board
              </button>
              <div className="offer-schedule-row">
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!rosterReady || busy || !scheduleAt}
                  onClick={() => void post(true)}
                >
                  Schedule
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {posted.length > 0 && (
        <div className="panel">
          <div className="hud-label">Your posted offers</div>
          <p className="text-muted">
            A scheduled offer becomes a match only once you confirm it here after someone accepts.
          </p>
          <ul className="posted-offer-list">
            {posted.map((o) => (
              <li key={o.id} className="posted-offer-row">
                <span>
                  {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Posted to the open board'}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => void confirm(o.id)}>
                  Confirm
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p className="matchmaking-notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}
