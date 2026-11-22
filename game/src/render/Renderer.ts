import { Container, Graphics, Sprite, type Application } from 'pixi.js';
import { CONFIG, tierColor } from '../config';
import type { Sim } from '../sim/Sim';
import type { SimEvent } from '../sim/types';
import { AvatarCache } from './avatars';
import { BallLayer, easeOutBack } from './balls';
import { Floaters, Particles } from './effects';
import { Hud, makeLegend } from './hud';
import { Overlays } from './overlays';
import { Toasts } from './toasts';
import { formatMass } from './text';
import { Textures } from './textures';
import { ArenaLayer, makeBackground } from './world';

const ABILITY_TEXT: Record<string, [string, number]> = {
  dash: ['DASH!', 0x3dd6ff],
  shield: ['SHIELD!', 0x3dff9b],
  spikeShot: ['SPIKE SHOT!', 0xff5b5b],
  magnet: ['MAGNET!', 0xb05bff],
  blackHole: ['BLACK HOLE!', 0xffc83d],
};

/** Reads the simulation each frame and draws it. Holds no game logic. */
export class Renderer {
  readonly tex = new Textures();
  readonly avatars = new AvatarCache();
  private arena: ArenaLayer;
  private balls: BallLayer;
  private particles = new Particles();
  private floaters = new Floaters();
  private hud: Hud;
  private overlays: Overlays;
  private toasts = new Toasts();
  private crown: Sprite;
  private flash = new Graphics();
  private crownState = { owner: null as string | null, x: 540, y: 300, fromX: 540, fromY: 300, flyT: 1, flashT: 1 };
  private now = 0;
  private trailAcc = 0;

  constructor(app: Application) {
    const stage = app.stage;
    this.arena = new ArenaLayer(this.tex);
    this.balls = new BallLayer(this.tex, this.avatars);
    this.hud = new Hud(this.tex, this.avatars);
    this.overlays = new Overlays(this.tex, this.avatars);
    this.crown = new Sprite(this.tex.crown);
    this.crown.anchor.set(0.5, 1);
    this.crown.visible = false;
    // Ability fields (magnet / black hole) must not spill over the HUD and legend.
    const fieldMask = new Graphics().circle(CONFIG.arena.cx, CONFIG.arena.cy, CONFIG.arena.radius + 24).fill(0xffffff);
    this.balls.fields.mask = fieldMask;
    const world = new Container();
    world.addChild(fieldMask);
    world.addChild(
      this.arena.floor,
      this.balls.fields,
      this.arena.pellets,
      this.arena.spikes,
      this.balls.bodies,
      this.arena.storm,
      this.arena.rim,
      this.balls.labels,
      this.arena.projectiles,
      this.particles.container,
      this.crown,
      this.flash,
      this.floaters.container,
    );
    stage.addChild(makeBackground(this.tex), world, this.hud.root, makeLegend(), this.overlays.root, this.toasts.root);
  }

  render(sim: Sim, alpha: number, dt: number): void {
    this.now += dt;
    const now = this.now;
    for (const e of sim.drainEvents()) this.onEvent(sim, e);
    this.balls.update(sim, alpha, now, dt);
    this.trailAcc += dt;
    const emitTrail = this.trailAcc > 1 / 60;
    if (emitTrail) this.trailAcc = 0;
    this.arena.update(sim, now, dt, (x, y) => {
      if (emitTrail) this.particles.spawn(this.tex.softDot, x, y, { tint: 0xff5b5b, scale: 0.7, life: 0.35, alpha: 0.8 });
    });
    this.dashTrails(sim);
    this.blackHoleSuck(sim, dt);
    this.updateCrown(sim, dt);
    this.particles.update(dt);
    this.floaters.update(dt);
    this.hud.update(sim, now);
    this.overlays.update(sim, now, dt);
    this.toasts.update(dt);
  }

  get particleCount(): number {
    return this.particles.count;
  }

  private viewPos(ballId: number): { x: number; y: number; r: number } | undefined {
    const v = this.balls.views.get(ballId);
    return v ? { x: v.x, y: v.y, r: v.r } : undefined;
  }

