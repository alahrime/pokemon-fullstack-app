# M5c — Tournament pins

`message_pins` already existed (pinned messages skip the 7-day sweep) with an any-member write
policy and no client. In a tournament channel pinning is restricted to the people who run it
(`can_announce`: organiser or judge), because open pinning in a large room lets anyone keep
messages forever. DMs, groups and match channels keep the existing rule; no UI there.

Migration `20260930000800_tournament_pins.sql` splits the write policy into insert and delete
(reads stay on the existing select policy). Client: `listPins`, `pinMessage`, `unpinMessage`; the
pane shows a Pinned strip to every member and Pin/Unpin to organisers and judges. Out: a pin cap,
realtime pin updates (the strip refreshes on open and after your own change).

Tests: DB (entrant and outsider refused, organiser and judge allowed, revoked judge refused,
entrant's unpin removes nothing, members read, group unchanged); helper, strip and button tests.
