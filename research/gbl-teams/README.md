# GBL team search: Great League, full 3v3 games

Started 2026-11-13 (seventeenth session, chat-only research, no app code changed). This folder is the
working record: what was built, what it found, and what the next session should change. The
app's engine (`app/src/lib/engine.ts`) does every fight; nothing here is shipped to users.

## Run it

All scripts run with `app/` as the working directory, and `S` pointing at `data/`:

```bash
cd app && S=$PWD/../research/gbl-teams/data npx tsx ../research/gbl-teams/scripts/g3test.ts
```

The v4 scripts read the larger piece set when `UNI=universe3.json` is set (`g3.ts` defaults to `universe2.json`).

That runs 3 sample games (about 0.2 s). Each script is described in the table below.

| Script | What it does | Reads → writes |
|---|---|---|
| `universe2.ts` | Every meta piece fights every other on its best viable moveset, under 7 shield/energy scenarios. `dunsparce#ASTONISH` / `#ROLLOUT` are separate pieces. | `matrix4.json` (moves), `teams2.txt` → `universe2.json` (`U`, `moves`, `R.{s00,s01,s11,s22,sw,ch,c0e}`, `rank`) |
| `oracle.mjs` | 1v1-matrix double oracle over ~700k teams, using a lead-swap matrix game as each team-vs-team payoff. Builds the candidate pool. | `universe2.json` → `oracle-out.json` (`pool`, each with `fitEq`, `fitPool`, `fitLog`) |
| `g3.ts` | **The 3v3 model.** `game(A, B)` plays a full game with HP, energy, shields and broken Disguise carried through. The blind lead choice is solved as a mixed strategy (`solveMixed`, fictitious play). `line()` traces the best line of play. | `universe2.json` |
| `meta3.ts` | Double oracle where every payoff is a `game()`. Uses 10 worker threads. Each strategy is a team plus its lead. | `oracle-out.json`, `cands.json` → `meta3-out.json` (`strat`, `share`, `fitEq`, `fitAll`, `edge`), `meta3.log` |
| `g3run2.ts` | Final scoring: each candidate team (all 3 leads) plays the equilibrium and the logged teams, with lines kept. Run as 10 shards with `SHARD=0..9 NSHARD=10`. | `meta3-out.json`, `cands2.json`, `teams2.txt` → `g3b-<shard>.json` (≈12 MB in total, not committed, rerun to regenerate) |
| `g3sum2.py`, `g3mix.py` | Turn `g3b-*.json` into `top100.md` (ranking, lead plan, closer, losses) and `leadmix.md` (full lead-plan mix per team). Run from `data/`. | |
| `variants.ts` | **v4 step 1.** Every viable moveset of every piece against its default, 1v1, vs the meaningful opponents. Keeps a variant only on ≥ 2 drastic gains and gains ≥ losses; also tests the Dunsparce splits and shadow toggles. | `universe2.json`, `meta3-out.json`, `teams2.txt` → `variants.json`, `variants.md` |
| `universe3.ts` | universe2 plus the 73 kept variants (236 pieces). Old cells are copied and spot-checked, new rows and columns played. | `universe2.json`, `variants.json` → `universe3.json` |
| `meta4.ts` | **v4 step 2.** Double oracle over all 2.1M teams of universe3: the check (replay meta3's pool), then per round the 1v1 prefilter with an ABA penalty, 4,000 top + 500 random proposals, a ridge-corrected second wave of 1,000, and growth. Bundle with esbuild first (see the header). | `universe3.json`, `meta3-out.json`, `variants.json` → `meta4-out.json` (`strat`, `share`, `fitEq`, `added`), `meta4.log`, `meta4-memo.tsv` (≈ 600 MB game memo, not committed) |
| `g3run3.ts` | **v4 step 3 input.** The best 300 pool teams on their best lead, plus the v3 ranking and the user's team, play the meta4 equilibrium (92% of share) and the log, with lines. 10 shards. | `meta4-out.json` → `g3c-<shard>.json` (≈ 60 MB, not committed) |
| `sum3.py` | **v4 step 3.** Plain vs deduplicated scores, breadth, worst cluster, ABA flag, lead mix, and the top-10 cluster check. Run from `data/`; the argument is the log exponent (default 0.5). | `g3c-*.json` → `top100-v4.md`, `leadmix-v4.md`, `ranking-v4.json`, stdout (`dedup-check.txt`) |
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

### v4 (eighteenth session): moveset variants, 2.1M candidate teams, deduplicated scoring

**Step 1, variants (`data/variants.md`).**
- 3,122 alternative movesets were tested and 73 kept; the rest fold into their default as aliases (`variants.json`).
- The README's literal test ("moves ≥ 150 and crosses 500") kept 1,245, because a strictly worse set also "changes" many matchups. So only *gains* count, and a set may not lose more drastic matchups than it gains (136 → 73).
- Both Dunsparce splits pass (Astonish 3, Rollout 4 drastic matchups vs Bite). Every one of the 29 shadow / non-shadow pairs tests distinct.
- Kept examples: Clodsire Earthquake (flips Azumarill, Rillaboom), Kanto Ninetales Psyshock (Altaria, both Annihilape, Machamp), Empoleon Metal Sound / Hydro Cannon / Drill Peck (Jumpluff, Chesnaught ×3), Shadow Snorlax Outrage, Araquanid Mirror Coat.
- Not kept: Altaria Peck (gains 2, loses 3), Annihilape Counter (no gains on any set), Bellibolt Sucker Punch (gains 2, loses 4). The last matches the user's own sims.

**Step 2, the large run (`data/meta4.log`).**
- **Check passed:** meta4 replays meta3's 642 strategies and reproduces the top 5 shares exactly (9.36 / 8.48 / 8.43 / 5.59 / 5.43%).
- **The prefilter was wrong, by the README's own test.** In round 1 (`meta4-run1.log`, before the fix), the best additions came from prefilter rank #3,910 of 4,000 (median #2,075). Across the 4,500 wave-1 teams the 1v1 score still correlates 0.70–0.74 with the 3v3 result, but it misses whole cores. **Fix:** each round, a ridge fit (`result ≈ prefilter + per-piece terms`) on that round's wave-1 results re-ranks all 2.1M teams, and the top 1,000 new ones are played as wave 2.
  - Wave 2 beat wave 1 every round:

    | Round | Wave 1 (4,500 teams) > 51% | Wave 2 (1,000 teams) > 51% |
    |---|---|---|
    | 1 | 794 | 890 |
    | 2 | 103 | 199 |
    | 6 | 5 | 27 |

  - 172 of the 214 added teams came from wave 2, from prefilter ranks as deep as #1,022,830.
  - What the 1v1 model undervalues: Snorlax (both, Outrage included), Shadow Houndoom, Shadow Hydreigon, Guzzlord, Umbreon cores.
  - The random sample never produced a top-50 proposal (best 49.7–52.3%), so the wave-1 prefilter still separates its top from the bulk.
- **Not converged, stopped at the 6-round cap.** The best outside team fell from 56.6% to 53.2%, 52.6%, 52.2%, 51.9% and 51.7%, still above the 0.5% stop line.
  - Final: 428 teams, 1,284 strategies, support 74, in-pool edge 0.08%.
  - About 40–90 min per round; the machine ran throttled at ~650–800% CPU.
- **The equilibrium is now far flatter.** The top share is 4.2%, against 9.4% in v3:

  | Team | Share |
  |---|---|
  | Mimikyu / S. Houndoom / Cramorant | 4.2% |
  | Cramorant / Rillaboom / Carbink | 4.2% |
  | S. Ninetales (Weather Ball / Energy Ball) / Melmetal / Umbreon | 3.7% |
  | Stunfisk / Walrein / Carbink | 3.1% |
  | Greninja / Charjabug / Mimikyu | 2.9% |
  | Mimikyu / Marowak / Guzzlord | 2.9% |

  - Every v3 top-5 team dropped out of the support. The user's team (every lead) has share 0, though it still scores 49% in value against the mix.

**Step 3, ranking (`data/top100-v4.md`, lead mix in `data/leadmix-v4.md`, check in `data/dedup-check.txt`).** 334 teams, ranked by the deduplicated `0.6 × eq win + 0.4 × log win`.

| # (dedup / plain) | Team | Eq win | Log win plain → dedup | Breadth | Worst cluster |
|---|---|---|---|---|---|
| 1 / 1 | **Mimikyu / Umbreon / Empoleon (Metal Sound, Hydro Cannon, Drill Peck)** | 57% | 88% → 86% | 77/102 | 0.39 |
| 2 / 2 | Melmetal / Azumarill / Charjabug | **62%** | 76% → 75% | 75/111 | 0.35 |
| 3 / 5 | Mimikyu / S. Houndoom / Cramorant | 61% | 75% → 75% | 65/102 | 0.37 |
| 4 / 3 | Mimikyu / Walrein / Marowak | 53% | 88% → 84% | 75/105 | **0.40** |
| 5 / 4 | Melmetal / Talonflame / Jumpluff | 54% | 87% → 84% | 72/100 | 0.34 |
| 7 / 15 | Mimikyu / Cramorant / Chesnaught | 58% | 71% → 75% | **84/120** | 0.37 |
| 41 / 29 | Mimikyu / S. Talonflame / Rillaboom (v3 pick) | 48% | 82% → 79% | 75/108 | 0.39 |
| 327 / 328 | S. Hydreigon / Dondozo / Clodsire (user's team, best lead) | 37% | 42% → 48% | 50/100 | 0.38 |

**What the ranking means:**
- **Value against the equilibrium is still flat:** 49.3–50.7% for the whole top 30. Separation is win rate, the log, breadth and the worst cluster.
- **Deduplication moves the middle, not the top.**
  - The top 2 are unchanged and 48 of the top 100 move ≥ 10 places.
  - Teams that pile up wins against one shell lose ground, e.g. the Melmetal/Altaria/X log cluster (12 teams) and the Mimikyu/Marowak/X equilibrium cluster.
  - Teams with broad, scattered wins rise: Cramorant / Rillaboom / Carbink 45 → 19, Mimikyu / Cramorant / Chesnaught 15 → 7.
- **The equilibrium side cannot change with this definition.** A cluster counted once at its summed share with its share-weighted value is the plain average again. Only the win rate moves (cluster won or lost as a whole), plus breadth and worst cluster. The log side is where deduplication bites.
- **The exponent knob barely changes the top.** Exponent 0 (one vote per cluster) keeps the same top 3 as 0.5. Mimikyu / Cramorant / Araquanid then moves up to #4, and Melmetal / Talonflame / Jumpluff drops out of the top 5.
- **The merged clusters do play alike.** The top-10 check prints the three largest per team: e.g. 18 Mimikyu-shell equilibrium teams at value 0.53 for #1, and 11 Melmetal/Dunsparce/X log teams at 0.58 for #2.
- **The user's team falls badly against this equilibrium.** It went from 54% to 37% eq win, because the new meta is built on Snorlax, Houndoom, Umbreon and Empoleon variants.
  - This is the model's view. The log is still the user's real opponents, and there it is 42% plain, 48% deduplicated.
  - It is worth checking against the user's experience before acting on it (see their memory: their play reports have been right every time).
- **ABA is a penalty, not a cut.** The `ABA` column lists meaningful opponents that both the lead and the usual closer lose to 1v1. #1, #2, #4 and #6 have none; #3 has 4 (Melmetal, S. Hydreigon, …).

### v3 (seventeenth session): 163 pieces, 214-team pool

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

## Next session

The v4 steps (variants, large candidate set, deduplication) are done; see Findings. Open items, in order:
- **Finish converging.** The 6-round cap hit at 51.7%. Rerun `meta4.ts` with more rounds; the memo makes earlier rounds free, but the 2.1M-team prefilter still costs 10–30 min per round. Cheaper: prefilter against the support's top 90% of share only.
- **Better prefilter.** The ridge correction finds hits but is weak within its own top slice (out-of-sample correlation 0.1–0.23). Pair terms (synergy between two pieces) are the next step (see the `ponytail:` comment in `meta4.ts`).
- **The user's team.** Ask them whether S. Snorlax, S. Houndoom, Umbreon and Metal Sound Empoleon actually appear in their games. If not, weight the log above the equilibrium for their ranking.
- **Model ceilings (ask the user before lifting any):** voluntary switches after the lead (switch clock, one per fight); `save` shields as a choice beyond the lead; IV spreads other than the default; the engine's own Disguise reset.

## Results files

- v4: `data/top100-v4.md` (ranking, plain vs deduplicated), `data/leadmix-v4.md` (lead plans), `data/ranking-v4.json` (all 334 teams, every figure), `data/dedup-check.txt` (top-10 before/after with merged clusters), `data/variants.md` (kept variants and why), `data/meta4-out.json` (the equilibrium), `data/meta4.log` and `data/meta4-run1.log` (the run, and round 1 before the prefilter fix).
- v3: `data/top100.md`, `data/leadmix.md`, `data/meta3-out.json`.

Regenerate `g3c-*.json` with `g3run3.ts` (10 shards, `UNI=universe3.json`) before running `sum3.py`.

Regenerate `g3b-*.json` with `g3run2.ts` before running `g3sum2.py` or `g3mix.py`.
