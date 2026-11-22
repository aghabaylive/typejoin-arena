# typejoin-arena

A TikTok LIVE arena game. Each viewer becomes a ball showing their profile picture. Balls move on their own (AI), bigger balls eat smaller ones, and gifts add mass and grant abilities. The game renders to a fixed vertical 1080x1920 canvas, meant to be captured as a browser source.

**This step has no TikTok connection.** Everything runs on a fake event source that you drive from a dev panel.

## Run

```bash
npm install
npm run dev
```

- Game: http://127.0.0.1:5173 (press **D** for the dev overlay: FPS, ball count, last 20 events)
- Dev panel (drives FakeSource): http://localhost:8787/dev
- Bridge WebSocket: ws://localhost:8787. To point the game at a different bridge, add `?bridge=ws://host:port` to the game URL.

For OBS, add a Browser Source at 1080x1920 pointing at the game URL.

### Record a lively 3-minute clip without real viewers
1. Open the game and /dev.
2. Click **Add N viewers** with N = 30.
3. Click **Lively clip preset**. This turns on background joins, likes and gifts.
4. During play, fire a Black Hole and a few Spike Shots by hand.
5. Each new round needs fresh joins. The background join rate covers this, or click **All fake viewers type join again**.

## Real TikTok LIVE

```bash
SOURCE=tiktok TIKTOK_USERNAME=<account> npm run dev
# optional: SIGN_API_KEY=<Euler Stream key> (environment only, never commit it)
```

- **Connection:** the bridge connects with tiktok-live-connector v2 and reconnects with exponential backoff (2 s doubling up to 60 s).
- **Game pause:** while the stream is reconnecting, the game pauses and shows "Reconnecting...", and the round timer stops. After the stream ends it shows "LIVE ended", and the bridge checks every 60 s for the account to go live again.
- **Errors:** signing and rate-limit errors from the Euler Stream sign server are logged clearly. Without `SIGN_API_KEY` the free community tier is used.
- **Event mapping:**
  - chat becomes chat; join words become join through the normalizer.
  - like becomes like with the per-message delta.
  - gift becomes gift with only the new units of a streak; the coin price comes from the catalog.
  - follow and share pass through.
  - The TikTok numeric user id is the stable `userId`. Profile pictures are loaded through the bridge's `/avatar` proxy.
- **Dev panel:** in TikTok mode, http://localhost:8787/dev is a read-only live event feed. Fake viewers, likes and gifts cannot be injected (`/dev/cmd` returns 403). In-game bots are unchanged.
- **Recording fixtures:** `npm run tiktok:record -w bridge -- <account> [seconds]` saves anonymized sample payloads to `bridge/test/fixtures/`.

### Host panel: http://localhost:8787/host (local machine only)
- Alive players with picture and name, and a **Remove and ban** button. Bans are stored in `data/bans.json`, and banned users' events are dropped by the bridge, so they can never rejoin. Banned users are listed with an Unban button.
- Pause, resume and restart round.
- **Gift legend toggle:** "Full legend", or "Off". Off leaves the bottom-right zone empty for TikTok LIVE Studio's Viewer Wishes bar and shows "Any gift = grow" under the top bar. The default is `CONFIG.ui.legend` (`"full"`). The bridge re-applies the last choice when the game reconnects.
- Stats: event counts, delays, avatar cache and source errors.
- **Name filter:** put words in `data/name-filter.json` as `{ "words": ["..."] }`, or in the `NAME_FILTER` env var (comma separated). A nickname containing any of them is shown as "player". Matching ignores case, accents, separators and common digit swaps (0 for o, 1 for i, 3 for e, and so on).

### Avatar proxy: `GET /avatar?url=...`
Only https URLs on TikTok CDN hostnames are fetched (allowlist; redirects are re-checked). Images are resized to 128 px and kept in a memory LRU of 500. Any failure returns 404, and the game shows initials.

### Event log
Every normalized event is appended to `logs/events-YYYY-MM-DD.jsonl` (gitignored). Events from banned users are logged with `"dropped": "banned"`.

## Gift catalog

```bash
npm run gifts:fetch -- <tiktokUsername>   # the account must be LIVE right now
```

Reads the room's gift list and writes `shared/gift-catalog.json` (id, name, coins, imageUrl; sorted by coins). Each icon is downloaded once into `game/public/gifts/<id>.<ext>`, so the game never loads gift images from TikTok at runtime. The legend and the dev panel's gift buttons use the catalog. `tiktok-live-connector` v2 signs the gift-list request through Euler Stream, which needs a paid key (`SIGN_API_KEY`). Without a key, the script falls back to TikTok's public webcast gift-list endpoint for the same room.

## Balance harness

