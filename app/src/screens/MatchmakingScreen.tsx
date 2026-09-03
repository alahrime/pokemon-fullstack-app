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
import type { LeagueId } from '../lib/types';
import {
  acceptOffer,
  confirmOffer,
  createOffer,
  joinQueue,
  leaveQueue,
  listOpenOffers,
  myMatches,
  myOffers,
  myQueueEntry,
  opponentFriendCode,
  type Match,
  type MyOffer,
  type Offer,
  type QueueEntry,
} from '../lib/matchmaking';
import { listServerFormats, type SavedFormat } from '../lib/saves';

/**
 * The Matchmaking screen: three answers to one question — who do I play next
 * — on one screen. A blind queue paired by the coordinator, a live board of
 * offers anyone can browse and accept, and scheduled proposals that need
 * both sides to confirm before they become a match.
 *
 * **What you queue under.** M2a queues with a format the person has SAVED ON
 * THE SERVER, chosen here by name. Canonical per-league league formats are
 * deferred to the ranked milestone: the spec ties them to ranked play, M2a
 * has no rating, and partitioning the queue by `rules_hash` already means two
 * people who authored the same rules meet each other. So `formatVersionId` is
 * a real `format_versions.id` from `listServerFormats`, not a placeholder —
 * the earlier `canonical:${league}` string was a value no foreign key could
 * ever have accepted. Someone with no saved format for this league is told
 * so and offered no control that could only fail.
 *
 * The roster is built right here rather than loaded from a saved team, and
 * scored under the league's own rated moveset — the same fallback `Slot` uses
 * on `TeamBuilderScreen` for a member that was never opened in a build
 * picker. How many members it needs comes from the chosen format's
 * `composition.size`, not a constant: the format is the thing that says how
 * big a roster is.
 */

/** Only until a format is chosen — the empty slots have to be some number. */
const DEFAULT_ROSTER_SIZE = 3;

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

/**
 * Where an offer has got to, said from the reader's own side of it. The two
 * sides are not symmetric: `accepted` is "your move" to the proposer and
 * "waiting on them" to the taker, and telling either one the other's sentence
 * is how someone sits waiting for a handshake that was waiting for them.
 */
function offerStatusText(o: MyOffer, proposed: boolean): string {
  switch (o.state) {
    case 'open':
      return proposed ? 'Posted — nobody has accepted it yet.' : 'Still open.';
    case 'accepted':
      return proposed
        ? 'Someone accepted. Confirm it to make it a match.'
        : "You accepted — awaiting the proposer's confirmation.";
    case 'confirmed':
    case 'converted':
      return 'Confirmed — this is a match now.';
    case 'lapsed':
      return 'Lapsed — the window closed before it was confirmed.';
  }
}

