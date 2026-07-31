# Backlog

Open work, roughly in priority order. Written at the end of a long session so
the next one can start without re-deriving context.

---

## 0. Ground rules — read before changing rankings

Four decisions that took a long time to reach and are easy to undo by accident.

**PvPoke is a reference column, not a target.** Their published score rides
alongside ours in the Rankings table so drift is visible. It is *not* something
to optimise toward — their rankings are one methodology among several, their
team builder only considers 1-shield scenarios, and this engine deliberately
models things theirs does not (carryover, the full shield lattice, both shield
policies). An earlier pass started tuning weights to raise rank correlation
with them; that was the wrong instinct. Correlation is a sanity check.

Two related traps: their score is a 0–100 index topping near 93 while ours is a
mean battle rating where 500 is even, so **never show a rescaled difference of
the two** — it reads as an error term and is nothing of the kind. The table
shows rank position and rank delta for exactly this reason. And their ranking
covers only the species they publish, which excludes Shadows, so both columns
must be ranked over that same subset or every Shadow silently shifts their
column.

**Opponents are swept only at their rated loadout; your side sweeps up to 12.**
This is deliberate and not a cost shortcut. Sweeping both sides asks "how do I
fare against Azumarill running Rock Smash and Hydro Pump", and letting sets
nobody plays vote in the average makes the ranking describe a game that is not
being played. It is also 6.56 billion battles in Great against 244 million.
Reasoning is in the header of `scripts/build-matrix.ts`.

**Rankings are reported on the rated set, not the best swept one.** Taking a
maximum over 12 loadouts flatters whoever has the widest movepool — that score
correlates 0.32 with moveset count alone. `best` is kept as its own column
because "what should I put on this mon" is a real question, but it is not a
fair ranking basis.

**A species is never scored against itself.** A mirror is a guaranteed draw or
a CMP win, which flatters whatever is currently top of the pool.

## 1. What does "best" mean — the top open decision

**Carbink leads Great League** under the first pass at nearly every tier, and
still takes the top graded spot at 300/500/all. No Great League player would
accept that.

It is not a bug and not a PvPoke disagreement. Mean battle rating rewards a
high floor, and Carbink's floor is excellent — it is very hard to blow out —
while its ceiling is nothing, because it rarely wins decisively. Averaging
hides the difference.

The weighted-regression pass (§2) already fixed a *different* symptom of the
same family: unevolved forms (Morgrem, Tinkatuff) appeared in the flat top five
at four separate tiers and vanish from every graded one. Grading did not touch
Carbink.

Options, none obviously right:
- **median instead of mean** — kills the high-floor advantage directly.
- **score the ceiling separately** — a second axis rather than a replacement,
  so "safe" and "threatening" stop being averaged into one number.
- **win-rate-weighted blend** — weight the rating by whether it was a win, so
  losing narrowly to everything stops paying.

This is a product decision about what the ranking is *for*, not a numerical
one. **Ask before picking.** Everything downstream (both team builders weight
by Overall) inherits the answer.

## 2. How the rankings pipeline works

Worth reading before touching any of it; it is four commits of structure.

One artefact underlies Rankings, the GBL builder and Show 6: the rating each
candidate earns against the field, per scenario. Built offline in
`scripts/build-matrix.ts` (~160s for three leagues, parallelised over worker
threads), because it is ~141M battles in Great.

**Two passes, two independent axes.**

- **First derivative** — every swept loadout, scored against a top-N opponent
  cutoff where everyone inside counts equally. Beating rank 98 is worth beating
  rank 2.
- **Weighted regression** — same cutoff, but each opponent weighted by the
  first pass's own Overall cubed, so what you beat matters as much as how many.
  Both sides restricted to their rated loadout, making it a measure of the
  matchup rather than the movepool.

Both run at every tier (50 / 100 / 200 / 300 / 500 / all). The tier decides who
is in the room; the pass decides whether they all count the same. Costs no
extra simulation — six aggregations over one matrix.

