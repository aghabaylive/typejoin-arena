import { Container, Sprite, type Text, type Texture } from 'pixi.js';
import { label } from './text';

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  spin: number;
  drag: number;
  grow: number;
  baseScale: number;
}

/** Tiny pooled sprite particle system. */
export class Particles {
  readonly container = new Container();
  private pool: Sprite[] = [];
  private live: Particle[] = [];

  spawn(tex: Texture, x: number, y: number, o: { vx?: number; vy?: number; life?: number; tint?: number; scale?: number; spin?: number; drag?: number; grow?: number; alpha?: number; rot?: number }): void {
    if (this.live.length > 2500) return;
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.tint = o.tint ?? 0xffffff;
    s.alpha = o.alpha ?? 1;
    s.rotation = o.rot ?? 0;
    const sc = o.scale ?? 1;
    s.scale.set(sc);
    s.visible = true;
    this.container.addChild(s);
    const life = o.life ?? 0.6;
    this.live.push({ s, vx: o.vx ?? 0, vy: o.vy ?? 0, life, max: life, spin: o.spin ?? 0, drag: o.drag ?? 2.5, grow: o.grow ?? 0, baseScale: sc });
  }

  burst(tex: Texture, x: number, y: number, n: number, speed: number, tint: number, scale = 0.5, life = 0.7, spin = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.75);
      this.spawn(tex, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, tint, scale: scale * (0.6 + Math.random() * 0.8), life: life * (0.7 + Math.random() * 0.6), spin: spin * (Math.random() - 0.5), rot: Math.random() * 6.28 });
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.container.removeChild(p.s);
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const t = p.life / p.max;
      p.s.alpha = Math.min(1, t * 1.6);
      p.s.scale.set(p.baseScale * (1 + p.grow * (1 - t)));
    }
  }

  get count(): number {
    return this.live.length;
  }
}

interface Floater {
  t: Text;
  life: number;
  max: number;
  vy: number;
  pop: boolean;
}

/** Short-lived floating texts ("+375", "SHIELD!", "FEAST!"). */
export class Floaters {
  readonly container = new Container();
  private live: Floater[] = [];

  add(text: string, x: number, y: number, size: number, color: number, life = 1.2, vy = -60, pop = true): Text {
    const t = label(text, size, color);
    t.position.set(x, y);
    this.container.addChild(t);
    this.live.push({ t, life, max: life, vy, pop });
    if (this.live.length > 40) this.kill(0);
    return t;
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.kill(i);
        continue;
      }
      f.t.y += f.vy * dt;
      const age = f.max - f.life;
      const s = f.pop ? (age < 0.18 ? 0.4 + (age / 0.18) * 0.75 : age < 0.3 ? 1.15 - ((age - 0.18) / 0.12) * 0.15 : 1) : 1;
      f.t.scale.set(s);
      f.t.alpha = Math.min(1, f.life / 0.35);
    }
  }

  private kill(i: number): void {
    const f = this.live[i];
    this.live.splice(i, 1);
    f.t.destroy();
  }
}
