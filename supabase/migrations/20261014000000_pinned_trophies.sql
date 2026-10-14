-- Trophies a trainer pins to the front of their trophy case: tournament ids, at most three. Self-declared like the
-- rest of the showcase and written through the owner-only UPDATE policy. A pin is only a preference: a trophy is
-- still computed from the pairings, so pinning a tournament you did not podium in shows nothing.
alter table public.profiles
  add column pinned_trophies uuid[] not null default '{}'
    check (cardinality(pinned_trophies) <= 3 and array_position(pinned_trophies, null) is null);
