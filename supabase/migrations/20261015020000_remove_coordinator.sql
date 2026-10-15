-- Removes the coordinator, with the blind queue and the open offer board it served (user's decision, 2026-10-15:
-- revisit once tournaments and challenges are settled).
--
-- The per-minute `coordinator-tick` job called an Edge Function that did two kinds of work:
--   1. Recomputed each queue entry's and public offer's rules hash with the client's own code, then paired the
--      queue (`pair_queue_entries`). Only the queue and the board needed this; challenges skip verification
--      (20261002000000) and the client no longer offers either.
--   2. Called three plain-SQL sweeps: `sweep_expired` (offers, challenges included, and queue entries lapse),
--      `sweep_matches` (stalled matches) and `sweep_messages` (the 7-day message expiry).
-- Part 2 never needed the Edge Function. It is now three pg_cron jobs of its own, the shape `sweep-ratings` had,
-- so it no longer depends on Vault secrets or the function URL. In production the tick had been answering 401 for
-- weeks, so these sweeps start running there with this migration rather than continuing.
--
-- Kept on purpose: the queue_entries/match_offers tables, `pair_queue_entries`, `accept_offer`'s verified-hash
-- branch and the verified_hash columns. They cost nothing idle and are what a revisit would build on.
-- Not touched here: the Vault secrets `coordinator_url` and `coordinator_service_role_key` and the deployed
-- `coordinator` function; with nothing calling them they are inert, and removing them is the project owner's call.

select cron.unschedule('coordinator-tick');
drop function public.coordinator_tick();

-- One job each, so a failure in one sweep does not roll back the others.
select cron.schedule('sweep-expired', '* * * * *', 'select public.sweep_expired()');
select cron.schedule('sweep-matches', '* * * * *', 'select public.sweep_matches()');
select cron.schedule('sweep-messages', '* * * * *', 'select public.sweep_messages()');
