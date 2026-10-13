-- A match made from an offer or a challenge never carried its league: only
-- pair_queue_entries wrote matches.league (20260930000310), while
-- accept_offer and confirm_offer insert the match without it. Records, the
-- Match screen and anything else reading matches.league saw null for every
-- challenge.
--
-- Rather than restate both functions, the league follows the link: when an
-- offer is pointed at its match, the match takes the offer's league if it has
-- none. Existing rows are backfilled the same way.
create or replace function public._match_takes_offer_league() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update public.matches set league = new.league where id = new.match_id and league is null;
  return new;
end;
$fn$;
revoke all on function public._match_takes_offer_league() from public, anon, authenticated;

create trigger match_takes_offer_league
  after insert or update of match_id on public.match_offers
  for each row when (new.match_id is not null)
  execute function public._match_takes_offer_league();

update public.matches m set league = o.league
  from public.match_offers o
 where o.match_id = m.id and m.league is null;
