-- Every minute. Latency is a later optimisation; the spec's whole point in
-- starting with a scheduled function is that nothing here holds a socket.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'coordinator-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.coordinator_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    )
  );
  $$
);

-- Reviewer note: the URL and key come from settings rather than being
-- written into this migration, because a migration is committed and a
-- service-role key must never be. Set them per environment with:
--   alter database postgres set app.coordinator_url = '…';
--   alter database postgres set app.service_role_key = '…';
-- If that indirection proves awkward on the hosted project, the fallback is
-- Supabase's dashboard-managed cron — but do not inline the key here to make
-- this step pass.
