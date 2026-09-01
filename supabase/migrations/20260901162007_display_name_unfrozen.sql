-- Product reversal: display names are no longer permanent. The name was
-- frozen so that "this person has always been this person" held for the
-- lifetime of an account; that guarantee is withdrawn so someone can fix a
-- name they regret, and so losing a name race (see
-- 20260901160626_confirm_survives_name_collision.sql) stops being
-- permanent for the loser too -- they can register again later once the
-- name they wanted, or a different one, is free, and eventually rename
-- into it.
--
-- The UNIQUE constraint on display_name is deliberately KEPT: a display
-- name still identifies a person, so two people cannot hold the same one
-- AT THE SAME TIME. What is traded away by removing only the trigger is
-- the "always been" guarantee -- impersonation-by-rename becomes possible
-- (take a name, do something, rename away, someone else claims it), since
-- uniqueness only ever prevented two people holding a name at once, never
-- one person holding it after another gave it up.
drop trigger if exists profiles_display_name_frozen on public.profiles;
drop function if exists public.freeze_display_name();
