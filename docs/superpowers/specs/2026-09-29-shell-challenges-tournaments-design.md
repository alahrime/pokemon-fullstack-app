# Shell, challenges and tournaments — design

**Date:** 2026-09-29. **Status:** design approved in conversation section by section; awaiting spec review.
**Extends:** `2026-08-31-paragon-platform-design.md` (the authority for identity, RLS, coordinator, judging).
**Builds on:** M0–M3b (accounts, saves, matchmaking, reporting, friends, channels, `ChatDock`).

Three sub-projects, each with its own plan and build, in this order: **A. Shell**, **B. Challenges and chat**,
**C. Tournaments and roster registration**. Rosters are shared by B and C but only C needs the picker.

---

## A. Shell redesign

Replace the 14 flat nav tabs with a top bar and a per-section rail.

- **Sections** (`SECTIONS` in `lib/screens.ts`, grouping the existing `SCREEN_DEFS`; feeds top bar, rail and landing cards):
  - **Analyze:** Report, Battle, Moves, Rankings, Diagnostics.
  - **Teams:** GBL Teams, Show 6, Cores, Formats.
  - **Play:** Matches, Tournaments, Friends, Chat.
- **Top bar:** brand, three section buttons, global league switcher, notification bell, one account/theme menu. Account leaves the tab list.
- **Rail:** left, lists the active section's screens, existing chamfered HUD style and per-screen hue. Under ~768px it becomes a horizontally scrolling strip under the top bar. Badges: pending offers, unread chat, live-round tournaments.
- **`match`** stops being a tab: opened from a row, shown under Play with a back link.
- **State stays `state.screen`.** No router. Add hash sync (`#/play/tournaments`) so back/forward and shared links work.
- **Landing:** cards grouped by section.
- **Unchanged:** engine, data, `ChatDock`.
- **Verification:** a test asserting every screen belongs to exactly one section; rail geometry measured in the browser; `tools/layout-snapshot.js` diff of the untouched screens must be zero against a two-run noise floor.

## B. Challenges and chat

A **challenge is a match offer aimed at one person**, reusing terms review, accept/confirm handshake, expiry,
conversion to `matches`, the auto-created match channel and block enforcement.

- **Schema:** `match_offers.target_id` (nullable). A targeted offer is visible only to proposer and target and never on the public board; `accept_offer` refuses anyone but the target. New offer state `declined`.
- **Eligibility (ruling):** friends, or anyone you share a live match with — identical to the DM rule. Blocked users can never challenge.
- **Expiry (ruling):** 1 hour for now-challenges; until play time for scheduled. No sweep change.
- **Chat:** new message kind `challenge` referencing the offer. Renders in the DM as a live card (format, league, now/scheduled, expiry; Accept, Decline, Counter; states open, accepted, confirmed, declined, lapsed).
- **Entry points:** friend row, DM header, Chat opponent panel, tournament roster row. All open one compact sheet reusing the existing offer form.
- **Chat screen (Play → Chat):** inbox left (reuses `listChannelsWithActivity`), conversation centre (reuses `ChatPane`), opponent panel right (name, friend code via `opponentFriendCode`, record vs you, open offers between you, Challenge/Block/Report). The dock remains as the overlay and shares components and unread state.
- **Bell:** derived from realtime on offers, messages and friend requests; count = unread channels + offers awaiting your response. In-app bell and toasts only (ruling); web push is out.
- **Out of scope:** typing indicators, read receipts, attachments.

## C. Tournaments and roster registration

**Lifecycle:** `draft → registration → running → complete`, plus `cancelled`. Host-driven; an optional registration close time auto-advances via the coordinator sweep.

**v1 is Swiss only (ruling).** Any signed-in user may host; the host is the organiser and appoints co-hosts and judges (scoped, audited, per the platform spec).

**Tables:**
- `tournaments`: organiser, title, description, format version, league, Swiss rounds, round length (minutes), max players, registration close, state, current round, round deadline.
- `tournament_entrants`: player, roster (jsonb, exactly 6), seed, dropped, cached record.
- `tournament_roles`: co-host / judge, per tournament.
- `tournament_pairings`: round, table no., player A/B, game scores, state (`pending`, `reported`, `disputed`, `settled`), link to `matches` and its channel (so opponent chat already works).
- `tournament_audit`: every override and grant with actor and prior value.

**Roster (always exactly 6):** per slot — species, fast move, two charged moves, Best Buddy flag, Shadow flag, CP. Picker from our species/movepool data; import from a saved 6-team. Validated by the shared rules validator (the one bundled for the coordinator), enforced again by a DB check. Editable until registration closes. RLS hides rosters from everyone, host included, until registration closes; then every entrant sees every roster. "See / hide your Pokémon" is a personal display toggle.

**Swiss pairing (coordinator):** round 1 random or seeded; later rounds by match points, no rematches, greedy with backtracking; odd count gives a bye to the lowest-ranked player without one, scored 2–0. Tiebreaks: match points, opponent match-win %, game-win %, head-to-head. Default rounds ⌈log₂ N⌉. The host's Progress Round requires all pairings settled, or a forced advance that is written to the audit table.

**Reporting (ruling):** either player reports; it appears on the bracket immediately. It becomes final at the round deadline (or 10 minutes after, whichever is later) unless the opponent disputes. A dispute goes to host/judge, settled by hand (no model adjudication in a bracket). All overrides audited.

**No-shows (ruling):** nothing automatic; the round timer is display only. After the deadline the host sees a "needs attention" list and may award a loss or double loss.

**Late join (ruling):** never after the tournament starts. Registration closes at start.

**Screens (Play → Tournaments):**
1. **Browse:** upcoming/live/finished cards (state chip, players, time left); Host and Join.
2. **Tournament page:** title, hosts, chips ("Swiss Bracket", "Round length: N minutes"), state banner (Registration Open / Closed / Teams Visible), round countdown, the one primary action for your state (Register, Edit roster, View your matchup), host panel; tabs Bracket, Standings, Players.
3. **Bracket:** one column per round, numbered tables, "R / N Rounds" header, player count, opponent search. Winner/loser use type-colour tokens and themes, not literal red/green; result is also carried by a text mark, never colour alone.
4. **Players:** roster cards — name, record chip, six sprite tiles with their moves, Best Buddy/Shadow badges; host-only Remove player; Chat/Challenge per player.
5. **Your matchup:** both rosters side by side, score report, match chat, timer, dispute.

## Cross-cutting

- Everything uses the existing HUD design tokens and themes; new colours come from tokens. Animations run once and respect `prefers-reduced-motion`.
- Each sub-project ends gate-green (`npm run check`, and `npm run check:db` for schema). After any change reaching `src/rules`, run `npm run build:coordinator`.
- Deploy order per the handoff: push migrations, then `supabase functions deploy coordinator`.
- Tournaments are gated on the moderation requirement from M2 onward: report/queue coverage for tournament chat and rosters.

## Open items (not yet decided)

- Whether the coordinator or a Postgres function computes standings (default: coordinator, same as pairing).
- Roster CP: free entry validated against the league cap and species range, or derived from level and IVs. Default: free entry, validated.
