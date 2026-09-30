-- M4a: ratings. See docs/superpowers/specs/2026-09-30-m4a-ratings-design.md.

alter table public.matches
  add column league text,
  add column settled_at timestamptz,
  add column rated_at timestamptz;

-- settled_at is the rating clock: when adjudication first made the match
-- 'confirmed'. A trigger, not an edit to submit_report, so the most
-- lock-sensitive function in the system stays untouched.
create function public.matches_stamp_settled() returns trigger
language plpgsql as $$
begin
  if new.state = 'confirmed' and old.state is distinct from 'confirmed' then
    new.settled_at := now();
  end if;
  return new;
end;
$$;
create trigger matches_stamp_settled before update on public.matches
  for each row execute function public.matches_stamp_settled();

create index matches_unrated_idx on public.matches (settled_at)
  where rated_at is null and state = 'confirmed' and source = 'queue';

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null unique,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);

create table public.ratings (
  season_id uuid not null references public.seasons (id) on delete cascade,
  league text not null check (league in ('great', 'ultra', 'master')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating float8 not null default 1500,
  rd float8 not null default 350,
  vol float8 not null default 0.06,
  games integer not null default 0,
  wins integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, league, user_id)
);
create index ratings_board_idx on public.ratings (season_id, league, rating desc);

-- Gate constants live in one place (spec: tunable, beside each other).
create function public.rating_constants()
returns table (min_games integer, max_rd float8, tau float8)
language sql immutable as $$ select 5, 110::float8, 0.5::float8 $$;

alter table public.seasons enable row level security;
alter table public.ratings enable row level security;
create policy "seasons are public to signed-in users" on public.seasons
  for select to authenticated using (true);
-- Below the gate a player is absent from the board; they still see themselves.
create policy "your own rating, and anyone past the gate" on public.ratings
  for select to authenticated
  using (user_id = (select auth.uid())
         or (games >= (select min_games from public.rating_constants())
             and rd <= (select max_rd from public.rating_constants())));
revoke all on public.seasons, public.ratings from anon, authenticated;
grant select on public.seasons, public.ratings to authenticated;

-- Glickman, "Example of the Glicko-2 system" (2013), steps 1-8. Arrays so one
-- call covers the published multi-game example; the sweep passes length 1.
create function public._glicko2_f(x float8, delta float8, phi float8, v float8, a float8, tau float8)
returns float8 language sql immutable as $$
  select exp(x) * (delta ^ 2 - phi ^ 2 - v - exp(x)) / (2 * (phi ^ 2 + v + exp(x)) ^ 2)
         - (x - a) / tau ^ 2
$$;

create function public.glicko2_update(
  p_rating float8, p_rd float8, p_vol float8,
  p_opp_rating float8[], p_opp_rd float8[], p_score float8[], p_tau float8 default 0.5
) returns table (rating float8, rd float8, vol float8)
language plpgsql immutable set search_path = public as $fn$
declare
  q constant float8 := 173.7178;
  mu float8 := (p_rating - 1500) / q;
  phi float8 := p_rd / q;
  a float8 := ln(p_vol ^ 2);
  v_inv float8 := 0; delta_sum float8 := 0;
  j integer; gj float8; ej float8; v float8; delta float8;
  big_a float8; big_b float8; big_c float8; fa float8; fb float8; fc float8;
  k integer; guard integer := 0;
  new_vol float8; phi_star float8; new_phi float8; new_mu float8;
begin
  if coalesce(array_length(p_score, 1), 0) = 0 then
    return query select p_rating, least(sqrt(phi ^ 2 + p_vol ^ 2) * q, 350::float8), p_vol;
    return;
  end if;
  for j in 1 .. array_length(p_score, 1) loop
    gj := 1 / sqrt(1 + 3 * (p_opp_rd[j] / q) ^ 2 / pi() ^ 2);
    ej := 1 / (1 + exp(-gj * (mu - (p_opp_rating[j] - 1500) / q)));
    v_inv := v_inv + gj ^ 2 * ej * (1 - ej);
    delta_sum := delta_sum + gj * (p_score[j] - ej);
  end loop;
  v := 1 / v_inv;
  delta := v * delta_sum;

  big_a := a;
  if delta ^ 2 > phi ^ 2 + v then
    big_b := ln(delta ^ 2 - phi ^ 2 - v);
  else
    k := 1;
    while public._glicko2_f(a - k * p_tau, delta, phi, v, a, p_tau) < 0 and k < 100 loop
      k := k + 1;
    end loop;
    big_b := a - k * p_tau;
  end if;
  fa := public._glicko2_f(big_a, delta, phi, v, a, p_tau);
  fb := public._glicko2_f(big_b, delta, phi, v, a, p_tau);
  while abs(big_b - big_a) > 0.000001 and guard < 100 loop
    guard := guard + 1;
    big_c := big_a + (big_a - big_b) * fa / (fb - fa);
    fc := public._glicko2_f(big_c, delta, phi, v, a, p_tau);
    if fc * fb < 0 then big_a := big_b; fa := fb; else fa := fa / 2; end if;
    big_b := big_c; fb := fc;
  end loop;

  new_vol := exp(big_a / 2);
  phi_star := sqrt(phi ^ 2 + new_vol ^ 2);
  new_phi := 1 / sqrt(1 / phi_star ^ 2 + 1 / v);
  new_mu := mu + new_phi ^ 2 * delta_sum;
  return query select q * new_mu + 1500, q * new_phi, new_vol;
end;
$fn$;

create function public.season_for(t timestamptz) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  m timestamp := date_trunc('month', t at time zone 'UTC');
  sid uuid;
begin
  insert into public.seasons (starts_at, ends_at)
  values (m at time zone 'UTC', (m + interval '1 month') at time zone 'UTC')
  on conflict (starts_at) do nothing;
  select id into sid from public.seasons where starts_at = m at time zone 'UTC';
  return sid;
end;
$fn$;

revoke all on function public._glicko2_f(float8, float8, float8, float8, float8, float8) from public, anon, authenticated;
revoke all on function public.glicko2_update(float8, float8, float8, float8[], float8[], float8[], float8) from public, anon, authenticated;
revoke all on function public.season_for(timestamptz) from public, anon, authenticated;
revoke all on function public.matches_stamp_settled() from public, anon, authenticated;
revoke all on function public.rating_constants() from public, anon;
grant execute on function public.rating_constants() to authenticated;