Rank agreement with PvPoke rises under grading in all three leagues (great
0.798→0.844, ultra 0.849→0.880, master 0.911→0.939). Recorded as evidence the
pass works, not as a target — see §0.

**Scenarios.** All nine shield states plus two energy states, and both shield
policies (`always` / `read`), because shields in GBL belong to the player for
the whole battle rather than to each Pokemon. 11.4% of matchups flip outright
between the two policies, ~19% of those at a full shield budget. Headline
scores average them.

**Loadouts** are capped at 12 per species, drawn from PvPoke's per-league usage
counts — Mew alone can field 4200 sets. The league's rated set is always kept
and is always index 0.

**Carryover is deliberately NOT precomputed.** Once HP, energy and shields
persist the state space is continuous and no static matrix holds it. At ~10µs a
battle a 3v3 chain is ~60µs, so it runs live in `lib/team.ts`. The matrix stays
for rankings and candidate filtering.

**Show 6 is a matrix game**, not an enumeration: C(150,6) is 1.19e10, but you
bring six and three enter, so it scores as a maximin over each side's twenty
3-subsets. `analyseShow6` in `lib/teambuild.ts`.

Sorted views are memoised per league/tier/category/pass — 210 of them, and the
numbers are a build artefact so the cache needs no invalidation.

`ENGINE_REV` in `build-matrix.ts` is at **5**. Bump it whenever an engine
change would move the numbers; the UI reads it back so a stale artefact is
visible rather than quietly wrong.

## 3. Battle simulator accuracy — the Lickilicky case is CLOSED

The engine models type effectiveness, turn-accurate fast-move registration,
charged moves consuming a turn and resetting both animations, sneaking,
lethal-fast priority, shields at 1 damage, CMP by attack, move selection by
damage per energy, shield decisions, and optimal charged-move timing.

The Lickitung 8/14/15 vs Lickilicky 0/15/10 case (Great, 1 shield each, 0
energy) drove five rounds of investigation on the strength of a reference
reading of **~58 Licks, ~3 Body Slams, 111 damage**. That reading is
arithmetically impossible.

Lick gives 3 energy; Body Slam costs 35. 58 Licks generate 174 energy, of which
3 Body Slams spend 105 — leaving **69 unspent**, nearly two more throws. No
engine that throws when a move is available can produce it.

Enumerating every action count that yields exactly 111 damage under the energy
rules leaves only two candidates, and both require throwing **Power Whip**,
which is strictly dominated here: 35 damage for 50 energy (0.70/energy) versus
Body Slam's 26 for 35 (0.743/energy). Declining to throw it is correct.

Our own result is internally consistent — 53 Licks and 4 Body Slams is 159
energy generated, 140 spent, 19 left, below the 35 needed for another. The
fundamentals were verified by hand and all hold:

| check | value |
|---|---|
| Lick, Ghost into Normal | eff 0.390625 = 0.625², 1 damage |
| Rollout, Rock into Normal | neutral, 3 damage |
| Body Slam, Normal user | STAB 1.2, 26 damage |
| shielded charged move | exactly 1 damage |

Optimal timing was also verified rather than assumed: with it on, all four
Body Slams land at phase +0 against Rollout's 3-turn cycle. It moves the result
by 1 HP and does not rescue the reference.

The `~` in the original figures is the tell: they were eyeballed from a
screenshot, not read from a log. **Do not reopen this without an actual
turn-by-turn timeline.**

Still genuinely open:
- **Fast-move selection by TDO**, the last unimplemented selection rule.
- ~~Shield decision modelling~~ — done. `ShieldPolicy` in `lib/types.ts`;
  `read` calls the bait and saves the shield for the hardest hit.

## 4. Edge-case species

Mimikyu, Morpeko and Aegislash are held out of every picker and pool via
`UNSIMULATED_IDS` in `lib/data.ts`. Each needs its own code path:

- **Mimikyu** — built-in shield (effectively a third shield, then a defence
  debuff). Ranks 1st in Great and Ultra, so this is the highest-value one.
