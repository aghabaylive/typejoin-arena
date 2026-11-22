import { Application } from 'pixi.js';
import { missingMappedGifts } from '@typejoin/shared';
import { CONFIG } from './config';
import { Sim } from './sim/Sim';
import { Renderer } from './render/Renderer';
import { BridgeClient } from './net/BridgeClient';
import { DevOverlay } from './devOverlay';
import { overlayText } from './net/overlay';

const params = new URLSearchParams(location.search);
const { width, height } = CONFIG.canvas;

const app = new Application();
await app.init({
  width,
  height,
  background: CONFIG.render.bg,
  antialias: true,
  resolution: 1,
  autoDensity: false,
  preference: 'webgl',
});
const stage = document.getElementById('stage')!;
stage.appendChild(app.canvas);

/** Fixed 1080x1920 logical canvas, scaled to fit the window with letterboxing. */
function fit(): void {
  const s = Math.min(window.innerWidth / width, window.innerHeight / height);
  app.canvas.style.width = `${Math.floor(width * s)}px`;
  app.canvas.style.height = `${Math.floor(height * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// Mapped ability gifts that are not real catalog gifts: warn loudly (their legend row shows a placeholder icon).
for (const m of missingMappedGifts()) {
  console.warn(`[gifts] ${m.ability} is mapped to gift id ${m.giftId}, which is not in shared/gift-catalog.json. ` +
    'Its legend row shows a placeholder icon. Pick a real gift id in shared/gift-map.json (run npm run gifts:fetch first).');
}

const sim = new Sim({ seed: Number(params.get('seed') ?? Date.now() % 1e9) });
// Lilita One is bundled locally (public/fonts); load it before any text or bitmap font is created.
try {
  await Promise.race([document.fonts.load(`48px ${CONFIG.render.titleFont}`), new Promise((r) => setTimeout(r, 3000))]);
} catch {
  // fall back to the next font in the stack
}
const renderer = new Renderer(app);
const dev = new DevOverlay();

/** Bridge receive -> handled by the sim (ms), reported to the host panel. */
const delay = { count: 0, sumMs: 0, maxMs: 0 };
let hostPaused = false;

const bridge = new BridgeClient(
  params.get('bridge') ?? CONFIG.net.bridgeUrl,
  (e) => {
    const d = Math.max(0, Date.now() - e.ts);
    delay.count++;
    delay.sumMs += d;
    delay.maxMs = Math.max(delay.maxMs, d);
    sim.handleEvent(e);
    dev.log(e);
  },
  (a) => {
    if (a.action === 'pause') hostPaused = true;
    else if (a.action === 'resume') hostPaused = false;
    else if (a.action === 'restartRound') sim.restartRound();
    else if (a.action === 'legend') renderer.setLegendMode(a.mode);
    else if (a.action === 'remove') sim.removePlayer(a.userId);
  },
);
bridge.start();

/** Stream not live yet / reconnecting / ended, or host pause: banner shown, world and round timer stopped. */
const currentOverlay = () => overlayText({ bridgeOpen: bridge.status === 'open', sourceState: bridge.sourceState, hostPaused });

// Alive players + delay stats for the host panel, once a second.
setInterval(() => {
  const players = new Map<string, { userId: string; nickname: string; avatarUrl?: string; mass: number }>();
  for (const b of sim.balls) {
    if (b.isBot) continue;
    const p = sim.players.get(b.ownerId);
    const cur = players.get(b.ownerId) ?? { userId: b.ownerId, nickname: p?.nickname ?? b.ownerId, avatarUrl: p?.avatarUrl, mass: 0 };
    cur.mass += b.mass;
    players.set(b.ownerId, cur);
  }
  bridge.send({
    kind: 'players', players: [...players.values()], queued: sim.joinQueue.length, phase: sim.phase, roundNo: sim.roundNo,
    paused: currentOverlay() !== null, legend: renderer.legendMode, delay: { ...delay },
  });
  delay.count = delay.sumMs = delay.maxMs = 0;
}, 1000);

// Fixed-timestep simulation (60 Hz) decoupled from rendering; render interpolates.
const step = 1 / CONFIG.sim.hz;
let acc = 0;
let simMs = 0;
let renderMs = 0;
app.ticker.add((t) => {
  const dt = Math.min(0.25, t.deltaMS / 1000);
  acc += dt;
  let n = 0;
  const t0 = performance.now();
  const overlay = currentOverlay();
  const paused = overlay !== null;
  if (paused) acc = 0;
  renderer.setBanner(overlay);
  while (!paused && acc >= step && n < CONFIG.sim.maxStepsPerFrame) {
    sim.step(step);
    acc -= step;
    n++;
  }
  if (n === CONFIG.sim.maxStepsPerFrame) acc = 0;
  simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
  const t1 = performance.now();
  renderer.render(sim, acc / step, dt);
  renderMs = renderMs * 0.9 + (performance.now() - t1) * 0.1;
  dev.update({
    FPS: app.ticker.FPS.toFixed(0),
    'sim ms/frame': simMs.toFixed(2),
    'render ms/frame (JS)': renderMs.toFixed(2),
    phase: `${sim.phase} (round ${sim.roundNo}) ${sim.phaseTimeLeft().toFixed(0)}s`,
    balls: sim.balls.length,
    players: sim.balls.filter((b) => !b.isBot).length,
    bots: sim.balls.filter((b) => b.isBot).length,
    pellets: `${sim.pellets.length} (target ${sim.pelletTarget()})`,
    'size scale': sim.sizeScale.toFixed(2),
    particles: renderer.particleCount,
    bridge: `${bridge.status} (${bridge.source}: ${bridge.sourceState}${bridge.sourceDetail ? `, ${bridge.sourceDetail}` : ''})`,
    paused: hostPaused ? 'host' : overlay ?? 'no',
  });
});

// Handy for debugging in the browser console.
(window as unknown as { sim: Sim }).sim = sim;
