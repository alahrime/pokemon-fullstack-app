# Profile showcase — plan (2026-10-13)

Extends the player profile (`#/play/players/<id>`) into a trainer card plus a Show 6 arena breakdown, and lets the
owner edit it in place. Reference: Silph Road trainer/arena cards; the target is a more refined read of that in
Paragon's own HUD language (chamfers, hairlines, mono micro-labels, league ball colours).

## Decisions

- **Show 6 only.** Every arena number (W/L, unique opponents, tournaments, tier, trophies, favourite-league record)
  is computed from tournament games whose format's `composition.size === 6`. Free matches stay private to their two
  players (M6), so they never feed a public profile.
- **Computed client-side, not stored.** Pairings, rosters and tournament formats are already readable by every
  signed-in user; a counter table would drift from them. One pure function (`lib/profile.ts` `showcase`) does it.
- **Tier is derived, never persisted.** Ratings across users were removed at the user's direction (M4a); a tier from
  the Wilson lower bound of your own Show 6 game record is a badge of your record, not a rating against others.
- **Trophies** are podium finishes (1st/2nd/3rd) in completed Show 6 tournaments, from `swiss.standings` over that
  tournament's counted pairings, named with the tournament's format — so a custom format's trophy is exclusive to it.
- **Skipped:** global/national rank (needs ratings), grit (deferred by the user), spice index, season-ending tier
  (no seasons), favourite-trophy pinning. Each is one line in the summary to the user.

## Tasks

1. **Migration** `20261013000000_profile_showcase.sql`: `profiles` gains `avatar`, `region`, `trainer_level`,
   `xp`, `favorite_pokemon text[] (≤6)`, `favorite_league`, `faction`, `specialty`, each with a CHECK. The existing
   owner-only UPDATE policy covers writes. DB test in `supabase/tests/profile-showcase.test.ts`.
2. **Trainer sprites**: `app/src/data/trainers.json`, the 1,500 slugs listed at
   `play.pokemonshowdown.com/sprites/trainers/`, loaded lazily by the picker only.
3. **`lib/profile.ts`**: `getProfile`, `saveProfile`, `trainerUrl`, `tierFor`, `showcase(games, placements)`.
4. **`listPlayerGames`** carries league, format name and team size per game; **`listPlacements`** computes podiums.
5. **`PlayerScreen`** redesign: trainer card (avatar, title tier, name, region, level, XP, favourite six), stat
   strip, faction/role/favourite league, trophy case, arena performance per tournament (six + W–L, games folded).
   Owner sees "Edit profile" → `ProfileEditor` overlay (avatar picker grid, fields, six SpeciesSearch slots).
6. Account screen links to your own profile. Tests for `showcase`/`tierFor`, the editor and the screen.
7. Gate (`npm run check`, `check:db` for the new test), measure in the browser at 1440 and 375, commit, push.