```bash
npm run sim:balance                       # 20 rounds x viewer pools 20/50/100, headless
npm run sim:balance -- --label try1 --set contact.rate=0.2 --set ball.decayPerSec=0.02
```

Prints a table and saves JSON to `docs/balance/<label>.json`. See `docs/balance/README.md` for the viewer model and the latest results.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Layout

```
shared/  normalized event types, gift-catalog.json (real TikTok gifts), gift-map.json (ability -> gift id)
bridge/  Node + ws
  src/sources/EventSource.ts  EventSource interface + raw (TikTok-shaped) event types
  src/sources/FakeSource.ts   the only source for now
  src/normalize.ts            join aliases, gift streak deltas (exactly-once units)
  src/server.ts               WS broadcast, /dev panel, /dev/state, /dev/cmd (future /avatar seam)
  public/dev.html             dev panel
game/    Vite + PixiJS v8
  src/config.ts   ALL tunable numbers
  src/sim/        rendering-independent simulation (fixed 60 Hz)
  src/render/     PixiJS drawing, effects, HUD, legend, overlays, avatar loader
  src/net/        bridge WebSocket client
```

### Seams for later steps
- **TikTokSource**: implement `EventSource` (`bridge/src/sources/EventSource.ts`) and emit `RawSourceEvent`s. Gifts use TikTok's cumulative `repeatCount`/`repeatEnd`, and the normalizer turns them into deltas. Select the source in `bridge/src/index.ts` (env `EVENT_SOURCE`).
- **Avatar proxy**: the game already loads `CONFIG.net.avatarProxy + encodeURIComponent(url)` (`http://localhost:8787/avatar?url=`). Mount the route in `bridge/src/server.ts` where marked. Any failure falls back to initials.
- **Gift abilities**: edit `shared/gift-map.json` (ability -> real gift id from `shared/gift-catalog.json`). A mapped id missing from the catalog logs a warning in the game console and shows a placeholder icon in the legend.
- **Database / moderation**: the session leaderboard is `game/src/sim/leaderboard.ts` (memory only). All viewer input enters through `Sim.handleEvent`.

## Rule notes (choices made where the spec was open)
- A chat message that matches a join alias becomes a `join` event *instead of* a `chat` event.
- During the join window, balls move and eat pellets but cannot damage each other. Abilities bought then are held and fire when play starts. Their mass is added immediately.
- A gift sent during the 5 s rejoin cooldown is queued. The ball auto-spawns when the cooldown ends, then the gift is applied. Gifts sent during the results screen are applied at the start of the next round, so no gift is ever lost. In both cases a toast under the top bar confirms it (e.g. "@name: Shield ready next round").
- Gifts give 5 mass per coin.
- Contact damage: `B.loss = min(B.mass, rate * min(A.mass, 4 * B.ref) * dt)` with `rate` 0.15, where `B.ref` is B's mass when the fight started (held while contact continues). Using the start-of-fight mass keeps the drain linear, so even a huge ball needs about 1.7 s (`1 / (rate * 4)`) to finish a fresh ball; a cap based on B's *current* mass would decay exponentially and never quite finish. While a bigger ball eats a smaller one, the victim is drawn being pulled into the eater's center.
- One mouth at a time: a ball damages only one victim, the contact it has overlapped longest, and keeps it until it dies or contact breaks. Its other contacts only push. After a kill the eater digests for 1.5 s: it deals no damage but takes damage normally. Split pieces are separate balls, so each piece has its own mouth.
- Alive cap: at most 60 real players have balls. Further joins wait in a FIFO queue, shown in the top bar ("Queue: N", then the next 3 names in turn). A freed slot spawns the next in line. A gift from a queued (or not yet joined) viewer moves them to the front and applies when they spawn. Players still queued at the end of a round spawn first in the next one.
- Storm: Magnet and Black Hole ranges scale with the safe radius (`range * safeRadius / arenaRadius`). Pellets respawn only inside the safe zone, at up to 300/s.
- Mass decay above 500: 1 %/s.
- Crowding: when all balls together cover more than 40 % of the arena (during the storm: of the current safe zone), every radius shrinks by the same factor (smoothly, never below 0.5x). Rules use mass; only drawn and collision size change.
- Pellet target = 150 + 2 per real player in the arena, max 400.
- Shield and Magnet extend per unit, capped at 60 s. Dash extends per unit, capped at 10 s. Black hole gives 5 s for the first unit and +2 s per extra unit, capped at 10 s.
- Split pieces share their owner's ability timers. Kills and revenge count only when the owner's last piece dies. Pieces merge on contact after 12 s, and are forced together 3 s after that.
- The storm shrinks a safe zone inside the arena. Balls can still enter the red ring, but they take 5 %/s damage there.
- Live top 3, King, and titles consider real players only. Bots can eat and get kills, but never win titles.
