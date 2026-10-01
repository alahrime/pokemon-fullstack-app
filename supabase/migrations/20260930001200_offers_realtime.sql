-- Live offer state: a challenge card refetches the moment its offer row changes instead of waiting
-- for a poll. Realtime applies the subscriber's own RLS to each change, so a viewer only ever hears
-- about offers they could already read. The row travels with the event, but the client ignores it
-- and refetches (the card needs the joined view, and the policy is the single source of truth).
alter publication supabase_realtime add table public.match_offers;
