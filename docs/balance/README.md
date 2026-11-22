# Balance runs

Produced by `npm run sim:balance` (`game/src/balance/balance.ts`). The harness drives the real `Sim` through `handleEvent` only, headless, at maximum speed.

Since round 8 the game has no rounds: the harness runs **3 continuous 30-minute runs per scenario** (seeds 1, 2, 3), measured in 5-minute windows (`leaderboard.windowSec`). Rounds 1–7 below used 20 rounds per scenario with the viewer model described in their own sections.

## Viewer model (continuous runs, round 8 onward)
- **Viewer pool:** 20, 50 or 100 viewers. Each types join at a random moment in the first 2 minutes. Nobody joins from outside the pool.
- **Gift roles:** fixed for the whole run.
  - About 83 % never gift.
  - 10 % send 1–5 Roses (Dash, 1 coin each) once per window.
  - 4 % send one 100-coin Spike Shot once per window.
  - 3 % send one Doughnut (Shield, 30 coins) once per window.
  - One whale sends a 500-coin Magnet between 1:00 and 4:00, and a **single** 1000-coin Black Hole between 5:00 and 7:00. Nothing after that.
- **Likes:** a steady 20 likes/s from random pool viewers.
- **After being eaten:** 30 % leave for 2–6 minutes, then type join again. The rest type join again after 5–30 s.

## Metrics (continuous runs)
- **crown chg/5 min:** every visible crown change (`kingChanged` events), including to and from "No king yet", per 5 minutes. Target 1–3.
- **top-3 kills/window, top killer share:** per 5-minute window; share = each window's top killer's kills / all player kills, summed over windows. Target <= 35 %.
- **non-gifter life:** median time alive from spawn to death; lives still running at the end of a run are cut off there. Target >= 30 s.
- **whale top 3:** share of the run time the whale is in the live top 3 by mass.
- **whale King 5 min after BH:** share of the 5 minutes after the whale's Black Hole during which the whale is King.
- **whale mass after gift:** the whale's mass at fixed times after its single 1000-coin gift (mean over runs, 0 when dead), next to the median mass of the alive players.
- **min pellets calm / storm:** info only, no target (see the pellet-floor decision below).

## Pellet floor: accepted by design (decision, round 8)
The play-phase pellet floor (>= 40) is no longer a target. Magnet and Black Hole are paid spectacles, and emptying the arena of pellets for a few seconds is their intended effect. Non-gifter median life is the real target for free players, and it is met. The harness still prints the minimum pellet counts, for information only.

## Round 1-7 results (round-based game)

Viewer model for these runs: 20 rounds per scenario; all pool viewers type join at each round start; gift roles rolled again every round; after being eaten 30 % give up for the round and the rest rejoin after 5–30 s. Metrics were per round (King changes excluded the first crowning; whale top 3 = share of rounds the whale ended in the top 3).

### Results (50-viewer targets: share <= 35 %, median life >= 30 s, King changes >= 2, pellets >= 40)

`before.json` is the code before one-mouth, digestion, the queue and storm scaling:

| viewers | top-3 kills | top killer share | life median | p25 | King changes | lowest pellets |
|---|---|---|---|---|---|---|
| 20 | 65.8 / 9.1 / 5.2 | 69 % | 6.7 s | 4.3 s | 6.1 | 2 |
| 50 | 79.9 / 18.1 / 11.1 | 46 % | 6.6 s | 4.2 s | 8.1 | 2 |
| 100 | 110.8 / 28.1 / 17.4 | 35 % | 6.0 s | 3.8 s | 10.2 | 2 |

`after-mechanics.json` has the new mechanics with the old tuning:

| viewers | top-3 kills | top killer share | life median | p25 | King changes | lowest pellets |
|---|---|---|---|---|---|---|
| 20 | 57.5 / 6 / 3.6 | 71 % | 7.7 s | 4.8 s | 5.5 | 5 |
| 50 | 75.5 / 11.1 / 8.1 | 47 % | 8.7 s | 5.0 s | 7.1 | 5 |
| 100 | 100.1 / 19.6 / 12.5 | 32 % | 8.2 s | 5.0 s | 8.4 | 5 |

`after.json` is tuned with `contact.rate` 0.6 → 0.15 and `ball.decayPerSec` 0.001 → 0.01. Digestion stays at 1.5 s, the cap at 60 and `massPerCoin` at 5:

| viewers | top-3 kills | top killer share | life median | p25 | King changes | lowest pellets |
|---|---|---|---|---|---|---|
| 20 | 23.3 / 4.5 / 3.5 | 54 % | 32.8 s | 11.5 s | 5.9 | 5 |
| 50 | 28.8 / 7.8 / 6.3 | 28 % | 41.4 s | 13.3 s | 4.75 | 7 |
| 100 | 25.9 / 13.2 / 10.3 | 14 % | 34.0 s | 14.0 s | 9.65 | 13 |

## Open trade-off: the pellet floor

