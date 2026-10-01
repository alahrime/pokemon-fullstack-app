-- Best Buddy travels with a saved team member, as it already does inside a challenge's team jsonb.
-- Default false: every existing row was saved without it.
alter table public.team_members add column best_buddy boolean not null default false;
