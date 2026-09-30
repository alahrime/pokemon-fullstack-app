# M5b — Tournament announcements

Follow-on to M5 tournament channels (the tournament plan's deferred "announcement channel").
Pinning, announce-only rooms and communities stay out.

## Rulings

1. **Who:** the organiser and judges flag a message as an announcement; everyone else keeps
   posting plain text. Judgement reads `tournaments.organiser_id` and `tournament_roles`, so a
   revoked judge stops at once, and it applies only in a tournament's own channel.
2. **Data:** `messages.kind = 'announcement'`. The INSERT policy's tail changes from "plain text
   only" to `offer_id is null and (kind = 'text' or (kind = 'announcement' and can_announce(channel_id)))`.
   `kind` stays immutable after insert (existing protect trigger). Edit, soft-delete and report are unchanged.
3. **`can_announce(channel)`** is caller-scoped and granted to `authenticated` only, like `is_channel_member`.
4. **Display:** a highlighted, tagged message in the pane, plus the newest live announcement
   shown as a panel on the tournament page to members.
5. **Notice:** no separate bell entry. A tournament channel with unread messages already raises
   the existing "New message" notice titled with the tournament, which covers announcements.

## Client

`sendMessage(channel, body, 'announcement')`, `canAnnounce`, `latestAnnouncement`. ChatPane
shows a "Send as announcement" box when `can_announce` is true (reset after each send).

## Testing

DB: organiser and judge may, entrant may not, revoked judge may not, not in a group,
`can_announce` answers per caller, kind immutable, anon refused. Unit and component tests for
the helpers, the compose box, the transcript tag and the page panel.
