# M5 — Tournament channels

Platform-spec M5 ("Groups"), scoped by the user to **tournament channels only**. Persistent
communities, announcements, pinned messages and post restrictions are out.

## Rulings

1. **Everyone in it posts.** Existing message policy, reporting and block rules apply
   unchanged (blocks only bite in DMs since 20260908); the organiser posts like anyone.
2. **Membership is derived by triggers** from the tournament tables, so no tournament function
   is edited: wanted = organiser, any judge, any entrant with `dropped = false`. One function,
   `_sync_tournament_member(tournament, user)`, recomputes a single person; triggers on
   `tournament_entrants` (insert / update of `dropped` / delete) and `tournament_roles`
   (insert / delete) call it. The organiser is `owner` and never removed.
3. **Nobody leaves by hand:** `leave_channel` refuses `tournament`; `add_to_group` already
   refuses non-groups; client writes to `channel_members` stay revoked.
4. A cancelled or finished tournament keeps its channel, readable and postable.

## Database (`20260930000600_tournament_channels.sql`)

`channels.tournament_id` (unique, cascade), `kind` check widened, `(kind='tournament') =
(tournament_id is not null)`. An `after insert` trigger on `tournaments` creates the channel
(title = tournament title, organiser owner); an `after update of title` trigger retitles it.
Existing tournaments are backfilled in the migration.

## Client

`ChannelKind` gains `tournament`; it lists like a group (title, member count) under a new
"Tournaments" filter, with no opponent panel. `tournamentChannelId(id)` returns the channel or
null (RLS hides it from non-members); the tournament page shows **Open chat** only when it is
non-null, which requests the channel and switches to Chat.

## Testing

DB (`supabase/tests/tournament_channels.test.ts`): creation and retitle, register / withdraw /
drop / un-drop / judge grant and revoke, judge-who-is-also-an-entrant, member read and post,
outsider sees and posts nothing, leave refused, add refused, hand-insert refused, internal
function refused, anon sees nothing, cancel keeps it. Unit and screen tests for the client.
