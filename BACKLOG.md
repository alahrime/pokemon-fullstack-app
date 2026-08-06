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

**A rating is half outcome, half margin.** `rating()` in `lib/scenarios.ts` was
pure margin, and that is what produced the Carbink problem in §1. It now scores
`WIN_WEIGHT * won + (1 - WIN_WEIGHT) * margin`, where the margin is damage
dealt, HP kept and — new — energy the survivor carries out. Do not "simplify"
this back to a margin: an even matchup still averages 500 over a field, which is
the only place the scale is read, but a *single* battle's rating is now
deliberately bimodal and is a poor number to show on its own. `teamRating()` in
`lib/team.ts` is the same formula on a chain, deliberately, so the §1 decision
was made once rather than twice.

## 1. What does "best" mean — DECIDED, with one caveat still open

**Decision: the win-rate-weighted blend, plus credit for energy kept.** Half the
rating is now the outcome and half the margin, and the margin counts the energy
the survivor carries out alongside the HP it kept. `WIN_WEIGHT` and
`ENERGY_SHARE` in `lib/scenarios.ts`. Engine rev 6.

The mechanism does what it was chosen to do. The high-floor, no-ceiling family
— exactly the shape of the original complaint — is demoted hard:

| league / pass | biggest fallers inside the old top 20 |
|---|---|
| great d1 | Aurorus (Shadow) +14, Sandslash (Alolan) (Shadow) +10, Bastiodon +4 |
| great d2 | Lucario +14, Clefable +10, Magnezone (Shadow) +7 |
| ultra d1 | Aurorus (Shadow) +29, Tentacruel (Shadow) +13, Dondozo +10 |
| master d2 | Necrozma (Dusk Mane) +12, Kyogre +5 |

Rank agreement with PvPoke rose in all three leagues and both passes — great
0.800→0.820, ultra 0.851→0.860, master 0.911→0.929 on d1. Recorded as a sanity
check, not a target; see §0.

**Carbink survived it, and the diagnostic says that is correct.** It went #1→#2
in great/d1 at the default tier — Registeel now leads — but is still #1 at
several other tiers. Before touching `WIN_WEIGHT`, the win rates were measured
directly (rated loadouts both sides, all 11 scenarios, both policies):

| Great | top 50 | top 100 | top 200 | top 500 | all |
|---|---|---|---|---|---|
| Carbink win% | 55.7 | 58.2 | 61.4 | 65.0 | 72.8 |
| Registeel win% | 86.3 | 74.7 | 69.1 | 63.9 | 71.9 |
| Bastiodon win% | 71.8 | 59.6 | 57.4 | 57.0 | 63.9 |

**The premise of this section was wrong.** Carbink was never "losing narrowly
to everything" — it wins the majority of its matchups at every cutoff. The
old metric was not lying about it. What the old metric *did* get wrong was
failing to reward Registeel for winning **decisively**: at the top 50 its
rating went 673 → 752 under the new basis (+79) against Carbink's 527 → 535
(+8), and that gap is what reordered them. The fix worked by promoting the
decisive winner, not by demoting a fraud.

So do not raise `WIN_WEIGHT` to push Carbink down further. If it still looks
wrong, the disagreement is about *format relevance* — Carbink is a fine
Pokemon that few people build — and that is a different axis from strength,
which the ranking does not currently carry and arguably should not.

One caveat on the table above: it orders each tier's field by that tier's own
Overall, whereas the build uses its internal seeded order, so the populations
are not identical to the shipped tiers. The win rates are robust to that (they
move monotonically and the gap is large); the exact numbers are not.
Regenerate with `scratchpad/carbink.ts` if it matters.

## 1b. PvPoke's mechanics, adopted — and what they cost

Their ranking code was read directly (`src/js/battle/rankers/Ranker.js`,
`RankerOverall.js`) rather than reverse-engineered. Four mechanisms had no
counterpart here. Three were adopted, one deliberately was not.

**Adopted (engine rev 8).** The base rating already matched — health kept plus
damage dealt, 500 each. On top of that:

- **shield pressure**: a win earns +100 per opponent shield forced and +100 per
  shield kept. Nothing here had ever paid for making an opponent spend shields,
  which is most of what the spam/bait archetype does for a team.
- **blowout soft cap**: `700 + sqrt(x - 700)`, so a 900 becomes 714. Crushing is
  worth almost nothing over a clean win. This is what stops a polarising wall
  out-scoring an even trader.
- **loss curve** below 300, so failing to trade costs more than losing well.

**Not adopted: the editor override.**

```js
if(override.editorScore){ rankings[i].score = (rankings[i].score * 0.25) + (override.editorScore * 0.75); }
```

Where an override exists, **75% of a published PvPoke score is a hand-set human
value**. This is a far stronger reason than §0 previously recorded for treating
their column as a reference: on an overridden species, matching them means
matching a person's judgement, not a simulation. Do not tune toward it.

**Measured effect.** Rank agreement rose 0.820 → 0.826 → 0.835 (Great, Overall,
d1). The archetype that was most wrong largely corrected — Altaria #178→#54,
Lickilicky #120→#80, Furret #309→#111, Greedent #482→#247 — and Carbink finally
left the top five.

## 1c. OPEN REGRESSION: the composite Overall destabilised Great

Rev 9 also changed Overall from a scenario-weighted average to PvPoke's
construction: a weighted geometric mean of a Pokemon's own five role scores,
each **normalised per category first**, strongest role weighted 12x. The
normalisation is not optional — their `Ranker.js` scales each category to 0–100
against that category's own best before composing, and omitting it was a real
bug.

**But it made Great worse.** Its d1 top three became
`Dunsparce / Empoleon (S) / Sableye (S)` — Registeel, a runaway #1 under every
previous revision, is absent. Zero-lift entries in the top 20 cores went
10/20 → 16/20. Ultra and Master held up (Registeel + Galarian Moltres at 1.35x
lift over 650 appearances).

