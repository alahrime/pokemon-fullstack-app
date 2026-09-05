-- A best-of-N ends the moment one side reaches N/2+1 wins, and not before.
-- Both facts are checkable from the array alone: the side that won the LAST
-- round must hold exactly the needed count (so it reached it on that round and
-- not earlier), and the other side must hold fewer.
create or replace function public.is_valid_scoreline(best_of smallint, wins text[])
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select best_of in (3, 5)
     and wins is not null
     and array_length(wins, 1) is not null
     and array_length(wins, 1) between (best_of / 2 + 1) and best_of
     and not exists (select 1 from unnest(wins) w where w is null or w not in ('a', 'b'))
     and (select count(*) from unnest(wins) w where w = wins[array_length(wins, 1)])
         = (best_of / 2 + 1)
     and (select count(*) from unnest(wins) w where w <> wins[array_length(wins, 1)])
         < (best_of / 2 + 1)
$fn$;

-- What each side CLAIMED. Never the truth; see match_rounds for that.
create table public.match_reports (
  match_id uuid not null references public.matches (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  -- Copied from matches.rounds by submit_report, which is the only writer, so
  -- a check constraint can validate the pair without joining to matches.
  best_of smallint not null,
  -- 'a' or 'b' per round, in MATCH terms (matches.player_a / player_b), not
  -- reporter-relative: two reports are then compared with `=` rather than by
  -- flipping one side's perspective, and a perspective flip is exactly the
  -- kind of thing that is right in tests and wrong in the one caller that
  -- matters.
  wins text[] not null,
  submitted_at timestamptz not null default now(),
  amended_at timestamptz,
  amend_count smallint not null default 0,
  primary key (match_id, reporter_id),
  constraint match_reports_scoreline check (public.is_valid_scoreline(best_of, wins))
);

-- The adjudicated per-round truth.
create table public.match_rounds (
  match_id uuid not null references public.matches (id) on delete cascade,
  round_no smallint not null,
  -- RESTRICT: a profile that is deleted must not silently rewrite a settled
  -- record into one with a missing winner. The match itself cascades away.
  winner uuid not null references public.profiles (id) on delete restrict,
  primary key (match_id, round_no),
  constraint match_rounds_round_no check (round_no between 1 and 5)
);

alter table public.matches drop constraint matches_state;
alter table public.matches add constraint matches_state
  check (state in ('paired', 'reported', 'confirmed', 'mismatch', 'disputed', 'unverified', 'abandoned'));

alter table public.matches add column rating_counted boolean not null default false;
alter table public.matches add column amend_deadline timestamptz;

alter table public.match_reports enable row level security;
alter table public.match_rounds enable row level security;

-- The sealing rule, verbatim from the spec. If a player can read the opponent's
-- claim before filing their own, the honest path and the exploit are the same
-- click. Note what this does NOT need: at 'mismatch' both sides learn they
-- disagree from matches.state, which they can already read, so nothing has to
-- be widened to tell them.
create policy "your own report always, your opponent's only once confirmed"
  on public.match_reports for select
  to authenticated
  using (
    reporter_id = (select auth.uid())
    or exists (
      select 1 from public.matches m
       where m.id = match_reports.match_id
         and m.state = 'confirmed'
         and (select auth.uid()) in (m.player_a, m.player_b)
    )
  );

create policy "an adjudicated round is visible to the two people in the match"
  on public.match_rounds for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
       where m.id = match_rounds.match_id
         and (select auth.uid()) in (m.player_a, m.player_b)
    )
  );

-- Belt and braces, and a DIFFERENT error class on purpose. With no write policy
-- these tables are already default-deny, but that produces a policy refusal
-- which a later `for all` policy could quietly convert into a grant. Revoking
-- the verb means a mistake like that still cannot write, and the test can tell
-- the two apart.
revoke insert, update, delete on public.match_reports from anon, authenticated;
revoke insert, update, delete on public.match_rounds from anon, authenticated;

-- The friend code must stay readable for the whole live match, not just while
-- 'paired'. Without this, reporting hides the code mid-match — the one moment
-- both players still need it.
drop policy "an opponent may read your friend code while you have a match" on public.friend_codes;
create policy "an opponent may read your friend code while you have a match"
  on public.friend_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.state in ('paired', 'reported', 'mismatch', 'disputed')
        and ((m.player_a = friend_codes.profile_id and m.player_b = (select auth.uid()))
          or (m.player_b = friend_codes.profile_id and m.player_a = (select auth.uid())))
    )
  );
