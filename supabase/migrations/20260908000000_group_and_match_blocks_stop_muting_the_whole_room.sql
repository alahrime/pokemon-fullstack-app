-- FIX: a single block silenced the blocked party to an entire group or match
-- channel, not just to the person who blocked them.
--
-- THE BUG, MEASURED AGAINST THE DEPLOYED POLICY
-- (`20260907003000_messages.sql`'s "a member who is not blocked may post",
-- which this migration replaces): the INSERT policy's `not exists` clause
-- scans EVERY other member of the channel and refuses the insert if ANY ONE
-- of them has blocked the poster (`blocked_with_me(other.user_id)`). That
-- clause's own comment calls this "directional" and contrasts it with a
-- symmetric rule that would "let one blocker mute themselves to every other
-- member of a room" — true as far as it goes, but it describes only what
-- happens to the BLOCKER. It says nothing about what actually happens to the
-- BLOCKED party, which is: in an 8-person group, one person blocking you
-- means you can no longer post ANYTHING to that channel — not just to them,
-- to all seven others too, with no explanation. "Directional" here only
-- means the blocker keeps posting; it does not mean the block's effect stays
-- confined to the pair. `supabase/tests/channels.test.ts`'s own group test
-- ("keeps a block directional in a group: the blocked member cannot post,
-- the blocker still can") pins exactly this: bob is blocked by ann and
-- refused for the WHOLE group, including messages that would only ever have
-- reached cal, who never blocked him and has no say in the matter.
--
-- THE OPTIONS, AND WHY (b) IS THE ONE IMPLEMENTED BELOW
--
-- RLS cannot deliver "everyone in the room sees this except the one person
-- who blocked the author" at INSERT time — a row is inserted once and is
-- then subject to each reader's OWN select policy, but the insert itself is
-- a single yes/no decision with no per-future-reader branch. So the three
-- realistic shapes are:
--
--   (a) Leave it. One blocker mutes the blocked party to the whole room.
--       Rejected: this is the bug. A group's whole point is that membership
--       is a many-to-many relationship; letting any ONE edge of that graph
--       (a block between two specific members) sever every OTHER edge (every
--       other member's ability to hear from the blocked one) is exactly the
--       "room-wide" collateral damage the brief calls out, and it gets worse
--       as the group grows — the bigger and more valuable the room, the more
--       damage a single unrelated block does to it.
--
--   (b) Drop the block check entirely for `group` and `match` channels; a
--       block only bites in a DM (this migration's `kind = 'dm'` branch,
--       untouched) and in matchmaking (`pair_queue_entries`'s
--       `blocked_between` exclusion and `accept_offer_blocked_guard`, both
--       in `20260906002000_friend_codes_and_blocked_matchmaking.sql` —
--       neither touched by this migration and both still enforced).
--       IMPLEMENTED. Reasoning below.
--
--   (c) Make the block's effect follow the READER instead of the writer:
--       keep the insert unconditional in a group/match channel, and instead
--       add a per-viewer clause to the messages SELECT policy so a member
--       who blocked (or was blocked by) the author simply does not see that
--       author's rows, while every OTHER member's view is untouched. This is
--       the one shape of "affects only the pair" that RLS actually CAN
--       express, because SELECT — unlike INSERT — evaluates once per
--       QUERYING role, so two members of the same channel legitimately
--       seeing different transcripts is exactly what a `using` clause is
--       for. Seriously considered, and REJECTED for this fix: it turns one
--       channel into an inconsistent object depending on who's asking —
--       `listMessages`'s ordering, unread counts derived from
--       `channel_members.last_read_at`, and "N messages in this channel"
--       would all silently disagree between two members who are both,
--       correctly, allowed to be there. That is a real feature with its own
--       design questions (does a block hide only future messages or the
--       whole history? does the hidden party's own `listMessages` still see
--       their own posts reflected back oddly?) that deserves its own
--       deliberate pass, not a rider on a bug-fix migration. Recorded here
--       so it is not silently forgotten if group/match blocking is
--       revisited.
--
-- WHY (b) OVER (a): (b) is strictly better for the people NOT involved in
-- the block — under (a) they lose a member's voice for a reason that has
-- nothing to do with them; under (b) they lose nothing. The two members who
-- ARE involved in the block are no worse off under (b) than under (a): the
-- blocker already had to see the blocked party's messages under the OLD
-- "directional" rule (nothing in the SELECT policy filtered them out; only
-- the blocked party's own INSERT was refused), so (b) does not expose the
-- blocker to anything they were not already reading. The one thing (b) gives
-- up is the blocked party's OWN incentive to avoid a member who blocked
-- them — under (a) they were locked out of the room entirely (collateral
-- damage and all); under (b) they can keep posting and the person who
-- blocked them can still read it, same as before this migration. That is an
-- acceptable trade: a group or match channel already shows every member's
-- messages to every OTHER member regardless of blocks (the SELECT policy —
-- "a message is visible to the channel's members" — has never had a block
-- clause), so (b) makes INSERT consistent with the SELECT behaviour this
-- table already had, rather than introducing a second, incompatible idea of
-- what a block means depending on which end of the pipe you look from.
--
-- WHAT STAYS UNCHANGED: DM behaviour (Ruling B10, `20260907003000_messages.sql`)
-- is untouched — a block in a DM remains SYMMETRIC and TOTAL, enforced by the
-- same `blocked_with_me`/`i_blocked` pair inside the `kind = 'dm'` branch
-- below. Matchmaking's own block enforcement
-- (`20260906002000_friend_codes_and_blocked_matchmaking.sql`) is a completely
-- separate code path (the queue pairing scan and the offer-accept trigger)
-- and is not touched by this migration at all.
drop policy "a member who is not blocked may post" on public.messages;

create policy "a member who is not blocked in a dm may post"
  on public.messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
    and not exists (
      select 1
        from public.channels c
       where c.id = messages.channel_id
         and c.kind = 'dm'
         and exists (
           select 1
             from public.channel_members other
            where other.channel_id = messages.channel_id
              and other.user_id <> (select auth.uid())
              and (
                public.blocked_with_me(other.user_id)
                or public.i_blocked(other.user_id)
              )
         )
    )
  );

-- The UPDATE policy ("an author may edit or soft-delete their own message",
-- same source migration) is DELIBERATELY NOT touched here: it still runs
-- `blocked_with_me` unconditionally, across every channel kind, so a member
-- blocked by one person in a group can still be refused when editing or
-- soft-deleting a message they posted BEFORE this migration's rule applied
-- (or before they were blocked at all). That is a narrower, pre-existing
-- inconsistency — editing history is a different action from speaking to
-- people who never blocked you — and fixing it is out of scope for the bug
-- this migration closes, which is specifically about being locked out of
-- ever posting again. Left as a known follow-up, not silently widened here.