The cause is an interaction, not a coding error: normalising per category and
*then* sorting per Pokemon means the 12x exponent is assigned by whichever role
happens to come out highest, and in Great the top 25 sit within 90–94% of each
other in Leads and Chargers, so that assignment is close to arbitrary. Ultra and
Master have more spread at the top and survived it.

**Recommended next step: revert the composite, keep the rating mechanics.** The
per-matchup mechanics in §1b are sound and independent; the composite needs
inputs that discriminate more than ours currently do. `makeOverall` in
`lib/scenarios.ts` is the single thing to undo.

The same weakness explains the Tinkaton/Tinkatuff complaint. Tinkaton is ranked
above it and beats it head-to-head at every shield count, but by 4% where PvPoke
separates them by 11%. Their per-category columns are *more* compressed than
ours, so compression is not the cause — the separation lives in the ratings
themselves. Switches: theirs 84.7 vs 57.9, ours 498 vs 464. Consistency is worse
than a gap, it is a **sign flip**: they score Tinkaton 56.2 against Tinkatuff's
91.3 — a 60-energy nuke is bait-dependent and swingy — while we score Tinkaton
*higher*. `consistencyScore` weights `baitSwing` at 0.25 against 1.5 on shield
spread, which looks far too weak to catch that. `scenarios.ts` already documents
that column as correlating with nothing we compute.

## 1d. The rated set is often not the played set — the biggest open lead

`movesFor` resolves a species' loadout from PvPoke's `moveset` field, and §0
fixes every ranking to that set for comparability. That rule is doing real
damage, because the field is one of the things their editor can override.

Shadow Forretress is the case that exposed it. Our own sweep, in the shipped
artefact:

```
Volt Switch · Sand Tomb / Rock Tomb    745   <- the RATED set, what every ranking uses
Bug Bite    · Rock Tomb / Mirror Shot  878   <- +133
Bug Bite    · Mirror Shot / Heavy Slam 875
```

**Every Bug Bite set beats every Volt Switch set by 105–133 points.** The sweep
found it; the ranking then discards it. Upstream usage in the same file
disagrees with the recommendation too — Bug Bite 58,045 uses against Volt
Switch's 78,121, comparable rather than negligible.

Every ranking, team, core and pillar is computed on the rated set, so wherever
that field is stale or hand-set we inherit it. This is a far more plausible
driver of the Registeel/Lickilicky-style inversions than anything in the
aggregation, all of which was tested and cleared (see §1c).

**Cheap next check:** compare each species' rated-set score against its best
swept score across the roster. If the gap is routinely large, §0's rank-on-the-
rated-set rule needs replacing — by the best swept set, a usage-weighted blend,
or the split scheme below.

## 1e. Splitting a species into several builds — measured, not built

`npm run splits` → `app/analysis/splits.json`. That report is evidence for this
decision, not something the app reads — it lives outside `src/` so it is never
at risk of being bundled. Some species are not one Pokemon: Forretress
with Volt Switch and with Bug Bite answer different halves of the field, and
Quagsire's second charged move (Mud Bomb vs Stone Edge) flips 16% of its
matchups at +13 score.

A split needs **both** conditions, and divergence alone is a trap: Tinkaton's
most divergent alternative flips 56% of matchups while scoring 212 points
worse. That is a bad set, not a second build.

Three cuts were measured side by side. `viability` is how far below a species'
own best a set may score; `divergence` is how much of the field it must flip
against every set already kept:

| variant | thresholds | Great | Ultra | Master |
|---|---|---|---|---|
| primary | <=4% / >=12% | 47/150 split, +37% | 51/150, +47% | 45/150, +37% |
| secondary | <=8% / >=10% | 95/150, +109% | 107/150, +129% | 88/150, +99% |
| tertiary | <=12% / >=8% | 128/150, +218% | 127/150, +217% | 122/150, +177% |

**Primary is the recommended cut.** Secondary and tertiary mostly add
near-duplicate builds of the same few Pokemon — at tertiary, five of Ultra's top
seven entries are different Registeel and Tinkaton builds, which stops being a
tier list — while the sweep cost grows quadratically in pool size.

What surfaces at primary is alternate builds of already-strong Pokemon, not new
Pokemon: Great's #2 entry is a non-rated Registeel build, and Melmetal,
Togedemaru, Shadow Magnezone and Zacian (Hero) all reach the top 12 on sets the
rated rule hides.

**Not implemented.** It changes the unit of ranking from species to build, which
touches the ref scheme, the opponent field, the team pool, cores and the UI. The
duplicate-species rule already handles the consequence for free, since it keys
on Pokedex number and would never let two Registeel builds share a team.

## 1f. ABB versus ABC lines

A team where no two members share a typing covers itself more evenly. Measured
over the shipped threes:

| pass | ABC (no shared typing) |
|---|---|
| d1 | 58% |
| d2 | 54% |
| syn | **86%** |

