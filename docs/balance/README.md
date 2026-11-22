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
