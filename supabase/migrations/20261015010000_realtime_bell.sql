-- The bell, the nav badges and the chat list now follow Realtime instead of a 15-30s poll (lib/realtime.ts). They
-- already hear messages and match_offers; these are the rest of what they read. Realtime delivers a row only to a
-- subscriber whose RLS lets them select it, so publishing adds no read access.
alter publication supabase_realtime add table public.friendships, public.tournaments, public.tournament_pairings;
