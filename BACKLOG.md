# Backlog

Open work, roughly in priority order. Written at the end of a long session so
the next one can start without re-deriving context.

---

## 1. Battle simulator accuracy — CLOSED, the reference was wrong

The engine models type effectiveness, turn-accurate fast-move registration,
charged moves consuming a turn and resetting both animations, sneaking,
lethal-fast priority, shields at 1 damage, CMP by attack, and move selection
by damage per energy.

The Lickitung 8/14/15 vs Lickilicky 0/15/10 case (Great, 1 shield each, 0
energy) drove five rounds of investigation on the strength of a reference
reading of **~58 Licks, ~3 Body Slams, 111 damage**. That reading is
arithmetically impossible.

Lick gives 3 energy; Body Slam costs 35. 58 Licks generate 174 energy, of
which 3 Body Slams spend 105 — leaving **69 unspent**, nearly two more throws.
No engine that throws when a move is available can produce it.

Enumerating every action count that yields exactly 111 damage under the energy
rules leaves only two candidates, and both require throwing **Power Whip**,
which is strictly dominated here: 35 damage for 50 energy (0.70/energy) versus
Body Slam's 26 for 35 (0.743/energy). Declining to throw it is correct.

Our own result is internally consistent — 53 Licks and 4 Body Slams is 159
energy generated, 140 spent, 19 left, below the 35 needed for another. The
fundamentals were verified by hand on this matchup and all hold:

| check | value |
|---|---|
| Lick, Ghost into Normal | eff 0.390625 = 0.625², 1 damage |
| Rollout, Rock into Normal | neutral, 3 damage |
| Body Slam, Normal user | STAB 1.2, 26 damage |
| shielded charged move | exactly 1 damage |

The `~` in the original figures is the tell: they were eyeballed from a
screenshot, not read from a log. **Do not reopen this without an actual
turn-by-turn timeline.**

Still genuinely open:
- **Fast-move selection by TDO**, the last unimplemented selection rule.
- **Shield decision modelling**. Both sims always shield when able, which is a
  divergence from real play even if not from PvPoke.

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

## 4. Loose ends

Done:
- ~~`disabledChargesA/B` stale state~~ — checked, they already reset on species
  change. The bug was only ever on the report screen.
- ~~No Best Buddy control on the battle screen~~ — added per combatant, since
  each side is independently a buddy. Ineligible mons show it disabled.
- ~~Three unseen UI surfaces~~ — reviewed. Two real defects found and fixed:
  the held-out note rendered *above* the results list rather than at the foot
  of the dropdown, and the syntax legend's grid left a large gap under the
  short Identity group. Sprites in the dropdown are lazy, not broken (0 broken
  of 391).
- ~~Hero Best Buddy badge~~ — confirmed live on Nidorino (Great rank-1 is
  level 51), inside the stage at a 10/11px inset.
- ~~Battle-screen fast moves~~ — rendered every move as a chip (82 for
  Smeargle). MovePicker extracted to its own module and shared by both screens.

Open:
- ~~Unown lopsided columns~~ — was real, 33px apart. A slot with no choice now
  renders a caption where the picker would be.
- **Traits vocabulary** — the search maps `@spam`, `@nuke` etc. to PvPoke's
  move archetypes. If the intended trait guide (Bulky, Spammy, Risky…) differs,
  it is a lookup table in `lib/query.ts`.
- **Search result cap** — a broad query renders every match (153 rows and 391
  images for `water`, up to the 250 cap). All lazy, so it is fine today, but
  virtualising is the answer if it ever feels heavy.

## 5. Performance

Re-profiled after the correctness work, which had introduced two regressions:

- Cold fill had gone 2ms → 34ms, because opponents are always priced at their
  Best Buddy ceiling and the precomputed index was only consulted at the
  level-50 ceiling. A second index (`bestIvBB`) fixed it — back to 3ms.
- `battle()` recomputed charge damage every turn for the incoming-KO test, and
  `classifyCharges` recomputed it inside a sort comparator. Both hoisted.

Steady Great scan sits at ~36ms, up from 22ms before type effectiveness. That
is the honest cost of correct damage plus sneaking, move timing and
incoming-KO; the old number was cheaper because it was wrong.

Remaining: `rankedOpponents`' own loop (~40% self time) and `battle` (~32%),
both mostly allocation and both doing real work. Not worth touching without a
reason. Re-profile first — every round so far has found the bottleneck
somewhere other than expected.

## 6. Housekeeping

- ~~`app/README.md` was the stock Vite template~~ — replaced with real docs.
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
