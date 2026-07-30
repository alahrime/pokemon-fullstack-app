# Backlog

Open work, roughly in priority order. Written at the end of a long session so
the next one can start without re-deriving context.

---

## 1. Battle simulator accuracy — the main outstanding item

The engine now models type effectiveness, turn-accurate fast-move
registration, charged moves consuming a turn and resetting both animations,
sneaking, lethal-fast priority, shields at 1 damage, CMP by attack, and
PvPoke's move-selection rules (main by DPE, secondary by damage-per-energy²,
fired on KO / shield / incoming-KO).

**Still wrong.** Reference: Lickitung 8/14/15 vs Lickilicky 0/15/10, Great, 1
shield each, 0 energy. Expected Lickilicky wins with 52 HP.

| | ours | reference |
|---|---:|---:|
| Licks landed | 53 | ~58 |
| Body Slams | 4 (1 blocked) | ~3 (1 blocked) |
| damage dealt | 132 | 111 |

The gap decomposes exactly as **one extra Body Slam (+26) and five fewer Licks
(−5)**. Action counts are close (57 vs ~61), so this is not a pacing bug —
earlier rounds chased a phantom 3.5× duration gap that the action counts say
never existed.

Next steps:
- **Get a PvPoke turn-by-turn timeline** for that matchup and diff it turn by
  turn. Inferring from final scores has failed five times; one log would
  localise the divergence immediately.
- Confirm what **"99.5 seconds"** measures in that view — elapsed, remaining
  off a 240s clock, or something else. It does not match ~61 turns × 0.5s.
- Implement **fast-move selection by TDO** (PvPoke rule 3), the last
  unimplemented selection rule.
- Consider **shield decision modelling**. Both sims always shield when able, so
  this is not a divergence from PvPoke, but it is a divergence from real play.

## 2. Edge-case species

Mimikyu, Morpeko and Aegislash are held out of every picker and pool via
`UNSIMULATED_IDS` in `lib/data.ts`. Each needs its own code path:

- **Mimikyu** — built-in shield (effectively a third shield, then a defence
  debuff). Ranks 1st in Great and Ultra, so this is the highest-value one.
- **Morpeko** — form change mid-battle.
- **Aegislash** — stance change.

Restoring them is emptying the set; the verify suite will fail loudly and name
every surface that needs attention.

## 3. New PvP engine, after the world championship (end of August)

The 2026 rewrite changes: damage resolves strictly at turn-end, **fast-move
sneaking is removed entirely**, simultaneous KOs tie cleanly, and moves trigger
before fainting. Optimal timing stops being about denying sneaks and becomes
about CMP ties and denying a last fast move.

The engine deliberately targets the **old** system for now. When switching:
- Remove the sneak block in `battle()` (marked with a comment).
- Revisit `optimizeTiming` — its rationale changes.
- The `optimizeTiming` toggle already exists and defaults to PvPoke behaviour.

## 4. Loose ends from this session

- **`disabledChargesA/B`** on the battle screen are per-species selections in
  global state. `chargeIds` had exactly this bug (carried across a species
  change, rendered the wrong moves). Check whether those reset.
- **No Best Buddy control on the battle screen** — the toggle only exists on
  the report screen, though the engine supports it on both sides.
- **Three UI surfaces never seen rendered** (the permission classifier was down
  when they were built): the search syntax legend, the results dropdown, and
  the compact held-out note inside it. Worth one visual pass.
- **Hero Best Buddy badge** was verified by injecting an element with the same
  class, not by rendering the real component — no species on screen had a
  rank-1 roll above level 50 at the time. Confirm live.
- **Unown** trips the fast picker but has one charged move, so it shows a
  picker on one side and a lone tile on the other. Correct, possibly lopsided.
- **Traits vocabulary** — the search maps `@spam`, `@nuke` etc. to PvPoke's
  move archetypes. If the intended trait guide (Bulky, Spammy, Risky…) differs,
  it is a lookup table in `lib/query.ts`.

## 5. Performance

Already done: cold opponent-stat fill 419ms → 2ms (precomputed `bestIv`),
steady Great scan 73.7ms → ~22ms.

Remaining, in order of value:
- `rankedOpponents`' own loop is the largest slice (~26% self time), mostly
  allocation.
- `probeSpreads` still allocates a small probes array per opponent.

Neither is urgent. Re-profile before touching either — the last two rounds of
optimisation both found the bottleneck was somewhere other than expected.

## 6. Housekeeping

- **`app/README.md` is still the stock Vite template.** Real project docs would
  help — `data-src/README.md` is the model.
- **`species.json` is generated but committed.** Worth a note in any PR
  description so a reviewer does not read it as hand-edited. `npm run data` is
  deterministic; a dirty diff means the upstream inputs changed.
- **esbuild is a build dependency of the data**, not just of `verify`. A
  `node_modules` restored from another OS breaks `npm run data`.
- **Validate the `paragon-frontend` skill.** It was written from this session's
  lessons but never tested. skill-creator can run 2–3 realistic prompts with
  and without it and benchmark the difference, then optimise the `description`
  field — which is what decides whether it fires at all and is currently a
  hand-written guess.
