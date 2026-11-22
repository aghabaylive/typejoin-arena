# Balance runs

Produced by `npm run sim:balance` (`game/src/balance/balance.ts`). The harness drives the real `Sim` through `handleEvent` only, headless, at maximum speed. It runs 20 rounds per scenario with seed 1.

## Viewer model (per scenario)
- **Viewer pool:** a fixed pool of 20, 50 or 100 viewers. All of them type join during each join window. Nobody joins from outside the pool.
- **Gift roles:** rolled again every round.
  - 85 % never gift.
  - 10 % send 1–5 Roses (1 coin each).
  - 4 % send one 100-coin Spike Shot.
  - One whale sends a 500-coin Magnet and a 1000-coin Black Hole.
  - Gifts arrive at random times during join, play and storm.
- **Likes:** a steady 20 likes/s from random pool viewers.
- **After being eaten:** 30 % give up for the round. The rest type join again after a random 5–30 s.

## Metrics
- **whale top 3:** share of rounds in which the whale (the 1000-coin gifter) is in the live top 3 by mass when the round ends.
- **whale King after BH:** share of the time from the whale's 1000-coin gift to the end of the round during which the whale is King.
- **Rose life:** median combat lifetime of Rose senders, measured the same way as non-gifter life.
- **min pellets play / storm:** the lowest pellet count, reported separately for the play phase and the storm.
- **top-3 kills:** average per round.
- **top killer share:** the top killer's kills divided by all kills, summed over rounds.
- **non-gifter life:** time alive in combat, from play start or spawn to death. Lives still alive at round end are cut off there.
- **King changes:** King handovers during play and storm. The first crowning of a round does not count.
- **lowest pellets:** the minimum pellet count seen during play and storm.

## Results (50-viewer targets: share <= 35 %, median life >= 30 s, King changes >= 2, pellets >= 40)

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
