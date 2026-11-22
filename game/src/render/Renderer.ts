import { Container, Graphics, Sprite, type Application } from 'pixi.js';
import { CONFIG, tierColor } from '../config';
import type { Sim } from '../sim/Sim';
import type { SimEvent } from '../sim/types';
import { AvatarCache } from './avatars';
import { BallLayer, easeOutBack } from './balls';
import { Floaters, Particles } from './effects';
import { Hud, makeLegend } from './hud';
import { Overlays } from './overlays';
import { label } from './text';
import type { LegendMode } from '@typejoin/shared';
import { Toasts } from './toasts';
import { clip, formatMass } from './text';
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
  private legend: Container;
  private growLine: Container;
  legendMode: LegendMode = CONFIG.ui.legend;
  private crown: Sprite;
  private flash = new Graphics();
  private crownState = { owner: null as string | null, x: 540, y: 300, fromX: 540, fromY: 300, flyT: 1, flashT: 1 };
  private now = 0;
  private trailAcc = 0;
  /** World container (shaken on Black Hole / King change; HUD and legend stay still). */
  private world!: Container;
  private shakeT = 0;
  private shakeAmp = 0;
  /** Last "+1 heart" time per ball (throttle). */
  private lastHeart = new Map<number, number>();

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
    this.world = world;
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
    this.legend = makeLegend();
    this.growLine = makeGrowLine();
    stage.addChild(makeBackground(this.tex), world, this.hud.root, this.legend, this.growLine, this.overlays.root, this.toasts.root);
    this.setLegendMode(CONFIG.ui.legend);
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
    this.updateShake(dt);
    this.particles.update(dt);
    this.floaters.update(dt);
    this.hud.update(sim, now);
    this.overlays.update(sim, now, dt);
    this.toasts.update(dt);
  }

  /** "full": legend bottom-right. "off": legend zone completely empty + one "Any gift = grow" line under the top bar. */
  setLegendMode(mode: LegendMode): void {
    this.legendMode = mode;
    this.legend.visible = mode === 'full';
    this.growLine.visible = mode === 'off';
    this.toasts.offsetY = mode === 'off' ? 64 : 0;
  }

  /** Full-screen banner for "Reconnecting..." / "LIVE ended" (null hides it). */
  setBanner(text: string | null): void {
    this.overlays.setBanner(text, this.now);
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
        if (e.ability === 'blackHole') {
          this.overlays.announceName(e.nickname, 'BLACK HOLE', this.now);
          this.shake(18, 0.45);
        }
        break;
      }
      case 'gift': {
        const b = sim.largestBallOf(e.ownerId);
        if (b) this.floaters.add(`+${formatMass(e.mass)}`, b.x, b.y - b.radius - 10, 40, 0xffd86b, 1.1, -80);
        break;
      }
      case 'likeHeart': {
        // "+1 ♥" rising from the ball, at most once per second per ball.
        const last = this.lastHeart.get(e.ballId) ?? -Infinity;
        if (this.now - last < 1) break;
        this.lastHeart.set(e.ballId, this.now);
        if (this.lastHeart.size > 500) this.lastHeart.clear();
        const v = this.viewPos(e.ballId);
        const b = sim.ballById(e.ballId);
        const x = v?.x ?? b?.x, y = v?.y ?? b?.y, r = v?.r ?? b?.radius ?? 30;
        if (x === undefined || y === undefined) break;
        this.floaters.add('+1 ♥', x + r * 0.55, y - r * 0.6, 36, 0xff7ab6, 1.0, -90);
        break;
      }
      case 'giftQueued':
        this.toasts.add(`@${e.nickname}: ${e.what} ready ${e.when === 'spawn' ? 'on spawn' : 'on respawn'}`);
        break;
      case 'feast':
        if (e.active) {
          this.floaters.add('FOOD RAIN!', CONFIG.arena.cx, CONFIG.arena.cy, 120, CONFIG.brand.yellow, 1.8, -20);
        }
        break;
      case 'kingChanged': {
        const cs = this.crownState;
        cs.fromX = cs.x;
        cs.fromY = cs.y;
        cs.flyT = cs.owner ? 0 : 1; // first king: crown simply appears
        // A real King change (not the first crowning) by a big ball; small changes only fly the crown.
        if (e.from && e.to && sim.ownerMass(e.to) >= CONFIG.king.shakeMinMass) this.shake(10, 0.3);
        cs.owner = e.to;
        break;
      }
      case 'spawn': {
        if (e.isBot) break;
        const v = this.viewPos(e.ballId);
        const b = sim.ballById(e.ballId);
        const x = v?.x ?? b?.x, y = v?.y ?? b?.y, r = v?.r ?? b?.radius ?? 30;
        if (x === undefined || y === undefined) break;
        const name = sim.players.get(e.ownerId)?.nickname ?? '';
        this.floaters.add(`+${clip(name || 'player', 10)}`, x, y - r - 30, 38, CONFIG.brand.yellow, 1.1, -70);
        P.burst(T.softDot, x, y, 14, 220, CONFIG.brand.yellow, 0.45, 0.45);
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
      case 'storm':
        if (e.stage === 'shrink') this.floaters.add('STORM!', CONFIG.arena.cx, CONFIG.arena.cy, 140, CONFIG.brand.coral, 1.8, -20);
        break;
      default:
        break;
    }
  }

  /** Short screen shake of the world (Black Hole, King change only). */
  private shake(amp: number, sec: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, sec);
  }

  private updateShake(dt: number): void {
    if (this.shakeT <= 0) {
      this.world.position.set(0, 0);
      return;
    }
    this.shakeT -= dt;
    const a = this.shakeAmp * Math.max(0, Math.min(1, this.shakeT / 0.3));
    this.world.position.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
    if (this.shakeT <= 0) this.shakeAmp = 0;
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
          const r = sim.fieldRange(CONFIG.abilities.blackHole.range) + b.radius;
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

/** The single line shown under the top bar when the legend is off. */
function makeGrowLine(): Container {
  const c = new Container();
  const t = label('Any gift = grow  ·  Like = small grow', CONFIG.render.minFont, CONFIG.brand.yellow);
  const w = t.width + 48, h = 54;
  c.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: CONFIG.brand.ink, alpha: 0.85 }).stroke({ width: 2, color: CONFIG.brand.cobalt, alpha: 0.8 }), t);
  c.position.set(CONFIG.canvas.width / 2, CONFIG.render.hudBottom + 34);
  c.visible = false;
  return c;
}
