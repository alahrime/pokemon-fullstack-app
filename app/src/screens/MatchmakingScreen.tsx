import { useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { PokemonCard } from '../components/PokemonCard';
import { SpeciesSearch } from '../components/SpeciesSearch';
import type { AddPokemonChoice } from '../components/AddPokemonModal';
import { useAppState } from '../state/AppState';
import { useSession } from '../state/SessionContext';
import { Sprite } from '../components/Sprite';
import { LEAGUE_BY_ID, conflictsOnTeam, displayName, movesFor, parseRef, pickableFor, speciesOf } from '../lib/data';
import { defaultSpreadFor } from '../lib/engine';
import { decodeMember, encodeMember, type StoredMember } from '../lib/teamCodec';
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

/**
 * One member of a posted roster, reduced to what can still be said about it on
 * THIS build.
 *
 * `species.json` is generated, and an offer is a row somebody else wrote —
 * possibly on a different data revision. So a ref or a move the current data
 * has never heard of is an ordinary case here, not a corruption, and the rule
 * for it is `decodeMember`'s own: report what is missing, never substitute for
 * it silently, and never take the row down with it. A board that loses a whole
 * offer because one member cannot be resolved is worse than one that shows the
 * other two and says which one it could not read.
 *
 * Nothing in here is allowed to throw. `decodeMember` spreads
 * `stored.charge_moves`, `displayName` calls `endsWith` on `stored.ref` — both
 * are fine for a row this app wrote and neither is guaranteed for a row it did
 * not, and an exception raised while rendering a list item takes the entire
 * screen with it under React.
 */
interface ReadMember {
  /** What to call it: the species name, or the raw ref when there is no species. */
  name: string;
  /** Null when this build cannot resolve the ref — then there is no sprite. */
  species: ReturnType<typeof speciesOf> | null;
  shadow: boolean;
  /** The stored fast move id, when the data no longer has it. */
  unknownMove: string | null;
  /** Set when the entry itself could not be read at all. */
  unreadable: boolean;
}

function readMember(stored: StoredMember): ReadMember {
  try {
    const species = speciesOf(stored.ref) ?? null;
    // decodeMember REPORTS a move that no longer exists rather than quietly
    // resolving to the first one — that report is carried to the row rather
    // than discarded, which is the only place it could go.
    const { unknownMove } = decodeMember(stored);
    return {
      name: displayName(stored.ref),
      species,
      shadow: parseRef(stored.ref).shadow,
      // A ref with no species has no movepool to be missing from, so its
      // `unknownMove` is an artefact of the lookup, not a fact about the move.
      // Saying both would be saying the same absence twice.
      unknownMove: species ? unknownMove : null,
      unreadable: species === null,
    };
  } catch {
    // A row shaped unlike anything this app writes. There is nothing true left
    // to render, so the slot says that rather than disappearing — a roster of
    // three that draws two reads as a roster of two.
    return { name: 'Unreadable entry', species: null, shadow: false, unknownMove: null, unreadable: true };
  }
}

/**
 * The roster an offer was posted with, drawn on the offer's own row. This is
 * what makes the board usable: "expires in 40 minutes" is not a basis for
 * accepting a match, and who is on the other team is.
 *
 * The same vocabulary the team builder uses for a roster — `Sprite` plus
 * `displayName` — rather than a second one invented here. `TypeBadge` is
 * deliberately left out: at six members inside a 240px scroll box, three
 * badges per member is the row's whole budget spent on something the sprite
 * already says at a glance.
 *
 * Renders nothing at all for an empty roster. `unacceptableReason` already
 * refuses such an offer in words; an empty list beside it would read as a
 * roster of nobody rather than as an offer posted without one.
 */
function OfferRoster({ members }: { members: StoredMember[] }) {
  if (members.length === 0) return null;
  return (
    <ul className="offer-roster" aria-label="Roster this offer was posted with">
      {members.map((m, i) => {
        const { name, species, shadow, unknownMove, unreadable } = readMember(m);
        const title = unreadable
          ? `${name} — not in this build's data`
          : unknownMove
            ? `${name} — its saved fast move "${unknownMove}" no longer exists in the data`
            : name;
        return (
          <li
            // Index, not ref: a roster may legitimately repeat nothing, but a
            // malformed row could, and a duplicate key drops a member.
            key={i}
            className={`offer-roster-mon${unreadable ? ' is-unreadable' : ''}`}
            data-ref={typeof m.ref === 'string' ? m.ref : undefined}
            data-unknown-move={unknownMove ?? undefined}
            title={title}
          >
            {species && <Sprite sprite={species.sprite} dex={species.dex} size={22} shadow={shadow} />}
            <span className="offer-roster-name">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}

function queueStatusText(entry: QueueEntry): string {
  // Expiry FIRST, and for the same reason the offer board checks it first: an
  // entry lives ten minutes, `sweep_expired` deletes it on the next tick, and
  // nothing re-reads this panel. Past `expiresAt` the row on screen is a
  // memory, and "eligible to pair" is a claim about the future that has
  // already been falsified — the person is not queued at all and is being
  // told they are.
  if (Date.parse(entry.expiresAt) <= Date.now()) {
    return 'The queue window closed — join again to keep looking.';
  }
  // `verifiedHash` is null until the coordinator recomputes it; only a
  // verified entry is eligible to pair. Saying "queued" alone would imply a
  // match is imminent when it may not even be checked yet.
  return entry.verifiedHash ? 'Queued and eligible to pair.' : 'Queued — awaiting verification.';
}

/**
 * Why NOBODY can accept this offer right now — as distinct from why *you*
 * cannot yet, which is a disabled button with a hint saying what to fix. A
 * reason here means the control is not rendered at all.
 */
function unacceptableReason(o: Offer): string | null {
  // FIRST, because it is first in `accept_offer` too — the reason shown is the
  // reason the database would actually give.
  //
  // Expiry is a coordinator SWEEP, not a trigger: an offer past `expires_at`
  // sits in `state = 'open'` until the next tick, and `listOpenOffers` filters
  // only on `league` and `state`, so an expired row is handed back looking
  // exactly like a live one. Nothing on this screen re-reads the board on its
  // own either, so a page left open past this timestamp would otherwise show
  // an enabled Accept — whose only possible outcome is `accept_offer` raising
  // 'this offer has expired' — for as long as the tab stays open.
  if (Date.parse(o.expiresAt) <= Date.now()) return 'Expired — nobody can accept it now.';
  // The coordinator ticks once a minute, so every offer spends its first
  // minute unverified and `accept_offer` raises for exactly this. Said as
  // something in progress, because it is: a minute from now it is gone.
  if (o.verifiedHash === null) return 'Being checked — acceptable once verified.';
  // Only reachable from a malformed write by some other client: this screen
  // never posts an empty roster. `accept_offer` would not catch it either —
  // it refuses a null `p_team`, not an empty one — so a match would be
  // created with an empty `team_b`.
  if (o.rosterSize < 1) return 'Posted without a roster; nobody can accept it.';
  return null;
}

/**
 * Why the proposer of an offer somebody has ALREADY accepted still cannot
 * confirm it. `unacceptableReason`'s job, for the other half of the handshake.
 *
 * `confirm_offer` has five ways to raise and this screen checked two of them:
 * `proposed` covers 'only the proposer confirms' and `state === 'accepted'`
 * covers 'this offer has not been accepted yet'. The other two are below, and
 * both are reachable — one of them exists only because a migration was written
 * to produce it.
 */
function unconfirmableReason(o: MyOffer): string | null {
  // In `confirm_offer`'s own order, so the reason shown is the reason the
  // database would actually give.
  //
  // Expiry is a coordinator SWEEP, not a trigger, and `myOffers()` never
  // re-reads on its own — so an accepted offer past `expiresAt` sits here
  // showing an enabled Confirm for as long as the tab stays open, not for the
  // minute a verification lag would cost.
  if (Date.parse(o.expiresAt) <= Date.now()) {
    return 'The window closed before this was confirmed.';
  }
  // `accepted_by` is `on delete set null`: a taker who accepts and then
  // deletes their account leaves the offer in state 'accepted' with nobody
  // attached, and nothing about account deletion touches `state`. Migration
  // 20260903011151 exists for exactly this and does nothing else — it turns a
  // raw NOT NULL violation on `matches.player_b` into a sentence — and this
  // screen selected `accepted_by` and ignored it, so the only way to reach
  // that sentence was to press a button that could not work.
  if (o.acceptedBy === null) {
    return 'Whoever accepted it no longer has an account.';
  }
  return null;
}

/**
 * "Add 2 more to queue", "Remove 3 to post" — never "Add -3 more".
 *
 * `verb` is what the control the hint hangs off actually does. Every control
 * gated on `rosterReady` passes its own: Join, Post and Schedule are three
 * buttons that go dead together, and a hint naming the wrong one of them is
 * only marginally better than no hint at all.
 */
function rosterHint(want: number, have: number, verb: 'queue' | 'post' | 'schedule'): string {
  const short = want - have;
  return short > 0 ? `Add ${short} more to ${verb}` : `Remove ${-short} to ${verb}`;
}

/** Why a control is dead for the duration of an in-flight call. */
const BUSY_HINT = 'Working — wait for the last action to finish';

/**
 * Where an offer has got to, said from the reader's own side of it. The two
 * sides are not symmetric: `accepted` is "your move" to the proposer and
 * "waiting on them" to the taker, and telling either one the other's sentence
 * is how someone sits waiting for a handshake that was waiting for them.
 */
function offerStatusText(o: MyOffer, proposed: boolean): string {
  switch (o.state) {
    case 'open':
      if (!proposed) return 'Still open.';
      // The proposer's side of the same minute the board hides Accept for:
      // "nobody has accepted it" would read as indifference from other
      // people when in fact nobody has been allowed to yet.
      return o.verifiedHash === null
        ? 'Posted — being checked before anyone can accept it.'
        : 'Posted — nobody has accepted it yet.';
    case 'accepted':
      // Both of the next two sentences are instructions to WAIT for something
      // that is no longer coming, and an instruction beside a control that is
      // not there is worse than no sentence at all. `sweep_expired` will move
      // this row to 'lapsed' on the next tick and say so itself; until then
      // the screen has to.
      if (Date.parse(o.expiresAt) <= Date.now()) {
        return 'Accepted, but the window closed before it was confirmed.';
      }
      if (!proposed) return "You accepted — awaiting the proposer's confirmation.";
      // "Confirm it" is only worth saying where a Confirm exists.
      return unconfirmableReason(o) === null
        ? 'Someone accepted. Confirm it to make it a match.'
        : 'Someone accepted.';
    case 'confirmed':
    case 'converted':
      return 'Confirmed — this is a match now.';
    case 'lapsed':
      return 'Lapsed — the window closed before it was confirmed.';
  }
}

export function MatchmakingScreen() {
  const { state, patch } = useAppState();
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
  const canAccept = (o: Offer) =>
    !!user && o.proposerId !== user.id && unacceptableReason(o) === null && team.length === o.rosterSize;

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
              // Never "Add -3 more": the picker's cap is the largest thing on
              // the board, so a roster built to accept a six-member offer is
              // longer than a three-member format wants, and the shortfall is
              // negative. Say which way to move it.
              title={rosterReady ? undefined : rosterHint(rosterSize, team.length, 'queue')}
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
                {/* Carries the already-fetched `Match` rather than just
                    `m.id`: the match screen needs the whole row (rounds,
                    which side you sit in, the current state) to render
                    anything, and this list just read it from the server. */}
                <button type="button" className="btn chip-btn match-open" onClick={() => patch({ screen: 'match', activeMatch: m })}>
                  Open match
                </button>
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
              const blocked = unacceptableReason(o);
              return (
                <li key={o.id} className="offer-row" data-offer-id={o.id}>
                  <span className="offer-when">
                    {o.scheduledFor ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}` : 'Open now'}
                  </span>
                  <span className="text-faint">expires {new Date(o.expiresAt).toLocaleString()}</span>
                  {mine ? (
                    <span className="text-faint">Your offer</span>
                  ) : blocked ? (
                    // Not a disabled button: nothing this person does would
                    // make it work, so the reason takes the control's place
                    // rather than sitting in a tooltip on a dead one.
                    <span className="text-faint offer-blocked">{blocked}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn chip-btn offer-accept"
                      // Not `rosterReady`: that asks whether YOU could post,
                      // and accepting is the offer's business, not your
                      // format's.
                      disabled={!canAccept(o) || busy}
                      // `busy` FIRST: it is the one gate that can be shut
                      // while `canAccept` is true, and a control disabled for
                      // a reason nobody states is the same defect as a
                      // control that can only fail.
                      title={
                        busy
                          ? BUSY_HINT
                          : canAccept(o)
                            ? undefined
                            : `This offer is played with a roster of ${o.rosterSize}`
                      }
                      onClick={() => void accept(o)}
                    >
                      Accept
                    </button>
                  )}
                  {/* Last in the row, on its own wrapped line: the when, the
                      expiry and the control keep the line they have always
                      had, and the roster sits under them rather than pushing
                      them about. */}
                  <OfferRoster members={o.roster} />
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
                className="btn btn-primary offer-post"
                disabled={!rosterReady || busy}
                // The same gate as Join, so the same hint — with this
                // control's own verb. Without one, the state round 3 named
                // (six picked to reach a bigger offer, own format of three)
                // left these two buttons dead and silent while Join beside
                // them explained itself.
                title={busy ? BUSY_HINT : rosterReady ? undefined : rosterHint(rosterSize, team.length, 'post')}
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
                  className="btn offer-schedule"
                  disabled={!rosterReady || busy || !scheduleAt}
                  // Three gates, so three reasons, in the order they are
                  // checked. The date one matters most: a ready roster and no
                  // date is the ONLY way this button is dead while Join beside
                  // it is live, so "add/remove members" would be actively
                  // misleading there.
                  title={
                    busy
                      ? BUSY_HINT
                      : !rosterReady
                        ? rosterHint(rosterSize, team.length, 'schedule')
                        : !scheduleAt
                          ? 'Pick a date and time to schedule for'
                          : undefined
                  }
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
              const confirmable = proposed && o.state === 'accepted';
              const confirmBlocked = confirmable ? unconfirmableReason(o) : null;
              return (
                <li key={o.id} className="my-offer-row" data-my-offer-id={o.id} data-offer-state={o.state}>
                  <span className="my-offer-when">
                    {o.scheduledFor
                      ? `Scheduled for ${new Date(o.scheduledFor).toLocaleString()}`
                      : 'Posted to the open board'}
                  </span>
                  <span className="text-faint my-offer-status">{offerStatusText(o, proposed)}</span>
                  {/* Confirm ONLY for the proposer of an offer someone has
                      actually accepted, and only when confirm_offer's other
                      two raises are also out of the way. A Confirm anywhere
                      else is a button whose entire behaviour is to print raw
                      Postgres text at someone — and the reason takes the
                      control's place rather than sitting in a tooltip on a
                      dead one, the same shape the board uses. */}
                  {confirmable &&
                    (confirmBlocked ? (
                      <span className="text-faint offer-blocked">{confirmBlocked}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn chip-btn offer-confirm"
                        disabled={busy}
                        title={busy ? BUSY_HINT : undefined}
                        onClick={() => void confirm(o.id)}
                      >
                        Confirm
                      </button>
                    ))}
                  {/* Your own offers get it too — an offer you posted days ago
                      is one you no longer remember the roster of, and a
                      scheduled one you accepted is a match you are about to
                      have to prepare for. */}
                  <OfferRoster members={o.roster} />
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
