# M5d — Announce-only tournament channels

A per-tournament switch (default off): while on, only the organiser and judges post in the
tournament's channel; entrants read. Tournament channels only. The organiser alone flips it,
through `set_announce_only` (channels UPDATE is revoked from clients); `is_tournament_organiser`
is caller-scoped so the pane knows whether to show the switch. The message INSERT policy gains
`not announce_only or can_announce(channel)`, which also stops entrants posting plain text
(announcement-kind was already gated). Pane: organiser toggle; everyone else sees "Only the
hosts can post here." in place of the compose box. Out: per-judge overrides, scheduling, live
flag updates in open panes (others see the change on next channel refresh).

Tests: DB (entrant refused on, allowed off, hosts post, revoked judge refused, judge/outsider/anon
cannot flip, direct UPDATE refused, a group cannot carry the flag); helper and pane tests.
