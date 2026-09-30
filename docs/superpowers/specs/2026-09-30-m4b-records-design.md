# M4b — Records

Second piece of platform-spec M4 (after M4a ratings). Derived views, never counters.

## Rulings (from the brainstorm)

1. **Own records only.** Every view is scoped to the caller. No public profiles, no
   collusion surface for players (an admin-side check is a later concern).
2. **Confirmed `matches` only** (queue, offers, challenges). Tournament pairings are a
   different table with game scores; they stay out (M4c reads them for grit). A
   Ranked / All switch: ranked = `source='queue'` and league great/ultra/master — the
   sweep's predicate without `rated_at`.
3. **Days use the browser's timezone** (`Intl`). Nothing in the app sets
   `profiles.timezone`; a setting that writes it is deferred. The screen says so.

## Database (`20260930000400_records.sql`)

`my_match_records`, a `security_invoker` view, one row per confirmed match from the
caller's side: `match_id, played_at (coalesce(settled_at, created_at)), league, source,
ranked, opponent_id, opponent_name, my_rounds, opp_rounds, won`. Filters on
`auth.uid() in (player_a, player_b)` itself as well as relying on RLS. Select granted
to `authenticated` only.

## Client

- `lib/records.ts`: `listMyRecords()` (500-row pages), pure `summarise`, `wilson`,
  `byDay`, `monthGrid`, `toCsvRows`.
- Play → Records screen (`records`): Ranked/All switch; tiles (win rate — with a
  Wilson 95% interval under 30 games —, games, unique opponents, rounds); month
  calendar with W–L per day; history (newest first, "Show more"); Export CSV via
  `exportData.downloadCsv`.

## Testing

DB: the view shows only your matches from your side, ranked predicate, non-confirmed
excluded, anon refused. Unit: `summarise`, `wilson`, `byDay` across a timezone
boundary, `monthGrid`, CSV rows. Screen tests; 1440 and 375 measurements.

## Out of scope

Public profiles, collusion flag, tournament games, charts over time, timezone setting.
