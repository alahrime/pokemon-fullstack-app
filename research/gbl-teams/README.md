# GBL team search: Great League, full 3v3 games

Started 2026-11-13 (seventeenth session, chat-only research, no app code changed). This folder is the
working record: what was built, what it found, and what the next session should change. The
app's engine (`app/src/lib/engine.ts`) does every fight; nothing here is shipped to users.

## Run it

All scripts run with `app/` as the working directory, and `S` pointing at `data/`:

```bash
cd app && S=$PWD/../research/gbl-teams/data npx tsx ../research/gbl-teams/scripts/g3test.ts
```

That runs 3 sample games (about 0.2 s). Each script is described in the table below.

| Script | What it does | Reads → writes |
|---|---|---|
| `universe2.ts` | Every meta piece fights every other on its best viable moveset, under 7 shield/energy scenarios. `dunsparce#ASTONISH` / `#ROLLOUT` are separate pieces. | `matrix4.json` (moves), `teams2.txt` → `universe2.json` (`U`, `moves`, `R.{s00,s01,s11,s22,sw,ch,c0e}`, `rank`) |
| `oracle.mjs` | 1v1-matrix double oracle over ~700k teams, using a lead-swap matrix game as each team-vs-team payoff. Builds the candidate pool. | `universe2.json` → `oracle-out.json` (`pool`, each with `fitEq`, `fitPool`, `fitLog`) |
| `g3.ts` | **The 3v3 model.** `game(A, B)` plays a full game with HP, energy, shields and broken Disguise carried through. The blind lead choice is solved as a mixed strategy (`solveMixed`, fictitious play). `line()` traces the best line of play. | `universe2.json` |
| `meta3.ts` | Double oracle where every payoff is a `game()`. Uses 10 worker threads. Each strategy is a team plus its lead. | `oracle-out.json`, `cands.json` → `meta3-out.json` (`strat`, `share`, `fitEq`, `fitAll`, `edge`), `meta3.log` |
| `g3run2.ts` | Final scoring: each candidate team (all 3 leads) plays the equilibrium and the logged teams, with lines kept. Run as 10 shards with `SHARD=0..9 NSHARD=10`. | `meta3-out.json`, `cands2.json`, `teams2.txt` → `g3b-<shard>.json` (≈12 MB in total, not committed, rerun to regenerate) |
| `g3sum2.py`, `g3mix.py` | Turn `g3b-*.json` into `top100.md` (ranking, lead plan, closer, losses) and `leadmix.md` (full lead-plan mix per team). Run from `data/`. | |
| `teamsearch4.ts`, `chain2.ts`, `belli.ts` | Earlier one-off checks: the 1v1 team search, the Quagsire → Melmetal chip-damage chain vs Annihilape, and Bellibolt Thunder Shock vs Sucker Punch. | |

**Data:**
- `teams2.txt` is the user's 105 logged opponent teams (89 have all three seen). The user's names map as follows:
  - ape = Annihilape; ursa = Ursaluna; ufisk = Stunfisk
  - a9 = Alolan Ninetales; k9 = Kanto Ninetales
  - h trode / electrode = Hisuian Electrode
  - "peck" = Altaria with Peck
- The scripts import from `../../../app/src/lib/*`. Moving them breaks those paths.

## The model, and its known ceilings

- **Pieces:** the top 120 Great League species plus everything in the log, 163 pieces in all. Each runs one moveset, its best *viable* one:
  - **Fast moves:** damage per turn ≥ 75% of the species' best, or energy per turn ≥ 85% with damage + energy ≥ 80%.
  - **Charged moves:** damage per energy ≥ 70% of the best, or a buff/debuff move, or a bait move (≤ 40 energy and ≥ 55% damage per energy).
  - Return and Frustration are excluded. Default IV spread from `bestSpreadFor`.
- **Lead plans:** each side picks one of 10 plans without seeing the other's:
  - stay in;
  - switch on turn 1;
  - switch after the first charged move thrown by either side.
  - Each switch can go to either back Pokémon, and every plan is played with `read` shields or with `save` (no shields used in the lead fight).
  - The value is solved as a mixed strategy.
