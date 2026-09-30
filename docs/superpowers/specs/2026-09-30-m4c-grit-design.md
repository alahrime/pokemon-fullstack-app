# M4c — Grit

Last piece of platform-spec M4. Derived, never stored; own grit only.

## Rulings (from the brainstorm, approved 2026-09-30)

1. **Across-match grit only.** Grit = win rate in a player's game right after a loss, within
   one tournament. The within-set reading (down 0–2, took it 3–2) is impossible:
   `tournament_pairings` stores only the final score. It needs per-game reporting first.
2. **Counted games only:** `_pairing_counts` (settled, or reported and past `final_at`),
   non-bye, unequal score, tournament `running` or `complete`. A bye or a drawn round
   between two games is skipped; it is not a game.
3. **Shown only when meaningful:** `post_loss_games >= gate` and `tournaments >= 2`, else
   "Not enough tournament play yet (N of gate games, M of 2 tournaments)". Gate =
   `greatest(10, ceil(median post-loss sample over everyone who has any))`, an aggregate
   that reveals nothing about anyone.
4. Wilson interval under 30 games (as win rate). Independent of the Ranked/All switch.

## Database (`20260930000500_grit.sql`)

`_grit_games()` (internal, revoked from every client role): one row per player per eligible
pairing with `post_loss` via `lag` over `(player, tournament) order by round`.
`my_grit()` (security definer, `authenticated` only, null uid returns nothing) returns
`post_loss_games, post_loss_wins, tournaments, gate` for the caller.

## Client

`lib/records.ts`: `myGrit()`, pure `gritStatus()`. Records screen: a fifth tile, omitted if
the read fails.

## Testing

DB (`supabase/tests/grit.test.ts`): loss→win counted once, bye / draw / uncounted /
cancelled-event excluded, mirror view for the opponent, two-tournament count, gate rises with
the median, anon and the internal function refused. Unit: `gritStatus`, `myGrit`. Screen:
both tile states, switch independence, failed read.

## Out of scope

Within-set grit, a public grit board, double-elim / round-robin (the query is shape-agnostic).
