# M5 Tournament Channels Plan

**Goal:** Every tournament has a chat channel whose members follow the tournament.
**Spec:** `docs/superpowers/specs/2026-09-30-m5-tournament-channels-design.md`

Tasks (built inline, one commit): 1. migration + `supabase/tests/tournament_channels.test.ts`;
2. client kind, `tournamentChannelId`, Chat filter, Open chat button + tests; 3. handoff.
Apply with `cd app && npx supabase migration up --local --workdir ..` (never `db:reset`).
Gates: `cd app && npm run check`; DB: `npx vitest run --config vitest.db.config.ts`.