(Resolved in round 8: accepted by design. See "Pellet floor" at the top.)
None of the five allowed knobs (`contact.rate`, digestion time, alive cap, `massPerCoin`, decay) lifts the lowest pellet count to 40. A 108-combination grid on the 50-viewer scenario found a best of 20. There are two separate floors:

1. **End of storm.** In the last ~15 s the balls cover 150–175 % of the *safe zone*. The crowding scale backs off to ~0.75 because it measures coverage against the full arena. New pellets spawn inside the safe zone, so they land under balls and are eaten faster than 300/s can replace them.
2. **Start of play.** With high decay the minimum moves to the first seconds of play: about 48 fresh balls sweep the ~250 starting pellets, and the count still bottoms out around 25.

Turning Magnet and Black Hole off entirely, as a diagnostic, still leaves the minimum at 26, so the fields are not the main cause. Getting to 40 needs a mechanic or another config change. Candidates are measuring crowding against the safe area during the storm, or a higher respawn rate. That decision is yours.

## Round 3: gifter metrics and storm crowding (`before-v3.json`, `after-v3.json`)
50-viewer targets:
- whale in the top 3 in at least 60 % of rounds
- whale is King at least 30 % of the time after the Black Hole
- lowest play-phase pellets at least 40
- the three targets already met stay met

`before-v3.json` is the committed code (decay 1 %/s above 500), measured with the new metrics:

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 54 % | 32.8 s | 11.5 s | 25.9 s | 5.9 | 70 % | 72 % | 8 | 5 |
| 50 | 28 % | 41.4 s | 13.3 s | 40.4 s | 4.75 | 60 % | 71 % | 10 | 7 |
| 100 | 14 % | 34.0 s | 14.0 s | 33.2 s | 9.65 | 65 % | 62 % | 24 | 13 |

`after-v3.json` measures crowding against the safe zone during the storm. Decay is unchanged:

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 54 % | 32.9 s | 12.5 s | 32.5 s | 5.35 | 65 % | 77 % | 5 | 5 |
| 50 | 21 % | 42.0 s | 15.5 s | 41.7 s | 8.55 | 75 % | 73 % | 16 | 5 |
| 100 | 12 % | 32.3 s | 13.5 s | 30.7 s | 10.0 | 55 % | 42 % | 20 | 14 |

### Trade-off: the play-phase pellet floor
The decay settings can't fix the play-phase pellet floor. A sweep of `decayPerSec` (0.001–0.05) against `decayAboveMass` (100–2000) never reached 40 reliably. The single 42 it found fell back to 8 and 16 over 20 rounds. In 20-round checks, switching Magnet and Black Hole off raises the play-phase minimum from 14–16 to 80–114. The dips come from those fields: their range (400 and 350 on a 400-radius arena) pulls in nearly every pellet while they are active. Getting to 40 needs a smaller field range during play, a pellet-pull limit, or a faster refill. All of those are outside what this change was allowed to touch. Decay stays at 1 %/s above 500, which meets the other five 50-viewer targets.

## Round 4: real gift catalog (`after-v4-catalog.json`)
No rule or config changes. The harness gift mix keeps the same coin values (1 / 100 / 500 / 1000):
- Rose senders now send the real Rose, which is the **Dash** gift in `shared/gift-map.json`.
- The 100, 500 and 1000-coin roles send the gifts mapped to Spike shot, Magnet and Black hole.

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 48 % | 34.1 s | 12.4 s | 42.9 s | 7.15 | 40 % | 50 % | 9 | 6 |
| 50 | 20 % | 44.1 s | 15.5 s | 45.3 s | 7.6 | 50 % | 62 % | 9 | 10 |
| 100 | 14 % | 34.7 s | 14.8 s | 30.8 s | 7.7 | 50 % | 61 % | 7 | 18 |

Roses granting Dash lets 10 % of viewers hunt for a few seconds. In the 50-viewer scenario the whale now finishes in the top 3 in 50 % of rounds, down from 75 %. That misses the earlier >= 60 % target.

## Round 5: current gift map with Doughnut senders (`v5-rose-doughnut.json`)
- Rose = Dash.
- 3 % of viewers now send one Doughnut (30 coins = Shield). They are taken from the non-gifters, so 82 % never gift.
- No tuning.

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 55 % | 31.7 s | 10.7 s | 28.2 s | 4.5 | 80 % | 74 % | 7 | 7 |
| 50 | 25 % | 45.8 s | 16.8 s | 40.9 s | 7.1 | 70 % | 65 % | 9 | 25 |
| 100 | 18 % | 32.5 s | 13.8 s | 32.4 s | 7.35 | 55 % | 75 % | 7 | 22 |

50 viewers: every target that was met is still met. The play-phase pellet floor (>= 40) was already missed, because of the Magnet and Black Hole range.