  private onEvent(sim: Sim, e: SimEvent): void {
    const P = this.particles, T = this.tex;
    switch (e.type) {
      case 'eaten': {
        // Burst where the victim was last drawn (inside its eater after the swallow animation).
        const v = this.viewPos(e.ballId);
        const x = v?.x ?? e.x, y = v?.y ?? e.y;
        const color = sim.players.get(e.ownerId)?.isBot ? 0x8a8f9c : tierColor(e.mass);
        P.burst(T.softDot, x, y, 26 + Math.min(40, e.radius / 3), 260 + e.radius * 2, color, 0.55, 0.75);
        P.burst(T.dot, x, y, 14, 420, 0xffffff, 0.25, 0.4);
        this.ringFlash(x, y, e.radius, color);
        break;
      }
      case 'split': {
        const color = tierColor(e.mass);
        P.burst(T.shard, e.x, e.y, 40, 520, color, 0.9, 0.9, 16);
        P.burst(T.shard, e.x, e.y, 16, 380, 0xffffff, 0.6, 0.6, 20);
        this.ringFlash(e.x, e.y, e.radius * 1.2, 0xffffff);
        break;
      }
      case 'spikeShotHit': {
        P.burst(T.shard, e.x, e.y, e.blocked ? 18 : 30, 420, e.blocked ? 0x3dff9b : 0xff5b5b, 0.7, 0.6, 14);
        this.floaters.add(e.blocked ? 'BLOCKED' : e.split ? 'SPLIT!' : '-30%', e.x, e.y - 40, 48, e.blocked ? 0x3dff9b : 0xff5b5b, 1.1);
        break;
      }
      case 'ability': {
        const b = sim.largestBallOf(e.ownerId);
        const [txt, color] = ABILITY_TEXT[e.ability];
        if (b) {
          this.floaters.add(e.units > 1 ? `${txt} x${e.units}` : txt, b.x, b.y - b.radius - 50, 46, color, 1.4);
          P.burst(T.softDot, b.x, b.y, 24, 300, color, 0.6, 0.6);
        }
        if (e.ability === 'blackHole') this.overlays.announceName(e.nickname, 'BLACK HOLE', this.now);
        break;
      }
      case 'gift': {
        const b = sim.largestBallOf(e.ownerId);
        if (b) this.floaters.add(`+${formatMass(e.mass)}`, b.x, b.y - b.radius - 10, 40, 0xffd86b, 1.1, -80);
        break;
      }
      case 'giftQueued':
        this.toasts.add(`@${e.nickname}: ${e.what} ready ${e.when === 'nextRound' ? 'next round' : 'on respawn'}`);
        break;
      case 'feast':
        if (e.active) {
          this.floaters.add('FEAST!', CONFIG.arena.cx, CONFIG.arena.cy, 140, 0xff4fa3, 1.8, -20);
        }
        break;
      case 'kingChanged': {
        const cs = this.crownState;
        cs.fromX = cs.x;
        cs.fromY = cs.y;
        cs.flyT = cs.owner ? 0 : 1; // first king: crown simply appears
        cs.owner = e.to;
        break;
      }
      case 'botLeft':
        P.burst(T.softDot, e.x, e.y, 16, 200, 0x8a8f9c, 0.5, 0.5);
        break;
      case 'merge': {
        const v = this.viewPos(e.ballId);
        if (v) this.ringFlash(v.x, v.y, v.r, 0xffffff);
        break;
      }
      case 'phase':
        if (e.phase === 'storm') this.floaters.add('STORM!', CONFIG.arena.cx, CONFIG.arena.cy, 140, 0xff3b4a, 1.8, -20);
        if (e.phase === 'play') this.floaters.add('FIGHT!', CONFIG.arena.cx, CONFIG.arena.cy, 150, 0xffe066, 1.4, -20);
        this.crownState.owner = null;
        break;
      default:
        break;
    }
  }

  private ringFlash(x: number, y: number, r: number, color: number): void {
    // An expanding ring made of particles reads well and needs no extra Graphics per event.
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.spawn(this.tex.softDot, x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, {
        vx: Math.cos(a) * (180 + r), vy: Math.sin(a) * (180 + r), tint: color, scale: 0.45, life: 0.45, drag: 4,
      });
    }
  }

  private dashTrails(sim: Sim): void {
    if (this.trailAcc !== 0) return;
    for (const b of sim.balls) {
      const p = sim.players.get(b.ownerId);
      if (!p || p.dashUntil <= sim.time) continue;
      this.particles.spawn(this.tex.softDot, b.x, b.y, { tint: 0x3dd6ff, scale: (b.radius * 2) / 64, life: 0.3, alpha: 0.35 });
    }
  }

  private blackHoleSuck(sim: Sim, dt: number): void {
    for (const p of sim.players.values()) {
      if (p.blackHoleUntil <= sim.time) continue;
      for (const b of sim.ballsOf(p.userId)) {
        const n = Math.random() < dt * 40 ? 2 : 0;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = CONFIG.abilities.blackHole.range + b.radius;
          const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r;
          const sp = r / 0.6;
          this.particles.spawn(this.tex.softDot, x, y, { vx: -Math.cos(a) * sp + Math.sin(a) * 120, vy: -Math.sin(a) * sp - Math.cos(a) * 120, tint: 0xd2a8ff, scale: 0.4, life: 0.6, drag: 0 });
        }
      }
    }
  }

  private updateCrown(sim: Sim, dt: number): void {
    const cs = this.crownState;
    const owner = sim.kingOwner;
    if (owner !== cs.owner && owner) {
      // e.g. after a phase change; snap
      cs.owner = owner;
      cs.flyT = 1;
    }
    const king = owner ? sim.largestBallOf(owner) : undefined;
    const v = king ? this.viewPos(king.id) : undefined;
    if (!king || !v) {
      this.crown.visible = false;
      return;
    }
    const bob = Math.sin(this.now * 3) * 6;
    const tx = v.x, ty = v.y - v.r * 0.92 + bob;
    const w = Math.max(70, v.r * 1.05);
    if (cs.flyT < 1) {
      cs.flyT = Math.min(1, cs.flyT + dt / 0.55);
      const k = easeOutBack(cs.flyT);
      cs.x = cs.fromX + (tx - cs.fromX) * k;
      cs.y = cs.fromY + (ty - cs.fromY) * k - Math.sin(cs.flyT * Math.PI) * 120;
      if (cs.flyT >= 1) {
        cs.flashT = 0;
        this.particles.burst(this.tex.softDot, tx, ty, 30, 380, 0xffc83d, 0.6, 0.6);
      }
    } else {
      cs.x = tx;
      cs.y = ty;
    }
    this.crown.visible = true;
    this.crown.position.set(cs.x, cs.y);
    this.crown.width = w;
    this.crown.height = w * 0.69;
    this.crown.rotation = Math.sin(this.now * 2.2) * 0.08;
    // flash
    this.flash.clear();
    if (cs.flashT < 1) {
      cs.flashT = Math.min(1, cs.flashT + dt / 0.35);
      this.flash.circle(v.x, v.y, v.r * (1 + cs.flashT * 0.8)).fill({ color: 0xfff1a8, alpha: 0.55 * (1 - cs.flashT) });
    }
  }
}
