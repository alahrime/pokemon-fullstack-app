# Records and profiles (replaces M4a ratings)

**Decision (user, 2026-09-30):** no rating persists across users. Keep a record of match wins and losses and of the Pokémon used,
reachable from either player's profile, and public in tournaments to participants and viewers.

**Rulings (the user accepted these defaults):**
1. Ratings are removed (`20260930001000_drop_ratings.sql`): `ratings`, `seasons`, `leaderboard`, `sweep_ratings`, the `sweep-ratings` cron job,
   `matches.rated_at`. `matches.league` and `matches.settled_at` stay (the records view reads them). Recoverable from git history (M4a).
2. Free matches stay private to their two players. `my_match_records` (still `security_invoker`, still filtered to the caller) now also returns
   `my_team` and `opp_team`: ref, fast move and charge moves only. `matches.team_a/b` also hold IVs and a level; the view builds the teams key
   by key (`_team_view`), so an opponent's spread never reaches a record. `_team_view` is granted to `authenticated` because a security-invoker
   view runs it as the caller.
3. Tournament rosters are readable by every signed-in user once registration is closed (`tournament_is_closed`), instead of members only.
   Before close a roster is still its owner's alone; a tournament cancelled in registration is still not "closed". Pairings and entrants were
   already visible to every signed-in user, so a tournament's whole record is now public to them. Signed-out visitors still see nothing.
4. Profile = `#/play/players/<uuid>` (`PlayerScreen`, not a rail item; Records stays lit). It shows that player's counted tournament games with both
   sixes, and, for anyone but yourself, **your own** free matches against them with both teams. There is no public free-match history.
   Entry points: the opponent's name on a Records row, "View profile" on each card of a tournament's Players tab, and names inside a profile.
5. Records rows fold both teams under a "Pokémon" toggle.

**Not built:** a way to see another player's free matches with third parties (by ruling 2), signed-out spectators, a collusion view, a leaderboard.