The synergy pass already strongly prefers ABC by construction; the simulated
passes do not. d2 produced `Raikou / Charjabug / Lanturn` — three Electrics —
which the stacked-weakness constraint did *not* catch, because their defensive
weaknesses genuinely differ (Charjabug's Bug half resists Ground). **Typing
redundancy needs its own rule; it is not a side effect of the weakness rule.**

Not added yet, deliberately: constraining team shape while §1d has matchups
computed from wrong movesets would be tuning around a data bug.

## 1g. Our matchups against PvPoke's published ones — the test §3 asked for

Their ranking entries carry `matchups` (best five) and `counters` (worst five),
each an opponent plus a 0–1000 rating on the same scale ours uses. That is a
direct per-battle comparison, and it is the only test that separates "our
aggregation differs" from "our simulation differs". **Run it before reopening
any inversion.** `scratchpad/matchups.ts`.

Over **11,425 published Great matchups**:

| our reading | correlation | mean abs error | agree on winner |
|---|---|---|---|
| Overall blend | **0.729** | 111 | **76.6%** |
| 2v2 only | 0.659 | 134 | 76.4% |
| 1v1 only | 0.641 | 140 | 72.9% |
| emulating their play (always-shield, no timing) | 0.613 | 149 | 71.1% |

Two things follow. The engine is not broken — three matchups in four agree. And
our blend fits their published numbers *better* than imitating their simpler
play model does, so the extra machinery here is earning its place.

**Registeel's own matchups line up**: Empoleon theirs 724 / ours 713, Guzzlord
655/709, Lickilicky 608/709. The Shadow Ninetales matchup that prompted the
whole investigation is **harsher in our sim than theirs** — theirs 107, ours 63
at 2v2. Mimikyu (theirs 191, ours 709) is the one wild outlier and is expected:
its built-in shield is why it sits in `UNSIMULATED_IDS`.

So the Registeel inversion is not a battle-simulation disagreement. **94 of 1143
Great species carry an editor override, Registeel among them — its published
88.4 is 75% a hand-set 88**, as are Lickilicky, Tinkaton, Altaria, Quagsire,
Empoleon, Jellicent and Forretress. Nine of the ten species argued over are
curated numbers.

One hypothesis tested and **rejected**: that our disagreement concentrates on
overridden species. It does not — overridden species agree with us *more*
(median rank gap 45) than simulation-only ones (75). Overrides land on well
known meta Pokemon that both methods already rank highly.

**The real remaining lead: glass cannons.** All 14 largest matchup gaps run one
direction — high-attack, low-bulk attackers that they score 750–900 and we score
40–120. Bisharp vs Malamar is theirs 900, ours 41; Charizard vs Empoleon 867
vs 116; Absol vs Malamar 811 vs 111. These are exactly the Pokemon whose value
depends on landing a nuke before dying, so shield or bait handling under
pressure is the place to look.

Not the move data. Every fast-move turn count involved was checked against
`data-src/moves.json` and matches upstream exactly, including Psywave at 1 turn.
A prior version of this note asserted several turn counts from memory and was
wrong about four of them — check the file, not recall.

**Sharper characterisation, from the rev-12 re-run.** "We undervalue glass
cannons" is the wrong frame, and it sent an earlier pass looking at shield and
bait handling for attackers. Counting the *opponent* in the sixteen largest
disagreements:

| opponent | appearances |
|---|---|
| Empoleon | 6 |
| Forretress (Shadow) | 2 |
| Clodsire | 2 |
| Altaria | 2 |
| everything else | 1 each |

It is not a broad class of attackers scoring badly. It is a handful of bulky
defenders — Empoleon above all — that beat far more things in our sim than in
theirs. That is a much smaller search: work out what our Empoleon does that
theirs does not, on one matchup, rather than auditing an archetype.

Stat stages are **not** the cause. The rev-12 agreement moved 76.5% → 75.3%
(r 0.726 → 0.712), a small drop, and the top disagreers mostly carry no buff
move at all (Bisharp, Absol). The same cluster was there at rev 10 and 11.

## 1h. Farm-downs and carried energy — BUILT, rev 11

The observation, from play: a good player who can see that fast moves alone
will finish the opponent does not throw a charged move to do it. They hold the
bar and walk into the next Pokemon already loaded. Shadow Marowak is the case
that makes it obvious — Mud Slap into something with no fast pressure farms
the whole matchup, and with a shield to hide behind it does it for free.

The engine could not express that. `pickCharge` returned `roles.main` the
instant it was affordable, full stop. Measured over 60x60x3 in Great, **46.3%
of all charged throws were made into an opponent that fast moves had already
killed** — every one of them energy spent on a kill that was already banked.

`canFarmDown` in `lib/engine.ts` now holds the bar when two things are true:

- **Safe.** Count the fast moves to the kill, then hand the opponent
  everything they get in that window — fast chip, the energy it pays them, and
  every charged move that energy buys, each assumed to be their hardest hit,
  with my shields eating the first few. If what is left still kills me, it is a
  race, not a farm. Deliberately pessimistic.
- **Worth it.** The cost is *not* the whole window's chip. Throwing does not
  end the fight either — I would have eaten most of those turns anyway. What
  farming actually costs is the turns it adds *over* throwing, and only that
  marginal chip is weighed, at HP_WEIGHT, against the energy banked at
  ENERGY_KEPT. Pricing the full window instead was the first version's bug and
  it made the rule almost never fire.

Only with their shields down. With a shield up, spending ~50 energy to strip a
shield is worth 100 by our own exchange rate, so throwing is still right.

`ENERGY_KEPT = 100` is the other half, and the rule does not work without it:
holding costs a little health, so with nothing on the other side of the trade
the correct play would have *scored worse* than the careless one. It mirrors
the ENERGY_DEBT already charged for leaving a live opponent with energy.

Measured before/after against a clean worktree at HEAD:

| | before | after |
|---|---|---|
| farm-safe throws, their shields down | 41.7% | 37.5% |
| mean energy carried out of a win | 11.2 | 16.2 |
| wins ending on a near-full bar (≥90) | 0.4% | 1.4% |

The residual 37.5% is the worth-it gate declining farms whose chip outruns the
energy — intended, not leftover bug. Shadow Marowak vs Registeel at 0 shields
went from 2 charged moves and 30 energy out to **1 and 95**.

PvPoke agreement is unmoved: 76.5% winner agreement at r=0.726, against 76.6%
and r=0.729 before. That is the expected result — they do not model farm-downs,
so a large swing either way would have meant something was wrong.

**It does not lower Registeel, and that is worth being clear about.** Registeel
went 986 → 988 and stayed #1. Lock On is a 1-turn 5-energy move, so Registeel
banks energy readily and now gets *credited* for it. The mons that gained are
bulky low-pressure farmers (Cradily +158 places, Greedent +127, Garbodor +95,
Eldegoss +92); the ones that fell are glass cannons that depended on dumping
energy (Manectric -55, Alolan Golem -49, Rotom Wash -40). Annihilape did move
up 27 places and Shadow Ninetales 10, which is the direction the observation
predicted — but if the goal is specifically Registeel's usage, this is not the
lever. See §1g: 75% of its published score is a hand-set editor value of 88.

## 1i. Stat stages — BUILT, rev 12

Around ninety charged moves change a stat on use: Superpower drops your own
attack and defence, Acid Spray guts the opponent's, Rage Fist and Power-Up
Punch stack their own attack, Ancient Power occasionally raises everything.
The engine modelled none of it — damage was flat for the whole fight — and
**104 of the top 200 in Great run one at their rated set**, so this was not a
rare-case gap.

Modelled as stages rather than multipliers, because that is what the game
tracks: clamped to ±4 on an asymmetric table where +1 is 1.25x and -1 is 0.8x
rather than 1/1.25. `buffMultiplier` in `lib/engine.ts`.

What follows the stages: every damage figure, the move roles (damage per energy
decides main from secondary, and a debuff can genuinely reorder them), the CMP
tiebreak, and the farm-down test. Damage used to be precomputed once outside
the loop as a deliberate optimisation — "attack, defence and typing do not
change". Stages break that premise, so it is now re-derived when a stage
actually moves rather than every turn, which keeps almost all of the original
saving since a battle sees a handful of buffs at most.

**The effect applies even when the move is shielded.** A shield blocks damage,
never the secondary effect, so an Acid Spray eaten on a shield still leaves the
defence debuff behind.

**Chance-gated buffs apply at their expected value. Do not replace this with a
roll.** 64 of the 145 buff-carrying moves land only some of the time. A seeded
PRNG is the obvious model and it was built first, on sound-looking reasoning:
`battle()` must be a pure function of its inputs, since flipGrid calls it once
per IV combination — up to 4096 times for one moveset — and those cells are
only comparable if the rolls match, so the seed has to be fixed.

A fixed seed means every battle replays the *same* sequence. The first draw from
ours was **0.0211**, so every 10%-chance buff landed on its first throw in every
single battle. The distribution was fine — 9.93% over a long run — and that is
exactly what made it hard to see. It was the per-battle restart that turned a
good generator into a systematic bias, and it inflated the Ancient Power
carriers by 500+ ranking places (Spinda +575, Garganacl +581, Naclstack +590)
in a full rebuild before it was caught.

A fractional stage is the honest model. Rankings aggregate thousands of
matchups, so the expected effect is what the average should reflect, and
`buffMultiplier` is continuous — a 10% chance of Def −1 is applied as −0.1 of a
stage. Deterministic, identical across every IV cell, unbiased: everything the
PRNG was reaching for and none of what it delivered. Gate assertions cover the
determinism, the expected-value pricing and that a fractional stage actually
reaches the multiplier.

**The data comes from the generator, not from hand-editing.** The branch this
arrived on wrote buff fields directly into `src/data/species.json`, which is
generated — the next `npm run data` would have silently erased all of it with
no test to catch it. `build-data.mjs` now reads the upstream `buffs`,
`buffTarget` and `buffApplyChance` fields, which were in `data-src/moves.json`
all along on 91 of 334 moves.

It also vindicates the original Annihilape observation from §1h. Rage Fist
stacks attack three times against Registeel, and Counter goes 4 → 5 → 6 damage
over the fight. That is the pressure the farm-down work could not find, because
until now the engine did not model the move that creates it.

## 1j. Fast-move registration — VERIFIED correct; switching is the real gap

The engine models the **old** PvP turn system, and this was checked against the
documented rules rather than assumed:

- Damage and energy register **entirely on the final turn** of a move's
  duration. Never spread across it. A 1-turn move lands immediately; a 5-turn
  Incinerate lands on the fifth turn, after four turns of waiting.
- A Pokemon knocked out **before** that final turn deals nothing for the move
  it had begun.

Measured: Incinerate first registers at turn index 4 with a clean interval of
5; Lock On registers at 0,1,2,3,… ; Talonflame started at 3 HP against a 1-turn
attacker landed zero fast moves. Gate assertions now cover all four, because
these are load-bearing for the free window, the sneak and CMP, and a turn-loop
refactor could break them with nothing else noticing. Wider gaps between
registrations are charged moves resetting both animations — correct, not drift.

**What is NOT modelled, and it matters more than the timing.** Voluntary
switching. `teamBattle` says so in its own header: each side sends its next
Pokemon only when the current one faints. So the standard play of throwing one
fast move and swapping out — leaving the opponent's in-flight long fast move to
land on the Pokemon coming in — cannot be expressed at all.

That is not just a missing feature, it **biases the rankings**. Switching is
the counterplay to debuff stacking, and without it a mon that grinds an
opponent to Atk −4 is never escaped. It is a large part of why Spinda and
Spidops climb on Rock Tomb and Lunge under rev 12 (§1i). Their win rates
calibrate correctly *within* a no-switch sim; the sim is what is narrow, not
the numbers. Any future work on the debuff archetype should start here rather
than by tuning the buff model.

## 1k. Two missing PvP mechanics — FOUND, and they explain a lot

Reported matchup: Azumarill 0/15/15 vs Lickilicky 0/15/10, one shield each.
Should end Azumarill alive on 2 HP and 1 energy, Lickilicky down holding 10.
We had Lickilicky winning with 7% health. Two mechanics were missing.

**1. The Trainer Battle damage bonus, x1.3.** PvP is not the raid formula; the
game applies an extra 1.3 to every hit and PvPoke carries it as
`bonusMultiplier`. We had none. Every damage figure this engine ever produced
was ~23% low. Confirmed twice from reported numbers: Rollout hits that
Azumarill for 4 (we said 3), Bubble hits that Lickilicky for 5 (we said 4).
Neither value is reachable without it.

**2. The sneak is guaranteed, not incidental.** Throwing a charged move without
charge-move priority ALWAYS lets the opponent's fast attack through, resolved
after the charged damage, wherever that fast move happened to be in its
animation. The only exception is a knockout — a charged move that kills denies
the victim its fast move.

Ours gated the sneak on `registersA`, so it landed only when the defender's
animation happened to finish on that exact turn. The old comment reasoned
correctly about the mirror match, where equal turn counts make registrations
coincide, and generalised from it wrongly. Everywhere else the defender lost a
fast move — and its energy — on most charged throws.

**Why this matters far beyond one matchup.** Both errors push the same way.
Damage 23% low makes every fight ~23% longer; a denied sneak removes damage and
energy from whoever is being thrown at. Together they systematically favour
grind over burst, which is very likely the single cause behind several things
recorded here as separate mysteries:

- §1g's "glass cannons": Bisharp vs Malamar theirs 900, ours 45. A nuke that
  cannot close the fight lets a bulky mon grind it down.
- Empoleon appearing in 6 of the 16 largest PvPoke disagreements.
- Lickilicky, Quagsire, Feraligatr and Fearow sitting 60-160 places below
  PvPoke's rank for them.
- Plausibly the rev-12 debuff-stacking archetype too, since longer fights mean
  more stacks land.

Seven assertions pin both mechanics to the reported matchup, including that a
charged KO denies the sneak. They are worth keeping because neither failure was
visible in aggregate: they shifted every matchup slightly in one direction
rather than breaking anything outright, which is exactly the kind of error a
ranking pipeline will happily average over forever.

## 1l. Opponent weighting — measured four ways, score curve kept

Asked to make beating a bottom-ranked Pokemon worth an epsilon and beating the
best worth a great deal. The existing d2 weighting looked concentrated and
measured nearly flat: normalising by score against the field's worst put rank
100 at 82% of the span, and cubing 0.82 is still 0.55. Rank 50 carried 63% of
rank 1's weight and the bottom HALF of the roster held 22% of all weight,
against the top 50's 11.6%.

A log-of-rank curve fixes exactly that — rank 10 at 45%, rank 100 at 12%, rank
500 at 1%, last place at zero, bottom half down to 3.4% of total weight. It is
the right shape for the stated goal. It also regressed rank agreement with
PvPoke in every league, and a second variant regressed further:

| config | great | ultra | master |
|---|---|---|---|
| rev 12 baseline | 0.8300 | 0.8144 | 0.8836 |
| + rev-13 mechanics only | 0.8082 | 0.8130 | 0.8911 |
| **+ consistency and attackers fixes** | **0.8522** | **0.8494** | **0.9109** |
| + log-rank (ranked over full field) | 0.7935 | 0.8105 | 0.9085 |
| + log-rank (ranked within tier) | 0.7376 | 0.7851 | 0.9080 |

The within-tier variant was an attempt to fix a real compounding problem — the
tier cutoff and the curve both grade opponent quality, so a full-field rank
re-applies the cutoff's judgement inside the kept set, spreading weights 5.1x
across a top-50 tier against 1.6x before. Ranking within the tier instead
zeroes the bottom of every tier, effectively shrinking it, and measured worse
still. The compounding is real; that was not the fix for it.

**Kept: the score curve.** Not because log-rank is wrong — it does what it was
asked to do — but because it is the only configuration that measures worse on
the one external check available, and there is no independent evidence for it
beyond intent.

**Read that comparison carefully, though.** PvPoke does not do a weighted
regression at all, and their published matchups look like 1-shield data: our
agreement with them is 83.1% at sh11 against 72.3% at sh00 and 72.9% at sh22.
So rank correlation is a weak test of *our weighting specifically* — a curve
they do not have will disagree with them by construction. It is a live option
to reinstate, not a closed question. What is not in doubt is the rest of §1k
and the two double-count removals, which improved every league.

## 1m. The seed order was read before it settled — and what that suggests next

Asked whether earlier iterations carry errors forward. Checked directly:
`build-matrix` reads only `data-src` and starts every run from
`weights.fill(1)`, so **no state crosses builds**. Rev 13 inherits nothing from
rev 12.

One error *within* a build, now fixed. The seeded order comes from a fixed-point
iteration — score everyone with uniform weights, feed those scores back as the
weights, rescore — and it was capped at four rounds. Four is not enough:

| round | refs still moving (of 1140, Great) | largest jump |
|---|---|---|
| 4 (old stopping point) | 325 | 9 |
| 5 | 71 | 6 |
| 6 | 44 | 8 |
| 7 | 0 | 0 |

That order decides tier membership, so "top 50" and "top 100" were drawn from a
list still in motion, and every tier average, d2 weight and team candidate pool
inherited it. It now iterates to convergence; the loop costs no simulation, so
this is nearly free. `WEIGHT_ROUNDS_MAX` is a cycle guard, not a budget — if it
is ever hit the order is oscillating, which is worth a warning rather than a
silent truncation.

**Effect is small and should be reported as such**: mean rank change 1.8 places
in Great, correlation 0.8522 -> 0.8524. The tiers are coarse enough that nine
places rarely crosses a boundary. Real bug, correct fix, modest consequence.

**The recurring risk is not accumulation, it is artefacts disagreeing.** Twice
in one session an artefact was silently inconsistent with its siblings — a
stripped `bestIv` index, and teams built under a different weighting — and both
times the rev stamp could not see it because the *engine* rev was identical.
Hashing the weighting constants and generator inputs into the stamp would close
both. Still open.

**Where a ground-up rebuild is and is not warranted.** The battle engine now has
external validation: 83.1% matchup agreement at 1v1, against damage figures
confirmed from the live game (§1k). That layer is in the best shape it has been.
The *aggregation* layer has no external check at all, and it is where everything
unresolved lives — Lickilicky's gap survives correct battles (§1j/§1k), the
score-versus-log-rank question could not be settled by measurement (§1l), and it
is built from hand-set constants: `1.5 * sd`, `D2_POWER`, the 12/6/4/2 composite
weights, the category blends.

**Bradley-Terry is the principled replacement, and the seeding loop is already a
crude version of it.** Score, re-weight, rescore is a hand-rolled power
iteration. Fitting a latent strength per Pokemon to the whole matchup matrix by
least squares on log-odds would make "beating a strong opponent counts more"
fall out of the mathematics rather than out of a chosen curve — which dissolves
§1l rather than deciding it — and would remove `WEIGHT_ROUNDS`, `D2_POWER` and
the tier/curve compounding together. The matrix is already in memory, so it
costs no battles.

The honest caveat: Bradley-Terry assumes one latent strength explains matchups,
i.e. approximate transitivity, and PvP is famously intransitive — cores and
coverage triangles *are* the cyclic structure. A pure fit will show systematic
residuals exactly where the meta is rock-paper-scissors. That is the most
valuable part: those residuals measure how much of this format any single-number
ranking can express, which nothing here currently reports. Low-rank bilinear
terms are the known extension if the residuals are large.

## 1n. Bradley-Terry, and the measurement that reframes the whole ranking

Built as a prototype alongside the composite, not as a replacement. Both read
the same matchup matrix; the difference is entirely what they do with it.

The composite aggregates each Pokemon's results under weights somebody chose —
an opponent curve, five category blends, a geometric mean with exponents
12/6/4/2. Bradley-Terry instead asks what single strength per Pokemon best
explains every matchup at once. Over a complete graph the least-squares
solution is closed-form — each strength is the mean of its row of log-odds — so
there is no solver, no learning rate and no convergence question. "Beating a
strong opponent counts more" falls out of the fit rather than out of a curve,
which is what made it worth trying after §1l could not settle the curve by
measurement.

**The finding is not the ranking. It is the residual.**

| league | variance explained | typical miss | cyclic triples |
|---|---|---|---|
| great | 23.8% | 14.9 pts of win rate | **17.8%** |
| ultra | 23.9% | 15.0 | 18.3% |
| master | 35.6% | 14.8 | 16.0% |

Read the cyclic count, not the R2 — R2 is deflated by the rating scale's own
compression (soft cap, loss curve), while the triple count only needs "who
beats whom" and is robust to it.

**17.8% of sampled triples are rock-paper-scissors cycles.** A perfectly
transitive format would be 0%. Independent coin flips would be 25%. So this
meta sits about 70% of the way from "rankable" toward "maximally cyclic", and
Master — the most stat-driven league — is the most transitive of the three,
which is the direction that makes sense.

That is the reframing: **a ranking is a lossy summary of this format, not a
description of it, and the loss is large.** Nothing in this pipeline reported
that before. It is a positive argument for the Cores and Teams views, where
cyclic structure is the subject rather than the error term, and it is *not* an
argument that either ranking is broken.

**The two rankings agree at rho 0.87–0.94 overall and disagree sharply at the
head** — Registeel is 2nd on the composite and 92nd on Bradley-Terry, Carbink
is 1st on both. Some of that is a genuine difference in question; some is a
design choice worth flagging before anyone reads too much into it: **the fit
weights every opponent equally over the whole field, with no tier and no
relevance weighting**, so it answers "strongest against everything released"
while the composite answers "strongest against the tier". That is not
apples-to-apples and the Diagnostics screen says so.

Next, if this is taken further: low-rank bilinear terms are the standard
extension for modelling the cyclic part explicitly, and would turn the residual
from a diagnostic into structure the app could show. Restricting the fit to a
tier would also make the head-to-head comparison fair.

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

## 2b. Team discovery — what to bring, not how good this is

`scripts/build-teams.ts` → `teams.json` (719KB raw / 52KB gzipped), read by
`lib/teams.ts` and the `BestTeams` panel on both builder screens. Answers the
question the builders could not: the best threes and best sixes at **all 252
strata** — 3 leagues x 6 tiers x 7 categories x 2 passes, 12 of each per
stratum.

**It is a table, not a search.** Beam search and hill-climbing both report a
local optimum with no way to say how local. What a team is worth depends only
on how each of its *lines* fares against each opposing line, and there are far
fewer lines than teams — so line-vs-line is tabulated once and every team is an
exhaustive lookup: every legal three from 24 candidate species and every legal
six from 16, with no beam width to defend.

**Duplicate species are a construction rule, not a filter.** GBL forbids two
Pokemon sharing a **Pokedex number** — so Alolan Ninetales bars Kanto
Ninetales, a Mega bars its base form, and a Shadow bars its plain form.
`conflictsOnTeam` in `lib/data.ts` is the single decision point; comparing refs
or ids catches only the last of those cases. It is enforced while combinations
are generated and while the field is sampled, never on the output: filtering
afterwards would leave the top ten short *and* leave every score measured
against a field of teams nobody could bring.

That rule also sets the candidate cut. Taking the top 24 *rows* spent 3.6 of
them on average — 8 in the worst Master stratum — on a second form of a species
already listed, which can never join it. So the list widens until it holds 24
distinct dexes and keeps every form of each: full breadth, and the
Shadow-versus-plain choice stays something the search decides.

**There was a prefilter; it was removed.** Scoring every triple against a small
field and keeping the best 250 saved only ~1.8x once the candidate lists were
widened, and `--validate` caught it dropping 3 of Ultra's true top 12. Paying
1.8x for an exhaustive answer with nothing to defend is the better trade. What
`--validate` now checks is the *table*: it re-simulates the top team straight
from the engine, no table and no byte encoding, and compares. Currently **drift
0.00**. That catches an indexing or stride bug, which is the failure this
design can still have.

Show 6 falls out of the same table: a six is worth `mean over opposing sixes S
of (max over my 20 lines, min over their 20)`, which is 20 x |field| lookups
once the table exists.

**The nine shield parities are simulated at team level**, not inherited through
the candidate pool. `TeamStart` in `lib/team.ts` takes `shieldsA`/`shieldsB`
separately plus banked-energy starts, and the scenario ids match the
single-matchup ones **on purpose**, so `CATEGORIES`' weights apply to teams
unchanged and the seven categories keep one definition. This is why "best
Closers team" is a separately-played question rather than "best normal team
made of good closers". It measurably matters: 59–63 of 84 strata pick a
different top three, and **all 84 pick a different top six** in Great and Ultra.

**Both sides play `read`**, unlike the rankings which average both policies.
Rankings sit next to PvPoke's numbers and you do not choose how a stranger
plays; discovery is asking what to bring, and a team that only looks good
because the opponent shields the bait is not an answer.

Tiers are deliberately **not** capped at the builder's usual top 100: if they
were, four of the six would be the same number wearing different labels.

## 2c. Synergy — the third pass, and cores

**Three passes, not a blend.** `d1` and `d2` rank by the simulated chain; `syn`
ranks the identical candidate set by whether the team covers itself. Kept as a
third axis rather than folded into a weighted score, for the same reason §1
exists: coverage and win rate are different questions, and one number averaging
them answers neither. Switch axis to switch question. 126 strata per league now
(6 tiers x 7 categories x 3 passes).

It is not a relabelling of the simulated pass. At the default Master tier the
two disagree on the top team in most categories — d1 takes
Zacian/Dialga-Origin/Lunala (sim 778, syn 645), syn takes
Zacian/Palkia-Origin/Zygarde (syn 829, sim 753, and no holes at all).
`verify-data` asserts they differ in at least half of categories, so a bug that
collapsed them into the same ordering fails the gate rather than shipping as a
third button showing the second button's answer.

**Components** (`lib/synergy.ts`, weights in `SYNERGY_WEIGHTS`):

| term | weight | what it measures |
|---|---|---|
| coverage | 0.34 | mean best answer across the field — the floor |
| swapWorst | 0.20 | how the back line answers the single worst lead matchup |
| redundancy | 0.16 | share of the field with **two** answers, half credit for one |
| typeCover | 0.12 | share of members' weaknesses a teammate resists |
| swapMean | 0.10 | the same as swapWorst, averaged over every losing lead |
| bulk | 0.08 | mean stat product against the tier best |

Both risk readings are kept because the gap between them is the signal: a team
with a high `swapMean` and a low `swapWorst` is fine on average and has one
opening it cannot recover from.

Type complement is deliberately small. It is derived from the chart rather than
from play, so it is a **prior, not evidence** — it earns its place by catching
shared weaknesses the sampled field happened not to punish, not by outvoting
simulation.

**The core metric took four revisions. The history is the documentation.**
Each failure was diagnosed from output, and each named a distinct missing
dimension rather than a mistuned constant:

1. *Field too narrow* (the tier's own top 100). Cores are usually two mid-ladder
   Pokemon covering what the top hundred does not contain, so there was nothing
   for them to cover. Widened to 500 (`CORE_TIER`).
2. *Field too wide, counted flat.* ~400 tail opponents outvoted the meta; Great's
   best "cores" came out as Carbink beside four separate forms of Gourgeist, none
   ever used. Fixed by `relevanceWeights` — opponents graded by their own
   Overall, squared.
3. *Rescue was a ratio, not a quantity.* Dividing by the matchups A loses asks
   "of my problems, what share does my partner solve", which rewards having few
   problems. Carbink loses to almost nothing and took 8 of the top 10. The
   denominator is now the whole field.
4. *No individual-strength term.* Complementary holes are cheap — two *bad*
   Pokemon manage it easily, because being weak to everything makes you
   complementary to anything. Coalossal (rank 182) beside Whimsicott (324) beat
   Altaria (22) beside Empoleon (97). `coreStrength` now multiplies mutual
   rescue by the geometric mean of both members' normalised Overall.

**`lift` is the instrument, not the score.** It is the only signal here not
computed from the same arithmetic as the ranking, so it is what caught every one
of the four. The share of zero-lift entries in a league's top 20 is the health
check: 18/20 meant the metric had drifted from anything the field rewards.
Currently 10/20 great, **3/20 ultra**, 9/20 master — Great and Master have a
dominant anchor (Carbink, Lugia) that legitimately pairs with everything.

**Balance is reported, never folded in.** The two rescue directions say
different things from their mean. Carbink + Shadow Corviknight scores 570 off
370/910 — a strong pairing where Carbink does most of the work. Altaria +
Empoleon scores 268 off 495/378 — lower, and genuinely reciprocal. Averaging
those into one number would hide exactly the distinction worth having, which is
the §1 mistake in miniature. `coreBalance` in `lib/teams.ts`, its own column and
its own sort.

**Cores are discovered, never authored.** There is no table of good pairings
anywhere in the codebase. A core is a pair where each is strong exactly where
the other fails, scored as the **geometric mean of both rescue directions** —
so "a great Pokemon plus a passenger" scores near zero however great the first
one is. Mutuality is the definition, and `verify-data` asserts every emitted
core rescues both ways.

Two numbers are reported and they mean different things. **Mutual rescue** is
the structural claim; **lift** is how often the pair actually appeared together
in top teams against what independence predicts. The gap is informative — in
Master, Dialga (Origin) + Ho-Oh scores 188 with a lift of **2.01x** (a real
partnership: Ho-Oh answers the Fighting/Ground that beats Dialga, Dialga answers
the Water/Electric/Rock that beats Ho-Oh), while Zacian + Rhyperior (Shadow)
scores a comparable 172 at lift 0.88 having appeared together twice. High
rescue with low lift is a pairing the field does not actually reward.

**Pillars** are the other shape: a lead with a narrow weakness that *two*
teammates independently answer, so the bad lead has two ways to flip rather than
one. Scored as the share of the lead's losing matchups that **both** backs
cover. Necrozma (Dawn Wings) behind Xerneas + Zamazenta covers 78% of its 40
losses in Master.

**Cost.** The synergy pass needs a second table — each candidate against each
field *species*, one on one, which a team-versus-team table cannot express
because it has already summed three members into one result. That is the step
that hides a shared hole. Adds ~90s per league.

One caveat worth keeping visible: `syn` weights the opposing field flat, like
`d1`. There is no graded variant, on the grounds that a hole is a hole whoever
is standing in it — but that is an assumption, not a measurement.

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
- **Residual energy is now priced** (rev 10): a surviving opponent's banked
  energy is a charged move your next Pokemon walks into, and costs `ENERGY_DEBT`
  scaled by the bar. Correct on its own merits — it was previously free — but it
  does **not** demote Registeel, which was the hope. It penalises frequent
  losers, and Registeel concedes energy in only 35 matchups because it wins the
  rest; Lickilicky concedes in 100. Measured before rebuilding.
- ~~Baiting~~ — two real bugs found and fixed at rev 7. Against a `read`
  defender the attacker baited *forever*: the rule threw the secondary whenever
  the opponent held a shield, a reading defender declines baits on purpose, so
  the shield never came down and the condition never cleared. Lickilicky vs
  Registeel was four Body Slams and no Shadow Ball, peak energy 47 against the
  50 it needed. Baiting also had no cost model — it now declines when the bait
  is under `BAIT_MIN_EFFICIENCY` (0.7) of main's damage per energy. Individual
  matchups moved by hundreds of points. Neither fixed the Registeel/Lickilicky
  inversion, which is why §1c matters.
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

`teams.json` is **3.76MB raw / 790KB gzipped** and now ships **150 threes and
150 sixes per stratum** — 113,400 teams against 9,072 at the old cap of 12.

The 12-cap was never a compute limit: the build already ranked every legal team
and threw the rest away. It was a wire-format cost, and the cost was strings. On
the compact format refs are indices into a per-league table and everything else
is a bare number, so a team is ~16 bytes rather than ~120:

```
t3  [i, j, k, score, sim]
t6  [a..f, line0, line1, line2, score, sim]
d3/d6  [synScore, coverage, redundancy, swapWorst, swapMean, typeCover, bulk, ...holes]
```

The full synergy breakdown rides only on the first `DETAIL_N` (12) of each
stratum — it is the expensive part of a row and is read only when one is
expanded. **12.5x the teams cost 15% more bytes.** The UI pages at 25 and scales
its bars against the stratum's best rather than the page's.

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

Open, new:
- **Synergy weights are a judgement, not a measurement.** `SYNERGY_WEIGHTS` in
  `lib/synergy.ts` was reasoned about (see §2c) but never fitted to anything. If
  a way to validate them appears — agreement with high-level play, say — that is
  the thing to check them against. Do not fit them to the simulated passes;
  reproducing those is the one outcome that would make the axis pointless.
- **`ANSWER_LINE` at 560 is a round number.** It decides what counts as covering
  a matchup, so coverage and redundancy both move with it. Worth a sensitivity
  check before anyone reads too much into a small coverage gap.
- **Cores are computed at one stratum only** — `CORE_TIER` (500) under Overall —
  so a pairing that only works at the top 50, or only for Closers, is invisible.
  One table per league was the deliberate trade for comparability; a per-stratum
  core view is the obvious extension.
- **Do the cores disagree with strong players, or with our own rating?** Two
  pairings named by an experienced player — Altaria + Empoleon, Hisuian
  Electrode + Carbink — score 268 and 296 against a 570 top, and are the *more
  reciprocal* pairs (balance 0.76 and 0.21 against the leader's 0.41). They sit
  below a head dominated by Carbink, which our own rankings put first overall.
  That may be a real disagreement, or it may be that scoring cores against a
  rating that already favours Carbink double-counts it. **Do not resolve this by
  tuning until the named pairs rise** — that is fitting the metric to a
  conclusion, the §0 trap one level up. Resolve it by finding an independent
  check, as `lift` was for the four revisions above.
- **Discovery does not sweep movesets.** Both sides run their rated loadout in
  `build-teams.ts`. Letting each of three members range over 12 sets multiplies
  the space by 1728 to answer a question nobody asked — you pick the team, then
  tune the moves — but it does mean a team whose value depends on an off-meta
  set will not surface.
- **Discovery inherits `teamBattle`'s no-switch line**, same as the live
  builders. It is the same gap noted below, but it bites harder here: a
  discovered "best team" is best *given nobody switches*.
- **The three/six candidate cuts are 24 and 16.** A genuinely good team using
  the stratum's 30th-best species cannot be found. Raising `CAND_N` is cheap;
  raising `SIX_N` is not — C(n,6) grows fast (16→8008, 20→38,760).

Done:
- ~~What "best" means (§1)~~ — decided and measured; see that section.
- ~~Best teams of 3 and 6, discovered across every stratification~~ — §2b.
- ~~Result export for offline analysis~~ — CSV per view and per league, nested
  JSON for the full rankings artefact. `lib/exportData.ts` records why NDJSON
  and Parquet were considered and skipped.
- ~~Synergy, cores and the 1-front-2-back shape~~ — §2c. Cores and pillars have
  their own screen, with the evidence for each pairing rather than a bare score.
- ~~`scripts/` was never typechecked~~ — `tsconfig.scripts.json`. It caught an
  undefined identifier in `build-teams.ts` the moment it was added; without it
  that surfaces as a crash partway through a multi-minute build.
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
- `npm run data` now chains `build-data` → `best-spreads` → `matrix` → `teams`.
  The last two are the slow ones; `npm run matrix` and `npm run teams` re-run
  each alone. **`teams` reads `rankings.json`**, so `matrix` must run first.
- **Two revisions, not one.** `ENGINE_REV` in `build-matrix.ts` (now **6**) and
  `TEAM_REV` in `build-teams.ts` (now **1**). `teams.json` also records the
  `engineRev` it was built against, and `BestTeams` shows a warning when that
  disagrees with the shipped matrix — a teams artefact can go stale on its own,
  because a `teamBattle` change moves teams and leaves the rankings alone.
- `teams.json` is generated and committed, same as `species.json` and
  `rankings.json`. Worth a line in any PR description so a reviewer does not
  read it as hand-written.
