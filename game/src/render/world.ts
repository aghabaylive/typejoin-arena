import { Container, Graphics, Sprite } from 'pixi.js';
import { CONFIG } from '../config';
import type { Sim } from '../sim/Sim';
import { hashString } from '../sim/util';
import type { Textures } from './textures';

const PELLET_COLORS = [0xff5b8a, 0xffd23d, 0x3dffb0, 0x3dc8ff, 0xb98bff, 0xff9a3d];

/** Static backdrop: navy, subtle hex grid, vignette. */
export function makeBackground(tex: Textures): Container {
  const c = new Container();
  const { width, height } = CONFIG.canvas;
  const R = CONFIG.render;
  c.addChild(new Graphics().rect(0, 0, width, height).fill(R.bg));
  const g = new Graphics();
  const s = R.hexSize;
  const hw = Math.sqrt(3) * s;
  for (let row = -1; row * s * 1.5 < height + s; row++) {
    for (let col = -1; col * hw < width + hw; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0);
      const cy = row * s * 1.5;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }
  }
  g.stroke({ width: 2, color: R.hexColor, alpha: 0.55 });
  c.addChild(g);
  const v = new Sprite(tex.vignette);
  v.width = width;
  v.height = height;
  c.addChild(v);
  return c;
}

export class ArenaLayer {
  readonly floor = new Graphics();
  readonly storm = new Graphics();
  readonly rim = new Graphics();
  readonly pellets = new Container();
  readonly spikes = new Container();
  readonly projectiles = new Container();
  private pelletSprites = new Map<number, Sprite>();
  private pelletPool: Sprite[] = [];
  private spikeSprites = new Map<number, Sprite>();
  private projSprites = new Map<number, Sprite>();

  constructor(private tex: Textures) {
    const { cx, cy, radius } = CONFIG.arena;
    this.floor.circle(cx, cy, radius).fill({ color: 0x0f1a42, alpha: 0.85 });
    // inner rings for depth
    for (let i = 1; i <= 3; i++) this.floor.circle(cx, cy, (radius * i) / 4).stroke({ width: 2, color: 0x24346e, alpha: 0.5 });
  }

  update(sim: Sim, now: number, dt: number, onTrail: (x: number, y: number) => void): void {
    this.drawRimAndStorm(sim, now);
    this.drawPellets(sim);
    this.drawSpikes(sim, now, dt);
    this.drawProjectiles(sim, dt, onTrail);
  }

  private drawRimAndStorm(sim: Sim, now: number): void {
    const { cx, cy, radius } = CONFIG.arena;
    const storm = sim.stormActive();
    const pulse = storm ? 0.5 + 0.5 * Math.sin(now * 6) : 0.5 + 0.5 * Math.sin(now * 1.5);
    const color = storm ? CONFIG.render.stormColor : CONFIG.render.rimColor;
    this.rim.clear();
    for (let i = 4; i >= 1; i--) {
      this.rim.circle(cx, cy, radius + i * 4).stroke({ width: i * 8, color, alpha: 0.05 + 0.04 * pulse });
    }
    this.rim.circle(cx, cy, radius).stroke({ width: 6, color, alpha: 0.85 + 0.15 * pulse });
    this.storm.clear();
    if (storm) {
      const safe = sim.safeRadius();
      this.storm.circle(cx, cy, radius).fill({ color: CONFIG.render.stormColor, alpha: 0.18 + 0.1 * pulse });
      this.storm.circle(cx, cy, safe).cut();
      this.storm.circle(cx, cy, safe).stroke({ width: 5, color: 0xffffff, alpha: 0.5 + 0.4 * pulse });
    }
  }

  private drawPellets(sim: Sim): void {
    const seen = new Set<number>();
    for (const p of sim.pellets) {
      seen.add(p.id);
      let s = this.pelletSprites.get(p.id);
      if (!s) {
        s = this.pelletPool.pop() ?? new Sprite(this.tex.dot);
        s.anchor.set(0.5);
        s.tint = PELLET_COLORS[hashString(String(p.id)) % PELLET_COLORS.length];
        s.visible = true;
        this.pellets.addChild(s);
        this.pelletSprites.set(p.id, s);
      }
      const r = Math.min(26, CONFIG.pellets.radius * (1 + 0.35 * Math.sqrt(Math.max(0, p.value - 1))));
      const age = sim.time - p.born;
      let y = p.y;
      let a = 1;
      if (p.kind === 'feast' && age < 0.45) {
        const k = 1 - age / 0.45; // rain drop-in
        y -= k * k * 260;
        a = 1 - k * 0.7;
      } else if (age < 0.2) a = age / 0.2;
      s.position.set(p.x, y);
      s.width = s.height = r * 2.4;
      s.alpha = a;
    }
    for (const [id, s] of this.pelletSprites) {
      if (seen.has(id)) continue;
      this.pellets.removeChild(s);
      this.pelletPool.push(s);
      this.pelletSprites.delete(id);
    }
  }

  private drawSpikes(sim: Sim, now: number, dt: number): void {
    for (const sp of sim.spikes) {
      let s = this.spikeSprites.get(sp.id);
      if (!s) {
        s = new Sprite(this.tex.spike);
        s.anchor.set(0.5);
        this.spikes.addChild(s);
        this.spikeSprites.set(sp.id, s);
      }
      s.visible = sp.active;
      if (!sp.active) {
        s.alpha = 0;
        continue;
      }
      s.alpha = Math.min(1, s.alpha + dt * 3);
      s.position.set(sp.x, sp.y);
      const size = CONFIG.spikes.radius * 2 * (1 + 0.06 * Math.sin(now * 4 + sp.id));
      s.width = s.height = size;
      s.rotation += dt * 0.6;
    }
  }

  private drawProjectiles(sim: Sim, dt: number, onTrail: (x: number, y: number) => void): void {
    const seen = new Set<number>();
    for (const p of sim.projectiles) {
      seen.add(p.id);
      let s = this.projSprites.get(p.id);
      if (!s) {
        s = new Sprite(this.tex.spike);
        s.anchor.set(0.5);
        s.width = s.height = CONFIG.abilities.spikeShot.radius * 2.4;
        this.projectiles.addChild(s);
        this.projSprites.set(p.id, s);
      }
      s.position.set(p.x, p.y);
      s.rotation += dt * 14;
      onTrail(p.x, p.y);
    }
    for (const [id, s] of this.projSprites) {
      if (seen.has(id)) continue;
      s.destroy();
      this.projSprites.delete(id);
    }
  }
}