## Round 6: no join window, auto-respawn, likes 0.1 each (`v6-anytime-join.json`)
- No join phase: rounds go play, then storm, then results.
- Previous players respawn automatically.
- Viewers type join during the first 8 s of play.
- Likes are worth 0.1 mass each, capped at 1 per second per user.
- No tuning.

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 53 % | 31.1 s | 11.7 s | 45.4 s | 11.65 | 70 % | 80 % | 8 | 5 |
| 50 | 23 % | 47.3 s | 18.1 s | 51.6 s | 16.3 | 70 % | 73 % | 10 | 8 |
| 100 | 14 % | 34.1 s | 15.1 s | 29.1 s | 12.65 | 65 % | 69 % | 23 | 24 |

50 viewers: every target that was met is still met. King changes rose from 7.1 to 16.3 per round: with likes worth far less, early leads are smaller and the crown changes hands more often. The play-phase pellet floor (>= 40) is still missed, as before.

## Round 7: King hysteresis (`v7-king-hysteresis.json`)
- A challenger takes the crown only after having at least 10 % more mass than the King, continuously for 1.5 s (`king.challengeMargin`, `king.challengeSec`).
- No King while the biggest player has under 100 mass (`king.minMass`).
- Screen shake on a King change only when the new King has at least 1000 mass (`king.shakeMinMass`, render only).
- No tuning.

| viewers | top killer share | life non-gifter | p25 | life Rose | King chg | whale top 3 | whale King after BH | min pellets play | min pellets storm |
|---|---|---|---|---|---|---|---|---|---|
| 20 | 52 % | 35.5 s | 12.5 s | 36.6 s | 3.25 | 75 % | 78 % | 6 | 6 |
| 50 | 25 % | 48 s | 18.1 s | 46.1 s | 3.95 | 75 % | 73 % | 9 | 9 |
| 100 | 15 % | 34.8 s | 14.5 s | 37 s | 3.35 | 55 % | 63 % | 19 | 11 |

50 viewers: King changes fall from 16.3 to 3.95 per round (target 3–8). Every other target that was met is still met. The play-phase pellet floor (>= 40) is still missed, as before.

## Round 8: nonstop arena (`v8-nonstop.json`)
- No rounds: no round timer, results screen, reset or auto-respawn.
- Storm event every 4 minutes (shrink to 50 % over 30 s, hold 15 s, expand over 10 s).
- 5-minute scoring windows with a TOP PLAYERS panel.
- Harness: 3 x 30-minute continuous runs per scenario. No tuning.

| viewers | crown chg/5 min | top-3 kills/window | top killer share | life non-gifter | p25 | life Rose | whale top 3 | whale King 5 min after BH | kills/5 min | min pellets calm / storm (info) |
|---|---|---|---|---|---|---|---|---|---|---|
| 20 | 1.22 | 43 / 1.6 / 1.3 | 88 % | 26.5 s | 12.8 s | 19.9 s | 39 % | 33 % | 49.2 | 9 / 30 |
| 50 | 0.44 | 44.9 / 4.7 / 3.9 | 49 % | 53 s | 22.5 s | 53.4 s | 5 % | 0 % | 92.3 | 38 / 32 |
| 100 | 0.44 | 55.8 / 7.9 / 6.4 | 28 % | 46.7 s | 20 s | 46.2 s | 4 % | 0 % | 197.8 | 27 / 26 |

Whale mass after its single 1000-coin gift (mean of 3 runs; runs in which the whale had died by then in brackets) / median alive player:

| viewers | +0 s | +30 s | +1 min | +2 min | +3 min | +5 min | +10 min |
|---|---|---|---|---|---|---|---|
| 20 | 10415 [0] / 45 | 7458 [0] / 44 | 6274 [1] / 46 | 5815 [2] / 2226 | 4751 [2] / 83 | 4344 [2] / 66 | 4206 [2] / 40 |
| 50 | 5058 [0] / 36 | 104 [2] / 49 | 19 [2] / 42 | 28 [3] / 54 | 38 [3] / 41 | 77 [3] / 41 | 5 [3] / 58 |
| 100 | 5118 [0] / 50 | 4777 [1] / 39 | 465 [2] / 42 | 29 [2] / 54 | 3 [3] / 49 | 15 [3] / 42 | 97 [3] / 50 |

50 viewers: non-gifter median life (53 s) is met. **Crown changes (0.44 per 5 min, target 1–3) and top killer share (49 %, target <= 35 %) are missed.**

Why: without a reset, one free player becomes a permanent giant. In both 50-viewer runs inspected, a non-gifter took the crown within the first minute and held it for the entire 30 minutes at about 18–21k mass (usually split into several pieces), killing 40–80 players per window. 1 %/s decay above 500 does not bring it down: pellets respawn at up to 300/s and the giant eats most of them, so its mass settles where decay equals that intake (about 300 / 0.01 = 30k at most, about 20k in practice). Rounds used to cut this off every 3.75 minutes.

The whale: a single 1000-coin gift (+5000 mass) is far below the giant, so at 50 and 100 viewers the whale is usually eaten within 30 s to 2 minutes of its Black Hole. When it survives (20 viewers), decay brings it from about 10k down to about 4–5k within 3 minutes, and it then stays there (pellet intake again). The 20-viewer row is dominated by a single giant too (88 % top killer share).
