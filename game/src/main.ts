import { Application } from 'pixi.js';
import { missingMappedGifts } from '@typejoin/shared';
import { CONFIG } from './config';
import { Sim } from './sim/Sim';
import { Renderer } from './render/Renderer';
import { BridgeClient } from './net/BridgeClient';
import { DevOverlay } from './devOverlay';

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
const renderer = new Renderer(app);
const dev = new DevOverlay();

const bridge = new BridgeClient(params.get('bridge') ?? CONFIG.net.bridgeUrl, (e) => {
  sim.handleEvent(e);
  dev.log(e);
});
bridge.start();

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
  while (acc >= step && n < CONFIG.sim.maxStepsPerFrame) {
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
    bridge: `${bridge.status} (${bridge.source})`,
  });
});

// Handy for debugging in the browser console.
(window as unknown as { sim: Sim }).sim = sim;