- **After the lead:** a side that loses a Pokémon picks its next one (minimax), and every fight uses `read` shields. One voluntary switch per side, ever.
- **Payoff:** `0.55 + 0.45 × your HP left` on a win, `0.45 − 0.45 × their HP left` on a loss. Win rate is reported separately (`v > 0.5`).
- **Mimikyu:** the engine resets Disguise every fight (see the `ponytail:` comment in `battle()`). `g3.ts` carries the Busted form once any unshielded charged move lands. The app's engine still has the ceiling.

## Findings

**Meta search (`meta3.log`):**
- Started from 213 teams = 639 team+lead strategies, about 204k full games.
- Round 1 added Azumarill / Charjabug / Astonish Dunsparce (53.2% against the mix).
- Round 2: the best outside team reached 51.8%, so the search stopped. Final in-pool edge 0.05%. The support is 32 strategies.

**Top of the equilibrium:**

| Team | Share |
|---|---|
| Mimikyu / Quagsire / Melmetal | 9.4% |
| Azumarill / Charjabug / Astonish Dunsparce | 8.5% |
| Melmetal / Mimikyu / S. Talonflame | 8.4% |
| S. Kanto Ninetales / Mimikyu / Walrein | 5.6% |
| Regidrago / Cramorant / Astonish Dunsparce | 4.5% |
| Clodsire / S. Hydreigon / Dondozo (user's team, Clodsire lead) | 2.1% |

**Ranking (`data/top100.md`):** 101 teams, ranked by `0.6 × win rate vs the equilibrium + 0.4 × win rate vs the log`.

| Team | Eq win | Eq value | Log win | Log value | Worst matchup |
|---|---|---|---|---|---|
| **Mimikyu / S. Talonflame / Rillaboom** (recommended) | 61% | 49.5% | 82% | 55.1% | 39% |
| Mimikyu / Rillaboom / S. Annihilape | 63% | 49.8% | 76% | | |
| Azumarill / Charjabug / Astonish Dunsparce | **74%** | | 55% | | |
| Mimikyu / S. Annihilape / Walrein | 47% | | **88%** | | |
| User: Clodsire / S. Hydreigon / Dondozo (#30) | 54% | 50.2% | 62% | | |
| Melmetal / Quagsire / Altaria (#56) | 32% | 48.5% | 79% | | |

**What the ranking means:**
- **Against the equilibrium every top team scores 49–51% in value.** That is what an equilibrium is, and the user's team is no more exploitable than the others. Teams separate on win rate (thin wins vs heavy losses) and on the log.
- **Win conditions (top 30):**
  - Lead mix: about 41% "fight to the first charged move, then switch" (about half of it saving shields), 36% switch on turn 1, 20% stay.
  - Shields entering the final fight in wins: 0–0 65%, 1–0 16%, 0–1 9%, 2–0 6%, 0–2 3%.
  - Most common losses: Melmetal, Mimikyu, Cramorant, Diggersby, Altaria.
- **The user's line is reproduced.** Clodsire leads without shields, takes the first charged move, and Hydreigon comes in with both shields. That is 28% of the mix, and 89–97% against the Melmetal/Mimikyu/Talonflame and Azumarill/Charjabug/Dunsparce shells. Dondozo is the pivot into Regidrago / Cramorant.

**The user's rules (see their memory: lead and closer must not share a counter, judge against whole teams, opponents switch):** these are now in the model rather than in post-filters. Any new score must keep them.

## Next session: scale the candidate set, and stop double-counting look-alike teams

The user asked for two changes. Do them in this order; each step has a check.

### 1. Moveset variants as pieces, only where they matter

Today each species has one moveset. Add variants as separate pieces (`species#FAST-CHARGED1-CHARGED2`, extending the `dunsparce#ASTONISH` scheme in `universe2.ts`), but **keep a variant only if it drastically changes a meaningful matchup:**
- **Candidates:** every viable-move combination from the filter above, plus a species' second-best fast move if it passes.
- **Meaningful opponents:** the pieces with the top ~60% of equilibrium weight, or ≥ 1% of `teams2.txt`, or any Fighting type. Fighters stay in because of the user's rule that rare but dangerous threats count.
- **Drastic, in the 1v1 matrix:** against the default moveset, the rating moves ≥ 150 *and* crosses 500, in at least 2 meaningful matchups under at least 2 of the scenarios s11 / s22 / s00 / ch.
  - Otherwise fold the variant into the default and record it as an alias.
  - Likely survivors (verify, do not assume): Dunsparce Astonish/Rollout, Bellibolt Thunder Shock / Sucker Punch (Thunder Shock simmed better on every team), Altaria Peck vs Dragon Breath, Ninetales Weather Ball vs Psyshock, Annihilape Counter vs Low Kick.
- **Check:** print the kept variants with the matchups that justify each. Expect tens, not hundreds.

### 2. Make the candidate set far larger

**Current ceiling:** 214 teams in the full 3v3 pool, 120 outside teams proposed per oracle round, picked by a 1v1 piece score.

**Cost:** one `game()` is about 65 ms on one core (4,467 fights for 3 games). `meta3.ts` ran 204k games in 687 s on 10 workers, about 300 games/s. Plan in those units.
- **Generate:** all C(n, 3) teams of the expanded pieces, about 700k for today's 163 pieces, more with variants. Drop same-species pairs (shadow and non-shadow included).
- **Prefilter:** score every team cheaply against the current equilibrium with the 1v1 lead-swap matrix model from `oracle.mjs`, which takes seconds for 700k teams. Then apply the user's ABA rule as a *penalty, not a cut*: lead and closer losing to the same meaningful opponent.
- **Proposals:** per round, propose the top **3,000–5,000** by prefilter, plus 500 sampled at random from the rest. The random sample tests the prefilter's blind spots. Each team gets its 3 leads, against the support of about 30–60 strategies, so roughly 0.5–1M games ≈ 30–55 min per round on 10 workers.
  - Add any team that beats the mix by more than 1%.
  - Stop when no proposal clears 0.5%, or after 6 rounds.
  - Log the prefilter rank of every team that gets added. If added teams come from deep in the prefilter, the prefilter is wrong and needs fixing first.
- **Speed-ups, only if the round time is too long:**
  - Cache `fight()` results keyed by (A piece, B piece, HP, energy, shields, policy), rounded to the engine's integer state. Leads repeat across thousands of games.
  - Prune a lead plan whose row is dominated after the first 200 opponents.
- **Check:** rerun the current 214-team setup through the new code and confirm the same top 5 equilibrium teams within ±2% share before trusting the larger run.

### 3. Count repeated wins against look-alike teams once, not many times

**The problem:** a team that beats Mimikyu / Melmetal / X for ten different X piles up ten "wins" that are really one matchup. The same happens with moveset variants, shadow toggles, and the same three in a different order.

**Weight by distinct opponents instead:**
- **Equivalence classes:**
  - Same three species in any order, with folded moveset variants treated as identical, is **one** opponent.
  - Shadow vs non-shadow stays distinct only if step 1's test would keep it as a variant.
- **Near-duplicate clusters:** two opponent teams sharing 2 of 3 pieces *and* producing the same winner with a value within 0.05 against our team belong to the same cluster.
  - Single-link clustering per evaluated team, because "the same to me" depends on who I am.
- **Score against each source:**
  - Equilibrium: a cluster's weight is the sum of its shares, but its value is the share-weighted mean, so a cluster counts once at its real weight.
  - Log: weight each cluster by `count^0.5` (diminishing returns for teams seen over and over), normalised.
  - Report the plain and the deduplicated numbers side by side, with the exponent as a knob. The user will want to see how much the ranking moves.
- **Also report breadth:** the number of distinct clusters a team is favoured against, and the worst cluster value. It's a better "consistency" figure than the average.
- **Check:** for the current top 10, print the before/after scores and the three largest clusters merged for each, so the user can sanity-check that merged teams really play the same.

### Model ceilings worth lifting after that (ask first)

- Voluntary switches after the lead (switch clock, one per fight).
- `save` shields as a choice beyond the lead.
- IV spreads other than the default.
- The engine's own Disguise reset.

## Results files

- `data/top100.md`: the ranked table.
- `data/leadmix.md`: lead-plan mix per team, in plain words.
- `data/meta3-out.json`: the equilibrium.

Regenerate `g3b-*.json` with `g3run2.ts` before running `g3sum2.py` or `g3mix.py`.