- **Morpeko** — form change mid-battle.
- **Aegislash** — stance change.

Restoring them is emptying the set; the verify suite will fail loudly and name
every surface that needs attention. Re-run `npm run data` afterwards — they
will enter the rankings and the team-builder pools.

## 5. New PvP engine, after the world championship (end of August)

The 2026 rewrite changes: damage resolves strictly at turn-end, **fast-move
sneaking is removed entirely**, simultaneous KOs tie cleanly, and moves trigger
before fainting. Optimal timing stops being about denying sneaks and becomes
about CMP ties and denying a last fast move.

The engine deliberately targets the **old** system for now. When switching:
- Remove the sneak block in `battle()` (marked with a comment).
- Revisit `optimizeTiming` — its rationale changes. It now defaults to **on**
  for the rankings build (`OPTIMAL_TIMING` in `build-matrix.ts`); the hold is
  abandoned when the move kills, when the mon is about to faint, when the
  opponent is also holding one, when energy would overflow, or when the
  alignment window can never arrive.
- Bump `ENGINE_REV` and re-run `npm run data`.

## 6. Data size

`app/src/data/rankings.json` is **3.0MB raw / 770KB gzipped**, up from 565KB
when the second pass gained a tier axis. One more axis makes this a real
problem.

The cheap fixes are already applied — scores travel as bare arrays in
CATEGORIES order rather than keyed objects (the seven category names repeated
ten times per species were outweighing the numbers two to one, 4.9MB → 3.2MB),
and loadouts are `[label, score]` pairs.

Next step if it grows: **split per league** and load lazily. Nothing needs
Ultra's table while looking at Great.

## 7. Loose ends

Open:
- **Traits vocabulary** — the search maps `@spam`, `@nuke` etc. to PvPoke's
  move archetypes. If the intended trait guide (Bulky, Spammy, Risky…) differs,
  it is a lookup table in `lib/query.ts`.
- **Guided tour** — deferred until the features are in place. They now are.
- **Team builder opposing field is sampled, not enumerated** — 240 opponent
  teams drawn deterministically from the top 100. Deterministic so a score does
  not drift between renders, but it is a sample; a team scoring 68% is not
  precise to the point.
- **No voluntary switching** in `teamBattle`. Each side sends its next Pokemon
  only when the current one faints. Real switching is a game tree under
  simultaneous hidden-information choice, and guessing at it would turn a
  measurement into an opinion — but it is a real gap, and the Switches category
  measures switch pressure only indirectly.

Done:
- ~~Search result virtualising~~ — 153 rows → ~20 in the DOM.
- ~~`paragon-frontend` skill validation~~ — ran; verdict was **unvalidated, not
  validated**. Assertions barely discriminated (11/11 vs 10/11) and the
  baseline agents were strong. Two evals is too thin to conclude from.
- ~~Unown lopsided columns~~, ~~Best Buddy badge~~, ~~battle-screen fast
  moves~~, ~~`disabledChargesA/B` stale state~~.

## 8. Performance

Steady Great scan ~36ms. `rankedOpponents`' own loop (~40% self time) and
`battle` (~32%) are the remainder, both mostly allocation and both doing real
work. Not worth touching without a reason. Re-profile first — every round so
far has found the bottleneck somewhere other than expected.

The matrix build is ~160s for three leagues on 8 worker threads. Team analysis
runs 12–155ms live.

## 9. Housekeeping

- **`species.json` and `rankings.json` are generated but committed.** Worth a
  note in any PR description so a reviewer does not read them as hand-edited.
  `npm run data` is deterministic; a dirty diff means the upstream inputs
  changed.
- **esbuild is a build dependency of the data**, not just of `verify`. A
  `node_modules` restored from another OS breaks `npm run data`.
- `npm run data` now chains `build-data` → `best-spreads` → `matrix`. The last
  step is the slow one; `npm run matrix` alone re-runs just it.
