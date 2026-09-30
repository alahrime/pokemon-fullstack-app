# M4a — Ratings, seasons, leaderboard

Part of platform spec M4 (ranked, records). M4 is split: **M4a** (this) ratings,
seasons, leaderboard; **M4b** records (win rate, unique opponents as the collusion
detector, history, timezone-aware calendar, export); **M4c** grit (tournament-only,
gated, interval). M4b/M4c read what M4a decides (season boundaries, eligibility).

## Rulings (from the brainstorm)

1. **Rating pass runs in SQL** (`sweep_ratings()`), scheduled directly by `pg_cron`
   (`select public.sweep_ratings()`), not via the coordinator Edge Function: no Vault
   secrets, no function deploy, and it works the moment the migration applies.
2. **Sweep, one match per update.** Each eligible match is applied as a one-game
   Glicko-2 period, in `settled_at` order. `submit_report` is not edited.
3. **Calendar-month seasons, hard reset.** Season = UTC month containing `settled_at`.
   Every `(season, league, user)` starts at 1500 / RD 350 / σ 0.06. No soft reset.
4. **Gated leaderboard.** A player is listed after 5 rated games and RD <= 110
   (constants in one SQL function). Below the gate a player sees only their own
   provisional card. No opt-out flag (deferred).

## Eligibility (re-derived, never trusted from `rating_counted`)

A match is rated iff `source = 'queue'`, `state = 'confirmed'`, `league in
('great','ultra','master')`, `rated_at is null`, and it has a full `match_rounds` set.
Offers, challenges, tournaments and non-canonical leagues never move a number.
`matches.league` is new, copied from the queue entry by `pair_queue_entries()`; earlier
rows have `league null` and are never rated (nothing ranked existed in production).

## Schema (`20260930000300_ratings.sql`)

- `matches`: `league text`, `settled_at timestamptz` (stamped by a before-update trigger
  when `state` first becomes `confirmed`), `rated_at timestamptz`.
- `seasons(id, starts_at, ends_at)`, one row per UTC month, created lazily.
- `ratings(season_id, league, user_id, rating, rd, vol, games, wins, updated_at)`,
  PK `(season_id, league, user_id)`. RLS: select for authenticated; no client writes
  (revoke insert/update/delete from anon/authenticated).
- `rating_constants()`: start 1500/350/0.06, tau 0.5, gate 5 games, RD <= 110.
- `leaderboard(p_season, p_league, p_limit)`: security definer, applies the gate
  server-side, joins display names, returns rank/name/rating/rd/games/wins.

## The pass

`sweep_ratings()` takes a global advisory lock, selects up to 200 eligible matches by
`settled_at`, and per match (own exception block; a bad row is skipped with a notice):
find/create the season, upsert both rating rows, lock them in user-id order, apply
Glicko-2 (score 1/0 by majority of `match_rounds`), write both, stamp `rated_at`.
Revoked from everyone but the owner/cron.

## Client

`lib/ranked.ts` (RPC + own-row reads), `screens/RankedScreen.tsx` under Play: league
tabs, season select (default current), board rows `rank · name · rating ± RD · W–L`,
a provisional card for the viewer below the gate. (Deferred: a Match-screen "counts toward rating" chip.)

## Testing

DB tests: Glickman's worked example through the same math (1500/200/0.06 vs three
opponents -> 1464.06 / 151.52 / 0.05999), hand-computed one-game update, idempotence,
ineligible matches ignored, season boundary, leaderboard gate, client writes refused.
The real `submit_report` → `sweep_ratings` path is one DB test (no separate roundtrip tool). App: unit tests for `lib/ranked.ts` and the
screen; layout checks at 1440 and 375.

## Out of scope

Soft reset, leaderboard opt-out, rating history chart, collusion flags (M4b),
tournament rating (spec excludes it).
