-- Ratings (M4a) are dropped at the user's direction: no rating persists across users;
-- what is kept is the win/loss record and the Pokémon used (see 20260930001100).
-- The design and SQL live in git history (feat M4a, 20260930000300/000310).
-- matches.league and matches.settled_at stay: the records view reads both.
select cron.unschedule('sweep-ratings');
drop function public.leaderboard(uuid, text, integer);
drop function public.sweep_ratings();
drop function public.season_for(timestamptz);
drop function public.glicko2_update(float8, float8, float8, float8[], float8[], float8[], float8);
drop function public._glicko2_f(float8, float8, float8, float8, float8, float8);
drop table public.ratings;
drop table public.seasons;
drop function public.rating_constants();
drop index public.matches_unrated_idx;
alter table public.matches drop column rated_at;
