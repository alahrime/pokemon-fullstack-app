-- The profile showcase: what a trainer chooses to show on their profile page. All optional, all self-declared
-- (none of it is verifiable, like go_username), all written through the existing owner-only UPDATE policy and
-- readable by every signed-in user like the rest of the profile.
--
-- Arena numbers (W/L, opponents, tournaments, tier, trophies) are deliberately NOT columns: they are computed from
-- public pairings by the client, so there is no counter to drift from the games it counts.
alter table public.profiles
  -- A Showdown trainer sprite slug; the client builds the URL, so this can never be an arbitrary address.
  add column avatar text check (avatar ~ '^[a-z0-9-]{1,40}$'),
  add column region text check (length(btrim(region)) between 1 and 60),
  add column trainer_level smallint check (trainer_level between 1 and 80),
  add column xp bigint check (xp between 0 and 99999999999),
  -- Species refs, at most six: a Show 6 is six.
  add column favorite_pokemon text[] not null default '{}'
    check (cardinality(favorite_pokemon) <= 6 and array_position(favorite_pokemon, null) is null),
  add column favorite_league text check (favorite_league in ('great', 'ultra', 'master')),
  add column faction text check (length(btrim(faction)) between 1 and 40),
  add column specialty text check (length(btrim(specialty)) between 1 and 40);