export function MatchmakingScreen() {
  const { state } = useAppState();
  const { user } = useSession();
  const league = state.league;

  // --- the format being queued under --------------------------------------
  // Null while loading, [] once loaded and empty — a distinction the screen
  // renders, since "you have no saved formats" is a wrong thing to say to
  // someone whose formats simply have not arrived yet.
  const [savedFormats, setSavedFormats] = useState<SavedFormat[] | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);

  const leagueFormats = useMemo(
    () => (savedFormats ?? []).filter((f) => f.format.base === league),
    [savedFormats, league],
  );
  // Filtered to this league's own formats: `league` is what the queue and the
  // board are partitioned on, and offering a Master format while the screen
  // says Great would queue someone under rules they are not looking at.
  const chosen = leagueFormats.find((f) => f.id === chosenId) ?? leagueFormats[0] ?? null;
  const rosterSize = chosen ? chosen.format.composition.size : DEFAULT_ROSTER_SIZE;

  // Declared here rather than with the board below because the roster's own
  // capacity depends on it — see `rosterCapacity`.
  const [offers, setOffers] = useState<Offer[] | null>(null);

  // --- the roster, built locally on this screen ---------------------------
  const [team, setTeam] = useState<string[]>([]);
  /**
   * The most members this roster could need: your own format's size, or the
   * largest offer on the board. Capping at your own size would make a bigger
   * offer permanently unacceptable — no amount of picking would reach its
   * length — which is the "control that cannot succeed" rule again, wearing
   * the roster's clothes instead of the button's.
   */
  const rosterCapacity = Math.max(rosterSize, ...(offers ?? []).map((o) => o.rosterSize));
  const selectable = useMemo(
    () => new Set(pickableFor(league).filter((r) => !team.some((m) => m === r || conflictsOnTeam(m, r)))),
    [league, team],
  );
  const add = (ref: string) => {
    setTeam((t) =>
      t.includes(ref) || t.length >= rosterCapacity || t.some((m) => conflictsOnTeam(m, ref)) ? t : [...t, ref],
    );
  };
  const clear = (i: number) => setTeam((t) => t.filter((_, n) => n !== i));
  const buildTeam = (): StoredMember[] => team.map((ref) => encodeMember(defaultChoice(ref, league), league));
  /**
   * Ready to JOIN or POST — both of which are queued under your own chosen
   * format, so both need one. Accepting is deliberately not this: see
   * `canAccept`.
   */
  const rosterReady = !!chosen && team.length === rosterSize;

  // Nothing may sit past the capacity: a member the slots do not render is a
  // member nobody can remove, and it still counts towards every length check
  // on this screen.
  useEffect(() => {
    setTeam((t) => (t.length > rosterCapacity ? t.slice(0, rosterCapacity) : t));
  }, [rosterCapacity]);

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
      setSavedFormats(null);
      return;
    }
    let live = true;
    void listServerFormats()
      .then((f) => {
        if (live) setSavedFormats(f);
      })
      .catch((e: unknown) => {
        if (live) {
          setSavedFormats([]);
          setNotice(messageOf(e));
        }
      });
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
    if (!chosen || !rosterReady || entry || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      // The version id, not the format id: what two people agreed to play is
      // an immutable version, so editing this format afterwards cannot change
      // the rules of a match already queued under it.
      await joinQueue({
        league,
        formatVersionId: chosen.versionId,
        format: chosen.format,
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
  const [justAccepted, setJustAccepted] = useState<{ offerId: string; matchId: string | null } | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  // Every offer this person is party to, READ FROM THE DATABASE — proposed or
  // accepted, in whatever state. Not session state: an offer leaves
  // `state = 'open'` the moment someone accepts it, so a panel driven by what
  // this tab happened to post would forget the handshake on reload, and
  // `listOpenOffers` would never hand it back. That is the offer lapsing and
  // the match never being created.
  const [mine, setMine] = useState<MyOffer[] | null>(null);

  useEffect(() => {
    if (!user) {
      setOffers(null);
      setMine(null);
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

  useEffect(() => {
    if (!user) return;
    let live = true;
    void myOffers()
      .then((o) => {
        if (live) setMine(o);
      })
      .catch((e: unknown) => {
        if (live) setNotice(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [user]);

  /**
   * Accepting is governed by the OFFER, not by you. `accept_offer(p_offer,
   * p_team)` takes no format: the offer's own `format_version_id` is what the
   * match is played under, so a saved format of your own is not needed to
   * accept one, and requiring it locked out everyone who has none — the
   * database would have taken them. The roster has to be the size the OFFER
   * wants for the same reason; sizing it by your own format would let a
   * 6-strong roster into a 3-member offer, which nothing downstream rejects
   * (the coordinator recomputes `rules_hash` and never inspects `team`).
   */
  const canAccept = (o: Offer) => !!user && o.proposerId !== user.id && team.length === o.rosterSize;

  const accept = async (o: Offer) => {
    if (!canAccept(o) || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const matchId = await acceptOffer(o.id, buildTeam());
      setOffers((prev) => (prev ? prev.filter((x) => x.id !== o.id) : prev));
      setJustAccepted({ offerId: o.id, matchId });
      // Re-read what this person is party to: the offer just accepted is now
      // one of them, and this is the read that will still find it tomorrow.
      setMine(await myOffers());
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
    if (!chosen || !rosterReady || busy) return;
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
      await createOffer({
        league,
        formatVersionId: chosen.versionId,
        format: chosen.format,
        team: buildTeam(),
        scheduledFor,
      });
      setPostOpen(false);
      setScheduleAt('');
      setOffers(await listOpenOffers(league));
      // Read the new offer back rather than remembering it here: what this
      // panel shows has to be there after a reload too.
      setMine(await myOffers());
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
      setMine(await myOffers());
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
        <div className="hud-label">Format for {LEAGUE_BY_ID.get(league)?.label ?? league}</div>
        {savedFormats === null && <p className="text-faint">Reading your saved formats…</p>}
        {savedFormats !== null && leagueFormats.length === 0 && (
          <p className="text-muted no-formats">
            You have no saved format for this league. Author one on the Formats screen and save it to your
            account — a match is played under a saved format, so there is nothing to queue with until then.
          </p>
        )}
        {leagueFormats.length > 0 && (
          <div className="format-choices">
            {leagueFormats.map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn seg-btn format-choice"
                data-format-id={f.id}
                aria-pressed={chosen?.id === f.id}
                onClick={() => setChosenId(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel panel-strong">
        <div className="hud-label">
          Your roster for {LEAGUE_BY_ID.get(league)?.label ?? league}
        </div>
        {/* Your own format's size, but never fewer slots than the roster
            actually holds — someone building up to a larger offer must be
            able to see, and remove, every member they picked. */}
        <div className="team-slots">
          {Array.from({ length: Math.max(rosterSize, team.length) }, (_, i) => {
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
          {/* No Join at all without a format to join under: `format_version_id`
              is NOT NULL and a foreign key, so the call could only fail. Same
              rule as the Accept control on one's own offer. */}
          {chosen && (
            <button
              type="button"
              className="btn btn-primary queue-join"
              disabled={!rosterReady || !!entry || busy}
              title={!rosterReady ? `Add ${rosterSize - team.length} more to queue` : undefined}
              onClick={() => void join()}
            >
              {busy ? 'Working…' : 'Join queue'}
            </button>
          )}
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
                      // Not `rosterReady`: that asks whether YOU could post,
                      // and accepting is the offer's business, not your
                      // format's.
                      disabled={!canAccept(o) || busy}
                      title={
                        canAccept(o) ? undefined : `This offer is played with a roster of ${o.rosterSize}`
                      }
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
            shove anything below it down the page as offers arrive. The list
            above is bounded and scrolls for the same reason. */}
        <div className="move-picker">
          {chosen && (
          <button
            type="button"
            className="btn move-picker-btn"
            aria-expanded={postOpen}
            onClick={() => setPostOpen((o) => !o)}
          >
            Post an offer
          </button>
          )}
          {chosen && postOpen && (
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

      {mine && mine.length > 0 && (
        <div className="panel">
          <div className="hud-label">Your offers</div>
          <p className="text-muted">
            Every offer you proposed or accepted, read back from the server — so a scheduled proposal is
            still here, and still confirmable, on your next visit.
          </p>
          <ul className="my-offer-list">
            {mine.map((o) => {
              const proposed = o.proposerId === user.id;
              return (
                <li key={o.id} className="my-offer-row" data-my-offer-id={o.id} data-offer-state={o.state}>
                  <span className="my-offer-when">
                    {o.scheduledFor
                      ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}`
                      : 'Posted to the open board'}
                  </span>
                  <span className="text-faint my-offer-status">{offerStatusText(o, proposed)}</span>
                  {/* Confirm ONLY for the proposer of an offer someone has
                      actually accepted. confirm_offer raises "only the
                      proposer confirms" for the taker and "this offer has not
                      been accepted yet" for every other state, so a Confirm
                      anywhere else is a button whose entire behaviour is to
                      print raw Postgres text at someone. */}
                  {proposed && o.state === 'accepted' && (
                    <button
                      type="button"
                      className="btn chip-btn offer-confirm"
                      disabled={busy}
                      onClick={() => void confirm(o.id)}
                    >
                      Confirm
                    </button>
                  )}
                </li>
              );
            })}
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
